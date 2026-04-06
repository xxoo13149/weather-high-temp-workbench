import { readFile, stat } from "node:fs/promises";
import { extname, normalize, resolve, sep } from "node:path";

import websocket from "@fastify/websocket";
import Fastify from "fastify";

import { DEFAULT_LOCATION, LOCATION_DIRECTORY, LOCATION_REGISTRY } from "./config.js";
import { AppError, isAppError } from "./domain/errors.js";
import type { HourlyMode, KellyRiskMode, LocationDirectoryEntry, LocationInfo, WeatherService } from "./domain/weather.js";
import { MeteoblueWeatherService } from "./providers/meteoblue/service.js";

interface CreateAppOptions {
  frontendDistDir?: string;
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
  if (raw === undefined || raw === "") {
    return undefined;
  }

  if (typeof raw !== "string") {
    throw new AppError(400, "BAD_REQUEST", "Query parameter 'limit' must be a positive integer.");
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new AppError(400, "BAD_REQUEST", "Query parameter 'limit' must be a positive integer.");
  }

  return value;
};

const parseAllowStale = (raw: unknown): boolean => raw === "true" || raw === "1";

const parseTimestamp = (raw: unknown): string | undefined => {
  if (raw === undefined || raw === "") {
    return undefined;
  }

  if (typeof raw !== "string") {
    throw new AppError(400, "BAD_REQUEST", "Query parameter 'timestamp' must be a valid ISO timestamp.");
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(400, "BAD_REQUEST", "Query parameter 'timestamp' must be a valid ISO timestamp.");
  }

  return raw;
};

const parseBucketSize = (raw: unknown): number | undefined => {
  if (raw === undefined || raw === "") {
    return undefined;
  }

  if (typeof raw !== "string") {
    throw new AppError(400, "BAD_REQUEST", "Query parameter 'bucketSize' must be a positive number.");
  }

  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new AppError(400, "BAD_REQUEST", "Query parameter 'bucketSize' must be a positive number.");
  }

  return value;
};

const parseActualTemperatureC = (raw: unknown): number | undefined => {
  if (raw === undefined || raw === "") {
    return undefined;
  }

  if (typeof raw !== "string") {
    throw new AppError(400, "BAD_REQUEST", "Query parameter 'actualTemperatureC' must be a finite number.");
  }

  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) {
    throw new AppError(400, "BAD_REQUEST", "Query parameter 'actualTemperatureC' must be a finite number.");
  }

  return value;
};

const parseKellyTargetDate = (raw: unknown): string | undefined => {
  if (raw === undefined || raw === "") {
    return undefined;
  }

  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new AppError(400, "BAD_REQUEST", "Query parameter 'targetDate' must use YYYY-MM-DD format.");
  }

  return raw;
};

const parseBankroll = (raw: unknown): number | undefined => {
  if (raw === undefined || raw === "") {
    return undefined;
  }

  if (typeof raw !== "string") {
    throw new AppError(400, "BAD_REQUEST", "Query parameter 'bankroll' must be a positive number.");
  }

  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new AppError(400, "BAD_REQUEST", "Query parameter 'bankroll' must be a positive number.");
  }

  return value;
};

const parseKellyRiskMode = (raw: unknown): KellyRiskMode | undefined => {
  if (raw === undefined || raw === "") {
    return undefined;
  }

  if (raw === "conservative" || raw === "balanced" || raw === "aggressive") {
    return raw;
  }

  throw new AppError(400, "BAD_REQUEST", "Query parameter 'riskMode' must be conservative, balanced, or aggressive.");
};

const parseKellyMinEdge = (raw: unknown): number | undefined => {
  if (raw === undefined || raw === "") {
    return undefined;
  }

  if (typeof raw !== "string") {
    throw new AppError(400, "BAD_REQUEST", "Query parameter 'minEdge' must be between 0 and 1.");
  }

  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new AppError(400, "BAD_REQUEST", "Query parameter 'minEdge' must be between 0 and 1.");
  }

  return value;
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

const buildLocationDirectory = (): LocationDirectoryEntry[] =>
  LOCATION_DIRECTORY.map((location) => ({
    id: location.id,
    code: location.code,
    displayName: location.displayName,
    displayNameZh: location.displayNameZh,
    shortLabel: location.shortLabel,
    cityName: location.cityName,
    countryName: location.countryName,
    timezone: location.timezone,
    timezoneGroup: location.timezoneGroup,
    enabled: location.enabled,
    sortOrder: location.sortOrder,
    weekPageUrl: location.weekPageUrl,
    multimodelPageUrl: location.multimodelPageUrl,
  }));

export const createApp = (
  service: WeatherService = new MeteoblueWeatherService(),
  options: CreateAppOptions = {},
) => {
  const app = Fastify({
    logger: false,
  });
  void app.register(websocket);

  const frontendDistDir = options.frontendDistDir ?? defaultFrontendDistDir;
  const buildId = process.env.BUILD_ID ?? `local-${Date.now().toString(36)}`;
  const startedAt = new Date().toISOString();

  app.get("/healthz", async () => ({ ok: true, buildId, startedAt }));

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

    const [hourly, multimodel, report] = await Promise.all([
      service.getHourly(locationId, mode, limit),
      service.getMultiModelStatus(locationId),
      service.getWeatherReport(locationId),
    ]);

    const syncState = hourly.stale || report.stale ? "stale" : "fresh";

    return {
      generatedAt: new Date().toISOString(),
      sync: {
        state: syncState,
        label: syncState === "stale" ? "stale" : "synced",
        updatedAt: hourly.fetchedAt,
      },
      locationDirectory: buildLocationDirectory(),
      hourly,
      report,
      multimodel: {
        ...multimodel,
        imageProxyUrl: `/api/weather/multimodel/image?allowStale=true&locationId=${encodeURIComponent(locationId)}`,
        displayUpdatedAt: multimodel.imageFetchedAt ?? multimodel.lastSuccessAt,
        sourceType: "official-relayed-image",
        parity: "exact-image-relay",
        statusLabel:
          multimodel.imageFetchedAt ?? multimodel.lastSuccessAt
            ? multimodel.stale
              ? "stale"
              : "fresh"
            : "unavailable",
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

  app.get("/api/weather/kelly", async (request) => {
    if (!service.getKellyWorkbench) {
      throw new AppError(503, "KELLY_UNAVAILABLE", "Kelly workbench is not configured.", {
        retryable: false,
      });
    }

    const query = (request.query as Record<string, unknown> | undefined) ?? {};
    const locationId = parseQueryLocationId(query.locationId);
    const targetDate = parseKellyTargetDate(query.targetDate);
    const bankroll = parseBankroll(query.bankroll);
    const riskMode = parseKellyRiskMode(query.riskMode);
    const minEdge = parseKellyMinEdge(query.minEdge);
    const actualTemperatureC = parseActualTemperatureC(query.actualTemperatureC);
    const selectedHourTimestamp = parseTimestamp(query.selectedHour);

    return await service.getKellyWorkbench(locationId, {
      targetDate,
      bankroll,
      riskMode,
      minEdge,
      actualTemperatureC,
      selectedHourTimestamp,
    });
  });

  app.get(
    "/api/weather/kelly/stream",
    { websocket: true },
    async (socket, request) => {
      if (!service.createKellyStream) {
        socket.send(
          JSON.stringify({
            type: "status",
            generatedAt: new Date().toISOString(),
            state: "unavailable",
            message: "Kelly stream is not configured.",
          }),
        );
        socket.close();
        return;
      }

      const query = (request.query as Record<string, unknown> | undefined) ?? {};

      try {
        const locationId = parseQueryLocationId(query.locationId);
        const targetDate = parseKellyTargetDate(query.targetDate);
        const bankroll = parseBankroll(query.bankroll);
        const riskMode = parseKellyRiskMode(query.riskMode);
        const minEdge = parseKellyMinEdge(query.minEdge);
        const actualTemperatureC = parseActualTemperatureC(query.actualTemperatureC);
        const selectedHourTimestamp = parseTimestamp(query.selectedHour);

        const stream = await service.createKellyStream(
          locationId,
          {
            targetDate,
            bankroll,
            riskMode,
            minEdge,
            actualTemperatureC,
            selectedHourTimestamp,
          },
          (message) => {
            socket.send(JSON.stringify(message));
          },
        );

        socket.on("close", async () => {
          await stream.close();
        });
      } catch (error) {
        const appError =
          error instanceof AppError ? error : new AppError(500, "KELLY_STREAM_ERROR", "Kelly stream failed to initialize.");
        socket.send(
          JSON.stringify({
            type: "status",
            generatedAt: new Date().toISOString(),
            state: "degraded",
            message: appError.message,
          }),
        );
        socket.close();
      }
    },
  );

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
