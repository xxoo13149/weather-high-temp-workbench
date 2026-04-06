import type { RegisteredLocation } from "../config.js";
import type {
  HourlyWeatherResponse,
  KellyBucketProbability,
  KellyDistributionSummary,
  KellyMarketRow,
  KellyProbabilityCurvePoint,
  KellyRecommendation,
  KellyRequestOptions,
  KellyRiskMode,
  KellySourceLinks,
  KellySourceStatus,
  KellyStreamMarketPatch,
  KellyTemperatureUnit,
  KellyWeatherEvidence,
  MultiModelDistributionResponse,
  MultiModelInsightResponse,
  WeatherReportResponse,
} from "../domain/weather.js";
import { clamp, clamp01, mean, median, normalCdf, normalPdf, round2, round4, standardDeviation } from "./math.js";
import type { PolymarketCandidate } from "./polymarket.js";

type UsableModelSignal = {
  modelName: string;
  modelCode: string | null;
  currentPredictionC: number;
  dayPeakTemperatureC: number;
  biasNowC: number;
  adjustedPeakTemperatureC: number;
  sigmaC: number;
  weight: number;
};

type KellyPricingContext = {
  bankroll: number;
  riskMode: KellyRiskMode;
  minEdge: number;
};

type InternalOrderBook = {
  bestBid: number | null;
  bestAsk: number | null;
  midpoint: number | null;
  updatedAt: string;
};

const RISK_PROFILE: Record<
  KellyRiskMode,
  {
    multiplier: number;
    maxFraction: number;
    label: string;
  }
> = {
  conservative: {
    multiplier: 0.25,
    maxFraction: 0.05,
    label: "保守",
  },
  balanced: {
    multiplier: 0.5,
    maxFraction: 0.1,
    label: "平衡",
  },
  aggressive: {
    multiplier: 0.75,
    maxFraction: 0.15,
    label: "积极",
  },
};

const GRID_STEP = 0.1;
const DEFAULT_BANKROLL = 1000;
const DEFAULT_MIN_EDGE = 0.02;
const DEFAULT_RISK_MODE: KellyRiskMode = "balanced";

const unique = <T>(values: T[]): T[] => Array.from(new Set(values));

const parseTargetDateFromTimestamp = (timestamp: string, timeZone: string): string | null => {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(parsed);
};

export const resolveKellyTargetDate = (timeZone: string, requestedTargetDate?: string): string => {
  if (requestedTargetDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedTargetDate)) {
    return requestedTargetDate;
  }

  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
};

const resolveAvailableTargetDates = (timestamps: string[], timeZone: string): string[] =>
  unique(
    timestamps
      .map((timestamp) => parseTargetDateFromTimestamp(timestamp, timeZone))
      .filter((value): value is string => Boolean(value)),
  );

const findHourlyItem = (hourly: HourlyWeatherResponse, timestamp: string | undefined) =>
  timestamp ? hourly.items.find((item) => item.timestamp === timestamp) ?? null : null;

const resolveReferenceTemperature = (
  hourly: HourlyWeatherResponse,
  insight: MultiModelInsightResponse,
  options: KellyRequestOptions,
): {
  value: number | null;
  source: KellyWeatherEvidence["currentReferenceSource"];
  weatherTimestamp: string | null;
} => {
  if (typeof options.actualTemperatureC === "number" && Number.isFinite(options.actualTemperatureC)) {
    return {
      value: options.actualTemperatureC,
      source: "manual",
      weatherTimestamp: options.selectedHourTimestamp ?? hourly.current?.timestamp ?? null,
    };
  }

  if (typeof hourly.current?.temperatureC === "number") {
    return {
      value: hourly.current.temperatureC,
      source: "hourly-current",
      weatherTimestamp: hourly.current.timestamp,
    };
  }

  const selectedHour = findHourlyItem(hourly, options.selectedHourTimestamp);
  if (typeof selectedHour?.temperatureC === "number") {
    return {
      value: selectedHour.temperatureC,
      source: "hourly-selected",
      weatherTimestamp: selectedHour.timestamp,
    };
  }

  if (typeof insight.referenceTemperature.temperatureC === "number") {
    return {
      value: insight.referenceTemperature.temperatureC,
      source: "model-mean",
      weatherTimestamp: options.selectedHourTimestamp ?? insight.selectedTimestamp,
    };
  }

  return {
    value: null,
    source: "model-mean",
    weatherTimestamp: options.selectedHourTimestamp ?? insight.selectedTimestamp,
  };
};

const buildRankWeight = (rank: number, total: number): number => {
  if (rank === 0) {
    return 1.25;
  }
  if (rank === 1) {
    return 1.15;
  }
  if (rank === 2) {
    return 1.08;
  }
  if (rank >= Math.floor(total * 0.75)) {
    return 0.85;
  }
  return 1;
};

const buildUsableSignals = (
  insight: MultiModelInsightResponse,
  distribution: MultiModelDistributionResponse,
  referenceTemperatureC: number | null,
) => {
  const distributionByModel = new Map(distribution.members.map((member) => [member.modelName, member] as const));
  const inventoryByModel = new Map(distribution.modelInventory.map((item) => [item.modelName, item] as const));
  const totalModelCount = Math.max(
    distribution.modelInventory.length,
    distribution.members.length,
    insight.rankedModels.length,
  );

  const rankedByBias = [...insight.rankedModels]
    .filter((model) => typeof model.currentTemperatureC === "number")
    .sort((left, right) => Math.abs(left.deltaToActualTemperatureC) - Math.abs(right.deltaToActualTemperatureC));
  const rankMap = new Map(rankedByBias.map((model, index) => [model.modelName, index] as const));

  const preliminary = insight.rankedModels.map((model) => {
    const distributionMember = distributionByModel.get(model.modelName);
    const inventory = inventoryByModel.get(model.modelName);
    const currentPredictionC = model.currentTemperatureC;
    const dayPeakTemperatureC = distributionMember?.peakTemperatureC ?? model.dayPeakTemperatureC;

    if (
      referenceTemperatureC === null ||
      typeof currentPredictionC !== "number" ||
      typeof dayPeakTemperatureC !== "number"
    ) {
      return {
        modelName: model.modelName,
        modelCode: inventory?.modelCode ?? null,
        currentPredictionC: typeof currentPredictionC === "number" ? currentPredictionC : null,
        dayPeakTemperatureC: typeof dayPeakTemperatureC === "number" ? dayPeakTemperatureC : null,
        biasNowC: null,
        adjustedPeakTemperatureC: null,
        sigmaC: null,
        weight: null,
        included: false,
        exclusionReason:
          referenceTemperatureC === null
            ? "参考温度不可用"
            : typeof currentPredictionC !== "number"
              ? "当前时刻模型值缺失"
              : "日高温预测缺失",
      };
    }

    const biasNowC = currentPredictionC - referenceTemperatureC;
    return {
      modelName: model.modelName,
      modelCode: inventory?.modelCode ?? null,
      currentPredictionC,
      dayPeakTemperatureC,
      biasNowC,
      adjustedPeakTemperatureC: 0,
      sigmaC: 0,
      weight: 0,
      included: true,
      exclusionReason: null,
    };
  });

  const usableBase = preliminary.filter((entry) => entry.included && entry.biasNowC !== null) as Array<
    typeof preliminary[number] & {
      biasNowC: number;
      currentPredictionC: number;
      dayPeakTemperatureC: number;
    }
  >;

  const peakSpreadRef = standardDeviation(usableBase.map((entry) => entry.dayPeakTemperatureC));
  const medianPeak = median(usableBase.map((entry) => entry.dayPeakTemperatureC));

  const weightedSignals = usableBase.map((entry) => {
    const adjustedPeakTemperatureC = entry.dayPeakTemperatureC - 0.65 * entry.biasNowC;
    const sigmaC = 0.9 + 0.35 * Math.abs(entry.biasNowC) + 0.12 * peakSpreadRef;
    const biasWeight = Math.exp(-Math.abs(entry.biasNowC) / 2.25);
    const consensusWeight = Math.exp(-Math.abs(entry.dayPeakTemperatureC - medianPeak) / 2.75);
    const rankWeight = buildRankWeight(rankMap.get(entry.modelName) ?? usableBase.length, usableBase.length);

    return {
      ...entry,
      adjustedPeakTemperatureC,
      sigmaC,
      rawWeight: biasWeight * consensusWeight * rankWeight,
    };
  });

  const rawWeightSum = weightedSignals.reduce((sum, entry) => sum + entry.rawWeight, 0) || 1;
  const usableSignals: UsableModelSignal[] = weightedSignals.map((entry) => ({
    modelName: entry.modelName,
    modelCode: entry.modelCode,
    currentPredictionC: entry.currentPredictionC,
    dayPeakTemperatureC: entry.dayPeakTemperatureC,
    biasNowC: entry.biasNowC,
    adjustedPeakTemperatureC: entry.adjustedPeakTemperatureC,
    sigmaC: entry.sigmaC,
    weight: entry.rawWeight / rawWeightSum,
  }));

  const exposedSignals = preliminary.map((entry) => {
    const usable = usableSignals.find((signal) => signal.modelName === entry.modelName);
    if (!usable) {
      return entry;
    }

    return {
      ...entry,
      adjustedPeakTemperatureC: usable.adjustedPeakTemperatureC,
      sigmaC: usable.sigmaC,
      weight: usable.weight,
    };
  });

  return {
    totalModelCount,
    peakSpreadRef,
    exposedSignals,
    usableSignals,
  };
};

const buildProbabilityCurve = (signals: UsableModelSignal[]): KellyProbabilityCurvePoint[] => {
  if (signals.length === 0) {
    return [];
  }

  const minC = Math.floor(Math.min(...signals.map((signal) => signal.adjustedPeakTemperatureC - signal.sigmaC * 4)) * 10) / 10;
  const maxC = Math.ceil(Math.max(...signals.map((signal) => signal.adjustedPeakTemperatureC + signal.sigmaC * 4)) * 10) / 10;
  const raw = [];

  for (let temperatureC = minC; temperatureC <= maxC + 1e-9; temperatureC = round2(temperatureC + GRID_STEP)) {
    const density = signals.reduce(
      (sum, signal) => sum + signal.weight * normalPdf(temperatureC, signal.adjustedPeakTemperatureC, signal.sigmaC),
      0,
    );
    raw.push({
      temperatureC: round2(temperatureC),
      density,
    });
  }

  const densitySum = raw.reduce((sum, point) => sum + point.density * GRID_STEP, 0) || 1;
  let cumulative = 0;
  return raw.map((point) => {
    const normalizedDensity = point.density / densitySum;
    cumulative = clamp01(cumulative + normalizedDensity * GRID_STEP) ?? 0;
    return {
      temperatureC: point.temperatureC,
      density: round4(normalizedDensity),
      cumulative: round4(cumulative),
    };
  });
};

const integrateProbability = (
  curve: KellyProbabilityCurvePoint[],
  lowerBoundC: number | null,
  upperBoundC: number | null,
): number => {
  if (curve.length === 0) {
    return 0.5;
  }

  return clamp01(
    curve.reduce((sum, point) => {
      const withinLower = lowerBoundC === null || point.temperatureC >= lowerBoundC - 1e-9;
      const withinUpper = upperBoundC === null || point.temperatureC <= upperBoundC + 1e-9;
      return withinLower && withinUpper ? sum + point.density * GRID_STEP : sum;
    }, 0),
  ) ?? 0;
};

const buildShrink = (
  signals: UsableModelSignal[],
  totalModelCount: number,
  weatherStale: boolean,
): number => {
  if (signals.length === 0) {
    return 0.58;
  }

  const disagreement = standardDeviation(signals.map((signal) => signal.adjustedPeakTemperatureC));
  const biasDispersion = standardDeviation(signals.map((signal) => signal.biasNowC));
  const missingRatio = clamp01((totalModelCount - signals.length) / Math.max(totalModelCount, 1)) ?? 0;
  const stalePenalty = weatherStale ? 0.08 : 0;
  return clamp(1 - disagreement * 0.08 - biasDispersion * 0.06 - missingRatio * 0.22 - stalePenalty, 0.58, 0.92);
};

const applyShrink = (probability: number, shrink: number): number =>
  clamp01(0.5 + shrink * (probability - 0.5)) ?? 0.5;

const buildBaseBuckets = (curve: KellyProbabilityCurvePoint[]): KellyBucketProbability[] => {
  if (curve.length === 0) {
    return [];
  }

  const minBucket = Math.floor(curve[0]?.temperatureC ?? 0);
  const maxBucket = Math.ceil(curve[curve.length - 1]?.temperatureC ?? 0);
  const buckets: KellyBucketProbability[] = [];

  for (let current = minBucket; current < maxBucket; current += 1) {
    const start = current;
    const end = current + 1;
    const probabilityYes = integrateProbability(curve, start, end);
    buckets.push({
      marketId: `range:${start}-${end}`,
      label: `${start}C - ${end}C`,
      contractType: "range",
      bucketStartC: start,
      bucketEndC: end,
      probabilityYes: round4(probabilityYes),
      probabilityNo: round4(1 - probabilityYes),
    });
  }

  return buckets;
};

const buildDistributionSummary = (
  curve: KellyProbabilityCurvePoint[],
  shrink: number,
  usableModelCount: number,
  totalModelCount: number,
  peakSpreadC: number,
): KellyDistributionSummary => {
  if (curve.length === 0) {
    return {
      meanTemperatureC: 0,
      medianTemperatureC: 0,
      modeTemperatureC: 0,
      mostLikelyRangeLabel: "--",
      shrink,
      usableModelCount,
      totalModelCount,
      peakSpreadC,
    };
  }

  const modePoint = [...curve].sort((left, right) => right.density - left.density)[0] ?? curve[0];
  const meanTemperatureC = curve.reduce((sum, point) => sum + point.temperatureC * point.density * GRID_STEP, 0);
  const medianPoint = curve.find((point) => point.cumulative >= 0.5) ?? curve[Math.floor(curve.length / 2)];
  const baseBuckets = buildBaseBuckets(curve);
  const mostLikelyBucket = [...baseBuckets].sort((left, right) => right.probabilityYes - left.probabilityYes)[0];

  return {
    meanTemperatureC: round2(meanTemperatureC),
    medianTemperatureC: round2(medianPoint?.temperatureC ?? meanTemperatureC),
    modeTemperatureC: round2(modePoint?.temperatureC ?? meanTemperatureC),
    mostLikelyRangeLabel: mostLikelyBucket?.label ?? "--",
    shrink: round4(shrink),
    usableModelCount,
    totalModelCount,
    peakSpreadC: round2(peakSpreadC),
  };
};

const computeContractProbability = (
  curve: KellyProbabilityCurvePoint[],
  contractType: KellyMarketRow["contractType"],
  startC: number | null,
  endC: number | null,
  shrink: number,
): number => {
  const raw =
    contractType === "atLeast"
      ? integrateProbability(curve, startC, null)
      : contractType === "atMost"
        ? integrateProbability(curve, null, endC)
        : contractType === "exact" && startC !== null
          ? integrateProbability(curve, startC - 0.5, startC + 0.5)
          : integrateProbability(curve, startC, endC);

  return round4(applyShrink(raw, shrink));
};

const computeKellyFraction = (fairPrice: number, entryPrice: number): number => {
  if (!Number.isFinite(fairPrice) || !Number.isFinite(entryPrice) || entryPrice <= 0 || entryPrice >= 1) {
    return 0;
  }

  return Math.max(0, (fairPrice - entryPrice) / (1 - entryPrice));
};

const buildRecommendationReason = (market: KellyMarketRow, riskMode: KellyRiskMode): string => {
  const profile = RISK_PROFILE[riskMode];
  if (market.recommendedSide === "none") {
    return "未达到最小 edge 或盘口质量不足。";
  }

  return `${profile.label}模式，结合当前 edge、盘口价差与流动性后给出仓位建议。`;
};

export const applyPricingToMarkets = (
  markets: KellyMarketRow[],
  orderBooks: Map<string, InternalOrderBook>,
  controls: KellyPricingContext,
): KellyMarketRow[] => {
  const riskProfile = RISK_PROFILE[controls.riskMode];

  return markets.map((market) => {
    if (market.parseStatus !== "matched") {
      return {
        ...market,
        yesPrice: null,
        noPrice: null,
        yesBestBid: null,
        yesBestAsk: null,
        noBestBid: null,
        noBestAsk: null,
        spreadPct: null,
        edgeYes: 0,
        edgeNo: 0,
        kellyYes: 0,
        kellyNo: 0,
        recommendedSide: "none",
        suggestedStake: 0,
      };
    }

    const yesBook = market.yesTokenId ? orderBooks.get(market.yesTokenId) : undefined;
    const noBook = market.noTokenId ? orderBooks.get(market.noTokenId) : undefined;
    const yesPrice = yesBook?.midpoint ?? null;
    const noPrice = noBook?.midpoint ?? null;
    const yesBestAsk = yesBook?.bestAsk ?? null;
    const noBestAsk = noBook?.bestAsk ?? null;
    const yesBestBid = yesBook?.bestBid ?? null;
    const noBestBid = noBook?.bestBid ?? null;
    const entryYesPrice = yesBestAsk ?? yesPrice;
    const entryNoPrice = noBestAsk ?? noPrice;
    const edgeYes = entryYesPrice !== null ? round4(market.fairYes - entryYesPrice) : 0;
    const edgeNo = entryNoPrice !== null ? round4(market.fairNo - entryNoPrice) : 0;
    const baseKellyYes = entryYesPrice !== null ? computeKellyFraction(market.fairYes, entryYesPrice) : 0;
    const baseKellyNo = entryNoPrice !== null ? computeKellyFraction(market.fairNo, entryNoPrice) : 0;
    const kellyYes = round4(Math.min(baseKellyYes * riskProfile.multiplier, riskProfile.maxFraction));
    const kellyNo = round4(Math.min(baseKellyNo * riskProfile.multiplier, riskProfile.maxFraction));
    const spreadFromYes =
      yesBestBid !== null && yesBestAsk !== null
        ? Math.max(0, yesBestAsk - yesBestBid)
        : null;
    const spreadFromNo =
      noBestBid !== null && noBestAsk !== null
        ? Math.max(0, noBestAsk - noBestBid)
        : null;
    const spreadPct = round4(Math.max(spreadFromYes ?? 0, spreadFromNo ?? 0));

    let recommendedSide: KellyMarketRow["recommendedSide"] = "none";
    let suggestedStake = 0;

    if (edgeYes >= controls.minEdge && kellyYes > 0) {
      recommendedSide = "yes";
      suggestedStake = round2(controls.bankroll * kellyYes);
    }

    if (edgeNo >= controls.minEdge && kellyNo > 0 && (recommendedSide === "none" || edgeNo > edgeYes)) {
      recommendedSide = "no";
      suggestedStake = round2(controls.bankroll * kellyNo);
    }

    return {
      ...market,
      yesPrice,
      noPrice,
      yesBestBid,
      yesBestAsk,
      noBestBid,
      noBestAsk,
      spreadPct,
      edgeYes,
      edgeNo,
      kellyYes,
      kellyNo,
      recommendedSide,
      suggestedStake,
      updatedAt: yesBook?.updatedAt ?? noBook?.updatedAt ?? market.updatedAt,
    };
  });
};

export const buildRecommendations = (
  markets: KellyMarketRow[],
  riskMode: KellyRiskMode,
): KellyRecommendation[] =>
  markets
    .filter((market) => market.recommendedSide !== "none" && market.suggestedStake > 0)
    .sort((left, right) => {
      const leftScore =
        Math.max(left.suggestedStake, 0) * 10 +
        Math.max(left.edgeYes, left.edgeNo) * 100 +
        (left.volume24h ?? 0) / 1000 -
        (left.spreadPct ?? 0) * 10;
      const rightScore =
        Math.max(right.suggestedStake, 0) * 10 +
        Math.max(right.edgeYes, right.edgeNo) * 100 +
        (right.volume24h ?? 0) / 1000 -
        (right.spreadPct ?? 0) * 10;
      return rightScore - leftScore;
    })
    .slice(0, 2)
    .map((market, index) => {
      const isYes = market.recommendedSide === "yes";
      const marketPrice = isYes ? (market.yesBestAsk ?? market.yesPrice ?? 0) : (market.noBestAsk ?? market.noPrice ?? 0);
      const fairPrice = isYes ? market.fairYes : market.fairNo;
      const kellyFraction = isYes ? market.kellyYes : market.kellyNo;
      const edge = isYes ? market.edgeYes : market.edgeNo;

      return {
        slot: index === 0 ? "primary" : "secondary",
        marketId: market.marketId,
        title: market.title,
        marketUrl: market.marketUrl,
        side: isYes ? "yes" : "no",
        edge,
        fairPrice,
        marketPrice,
        kellyFraction,
        suggestedStake: market.suggestedStake,
        reason: buildRecommendationReason(market, riskMode),
      };
    });

export const buildKellyMarkets = (
  candidates: PolymarketCandidate[],
  curve: KellyProbabilityCurvePoint[],
  shrink: number,
): KellyMarketRow[] =>
  candidates.map((candidate) => {
    const fairYes =
      candidate.parseStatus === "matched"
        ? computeContractProbability(curve, candidate.contractType, candidate.bucketStartC, candidate.bucketEndC, shrink)
        : 0.5;

    return {
      marketId: candidate.marketId,
      slug: candidate.slug,
      title: candidate.title,
      marketUrl: candidate.marketUrl,
      conditionId: candidate.conditionId,
      liquidity: candidate.liquidity,
      volume24h: candidate.volume24h,
      contractType: candidate.contractType,
      unit: candidate.unit,
      bucketStartC: candidate.bucketStartC,
      bucketEndC: candidate.bucketEndC,
      bucketLabel: candidate.bucketLabel,
      parseStatus: candidate.parseStatus,
      exclusionReason: candidate.exclusionReason,
      yesTokenId: candidate.yesTokenId,
      noTokenId: candidate.noTokenId,
      yesPrice: null,
      noPrice: null,
      yesBestBid: null,
      yesBestAsk: null,
      noBestBid: null,
      noBestAsk: null,
      spreadPct: null,
      fairYes,
      fairNo: round4(1 - fairYes),
      edgeYes: 0,
      edgeNo: 0,
      kellyYes: 0,
      kellyNo: 0,
      recommendedSide: "none",
      suggestedStake: 0,
      updatedAt: candidate.updatedAt,
    };
  });

export const buildSourceStatuses = ({
  weatherStale,
  marketFetchedAt,
  priceFetchedAt,
  warnings,
}: {
  weatherStale: boolean;
  marketFetchedAt: string | null;
  priceFetchedAt: string | null;
  warnings: string[];
}): KellySourceStatus[] => {
  const marketState = marketFetchedAt ? "fresh" : warnings.length > 0 ? "degraded" : "unavailable";
  const orderbookState = priceFetchedAt ? "fresh" : warnings.length > 0 ? "degraded" : "unavailable";

  return [
    {
      kind: "weather",
      state: weatherStale ? "stale" : "fresh",
      label: "天气证据",
      detail: weatherStale ? "天气层使用了最近一次成功缓存。" : "天气层与多模型层已同步。",
      updatedAt: null,
    },
    {
      kind: "market-discovery",
      state: marketState,
      label: "市场发现",
      detail: marketFetchedAt ? "已获取 Polymarket 候选市场。" : "当前未拿到可用市场元数据。",
      updatedAt: marketFetchedAt,
    },
    {
      kind: "orderbooks",
      state: orderbookState,
      label: "盘口快照",
      detail: priceFetchedAt ? "盘口价格已同步。" : "当前未拿到可用盘口快照。",
      updatedAt: priceFetchedAt,
    },
    {
      kind: "stream",
      state: "unavailable",
      label: "实时流",
      detail: "等待前端连接后建立 Polymarket WebSocket 订阅。",
      updatedAt: null,
    },
  ];
};

export const buildKellyWorkbench = ({
  location,
  targetDate,
  hourly,
  report,
  insight,
  distribution,
  discoveryCandidates,
  discoveryFetchedAt,
  sourceLinks,
  orderBooks,
  priceFetchedAt,
  options,
  warnings,
}: {
  location: RegisteredLocation;
  targetDate: string;
  hourly: HourlyWeatherResponse;
  report: WeatherReportResponse;
  insight: MultiModelInsightResponse;
  distribution: MultiModelDistributionResponse;
  discoveryCandidates: PolymarketCandidate[];
  discoveryFetchedAt: string | null;
  sourceLinks: KellySourceLinks;
  orderBooks: Map<string, InternalOrderBook>;
  priceFetchedAt: string | null;
  options: KellyRequestOptions;
  warnings: string[];
}) => {
  const bankroll = options.bankroll && Number.isFinite(options.bankroll) && options.bankroll > 0 ? options.bankroll : DEFAULT_BANKROLL;
  const minEdge =
    options.minEdge && Number.isFinite(options.minEdge) && options.minEdge >= 0 ? clamp(options.minEdge, 0, 1) : DEFAULT_MIN_EDGE;
  const riskMode = options.riskMode ?? DEFAULT_RISK_MODE;
  const availableTargetDates = resolveAvailableTargetDates(distribution.availableTimestamps, location.timezone);
  const reference = resolveReferenceTemperature(hourly, insight, options);
  const signalBundle = buildUsableSignals(insight, distribution, reference.value);
  const curve = buildProbabilityCurve(signalBundle.usableSignals);
  const shrink = buildShrink(signalBundle.usableSignals, signalBundle.totalModelCount, hourly.stale || distribution.stale || insight.stale);
  const distributionSummary = buildDistributionSummary(
    curve,
    shrink,
    signalBundle.usableSignals.length,
    signalBundle.totalModelCount,
    signalBundle.peakSpreadRef,
  );
  const baseBuckets = buildBaseBuckets(curve);
  const baseMarkets = buildKellyMarkets(discoveryCandidates, curve, shrink);
  const pricedMarkets = applyPricingToMarkets(baseMarkets, orderBooks, {
    bankroll,
    riskMode,
    minEdge,
  });
  const recommendations = buildRecommendations(pricedMarkets, riskMode);

  const weatherEvidence: KellyWeatherEvidence = {
    location: {
      id: location.id,
      name: location.name,
      timezone: location.timezone,
    },
    targetDate,
    availableTargetDates,
    currentReferenceTemperatureC: reference.value,
    currentReferenceSource: reference.source,
    currentWeatherTimestamp: reference.weatherTimestamp,
    currentModelTimestamp: insight.selectedTimestamp,
    targetModelTimestamp: distribution.selectedTimestamp,
    sourceSummaryZh: report.textZh,
    hourlyPageUrl: hourly.pageUrl,
    multimodelPageUrl: distribution.pageUrl,
    fetchedAt: new Date().toISOString(),
    stale: hourly.stale || report.stale || distribution.stale || insight.stale,
    participatingModelCount: signalBundle.usableSignals.length,
    excludedModels: signalBundle.exposedSignals
      .filter((signal) => !signal.included)
      .map((signal) => ({
        modelName: signal.modelName,
        reason: signal.exclusionReason ?? "未纳入本轮计算",
      })),
  };

  return {
    location: {
      id: location.id,
      name: location.name,
      timezone: location.timezone,
    },
    targetDate,
    availableTargetDates,
    generatedAt: new Date().toISOString(),
    bankroll,
    riskMode,
    riskMultiplier: RISK_PROFILE[riskMode].multiplier,
    minEdge,
    weatherEvidence,
    distributionSummary,
    probabilityCurve: curve,
    bucketProbabilities: baseBuckets,
    markets: pricedMarkets,
    recommendations,
    sourceLinks,
    sourceStatus: buildSourceStatuses({
      weatherStale: weatherEvidence.stale,
      marketFetchedAt: discoveryFetchedAt,
      priceFetchedAt,
      warnings,
    }),
    warnings,
  };
};

export const buildStreamMarketPatches = (markets: KellyMarketRow[]): KellyStreamMarketPatch[] =>
  markets
    .filter((market) => market.parseStatus === "matched")
    .map((market) => ({
      marketId: market.marketId,
      yesPrice: market.yesPrice,
      noPrice: market.noPrice,
      yesBestBid: market.yesBestBid,
      yesBestAsk: market.yesBestAsk,
      noBestBid: market.noBestBid,
      noBestAsk: market.noBestAsk,
      spreadPct: market.spreadPct,
      edgeYes: market.edgeYes,
      edgeNo: market.edgeNo,
      kellyYes: market.kellyYes,
      kellyNo: market.kellyNo,
      recommendedSide: market.recommendedSide,
      suggestedStake: market.suggestedStake,
      updatedAt: market.updatedAt,
    }));
