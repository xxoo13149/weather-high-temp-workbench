import { readFile, stat } from "node:fs/promises";
import { extname, normalize, resolve, sep } from "node:path";

import websocket from "@fastify/websocket";
import Fastify from "fastify";

import { DEFAULT_LOCATION, LOCATION_DIRECTORY, LOCATION_REGISTRY } from "./config.js";
import { AppError, isAppError } from "./domain/errors.js";
import type {
  DashboardMetarSnapshot,
  DashboardTafSnapshot,
  HourlyFieldCoverage,
  HourlyMode,
  HourlySourceType,
  HourlyWeatherResponse,
  LocationDirectoryEntry,
  LocationInfo,
  MultiModelStatusResponse,
  WeatherReportMetrics,
  WeatherReportResponse,
  WeatherService,
} from "./domain/weather.js";
import { parseFiniteNumberQuery, parseIsoTimestampQuery, parsePositiveIntegerQuery, parsePositiveNumberQuery } from "./lib/query-params.js";
import { normalizeDashboardMetarSnapshot } from "./domain/weather.js";
import { buildDashboardEnhancements, buildLocationDirectory, buildMetricsText, buildSystemStatusResponse } from "./operational-metadata.js";
import { buildMultiModelStatusPresentation } from "./providers/meteoblue/multimodel-error-presentation.js";
import { MeteoblueWeatherService } from "./providers/meteoblue/service.js";
import { registerKellyRoutes } from "./server/kelly-routes.js";

interface CreateAppOptions {
  frontendDistDir?: string;
  enableWebSocketRoutes?: boolean;
}

const parseMode = (raw: unknown): HourlyMode => {
  if (raw === undefined || raw === "1h") {
    return "1h";
  }

  if (raw === "3h") {
    return "3h";
  }

  throw new AppError(400, "BAD_REQUEST", "Query parameter 'mode' must be either '1h' or '3h'.");
};

const parseLimit = (raw: unknown): number | undefined => {
  return parsePositiveIntegerQuery(raw, "Query parameter 'limit' must be a positive integer.");
};

const parseAllowStale = (raw: unknown): boolean => raw === "true" || raw === "1";

const parseTimestamp = (raw: unknown): string | undefined => {
  return parseIsoTimestampQuery(raw, "Query parameter 'timestamp' must be a valid ISO timestamp.");
};

const parseBucketSize = (raw: unknown): number | undefined => {
  return parsePositiveNumberQuery(raw, "Query parameter 'bucketSize' must be a positive number.");
};

const parseActualTemperatureC = (raw: unknown): number | undefined => {
  return parseFiniteNumberQuery(raw, "Query parameter 'actualTemperatureC' must be a finite number.");
};

const parseFavoriteBody = (raw: unknown): boolean => {
  if (typeof raw !== "object" || raw === null || !("favorite" in raw)) {
    throw new AppError(400, "BAD_REQUEST", "Request body must include a boolean 'favorite' field.");
  }

  const value = (raw as Record<string, unknown>).favorite;
  if (typeof value !== "boolean") {
    throw new AppError(400, "BAD_REQUEST", "Request body field 'favorite' must be boolean.");
  }

  return value;
};

const parseQueryLocationId = (raw: unknown): LocationInfo["id"] => {
  if (raw === undefined || raw === "") {
    return DEFAULT_LOCATION;
  }

  if (typeof raw !== "string" || raw.trim() === "") {
    throw new AppError(400, "BAD_REQUEST", "Query parameter 'locationId' must be a supported location id.");
  }

  const locationId = raw.trim() as LocationInfo["id"];
  if (!(locationId in LOCATION_REGISTRY)) {
    throw new AppError(400, "BAD_REQUEST", `Query parameter 'locationId' is not supported: '${raw}'.`);
  }

  return locationId;
};

const parseLocationId = (raw: unknown): LocationInfo["id"] => {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new AppError(400, "BAD_REQUEST", "Path parameter 'locationId' must be a non-empty string.");
  }

  return raw.trim() as LocationInfo["id"];
};

const defaultFrontendDistDir = resolve(process.cwd(), "zip", "dist");
const EMPTY_DASHBOARD_METAR_SNAPSHOT: DashboardMetarSnapshot = normalizeDashboardMetarSnapshot();
const EMPTY_DASHBOARD_TAF_SNAPSHOT: DashboardTafSnapshot = {
  forecast: null,
  forecasts: [],
};

const buildEmptyHourlyFieldCoverage = (sourceType: HourlySourceType): HourlyFieldCoverage => ({
  precipitationProbabilityPct: {
    availableHours: 0,
    totalHours: 0,
    source: sourceType,
    completeness: "missing",
    missingReasons: {
      "source-unpublished": 0,
      "parser-unrecognized": 0,
      "fallback-unavailable": 0,
    },
  },
  feelsLikeC: {
    availableHours: 0,
    totalHours: 0,
    source: sourceType,
    completeness: "missing",
    missingReasons: {
      "source-unpublished": 0,
      "parser-unrecognized": 0,
      "fallback-unavailable": 0,
    },
  },
  windDirection: {
    availableHours: 0,
    totalHours: 0,
    source: sourceType,
    completeness: "missing",
    missingReasons: {
      "source-unpublished": 0,
      "parser-unrecognized": 0,
      "fallback-unavailable": 0,
    },
  },
  mixedSources: [],
});

const buildDashboardHourlyFallback = (
  locationId: LocationInfo["id"],
  mode: HourlyMode,
  reason: unknown,
): HourlyWeatherResponse => {
  const location = LOCATION_REGISTRY[locationId];
  const sourceType: HourlySourceType = mode === "1h" ? "week-table-1h" : "week-table-3h";
  const detail = reason instanceof Error ? reason.message : String(reason);

  return {
    location: {
      id: location.id,
      name: location.name,
      timezone: location.timezone,
    },
    fetchedAt: new Date().toISOString(),
    sourceObservedAt: null,
    mode,
    periodHours: mode === "1h" ? 1 : 3,
    sourceType,
    stale: true,
    freshness: "fallback_error",
    pageUrl: location.weekPageUrl,
    parserVersion: "unavailable",
    items: [],
    fieldCoverage: buildEmptyHourlyFieldCoverage(sourceType),
    partial: true,
    warnings: [`Week page hourly data is temporarily unavailable. ${detail}`.trim()],
    cacheHit: false,
    current: null,
  };
};

const EMPTY_WEATHER_REPORT_METRICS: WeatherReportMetrics = {
  forecastDayLabel: null,
  maxTemperatureC: null,
  uvIndex: null,
  overnightWindKphMin: null,
  overnightWindKphMax: null,
  daytimeWindKphMin: null,
  daytimeWindKphMax: null,
  overnightWindDirection: null,
  daytimeWindDirection: null,
  confidence: null,
  predictability: null,
  predictabilityScore: null,
};

const buildDashboardReportFallback = (
  locationId: LocationInfo["id"],
  reason: unknown,
): WeatherReportResponse => {
  const location = LOCATION_REGISTRY[locationId];
  const detail = reason instanceof Error ? reason.message : String(reason);

  return {
    location: {
      id: location.id,
      name: location.name,
      timezone: location.timezone,
    },
    fetchedAt: new Date().toISOString(),
    sourceObservedAt: null,
    stale: true,
    freshness: "fallback_error",
    cacheHit: false,
    pageUrl: location.weekPageUrl,
    parserVersion: "unavailable",
    available: false,
    titleEn: null,
    sourceTextEn: null,
    textZh: null,
    metrics: EMPTY_WEATHER_REPORT_METRICS,
    warnings: [`Week page weather report is temporarily unavailable. ${detail}`.trim()],
  };
};

const buildDashboardMultiModelFallback = (
  locationId: LocationInfo["id"],
  reason: unknown,
): MultiModelStatusResponse => {
  const location = LOCATION_REGISTRY[locationId];
  const presentation = buildMultiModelStatusPresentation(reason, {
    hasRenderableImage: false,
    hasRenderableAnalysis: false,
  });

  return {
    location: {
      id: location.id,
      name: location.name,
      timezone: location.timezone,
    },
    displayUnit: location.fallbackDisplayUnit,
    fallbackDisplayUnit: location.fallbackDisplayUnit,
    pageFetchedAt: null,
    imageFetchedAt: null,
    imageUrlFound: false,
    cacheHit: false,
    stale: false,
    freshness: "fallback_error",
    imageStatus: "unavailable",
    analysisStatus: "unavailable",
    lastError: presentation.userMessage,
    diagnosticCode: presentation.diagnosticCode,
    diagnosticMessage: presentation.diagnosticMessage,
    lastSuccessAt: null,
    imageUrl: null,
    pageUrl: location.multimodelPageUrl,
  };
};

const staticContentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

const resolveFrontendPath = (frontendDistDir: string, requestedPath: string) => {
  const relativePath = normalize(requestedPath.replace(/^\/+/, "")).replace(/^(\.\.(?:[\\/]|$))+/, "");
  const root = resolve(frontendDistDir);
  const target = resolve(root, relativePath);

  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new AppError(404, "NOT_FOUND", "Static asset not found.");
  }

  return target;
};

const readFrontendAsset = async (frontendDistDir: string, requestedPath: string, missingError: AppError) => {
  const target = resolveFrontendPath(frontendDistDir, requestedPath);

  try {
    const targetStat = await stat(target);
    if (!targetStat.isFile()) {
      throw missingError;
    }

    return await readFile(target);
  } catch {
    throw missingError;
  }
};

const loadDashboardMetarSnapshot = async (
  service: WeatherService,
  locationId: LocationInfo["id"],
): Promise<DashboardMetarSnapshot> => {
  if (!service.getMetarSnapshot) {
    return EMPTY_DASHBOARD_METAR_SNAPSHOT;
  }

  try {
    return normalizeDashboardMetarSnapshot(await service.getMetarSnapshot(locationId));
  } catch {
    return EMPTY_DASHBOARD_METAR_SNAPSHOT;
  }
};

const loadDashboardTafSnapshot = async (
  service: WeatherService,
  locationId: LocationInfo["id"],
): Promise<DashboardTafSnapshot> => {
  if (!service.getTafSnapshot) {
    return EMPTY_DASHBOARD_TAF_SNAPSHOT;
  }

  try {
    return await service.getTafSnapshot(locationId);
  } catch {
    return EMPTY_DASHBOARD_TAF_SNAPSHOT;
  }
};

export const createApp = (
  service: WeatherService = new MeteoblueWeatherService(),
  options: CreateAppOptions = {},
) => {
  const app = Fastify({
    logger: false,
  });
  const enableWebSocketRoutes = options.enableWebSocketRoutes ?? true;

  if (enableWebSocketRoutes) {
    app.register(websocket);
  }

  const frontendDistDir = options.frontendDistDir ?? defaultFrontendDistDir;
  const buildId = process.env.BUILD_ID ?? `local-${Date.now().toString(36)}`;
  const startedAt = new Date().toISOString();
  const serviceName = process.env.SERVICE_NAME?.trim() || "weather-service";
  const watchdogStatusFile = process.env.KELLY_WATCHDOG_STATUS_FILE?.trim() || "";

  const readWatchdogStatus = async () => {
    if (!watchdogStatusFile) {
      return null;
    }

    try {
      const raw = await readFile(watchdogStatusFile, "utf-8");
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  app.get("/healthz", async () => {
    const runtime = service.getKellyRuntimeHealth?.();
    const watchdog = await readWatchdogStatus();

    return {
      ok: true,
      service: serviceName,
      buildId,
      startedAt,
      ...(runtime ? { runtime } : {}),
      ...(watchdog ? { watchdog } : {}),
    };
  });

  app.get("/api/system/status", async () => {
    const watchdog = await readWatchdogStatus();
    return buildSystemStatusResponse({
      service: serviceName,
      buildId,
      startedAt,
      runtime: service.getSystemStatus?.() ?? null,
      watchdog,
    });
  });

  app.get("/metrics", async (request, reply) => {
    const watchdog = await readWatchdogStatus();
    const status = buildSystemStatusResponse({
      service: serviceName,
      buildId,
      startedAt,
      runtime: service.getSystemStatus?.() ?? null,
      watchdog,
    });
    reply.code(200).header("content-type", "text/plain; version=0.0.4; charset=utf-8");
    return reply.send(buildMetricsText(status));
  });

  app.get("/api/weather/hourly", async (request) => {
    const query = (request.query as Record<string, unknown> | undefined) ?? {};
    const locationId = parseQueryLocationId(query.locationId);
    const mode = parseMode(query.mode);
    const limit = parseLimit(query.limit);
    return await service.getHourly(locationId, mode, limit);
  });

  app.get("/api/weather/report", async (request) => {
    const query = (request.query as Record<string, unknown> | undefined) ?? {};
    const locationId = parseQueryLocationId(query.locationId);
    return await service.getWeatherReport(locationId);
  });

  app.get("/api/weather/dashboard", async (request) => {
    const query = (request.query as Record<string, unknown> | undefined) ?? {};
    const locationId = parseQueryLocationId(query.locationId);
    const mode = parseMode(query.mode);
    const limit = parseLimit(query.limit);

    const [hourlyResult, multimodelResult, reportResult, metar, taf] = await Promise.all([
      service.getHourly(locationId, mode, limit).then(
        (value) => ({ ok: true as const, value }),
        (error) => ({ ok: false as const, error }),
      ),
      service.getMultiModelStatus(locationId).then(
        (value) => ({ ok: true as const, value }),
        (error) => ({ ok: false as const, error }),
      ),
      service.getWeatherReport(locationId).then(
        (value) => ({ ok: true as const, value }),
        (error) => ({ ok: false as const, error }),
      ),
      loadDashboardMetarSnapshot(service, locationId),
      loadDashboardTafSnapshot(service, locationId),
    ]);
    const hourly = hourlyResult.ok
      ? hourlyResult.value
      : buildDashboardHourlyFallback(locationId, mode, hourlyResult.error);
    const report = reportResult.ok
      ? reportResult.value
      : buildDashboardReportFallback(locationId, reportResult.error);
    const multimodel = multimodelResult.ok
      ? multimodelResult.value
      : buildDashboardMultiModelFallback(locationId, multimodelResult.error);
    const dashboardEnhancements = buildDashboardEnhancements({
      locationId,
      hourly,
      report,
      multimodel,
    });

    const syncState =
      hourly.freshness === "fallback_error" || report.freshness === "fallback_error"
        ? "fallback_error"
        : "fresh";
    const displayUnit = LOCATION_REGISTRY[locationId].fallbackDisplayUnit;

    return {
      generatedAt: new Date().toISOString(),
      displayUnit,
      sync: {
        state: syncState,
        freshness: syncState,
        label:
          syncState === "fallback_error"
            ? "fallback_error"
            : "synced",
        updatedAt: hourly.fetchedAt,
      },
      locationDirectory: buildLocationDirectory(),
      hourly,
      report,
      metar,
      taf,
      ...dashboardEnhancements,
      multimodel: {
        ...multimodel,
        imageProxyUrl: `/api/weather/multimodel/image?allowStale=true&locationId=${encodeURIComponent(locationId)}`,
        displayUpdatedAt: multimodel.imageFetchedAt ?? multimodel.lastSuccessAt,
        sourceType: "official-relayed-image",
        parity: "exact-image-relay",
        statusLabel:
          multimodel.imageStatus === "unavailable" && !multimodel.imageUrlFound
            ? "unavailable"
            : multimodel.freshness === "fallback_error"
              ? "fallback_error"
              : multimodel.freshness === "revalidating"
                ? "revalidating"
                : "ready",
      },
    };
  });

  app.get("/api/weather/multimodel/image", async (request, reply) => {
    const query = (request.query as Record<string, unknown> | undefined) ?? {};
    const locationId = parseQueryLocationId(query.locationId);
    const allowStale = parseAllowStale(query.allowStale);
    const image = await service.getMultiModelImage(locationId, allowStale);

    reply.code(200).header("content-type", image.contentType);
    for (const [key, value] of Object.entries(image.headers)) {
      reply.header(key, value);
    }

    return reply.send(image.body);
  });

  app.get("/api/weather/multimodel/status", async (request) => {
    const query = (request.query as Record<string, unknown> | undefined) ?? {};
    const locationId = parseQueryLocationId(query.locationId);
    return await service.getMultiModelStatus(locationId);
  });

  app.get("/api/weather/multimodel/distribution", async (request) => {
    const query = (request.query as Record<string, unknown> | undefined) ?? {};
    const locationId = parseQueryLocationId(query.locationId);
    const timestamp = parseTimestamp(query.timestamp);
    const bucketSize = parseBucketSize(query.bucketSize);
    return await service.getMultiModelDistribution(locationId, timestamp, bucketSize);
  });

  app.get("/api/weather/multimodel/insights", async (request) => {
    if (!service.getMultiModelInsight) {
      throw new AppError(503, "MULTIMODEL_INSIGHT_UNAVAILABLE", "Multimodel insights endpoint is not configured.", {
        retryable: false,
      });
    }

    const query = (request.query as Record<string, unknown> | undefined) ?? {};
    const locationId = parseQueryLocationId(query.locationId);
    const timestamp = parseTimestamp(query.timestamp);
    const actualTemperatureC = parseActualTemperatureC(query.actualTemperatureC);

    return await service.getMultiModelInsight(locationId, timestamp, actualTemperatureC);
  });

  registerKellyRoutes(app, service, {
    enableWebSocketRoutes,
  });

  app.get("/api/user/favorites", async () => {
    if (!service.getUserFavorites) {
      throw new AppError(503, "FAVORITES_UNAVAILABLE", "Favorites endpoint is not configured.", {
        retryable: false,
      });
    }

    return await service.getUserFavorites();
  });

  app.put("/api/user/favorites/:locationId", async (request) => {
    if (!service.setUserFavorite) {
      throw new AppError(503, "FAVORITES_UNAVAILABLE", "Favorites endpoint is not configured.", {
        retryable: false,
      });
    }

    const params = (request.params as Record<string, unknown> | undefined) ?? {};
    const locationId = parseLocationId(params.locationId);
    const favorite = parseFavoriteBody(request.body);

    return await service.setUserFavorite(locationId, favorite);
  });

  app.get("/*", async (request, reply) => {
    const rawUrl = request.raw.url ?? "/";
    const pathname = new URL(rawUrl, "http://localhost").pathname;
    const isAssetRequest = pathname !== "/" && extname(pathname) !== "";

    if (isAssetRequest) {
      const body = await readFrontendAsset(
        frontendDistDir,
        pathname.slice(1),
        new AppError(404, "NOT_FOUND", "Static asset not found."),
      );
      const contentType = staticContentTypes[extname(pathname).toLowerCase()] ?? "application/octet-stream";
      const cacheControl = pathname.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-store, max-age=0";

      reply.code(200).header("content-type", contentType).header("cache-control", cacheControl);
      return reply.send(body);
    }

    const indexHtml = await readFrontendAsset(
      frontendDistDir,
      "index.html",
      new AppError(
        503,
        "FRONTEND_BUILD_MISSING",
        "Frontend build not found. Run 'npm --prefix zip run build' first.",
      ),
    );

    reply.code(200).header("content-type", "text/html; charset=utf-8").header("cache-control", "no-store, max-age=0");
    return reply.send(indexHtml);
  });

  app.setErrorHandler((error, request, reply) => {
    if (isAppError(error)) {
      return reply.code(error.statusCode).send(error.toPayload());
    }

    request.log.error(error);
    const fallback = new AppError(500, "INTERNAL_SERVER_ERROR", "Unexpected server error.");
    return reply.code(500).send(fallback.toPayload());
  });

  app.setNotFoundHandler((_request, reply) => {
    const error = new AppError(404, "NOT_FOUND", "Route not found.");
    return reply.code(404).send(error.toPayload());
  });

  return app;
};
