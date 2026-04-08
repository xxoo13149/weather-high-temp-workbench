import type { RegisteredLocation } from "../config.js";
import type {
  HourlyWeatherResponse,
  KellyBucketProbability,
  KellyDistributionSummary,
  KellyEntrySource,
  KellyFramePoint,
  KellyFreshness,
  KellyInactiveReason,
  KellyMarketEvidence,
  KellyMarketLifecycle,
  KellyMarketMotionState,
  KellyMarketRow,
  KellyMethodology,
  KellyShrinkMode,
  KellyMethodologyModel,
  MetarObservation,
  KellyProbabilityCurvePoint,
  KellyRecommendation,
  KellyRequestOptions,
  KellyRiskMode,
  KellySourceLinks,
  KellySourceStatus,
  KellyStreamHealth,
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
  weightBreakdown: {
    biasWeight: number;
    consensusWeight: number;
    rankWeight: number;
    normalizedWeight: number;
  };
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
  status?: "available" | "no-orderbook";
};

type KellyShrinkResult = {
  value: number;
  inputs: KellyMethodology["shrinkInputs"];
};

type KellyContractProbability = {
  rawYes: number;
  fairYes: number;
  rawNo: number;
  fairNo: number;
};

type KellyMethodologyProbabilityStepsShape = KellyMethodology["probabilitySteps"];
type KellyMethodologyWeightBreakdownShape = KellyMethodology["weightBreakdown"];
type KellyProbabilityStepShape = NonNullable<KellyMethodology["probabilitySteps"]["details"]>[number];
type KellyDecoratedProbabilitySteps = KellyProbabilityStepShape[] &
  KellyMethodologyProbabilityStepsShape & {
    details: KellyProbabilityStepShape[];
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

const SHRINK_INPUT_FACTORS = {
  disagreementFactor: 0.08,
  biasDispersionFactor: 0.06,
  missingRatioFactor: 0.22,
  clampFloor: 0.58,
  clampCeiling: 0.92,
} as const;

const isActionableEntryPrice = (value: number | null | undefined): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value > 0 &&
  value < 1;

const resolveEntrySource = (book: InternalOrderBook | undefined): KellyEntrySource => {
  if (isActionableEntryPrice(book?.bestAsk)) {
    return "best-ask";
  }

  return "unavailable";
};

const resolveDisplayUnit = (markets: KellyMarketRow[]): KellyTemperatureUnit => {
  const counts: Record<KellyTemperatureUnit, number> = { C: 0, F: 0 };
  for (const market of markets) {
    counts[market.unit] = (counts[market.unit] ?? 0) + 1;
  }
  return counts.F > counts.C ? "F" : "C";
};

const resolveMarketLifecycle = ({
  market,
  yesBook,
  noBook,
}: {
  market: KellyMarketRow;
  yesBook: InternalOrderBook | undefined;
  noBook: InternalOrderBook | undefined;
}): {
  lifecycle: KellyMarketLifecycle;
  inactiveReason: KellyInactiveReason | null;
} => {
  if (market.parseStatus === "unresolved") {
    return {
      lifecycle: "unresolved",
      inactiveReason: market.inactiveReason ?? "missing_tokens",
    };
  }

  if (market.observationFloorBlocked) {
    return {
      lifecycle: "inactive",
      inactiveReason: "observation_floor",
    };
  }

  if (market.lifecycle === "inactive" && market.inactiveReason) {
    return {
      lifecycle: "inactive",
      inactiveReason: market.inactiveReason,
    };
  }

  const noOrderbook =
    (market.yesTokenId ? yesBook?.status === "no-orderbook" : false) ||
    (market.noTokenId ? noBook?.status === "no-orderbook" : false);
  if (noOrderbook) {
    return {
      lifecycle: "inactive",
      inactiveReason: "no_orderbook",
    };
  }

  const hasExecutableYes = resolveEntrySource(yesBook) !== "unavailable";
  const hasExecutableNo = resolveEntrySource(noBook) !== "unavailable";
  if (!hasExecutableYes && !hasExecutableNo) {
    return {
      lifecycle: "inactive",
      inactiveReason: "no_executable_prices",
    };
  }

  return {
    lifecycle: "tradable",
    inactiveReason: null,
  };
};

const hasExecutableEntry = (market: KellyMarketRow): boolean =>
  market.entrySourceYes !== "unavailable" || market.entrySourceNo !== "unavailable";

const buildFreshness = ({
  weatherGeneratedAt,
  discoveryFetchedAt,
  priceFetchedAt,
  frameSeries,
  repricedAt,
}: {
  weatherGeneratedAt: string | null;
  discoveryFetchedAt: string | null;
  priceFetchedAt: string | null;
  frameSeries: KellyFramePoint[];
  repricedAt: string | null;
}): KellyFreshness => {
  const lastFrame = frameSeries[frameSeries.length - 1];
  const lastStreamEventAt = lastFrame?.generatedAt ?? null;
  const frameAgeMs =
    lastStreamEventAt === null ? Number.POSITIVE_INFINITY : Date.now() - new Date(lastStreamEventAt).getTime();
  const motionState: KellyMarketMotionState =
    lastStreamEventAt === null
      ? priceFetchedAt
        ? "still"
        : "unavailable"
      : frameAgeMs <= 60_000
        ? "live"
        : frameAgeMs <= 180_000
          ? "still"
          : "polling-fallback";

  return {
    weatherGeneratedAt,
    marketDiscoveredAt: discoveryFetchedAt,
    orderbookFetchedAt: priceFetchedAt,
    repricedAt,
    lastStreamEventAt,
    marketMotionState: motionState,
  };
};

const INITIAL_STREAM_HEALTH: KellyStreamHealth = {
  state: "unavailable",
  reasonCode: "awaiting_client_subscription",
  message: "等待前端建立 Kelly 实时盘口订阅。",
  lastSignalAt: null,
  lastRepricedAt: null,
};

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

const DAY_MS = 86_400_000;

const parseIsoDateKey = (value: string): number | null => {
  const [year, month, day] = value.split("-").map((entry) => Number(entry));
  if ([year, month, day].some((entry) => !Number.isFinite(entry))) {
    return null;
  }
  return Date.UTC(year, month - 1, day);
};

const resolveAvailableTargetDates = (timestamps: string[], timeZone: string): string[] => {
  const today = resolveKellyTargetDate(timeZone);
  const todayKey = parseIsoDateKey(today);
  if (todayKey === null) {
    return [today];
  }

  const allowedRangeStart = todayKey;
  const allowedRangeEnd = todayKey + DAY_MS * 2;

  const candidates = unique(
    timestamps
      .map((timestamp) => parseTargetDateFromTimestamp(timestamp, timeZone))
      .filter((value): value is string => Boolean(value))
      .filter((value) => {
        const key = parseIsoDateKey(value);
        return key !== null && key >= allowedRangeStart && key <= allowedRangeEnd;
      }),
  );

  const merged = unique([...candidates, today]);
  return merged.sort();
};

const findHourlyItem = (hourly: HourlyWeatherResponse, timestamp: string | undefined) =>
  timestamp ? hourly.items.find((item) => item.timestamp === timestamp) ?? null : null;

type ObservedTemperatureCandidate<Source extends string> = {
  value: number;
  source: Source;
  observedAt: string | null;
  priority: number;
};

type KellyObservationFloor = {
  value: number | null;
  source: KellyWeatherEvidence["observationFloorSource"];
  observedAt: string | null;
};

type KellyObservationFloorContext = {
  targetDate?: string;
  timeZone?: string;
  now?: Date;
  rememberedFloor?: KellyObservationFloor | null;
};

const pickWarmestObservedCandidate = <Source extends string>(
  candidates: Array<ObservedTemperatureCandidate<Source>>,
): ObservedTemperatureCandidate<Source> | null => {
  if (candidates.length === 0) {
    return null;
  }

  return [...candidates].sort((left, right) => {
    if (right.value !== left.value) {
      return right.value - left.value;
    }

    return right.priority - left.priority;
  })[0] ?? null;
};

const resolveRealtimeObservedCandidate = (
  hourly: HourlyWeatherResponse,
  metarObservation: MetarObservation | null,
): ObservedTemperatureCandidate<"metar" | "hourly-current"> | null => {
  const candidates: Array<ObservedTemperatureCandidate<"metar" | "hourly-current">> = [];

  if (typeof hourly.current?.temperatureC === "number" && Number.isFinite(hourly.current.temperatureC)) {
    candidates.push({
      value: hourly.current.temperatureC,
      source: "hourly-current",
      observedAt: hourly.current.timestamp,
      priority: 2,
    });
  }

  if (typeof metarObservation?.temperatureC === "number" && Number.isFinite(metarObservation.temperatureC)) {
    candidates.push({
      value: metarObservation.temperatureC,
      source: "metar",
      observedAt: metarObservation.observedAt,
      priority: 1,
    });
  }

  return pickWarmestObservedCandidate(candidates);
};

const resolveObservedHourlyHighCandidate = (
  hourly: HourlyWeatherResponse,
  targetDate: string,
  timeZone: string,
  now: Date,
): ObservedTemperatureCandidate<"hourly-observed"> | null => {
  const nowTime = now.getTime();
  if (!Number.isFinite(nowTime)) {
    return null;
  }

  const candidates = hourly.items
    .filter((item) => typeof item.temperatureC === "number" && Number.isFinite(item.temperatureC))
    .filter((item) => parseTargetDateFromTimestamp(item.timestamp, timeZone) === targetDate)
    .filter((item) => {
      const observedTime = new Date(item.timestamp).getTime();
      return Number.isFinite(observedTime) && observedTime <= nowTime;
    })
    .map(
      (item): ObservedTemperatureCandidate<"hourly-observed"> => ({
        value: item.temperatureC as number,
        source: "hourly-observed",
        observedAt: item.timestamp,
        priority: 1,
      }),
    );

  return pickWarmestObservedCandidate(candidates);
};

const resolveObservationAnchorTargetDate = (
  hourly: HourlyWeatherResponse,
  metarObservation: MetarObservation | null,
  timeZone: string,
  now: Date,
): string => {
  const anchorTimestamp = metarObservation?.observedAt ?? hourly.current?.timestamp;
  return (
    (anchorTimestamp ? parseTargetDateFromTimestamp(anchorTimestamp, timeZone) : null) ??
    parseTargetDateFromTimestamp(now.toISOString(), timeZone) ??
    resolveKellyTargetDate(timeZone)
  );
};

const resolveReferenceTemperature = (
  hourly: HourlyWeatherResponse,
  insight: MultiModelInsightResponse,
  metarObservation: MetarObservation | null,
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

  const realtimeObserved = resolveRealtimeObservedCandidate(hourly, metarObservation);
  if (realtimeObserved) {
    return {
      value: realtimeObserved.value,
      source: realtimeObserved.source,
      weatherTimestamp: realtimeObserved.observedAt,
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

export const resolveObservationFloor = (
  hourly: HourlyWeatherResponse,
  metarObservation: MetarObservation | null,
  options: KellyRequestOptions,
  context: KellyObservationFloorContext = {},
): KellyObservationFloor => {
  const timeZone = context.timeZone ?? hourly.location.timezone;
  const targetDate = context.targetDate ?? resolveKellyTargetDate(timeZone);
  const anchorNow = context.now ?? new Date();
  const isTodayTarget =
    targetDate === resolveObservationAnchorTargetDate(hourly, metarObservation, timeZone, anchorNow);

  if (!isTodayTarget) {
    return {
      value: null,
      source: "none",
      observedAt: null,
    };
  }

  const candidates: Array<ObservedTemperatureCandidate<KellyWeatherEvidence["observationFloorSource"]>> = [];

  if (typeof options.actualTemperatureC === "number" && Number.isFinite(options.actualTemperatureC)) {
    candidates.push({
      value: options.actualTemperatureC,
      source: "manual",
      observedAt: options.selectedHourTimestamp ?? hourly.current?.timestamp ?? null,
      priority: 3,
    });
  }

  const realtimeObserved = resolveRealtimeObservedCandidate(hourly, metarObservation);
  if (realtimeObserved) {
    candidates.push({
      value: realtimeObserved.value,
      source: realtimeObserved.source,
      observedAt: realtimeObserved.observedAt,
      priority: realtimeObserved.priority,
    });
  }

  const observedHourlyHigh = resolveObservedHourlyHighCandidate(
    hourly,
    targetDate,
    timeZone,
    anchorNow,
  );
  if (observedHourlyHigh) {
    candidates.push(observedHourlyHigh);
  }

  if (typeof context.rememberedFloor?.value === "number" && Number.isFinite(context.rememberedFloor.value)) {
    candidates.push({
      value: context.rememberedFloor.value,
      source: context.rememberedFloor.source,
      observedAt: context.rememberedFloor.observedAt,
      priority: 0,
    });
  }

  const bestObserved = pickWarmestObservedCandidate(candidates);
  if (bestObserved) {
    return {
      value: bestObserved.value,
      source: bestObserved.source,
      observedAt: bestObserved.observedAt,
    };
  }

  return {
    value: null,
    source: "none",
    observedAt: null,
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
        weightBreakdown: null,
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
      weightBreakdown: null,
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
    const rawWeight = biasWeight * consensusWeight * rankWeight;

    return {
      ...entry,
      adjustedPeakTemperatureC,
      sigmaC,
      rawWeight,
      weightBreakdown: {
        biasWeight: round4(biasWeight),
        consensusWeight: round4(consensusWeight),
        rankWeight: round4(rankWeight),
      },
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
    weightBreakdown: {
      ...entry.weightBreakdown,
      normalizedWeight: round4(entry.rawWeight / rawWeightSum),
    },
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
      weightBreakdown: usable.weightBreakdown,
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

const buildFloorFallbackCurve = (floorTemperatureC: number): KellyProbabilityCurvePoint[] => {
  const anchor = round2(Math.floor(floorTemperatureC * 10) / 10);
  const weights = [7, 2, 1];
  let cumulative = 0;

  return weights.map((weight, index) => {
    const density = weight;
    cumulative = clamp01(cumulative + density * GRID_STEP) ?? 0;
    return {
      temperatureC: round2(anchor + index * GRID_STEP),
      density: round4(density),
      cumulative: round4(cumulative),
    };
  });
};

const applyObservationFloorToCurve = (
  curve: KellyProbabilityCurvePoint[],
  floorTemperatureC: number | null,
): KellyProbabilityCurvePoint[] => {
  if (curve.length === 0 || typeof floorTemperatureC !== "number" || !Number.isFinite(floorTemperatureC)) {
    return curve;
  }

  const trimmed = curve.filter((point) => point.temperatureC + 1e-9 >= floorTemperatureC);
  const retainedMass = trimmed.reduce((sum, point) => sum + point.density * GRID_STEP, 0);
  if (retainedMass <= 1e-6) {
    return buildFloorFallbackCurve(floorTemperatureC);
  }

  let cumulative = 0;
  return trimmed.map((point) => {
    const normalizedDensity = point.density / retainedMass;
    cumulative = clamp01(cumulative + normalizedDensity * GRID_STEP) ?? 0;
    return {
      temperatureC: point.temperatureC,
      density: round4(normalizedDensity),
      cumulative: round4(cumulative),
    };
  });
};

const isCandidateBlockedByObservationFloor = (
  candidate: PolymarketCandidate,
  floorTemperatureC: number | null,
): boolean => {
  if (typeof floorTemperatureC !== "number" || !Number.isFinite(floorTemperatureC)) {
    return false;
  }

  const tolerance = 1e-9;
  if (candidate.contractType === "atMost" && candidate.bucketEndC !== null) {
    return candidate.bucketEndC < floorTemperatureC - tolerance;
  }

  if (candidate.contractType === "exact" && candidate.bucketStartC !== null) {
    return candidate.bucketStartC < floorTemperatureC - tolerance;
  }

  if (candidate.contractType === "range" && candidate.bucketEndC !== null) {
    return candidate.bucketEndC < floorTemperatureC - tolerance;
  }

  return false;
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
): KellyShrinkResult => {
  const disagreement = standardDeviation(signals.map((signal) => signal.adjustedPeakTemperatureC));
  const biasDispersion = standardDeviation(signals.map((signal) => signal.biasNowC));
  const missingRatio = clamp01((totalModelCount - signals.length) / Math.max(totalModelCount, 1)) ?? 0;
  const stalePenalty = weatherStale ? 0.08 : 0;

  if (signals.length === 0) {
    return {
      value: SHRINK_INPUT_FACTORS.clampFloor,
      inputs: {
        disagreement: 0,
        biasDispersion: 0,
        missingRatio: 1,
        stalePenalty,
        disagreementFactor: SHRINK_INPUT_FACTORS.disagreementFactor,
        biasDispersionFactor: SHRINK_INPUT_FACTORS.biasDispersionFactor,
        missingRatioFactor: SHRINK_INPUT_FACTORS.missingRatioFactor,
        clampFloor: SHRINK_INPUT_FACTORS.clampFloor,
        clampCeiling: SHRINK_INPUT_FACTORS.clampCeiling,
        rawShrink: SHRINK_INPUT_FACTORS.clampFloor,
      },
    };
  }

  const rawShrink =
    1 -
    disagreement * SHRINK_INPUT_FACTORS.disagreementFactor -
    biasDispersion * SHRINK_INPUT_FACTORS.biasDispersionFactor -
    missingRatio * SHRINK_INPUT_FACTORS.missingRatioFactor -
    stalePenalty;
  const value = clamp(rawShrink, SHRINK_INPUT_FACTORS.clampFloor, SHRINK_INPUT_FACTORS.clampCeiling);

  return {
    value,
    inputs: {
      disagreement: round4(disagreement),
      biasDispersion: round4(biasDispersion),
      missingRatio: round4(missingRatio),
      stalePenalty: round4(stalePenalty),
      disagreementFactor: SHRINK_INPUT_FACTORS.disagreementFactor,
      biasDispersionFactor: SHRINK_INPUT_FACTORS.biasDispersionFactor,
      missingRatioFactor: SHRINK_INPUT_FACTORS.missingRatioFactor,
      clampFloor: SHRINK_INPUT_FACTORS.clampFloor,
      clampCeiling: SHRINK_INPUT_FACTORS.clampCeiling,
      rawShrink: round4(rawShrink),
    },
  };
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
  observationFloorC: number | null = null,
): KellyContractProbability => {
  if (typeof observationFloorC === "number" && Number.isFinite(observationFloorC)) {
    const floor = observationFloorC;

    if (contractType === "atLeast" && startC !== null && startC <= floor) {
      return {
        rawYes: 1,
        fairYes: 1,
        rawNo: 0,
        fairNo: 0,
      };
    }

    const impossibleOnYes =
      (contractType === "atMost" && endC !== null && endC < floor) ||
      (contractType === "exact" && startC !== null && startC < floor) ||
      (contractType === "range" && endC !== null && endC < floor);

    if (impossibleOnYes) {
      return {
        rawYes: 0,
        fairYes: 0,
        rawNo: 1,
        fairNo: 1,
      };
    }
  }

  const raw =
    contractType === "atLeast"
      ? integrateProbability(curve, startC, null)
      : contractType === "atMost"
        ? integrateProbability(curve, null, endC)
        : contractType === "exact" && startC !== null
          ? integrateProbability(curve, startC - 0.5, startC + 0.5)
          : integrateProbability(curve, startC, endC);

  const fairYes = round4(applyShrink(raw, shrink));
  return {
    rawYes: round4(raw),
    fairYes,
    rawNo: round4(1 - raw),
    fairNo: round4(1 - fairYes),
  };
};

const computeKellyFraction = (fairPrice: number, entryPrice: number): number => {
  if (!Number.isFinite(fairPrice) || !Number.isFinite(entryPrice) || entryPrice <= 0 || entryPrice >= 1) {
    return 0;
  }

  return Math.max(0, (fairPrice - entryPrice) / (1 - entryPrice));
};

const buildRecommendationReasonText = (market: KellyMarketRow, riskMode: KellyRiskMode): string => {
  const profile = RISK_PROFILE[riskMode];
  if (market.recommendedSide === "none") {
    return "未达到最小 edge 或盘口质量不足，当前仅建议观察。";
  }

  return `${profile.label}模式下，已结合当前 edge、盘口价差和流动性给出仓位建议。`;
};

const buildRecommendationReason = (market: KellyMarketRow, riskMode: KellyRiskMode): string => {
  const profile = RISK_PROFILE[riskMode];
  if (market.recommendedSide === "none") {
    return "未达到最小 edge 或盘口质量不足。";
  }

  return `${profile.label}模式，结合当前 edge、盘口价差与流动性后给出仓位建议。`;
};

const KELLY_FORMULA_VERSION = "model-current-bias-v1";
const KELLY_SHRINK_MODE: KellyShrinkMode = "heuristic";

const KELLY_METHODOLOGY_SUMMARIES: KellyMethodology["summaries"] = {
  referenceRule: "T_ref 优先使用手动输入，其次取当前小时真实值，再回退到当前选中小时或模型均值。",
  adjustmentRule: "每个模型先计算 biasNow，再按 adjustedPeak = dayPeak - 0.65 * biasNow 修正日高温中心。",
  weightRule: "模型权重由当前偏差、共识稳定度和当前表现排名共同决定，再归一化。",
  shrinkRule: "原始概率由高斯混合分布积分得到，再通过 shrink 抑制过度自信。",
  pricingRule: "edge = fair price - entry price；Kelly = max(0, (fair - entry) / (1 - entry)) × 风险倍率。",
  observationRule: "观察位优先选择未进入执行建议的已解析市场；若全场都未过阈值，则选择 edge 最接近执行线的一档。",
};

const KELLY_FORMULA_NOTES = [
  KELLY_METHODOLOGY_SUMMARIES.referenceRule,
  "每个模型都会暴露 biasNow、adjustedPeak、sigma 和 weight，便于前端直接解释本轮结果。",
  KELLY_METHODOLOGY_SUMMARIES.weightRule,
  KELLY_METHODOLOGY_SUMMARIES.shrinkRule,
  KELLY_METHODOLOGY_SUMMARIES.pricingRule,
  KELLY_METHODOLOGY_SUMMARIES.observationRule,
  "Observed floor rule: if realtime temperature has already reached X, any contract fully below X is forced out on the Yes side.",
];


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
    const yesBestAsk = yesBook?.bestAsk ?? null;
    const noBestAsk = noBook?.bestAsk ?? null;
    const yesBestBid = yesBook?.bestBid ?? null;
    const noBestBid = noBook?.bestBid ?? null;
    const entryYesPrice = isActionableEntryPrice(yesBestAsk) ? yesBestAsk : null;
    const entryNoPrice = isActionableEntryPrice(noBestAsk) ? noBestAsk : null;
    const yesPrice = entryYesPrice;
    const noPrice = entryNoPrice;
    const entrySourceYes = resolveEntrySource(yesBook);
    const entrySourceNo = resolveEntrySource(noBook);
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

    const lifecycleInfo = resolveMarketLifecycle({ market, yesBook, noBook });

    return {
      ...market,
      lifecycle: lifecycleInfo.lifecycle,
      inactiveReason: lifecycleInfo.inactiveReason,
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
      entrySourceYes,
      entrySourceNo,
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
        reason: buildRecommendationReasonText(market, riskMode),
      };
    });

const rankObservationMarkets = (markets: KellyMarketRow[]): KellyMarketRow[] => {
  const executableMarketIds = new Set(
    markets
      .filter((market) => market.parseStatus === "matched" && market.recommendedSide !== "none" && market.suggestedStake > 0)
      .map((market) => market.marketId),
  );

  const preferredWatchMarkets = markets.filter(
    (market) => market.parseStatus === "matched" && !executableMarketIds.has(market.marketId),
  );

  const candidatePool = preferredWatchMarkets.length > 0 ? preferredWatchMarkets : executableMarketIds.size === 0
    ? markets.filter((market) => market.parseStatus === "matched")
    : [];

  return [...candidatePool]
    .sort((left, right) => {
      const leftEdge = Math.max(left.edgeYes, left.edgeNo);
      const rightEdge = Math.max(right.edgeYes, right.edgeNo);
      return rightEdge - leftEdge || (left.spreadPct ?? 999) - (right.spreadPct ?? 999);
    });
};

const toObservationRecommendation = (
  market: KellyMarketRow,
  reason: string,
): KellyRecommendation => {
  const side = market.edgeYes >= market.edgeNo ? "yes" : "no";
  const marketPrice =
    side === "yes" ? (market.yesBestAsk ?? market.yesPrice ?? 0) : (market.noBestAsk ?? market.noPrice ?? 0);
  const fairPrice = side === "yes" ? market.fairYes : market.fairNo;
  const kellyFraction = side === "yes" ? market.kellyYes : market.kellyNo;
  const edge = side === "yes" ? market.edgeYes : market.edgeNo;

  return {
    slot: "observation",
    marketId: market.marketId,
    title: market.title,
    marketUrl: market.marketUrl,
    side,
    edge,
    fairPrice,
    marketPrice,
    kellyFraction,
    suggestedStake: 0,
    reason,
  };
};

export const buildObservation = (markets: KellyMarketRow[]): KellyRecommendation | null => {
  const best = rankObservationMarkets(markets)[0];
  if (!best) {
    return null;
  }

  return toObservationRecommendation(best, "当前最佳档位仍未达到执行阈值，仅作为观察位保留。");
};

export const buildKellyMarkets = (
  candidates: PolymarketCandidate[],
  curve: KellyProbabilityCurvePoint[],
  shrink: number,
  observationFloorC: number | null,
): KellyMarketRow[] =>
  candidates.map((candidate) => {
    const probability =
      candidate.parseStatus === "matched"
        ? computeContractProbability(
            curve,
            candidate.contractType,
            candidate.bucketStartC,
            candidate.bucketEndC,
            shrink,
            observationFloorC,
          )
        : {
            rawYes: 0.5,
            fairYes: 0.5,
            rawNo: 0.5,
            fairNo: 0.5,
          };
    const blockedByObservationFloor = isCandidateBlockedByObservationFloor(candidate, observationFloorC);
    const mappedLifecycle = blockedByObservationFloor ? "inactive" : candidate.lifecycle;
    const mappedInactiveReason = blockedByObservationFloor ? "observation_floor" : candidate.inactiveReason;

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
      lifecycle: mappedLifecycle,
      inactiveReason: mappedInactiveReason,
      observationFloorBlocked: blockedByObservationFloor,
      entrySourceYes: "unavailable",
      entrySourceNo: "unavailable",
      yesPrice: null,
      noPrice: null,
      yesBestBid: null,
      yesBestAsk: null,
      noBestBid: null,
      noBestAsk: null,
      spreadPct: null,
      rawProbabilityYes: probability.rawYes,
      rawProbabilityNo: probability.rawNo,
      fairYes: probability.fairYes,
      fairNo: probability.fairNo,
      edgeYes: 0,
      edgeNo: 0,
      kellyYes: 0,
      kellyNo: 0,
      recommendedSide: "none",
      suggestedStake: 0,
      updatedAt: candidate.updatedAt,
    };
  });

const toMethodologyModels = (
  exposedSignals: Array<{
    modelName: string;
    modelCode: string | null;
    currentPredictionC: number | null;
    dayPeakTemperatureC: number | null;
    biasNowC: number | null;
    adjustedPeakTemperatureC: number | null;
    sigmaC: number | null;
    weight: number | null;
    weightBreakdown:
      | {
          biasWeight: number;
          consensusWeight: number;
          rankWeight: number;
          normalizedWeight: number;
        }
      | null;
    included: boolean;
    exclusionReason: string | null;
  }>,
): KellyMethodologyModel[] =>
  exposedSignals.map((signal) => ({
    modelName: signal.modelName,
    modelCode: signal.modelCode,
    currentPredictionC: signal.currentPredictionC,
    dayPeakTemperatureC: signal.dayPeakTemperatureC,
    biasNowC: signal.biasNowC,
    adjustedPeakTemperatureC: signal.adjustedPeakTemperatureC,
    sigmaC: signal.sigmaC,
    weight: signal.weight,
    weightBreakdown: signal.weightBreakdown,
    included: signal.included,
    exclusionReason: signal.exclusionReason,
  }));

export const buildKellyMethodology = ({
  generatedAt,
  referenceTemperatureC,
  referenceSource,
  shrink,
  weightBreakdown,
  peakSpreadC,
  usableModelCount,
  totalModelCount,
  exposedSignals,
  probabilitySteps,
}: {
  generatedAt: string;
  referenceTemperatureC: number | null;
  referenceSource: KellyWeatherEvidence["currentReferenceSource"];
  shrink: KellyShrinkResult;
  weightBreakdown: KellyMethodologyWeightBreakdownShape;
  peakSpreadC: number;
  usableModelCount: number;
  totalModelCount: number;
  exposedSignals: Parameters<typeof toMethodologyModels>[0];
  probabilitySteps: KellyDecoratedProbabilitySteps;
}): KellyMethodology => ({
  generatedAt,
  formulaVersion: KELLY_FORMULA_VERSION,
  referenceTemperatureC,
  referenceSource,
  shrink: round4(shrink.value),
  shrinkMode: KELLY_SHRINK_MODE,
  shrinkInputs: shrink.inputs,
  weightBreakdown,
  peakSpreadC: round2(peakSpreadC),
  usableModelCount,
  totalModelCount,
  summaries: KELLY_METHODOLOGY_SUMMARIES,
  probabilitySteps,
  formulaNotes: KELLY_FORMULA_NOTES,
  models: toMethodologyModels(exposedSignals),
});

export const buildMarketEvidence = (
  candidates: PolymarketCandidate[],
  pageFetchedAt: string | null,
): KellyMarketEvidence[] =>
  candidates.map((candidate) => ({
    marketId: candidate.marketId,
    title: candidate.title,
    eventTitle: candidate.eventTitle,
    marketUrl: candidate.marketUrl,
    eventUrl: candidate.eventUrl,
    lifecycle: candidate.lifecycle,
    inactiveReason: candidate.inactiveReason,
    parseStatus: candidate.parseStatus,
    exclusionReason: candidate.exclusionReason,
    ruleSummary: candidate.description ?? null,
    resolutionSource: candidate.resolutionSource ?? null,
    pageFetchedAt,
  }));

const resolveFrameSide = (market: KellyMarketRow): KellyFramePoint["selectedSide"] => {
  if (market.recommendedSide === "yes" || market.recommendedSide === "no") {
    return market.recommendedSide;
  }

  if (market.edgeYes > 0 && market.edgeYes >= market.edgeNo) {
    return "yes";
  }

  if (market.edgeNo > 0 && market.edgeNo > market.edgeYes) {
    return "no";
  }

  return "watch";
};

export const buildKellyFramePoints = (markets: KellyMarketRow[], generatedAt: string): KellyFramePoint[] =>
  markets
    .filter((market) => market.parseStatus === "matched")
    .map((market) => {
      const selectedSide = resolveFrameSide(market);
      return {
        id: `${generatedAt}:${market.marketId}`,
        marketId: market.marketId,
        generatedAt,
        marketPrice:
          selectedSide === "yes"
            ? (market.yesBestAsk ?? market.yesPrice ?? null)
            : selectedSide === "no"
              ? (market.noBestAsk ?? market.noPrice ?? null)
              : Math.max(market.yesBestAsk ?? market.yesPrice ?? 0, market.noBestAsk ?? market.noPrice ?? 0) || null,
        fairPrice:
          selectedSide === "yes"
            ? market.fairYes
            : selectedSide === "no"
              ? market.fairNo
              : Math.max(market.fairYes, market.fairNo),
        yesMarketPrice: market.yesBestAsk ?? market.yesPrice ?? null,
        noMarketPrice: market.noBestAsk ?? market.noPrice ?? null,
        fairYes: market.fairYes,
        fairNo: market.fairNo,
        yesEdge: market.edgeYes,
        noEdge: market.edgeNo,
        spreadPct: market.spreadPct,
        selectedSide,
        note:
          market.recommendedSide === "none"
            ? "未过执行阈值，作为观察位记录。"
            : buildRecommendationReasonText(market, "balanced"),
      };
    });

const RISK_MODE_LABELS: Record<KellyRiskMode, string> = {
  conservative: "保守",
  balanced: "均衡",
  aggressive: "进取",
};

const buildReadableRecommendationReason = (market: KellyMarketRow, riskMode: KellyRiskMode): string => {
  const modeLabel = RISK_MODE_LABELS[riskMode];
  if (market.recommendedSide === "none") {
    return "当前未达到最小 edge 或盘口质量不足，先保留为观察位。";
  }

  return `${modeLabel}模式下，已结合当前 edge、盘口价差和流动性给出仓位建议。`;
};

const buildReadableObservation = (markets: KellyMarketRow[]): KellyRecommendation | null => {
  const best = rankObservationMarkets(markets)[0];
  if (!best) {
    return null;
  }

  return toObservationRecommendation(best, "当前最佳档位仍未达到执行阈值，先作为观察位保留。");
};

const KELLY_METHOD_PROBABILITY_STEPS_META: Omit<KellyMethodologyProbabilityStepsShape, "details"> = {
  gridStepC: GRID_STEP,
  referencePriority: ["手动输入参考温度", "当前小时实况", "模型集合均值"],
  contractProbabilityRule: "用各模型 adjustedPeak 生成高斯混合分布，按档位边界积分得到 raw probability。",
  shrinkRule: "用 shrink 抑制过度自信，p_final = 0.5 + shrink × (p_raw - 0.5)。",
  fairPriceRule: "fairYes = p_final，fairNo = 1 - fairYes。",
  entryPriceRule: "Yes/No 买入价只取可执行 best ask；若 best ask 缺失，则该侧视为当前不可执行。",
  edgeRule: "edge = fair - entry。",
  kellyRule: "Kelly = max(0, (fair - entry) / (1 - entry)) × 风险倍率。",
};

const buildReadableMethodology = ({
  generatedAt,
  referenceTemperatureC,
  referenceSource,
  shrink,
  shrinkInputs,
  shrinkMode,
  weightBreakdown,
  peakSpreadC,
  usableModelCount,
  totalModelCount,
  exposedSignals,
  probabilitySteps,
}: {
  generatedAt: string;
  referenceTemperatureC: number | null;
  referenceSource: KellyWeatherEvidence["currentReferenceSource"];
  shrink: number;
  shrinkInputs: KellyMethodology["shrinkInputs"];
  shrinkMode: KellyMethodology["shrinkMode"];
  weightBreakdown: KellyMethodologyWeightBreakdownShape;
  peakSpreadC: number;
  usableModelCount: number;
  totalModelCount: number;
  exposedSignals: Parameters<typeof toMethodologyModels>[0];
  probabilitySteps: KellyDecoratedProbabilitySteps;
}): KellyMethodology => ({
  generatedAt,
  formulaVersion: KELLY_FORMULA_VERSION,
  referenceTemperatureC,
  referenceSource,
  shrink: round4(shrink),
  shrinkMode,
  shrinkInputs,
  weightBreakdown,
  peakSpreadC: round2(peakSpreadC),
  usableModelCount,
  totalModelCount,
  summaries: KELLY_METHODOLOGY_SUMMARIES,
  probabilitySteps,
  formulaNotes: KELLY_FORMULA_NOTES,
  models: toMethodologyModels(exposedSignals),
});

export const buildReadableFramePoints = (markets: KellyMarketRow[], generatedAt: string): KellyFramePoint[] =>
  markets
    .filter((market) => market.parseStatus === "matched")
    .map((market) => {
      const selectedSide =
        market.recommendedSide === "yes" || market.recommendedSide === "no"
          ? market.recommendedSide
          : market.edgeYes > 0 && market.edgeYes >= market.edgeNo
            ? "yes"
            : market.edgeNo > 0 && market.edgeNo > market.edgeYes
              ? "no"
              : "watch";

      return {
        id: `${generatedAt}:${market.marketId}`,
        marketId: market.marketId,
        generatedAt,
        marketPrice:
          selectedSide === "yes"
            ? (market.yesBestAsk ?? market.yesPrice ?? null)
            : selectedSide === "no"
              ? (market.noBestAsk ?? market.noPrice ?? null)
              : Math.max(market.yesBestAsk ?? market.yesPrice ?? 0, market.noBestAsk ?? market.noPrice ?? 0) || null,
        fairPrice:
          selectedSide === "yes"
            ? market.fairYes
            : selectedSide === "no"
              ? market.fairNo
              : Math.max(market.fairYes, market.fairNo),
        yesMarketPrice: market.yesBestAsk ?? market.yesPrice ?? null,
        noMarketPrice: market.noBestAsk ?? market.noPrice ?? null,
        fairYes: market.fairYes,
        fairNo: market.fairNo,
        yesEdge: market.edgeYes,
        noEdge: market.edgeNo,
        spreadPct: market.spreadPct,
        selectedSide,
        note:
          market.recommendedSide === "none"
            ? "未过执行阈值，作为观察位记录。"
            : buildReadableRecommendationReason(market, "balanced"),
      };
    });

const buildReadableSourceStatuses = ({
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
      detail: weatherStale ? "天气层当前使用最近一次成功缓存。" : "天气层与多模型层已对齐。",
      updatedAt: null,
    },
    {
      kind: "market-discovery",
      state: marketState,
      label: "市场发现",
      detail: marketFetchedAt ? "已拿到 Polymarket 候选市场。" : "当前未拿到可用市场元数据。",
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
      detail: "等待前端建立 Polymarket WebSocket 订阅。",
      updatedAt: null,
    },
  ];
};

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
  metarObservation,
  insight,
  distribution,
  discoveryCandidates,
  inactiveCandidates = [],
  discoveryFetchedAt,
  sourceLinks,
  orderBooks,
  priceFetchedAt,
  generatedAt,
  repricedAt = null,
  frameSeries,
  options,
  warnings,
  observationFloorOverride = null,
}: {
  location: RegisteredLocation;
  targetDate: string;
  hourly: HourlyWeatherResponse;
  report: WeatherReportResponse;
  metarObservation: MetarObservation | null;
  insight: MultiModelInsightResponse;
  distribution: MultiModelDistributionResponse;
  discoveryCandidates: PolymarketCandidate[];
  inactiveCandidates?: PolymarketCandidate[];
  discoveryFetchedAt: string | null;
  sourceLinks: KellySourceLinks;
  orderBooks: Map<string, InternalOrderBook>;
  priceFetchedAt: string | null;
  generatedAt: string;
  repricedAt?: string | null;
  frameSeries: KellyFramePoint[];
  options: KellyRequestOptions;
  warnings: string[];
  observationFloorOverride?: KellyObservationFloor | null;
}) => {
  const bankroll = options.bankroll && Number.isFinite(options.bankroll) && options.bankroll > 0 ? options.bankroll : DEFAULT_BANKROLL;
  const minEdge =
    options.minEdge && Number.isFinite(options.minEdge) && options.minEdge >= 0 ? clamp(options.minEdge, 0, 1) : DEFAULT_MIN_EDGE;
  const riskMode = options.riskMode ?? DEFAULT_RISK_MODE;
  const availableTargetDates = resolveAvailableTargetDates(distribution.availableTimestamps, location.timezone);
  const reference = resolveReferenceTemperature(hourly, insight, metarObservation, options);
  const observationFloor =
    observationFloorOverride ??
    resolveObservationFloor(hourly, metarObservation, options, {
      targetDate,
      timeZone: location.timezone,
    });
  const signalBundle = buildUsableSignals(insight, distribution, reference.value);
  const curve = applyObservationFloorToCurve(buildProbabilityCurve(signalBundle.usableSignals), observationFloor.value);
  const shrinkResult = buildShrink(signalBundle.usableSignals, signalBundle.totalModelCount, hourly.stale || distribution.stale || insight.stale);
  const shrink = shrinkResult.value;
  const distributionSummary = buildDistributionSummary(
    curve,
    shrink,
    signalBundle.usableSignals.length,
    signalBundle.totalModelCount,
    signalBundle.peakSpreadRef,
  );
  const baseBuckets = buildBaseBuckets(curve);
  const allCandidates = [...discoveryCandidates, ...inactiveCandidates];
  const baseMarkets = buildKellyMarkets(allCandidates, curve, shrink, observationFloor.value);
  const pricedMarkets = applyPricingToMarkets(baseMarkets, orderBooks, {
    bankroll,
    riskMode,
    minEdge,
  });
  const activeMarkets = pricedMarkets.filter(
    (market) => market.parseStatus === "matched" && market.lifecycle === "tradable" && hasExecutableEntry(market),
  );
  const inactiveMarkets = pricedMarkets.filter(
    (market) =>
      market.parseStatus === "matched" &&
      (market.lifecycle !== "tradable" || !hasExecutableEntry(market)),
  );
  const displayUnit = resolveDisplayUnit(
    activeMarkets.length > 0
      ? activeMarkets
      : inactiveMarkets.length > 0
        ? inactiveMarkets
        : pricedMarkets.filter((market) => market.parseStatus === "matched"),
  );
  const recommendations = buildRecommendations(activeMarkets, riskMode);
  const bestObservation = buildReadableObservation(activeMarkets);
  const weightBreakdown = {
    biasWeight:
      round4(
        mean(
          signalBundle.usableSignals.map(
            (signal) => signal.weightBreakdown?.biasWeight ?? 0,
          ),
        ),
      ) ?? 0,
    consensusWeight:
      round4(
        mean(
          signalBundle.usableSignals.map(
            (signal) => signal.weightBreakdown?.consensusWeight ?? 0,
          ),
        ),
      ) ?? 0,
    rankWeight:
      round4(
        mean(
          signalBundle.usableSignals.map(
            (signal) => signal.weightBreakdown?.rankWeight ?? 0,
          ),
        ),
      ) ?? 0,
    normalizedWeight:
      round4(
        mean(
          signalBundle.usableSignals.map(
            (signal) => signal.weightBreakdown?.normalizedWeight ?? 0,
          ),
        ),
      ) ?? 0,
  };
  const baseProbabilitySteps = activeMarkets
    .filter((market) => market.parseStatus === "matched")
    .map((market) => ({
      marketId: market.marketId,
      contractType: market.contractType,
      lowerBoundC: market.bucketStartC,
      upperBoundC: market.bucketEndC,
      pRaw: market.rawProbabilityYes,
      pFinal: round4(applyShrink(market.rawProbabilityYes, shrink)),
    }));

  const probabilitySteps = Object.assign(baseProbabilitySteps, {
    ...KELLY_METHOD_PROBABILITY_STEPS_META,
    details: baseProbabilitySteps,
  }) as KellyDecoratedProbabilitySteps;

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
    observationFloorTemperatureC: observationFloor.value,
    observationFloorSource: observationFloor.source,
    observationFloorObservedAt: observationFloor.observedAt,
    metarObservation,
    sourceSummaryZh: report.textZh,
    hourlyPageUrl: hourly.pageUrl,
    multimodelPageUrl: distribution.pageUrl,
    fetchedAt: generatedAt,
    stale: hourly.stale || report.stale || distribution.stale || insight.stale,
    participatingModelCount: signalBundle.usableSignals.length,
    excludedModels: signalBundle.exposedSignals
      .filter((signal) => !signal.included)
      .map((signal) => ({
        modelName: signal.modelName,
        reason: signal.exclusionReason ?? "未纳入本轮计算",
      })),
  };
  const unresolvedMarkets = pricedMarkets.filter((market) => market.parseStatus === "unresolved");
  const weatherGeneratedAt =
    [hourly.fetchedAt, report.fetchedAt, insight.fetchedAt, distribution.fetchedAt]
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? generatedAt;
  const freshness = buildFreshness({
    weatherGeneratedAt,
    discoveryFetchedAt,
    priceFetchedAt,
    frameSeries,
    repricedAt,
  });
  const streamHealth = INITIAL_STREAM_HEALTH;

  return {
    location: {
      id: location.id,
      name: location.name,
      timezone: location.timezone,
    },
    targetDate,
    availableTargetDates,
    generatedAt,
    bankroll,
    riskMode,
    riskMultiplier: RISK_PROFILE[riskMode].multiplier,
    minEdge,
    displayUnit,
    weatherEvidence,
    distributionSummary,
    probabilityCurve: curve,
    bucketProbabilities: baseBuckets,
    markets: activeMarkets,
    inactiveMarkets,
    recommendations,
    bestObservation,
    unresolvedMarkets,
    marketEvidence: buildMarketEvidence(allCandidates, discoveryFetchedAt),
    methodology: buildReadableMethodology({
      generatedAt,
      referenceTemperatureC: reference.value,
      referenceSource: reference.source,
      shrink,
      shrinkInputs: shrinkResult.inputs,
      shrinkMode: KELLY_SHRINK_MODE,
      weightBreakdown,
      peakSpreadC: signalBundle.peakSpreadRef,
      usableModelCount: signalBundle.usableSignals.length,
      totalModelCount: signalBundle.totalModelCount,
      exposedSignals: signalBundle.exposedSignals,
      probabilitySteps,
    }),
    frameSeries,
    sourceLinks,
    freshness,
    streamHealth,
    sourceStatus: buildReadableSourceStatuses({
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
      lifecycle: market.lifecycle,
      inactiveReason: market.inactiveReason,
      entrySourceYes: market.entrySourceYes,
      entrySourceNo: market.entrySourceNo,
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
