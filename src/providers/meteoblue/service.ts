import { config, LOCATION_REGISTRY } from "../../config.js";
import { AppError } from "../../domain/errors.js";
import type {
  HourlyFieldCoverage,
  HourlyFieldCoverageCompleteness,
  HourlyFieldCoverageEntry,
  HourlyFieldName,
  HourlyMode,
  HourlySourceType,
  KellyBridgeHealth,
  KellyBridgeStageTimings,
  HourlyWeatherResponse,
  KellyFramePoint,
  KellyRequestOptions,
  KellyStreamHandle,
  KellyStreamMessage,
  KellyWeatherEvidence,
  KellyWorkbenchResponse,
  LocationInfo,
  MetarObservation,
  MultiModelDistributionResponse,
  MultiModelInsightResponse,
  MultiModelImageResponse,
  MultiModelStatusResponse,
  UserFavoritesResponse,
  WeatherReportResponse,
  WeatherService,
} from "../../domain/weather.js";
import { buildDiscoveryWarnings, PolymarketClient, type NormalizedOrderBook, type PolymarketDiscoveryResult } from "../../kelly/polymarket.js";
import {
  applyPricingToMarkets,
  buildKellyWorkbench,
  buildReadableFramePoints,
  buildStreamMarketPatches,
  resolveObservationFloor,
  resolveKellyTargetDate,
} from "../../kelly/workbench.js";
import { RefreshableCache } from "../../lib/cache.js";
import { FavoritesStore, type FavoritesStoreLike } from "../../lib/favorites-store.js";
import { fetchBinary, fetchText } from "../../lib/http.js";
import { fetchMetarSnapshot, type MetarTemperatureSample } from "../metar/service.js";
import { resolveLocation } from "./location-registry.js";
import { extractWeekMeteogramHighchartsUrl, parseWeekMeteogramHighcharts } from "./meteogram.js";
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

interface WeekCacheValue {
  fetchedAt: string;
  sourceObservedAt: string | null;
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
  report: Omit<WeatherReportResponse, "fetchedAt" | "sourceObservedAt" | "stale" | "cacheHit" | "warnings"> & {
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
}

const INITIAL_KELLY_STAGE_TIMINGS: KellyBridgeStageTimings = {
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

const cloneKellyStageTimings = (value?: Partial<KellyBridgeStageTimings> | null): KellyBridgeStageTimings => ({
  ...INITIAL_KELLY_STAGE_TIMINGS,
  ...(value ?? {}),
});

const measureAsync = async <T>(
  stageTimings: Partial<KellyBridgeStageTimings>,
  key: keyof KellyBridgeStageTimings,
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
const resolveKellyDistributionTimestamp = (availableTimestamps: string[], targetDate: string): string | null => {
  const matching = availableTimestamps.filter((timestamp) => timestamp.slice(0, 10) === targetDate);
  if (matching.length === 0) {
    return null;
  }

  return matching[Math.floor(matching.length / 2)] ?? matching[0] ?? null;
};

const normalizeText = (value: string): string => value.replace(/\s+/g, " ").trim();
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

export class MeteoblueWeatherService implements WeatherService {
  private readonly weekCaches = new Map<LocationInfo["id"], RefreshableCache<WeekCacheValue>>();
  private readonly multiModelImageCaches = new Map<LocationInfo["id"], RefreshableCache<ImageCacheValue>>();
  private readonly multiModelDistributionCaches = new Map<
    LocationInfo["id"],
    RefreshableCache<MultiModelDistributionCacheValue>
  >();
  private readonly metarCaches = new Map<LocationInfo["id"], RefreshableCache<MetarCacheValue>>();
  private readonly kellyMarketCaches = new Map<string, RefreshableCache<PolymarketDiscoveryResult>>();
  private readonly kellyOrderBookCaches = new Map<string, RefreshableCache<Map<string, NormalizedOrderBook>>>();
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
  private readonly kellyBridgeHealth: KellyBridgeHealth = {
    lastSnapshotSuccessAt: null,
    lastSnapshotErrorAt: null,
    lastSnapshotError: null,
    lastMarketDiscoveryAt: null,
    lastOrderbookAt: null,
    lastRepricedAt: null,
    lastStreamEventAt: null,
    openStreamCount: 0,
    fallbackMode: false,
    lastStageTimingsMs: cloneKellyStageTimings(),
  };

  constructor(options?: { favoritesStore?: FavoritesStoreLike }) {
    this.favoritesStore = options?.favoritesStore ?? new FavoritesStore();
    this.allowedLocationIds = new Set(Object.keys(LOCATION_REGISTRY) as LocationInfo["id"][]);
    this.polymarketClient = new PolymarketClient();
  }

  getKellyBridgeHealth(): KellyBridgeHealth {
    return {
      ...this.kellyBridgeHealth,
      lastStageTimingsMs: cloneKellyStageTimings(this.kellyBridgeHealth.lastStageTimingsMs),
    };
  }

  private recordKellySnapshotSuccess(details: {
    generatedAt: string;
    discoveryFetchedAt: string | null;
    orderbookFetchedAt: string | null;
    repricedAt: string | null;
    stageTimings: Partial<KellyBridgeStageTimings>;
  }) {
    this.kellyBridgeHealth.lastSnapshotSuccessAt = details.generatedAt;
    this.kellyBridgeHealth.lastSnapshotErrorAt = null;
    this.kellyBridgeHealth.lastSnapshotError = null;
    this.kellyBridgeHealth.lastMarketDiscoveryAt = details.discoveryFetchedAt ?? this.kellyBridgeHealth.lastMarketDiscoveryAt;
    this.kellyBridgeHealth.lastOrderbookAt = details.orderbookFetchedAt ?? this.kellyBridgeHealth.lastOrderbookAt;
    this.kellyBridgeHealth.lastRepricedAt = details.repricedAt ?? this.kellyBridgeHealth.lastRepricedAt;
    this.kellyBridgeHealth.lastStageTimingsMs = cloneKellyStageTimings(details.stageTimings);
  }

  private recordKellySnapshotFailure(error: unknown, stageTimings: Partial<KellyBridgeStageTimings>) {
    this.kellyBridgeHealth.lastSnapshotErrorAt = new Date().toISOString();
    this.kellyBridgeHealth.lastSnapshotError = error instanceof Error ? error.message : String(error);
    this.kellyBridgeHealth.lastStageTimingsMs = cloneKellyStageTimings(stageTimings);
  }

  private recordKellyStreamEvent(generatedAt: string, fallbackMode?: boolean) {
    this.kellyBridgeHealth.lastStreamEventAt = generatedAt;
    if (typeof fallbackMode === "boolean") {
      this.kellyBridgeHealth.fallbackMode = fallbackMode;
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
    const cache = new RefreshableCache<WeekCacheValue>(config.weekPageTtlMs, async () => {
      const html = await fetchText(location.weekPageUrl);
      const fetchedAt = new Date();
      const parsed = parseWeekPage(html, fetchedAt, location.timezone, location.name);
      const meteogramHighchartsUrl = extractWeekMeteogramHighchartsUrl(html);
      const meteogramRaw = await fetchText(meteogramHighchartsUrl);
      const meteogram = parseWeekMeteogramHighcharts(meteogramRaw, location.timezone);

      const hasOneHourTable = parsed.oneHourItems.length > 0;
      const mergedOneHourItems = mergeHourlyItems(parsed.oneHourItems, meteogram.items);
      const oneHourWarnings = [...parsed.oneHourWarnings];
      if (!hasOneHourTable) {
        oneHourWarnings.push("1h data fell back to embedded meteogram because the 1h table could not be parsed.");
      }

      return {
        fetchedAt: fetchedAt.toISOString(),
        sourceObservedAt: parsed.sourceObservedAt,
        hourly: {
          "1h": {
            items: hasOneHourTable ? mergedOneHourItems : meteogram.items,
            sourceType: hasOneHourTable ? "week-table-1h" : "week-meteogram-highcharts",
            warnings: oneHourWarnings,
            partial: hasOneHourTable ? parsed.oneHourPartial : true,
            preferredItems: parsed.oneHourItems,
            fallbackItems: meteogram.items,
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
    });

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
      const pageHtml = await fetchText(location.multimodelPageUrl);
      const pageFetchedAt = new Date().toISOString();
      const imageUrl = extractMultiModelImageUrl(pageHtml);
      const image = await fetchBinary(imageUrl);

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
      async () => await loadMultiModelDistribution(location.multimodelPageUrl, location.timezone),
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
    const cache = new RefreshableCache<MetarCacheValue>(60_000, async () => ({
      ...(await fetchMetarSnapshot({
        id: location.id,
        name: location.name,
        timezone: location.timezone,
      })),
    }));

    this.metarCaches.set(locationId, cache);
    return cache;
  }

  private getKellyMarketCache(locationId: LocationInfo["id"], targetDate: string) {
    const key = buildKellyCacheKey(locationId, targetDate);
    const existing = this.kellyMarketCaches.get(key);
    if (existing) {
      return existing;
    }

    const location = this.requireLocation(locationId);
    const cache = new RefreshableCache<PolymarketDiscoveryResult>(
      config.polymarketMarketTtlMs,
      async () => await this.polymarketClient.discoverMarkets(location, targetDate),
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

    const cache = new RefreshableCache<Map<string, NormalizedOrderBook>>(config.polymarketOrderbookTtlMs, async () => {
      const marketResult = await this.getKellyMarketCache(locationId, targetDate).get({ allowStaleOnError: true });
      const tokenIds = marketResult.value.candidates
        .filter((candidate) => candidate.parseStatus === "matched")
        .flatMap((candidate) => [candidate.yesTokenId, candidate.noTokenId])
        .filter((tokenId): tokenId is string => Boolean(tokenId));

      if (!tokenIds.length) {
        return new Map<string, NormalizedOrderBook>();
      }

      return await this.polymarketClient.fetchOrderBooks(tokenIds);
    });

    this.kellyOrderBookCaches.set(key, cache);
    return cache;
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

  async getHourly(locationId: LocationInfo["id"], mode: HourlyMode, limit?: number): Promise<HourlyWeatherResponse> {
    const location = this.requireLocation(locationId);
    const result = await this.getWeekCache(locationId).get({ allowStaleOnError: true });
    const hourly = result.value.hourly[mode];
    const maxItems = typeof limit === "number" && limit > 0 ? limit : hourly.items.length;
    const warnings = [...hourly.warnings];

    const allItems = hourly.items;
    const nowMs = Date.now();
    let selectedItems = allItems.slice(0, maxItems);

    if (mode === "1h" && maxItems === 24 && allItems.length > 24) {
      const currentIndexInAll = nearestItemIndex(allItems, nowMs);
      const currentItem = currentIndexInAll >= 0 ? allItems[currentIndexInAll] : null;
      const currentDayKey = currentItem ? localDateKey(currentItem.timestamp, location.timezone) : null;

      if (currentDayKey) {
        const sameDayItems = allItems.filter((item) => localDateKey(item.timestamp, location.timezone) === currentDayKey);
        if (sameDayItems.length >= 24) {
          selectedItems = sameDayItems.slice(0, 24);
        } else if (sameDayItems.length > 0) {
          const selected = [...sameDayItems];
          const seen = new Set(sameDayItems.map((item) => item.timestamp));
          for (const item of allItems) {
            if (seen.has(item.timestamp)) {
              continue;
            }

            selected.push(item);
            if (selected.length >= 24) {
              break;
            }
          }

          selectedItems = selected.slice(0, 24);
        }
      }
    }

    if (mode === "1h" && maxItems >= 24 && selectedItems.length < 24) {
      warnings.push("The parsed 1h view did not expose a full 24-hour window; returned the available hours.");
    }

    if (result.stale) {
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

    return {
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
      stale: result.stale,
      pageUrl: location.weekPageUrl,
      parserVersion: WEEK_PARSER_VERSION,
      items: sanitizedItems,
      fieldCoverage,
      partial: hourly.partial,
      warnings,
      cacheHit: result.cacheHit,
      current,
    };
  }

  async getWeatherReport(locationId: LocationInfo["id"]): Promise<WeatherReportResponse> {
    const result = await this.getWeekCache(locationId).get({ allowStaleOnError: true });
    const report = result.value.report;
    const warnings = [...report.warnings];
    const textZh = sanitizeReportTextZh({
      textZh: report.textZh,
      sourceTextEn: report.sourceTextEn,
      titleEn: report.titleEn,
      metrics: report.metrics,
    });

    if (normalizeText(report.textZh ?? "") !== normalizeText(textZh)) {
      warnings.push("Weather report translation fallback applied.");
    }

    if (result.stale) {
      warnings.push("Serving stale week page data because the latest refresh failed.");
    }

    return {
      ...report,
      textZh,
      fetchedAt: result.value.fetchedAt,
      sourceObservedAt: result.value.sourceObservedAt,
      stale: result.stale,
      cacheHit: result.cacheHit,
      warnings,
    };
  }

  async getMultiModelImage(locationId: LocationInfo["id"], allowStale: boolean): Promise<MultiModelImageResponse> {
    const location = this.requireLocation(locationId);
    try {
      const result = await this.getMultiModelImageCache(locationId).get({
        allowStaleOnError: allowStale,
        staleWhileRevalidate: allowStale,
      });
      return {
        contentType: result.value.contentType,
        body: result.value.body,
        cacheHit: result.cacheHit,
        stale: result.stale,
        headers: {
          "cache-control": allowStale ? "private, max-age=0, must-revalidate" : "no-store",
          "x-weather-source": "meteoblue-web",
          "x-weather-page-url": location.multimodelPageUrl,
          "x-weather-page-fetched-at": result.value.pageFetchedAt,
          "x-weather-image-fetched-at": result.value.imageFetchedAt,
          "x-weather-stale": String(result.stale),
          "x-weather-parser-version": MULTIMODEL_IMAGE_VERSION,
        },
      };
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
    const snapshot = this.getMultiModelImageCache(locationId).peek();
    return {
      location: {
        id: location.id,
        name: location.name,
        timezone: location.timezone,
      },
      pageFetchedAt: snapshot.entry?.value.pageFetchedAt ?? null,
      imageFetchedAt: snapshot.entry?.value.imageFetchedAt ?? null,
      imageUrlFound: snapshot.entry !== null,
      cacheHit: snapshot.entry !== null && snapshot.entry.expiresAt > Date.now(),
      stale: snapshot.entry !== null && snapshot.entry.expiresAt <= Date.now(),
      lastError: snapshot.lastError,
      lastSuccessAt: snapshot.entry?.value.imageFetchedAt ?? null,
      imageUrl: snapshot.entry?.value.imageUrl ?? null,
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
      const result = await this.getMultiModelDistributionCache(locationId).get({ allowStaleOnError: true });
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
          stale: result.stale,
          cacheHit: result.cacheHit,
        },
      );

      if (result.stale) {
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
      const result = await this.getMultiModelDistributionCache(locationId).get({ allowStaleOnError: true });
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
          stale: result.stale,
          cacheHit: result.cacheHit,
        },
      );

      if (result.stale) {
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
    const existing = this.kellySnapshotInFlight.get(cacheKey);
    if (existing) {
      return await existing;
    }

    const task = this.buildKellyWorkbenchSnapshot(locationId, location, targetDate, options);
    this.kellySnapshotInFlight.set(cacheKey, task);

    try {
      return await task;
    } finally {
      if (this.kellySnapshotInFlight.get(cacheKey) === task) {
        this.kellySnapshotInFlight.delete(cacheKey);
      }
    }
  }

  private async buildKellyWorkbenchSnapshot(
    locationId: LocationInfo["id"],
    location: ReturnType<MeteoblueWeatherService["requireLocation"]>,
    targetDate: string,
    options: KellyRequestOptions,
  ): Promise<KellyWorkbenchResponse> {
    const stageTimings: Partial<KellyBridgeStageTimings> = {};
    const totalStartedAt = Date.now();

    try {
      const [hourly, report, metarResult] = await Promise.all([
        measureAsync(stageTimings, "hourly", async () => await this.getHourly(locationId, "1h", 24)),
        measureAsync(stageTimings, "report", async () => await this.getWeatherReport(locationId)),
        measureAsync(stageTimings, "metar", async () => await this.getMetarCache(locationId).get({ allowStaleOnError: true })),
      ]);
      const metarObservation = metarResult.value.observation
        ? {
            ...metarResult.value.observation,
            stale: metarResult.stale,
            cacheHit: metarResult.cacheHit,
          }
        : null;
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
      const targetDistributionTimestamp = resolveKellyDistributionTimestamp(insight.availableTimestamps, targetDate);

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
      if (!options.actualTemperatureC && metarObservation === null) {
        warnings.push("METAR 实况当前不可用，Kelly 下界约束回退到站点当前小时温度。");
      } else if (metarObservation?.stale) {
        warnings.push("METAR 实况当前使用最近一次成功缓存。");
      }
      let discoveryResult: PolymarketDiscoveryResult | null = null;
      let discoveryFetchedAt: string | null = null;

      try {
        const marketResult = await measureAsync(stageTimings, "marketDiscovery", async () =>
          await this.getKellyMarketCache(locationId, targetDate).get({ allowStaleOnError: true }),
        );
        discoveryResult = marketResult.value;
        discoveryFetchedAt = discoveryResult.fetchedAt;
        if (marketResult.stale) {
          warnings.push("Polymarket 市场目录刷新失败，当前使用最近一次成功缓存。");
        }
        warnings.push(
          ...buildDiscoveryWarnings([
            ...discoveryResult.candidates,
            ...discoveryResult.inactiveCandidates,
          ]),
        );
      } catch {
        warnings.push("Polymarket 市场目录暂时不可用，当前仅展示天气侧推导结果。");
      }

      let orderBooks = new Map<string, NormalizedOrderBook>();
      let priceFetchedAt: string | null = null;

      if (discoveryResult?.candidates.some((candidate) => candidate.parseStatus === "matched")) {
        try {
          const orderBookResult = await measureAsync(stageTimings, "orderbook", async () =>
            await this.getKellyOrderBookCache(locationId, targetDate).get({
              allowStaleOnError: true,
            }),
          );
          orderBooks = orderBookResult.value;
          priceFetchedAt =
            [...orderBooks.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]?.updatedAt ?? null;
          if (orderBookResult.stale) {
            warnings.push("Polymarket 盘口快照刷新失败，当前使用最近一次成功缓存。");
          }
        } catch {
          warnings.push("Polymarket 盘口快照暂时不可用，当前仅展示公允概率与档位匹配。");
        }
      }

      const pricingStartedAt = Date.now();
      const generatedAt = new Date().toISOString();
      const cacheKey = buildKellyCacheKey(locationId, targetDate);
      const existingFrameSeries = this.kellyFrameHistories.get(cacheKey) ?? [];
      const hasActionableBookData = [...orderBooks.values()].some(
        (book) => book.bestAsk !== null || book.bestBid !== null,
      );
      const repricedAt = hasActionableBookData ? new Date().toISOString() : null;
      const observationFloor = this.resolveKellyObservationFloor(
        location,
        targetDate,
        hourly,
        metarObservation,
        metarResult.value.recentTemperatures,
        options,
      );

      const baseSnapshot = buildKellyWorkbench({
        location,
        targetDate,
        hourly,
        report,
        metarObservation,
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
              `${location.cityName} weather ${targetDate}`,
            )}`,
            marketUrls: [],
          },
        orderBooks,
        priceFetchedAt,
        generatedAt,
        repricedAt,
        frameSeries: existingFrameSeries,
        options,
        warnings,
        observationFloorOverride: observationFloor,
      });
      const frameSeries = this.rememberKellyFrameHistory(
        locationId,
        targetDate,
        buildReadableFramePoints(baseSnapshot.markets, generatedAt),
        generatedAt,
      );

      const snapshot = buildKellyWorkbench({
        location,
        targetDate,
        hourly,
        report,
        metarObservation,
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
              `${location.cityName} weather ${targetDate}`,
            )}`,
            marketUrls: [],
          },
        orderBooks,
        priceFetchedAt,
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
        orderbookFetchedAt: priceFetchedAt,
        repricedAt,
        stageTimings,
      });

      return snapshot;
    } catch (error) {
      stageTimings.total = Date.now() - totalStartedAt;
      this.recordKellySnapshotFailure(error, stageTimings);
      throw error;
    }
  }

  async createKellyStream(
    locationId: LocationInfo["id"],
    options: KellyRequestOptions,
    onMessage: (message: KellyStreamMessage) => void,
  ): Promise<KellyStreamHandle> {
    const location = this.requireLocation(locationId);
    const service = this;
    const targetDate = resolveKellyTargetDate(location.timezone, options.targetDate);
    const snapshot = await this.getKellyWorkbench(locationId, {
      ...options,
      targetDate,
    });
    const trackedMarkets = snapshot.markets.filter(
      (market) => market.lifecycle === "tradable" && market.parseStatus === "matched",
    );
    const matchedMarkets = trackedMarkets.filter(
      (market) => market.yesTokenId && market.noTokenId,
    );

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

    let closed = false;
    let pendingTimer: NodeJS.Timeout | null = null;
    let lastTriggeredAt: string | null = null;
    let fallbackTimer: NodeJS.Timeout | null = null;
    let lastRepricedAt: string | null = null;
    this.kellyBridgeHealth.openStreamCount += 1;
    this.kellyBridgeHealth.fallbackMode = false;

    async function emitSnapshot(): Promise<string | null> {
      try {
        const books = await service.polymarketClient.fetchOrderBooks(
          matchedMarkets.flatMap((market) => [market.yesTokenId!, market.noTokenId!]),
        );
        const generatedAt = new Date().toISOString();
        const repriced = applyPricingToMarkets(trackedMarkets, books, {
          bankroll: snapshot.bankroll,
          riskMode: snapshot.riskMode,
          minEdge: snapshot.minEdge,
        });
        const frames = service.rememberKellyFrameHistory(
          locationId,
          targetDate,
          buildReadableFramePoints(repriced, generatedAt),
          generatedAt,
        );
        service.recordKellyStreamEvent(generatedAt, false);
        service.kellyBridgeHealth.lastOrderbookAt =
          [...books.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]?.updatedAt ??
          service.kellyBridgeHealth.lastOrderbookAt;
        service.kellyBridgeHealth.lastRepricedAt = generatedAt;

        sendStreamMessage({
          type: "markets",
          generatedAt,
          markets: buildStreamMarketPatches(repriced),
          frames,
          lastSignalAt: lastTriggeredAt,
          lastRepricedAt: generatedAt,
        });
        lastRepricedAt = generatedAt;
        return generatedAt;
      } catch {
        const failedAt = new Date().toISOString();
        service.recordKellyStreamEvent(failedAt, true);
        sendStreamMessage({
          type: "status",
          generatedAt: failedAt,
          state: "degraded",
          reasonCode: "reprice_failed",
          message: "实时流收到信号，但本轮盘口同步失败。",
          lastSignalAt: lastTriggeredAt,
          lastRepricedAt: null,
        });
        startPollingFallback();
        return null;
      }
    }

    function startPollingFallback() {
      if (fallbackTimer) {
        return;
      }
      const fallbackTime = new Date().toISOString();
      service.kellyBridgeHealth.fallbackMode = true;
      service.recordKellyStreamEvent(fallbackTime, true);
      onMessage({
        type: "status",
        generatedAt: fallbackTime,
        state: "degraded",
        reasonCode: "polling_fallback",
        message: "实时流异常，已回退到轮询盘口同步。",
        lastSignalAt: lastTriggeredAt,
        lastRepricedAt,
      });
      fallbackTimer = setInterval(async () => {
        if (closed) {
          return;
        }
        const repricedAt = await emitSnapshot();
        if (repricedAt) {
          onMessage({
            type: "status",
            generatedAt: new Date().toISOString(),
            state: "degraded",
            reasonCode: "polling_fallback",
            message: "实时流异常，当前已回退到轮询；最近一次轮询重定价成功。",
            lastSignalAt: lastTriggeredAt,
            lastRepricedAt: repricedAt,
          });
        }
      }, 30_000);
    }

    function stopPollingFallback() {
      if (fallbackTimer) {
        clearInterval(fallbackTimer);
        fallbackTimer = null;
      }
      service.kellyBridgeHealth.fallbackMode = false;
    }

    function handleStreamStatus(message: KellyStreamMessage) {
      if (message.type !== "status") {
        return;
      }

      if (message.state === "connected") {
        stopPollingFallback();
      } else if (message.state === "degraded" || message.state === "disconnected") {
        startPollingFallback();
      }
    }

    function sendStreamMessage(message: KellyStreamMessage) {
      handleStreamStatus(message);
       service.recordKellyStreamEvent(
        message.generatedAt,
        message.type === "status" && message.reasonCode === "polling_fallback",
      );
      onMessage(message);
    }

    const upstreamStream = this.polymarketClient.createMarketStream(
      matchedMarkets.flatMap((market) => [market.yesTokenId!, market.noTokenId!]),
      sendStreamMessage,
      (occurredAt) => {
        lastTriggeredAt = occurredAt;
        if (pendingTimer) {
          return;
        }

        pendingTimer = setTimeout(async () => {
          pendingTimer = null;
          if (closed) {
            return;
          }
          const repricedAt = await emitSnapshot();
          if (lastTriggeredAt && repricedAt) {
            sendStreamMessage({
              type: "status",
              generatedAt: new Date().toISOString(),
              state: "connected",
              reasonCode: "ws_connected",
              message: `已根据 ${lastTriggeredAt} 的上游事件刷新盘口。`,
              lastSignalAt: lastTriggeredAt,
              lastRepricedAt: repricedAt,
            });
          }
        }, 300);
      },
    );

    const initialRepricedAt = await emitSnapshot();
    if (initialRepricedAt && !closed) {
      sendStreamMessage({
        type: "status",
        generatedAt: new Date().toISOString(),
        state: "connected",
        reasonCode: "no_recent_market_motion",
        message: "实时流已连接，最近还没有新的盘口变动。",
        lastSignalAt: lastTriggeredAt,
        lastRepricedAt: initialRepricedAt,
      });
    }

    return {
      async close() {
        closed = true;
        if (pendingTimer) {
          clearTimeout(pendingTimer);
          pendingTimer = null;
        }
        stopPollingFallback();
        service.kellyBridgeHealth.openStreamCount = Math.max(0, service.kellyBridgeHealth.openStreamCount - 1);
        await upstreamStream.close();
      },
    };
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

