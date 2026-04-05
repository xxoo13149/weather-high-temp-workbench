import { config, LOCATION_REGISTRY } from "../../config.js";
import { AppError } from "../../domain/errors.js";
import type {
  HourlyFieldCoverage,
  HourlyFieldCoverageCompleteness,
  HourlyFieldCoverageEntry,
  HourlyFieldName,
  HourlyMode,
  HourlySourceType,
  HourlyWeatherResponse,
  LocationInfo,
  MultiModelDistributionResponse,
  MultiModelInsightResponse,
  MultiModelImageResponse,
  MultiModelStatusResponse,
  UserFavoritesResponse,
  WeatherReportResponse,
  WeatherService,
} from "../../domain/weather.js";
import { RefreshableCache } from "../../lib/cache.js";
import { FavoritesStore } from "../../lib/favorites-store.js";
import { fetchBinary, fetchText } from "../../lib/http.js";
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
  private readonly favoritesStore: FavoritesStore;
  private readonly allowedLocationIds: Set<LocationInfo["id"]>;

  constructor(options?: { favoritesStore?: FavoritesStore }) {
    this.favoritesStore = options?.favoritesStore ?? new FavoritesStore();
    this.allowedLocationIds = new Set(Object.keys(LOCATION_REGISTRY) as LocationInfo["id"][]);
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

