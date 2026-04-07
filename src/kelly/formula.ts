import type {
  KellyBucketProbability,
  KellyContractType,
  KellyDistributionSummary,
  KellyEntrySource,
  KellyInactiveReason,
  KellyMarketRow,
  KellyMarketLifecycle,
  KellyProbabilityCurvePoint,
  KellyRecommendation,
  KellyRiskMode,
  KellyTemperatureUnit,
} from "../domain/weather.js";
import { clamp, clamp01, mean, median, normalCdf, normalPdf, round2, round4, standardDeviation } from "./math.js";

export interface KellyModelSignal {
  modelName: string;
  currentPredictionC: number;
  biasNowC: number;
  targetPeakC: number;
}

export interface KellyMarketInput {
  marketId: string;
  slug: string | null;
  title: string;
  marketUrl: string | null;
  conditionId: string | null;
  liquidity: number | null;
  volume24h: number | null;
  contractType: KellyContractType;
  unit: KellyTemperatureUnit;
  bucketStartC: number | null;
  bucketEndC: number | null;
  bucketLabel: string;
  lifecycle?: KellyMarketLifecycle;
  inactiveReason?: KellyInactiveReason | null;
  parseStatus: "matched" | "unresolved";
  exclusionReason: string | null;
  yesTokenId: string | null;
  noTokenId: string | null;
  entrySourceYes?: KellyEntrySource;
  entrySourceNo?: KellyEntrySource;
  yesPrice: number | null;
  noPrice: number | null;
  yesBestBid: number | null;
  yesBestAsk: number | null;
  noBestBid: number | null;
  noBestAsk: number | null;
  spreadPct: number | null;
  updatedAt: string | null;
}

export interface KellyAnalyticsResult {
  distributionSummary: KellyDistributionSummary;
  probabilityCurve: KellyProbabilityCurvePoint[];
  bucketProbabilities: KellyBucketProbability[];
  markets: KellyMarketRow[];
  recommendations: KellyRecommendation[];
}

interface WeightedSignal extends KellyModelSignal {
  peakAdjustedC: number;
  sigmaC: number;
  weight: number;
}

const GRID_STEP_C = 0.1;

export const KELLY_RISK_MULTIPLIER: Record<KellyRiskMode, number> = {
  conservative: 0.25,
  balanced: 0.5,
  aggressive: 0.75,
};

const KELLY_POSITION_CAP: Record<KellyRiskMode, number> = {
  conservative: 0.05,
  balanced: 0.1,
  aggressive: 0.15,
};

const safeEntryPrice = (bestAsk: number | null, midpoint: number | null): number | null => {
  if (typeof bestAsk === "number" && Number.isFinite(bestAsk) && bestAsk > 0 && bestAsk < 1) {
    return bestAsk;
  }

  if (typeof midpoint === "number" && Number.isFinite(midpoint) && midpoint > 0 && midpoint < 1) {
    return midpoint;
  }

  return null;
};

const resolveEntrySource = (bestAsk: number | null, midpoint: number | null): KellyEntrySource => {
  if (typeof bestAsk === "number" && Number.isFinite(bestAsk) && bestAsk > 0 && bestAsk < 1) {
    return "best-ask";
  }

  if (typeof midpoint === "number" && Number.isFinite(midpoint) && midpoint > 0 && midpoint < 1) {
    return "midpoint";
  }

  return "unavailable";
};

const computeKellyFraction = (fairSide: number, entryPrice: number | null): number => {
  if (entryPrice === null || !Number.isFinite(entryPrice) || entryPrice <= 0 || entryPrice >= 1) {
    return 0;
  }

  return Math.max(0, (fairSide - entryPrice) / (1 - entryPrice));
};

const computeMostLikelyRangeLabel = (modeTemperatureC: number): string => {
  const lower = Math.floor(modeTemperatureC);
  const upper = lower + 1;
  return `${lower} - ${upper} °C`;
};

const buildWeightedSignals = (
  signals: KellyModelSignal[],
  totalModelCount: number,
  weatherStale: boolean,
): {
  signals: WeightedSignal[];
  shrink: number;
  peakSpreadC: number;
} => {
  if (signals.length === 0) {
    return {
      signals: [],
      shrink: weatherStale ? 0.58 : 0.62,
      peakSpreadC: 0,
    };
  }

  const targetPeaks = signals.map((signal) => signal.targetPeakC);
  const peakMedian = median(targetPeaks);
  const peakStd = standardDeviation(targetPeaks);
  const biasDispersion = standardDeviation(signals.map((signal) => Math.abs(signal.biasNowC)));
  const sortedByBias = [...signals]
    .map((signal, index) => ({ signal, index }))
    .sort(
      (left, right) =>
        Math.abs(left.signal.biasNowC) - Math.abs(right.signal.biasNowC) ||
        left.signal.modelName.localeCompare(right.signal.modelName),
    );
  const rankMultiplierMap = new Map<string, number>();
  const worstQuartileStart = Math.floor(signals.length * 0.75);

  for (let index = 0; index < sortedByBias.length; index += 1) {
    const modelName = sortedByBias[index]?.signal.modelName;
    if (!modelName) {
      continue;
    }

    let multiplier = 1;
    if (index === 0) {
      multiplier = 1.25;
    } else if (index === 1) {
      multiplier = 1.15;
    } else if (index === 2) {
      multiplier = 1.08;
    } else if (index >= worstQuartileStart) {
      multiplier = 0.85;
    }

    rankMultiplierMap.set(modelName, multiplier);
  }

  const rawSignals = signals.map((signal) => {
    const fitWeight = Math.exp(-Math.abs(signal.biasNowC) / 2.5);
    const consensusScale = Math.max(1.5, peakStd * 1.5);
    const consensusWeight = 1 / (1 + Math.abs(signal.targetPeakC - peakMedian) / consensusScale);
    const rankWeight = rankMultiplierMap.get(signal.modelName) ?? 1;
    const sigmaC = 0.9 + 0.35 * Math.abs(signal.biasNowC) + 0.12 * peakStd;
    const peakAdjustedC = signal.targetPeakC - 0.65 * signal.biasNowC;

    return {
      ...signal,
      peakAdjustedC,
      sigmaC,
      weight: fitWeight * consensusWeight * rankWeight,
    } satisfies WeightedSignal;
  });

  const weightTotal = rawSignals.reduce((sum, signal) => sum + signal.weight, 0);
  const weightedSignals = rawSignals.map((signal) => ({
    ...signal,
    weight: signal.weight / Math.max(weightTotal, 1e-9),
  }));

  const missingRatio = clamp(1 - signals.length / Math.max(totalModelCount, signals.length, 1), 0, 1);
  const disagreement = clamp(peakStd / 4, 0, 1);
  const biasNoise = clamp(biasDispersion / 3, 0, 1);
  const stalePenalty = weatherStale ? 0.1 : 0;
  const shrink = clamp(0.92 - 0.18 * disagreement - 0.1 * biasNoise - 0.08 * missingRatio - stalePenalty, 0.58, 0.92);

  return {
    signals: weightedSignals,
    shrink,
    peakSpreadC: round2(peakStd),
  };
};

const buildProbabilityCurve = (
  signals: WeightedSignal[],
): {
  curve: KellyProbabilityCurvePoint[];
  summary: KellyDistributionSummary;
} => {
  if (signals.length === 0) {
    return {
      curve: [],
      summary: {
        meanTemperatureC: 0,
        medianTemperatureC: 0,
        modeTemperatureC: 0,
        mostLikelyRangeLabel: "--",
        shrink: 0.58,
        usableModelCount: 0,
        totalModelCount: 0,
        peakSpreadC: 0,
      },
    };
  }

  const minTemperatureC = Math.floor(
    Math.min(...signals.map((signal) => signal.peakAdjustedC - signal.sigmaC * 4)) / GRID_STEP_C,
  ) * GRID_STEP_C;
  const maxTemperatureC = Math.ceil(
    Math.max(...signals.map((signal) => signal.peakAdjustedC + signal.sigmaC * 4)) / GRID_STEP_C,
  ) * GRID_STEP_C;

  const rawCurve: Array<{ temperatureC: number; density: number }> = [];

  for (let temperatureC = minTemperatureC; temperatureC <= maxTemperatureC + 1e-9; temperatureC += GRID_STEP_C) {
    const density = signals.reduce(
      (sum, signal) => sum + signal.weight * normalPdf(temperatureC, signal.peakAdjustedC, signal.sigmaC),
      0,
    );
    rawCurve.push({
      temperatureC: round2(temperatureC),
      density,
    });
  }

  const densityArea =
    rawCurve.reduce((sum, point) => sum + point.density * GRID_STEP_C, 0) || 1;
  let cumulative = 0;
  let medianTemperatureC = rawCurve[0]?.temperatureC ?? 0;
  let modeTemperatureC = rawCurve[0]?.temperatureC ?? 0;
  let modeDensity = Number.NEGATIVE_INFINITY;
  const curve = rawCurve.map((point) => {
    const density = point.density / densityArea;
    cumulative = clamp01(cumulative + density * GRID_STEP_C);

    if (cumulative >= 0.5 && medianTemperatureC === (rawCurve[0]?.temperatureC ?? 0)) {
      medianTemperatureC = point.temperatureC;
    }

    if (density > modeDensity) {
      modeDensity = density;
      modeTemperatureC = point.temperatureC;
    }

    return {
      temperatureC: point.temperatureC,
      density: round4(density),
      cumulative: round4(cumulative),
    };
  });

  const meanTemperatureC = round2(
    signals.reduce((sum, signal) => sum + signal.weight * signal.peakAdjustedC, 0),
  );

  return {
    curve,
    summary: {
      meanTemperatureC,
      medianTemperatureC: round2(medianTemperatureC),
      modeTemperatureC: round2(modeTemperatureC),
      mostLikelyRangeLabel: computeMostLikelyRangeLabel(modeTemperatureC),
      shrink: 0.58,
      usableModelCount: signals.length,
      totalModelCount: signals.length,
      peakSpreadC: round2(
        Math.max(...signals.map((signal) => signal.peakAdjustedC)) -
          Math.min(...signals.map((signal) => signal.peakAdjustedC)),
      ),
    },
  };
};

const probabilityForContract = (
  signals: WeightedSignal[],
  contractType: KellyContractType,
  bucketStartC: number | null,
  bucketEndC: number | null,
  shrink: number,
): number => {
  if (signals.length === 0) {
    return 0.5;
  }

  const rawProbability = clamp01(
    signals.reduce((sum, signal) => {
      if (contractType === "range" || contractType === "exact") {
        if (bucketStartC === null || bucketEndC === null) {
          return sum;
        }
        return (
          sum +
          signal.weight *
            (normalCdf(bucketEndC, signal.peakAdjustedC, signal.sigmaC) -
              normalCdf(bucketStartC, signal.peakAdjustedC, signal.sigmaC))
        );
      }

      if (contractType === "atLeast") {
        if (bucketStartC === null) {
          return sum;
        }
        return sum + signal.weight * (1 - normalCdf(bucketStartC, signal.peakAdjustedC, signal.sigmaC));
      }

      if (bucketEndC === null) {
        return sum;
      }

      return sum + signal.weight * normalCdf(bucketEndC, signal.peakAdjustedC, signal.sigmaC);
    }, 0),
  );

  return clamp01(0.5 + shrink * (rawProbability - 0.5));
};

export const buildKellyAnalytics = ({
  modelSignals,
  totalModelCount,
  weatherStale,
  markets,
  bankroll,
  riskMode,
  minEdge,
}: {
  modelSignals: KellyModelSignal[];
  totalModelCount: number;
  weatherStale: boolean;
  markets: KellyMarketInput[];
  bankroll: number;
  riskMode: KellyRiskMode;
  minEdge: number;
}): KellyAnalyticsResult => {
  const { signals, shrink, peakSpreadC } = buildWeightedSignals(modelSignals, totalModelCount, weatherStale);
  const curveBuilt = buildProbabilityCurve(signals);
  const riskMultiplier = KELLY_RISK_MULTIPLIER[riskMode];
  const positionCap = KELLY_POSITION_CAP[riskMode];

  const bucketProbabilities: KellyBucketProbability[] = markets
    .filter((market) => market.parseStatus === "matched")
    .map((market) => {
      const probabilityYes = probabilityForContract(
        signals,
        market.contractType,
        market.bucketStartC,
        market.bucketEndC,
        shrink,
      );

      return {
        marketId: market.marketId,
        label: market.bucketLabel,
        contractType: market.contractType,
        bucketStartC: market.bucketStartC,
        bucketEndC: market.bucketEndC,
        probabilityYes: round4(probabilityYes),
        probabilityNo: round4(1 - probabilityYes),
      };
    });

  const probabilityByMarketId = new Map(bucketProbabilities.map((entry) => [entry.marketId, entry]));

  const marketRows: KellyMarketRow[] = markets.map((market) => {
    const probabilities = probabilityByMarketId.get(market.marketId);
    const fairYes = probabilities?.probabilityYes ?? 0.5;
    const fairNo = probabilities?.probabilityNo ?? 0.5;
    const entryYesPrice = safeEntryPrice(market.yesBestAsk, market.yesPrice);
    const entryNoPrice = safeEntryPrice(market.noBestAsk, market.noPrice);
    const edgeYes = round4(entryYesPrice === null ? 0 : fairYes - entryYesPrice);
    const edgeNo = round4(entryNoPrice === null ? 0 : fairNo - entryNoPrice);
    const kellyYesBase = computeKellyFraction(fairYes, entryYesPrice);
    const kellyNoBase = computeKellyFraction(fairNo, entryNoPrice);
    const kellyYes = round4(Math.min(positionCap, kellyYesBase * riskMultiplier));
    const kellyNo = round4(Math.min(positionCap, kellyNoBase * riskMultiplier));
    let recommendedSide: KellyMarketRow["recommendedSide"] = "none";
    let suggestedStake = 0;

    if (market.parseStatus === "matched") {
      if (edgeYes >= minEdge && kellyYes >= kellyNo && kellyYes > 0) {
        recommendedSide = "yes";
        suggestedStake = round2(bankroll * kellyYes);
      } else if (edgeNo >= minEdge && kellyNo > 0) {
        recommendedSide = "no";
        suggestedStake = round2(bankroll * kellyNo);
      }
    }

    return {
      ...market,
      lifecycle: market.lifecycle ?? "tradable",
      inactiveReason: market.inactiveReason ?? null,
      entrySourceYes: market.entrySourceYes ?? resolveEntrySource(market.yesBestAsk, market.yesPrice),
      entrySourceNo: market.entrySourceNo ?? resolveEntrySource(market.noBestAsk, market.noPrice),
      rawProbabilityYes: round4(fairYes),
      rawProbabilityNo: round4(fairNo),
      fairYes: round4(fairYes),
      fairNo: round4(fairNo),
      edgeYes,
      edgeNo,
      kellyYes,
      kellyNo,
      recommendedSide,
      suggestedStake,
    };
  });

  const recommendations = marketRows
    .filter((market) => market.recommendedSide !== "none")
    .sort(
      (left, right) =>
        right.suggestedStake - left.suggestedStake ||
        Math.max(right.edgeYes, right.edgeNo) - Math.max(left.edgeYes, left.edgeNo) ||
        (left.spreadPct ?? Number.POSITIVE_INFINITY) - (right.spreadPct ?? Number.POSITIVE_INFINITY),
    )
    .slice(0, 2)
    .map((market, index) => {
      const side = market.recommendedSide === "yes" ? "yes" : "no";
      const fairPrice = side === "yes" ? market.fairYes : market.fairNo;
      const marketPrice =
        side === "yes"
          ? safeEntryPrice(market.yesBestAsk, market.yesPrice) ?? 0
          : safeEntryPrice(market.noBestAsk, market.noPrice) ?? 0;
      const edge = side === "yes" ? market.edgeYes : market.edgeNo;
      const kellyFraction = side === "yes" ? market.kellyYes : market.kellyNo;

      return {
        slot: index === 0 ? "primary" : "secondary",
        marketId: market.marketId,
        title: market.title,
        marketUrl: market.marketUrl,
        side,
        edge,
        fairPrice,
        marketPrice: round4(marketPrice),
        kellyFraction,
        suggestedStake: market.suggestedStake,
        reason:
          market.spreadPct !== null && market.spreadPct > 0.08
            ? "盘口可做，但价差较宽，已自动降权。"
            : "当前 edge 与风险调整后 Kelly 排名靠前。",
      } satisfies KellyRecommendation;
    });

  return {
    distributionSummary: {
      ...curveBuilt.summary,
      shrink: round4(shrink),
      usableModelCount: signals.length,
      totalModelCount,
      peakSpreadC,
    },
    probabilityCurve: curveBuilt.curve,
    bucketProbabilities,
    markets: marketRows,
    recommendations,
  };
};
