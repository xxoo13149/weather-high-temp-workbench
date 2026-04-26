import { config, LOCATION_REGISTRY } from "../../config.js";
import { AppError } from "../../domain/errors.js";
import type {
  DashboardMetarSnapshot,
  DashboardTafSnapshot,
  HourlyFieldCoverage,
  HourlyFieldCoverageCompleteness,
  HourlyFieldCoverageEntry,
  HourlyFieldName,
  HourlyMode,
  HourlySourceType,
  HourlyWeatherResponse,
  KellyFramePoint,
  KellyRuntimeHealth,
  KellyRuntimeStageTimings,
  KellyRequestOptions,
  KellyStreamHandle,
  KellyStreamMessage,
  KellyWeatherEvidence,
  KellyWorkbenchResponse,
  LocationInfo,
  MetarObservation,
  MetarTemperatureSample,
  MultiModelDistributionResponse,
  MultiModelInsightResponse,
  MultiModelImageResponse,
  MultiModelStatusResponse,
  RuntimeCacheBucketStatus,
  ServiceRuntimeStatus,
  SupplementalEvidenceSnapshot,
  UserFavoritesResponse,
  WeatherReportResponse,
  WeatherService,
} from "../../domain/weather.js";
import { normalizeDashboardMetarSnapshot } from "../../domain/weather.js";
import { buildDiscoveryWarnings, PolymarketClient, type NormalizedOrderBook, type PolymarketDiscoveryResult } from "../../kelly/polymarket.js";
import {
  applyPricingToMarkets,
  buildKellyProbabilityContext,
  buildKellyWorkbench,
  buildReadableFramePoints,
  rebaseKellyMarketsForObservationFloor,
  buildStreamMarketPatches,
  resolveObservationFloor,
  resolveKellyDateKeyFromTimestamp,
  resolveKellyTargetDate,
} from "../../kelly/workbench.js";
import { RefreshableCache } from "../../lib/cache.js";
import { FavoritesStore, type FavoritesStoreLike } from "../../lib/favorites-store.js";
import { fetchBinary, fetchText } from "../../lib/http.js";
import { withHandledTimeout as withTimeout } from "../../lib/with-timeout.js";
import { fetchMetarSnapshot } from "../metar/service.js";
import {
  applySupplementalRuntimeState,
  buildEmptySupplementalEvidence,
  fetchSupplementalEvidence,
} from "../supplemental/service.js";
import { fetchTafSnapshot } from "../taf/service.js";
import { resolveLocation } from "./location-registry.js";
import {
  extractWeekMeteogramHighchartsUrl,
  parseWeekMeteogramHighcharts,
  resolveWeekMeteogramTemperatureUnit,
} from "./meteogram.js";
import {
  buildMultiModelDistributionResponse,
  buildMultiModelInsightResponse,
  loadMultiModelDistribution,
  type MultiModelDistributionCacheValue,
} from "./multimodel-distribution.js";
import { extractMultiModelImageUrl, MULTIMODEL_IMAGE_VERSION } from "./multimodel.js";
import {
  mergeHourlyItems,
  parseWeekPage,
  sanitizeHourlySummaryZh,
  sanitizeReportTextZh,
  type ParsedOneHourFieldDiagnostics,
  WEEK_PARSER_VERSION,
} from "./week.js";
import { loadKellyStageCache } from "../../server/kelly-stage-cache.js";

const KELLY_STREAM_CLIENT_KEEPALIVE_MS = 20_000;
const KELLY_STREAM_POLLING_INTERVAL_MS = 30_000;
const KELLY_STREAM_REPRICE_DEBOUNCE_MS = 750;
const KELLY_STREAM_MODEL_CONTEXT_TTL_MS = 60_000;
const KELLY_STREAM_LAST_GOOD_TTL_MS = 120_000;
const KELLY_STREAM_REPRICE_FAILURE_WARN_THRESHOLD = 3;
const KELLY_STREAM_HUB_IDLE_TTL_MS = 90_000;
const METEOBLUE_WEEK_CACHE_LOAD_CONCURRENCY = 8;
const METEOBLUE_WEEK_PAGE_LOADER_TIMEOUT_MS = Math.min(config.httpTimeoutMs, 10_000);
const METEOBLUE_WEEK_METEOGRAM_LOADER_TIMEOUT_MS = Math.min(config.httpTimeoutMs, 10_000);
const METEOBLUE_WEEK_OPTIONAL_METEOGRAM_TIMEOUT_MS = Math.min(config.httpTimeoutMs, 2_500);
const METEOBLUE_MULTIMODEL_LOADER_TIMEOUT_MS = Math.min(config.httpTimeoutMs, 12_000);
const METEOBLUE_WEEK_CACHE_SLOT_TIMEOUT_MS = Math.max(config.httpTimeoutMs, 20_000);
const METEOBLUE_WEEK_PAGE_TOTAL_TIMEOUT_MS = METEOBLUE_WEEK_PAGE_LOADER_TIMEOUT_MS + 1_500;
const METEOBLUE_WEEK_METEOGRAM_TOTAL_TIMEOUT_MS = METEOBLUE_WEEK_METEOGRAM_LOADER_TIMEOUT_MS + 1_500;
const METEOBLUE_MULTIMODEL_TOTAL_TIMEOUT_MS = METEOBLUE_MULTIMODEL_LOADER_TIMEOUT_MS + 1_500;
const METEOBLUE_METAR_TOTAL_TIMEOUT_MS = Math.max(config.httpTimeoutMs, 10_000);
const METEOBLUE_TAF_TOTAL_TIMEOUT_MS = Math.max(config.httpTimeoutMs, 10_000);
const SUPPLEMENTAL_EVIDENCE_TTL_MS = 2 * 60_000;
const SUPPLEMENTAL_EVIDENCE_TOTAL_TIMEOUT_MS = Math.min(config.httpTimeoutMs, 3_000);
const POLYMARKET_DISCOVERY_TOTAL_TIMEOUT_MS = Math.max(config.httpTimeoutMs, 15_000);
const POLYMARKET_ORDERBOOK_TOTAL_TIMEOUT_MS = Math.max(config.httpTimeoutMs, 15_000);
const KELLY_MARKET_DISCOVERY_STAGE_TIMEOUT_MS = Math.min(POLYMARKET_DISCOVERY_TOTAL_TIMEOUT_MS, 3_500);
const KELLY_ORDERBOOK_STAGE_TIMEOUT_MS = Math.min(POLYMARKET_ORDERBOOK_TOTAL_TIMEOUT_MS, 4_000);
const KELLY_FORCE_REFRESH_SOFT_TIMEOUT_MS = 4_000;
const KELLY_MARKET_LOAD_CONCURRENCY = 3;
const KELLY_ORDERBOOK_LOAD_CONCURRENCY = 3;
const KELLY_MARKET_SLOT_TIMEOUT_MS = POLYMARKET_DISCOVERY_TOTAL_TIMEOUT_MS + 5_000;
const KELLY_ORDERBOOK_SLOT_TIMEOUT_MS = POLYMARKET_ORDERBOOK_TOTAL_TIMEOUT_MS + 5_000;
const KELLY_WORKBENCH_TOTAL_TIMEOUT_MS = Math.max(
  POLYMARKET_DISCOVERY_TOTAL_TIMEOUT_MS + POLYMARKET_ORDERBOOK_TOTAL_TIMEOUT_MS,
  30_000,
);

const createGlobalLimiter = (
  maxConcurrent: number,
  options?: {
    waitTimeoutMs?: number;
    createTimeoutError?: () => Error;
  },
) => {
  let active = 0;
  const waiters: Array<{
    released: boolean;
    timerId: ReturnType<typeof setTimeout> | null;
    resolve: () => void;
  }> = [];

  return async <T,>(loader: () => Promise<T>): Promise<T> => {
    if (active >= maxConcurrent) {
      await new Promise<void>((resolve, reject) => {
        const waiter = {
          released: false,
          timerId: null as ReturnType<typeof setTimeout> | null,
          resolve: () => {
            if (waiter.released) {
              return;
            }

            waiter.released = true;
            if (waiter.timerId) {
              clearTimeout(waiter.timerId);
            }
            resolve();
          },
        };

        if (options?.waitTimeoutMs) {
          waiter.timerId = setTimeout(() => {
            if (waiter.released) {
              return;
            }

            waiter.released = true;
            const index = waiters.indexOf(waiter);
            if (index >= 0) {
              waiters.splice(index, 1);
            }
            reject(
              options.createTimeoutError?.() ??
                new Error(`Timed out waiting for a cache load slot after ${options.waitTimeoutMs}ms.`),
            );
          }, options.waitTimeoutMs);
        }

        waiters.push(waiter);
      });
    }

    active += 1;

    try {
      return await loader();
    } finally {
      active = Math.max(0, active - 1);
      const next = waiters.shift();
      next?.resolve();
    }
  };
};

const withWeekCacheLoadSlot = createGlobalLimiter(METEOBLUE_WEEK_CACHE_LOAD_CONCURRENCY, {
  waitTimeoutMs: METEOBLUE_WEEK_CACHE_SLOT_TIMEOUT_MS,
  createTimeoutError: () =>
    new AppError(
      503,
      "WEEK_CACHE_LOAD_BUSY",
      `Week cache load queue exceeded ${METEOBLUE_WEEK_CACHE_SLOT_TIMEOUT_MS}ms.`,
      {
        retryable: true,
      },
    ),
});

const withKellyMarketLoadSlot = createGlobalLimiter(KELLY_MARKET_LOAD_CONCURRENCY, {
  waitTimeoutMs: KELLY_MARKET_SLOT_TIMEOUT_MS,
  createTimeoutError: () =>
    new AppError(
      503,
      "POLYMARKET_DISCOVERY_BUSY",
      `Polymarket discovery queue exceeded ${KELLY_MARKET_SLOT_TIMEOUT_MS}ms.`,
      {
        retryable: true,
      },
    ),
});

const withKellyOrderbookLoadSlot = createGlobalLimiter(KELLY_ORDERBOOK_LOAD_CONCURRENCY, {
  waitTimeoutMs: KELLY_ORDERBOOK_SLOT_TIMEOUT_MS,
  createTimeoutError: () =>
    new AppError(
      503,
      "POLYMARKET_ORDERBOOK_BUSY",
      `Polymarket orderbook queue exceeded ${KELLY_ORDERBOOK_SLOT_TIMEOUT_MS}ms.`,
      {
        retryable: true,
      },
    ),
});

const createWeekPageLoaderSignal = () => AbortSignal.timeout(METEOBLUE_WEEK_PAGE_LOADER_TIMEOUT_MS);
const createWeekMeteogramLoaderSignal = () => AbortSignal.timeout(METEOBLUE_WEEK_METEOGRAM_LOADER_TIMEOUT_MS);
const createOptionalWeekMeteogramLoaderSignal = () => AbortSignal.timeout(METEOBLUE_WEEK_OPTIONAL_METEOGRAM_TIMEOUT_MS);
const createMultiModelLoaderSignal = () => AbortSignal.timeout(METEOBLUE_MULTIMODEL_LOADER_TIMEOUT_MS);

interface WeekCacheValue {
  fetchedAt: string;
  sourceObservedAt: string | null;
  weekPageHtml: string;
  weekTable1h: HourlyWeatherResponse["items"];
  weekTable3h: HourlyWeatherResponse["items"];
  weekMeteogramHighchartsRawJson: string | null;
  weekMeteogramHighcharts: HourlyWeatherResponse["items"];
  weatherReportRaw: {
    available: boolean;
    titleEn: string | null;
    sourceTextEn: string | null;
    textZh: string | null;
    metrics: WeatherReportResponse["metrics"];
    warnings: string[];
  };
  hourly: Record<
    HourlyMode,
    {
      items: HourlyWeatherResponse["items"];
      sourceType: HourlyWeatherResponse["sourceType"];
      warnings: string[];
      partial: boolean;
      preferredItems?: HourlyWeatherResponse["items"];
      fallbackItems?: HourlyWeatherResponse["items"];
      fieldDiagnostics?: ParsedOneHourFieldDiagnostics | null;
    }
  >;
  report: Omit<WeatherReportResponse, "fetchedAt" | "sourceObservedAt" | "stale" | "freshness" | "cacheHit" | "warnings"> & {
    warnings: string[];
  };
}

interface ImageCacheValue {
  pageFetchedAt: string;
  imageFetchedAt: string;
  imageUrl: string;
  contentType: string;
  body: Buffer;
}

interface MetarCacheValue {
  observation: Omit<MetarObservation, "stale" | "cacheHit"> | null;
  recentTemperatures: MetarTemperatureSample[];
  recentObservations?: NonNullable<DashboardMetarSnapshot["recentObservations"]>;
  recentReports?: NonNullable<DashboardMetarSnapshot["recentReports"]>;
}

interface TafCacheValue {
  forecast: Omit<NonNullable<DashboardTafSnapshot["forecast"]>, "stale" | "cacheHit" | "freshness"> | null;
  forecasts: DashboardTafSnapshot["forecasts"];
}

type KellyMatchedStreamMarket = KellyWorkbenchResponse["markets"][number] & {
  yesTokenId: string;
  noTokenId: string;
};

interface KellyStreamSubscriber {
  id: string;
  streamContextKey: string;
  onMessage: (message: KellyStreamMessage) => void;
  trackedMarkets: KellyWorkbenchResponse["markets"];
  matchedMarkets: KellyMatchedStreamMarket[];
  streamOptions: KellyRequestOptions;
  bankroll: number;
  riskMode: KellyWorkbenchResponse["riskMode"];
  minEdge: number;
  probabilityCurve: KellyWorkbenchResponse["probabilityCurve"];
  shrink: number;
  lastRepricedAt: string | null;
  lastClientMessageAt: number;
  consecutiveRepriceFailures: number;
  keepaliveTimer: NodeJS.Timeout | null;
  closed: boolean;
}

interface KellyStreamHub {
  key: string;
  locationId: LocationInfo["id"];
  location: ReturnType<MeteoblueWeatherService["requireLocation"]>;
  targetDate: string;
  tokenIds: Set<string>;
  subscribers: Map<string, KellyStreamSubscriber>;
  upstreamStream: KellyStreamHandle | null;
  upstreamConnected: boolean;
  lastSignalAt: string | null;
  lastRepricedAt: string | null;
  lastOrderbookAt: string | null;
  latestBooks: Map<string, NormalizedOrderBook> | null;
  pendingTimer: NodeJS.Timeout | null;
  fallbackTimer: NodeJS.Timeout | null;
  idleTimer: NodeJS.Timeout | null;
  repriceInFlight: Promise<string | null> | null;
}

const INITIAL_KELLY_STAGE_TIMINGS: KellyRuntimeStageTimings = {
  hourly: null,
  report: null,
  metar: null,
  insight: null,
  distribution: null,
  marketDiscovery: null,
  orderbook: null,
  pricing: null,
  total: null,
};

const cloneKellyStageTimings = (value?: Partial<KellyRuntimeStageTimings> | null): KellyRuntimeStageTimings => ({
  ...INITIAL_KELLY_STAGE_TIMINGS,
  ...(value ?? {}),
});

const summarizeCacheMap = <T,>(caches: Map<LocationInfo["id"], RefreshableCache<T>>): RuntimeCacheBucketStatus => {
  let entryCount = 0;
  let freshCount = 0;
  let revalidatingCount = 0;
  let fallbackErrorCount = 0;
  let inFlightCount = 0;
  let lastSuccessAt: string | null = null;

  for (const cache of caches.values()) {
    const snapshot = cache.peek();
    if (snapshot.entry) {
      entryCount += 1;
    }
    if (snapshot.inFlight) {
      inFlightCount += 1;
    }
    if (snapshot.freshness === "fresh") {
      freshCount += 1;
    } else if (snapshot.freshness === "revalidating") {
      revalidatingCount += 1;
    } else if (snapshot.freshness === "fallback_error") {
      fallbackErrorCount += 1;
    }

    if (!lastSuccessAt || (snapshot.lastSuccessAt && snapshot.lastSuccessAt > lastSuccessAt)) {
      lastSuccessAt = snapshot.lastSuccessAt ?? lastSuccessAt;
    }
  }

  return {
    entryCount,
    freshCount,
    revalidatingCount,
    fallbackErrorCount,
    inFlightCount,
    lastSuccessAt,
  };
};

const measureAsync = async <T>(
  stageTimings: Partial<KellyRuntimeStageTimings>,
  key: keyof KellyRuntimeStageTimings,
  loader: () => Promise<T>,
): Promise<T> => {
  const startedAt = Date.now();
  try {
    return await loader();
  } finally {
    stageTimings[key] = Date.now() - startedAt;
  }
};

const buildKellyCacheKey = (locationId: LocationInfo["id"], targetDate: string) => `${locationId}::${targetDate}`;
const buildKellySnapshotRequestKey = (
  locationId: LocationInfo["id"],
  targetDate: string,
  options: KellyRequestOptions,
) =>
  [
    locationId,
    targetDate,
    options.bankroll ?? "default-bankroll",
    options.riskMode ?? "default-risk",
    options.minEdge ?? "default-edge",
    options.actualTemperatureC ?? "default-temp",
    options.selectedHourTimestamp ?? "default-hour",
  ].join("::");
const KELLY_SNAPSHOT_RESULT_TTL_MS = 30_000;
const KELLY_SNAPSHOT_MAX_STALE_MS = 20 * 60_000;

const resolveMetarObservedHighFloor = (
  recentTemperatures: MetarTemperatureSample[],
  targetDate: string,
  timeZone: string,
) => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const sameDaySamples = recentTemperatures.filter((sample) => formatter.format(new Date(sample.observedAt)) === targetDate);
  if (sameDaySamples.length === 0) {
    return null;
  }

  const best = [...sameDaySamples].sort(
    (left, right) => right.temperatureC - left.temperatureC || right.observedAt.localeCompare(left.observedAt),
  )[0];
  if (!best) {
    return null;
  }

  return {
    value: best.temperatureC,
    source: "metar" as const,
    observedAt: best.observedAt,
  };
};
const resolveKellyDistributionTimestamp = (
  availableTimestamps: string[],
  targetDate: string,
  timeZone: string,
): string | null => {
  const matching = availableTimestamps.filter(
    (timestamp) => resolveKellyDateKeyFromTimestamp(timestamp, timeZone) === targetDate,
  );
  if (matching.length === 0) {
    return null;
  }

  return matching[Math.floor(matching.length / 2)] ?? matching[0] ?? null;
};

const parseIsoDateKeyUtcMs = (value: string): number | null => {
  const [year, month, day] = value.split("-").map((entry) => Number.parseInt(entry, 10));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }

  return Date.UTC(year, month - 1, day);
};

type KellyDistributionSelection = {
  timestamp: string | null;
  effectiveTargetDate: string;
  requestedTargetDate: string;
  usedFallback: boolean;
  availableTargetDates: string[];
};

const resolveKellyDistributionSelection = (
  availableTimestamps: string[],
  targetDate: string,
  timeZone: string,
): KellyDistributionSelection => {
  const grouped = new Map<string, string[]>();
  for (const timestamp of availableTimestamps) {
    const dateKey = resolveKellyDateKeyFromTimestamp(timestamp, timeZone);
    if (!dateKey) {
      continue;
    }
    const list = grouped.get(dateKey) ?? [];
    list.push(timestamp);
    grouped.set(dateKey, list);
  }

  const availableTargetDates = [...grouped.keys()].sort();
  if (availableTargetDates.length === 0) {
    return {
      timestamp: null,
      effectiveTargetDate: targetDate,
      requestedTargetDate: targetDate,
      usedFallback: false,
      availableTargetDates: [],
    };
  }

  let effectiveTargetDate = targetDate;
  if (!grouped.has(effectiveTargetDate)) {
    const requestedUtcMs = parseIsoDateKeyUtcMs(targetDate);
    if (requestedUtcMs === null) {
      effectiveTargetDate = availableTargetDates[availableTargetDates.length - 1] ?? availableTargetDates[0];
    } else {
      const availableBeforeOrEqual = availableTargetDates
        .map((dateKey) => ({
          dateKey,
          utcMs: parseIsoDateKeyUtcMs(dateKey),
        }))
        .filter((entry): entry is { dateKey: string; utcMs: number } => entry.utcMs !== null)
        .filter((entry) => entry.utcMs <= requestedUtcMs)
        .sort((left, right) => right.utcMs - left.utcMs);

      if (availableBeforeOrEqual.length > 0) {
        effectiveTargetDate = availableBeforeOrEqual[0].dateKey;
      } else {
        effectiveTargetDate = availableTargetDates[0];
      }
    }
  }

  const effectiveTimestamps = grouped.get(effectiveTargetDate) ?? [];
  const timestamp =
    effectiveTimestamps[Math.floor(effectiveTimestamps.length / 2)] ??
    effectiveTimestamps[0] ??
    null;
  return {
    timestamp,
    effectiveTargetDate,
    requestedTargetDate: targetDate,
    usedFallback: effectiveTargetDate !== targetDate,
    availableTargetDates,
  };
};

const normalizeText = (value: string): string => value.replace(/\s+/g, " ").trim();
const hasDiscoveryCandidates = (value: PolymarketDiscoveryResult | null | undefined): boolean =>
  Boolean(value) && (value!.candidates.length > 0 || value!.inactiveCandidates.length > 0);
const appendWarningIfMissing = (warnings: string[], warning: string) => {
  if (!warnings.includes(warning)) {
    warnings.push(warning);
  }
};

const toRetainedDiscoveryCandidate = (
  market: KellyWorkbenchResponse["markets"][number],
): PolymarketDiscoveryResult["candidates"][number] => ({
  marketId: market.marketId,
  slug: market.slug,
  title: market.title,
  marketUrl: market.marketUrl,
  conditionId: market.conditionId,
  contractType: market.contractType,
  unit: market.unit,
  bucketStartC: market.bucketStartC,
  bucketEndC: market.bucketEndC,
  bucketLabel: market.bucketLabel,
  lifecycle: market.lifecycle,
  inactiveReason: market.inactiveReason,
  parseStatus: market.parseStatus,
  exclusionReason: market.exclusionReason,
  yesTokenId: market.yesTokenId,
  noTokenId: market.noTokenId,
  updatedAt: market.updatedAt,
  eventTitle: null,
  eventUrl: null,
  liquidity: market.liquidity,
  volume24h: market.volume24h,
});

const buildRetainedDiscoveryResultFromSnapshot = (
  snapshot: KellyWorkbenchResponse | null,
): PolymarketDiscoveryResult | null => {
  if (!snapshot) {
    return null;
  }

  const allCandidates = [
    ...snapshot.markets,
    ...(snapshot.inactiveMarkets ?? []),
    ...(snapshot.unresolvedMarkets ?? []),
  ].map((market) => toRetainedDiscoveryCandidate(market));
  if (allCandidates.length === 0) {
    return null;
  }

  return {
    fetchedAt: snapshot.freshness.marketDiscoveredAt ?? snapshot.generatedAt,
    candidates: allCandidates.filter((candidate) => candidate.lifecycle !== "inactive"),
    inactiveCandidates: allCandidates.filter((candidate) => candidate.lifecycle === "inactive"),
    sourceLinks: snapshot.sourceLinks,
  };
};

const buildRetainedOrderBooksFromSnapshot = (
  snapshot: KellyWorkbenchResponse | null,
): {
  books: Map<string, NormalizedOrderBook>;
  observedAt: string | null;
} | null => {
  if (!snapshot) {
    return null;
  }

  const observedAt = snapshot.freshness.orderbookFetchedAt ?? snapshot.generatedAt;
  const books = new Map<string, NormalizedOrderBook>();
  const trackedMarkets = [...snapshot.markets, ...(snapshot.inactiveMarkets ?? [])];

  for (const market of trackedMarkets) {
    const updatedAt = market.updatedAt || observedAt || snapshot.generatedAt;
    const yesBestBid = market.yesBestBid ?? null;
    const yesBestAsk = market.yesBestAsk ?? market.yesPrice ?? null;
    const noBestBid = market.noBestBid ?? null;
    const noBestAsk = market.noBestAsk ?? market.noPrice ?? null;

    if (market.yesTokenId) {
      books.set(market.yesTokenId, {
        tokenId: market.yesTokenId,
        bestBid: yesBestBid,
        bestAsk: yesBestAsk,
        midpoint:
          yesBestBid !== null && yesBestAsk !== null ? (yesBestBid + yesBestAsk) / 2 : yesBestAsk ?? yesBestBid ?? null,
        updatedAt,
        status: yesBestBid !== null || yesBestAsk !== null ? "available" : "no-orderbook",
      });
    }

    if (market.noTokenId) {
      books.set(market.noTokenId, {
        tokenId: market.noTokenId,
        bestBid: noBestBid,
        bestAsk: noBestAsk,
        midpoint:
          noBestBid !== null && noBestAsk !== null ? (noBestBid + noBestAsk) / 2 : noBestAsk ?? noBestBid ?? null,
        updatedAt,
        status: noBestBid !== null || noBestAsk !== null ? "available" : "no-orderbook",
      });
    }
  }

  if (books.size === 0) {
    return null;
  }

  return {
    books,
    observedAt,
  };
};
const dateFormatterCache = new Map<string, Intl.DateTimeFormat>();

const getDateFormatter = (timeZone: string): Intl.DateTimeFormat => {
  const cached = dateFormatterCache.get(timeZone);
  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  dateFormatterCache.set(timeZone, formatter);
  return formatter;
};

const localDateKey = (timestamp: string, timeZone: string): string | null => {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return getDateFormatter(timeZone).format(parsed);
};

const nearestItemIndex = (items: HourlyWeatherResponse["items"], nowMs: number): number => {
  let nearestIndex = -1;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item?.timestamp) {
      continue;
    }

    const itemMs = Date.parse(item.timestamp);
    if (Number.isNaN(itemMs)) {
      continue;
    }

    const distance = Math.abs(itemMs - nowMs);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  }

  return nearestIndex;
};

const sanitizeHourlyItems = (items: HourlyWeatherResponse["items"]): HourlyWeatherResponse["items"] =>
  items.map((item) => ({
    ...item,
    summaryZh: sanitizeHourlySummaryZh(item.summaryZh, item.summary),
  }));

const coverageFields: HourlyFieldName[] = ["precipitationProbabilityPct", "feelsLikeC", "windDirection"];
const meteogramSupportedCoverageFields = new Set<HourlyFieldName>(["windDirection"]);

const createMissingReasonCounter = (): HourlyFieldCoverageEntry["missingReasons"] => ({
  "source-unpublished": 0,
  "parser-unrecognized": 0,
  "fallback-unavailable": 0,
});

const resolveCompleteness = (
  availableHours: number,
  totalHours: number,
): HourlyFieldCoverageCompleteness => {
  if (availableHours <= 0 || totalHours <= 0) {
    return "missing";
  }

  if (availableHours >= totalHours) {
    return "full";
  }

  return "partial";
};

const buildFieldCoverage = ({
  items,
  sourceType,
  preferredItems,
  fallbackItems,
  fieldDiagnostics,
}: {
  items: HourlyWeatherResponse["items"];
  sourceType: HourlySourceType;
  preferredItems?: HourlyWeatherResponse["items"];
  fallbackItems?: HourlyWeatherResponse["items"];
  fieldDiagnostics?: ParsedOneHourFieldDiagnostics | null;
}): HourlyFieldCoverage => {
  const preferredByTimestamp = new Map((preferredItems ?? items).map((item) => [item.timestamp, item]));
  const fallbackByTimestamp = new Map((fallbackItems ?? []).map((item) => [item.timestamp, item]));
  const mixedSourceSet = new Set<HourlySourceType>();

  for (const item of items) {
    if (preferredByTimestamp.has(item.timestamp)) {
      mixedSourceSet.add(sourceType);
    }
    if (fallbackByTimestamp.has(item.timestamp)) {
      mixedSourceSet.add("week-meteogram-highcharts");
    }
  }

  if (mixedSourceSet.size === 0) {
    mixedSourceSet.add(sourceType);
  }

  const entries = Object.fromEntries(
    coverageFields.map((field) => {
      let availableHours = 0;
      let preferredHits = 0;
      let fallbackHits = 0;
      const missingReasons = createMissingReasonCounter();

      for (const item of items) {
        const preferred = preferredByTimestamp.get(item.timestamp);
        const fallback = fallbackByTimestamp.get(item.timestamp);
        const currentValue = item[field];
        const preferredValue = preferred?.[field] ?? null;
        const fallbackValue = fallback?.[field] ?? null;

        if (currentValue !== null) {
          availableHours += 1;
          if (preferredValue !== null) {
            preferredHits += 1;
          } else if (fallbackValue !== null) {
            fallbackHits += 1;
          } else if (!preferred && fallback) {
            fallbackHits += 1;
          } else {
            preferredHits += 1;
          }
          continue;
        }

        let reason: keyof HourlyFieldCoverageEntry["missingReasons"] = "parser-unrecognized";
        if (preferred) {
          reason = fieldDiagnostics?.[field].missingByTimestamp[item.timestamp] ?? "source-unpublished";
        } else if (fallback) {
          reason = meteogramSupportedCoverageFields.has(field) ? "source-unpublished" : "fallback-unavailable";
        } else if (sourceType === "week-meteogram-highcharts" && !meteogramSupportedCoverageFields.has(field)) {
          reason = "fallback-unavailable";
        }

        missingReasons[reason] += 1;
      }

      const totalHours = items.length;
      const source: HourlyFieldCoverageEntry["source"] =
        preferredHits > 0 && fallbackHits > 0
          ? "mixed"
          : preferredHits > 0
            ? sourceType
            : fallbackHits > 0
              ? "week-meteogram-highcharts"
              : sourceType === "week-meteogram-highcharts" && !meteogramSupportedCoverageFields.has(field)
                ? "mixed"
                : sourceType;

      return [
        field,
        {
          availableHours,
          totalHours,
          source,
          completeness: resolveCompleteness(availableHours, totalHours),
          missingReasons,
        } satisfies HourlyFieldCoverageEntry,
      ];
    }),
  ) as Record<HourlyFieldName, HourlyFieldCoverageEntry>;

  return {
    precipitationProbabilityPct: entries.precipitationProbabilityPct,
    feelsLikeC: entries.feelsLikeC,
    windDirection: entries.windDirection,
    mixedSources: [...mixedSourceSet],
  };
};

const isFallbackErrorFreshness = (freshness: string) => freshness === "fallback_error";
const isRevalidatingFreshness = (freshness: string) => freshness === "revalidating";

const resolveSnapshotFreshness = <T,>(snapshot: ReturnType<RefreshableCache<T>["peek"]>) =>
  snapshot.freshness ??
  (snapshot.entry
    ? snapshot.lastError
      ? "fallback_error"
      : snapshot.inFlight
        ? "revalidating"
        : "fresh"
    : null);

const ensureCacheHasEntry = async <T>(cache: RefreshableCache<T>) => {
  if (cache.peek().entry === null) {
    try {
      await cache.get({ allowStaleOnError: true });
    } catch {
      // ignore loader failures; status will reflect last known state
    }
  }
};

const pushRefreshableCacheWarning = (
  warnings: string[],
  freshness: string,
  messages: {
    revalidating: string;
    fallbackError: string;
  },
  options?: {
    includeRevalidating?: boolean;
  },
) => {
  if (isRevalidatingFreshness(freshness)) {
    if (!options?.includeRevalidating) {
      return;
    }
    appendWarningIfMissing(warnings, messages.revalidating);
  } else if (isFallbackErrorFreshness(freshness)) {
    appendWarningIfMissing(warnings, messages.fallbackError);
  }
};

const resolveLatestOrderbookTimestamp = (books: Map<string, NormalizedOrderBook>): string | null =>
  [...books.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]?.updatedAt ?? null;

export class MeteoblueWeatherService implements WeatherService {
  private readonly weekCaches = new Map<LocationInfo["id"], RefreshableCache<WeekCacheValue>>();
  private readonly multiModelImageCaches = new Map<LocationInfo["id"], RefreshableCache<ImageCacheValue>>();
  private readonly multiModelDistributionCaches = new Map<
    LocationInfo["id"],
    RefreshableCache<MultiModelDistributionCacheValue>
  >();
  private readonly metarCaches = new Map<LocationInfo["id"], RefreshableCache<MetarCacheValue>>();
  private readonly tafCaches = new Map<LocationInfo["id"], RefreshableCache<TafCacheValue>>();
  private readonly supplementalEvidenceCaches = new Map<
    LocationInfo["id"],
    RefreshableCache<SupplementalEvidenceSnapshot>
  >();
  private readonly kellyMarketCaches = new Map<string, RefreshableCache<PolymarketDiscoveryResult>>();
  private readonly kellyOrderBookCaches = new Map<string, RefreshableCache<Map<string, NormalizedOrderBook>>>();
  private readonly kellyOrderBookRefreshInFlight = new Map<string, Promise<Map<string, NormalizedOrderBook>>>();
  private readonly kellyFrameHistories = new Map<string, KellyFramePoint[]>();
  private readonly kellyObservationFloors = new Map<
    string,
    {
      value: number;
      source: KellyWeatherEvidence["observationFloorSource"];
      observedAt: string | null;
    }
  >();
  private readonly favoritesStore: FavoritesStoreLike;
  private readonly allowedLocationIds: Set<LocationInfo["id"]>;
  private readonly polymarketClient: PolymarketClient;
  private readonly kellySnapshotInFlight = new Map<string, Promise<KellyWorkbenchResponse>>();
  private readonly kellySnapshotResults = new Map<
    string,
    {
      expiresAt: number;
      staleUntil: number;
      snapshot: KellyWorkbenchResponse;
    }
  >();
  private readonly kellyStreamModelContexts = new Map<
    string,
    {
      expiresAt: number;
      probabilityCurve: KellyWorkbenchResponse["probabilityCurve"];
      shrink: number;
    }
  >();
  private readonly kellyStreamLastGoodSnapshots = new Map<
    string,
    {
      expiresAt: number;
      generatedAt: string;
      repricedAt: string;
      repricedMarkets: KellyWorkbenchResponse["markets"];
      framePoints: KellyFramePoint[];
    }
  >();
  private readonly kellyStreamRepriceInFlight = new Map<
    string,
    Promise<{
      books: Map<string, NormalizedOrderBook>;
      framePoints: KellyFramePoint[];
      generatedAt: string;
      orderbookObservedAt: string | null;
      repricedAt: string;
      repricedMarkets: KellyWorkbenchResponse["markets"];
    }>
  >();
  private readonly kellyStreamHubs = new Map<string, KellyStreamHub>();
  private kellyStreamSubscriberSequence = 0;
  private readonly kellyRuntimeHealth: KellyRuntimeHealth = {
    service: "kelly-origin",
    lastSnapshotSuccessAt: null,
    lastSnapshotErrorAt: null,
    lastSnapshotError: null,
    lastMarketDiscoveryAt: null,
    lastOrderbookAttemptAt: null,
    lastOrderbookSuccessAt: null,
    lastOrderbookFailureAt: null,
    lastOrderbookFailureCode: null,
    lastOrderbookAt: null,
    lastRepricedAt: null,
    lastSignalAt: null,
    lastStreamEventAt: null,
    openStreamCount: 0,
    activeHubCount: 0,
    fallbackMode: false,
    lastStageTimingsMs: cloneKellyStageTimings(),
  };

  constructor(options?: { favoritesStore?: FavoritesStoreLike }) {
    this.favoritesStore = options?.favoritesStore ?? new FavoritesStore();
    this.allowedLocationIds = new Set(Object.keys(LOCATION_REGISTRY) as LocationInfo["id"][]);
    this.polymarketClient = new PolymarketClient();
  }

  private readKellyStreamModelContext(cacheKey: string) {
    const cached = this.kellyStreamModelContexts.get(cacheKey);
    if (!cached) {
      return null;
    }

    if (cached.expiresAt <= Date.now()) {
      this.kellyStreamModelContexts.delete(cacheKey);
      return null;
    }

    return cached;
  }

  private writeKellyStreamModelContext(
    cacheKey: string,
    probabilityCurve: KellyWorkbenchResponse["probabilityCurve"],
    shrink: number,
  ) {
    this.kellyStreamModelContexts.set(cacheKey, {
      expiresAt: Date.now() + KELLY_STREAM_MODEL_CONTEXT_TTL_MS,
      probabilityCurve,
      shrink,
    });
  }

  private readKellyStreamLastGoodSnapshot(cacheKey: string) {
    const cached = this.kellyStreamLastGoodSnapshots.get(cacheKey);
    if (!cached) {
      return null;
    }

    if (cached.expiresAt <= Date.now()) {
      this.kellyStreamLastGoodSnapshots.delete(cacheKey);
      return null;
    }

    return cached;
  }

  private writeKellyStreamLastGoodSnapshot(
    cacheKey: string,
    payload: {
      generatedAt: string;
      repricedAt: string;
      repricedMarkets: KellyWorkbenchResponse["markets"];
      framePoints: KellyFramePoint[];
    },
  ) {
    this.kellyStreamLastGoodSnapshots.set(cacheKey, {
      expiresAt: Date.now() + KELLY_STREAM_LAST_GOOD_TTL_MS,
      generatedAt: payload.generatedAt,
      repricedAt: payload.repricedAt,
      repricedMarkets: payload.repricedMarkets,
      framePoints: payload.framePoints,
    });
  }

  private readKellySnapshotResultEntry(cacheKey: string) {
    const cached = this.kellySnapshotResults.get(cacheKey);
    if (!cached) {
      return null;
    }

    if (cached.staleUntil > Date.now()) {
      return cached;
    }

    this.kellySnapshotResults.delete(cacheKey);
    return null;
  }

  private readKellySnapshotResult(cacheKey: string, options?: { includeExpired?: boolean }) {
    const cached = this.readKellySnapshotResultEntry(cacheKey);
    if (!cached) {
      return null;
    }

    if (cached.expiresAt > Date.now() || options?.includeExpired) {
      return cached.snapshot;
    }

    return null;
  }

  private writeKellySnapshotResult(cacheKey: string, snapshot: KellyWorkbenchResponse, storedAt = new Date()) {
    const storedAtMs = storedAt.getTime();
    this.kellySnapshotResults.set(cacheKey, {
      expiresAt: storedAtMs + KELLY_SNAPSHOT_RESULT_TTL_MS,
      staleUntil: storedAtMs + KELLY_SNAPSHOT_MAX_STALE_MS,
      snapshot,
    });
  }

  private buildKellyFallbackSnapshotFromCache(snapshot: KellyWorkbenchResponse, reason: unknown): KellyWorkbenchResponse {
    const warning = "Kelly 刷新较慢，当前继续沿用上一轮可用结果。";

    return {
      ...snapshot,
      warnings: snapshot.warnings.includes(warning) ? snapshot.warnings : [...snapshot.warnings, warning],
    };
  }

  private buildKellyRevalidatingSnapshotFromCache(snapshot: KellyWorkbenchResponse): KellyWorkbenchResponse {
    const warning = "Kelly 后台刷新中，当前继续沿用最近一次可用结果。";

    return {
      ...snapshot,
      warnings: snapshot.warnings.includes(warning) ? snapshot.warnings : [...snapshot.warnings, warning],
    };
  }

  private createKellyWorkbenchSnapshotTask(
    cacheKey: string,
    locationId: LocationInfo["id"],
    location: ReturnType<MeteoblueWeatherService["requireLocation"]>,
    targetDate: string,
    options: KellyRequestOptions,
    fallbackSnapshot: KellyWorkbenchResponse | null,
  ) {
    const task = withTimeout(
      this.buildKellyWorkbenchSnapshot(locationId, location, targetDate, options),
      KELLY_WORKBENCH_TOTAL_TIMEOUT_MS,
      () =>
        new AppError(
          504,
          "KELLY_WORKBENCH_TIMEOUT",
          `Kelly snapshot refresh exceeded ${KELLY_WORKBENCH_TOTAL_TIMEOUT_MS}ms.`,
          {
            retryable: true,
            staleAvailable: fallbackSnapshot !== null,
            lastSuccessAt: fallbackSnapshot?.generatedAt ?? this.kellyRuntimeHealth.lastSnapshotSuccessAt,
          },
        ),
    )
      .then((snapshot) => {
        this.writeKellySnapshotResult(cacheKey, snapshot);
        this.writeKellyStreamModelContext(cacheKey, snapshot.probabilityCurve, snapshot.distributionSummary.shrink);
        return snapshot;
      })
      .catch((error) => {
        if (fallbackSnapshot) {
          const snapshot = this.buildKellyFallbackSnapshotFromCache(fallbackSnapshot, error);
          this.writeKellySnapshotResult(cacheKey, snapshot);
          return snapshot;
        }
        throw error;
      });

    this.kellySnapshotInFlight.set(cacheKey, task);
    void task.finally(() => {
      if (this.kellySnapshotInFlight.get(cacheKey) === task) {
        this.kellySnapshotInFlight.delete(cacheKey);
      }
    });

    return task;
  }

  private recordKellySnapshotSuccess(details: {
    generatedAt: string;
    discoveryFetchedAt: string | null;
    orderbookFetchedAt: string | null;
    repricedAt: string | null;
    stageTimings: Partial<KellyRuntimeStageTimings>;
  }) {
    this.kellyRuntimeHealth.lastSnapshotSuccessAt = details.generatedAt;
    this.kellyRuntimeHealth.lastSnapshotErrorAt = null;
    this.kellyRuntimeHealth.lastSnapshotError = null;
    this.kellyRuntimeHealth.lastMarketDiscoveryAt = details.discoveryFetchedAt ?? this.kellyRuntimeHealth.lastMarketDiscoveryAt;
    this.kellyRuntimeHealth.lastOrderbookAt = details.orderbookFetchedAt ?? this.kellyRuntimeHealth.lastOrderbookAt;
    this.kellyRuntimeHealth.lastRepricedAt = details.repricedAt ?? this.kellyRuntimeHealth.lastRepricedAt;
    this.kellyRuntimeHealth.lastStageTimingsMs = cloneKellyStageTimings(details.stageTimings);
  }

  private recordKellySnapshotFailure(error: unknown, stageTimings: Partial<KellyRuntimeStageTimings>) {
    this.kellyRuntimeHealth.lastSnapshotErrorAt = new Date().toISOString();
    this.kellyRuntimeHealth.lastSnapshotError = error instanceof Error ? error.message : String(error);
    this.kellyRuntimeHealth.lastStageTimingsMs = cloneKellyStageTimings(stageTimings);
  }

  private recordKellyStreamEvent(generatedAt: string, fallbackMode?: boolean) {
    this.kellyRuntimeHealth.lastStreamEventAt = generatedAt;
    if (typeof fallbackMode === "boolean") {
      this.kellyRuntimeHealth.fallbackMode = fallbackMode;
    }
  }

  private recordKellySignal(occurredAt: string) {
    this.kellyRuntimeHealth.lastSignalAt = occurredAt;
  }

  private recordKellyOrderbookAttempt(at = new Date().toISOString()) {
    this.kellyRuntimeHealth.lastOrderbookAttemptAt = at;
  }

  private recordKellyOrderbookSuccess(details?: { observedAt?: string | null; completedAt?: string }) {
    const completedAt = details?.completedAt ?? new Date().toISOString();
    this.kellyRuntimeHealth.lastOrderbookSuccessAt = completedAt;
    if (details?.observedAt) {
      this.kellyRuntimeHealth.lastOrderbookAt = details.observedAt;
    }
  }

  private recordKellyOrderbookFailure(reasonCode: string, failedAt = new Date().toISOString()) {
    this.kellyRuntimeHealth.lastOrderbookFailureAt = failedAt;
    this.kellyRuntimeHealth.lastOrderbookFailureCode = reasonCode;
  }

  private resolveKellyOrderbookFailureCode(error: unknown) {
    if (error instanceof AppError) {
      return error.code;
    }

    if (error instanceof Error && error.name) {
      return error.name;
    }

    return "POLYMARKET_ORDERBOOK_REFRESH_FAILED";
  }

  private hasKellyOrderBookCoverage(
    tokenIds: string[],
    books: Map<string, NormalizedOrderBook> | null | undefined,
  ) {
    if (!books) {
      return false;
    }

    return [...new Set(tokenIds.filter(Boolean))].every((tokenId) => books.has(tokenId));
  }

  private syncKellyHubCount() {
    this.kellyRuntimeHealth.activeHubCount = this.kellyStreamHubs.size;
  }

  private syncKellyFallbackMode() {
    this.kellyRuntimeHealth.fallbackMode = [...this.kellyStreamHubs.values()].some((hub) => Boolean(hub.fallbackTimer));
  }

  getKellyRuntimeHealth(): KellyRuntimeHealth {
    return {
      ...this.kellyRuntimeHealth,
      lastStageTimingsMs: cloneKellyStageTimings(this.kellyRuntimeHealth.lastStageTimingsMs),
      activeHubCount: this.kellyStreamHubs.size,
    };
  }

  getSystemStatus(): ServiceRuntimeStatus {
    return {
      caches: {
        week: summarizeCacheMap(this.weekCaches),
        multiModelImage: summarizeCacheMap(this.multiModelImageCaches),
        multiModelDistribution: summarizeCacheMap(this.multiModelDistributionCaches),
      },
      kelly: this.getKellyRuntimeHealth(),
    };
  }

  private invalidateKellySnapshotResults(locationId: LocationInfo["id"], targetDate: string) {
    const prefix = `${locationId}::${targetDate}::`;
    for (const key of this.kellySnapshotResults.keys()) {
      if (key.startsWith(prefix)) {
        this.kellySnapshotResults.delete(key);
      }
    }
  }

  private requireLocation(locationId: LocationInfo["id"]) {
    if (!this.allowedLocationIds.has(locationId)) {
      throw new AppError(400, "BAD_REQUEST", `Unknown locationId '${locationId}'.`);
    }

    return resolveLocation(locationId);
  }

  private getWeekCache(locationId: LocationInfo["id"]) {
    const existing = this.weekCaches.get(locationId);
    if (existing) {
      return existing;
    }

    const location = this.requireLocation(locationId);
    const cache = new RefreshableCache<WeekCacheValue>(config.weekPageTtlMs, async () =>
      withWeekCacheLoadSlot(async () => {
        const weekPageSignal = createWeekPageLoaderSignal();
        const html = await withTimeout(
          fetchText(location.weekPageUrl, { signal: weekPageSignal }),
          METEOBLUE_WEEK_PAGE_TOTAL_TIMEOUT_MS,
          () =>
            new AppError(
              504,
              "WEEK_PAGE_TIMEOUT",
              `Meteoblue week page fetch exceeded ${METEOBLUE_WEEK_PAGE_TOTAL_TIMEOUT_MS}ms.`,
              {
                retryable: true,
              },
            ),
        );
        const fetchedAt = new Date();
        const parsed = parseWeekPage(html, fetchedAt, location.timezone, location.name, location.fallbackDisplayUnit);
        const hasOneHourTable = parsed.oneHourItems.length > 0;
        const oneHourWarnings = [...parsed.oneHourWarnings];
        let meteogramRaw = "";
        let meteogramItems: HourlyWeatherResponse["items"] = [];

        try {
          const meteogramHighchartsUrl = extractWeekMeteogramHighchartsUrl(html);
          const meteogramTemperatureUnit = resolveWeekMeteogramTemperatureUnit(
            meteogramHighchartsUrl,
            location.fallbackDisplayUnit,
          );
          const meteogramSignal = hasOneHourTable
            ? createOptionalWeekMeteogramLoaderSignal()
            : createWeekMeteogramLoaderSignal();
          const meteogramTimeoutMs = hasOneHourTable
            ? METEOBLUE_WEEK_OPTIONAL_METEOGRAM_TIMEOUT_MS + 1_000
            : METEOBLUE_WEEK_METEOGRAM_TOTAL_TIMEOUT_MS;
          meteogramRaw = await withTimeout(
            fetchText(meteogramHighchartsUrl, { signal: meteogramSignal }),
            meteogramTimeoutMs,
            () =>
              new AppError(
                504,
                "WEEK_METEOGRAM_TIMEOUT",
                `Meteoblue week meteogram fetch exceeded ${meteogramTimeoutMs}ms.`,
                {
                  retryable: true,
                },
              ),
          );
          const meteogram = parseWeekMeteogramHighcharts(meteogramRaw, location.timezone, meteogramTemperatureUnit);
          meteogramItems = meteogram.items;
        } catch (error) {
          if (!hasOneHourTable) {
            throw error;
          }

          const detail = error instanceof Error ? error.message : String(error);
          oneHourWarnings.push(
            `Embedded meteogram enrichment unavailable; using parsed week table data only. ${detail}`.trim(),
          );
        }
        const mergedOneHourItems = mergeHourlyItems(parsed.oneHourItems, meteogramItems);
        if (!hasOneHourTable) {
          oneHourWarnings.push("1h data fell back to embedded meteogram because the 1h table could not be parsed.");
        }

        return {
          fetchedAt: fetchedAt.toISOString(),
          sourceObservedAt: parsed.sourceObservedAt,
          weekPageHtml: html,
          weekTable1h: parsed.oneHourItems,
          weekTable3h: parsed.threeHourItems,
          weekMeteogramHighchartsRawJson: meteogramRaw,
          weekMeteogramHighcharts: meteogramItems,
          weatherReportRaw: parsed.report,
          hourly: {
            "1h": {
              items: hasOneHourTable ? mergedOneHourItems : meteogramItems,
              sourceType: hasOneHourTable ? "week-table-1h" : "week-meteogram-highcharts",
              warnings: oneHourWarnings,
              partial: hasOneHourTable ? parsed.oneHourPartial : true,
              preferredItems: parsed.oneHourItems,
              fallbackItems: meteogramItems,
              fieldDiagnostics: parsed.oneHourFieldDiagnostics,
            },
            "3h": {
              items: parsed.threeHourItems,
              sourceType: "week-table-3h",
              warnings: parsed.warnings,
              partial: parsed.partial,
              preferredItems: parsed.threeHourItems,
              fieldDiagnostics: null,
            },
          },
          report: {
            location: {
              id: location.id,
              name: location.name,
              timezone: location.timezone,
            },
            pageUrl: location.weekPageUrl,
            parserVersion: WEEK_PARSER_VERSION,
            available: parsed.report.available,
            titleEn: parsed.report.titleEn,
            sourceTextEn: parsed.report.sourceTextEn,
            textZh: parsed.report.textZh,
            metrics: parsed.report.metrics,
            warnings: parsed.report.warnings,
          },
        };
      }),
    );

    this.weekCaches.set(locationId, cache);
    return cache;
  }

  private getMultiModelImageCache(locationId: LocationInfo["id"]) {
    const existing = this.multiModelImageCaches.get(locationId);
    if (existing) {
      return existing;
    }

    const location = this.requireLocation(locationId);
    const cache = new RefreshableCache<ImageCacheValue>(config.multimodelImageTtlMs, async () => {
      const pageHtml = await withTimeout(
        fetchText(location.multimodelPageUrl, { signal: createMultiModelLoaderSignal() }),
        METEOBLUE_MULTIMODEL_TOTAL_TIMEOUT_MS,
        () =>
          new AppError(
            504,
            "MULTIMODEL_PAGE_TIMEOUT",
            `Meteoblue multimodel page fetch exceeded ${METEOBLUE_MULTIMODEL_TOTAL_TIMEOUT_MS}ms.`,
            {
              retryable: true,
            },
          ),
      );
      const pageFetchedAt = new Date().toISOString();
      const imageUrl = extractMultiModelImageUrl(pageHtml);
      const image = await withTimeout(
        fetchBinary(imageUrl, { signal: createMultiModelLoaderSignal() }),
        METEOBLUE_MULTIMODEL_TOTAL_TIMEOUT_MS,
        () =>
          new AppError(
            504,
            "MULTIMODEL_IMAGE_TIMEOUT",
            `Meteoblue multimodel image fetch exceeded ${METEOBLUE_MULTIMODEL_TOTAL_TIMEOUT_MS}ms.`,
            {
              retryable: true,
            },
          ),
      );

      if (!image.contentType.toLowerCase().includes("image/png")) {
        throw new AppError(
          503,
          "MULTIMODEL_IMAGE_INVALID_CONTENT_TYPE",
          `Expected image/png content-type, got ${image.contentType}.`,
          {
            retryable: true,
          },
        );
      }

      return {
        pageFetchedAt,
        imageFetchedAt: new Date().toISOString(),
        imageUrl,
        contentType: image.contentType,
        body: image.body,
      };
    });

    this.multiModelImageCaches.set(locationId, cache);
    return cache;
  }

  private getMultiModelDistributionCache(locationId: LocationInfo["id"]) {
    const existing = this.multiModelDistributionCaches.get(locationId);
    if (existing) {
      return existing;
    }

    const location = this.requireLocation(locationId);
    const cache = new RefreshableCache<MultiModelDistributionCacheValue>(
      config.multimodelDistributionTtlMs,
      async () =>
        await withTimeout(
          loadMultiModelDistribution(
            location.multimodelPageUrl,
            location.timezone,
            createMultiModelLoaderSignal(),
            location.fallbackDisplayUnit,
          ),
          METEOBLUE_MULTIMODEL_TOTAL_TIMEOUT_MS,
          () =>
            new AppError(
              504,
              "MULTIMODEL_LOAD_TIMEOUT",
              `Meteoblue multimodel data fetch exceeded ${METEOBLUE_MULTIMODEL_TOTAL_TIMEOUT_MS}ms.`,
              {
                retryable: true,
              },
            ),
        ),
    );
    this.multiModelDistributionCaches.set(locationId, cache);
    return cache;
  }

  private getMetarCache(locationId: LocationInfo["id"]) {
    const existing = this.metarCaches.get(locationId);
    if (existing) {
      return existing;
    }

    const location = this.requireLocation(locationId);
    const cache = new RefreshableCache<MetarCacheValue>(
      60_000,
      async () =>
        await withTimeout(
          fetchMetarSnapshot({
            id: location.id,
            name: location.name,
            timezone: location.timezone,
          }),
          METEOBLUE_METAR_TOTAL_TIMEOUT_MS,
          () =>
            new AppError(504, "METAR_TIMEOUT", `METAR fetch exceeded ${METEOBLUE_METAR_TOTAL_TIMEOUT_MS}ms.`, {
              retryable: true,
            }),
        ),
    );

    this.metarCaches.set(locationId, cache);
    return cache;
  }

  private getTafCache(locationId: LocationInfo["id"]) {
    const existing = this.tafCaches.get(locationId);
    if (existing) {
      return existing;
    }

    const location = this.requireLocation(locationId);
    const cache = new RefreshableCache<TafCacheValue>(
      5 * 60_000,
      async () =>
        await withTimeout(
          fetchTafSnapshot({
            id: location.id,
            name: location.name,
            timezone: location.timezone,
          }),
          METEOBLUE_TAF_TOTAL_TIMEOUT_MS,
          () =>
            new AppError(504, "TAF_TIMEOUT", `TAF fetch exceeded ${METEOBLUE_TAF_TOTAL_TIMEOUT_MS}ms.`, {
              retryable: true,
            }),
        ),
    );

    this.tafCaches.set(locationId, cache);
    return cache;
  }

  private getSupplementalEvidenceCache(locationId: LocationInfo["id"]) {
    const existing = this.supplementalEvidenceCaches.get(locationId);
    if (existing) {
      return existing;
    }

    const location = this.requireLocation(locationId);
    const cache = new RefreshableCache<SupplementalEvidenceSnapshot>(
      SUPPLEMENTAL_EVIDENCE_TTL_MS,
      async () =>
        await withTimeout(
          fetchSupplementalEvidence({
            id: location.id,
            name: location.name,
            timezone: location.timezone,
            latitude: location.latitude,
            longitude: location.longitude,
          }),
          SUPPLEMENTAL_EVIDENCE_TOTAL_TIMEOUT_MS,
          () =>
            new AppError(
              504,
              "SUPPLEMENTAL_EVIDENCE_TIMEOUT",
              `Supplemental evidence fetch exceeded ${SUPPLEMENTAL_EVIDENCE_TOTAL_TIMEOUT_MS}ms.`,
              {
                retryable: true,
              },
            ),
        ),
    );

    this.supplementalEvidenceCaches.set(locationId, cache);
    return cache;
  }

  private getKellyMarketCache(locationId: LocationInfo["id"], targetDate: string) {
    const key = buildKellyCacheKey(locationId, targetDate);
    const existing = this.kellyMarketCaches.get(key);
    if (existing) {
      return existing;
    }

    const location = this.requireLocation(locationId);
    let cache: RefreshableCache<PolymarketDiscoveryResult> | null = null;
    cache = new RefreshableCache<PolymarketDiscoveryResult>(
      config.polymarketMarketTtlMs,
      async () => {
        const discoveryResult = await withKellyMarketLoadSlot(async () =>
          await withTimeout(
            this.polymarketClient.discoverMarkets(location, targetDate),
            POLYMARKET_DISCOVERY_TOTAL_TIMEOUT_MS,
            () =>
              new AppError(
                503,
                "POLYMARKET_DISCOVERY_TIMEOUT",
                `Polymarket discovery exceeded ${POLYMARKET_DISCOVERY_TOTAL_TIMEOUT_MS}ms.`,
                {
                  retryable: true,
                },
              ),
          ),
        );
        const previousDiscovery = cache?.peek().entry?.value ?? null;
        if (!hasDiscoveryCandidates(discoveryResult) && hasDiscoveryCandidates(previousDiscovery)) {
          throw new AppError(
            503,
            "POLYMARKET_DISCOVERY_EMPTY_REFRESH",
            "Polymarket discovery refresh returned no candidates; preserving the previous snapshot.",
            {
              retryable: true,
            },
          );
        }

        return discoveryResult;
      },
    );

    this.kellyMarketCaches.set(key, cache);
    return cache;
  }

  private getKellyOrderBookCache(locationId: LocationInfo["id"], targetDate: string) {
    const key = buildKellyCacheKey(locationId, targetDate);
    const existing = this.kellyOrderBookCaches.get(key);
    if (existing) {
      return existing;
    }

    let cache: RefreshableCache<Map<string, NormalizedOrderBook>> | null = null;
    cache = new RefreshableCache<Map<string, NormalizedOrderBook>>(config.polymarketOrderbookTtlMs, async () => {
      const marketResult = await this.getKellyMarketCache(locationId, targetDate).get({ allowStaleOnError: true });
      const tokenIds = marketResult.value.candidates
        .filter((candidate) => candidate.parseStatus === "matched")
        .flatMap((candidate) => [candidate.yesTokenId, candidate.noTokenId])
        .filter((tokenId): tokenId is string => Boolean(tokenId));

      if (!tokenIds.length) {
        return new Map<string, NormalizedOrderBook>();
      }

      const freshBooks = await this.fetchFreshKellyOrderBooks(locationId, targetDate, tokenIds);
      const previousBooks = cache?.peek().entry?.value ?? null;
      return this.mergeKellyOrderBooks(tokenIds, freshBooks, previousBooks);
    });

    this.kellyOrderBookCaches.set(key, cache);
    return cache;
  }

  private async fetchFreshKellyOrderBooks(
    locationId: LocationInfo["id"],
    targetDate: string,
    tokenIds: string[],
  ): Promise<Map<string, NormalizedOrderBook>> {
    const key = buildKellyCacheKey(locationId, targetDate);
    const existing = this.kellyOrderBookRefreshInFlight.get(key);
    if (existing) {
      return await existing;
    }

    this.recordKellyOrderbookAttempt();
    const task = withKellyOrderbookLoadSlot(async () =>
      await withTimeout(
        this.polymarketClient.fetchOrderBooks(tokenIds),
        POLYMARKET_ORDERBOOK_TOTAL_TIMEOUT_MS,
        () =>
          new AppError(
            503,
            "POLYMARKET_ORDERBOOK_TIMEOUT",
            `Polymarket orderbook fetch exceeded ${POLYMARKET_ORDERBOOK_TOTAL_TIMEOUT_MS}ms.`,
            {
              retryable: true,
            },
          ),
      ),
    )
      .then((books) => {
        this.recordKellyOrderbookSuccess({
          observedAt: resolveLatestOrderbookTimestamp(books),
        });
        return books;
      })
      .catch((error) => {
        this.recordKellyOrderbookFailure(this.resolveKellyOrderbookFailureCode(error));
        throw error;
      });
    this.kellyOrderBookRefreshInFlight.set(key, task);

    try {
      return await task;
    } finally {
      if (this.kellyOrderBookRefreshInFlight.get(key) === task) {
        this.kellyOrderBookRefreshInFlight.delete(key);
      }
    }
  }

  private mergeKellyOrderBooks(
    tokenIds: string[],
    freshBooks: Map<string, NormalizedOrderBook>,
    previousBooks: Map<string, NormalizedOrderBook> | null | undefined,
  ): Map<string, NormalizedOrderBook> {
    if (!previousBooks || previousBooks.size === 0) {
      return freshBooks;
    }

    const mergedBooks = new Map(freshBooks);
    for (const tokenId of new Set(tokenIds.filter(Boolean))) {
      if (mergedBooks.has(tokenId)) {
        continue;
      }

      const previousBook = previousBooks.get(tokenId);
      if (previousBook) {
        mergedBooks.set(tokenId, previousBook);
      }
    }

    return mergedBooks;
  }

  private resolveKellyObservationFloor(
    location: ReturnType<MeteoblueWeatherService["requireLocation"]>,
    targetDate: string,
    hourly: HourlyWeatherResponse,
    metarObservation: MetarObservation | null,
    recentMetarTemperatures: MetarTemperatureSample[],
    options: KellyRequestOptions,
  ) {
    const today = resolveKellyTargetDate(location.timezone);
    const cacheKey = buildKellyCacheKey(location.id, targetDate);
    const rememberedFloor = targetDate === today ? this.kellyObservationFloors.get(cacheKey) ?? null : null;
    const observedMetarHigh = resolveMetarObservedHighFloor(recentMetarTemperatures, targetDate, location.timezone);
    const floor = resolveObservationFloor(hourly, metarObservation, options, {
      targetDate,
      timeZone: location.timezone,
      rememberedFloor,
      observedMetarHigh,
    });

    if (targetDate === today && typeof floor.value === "number" && Number.isFinite(floor.value)) {
      this.kellyObservationFloors.set(cacheKey, {
        value: floor.value,
        source: floor.source,
        observedAt: floor.observedAt,
      });
    }

    return floor;
  }

  private rememberKellyFrameHistory(
    locationId: LocationInfo["id"],
    targetDate: string,
    nextFrames: KellyFramePoint[],
    generatedAt: string,
  ): KellyFramePoint[] {
    const key = buildKellyCacheKey(locationId, targetDate);
    const existing = this.kellyFrameHistories.get(key) ?? [];
    const merged = new Map<string, KellyFramePoint>();

    for (const frame of existing) {
      merged.set(frame.id, frame);
    }

    for (const frame of nextFrames) {
      merged.set(frame.id, frame);
    }

    const cutoffMs = Date.parse(generatedAt) - 60 * 60 * 1000;
    const history = [...merged.values()]
      .filter((frame) => {
        const frameTime = Date.parse(frame.generatedAt);
        return Number.isNaN(frameTime) || frameTime >= cutoffMs;
      })
      .sort((left, right) => left.generatedAt.localeCompare(right.generatedAt));

    this.kellyFrameHistories.set(key, history);
    return history;
  }

  private async repriceKellyStreamSnapshot({
    locationId,
    location,
    targetDate,
    options,
    matchedMarkets,
    trackedMarkets,
    bankroll,
    riskMode,
    minEdge,
    probabilityCurve,
    shrink,
    booksOverride,
    generatedAtOverride,
    orderbookObservedAtOverride,
  }: {
    locationId: LocationInfo["id"];
    location: ReturnType<MeteoblueWeatherService["requireLocation"]>;
    targetDate: string;
    options: KellyRequestOptions;
    matchedMarkets: KellyMatchedStreamMarket[];
    trackedMarkets: KellyWorkbenchResponse["markets"];
    bankroll: number;
    riskMode: KellyWorkbenchResponse["riskMode"];
    minEdge: number;
    probabilityCurve: KellyWorkbenchResponse["probabilityCurve"];
    shrink: number;
    booksOverride?: Map<string, NormalizedOrderBook>;
    generatedAtOverride?: string;
    orderbookObservedAtOverride?: string | null;
  }) {
    const streamKey = buildKellySnapshotRequestKey(locationId, targetDate, {
      ...options,
      bankroll,
      riskMode,
      minEdge,
    });
    const existing = this.kellyStreamRepriceInFlight.get(streamKey);
    if (existing) {
      return await existing;
    }

    const task = (async () => {
      const tokenIds = matchedMarkets.flatMap((market) => [market.yesTokenId, market.noTokenId]);
      const orderBookCache = this.getKellyOrderBookCache(locationId, targetDate);
      const cachedBooks = booksOverride ?? orderBookCache.peek().entry?.value ?? null;
      const [hourly, metarSnapshot] = await Promise.all([
        this.getHourly(locationId, "1h"),
        this.getMetarSnapshot(locationId),
      ]);
      let books: Map<string, NormalizedOrderBook>;
      if (booksOverride) {
        books = booksOverride;
      } else {
        const freshBooks = await this.fetchFreshKellyOrderBooks(locationId, targetDate, tokenIds);
        if (freshBooks.size === 0 && cachedBooks && cachedBooks.size > 0) {
          throw new AppError(
            503,
            "POLYMARKET_ORDERBOOK_REFRESH_EMPTY",
            "Polymarket orderbook refresh returned no fresh books.",
            {
              retryable: true,
            },
          );
        }

        books = this.mergeKellyOrderBooks(tokenIds, freshBooks, cachedBooks);
      }
      const generatedAt = generatedAtOverride ?? new Date().toISOString();
      const orderbookObservedAt = orderbookObservedAtOverride ?? resolveLatestOrderbookTimestamp(books);
      const repricedAt = generatedAt;
      if (!booksOverride) {
        orderBookCache.set(books, new Date(generatedAt));
      }
      this.invalidateKellySnapshotResults(locationId, targetDate);
      const metarObservation = metarSnapshot.observation;
      const observationFloor = this.resolveKellyObservationFloor(
        location,
        targetDate,
        hourly,
        metarObservation,
        metarSnapshot.recentTemperatures,
        options,
      );
      let nextProbabilityCurve = probabilityCurve;
      let nextShrink = shrink;
      const cachedModelContext = this.readKellyStreamModelContext(streamKey);
      if (cachedModelContext) {
        nextProbabilityCurve = cachedModelContext.probabilityCurve;
        nextShrink = cachedModelContext.shrink;
      } else {
        try {
          const resolvedActualTemperatureForInsight =
            options.actualTemperatureC ??
            metarObservation?.temperatureC ??
            hourly.current?.temperatureC ??
            undefined;
          const insight = await this.getMultiModelInsight(
            locationId,
            options.selectedHourTimestamp,
            resolvedActualTemperatureForInsight,
          );
          const targetDistributionTimestamp = resolveKellyDistributionTimestamp(
            insight.availableTimestamps,
            targetDate,
            location.timezone,
          );

          if (targetDistributionTimestamp) {
            const distribution = await this.getMultiModelDistribution(locationId, targetDistributionTimestamp, 1);
            const probabilityContext = buildKellyProbabilityContext({
              hourly,
              insight,
              distribution,
              metarObservation,
              options,
              targetDate,
              timeZone: location.timezone,
              observationFloorOverride: observationFloor,
            });
            nextProbabilityCurve = probabilityContext.curve;
            nextShrink = probabilityContext.shrink;
            this.writeKellyStreamModelContext(streamKey, nextProbabilityCurve, nextShrink);
          }
        } catch {
          // Keep live repricing available even if the auxiliary model context
          // cannot be refreshed for this tick. The latest observation floor still
          // applies against the last committed probability baseline.
        }
      }
      const rebasedMarkets = rebaseKellyMarketsForObservationFloor(
        trackedMarkets,
        nextProbabilityCurve,
        nextShrink,
        observationFloor.value,
      );
      const repricedMarkets = applyPricingToMarkets(rebasedMarkets, books, {
        bankroll,
        riskMode,
        minEdge,
      });
      const framePoints = buildReadableFramePoints(repricedMarkets, generatedAt);
      this.rememberKellyFrameHistory(locationId, targetDate, framePoints, generatedAt);
      return {
        books,
        framePoints,
        generatedAt,
        orderbookObservedAt,
        repricedAt,
        repricedMarkets,
      };
    })();

    this.kellyStreamRepriceInFlight.set(streamKey, task);

    try {
      return await task;
    } finally {
      if (this.kellyStreamRepriceInFlight.get(streamKey) === task) {
        this.kellyStreamRepriceInFlight.delete(streamKey);
      }
    }
  }

  async getHourly(locationId: LocationInfo["id"], mode: HourlyMode, limit?: number): Promise<HourlyWeatherResponse> {
    const location = this.requireLocation(locationId);
    const result = await this.getWeekCache(locationId).get({
      allowStaleOnError: true,
      staleWhileRevalidate: true,
    });
    const hourly = result.value.hourly[mode];
    const maxItems = typeof limit === "number" && limit > 0 ? limit : hourly.items.length;
    const warnings = [...hourly.warnings];
    const fallbackOnError = isFallbackErrorFreshness(result.freshness);

    const allItems = hourly.items;
    const nowMs = Date.now();
    let selectedItems = allItems.slice(0, maxItems);

    if (mode === "1h" && maxItems === 24) {
      const todayKey = localDateKey(new Date(nowMs).toISOString(), location.timezone);
      const fallbackDayKey = allItems[0] ? localDateKey(allItems[0].timestamp, location.timezone) : null;
      const targetDayKey = todayKey ?? fallbackDayKey;

      if (targetDayKey) {
        const sameDayItems = allItems.filter((item) => localDateKey(item.timestamp, location.timezone) === targetDayKey);
        if (sameDayItems.length > 0) {
          selectedItems = sameDayItems.slice(0, 24);
        }
      }
    }

    if (mode === "1h" && maxItems >= 24 && selectedItems.length < 24) {
      warnings.push("The parsed 1h view did not expose a full 24-hour window; returned the available hours.");
    }

    if (isRevalidatingFreshness(result.freshness)) {
      warnings.push("Background refresh is in progress; showing the most recent cached week page data.");
    } else if (fallbackOnError) {
      warnings.push("Serving stale week page data because the latest refresh failed.");
    }

    const sanitizedItems = sanitizeHourlyItems(selectedItems);
    const fieldCoverage = buildFieldCoverage({
      items: sanitizedItems,
      sourceType: hourly.sourceType,
      preferredItems: hourly.preferredItems,
      fallbackItems: hourly.fallbackItems,
      fieldDiagnostics: hourly.fieldDiagnostics,
    });
    const currentIndex = nearestItemIndex(sanitizedItems, nowMs);
    const current =
      currentIndex >= 0
        ? {
            timestamp: sanitizedItems[currentIndex]?.timestamp ?? "",
            temperatureC: sanitizedItems[currentIndex]?.temperatureC ?? null,
            index: currentIndex,
          }
        : null;

    const response = {
      location: {
        id: location.id,
        name: location.name,
        timezone: location.timezone,
      },
      fetchedAt: result.value.fetchedAt,
      sourceObservedAt: result.value.sourceObservedAt,
      mode,
      periodHours: mode === "1h" ? 1 : 3,
      sourceType: hourly.sourceType,
      stale: fallbackOnError,
      freshness: result.freshness,
      pageUrl: location.weekPageUrl,
      parserVersion: WEEK_PARSER_VERSION,
      items: sanitizedItems,
      fieldCoverage,
      partial: hourly.partial,
      warnings,
      cacheHit: result.cacheHit,
      current,
    };
    return response;
  }

  async getWeatherReport(locationId: LocationInfo["id"]): Promise<WeatherReportResponse> {
    const location = this.requireLocation(locationId);
    const result = await this.getWeekCache(locationId).get({
      allowStaleOnError: true,
      staleWhileRevalidate: true,
    });
    const report = result.value.report;
    const warnings = [...report.warnings];
    const fallbackOnError = isFallbackErrorFreshness(result.freshness);
    const textZh = sanitizeReportTextZh({
      textZh: report.textZh,
      sourceTextEn: report.sourceTextEn,
      titleEn: report.titleEn,
      metrics: report.metrics,
      pageTemperatureUnit: location.fallbackDisplayUnit,
    });

    if (normalizeText(report.textZh ?? "") !== normalizeText(textZh)) {
      warnings.push("Weather report translation fallback applied.");
    }

    if (isRevalidatingFreshness(result.freshness)) {
      warnings.push("Background refresh is in progress; showing the most recent cached week page data.");
    } else if (fallbackOnError) {
      warnings.push("Serving stale week page data because the latest refresh failed.");
    }

    const response = {
      ...report,
      textZh,
      fetchedAt: result.value.fetchedAt,
      sourceObservedAt: result.value.sourceObservedAt,
      stale: fallbackOnError,
      freshness: result.freshness,
      cacheHit: result.cacheHit,
      warnings,
    };
    return response;
  }

  async getMetarSnapshot(locationId: LocationInfo["id"]): Promise<DashboardMetarSnapshot> {
    try {
      const result = await this.getMetarCache(locationId).get({
        allowStaleOnError: true,
        staleWhileRevalidate: true,
      });
      const observation = result.value.observation
        ? {
            ...result.value.observation,
            stale: result.stale,
            freshness: result.freshness,
            cacheHit: result.cacheHit,
          }
        : null;

      return normalizeDashboardMetarSnapshot({
        observation,
        recentTemperatures: result.value.recentTemperatures,
        recentObservations: result.value.recentObservations,
        recentReports: result.value.recentReports,
      });
    } catch {
      return normalizeDashboardMetarSnapshot();
    }
  }

  async getTafSnapshot(locationId: LocationInfo["id"]): Promise<DashboardTafSnapshot> {
    try {
      const result = await this.getTafCache(locationId).get({
        allowStaleOnError: true,
        staleWhileRevalidate: true,
      });
      const forecast = result.value.forecast
        ? {
            ...result.value.forecast,
            stale: result.stale,
            freshness: result.freshness,
            cacheHit: result.cacheHit,
          }
        : null;

      return {
        forecast,
        forecasts: result.value.forecasts,
      };
    } catch {
      return {
        forecast: null,
        forecasts: [],
      };
    }
  }

  async getSupplementalEvidence(locationId: LocationInfo["id"]): Promise<SupplementalEvidenceSnapshot> {
    const location = this.requireLocation(locationId);

    try {
      const result = await this.getSupplementalEvidenceCache(locationId).get({
        allowStaleOnError: true,
        staleWhileRevalidate: true,
      });

      return applySupplementalRuntimeState(result.value, {
        stale: result.stale,
        freshness: result.freshness,
        cacheHit: result.cacheHit,
      });
    } catch (error) {
      return buildEmptySupplementalEvidence(
        {
          id: location.id,
          name: location.name,
          timezone: location.timezone,
          latitude: location.latitude,
          longitude: location.longitude,
        },
        `Supplemental evidence fallback used: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getMultiModelImage(locationId: LocationInfo["id"], allowStale: boolean): Promise<MultiModelImageResponse> {
    const location = this.requireLocation(locationId);
    try {
      const result = await this.getMultiModelImageCache(locationId).get({
        allowStaleOnError: allowStale,
        staleWhileRevalidate: allowStale,
      });
      const fallbackOnError = isFallbackErrorFreshness(result.freshness);
      const response = {
        contentType: result.value.contentType,
        body: result.value.body,
        cacheHit: result.cacheHit,
        stale: fallbackOnError,
        freshness: result.freshness,
        headers: {
          "cache-control": allowStale ? "private, max-age=0, must-revalidate" : "no-store",
          "x-weather-source": "meteoblue-web",
          "x-weather-page-url": location.multimodelPageUrl,
          "x-weather-page-fetched-at": result.value.pageFetchedAt,
          "x-weather-image-fetched-at": result.value.imageFetchedAt,
          "x-weather-stale": String(fallbackOnError),
          "x-weather-freshness": result.freshness,
          "x-weather-parser-version": MULTIMODEL_IMAGE_VERSION,
        },
      };
      return response;
    } catch {
      const snapshot = this.getMultiModelImageCache(locationId).peek();
      throw new AppError(
        503,
        "MULTIMODEL_IMAGE_UNAVAILABLE",
        "Could not fetch the official meteoblue multimodel image.",
        {
          retryable: true,
          staleAvailable: snapshot.entry !== null,
          lastSuccessAt: snapshot.entry?.value.imageFetchedAt ?? null,
        },
      );
    }
  }

  async getMultiModelStatus(locationId: LocationInfo["id"]): Promise<MultiModelStatusResponse> {
    const location = this.requireLocation(locationId);
    const distributionCache = this.getMultiModelDistributionCache(locationId);
    const snapshot = this.getMultiModelImageCache(locationId).peek();
    const distributionSnapshot = distributionCache.peek();
    const imageInFlight = snapshot.inFlight;
    const analysisInFlight = distributionSnapshot.inFlight;
    const resolvedImageUrl = snapshot.entry?.value.imageUrl ?? distributionSnapshot.entry?.value.pngUrl ?? null;
    const imageUrlFound = resolvedImageUrl !== null;
    const imageFreshness = resolveSnapshotFreshness(snapshot) ?? (imageInFlight ? "revalidating" : "fresh");
    const analysisFreshness =
      resolveSnapshotFreshness(distributionSnapshot) ?? (analysisInFlight ? "revalidating" : "fresh");
    const imageStatus = snapshot.entry || imageUrlFound
      ? imageInFlight
        ? "revalidating"
        : "ready"
      : imageInFlight
        ? "revalidating"
        : "unavailable";
    const hasAnalysisFallback = analysisFreshness === "fallback_error" && distributionSnapshot.entry !== null;
    const analysisStatus = hasAnalysisFallback
      ? "fallback_error"
      : distributionSnapshot.entry
        ? analysisInFlight
          ? "revalidating"
          : "ready"
        : analysisInFlight
          ? "revalidating"
          : "unavailable";
    const freshness =
      imageFreshness === "fallback_error" || analysisFreshness === "fallback_error"
        ? "fallback_error"
        : imageInFlight || analysisInFlight
          ? "revalidating"
          : "fresh";
    const displayUnit = location.fallbackDisplayUnit;
    return {
      location: {
        id: location.id,
        name: location.name,
        timezone: location.timezone,
      },
      displayUnit,
      fallbackDisplayUnit: displayUnit,
      pageFetchedAt: snapshot.entry?.value.pageFetchedAt ?? distributionSnapshot.entry?.value.pageFetchedAt ?? null,
      imageFetchedAt: snapshot.entry?.value.imageFetchedAt ?? null,
      imageUrlFound,
      cacheHit:
        (snapshot.entry !== null && snapshot.entry.expiresAt > Date.now()) ||
        (distributionSnapshot.entry !== null && distributionSnapshot.entry.expiresAt > Date.now()),
      stale: freshness === "fallback_error",
      freshness,
      imageStatus,
      analysisStatus,
      lastError: snapshot.lastError ?? distributionSnapshot.lastError,
      lastSuccessAt: snapshot.entry?.value.imageFetchedAt ?? distributionSnapshot.lastSuccessAt,
      imageUrl: resolvedImageUrl,
      pageUrl: location.multimodelPageUrl,
    };
  }

  async getMultiModelDistribution(
    locationId: LocationInfo["id"],
    timestamp?: string,
    bucketSizeC = 1,
  ): Promise<MultiModelDistributionResponse> {
    const location = this.requireLocation(locationId);
    try {
      const result = await this.getMultiModelDistributionCache(locationId).get({
        allowStaleOnError: true,
      });
      const fallbackOnError = isFallbackErrorFreshness(result.freshness);
      const response = buildMultiModelDistributionResponse(
        result.value,
        {
          id: location.id,
          name: location.name,
          timezone: location.timezone,
        },
        location.multimodelPageUrl,
        timestamp,
        new Date().toISOString(),
        bucketSizeC,
        {
          stale: fallbackOnError,
          cacheHit: result.cacheHit,
          freshnessState: result.freshness,
        },
      );

      if (isRevalidatingFreshness(result.freshness)) {
        response.warnings.push("Background refresh is in progress; showing the most recent cached multimodel statistics.");
      } else if (fallbackOnError) {
        response.warnings.push(
          "Serving stale page-derived multimodel statistics because the latest highcharts refresh failed.",
        );
      }
      return response;
    } catch (error) {
      const snapshot = this.getMultiModelDistributionCache(locationId).peek();

      if (error instanceof AppError) {
        throw new AppError(error.statusCode, error.code, error.message, {
          retryable: error.retryable,
          staleAvailable: error.staleAvailable || snapshot.entry !== null,
          lastSuccessAt: error.lastSuccessAt ?? snapshot.lastSuccessAt,
        });
      }

      throw new AppError(
        503,
        "MULTIMODEL_DISTRIBUTION_UNAVAILABLE",
        error instanceof Error ? error.message : "Could not load multimodel distribution.",
        {
          retryable: true,
          staleAvailable: snapshot.entry !== null,
          lastSuccessAt: snapshot.lastSuccessAt,
        },
      );
    }
  }

  async getMultiModelInsight(
    locationId: LocationInfo["id"],
    timestamp?: string,
    actualTemperatureC?: number,
  ): Promise<MultiModelInsightResponse> {
    const location = this.requireLocation(locationId);
    try {
      const result = await this.getMultiModelDistributionCache(locationId).get({
        allowStaleOnError: true,
      });
      const fallbackOnError = isFallbackErrorFreshness(result.freshness);
      const response = buildMultiModelInsightResponse(
        result.value,
        {
          id: location.id,
          name: location.name,
          timezone: location.timezone,
        },
        location.multimodelPageUrl,
        {
          requestedTimestamp: timestamp,
          actualTemperatureC,
          nowIso: new Date().toISOString(),
        },
        {
          stale: fallbackOnError,
          cacheHit: result.cacheHit,
          freshnessState: result.freshness,
        },
      );

      if (isRevalidatingFreshness(result.freshness)) {
        response.warnings.push("Background refresh is in progress; showing the most recent cached multimodel insights.");
      } else if (fallbackOnError) {
        response.warnings.push(
          "Serving stale page-derived multimodel insights because the latest highcharts refresh failed.",
        );
      }
      return response;
    } catch (error) {
      const snapshot = this.getMultiModelDistributionCache(locationId).peek();

      if (error instanceof AppError) {
        throw new AppError(error.statusCode, error.code, error.message, {
          retryable: error.retryable,
          staleAvailable: error.staleAvailable || snapshot.entry !== null,
          lastSuccessAt: error.lastSuccessAt ?? snapshot.lastSuccessAt,
        });
      }

      throw new AppError(
        503,
        "MULTIMODEL_INSIGHT_UNAVAILABLE",
        error instanceof Error ? error.message : "Could not load multimodel insights.",
        {
          retryable: true,
          staleAvailable: snapshot.entry !== null,
          lastSuccessAt: snapshot.lastSuccessAt,
        },
      );
    }
  }

  async getKellyWorkbench(
    locationId: LocationInfo["id"],
    options: KellyRequestOptions = {},
  ): Promise<KellyWorkbenchResponse> {
    const location = this.requireLocation(locationId);
    const targetDate = resolveKellyTargetDate(location.timezone, options.targetDate);
    const cacheKey = buildKellySnapshotRequestKey(locationId, targetDate, options);
    const forceRefresh = options.forceRefresh === true;
    const cachedEntry = this.readKellySnapshotResultEntry(cacheKey);
    const cachedSnapshot = cachedEntry?.snapshot ?? null;
    const hasFreshSnapshot = Boolean(cachedEntry && cachedEntry.expiresAt > Date.now());

    if (!forceRefresh && hasFreshSnapshot && cachedSnapshot) {
      return cachedSnapshot;
    }

    if (!forceRefresh && cachedSnapshot) {
      if (!this.kellySnapshotInFlight.has(cacheKey)) {
        this.createKellyWorkbenchSnapshotTask(cacheKey, locationId, location, targetDate, options, cachedSnapshot);
      }
      return this.buildKellyRevalidatingSnapshotFromCache(cachedSnapshot);
    }

    if (forceRefresh && cachedSnapshot) {
      const refreshTask =
        this.kellySnapshotInFlight.get(cacheKey) ??
        this.createKellyWorkbenchSnapshotTask(cacheKey, locationId, location, targetDate, options, cachedSnapshot);

      try {
        return await withTimeout(
          refreshTask,
          KELLY_FORCE_REFRESH_SOFT_TIMEOUT_MS,
          () =>
            new AppError(
              503,
              "KELLY_FORCE_REFRESH_TIMEOUT",
              `Kelly force refresh exceeded ${KELLY_FORCE_REFRESH_SOFT_TIMEOUT_MS}ms.`,
              {
                retryable: true,
                staleAvailable: true,
                lastSuccessAt: cachedSnapshot.generatedAt,
              },
            ),
        );
      } catch (error) {
        if (error instanceof AppError && error.code === "KELLY_FORCE_REFRESH_TIMEOUT") {
          return this.buildKellyRevalidatingSnapshotFromCache(cachedSnapshot);
        }

        return this.buildKellyFallbackSnapshotFromCache(cachedSnapshot, error);
      }
    }

    if (!forceRefresh) {
      const existing = this.kellySnapshotInFlight.get(cacheKey);
      if (existing) {
        return await existing;
      }
    }

    return await this.createKellyWorkbenchSnapshotTask(cacheKey, locationId, location, targetDate, options, cachedSnapshot);
  }

  private async buildKellyWorkbenchSnapshot(
    locationId: LocationInfo["id"],
    location: ReturnType<MeteoblueWeatherService["requireLocation"]>,
    targetDate: string,
    options: KellyRequestOptions,
  ): Promise<KellyWorkbenchResponse> {
    const stageTimings: Partial<KellyRuntimeStageTimings> = {};
    const totalStartedAt = Date.now();

    try {
      const tafOutcomePromise = withTimeout(
        this.getTafSnapshot(locationId),
        2_000,
        () =>
          new AppError(504, "TAF_OPTIONAL_TIMEOUT", "TAF optional fetch exceeded 2000ms.", {
            retryable: true,
          }),
      )
        .then((snapshot) => ({ ok: true as const, snapshot }))
        .catch((error) => ({ ok: false as const, error }));

      const [hourly, report, metarSnapshot, tafOutcome] = await Promise.all([
        measureAsync(stageTimings, "hourly", async () => await this.getHourly(locationId, "1h", 24)),
        measureAsync(stageTimings, "report", async () => await this.getWeatherReport(locationId)),
        measureAsync(stageTimings, "metar", async () => await this.getMetarSnapshot(locationId)),
        tafOutcomePromise,
      ]);
      const metarObservation = metarSnapshot.observation;
      const resolvedActualTemperatureForInsight =
        options.actualTemperatureC ??
        metarObservation?.temperatureC ??
        hourly.current?.temperatureC ??
        undefined;
      const insight = await measureAsync(stageTimings, "insight", async () =>
        await this.getMultiModelInsight(
          locationId,
          options.selectedHourTimestamp,
          resolvedActualTemperatureForInsight,
        ),
      );
      const distributionSelection = resolveKellyDistributionSelection(
        insight.availableTimestamps,
        targetDate,
        location.timezone,
      );
      const targetDistributionTimestamp = distributionSelection.timestamp;
      const effectiveTargetDate = distributionSelection.effectiveTargetDate;
      const fallbackSnapshot = this.readKellySnapshotResult(
        buildKellySnapshotRequestKey(locationId, targetDate, options),
        { includeExpired: true },
      );
      const retainedStageSnapshot =
        fallbackSnapshot && fallbackSnapshot.targetDate === effectiveTargetDate ? fallbackSnapshot : null;

      if (!targetDistributionTimestamp) {
        throw new AppError(
          400,
          "BAD_REQUEST",
          `Query parameter 'targetDate' is not available for this location: '${targetDate}'.`,
        );
      }

      const distribution = await measureAsync(stageTimings, "distribution", async () =>
        await this.getMultiModelDistribution(locationId, targetDistributionTimestamp, 1),
      );

      const warnings: string[] = [];
      if (distributionSelection.usedFallback) {
        warnings.push(
          `Requested Kelly targetDate '${distributionSelection.requestedTargetDate}' is unavailable; auto-fallback to '${effectiveTargetDate}'.`,
        );
      }
      if (!options.actualTemperatureC && metarObservation === null) {
        warnings.push("METAR 实况当前不可用，Kelly 下界约束回退到站点当前小时温度。");
      }
      let tafForecast: KellyWeatherEvidence["tafForecast"] = null;
      if (tafOutcome.ok) {
        tafForecast = tafOutcome.snapshot.forecast;
      }
      const strictMarketRefresh = options.forceRefresh === true;
      let discoveryResult: PolymarketDiscoveryResult | null = null;
      let discoveryFetchedAt: string | null = null;
      const marketCache = this.getKellyMarketCache(locationId, effectiveTargetDate);

      try {
        const marketResult = await measureAsync(stageTimings, "marketDiscovery", async () => {
          return await loadKellyStageCache(marketCache, {
            allowStaleOnError: true,
            forceRefresh: options.forceRefresh,
            softTimeoutMs: strictMarketRefresh ? null : KELLY_MARKET_DISCOVERY_STAGE_TIMEOUT_MS,
            createTimeoutError: () =>
              new AppError(
                503,
                "KELLY_MARKET_DISCOVERY_STAGE_TIMEOUT",
                `Kelly market discovery stage exceeded ${KELLY_MARKET_DISCOVERY_STAGE_TIMEOUT_MS}ms.`,
                {
                  retryable: true,
                },
              ),
          });
        });
        discoveryResult = marketResult.value;
        discoveryFetchedAt = discoveryResult.fetchedAt;
        pushRefreshableCacheWarning(warnings, marketResult.freshness, {
          revalidating: "市场目录后台刷新中，当前先展示最近一次成功结果。",
          fallbackError: "市场目录刷新失败，当前沿用最近一次成功结果。",
        });
        warnings.push(
          ...buildDiscoveryWarnings([
            ...discoveryResult.candidates,
            ...discoveryResult.inactiveCandidates,
          ]),
        );
      } catch (error) {
        if (strictMarketRefresh) {
          throw error;
        }
        const retainedDiscovery = buildRetainedDiscoveryResultFromSnapshot(retainedStageSnapshot);
        if (retainedDiscovery) {
          discoveryResult = retainedDiscovery;
          discoveryFetchedAt = retainedDiscovery.fetchedAt;
          marketCache.set(retainedDiscovery, new Date(retainedDiscovery.fetchedAt));
          appendWarningIfMissing(
            warnings,
            error instanceof AppError && error.code === "KELLY_MARKET_DISCOVERY_STAGE_TIMEOUT"
              ? "市场目录刷新较慢，当前沿用上一轮市场结果。"
              : "市场目录暂时不可用，当前沿用上一轮市场结果。",
          );
          warnings.push(
            ...buildDiscoveryWarnings([
              ...retainedDiscovery.candidates,
              ...retainedDiscovery.inactiveCandidates,
            ]),
          );
        } else {
          appendWarningIfMissing(
            warnings,
            error instanceof AppError && error.code === "KELLY_MARKET_DISCOVERY_STAGE_TIMEOUT"
              ? "市场目录刷新较慢，当前先展示天气判断，稍后会自动补齐。"
              : "市场目录暂时不可用，当前先展示天气判断。",
          );
        }
      }

      let orderBooks = new Map<string, NormalizedOrderBook>();
      let orderbookObservedAt: string | null = null;
      const orderBookCache = this.getKellyOrderBookCache(locationId, effectiveTargetDate);

      if (discoveryResult?.candidates.some((candidate) => candidate.parseStatus === "matched")) {
        try {
          const orderBookResult = await measureAsync(stageTimings, "orderbook", async () => {
            return await loadKellyStageCache(orderBookCache, {
              allowStaleOnError: !strictMarketRefresh,
              forceRefresh: options.forceRefresh,
              softTimeoutMs: strictMarketRefresh ? null : KELLY_ORDERBOOK_STAGE_TIMEOUT_MS,
              createTimeoutError: () =>
                new AppError(
                  503,
                  "KELLY_ORDERBOOK_STAGE_TIMEOUT",
                  `Kelly orderbook stage exceeded ${KELLY_ORDERBOOK_STAGE_TIMEOUT_MS}ms.`,
                  {
                    retryable: true,
                  },
                ),
            });
          });
          orderBooks = orderBookResult.value;
          orderbookObservedAt = resolveLatestOrderbookTimestamp(orderBooks);
          pushRefreshableCacheWarning(warnings, orderBookResult.freshness, {
            revalidating: "盘口后台刷新中，当前先展示最近一次成功结果。",
            fallbackError: "盘口刷新失败，当前沿用最近一次成功结果。",
          });
        } catch (error) {
          if (strictMarketRefresh) {
            throw error;
          }
          const retainedOrderBooks = buildRetainedOrderBooksFromSnapshot(retainedStageSnapshot);
          const matchedTokenIds =
            discoveryResult?.candidates
              .filter((candidate) => candidate.parseStatus === "matched")
              .flatMap((candidate) => [candidate.yesTokenId, candidate.noTokenId])
              .filter((tokenId): tokenId is string => Boolean(tokenId)) ?? [];
          const hasRetainedOrderbooks =
            retainedOrderBooks !== null &&
            matchedTokenIds.some((tokenId) => retainedOrderBooks.books.has(tokenId));

          if (retainedOrderBooks && hasRetainedOrderbooks) {
            orderBooks = retainedOrderBooks.books;
            orderbookObservedAt = retainedOrderBooks.observedAt;
            if (retainedOrderBooks.observedAt) {
              orderBookCache.set(retainedOrderBooks.books, new Date(retainedOrderBooks.observedAt));
            } else {
              orderBookCache.set(retainedOrderBooks.books);
            }
            appendWarningIfMissing(
              warnings,
              error instanceof AppError && error.code === "KELLY_ORDERBOOK_STAGE_TIMEOUT"
                ? "盘口刷新较慢，当前沿用最近一次可用价格。"
                : "盘口暂时不可用，当前沿用最近一次可用价格。",
            );
          } else {
            appendWarningIfMissing(
              warnings,
              error instanceof AppError && error.code === "KELLY_ORDERBOOK_STAGE_TIMEOUT"
                ? "盘口刷新较慢，当前先展示市场档位与天气判断，价格稍后自动补齐。"
                : "盘口暂时不可用，当前先展示市场档位与天气判断。",
            );
          }
        }
      }

      const pricingStartedAt = Date.now();
      const generatedAt = new Date().toISOString();
      const cacheKey = buildKellyCacheKey(locationId, effectiveTargetDate);
      const existingFrameSeries = this.kellyFrameHistories.get(cacheKey) ?? [];
      const hasActionableBookData = [...orderBooks.values()].some(
        (book) => book.bestAsk !== null || book.bestBid !== null,
      );
      const repricedAt = hasActionableBookData ? generatedAt : null;
      const observationFloor = this.resolveKellyObservationFloor(
        location,
        effectiveTargetDate,
        hourly,
        metarObservation,
        metarSnapshot.recentTemperatures,
        options,
      );

      const baseSnapshot = buildKellyWorkbench({
        location,
        targetDate: effectiveTargetDate,
        hourly,
        report,
        metarObservation,
        tafForecast,
        insight,
        distribution,
        discoveryCandidates: discoveryResult?.candidates ?? [],
        inactiveCandidates: discoveryResult?.inactiveCandidates ?? [],
        discoveryFetchedAt,
        sourceLinks:
          discoveryResult?.sourceLinks ?? {
            meteoblueWeekUrl: location.weekPageUrl,
            meteoblueMultimodelUrl: location.multimodelPageUrl,
            polymarketSearchUrl: `${config.polymarketGammaBaseUrl}/public-search?q=${encodeURIComponent(
              `${location.cityName} weather ${effectiveTargetDate}`,
            )}`,
            marketUrls: [],
          },
        orderBooks,
        priceFetchedAt: orderbookObservedAt,
        generatedAt,
        repricedAt,
        frameSeries: existingFrameSeries,
        options,
        warnings,
        observationFloorOverride: observationFloor,
      });
      const frameSeries = this.rememberKellyFrameHistory(
        locationId,
        effectiveTargetDate,
        buildReadableFramePoints(baseSnapshot.markets, generatedAt),
        generatedAt,
      );

      const snapshot = buildKellyWorkbench({
        location,
        targetDate: effectiveTargetDate,
        hourly,
        report,
        metarObservation,
        tafForecast,
        insight,
        distribution,
        discoveryCandidates: discoveryResult?.candidates ?? [],
        inactiveCandidates: discoveryResult?.inactiveCandidates ?? [],
        discoveryFetchedAt,
        sourceLinks:
          discoveryResult?.sourceLinks ?? {
            meteoblueWeekUrl: location.weekPageUrl,
            meteoblueMultimodelUrl: location.multimodelPageUrl,
            polymarketSearchUrl: `${config.polymarketGammaBaseUrl}/public-search?q=${encodeURIComponent(
              `${location.cityName} weather ${effectiveTargetDate}`,
            )}`,
            marketUrls: [],
          },
        orderBooks,
        priceFetchedAt: orderbookObservedAt,
        generatedAt,
        repricedAt,
        frameSeries,
        options,
        warnings,
        observationFloorOverride: observationFloor,
      });

      stageTimings.pricing = Date.now() - pricingStartedAt;
      stageTimings.total = Date.now() - totalStartedAt;
      this.recordKellySnapshotSuccess({
        generatedAt,
        discoveryFetchedAt,
        orderbookFetchedAt: orderbookObservedAt,
        repricedAt,
        stageTimings,
      });

      return {
        ...snapshot,
        // Keep the frame history on the bridge for repricing and audits, but
        // stop shipping it to the main Kelly page. That materially cuts GET
        // payload size during rapid location switches while preserving the API
        // field for compatibility.
        frameSeries: [],
      };
    } catch (error) {
      stageTimings.total = Date.now() - totalStartedAt;
      this.recordKellySnapshotFailure(error, stageTimings);
      throw error;
    }
  }

  private ensureKellyStreamHub(
    locationId: LocationInfo["id"],
    location: ReturnType<MeteoblueWeatherService["requireLocation"]>,
    targetDate: string,
    tokenIds: string[],
  ) {
    const key = buildKellyCacheKey(locationId, targetDate);
    let hub = this.kellyStreamHubs.get(key);
    let tokensExpanded = false;

    if (!hub) {
      hub = {
        key,
        locationId,
        location,
        targetDate,
        tokenIds: new Set<string>(),
        subscribers: new Map(),
        upstreamStream: null,
        upstreamConnected: false,
        lastSignalAt: null,
        lastRepricedAt: null,
        lastOrderbookAt: null,
        latestBooks: null,
        pendingTimer: null,
        fallbackTimer: null,
        idleTimer: null,
        repriceInFlight: null,
      };
      this.kellyStreamHubs.set(key, hub);
      this.syncKellyHubCount();
    }

    if (hub.idleTimer) {
      clearTimeout(hub.idleTimer);
      hub.idleTimer = null;
    }

    for (const tokenId of tokenIds.filter(Boolean)) {
      if (!hub.tokenIds.has(tokenId)) {
        hub.tokenIds.add(tokenId);
        tokensExpanded = true;
      }
    }

    return { hub, tokensExpanded };
  }

  private sendKellyStreamSubscriberMessage(
    subscriber: KellyStreamSubscriber,
    message: KellyStreamMessage,
    options?: { fallbackMode?: boolean },
  ) {
    if (subscriber.closed) {
      return;
    }

    subscriber.lastClientMessageAt = Date.now();
    this.recordKellyStreamEvent(message.generatedAt, options?.fallbackMode);
    subscriber.onMessage(message);
  }

  private broadcastKellyStreamHubStatus(
    hub: KellyStreamHub,
    buildMessage: (subscriber: KellyStreamSubscriber) => KellyStreamMessage,
    options?: { fallbackMode?: boolean },
  ) {
    for (const subscriber of hub.subscribers.values()) {
      this.sendKellyStreamSubscriberMessage(subscriber, buildMessage(subscriber), options);
    }
  }

  private stopKellyStreamSubscriberKeepalive(subscriber: KellyStreamSubscriber) {
    if (subscriber.keepaliveTimer) {
      clearInterval(subscriber.keepaliveTimer);
      subscriber.keepaliveTimer = null;
    }
  }

  private startKellyStreamSubscriberKeepalive(hub: KellyStreamHub, subscriber: KellyStreamSubscriber) {
    if (subscriber.keepaliveTimer) {
      return;
    }

    subscriber.keepaliveTimer = setInterval(() => {
      if (subscriber.closed || Date.now() - subscriber.lastClientMessageAt < KELLY_STREAM_CLIENT_KEEPALIVE_MS) {
        return;
      }

      if (!hub.fallbackTimer && !hub.upstreamConnected) {
        return;
      }

      const generatedAt = new Date().toISOString();
      if (hub.fallbackTimer) {
        this.sendKellyStreamSubscriberMessage(
          subscriber,
          {
            type: "status",
            generatedAt,
            state: "degraded",
            reasonCode: "polling_fallback",
            message: subscriber.lastRepricedAt
              ? "实时流异常，当前回退到轮询；最近一次轮询重定价仍有效。"
              : "实时流异常，当前回退到轮询盘口同步。",
            lastSignalAt: hub.lastSignalAt,
            lastRepricedAt: subscriber.lastRepricedAt,
          },
          { fallbackMode: true },
        );
        return;
      }

      this.sendKellyStreamSubscriberMessage(subscriber, {
        type: "status",
        generatedAt,
        state: "connected",
        reasonCode: "no_recent_market_motion",
        message: hub.lastSignalAt ? "实时流已连接，最近没有新的盘口变动。" : "实时流已连接，正在等待新的盘口变动。",
        lastSignalAt: hub.lastSignalAt,
        lastRepricedAt: subscriber.lastRepricedAt,
      });
    }, KELLY_STREAM_CLIENT_KEEPALIVE_MS);
  }

  private async closeKellyStreamHub(hub: KellyStreamHub) {
    if (hub.pendingTimer) {
      clearTimeout(hub.pendingTimer);
      hub.pendingTimer = null;
    }
    if (hub.fallbackTimer) {
      clearInterval(hub.fallbackTimer);
      hub.fallbackTimer = null;
    }
    if (hub.idleTimer) {
      clearTimeout(hub.idleTimer);
      hub.idleTimer = null;
    }
    hub.upstreamConnected = false;
    const upstreamStream = hub.upstreamStream;
    hub.upstreamStream = null;
    hub.latestBooks = null;
    this.kellyStreamHubs.delete(hub.key);
    this.syncKellyHubCount();
    this.syncKellyFallbackMode();
    if (upstreamStream) {
      await upstreamStream.close();
    }
  }

  private async releaseKellyStreamSubscriber(hub: KellyStreamHub, subscriberId: string) {
    const subscriber = hub.subscribers.get(subscriberId);
    if (!subscriber) {
      return;
    }

    subscriber.closed = true;
    this.stopKellyStreamSubscriberKeepalive(subscriber);
    hub.subscribers.delete(subscriberId);
    this.kellyRuntimeHealth.openStreamCount = Math.max(0, this.kellyRuntimeHealth.openStreamCount - 1);

    if (hub.subscribers.size === 0 && !hub.idleTimer) {
      hub.idleTimer = setTimeout(() => {
        hub.idleTimer = null;
        if (hub.subscribers.size === 0) {
          void this.closeKellyStreamHub(hub);
        }
      }, KELLY_STREAM_HUB_IDLE_TTL_MS);
    }
  }

  private async ensureKellyStreamHubUpstream(hub: KellyStreamHub, restart: boolean) {
    if (hub.subscribers.size === 0) {
      return;
    }

    if (restart && hub.upstreamStream) {
      const previous = hub.upstreamStream;
      hub.upstreamStream = null;
      hub.upstreamConnected = false;
      await previous.close();
    }

    if (hub.upstreamStream) {
      return;
    }

    hub.upstreamStream = this.polymarketClient.createMarketStream(
      [...hub.tokenIds],
      (message) => {
        if (message.type === "status") {
          if (message.state === "connected") {
            hub.upstreamConnected = true;
            this.stopKellyStreamHubPollingFallback(hub);
          } else if (message.state === "degraded" || message.state === "disconnected") {
            hub.upstreamConnected = false;
            this.startKellyStreamHubPollingFallback(hub);
          }
        }

        this.broadcastKellyStreamHubStatus(
          hub,
          (subscriber) => ({
            ...message,
            lastSignalAt: hub.lastSignalAt,
            lastRepricedAt: subscriber.lastRepricedAt ?? message.lastRepricedAt ?? null,
          }),
          {
            fallbackMode: message.type === "status" && message.reasonCode === "polling_fallback",
          },
        );
      },
      (occurredAt) => {
        hub.lastSignalAt = occurredAt;
        this.recordKellySignal(occurredAt);
        if (hub.pendingTimer) {
          return;
        }

        hub.pendingTimer = setTimeout(() => {
          hub.pendingTimer = null;
          if (hub.subscribers.size === 0) {
            return;
          }
          void this.emitKellyStreamHubSnapshots(hub);
        }, KELLY_STREAM_REPRICE_DEBOUNCE_MS);
      },
    );
  }

  private startKellyStreamHubPollingFallback(hub: KellyStreamHub) {
    if (hub.fallbackTimer) {
      return;
    }

    const fallbackTime = new Date().toISOString();
    this.recordKellyStreamEvent(fallbackTime, true);
    this.broadcastKellyStreamHubStatus(
      hub,
      (subscriber) => ({
        type: "status",
        generatedAt: fallbackTime,
        state: "degraded",
        reasonCode: "polling_fallback",
        message: "实时流异常，已回退到轮询盘口同步。",
        lastSignalAt: hub.lastSignalAt,
        lastRepricedAt: subscriber.lastRepricedAt,
      }),
      { fallbackMode: true },
    );

    hub.fallbackTimer = setInterval(() => {
      if (hub.subscribers.size === 0) {
        return;
      }

      void this.emitKellyStreamHubSnapshots(hub).then((repricedAt) => {
        if (!repricedAt) {
          return;
        }

        this.broadcastKellyStreamHubStatus(
          hub,
          (subscriber) => ({
            type: "status",
            generatedAt: new Date().toISOString(),
            state: "degraded",
            reasonCode: "polling_fallback",
            message: "实时流异常，当前已回退到轮询；最近一次轮询重定价成功。",
            lastSignalAt: hub.lastSignalAt,
            lastRepricedAt: subscriber.lastRepricedAt ?? repricedAt,
          }),
          { fallbackMode: true },
        );
      });
    }, KELLY_STREAM_POLLING_INTERVAL_MS);
    this.syncKellyFallbackMode();
  }

  private stopKellyStreamHubPollingFallback(hub: KellyStreamHub) {
    if (hub.fallbackTimer) {
      clearInterval(hub.fallbackTimer);
      hub.fallbackTimer = null;
    }
    this.syncKellyFallbackMode();
  }

  private async loadKellyStreamHubBooks(
    hub: KellyStreamHub,
    options?: { reuseExistingBooks?: boolean },
  ): Promise<{
    books: Map<string, NormalizedOrderBook>;
    generatedAt: string;
    orderbookObservedAt: string | null;
  }> {
    if (options?.reuseExistingBooks && hub.latestBooks) {
      return {
        books: hub.latestBooks,
        generatedAt: new Date().toISOString(),
        orderbookObservedAt: hub.lastOrderbookAt,
      };
    }

    const tokenIds = [...hub.tokenIds];
    const orderBookCache = this.getKellyOrderBookCache(hub.locationId, hub.targetDate);
    const cachedBooks = hub.latestBooks ?? orderBookCache.peek().entry?.value ?? null;
    const generatedAt = new Date().toISOString();
    let freshBooks: Map<string, NormalizedOrderBook>;

    try {
      freshBooks = await this.fetchFreshKellyOrderBooks(hub.locationId, hub.targetDate, tokenIds);
    } catch (error) {
      if (this.hasKellyOrderBookCoverage(tokenIds, cachedBooks)) {
        const retainedBooks = new Map(cachedBooks);
        const orderbookObservedAt = resolveLatestOrderbookTimestamp(retainedBooks);
        hub.latestBooks = retainedBooks;
        hub.lastOrderbookAt = orderbookObservedAt;
        this.kellyRuntimeHealth.lastOrderbookAt = orderbookObservedAt ?? this.kellyRuntimeHealth.lastOrderbookAt;
        console.warn("[kelly-stream:orderbook-retained]", {
          locationId: hub.locationId,
          targetDate: hub.targetDate,
          reasonCode: this.resolveKellyOrderbookFailureCode(error),
          lastSignalAt: hub.lastSignalAt,
          lastRepricedAt: hub.lastRepricedAt,
          dataRetained: true,
          subscriberCount: hub.subscribers.size,
          hubKey: hub.key,
        });
        return {
          books: retainedBooks,
          generatedAt,
          orderbookObservedAt,
        };
      }

      throw error;
    }

    const books = this.mergeKellyOrderBooks(tokenIds, freshBooks, cachedBooks);
    if (!this.hasKellyOrderBookCoverage(tokenIds, books)) {
      const error = new AppError(
        503,
        freshBooks.size === 0 ? "POLYMARKET_ORDERBOOK_REFRESH_EMPTY" : "POLYMARKET_ORDERBOOK_INCOMPLETE",
        freshBooks.size === 0
          ? "Polymarket orderbook refresh returned no usable books."
          : "Polymarket orderbook refresh returned incomplete books for live repricing.",
        {
          retryable: true,
        },
      );
      this.recordKellyOrderbookFailure(error.code, generatedAt);
      throw error;
    }

    const orderbookObservedAt = resolveLatestOrderbookTimestamp(books);
    orderBookCache.set(books, new Date(generatedAt));
    this.invalidateKellySnapshotResults(hub.locationId, hub.targetDate);
    hub.latestBooks = books;
    hub.lastOrderbookAt = orderbookObservedAt;
    this.kellyRuntimeHealth.lastOrderbookAt = orderbookObservedAt ?? this.kellyRuntimeHealth.lastOrderbookAt;
    return {
      books,
      generatedAt,
      orderbookObservedAt,
    };
  }

  private handleKellyStreamSubscriberRepriceFailure(
    hub: KellyStreamHub,
    subscriber: KellyStreamSubscriber,
    error: unknown,
  ) {
    const failedAt = new Date().toISOString();
    const retainedSnapshot = this.readKellyStreamLastGoodSnapshot(subscriber.streamContextKey);
    const hasRetainedSnapshot = Boolean(retainedSnapshot?.repricedMarkets.length);
    const preservedLastRepricedAt = retainedSnapshot?.repricedAt ?? subscriber.lastRepricedAt;

    if (retainedSnapshot && retainedSnapshot.repricedMarkets.length > 0) {
      this.sendKellyStreamSubscriberMessage(subscriber, {
        type: "markets",
        generatedAt: failedAt,
        markets: buildStreamMarketPatches(retainedSnapshot.repricedMarkets),
        frames: retainedSnapshot.framePoints,
        lastSignalAt: hub.lastSignalAt,
        lastRepricedAt: retainedSnapshot.repricedAt,
      });
      subscriber.lastRepricedAt = retainedSnapshot.repricedAt;
    }

    subscriber.consecutiveRepriceFailures += 1;
    console.warn("[kelly-stream:reprice-failed]", {
      locationId: hub.locationId,
      targetDate: hub.targetDate,
      reasonCode: "reprice_failed",
      lastSignalAt: hub.lastSignalAt,
      lastRepricedAt: preservedLastRepricedAt,
      dataRetained: hasRetainedSnapshot,
      consecutiveRepriceFailures: subscriber.consecutiveRepriceFailures,
      subscriberCount: hub.subscribers.size,
      hubKey: hub.key,
      error: error instanceof Error ? error.message : String(error),
    });
    if (subscriber.consecutiveRepriceFailures >= KELLY_STREAM_REPRICE_FAILURE_WARN_THRESHOLD) {
      console.warn("[kelly-stream:reprice-failure-threshold]", {
        locationId: hub.locationId,
        targetDate: hub.targetDate,
        threshold: KELLY_STREAM_REPRICE_FAILURE_WARN_THRESHOLD,
        consecutiveRepriceFailures: subscriber.consecutiveRepriceFailures,
        lastSignalAt: hub.lastSignalAt,
        lastRepricedAt: preservedLastRepricedAt,
        dataRetained: hasRetainedSnapshot,
        subscriberCount: hub.subscribers.size,
        hubKey: hub.key,
      });
    }
    this.sendKellyStreamSubscriberMessage(subscriber, {
      type: "status",
      generatedAt: failedAt,
      state: "degraded",
      reasonCode: "reprice_failed",
      message: hasRetainedSnapshot
        ? "实时流收到信号，本轮重定价失败；当前沿用上一轮结果并等待下一次同步。"
        : preservedLastRepricedAt
          ? "实时流收到信号，本轮重定价失败；当前沿用上一轮结果并等待下一次同步。"
          : "实时流收到信号，但本轮盘口同步失败。",
      lastSignalAt: hub.lastSignalAt,
      lastRepricedAt: preservedLastRepricedAt,
    });

    return preservedLastRepricedAt;
  }

  private async emitKellyStreamHubSnapshots(
    hub: KellyStreamHub,
    options?: { subscriberId?: string; reuseExistingBooks?: boolean },
  ): Promise<string | null> {
    if (hub.repriceInFlight) {
      return await hub.repriceInFlight;
    }

    const task = (async () => {
      const targetSubscribers = options?.subscriberId
        ? [hub.subscribers.get(options.subscriberId)].filter((value): value is KellyStreamSubscriber => Boolean(value))
        : [...hub.subscribers.values()];
      if (targetSubscribers.length === 0) {
        return null;
      }

      let sharedBooks: {
        books: Map<string, NormalizedOrderBook>;
        generatedAt: string;
        orderbookObservedAt: string | null;
      };

      try {
        sharedBooks = await this.loadKellyStreamHubBooks(hub, {
          reuseExistingBooks: options?.reuseExistingBooks,
        });
      } catch (error) {
        let preservedLastRepricedAt: string | null = null;
        for (const subscriber of targetSubscribers) {
          preservedLastRepricedAt =
            this.handleKellyStreamSubscriberRepriceFailure(hub, subscriber, error) ?? preservedLastRepricedAt;
        }
        this.startKellyStreamHubPollingFallback(hub);
        return preservedLastRepricedAt;
      }

      let latestRepricedAt: string | null = null;
      let successCount = 0;
      let failureCount = 0;

      for (const subscriber of targetSubscribers) {
        try {
          const { framePoints, generatedAt, orderbookObservedAt, repricedAt, repricedMarkets } =
            await this.repriceKellyStreamSnapshot({
              locationId: hub.locationId,
              location: hub.location,
              targetDate: hub.targetDate,
              options: subscriber.streamOptions,
              matchedMarkets: subscriber.matchedMarkets,
              trackedMarkets: subscriber.trackedMarkets,
              bankroll: subscriber.bankroll,
              riskMode: subscriber.riskMode,
              minEdge: subscriber.minEdge,
              probabilityCurve: subscriber.probabilityCurve,
              shrink: subscriber.shrink,
              booksOverride: sharedBooks.books,
              generatedAtOverride: sharedBooks.generatedAt,
              orderbookObservedAtOverride: sharedBooks.orderbookObservedAt,
            });

          this.writeKellyStreamLastGoodSnapshot(subscriber.streamContextKey, {
            generatedAt,
            repricedAt,
            repricedMarkets,
            framePoints,
          });
          subscriber.lastRepricedAt = repricedAt;
          subscriber.consecutiveRepriceFailures = 0;
          hub.lastRepricedAt = repricedAt;
          latestRepricedAt = repricedAt;
          successCount += 1;
          this.kellyRuntimeHealth.lastOrderbookAt = orderbookObservedAt ?? this.kellyRuntimeHealth.lastOrderbookAt;
          this.kellyRuntimeHealth.lastRepricedAt = repricedAt;
          console.info("[kelly-stream:reprice]", {
            locationId: hub.locationId,
            targetDate: hub.targetDate,
            reasonCode: "repriced",
            lastSignalAt: hub.lastSignalAt,
            lastRepricedAt: repricedAt,
            dataRetained: false,
            subscriberCount: hub.subscribers.size,
            hubKey: hub.key,
          });

          this.sendKellyStreamSubscriberMessage(subscriber, {
            type: "markets",
            generatedAt,
            markets: buildStreamMarketPatches(repricedMarkets),
            frames: framePoints,
            lastSignalAt: hub.lastSignalAt,
            lastRepricedAt: repricedAt,
          });
        } catch (error) {
          failureCount += 1;
          latestRepricedAt = this.handleKellyStreamSubscriberRepriceFailure(hub, subscriber, error) ?? latestRepricedAt;
        }
      }

      if (successCount > 0 && hub.upstreamConnected) {
        this.stopKellyStreamHubPollingFallback(hub);
      } else if (failureCount > 0 && successCount === 0) {
        this.startKellyStreamHubPollingFallback(hub);
      }

      return latestRepricedAt;
    })();

    hub.repriceInFlight = task;

    try {
      return await task;
    } finally {
      if (hub.repriceInFlight === task) {
        hub.repriceInFlight = null;
      }
    }
  }

  async createKellyStream(
    locationId: LocationInfo["id"],
    options: KellyRequestOptions,
    onMessage: (message: KellyStreamMessage) => void,
  ): Promise<KellyStreamHandle> {
    const location = this.requireLocation(locationId);
    const requestedTargetDate = resolveKellyTargetDate(location.timezone, options.targetDate);
    const snapshot = await this.getKellyWorkbench(locationId, {
      ...options,
      targetDate: requestedTargetDate,
    });
    const targetDate = snapshot.targetDate || requestedTargetDate;
    const streamOptions: KellyRequestOptions = {
      ...options,
      targetDate,
      bankroll: snapshot.bankroll,
      riskMode: snapshot.riskMode,
      minEdge: snapshot.minEdge,
    };
    const streamContextKey = buildKellySnapshotRequestKey(locationId, targetDate, {
      ...streamOptions,
    });
    this.writeKellyStreamModelContext(
      streamContextKey,
      snapshot.probabilityCurve,
      snapshot.distributionSummary.shrink,
    );
    const streamCandidates = [...snapshot.markets, ...(snapshot.inactiveMarkets ?? [])];
    const trackedMarkets = streamCandidates.filter((market) => market.parseStatus === "matched");
    const matchedMarkets = trackedMarkets.filter(
      (market): market is KellyMatchedStreamMarket => Boolean(market.yesTokenId && market.noTokenId),
    );

    const seededRepricedAt = snapshot.freshness.repricedAt ?? snapshot.generatedAt;
    if (trackedMarkets.length > 0) {
      this.writeKellyStreamLastGoodSnapshot(streamContextKey, {
        generatedAt: snapshot.generatedAt,
        repricedAt: seededRepricedAt,
        repricedMarkets: trackedMarkets,
        framePoints: snapshot.frameSeries,
      });
      onMessage({
        type: "markets",
        generatedAt: snapshot.generatedAt,
        markets: buildStreamMarketPatches(trackedMarkets),
        frames: snapshot.frameSeries,
        lastSignalAt: null,
        lastRepricedAt: seededRepricedAt,
      });
    }

    if (!matchedMarkets.length) {
      this.recordKellyStreamEvent(new Date().toISOString(), false);
      onMessage({
        type: "status",
        generatedAt: new Date().toISOString(),
        state: "unavailable",
        reasonCode: "no_matched_markets",
        message: "当前没有可订阅的 Polymarket 盘口。",
        lastSignalAt: null,
        lastRepricedAt: null,
      });
      return {
        close() {},
      };
    }

    const { hub, tokensExpanded } = this.ensureKellyStreamHub(
      locationId,
      location,
      targetDate,
      matchedMarkets.flatMap((market) => [market.yesTokenId, market.noTokenId]),
    );
    const subscriber: KellyStreamSubscriber = {
      id: `kelly-stream-${++this.kellyStreamSubscriberSequence}`,
      streamContextKey,
      onMessage,
      trackedMarkets,
      matchedMarkets,
      streamOptions,
      bankroll: snapshot.bankroll,
      riskMode: snapshot.riskMode,
      minEdge: snapshot.minEdge,
      probabilityCurve: snapshot.probabilityCurve,
      shrink: snapshot.distributionSummary.shrink,
      lastRepricedAt: seededRepricedAt ?? null,
      lastClientMessageAt: Date.now(),
      consecutiveRepriceFailures: 0,
      keepaliveTimer: null,
      closed: false,
    };

    hub.subscribers.set(subscriber.id, subscriber);
    this.kellyRuntimeHealth.openStreamCount += 1;
    this.startKellyStreamSubscriberKeepalive(hub, subscriber);
    try {
      await this.ensureKellyStreamHubUpstream(hub, tokensExpanded);

      if (hub.repriceInFlight) {
        await hub.repriceInFlight;
      } else if (hub.latestBooks) {
        await this.emitKellyStreamHubSnapshots(hub, {
          subscriberId: subscriber.id,
          reuseExistingBooks: true,
        });
      } else {
        await this.emitKellyStreamHubSnapshots(hub);
      }

      if (!subscriber.closed && hub.upstreamConnected) {
        this.sendKellyStreamSubscriberMessage(subscriber, {
          type: "status",
          generatedAt: new Date().toISOString(),
          state: "connected",
          reasonCode: "no_recent_market_motion",
          message: "实时流已连接，最近还没有新的盘口变动。",
          lastSignalAt: hub.lastSignalAt,
          lastRepricedAt: subscriber.lastRepricedAt,
        });
      }

      return {
        close: async () => {
          await this.releaseKellyStreamSubscriber(hub, subscriber.id);
        },
      };
    } catch (error) {
      await this.releaseKellyStreamSubscriber(hub, subscriber.id);
      throw error;
    }
  }

  async getUserFavorites(): Promise<UserFavoritesResponse> {
    const stored = await this.favoritesStore.getFavorites(new Set(this.allowedLocationIds));
    return {
      fetchedAt: stored.updatedAt,
      locationIds: stored.locationIds as LocationInfo["id"][],
    };
  }

  async setUserFavorite(locationId: LocationInfo["id"], favorite: boolean): Promise<UserFavoritesResponse> {
    if (!this.allowedLocationIds.has(locationId)) {
      throw new AppError(400, "BAD_REQUEST", `Unknown locationId '${locationId}'.`);
    }

    const stored = await this.favoritesStore.setFavorite(locationId, favorite, new Set(this.allowedLocationIds));
    return {
      fetchedAt: stored.updatedAt,
      locationIds: stored.locationIds as LocationInfo["id"][],
    };
  }
}

