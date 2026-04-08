import { DEFAULT_LOCATION, LOCATION_DIRECTORY, LOCATION_REGISTRY } from "../config.js";
import { AppError, isAppError } from "../domain/errors.js";
import type {
  HourlyMode,
  KellyRequestOptions,
  KellyRiskMode,
  KellyStreamMessage,
  LocationDirectoryEntry,
  LocationInfo,
} from "../domain/weather.js";
import { MeteoblueWeatherService } from "../providers/meteoblue/service.js";
import { CloudflareFavoritesStore, InMemoryFavoritesStore } from "./favorites-store.js";

type AssetBinding = {
  fetch(request: Request): Promise<Response>;
};

type WorkerEnv = {
  ASSETS: AssetBinding;
  FAVORITES_KV?: {
    get(key: string): Promise<string | null>;
    put(key: string, value: string): Promise<void>;
  };
  KELLY_BRIDGE_BASE_URL?: string;
};

type WorkerContext = {
  waitUntil(promise: Promise<unknown>): void;
};

type WebSocketPairCtor = new () => {
  0: CloudflareWebSocket;
  1: CloudflareWebSocket;
};

type CloudflareWebSocket = WebSocket & {
  accept(): void;
  close(code?: number, reason?: string): void;
};

const buildId = process.env.BUILD_ID ?? `worker-${Date.now().toString(36)}`;
const startedAt = new Date().toISOString();

let servicePromise: Promise<MeteoblueWeatherService> | null = null;

const getService = async (env: WorkerEnv) => {
  if (!servicePromise) {
    const favoritesStore = env.FAVORITES_KV
      ? new CloudflareFavoritesStore(env.FAVORITES_KV)
      : new InMemoryFavoritesStore();
    servicePromise = Promise.resolve(new MeteoblueWeatherService({ favoritesStore }));
  }

  return await servicePromise;
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

const parseMode = (raw: string | null): HourlyMode => {
  if (raw === null || raw === "" || raw === "1h") {
    return "1h";
  }

  if (raw === "3h") {
    return "3h";
  }

  throw new AppError(400, "BAD_REQUEST", "Query parameter 'mode' must be either '1h' or '3h'.");
};

const parseLimit = (raw: string | null): number | undefined => {
  if (raw === null || raw === "") {
    return undefined;
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new AppError(400, "BAD_REQUEST", "Query parameter 'limit' must be a positive integer.");
  }

  return value;
};

const parseAllowStale = (raw: string | null): boolean => raw === "true" || raw === "1";

const parseTimestamp = (raw: string | null): string | undefined => {
  if (raw === null || raw === "") {
    return undefined;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(400, "BAD_REQUEST", "Query parameter 'timestamp' must be a valid ISO timestamp.");
  }

  return raw;
};

const parseBucketSize = (raw: string | null): number | undefined => {
  if (raw === null || raw === "") {
    return undefined;
  }

  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new AppError(400, "BAD_REQUEST", "Query parameter 'bucketSize' must be a positive number.");
  }

  return value;
};

const parseFloatNumber = (raw: string | null, message: string): number | undefined => {
  if (raw === null || raw === "") {
    return undefined;
  }

  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) {
    throw new AppError(400, "BAD_REQUEST", message);
  }

  return value;
};

const parseActualTemperatureC = (raw: string | null): number | undefined =>
  parseFloatNumber(raw, "Query parameter 'actualTemperatureC' must be a finite number.");

const parseKellyTargetDate = (raw: string | null): string | undefined => {
  if (raw === null || raw === "") {
    return undefined;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new AppError(400, "BAD_REQUEST", "Query parameter 'targetDate' must use YYYY-MM-DD format.");
  }

  return raw;
};

const parseBankroll = (raw: string | null): number | undefined => {
  const value = parseFloatNumber(raw, "Query parameter 'bankroll' must be a positive number.");
  if (value === undefined) {
    return undefined;
  }

  if (value <= 0) {
    throw new AppError(400, "BAD_REQUEST", "Query parameter 'bankroll' must be a positive number.");
  }

  return value;
};

const parseKellyRiskMode = (raw: string | null): KellyRiskMode | undefined => {
  if (raw === null || raw === "") {
    return undefined;
  }

  if (raw === "conservative" || raw === "balanced" || raw === "aggressive") {
    return raw;
  }

  throw new AppError(400, "BAD_REQUEST", "Query parameter 'riskMode' must be conservative, balanced, or aggressive.");
};

const parseKellyMinEdge = (raw: string | null): number | undefined => {
  const value = parseFloatNumber(raw, "Query parameter 'minEdge' must be between 0 and 1.");
  if (value === undefined) {
    return undefined;
  }

  if (value < 0 || value > 1) {
    throw new AppError(400, "BAD_REQUEST", "Query parameter 'minEdge' must be between 0 and 1.");
  }

  return value;
};

const parseQueryLocationId = (raw: string | null): LocationInfo["id"] => {
  if (raw === null || raw === "") {
    return DEFAULT_LOCATION;
  }

  const locationId = raw.trim() as LocationInfo["id"];
  if (!(locationId in LOCATION_REGISTRY)) {
    throw new AppError(400, "BAD_REQUEST", `Query parameter 'locationId' is not supported: '${raw}'.`);
  }

  return locationId;
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

const parseKellyOptions = (url: URL): KellyRequestOptions => ({
  targetDate: parseKellyTargetDate(url.searchParams.get("targetDate")),
  bankroll: parseBankroll(url.searchParams.get("bankroll")),
  riskMode: parseKellyRiskMode(url.searchParams.get("riskMode")),
  minEdge: parseKellyMinEdge(url.searchParams.get("minEdge")),
  actualTemperatureC: parseActualTemperatureC(url.searchParams.get("actualTemperatureC")),
  selectedHourTimestamp: parseTimestamp(url.searchParams.get("selectedHour")),
});

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, max-age=0",
    },
  });

const handleError = (error: unknown) => {
  if (isAppError(error)) {
    return jsonResponse(error.toPayload(), error.statusCode);
  }

  const fallback = new AppError(500, "INTERNAL_SERVER_ERROR", "Unexpected server error.");
  return jsonResponse(fallback.toPayload(), 500);
};

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, "");

const resolveKellyBridgeBaseUrl = (env: WorkerEnv): string | null => {
  const raw = env.KELLY_BRIDGE_BASE_URL?.trim();
  return raw ? normalizeBaseUrl(raw) : null;
};

const buildKellyBridgeRequest = (request: Request, env: WorkerEnv): Request | null => {
  const bridgeBaseUrl = resolveKellyBridgeBaseUrl(env);
  if (!bridgeBaseUrl) {
    return null;
  }

  const incomingUrl = new URL(request.url);
  const headers = new Headers(request.headers);
  headers.set("x-forwarded-host", incomingUrl.host);
  headers.set("x-forwarded-proto", incomingUrl.protocol.replace(":", ""));

  return new Request(`${bridgeBaseUrl}${incomingUrl.pathname}${incomingUrl.search}`, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    redirect: "manual",
  });
};

const proxyKellyRequest = async (request: Request, env: WorkerEnv): Promise<Response | null> => {
  const proxyRequest = buildKellyBridgeRequest(request, env);
  if (!proxyRequest) {
    return null;
  }

  try {
    return await fetch(proxyRequest);
  } catch (error) {
    throw new AppError(
      502,
      "KELLY_BRIDGE_UNAVAILABLE",
      `Kelly bridge request failed: ${error instanceof Error ? error.message : String(error)}`,
      {
        retryable: true,
      },
    );
  }
};

const sendSocketMessage = (socket: CloudflareWebSocket, message: KellyStreamMessage) => {
  try {
    socket.send(JSON.stringify(message));
  } catch {
    socket.close();
  }
};

const handleKellyStream = async (request: Request, env: WorkerEnv, ctx: WorkerContext) => {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Expected Upgrade: websocket", { status: 426 });
  }

  const bridgedResponse = await proxyKellyRequest(request, env);
  if (bridgedResponse) {
    return bridgedResponse;
  }

  const pair = new ((globalThis as unknown as { WebSocketPair: WebSocketPairCtor }).WebSocketPair)();
  const client = pair[0];
  const server = pair[1];
  server.accept();

  const service = await getService(env);
  const url = new URL(request.url);
  const locationId = parseQueryLocationId(url.searchParams.get("locationId"));

  ctx.waitUntil(
    (async () => {
      try {
        const stream = await service.createKellyStream?.(locationId, parseKellyOptions(url), (message) =>
          sendSocketMessage(server, message),
        );

        if (!stream) {
          sendSocketMessage(server, {
            type: "status",
            generatedAt: new Date().toISOString(),
            state: "unavailable",
            reasonCode: "upstream_error",
            message: "Kelly 实时流当前不可用。",
          });
          server.close(1011, "kelly-stream-unavailable");
          return;
        }

        const closeStream = async () => {
          try {
            await stream.close();
          } catch {
            // Ignore cleanup failures.
          }
        };

        server.addEventListener("close", () => {
          ctx.waitUntil(closeStream());
        });
        server.addEventListener("error", () => {
          ctx.waitUntil(closeStream());
        });
      } catch (error) {
        sendSocketMessage(server, {
          type: "status",
          generatedAt: new Date().toISOString(),
          state: "degraded",
          reasonCode: "upstream_error",
          message: error instanceof Error ? error.message : "Kelly 实时流初始化失败。",
        });
        server.close(1011, "kelly-stream-error");
      }
    })(),
  );

  return new Response(null, {
    status: 101,
    ...( { webSocket: client } as ResponseInit ),
  });
};

const handleApiRequest = async (request: Request, env: WorkerEnv): Promise<Response> => {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/healthz") {
    return jsonResponse({ ok: true, buildId, startedAt });
  }

  if (request.method === "GET" && url.pathname === "/api/weather/kelly") {
    const bridgedResponse = await proxyKellyRequest(request, env);
    if (bridgedResponse) {
      return bridgedResponse;
    }
  }

  const service = await getService(env);
  const locationId = parseQueryLocationId(url.searchParams.get("locationId"));

  switch (`${request.method} ${url.pathname}`) {
    case "GET /api/weather/hourly":
      return jsonResponse(
        await service.getHourly(locationId, parseMode(url.searchParams.get("mode")), parseLimit(url.searchParams.get("limit"))),
      );

    case "GET /api/weather/report":
      return jsonResponse(await service.getWeatherReport(locationId));

    case "GET /api/weather/dashboard": {
      const mode = parseMode(url.searchParams.get("mode"));
      const limit = parseLimit(url.searchParams.get("limit"));
      const [hourly, multimodel, report] = await Promise.all([
        service.getHourly(locationId, mode, limit),
        service.getMultiModelStatus(locationId),
        service.getWeatherReport(locationId),
      ]);
      const syncState = hourly.stale || report.stale ? "stale" : "fresh";

      return jsonResponse({
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
      });
    }

    case "GET /api/weather/multimodel/image": {
      const image = await service.getMultiModelImage(locationId, parseAllowStale(url.searchParams.get("allowStale")));
      const headers = new Headers(image.headers);
      headers.set("content-type", image.contentType);
      return new Response(new Uint8Array(image.body), {
        status: 200,
        headers,
      });
    }

    case "GET /api/weather/multimodel/status":
      return jsonResponse(await service.getMultiModelStatus(locationId));

    case "GET /api/weather/multimodel/distribution":
      return jsonResponse(
        await service.getMultiModelDistribution(
          locationId,
          parseTimestamp(url.searchParams.get("timestamp")),
          parseBucketSize(url.searchParams.get("bucketSize")),
        ),
      );

    case "GET /api/weather/multimodel/insights":
      if (!service.getMultiModelInsight) {
        throw new AppError(503, "MULTIMODEL_INSIGHT_UNAVAILABLE", "Multimodel insights endpoint is not configured.", {
          retryable: false,
        });
      }
      return jsonResponse(
        await service.getMultiModelInsight(
          locationId,
          parseTimestamp(url.searchParams.get("timestamp")),
          parseActualTemperatureC(url.searchParams.get("actualTemperatureC")),
        ),
      );

    case "GET /api/weather/kelly":
      if (!service.getKellyWorkbench) {
        throw new AppError(503, "KELLY_UNAVAILABLE", "Kelly workbench is not configured.", {
          retryable: false,
        });
      }
      return jsonResponse(await service.getKellyWorkbench(locationId, parseKellyOptions(url)));

    case "GET /api/user/favorites":
      if (!service.getUserFavorites) {
        throw new AppError(503, "FAVORITES_UNAVAILABLE", "Favorites endpoint is not configured.", {
          retryable: false,
        });
      }
      return jsonResponse(await service.getUserFavorites());

    default:
      break;
  }

  if (request.method === "PUT" && url.pathname.startsWith("/api/user/favorites/")) {
    if (!service.setUserFavorite) {
      throw new AppError(503, "FAVORITES_UNAVAILABLE", "Favorites endpoint is not configured.", {
        retryable: false,
      });
    }

    const locationPath = decodeURIComponent(url.pathname.slice("/api/user/favorites/".length));
    if (!locationPath) {
      throw new AppError(400, "BAD_REQUEST", "Path parameter 'locationId' must be a non-empty string.");
    }

    const favorite = parseFavoriteBody(await request.json());
    return jsonResponse(await service.setUserFavorite(locationPath as LocationInfo["id"], favorite));
  }

  throw new AppError(404, "NOT_FOUND", "Route not found.");
};

const isApiRequest = (pathname: string) => pathname === "/healthz" || pathname.startsWith("/api/");

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: WorkerContext): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/api/weather/kelly/stream") {
        return await handleKellyStream(request, env, ctx);
      }

      if (isApiRequest(url.pathname)) {
        return await handleApiRequest(request, env);
      }

      return await env.ASSETS.fetch(request);
    } catch (error) {
      return handleError(error);
    }
  },
};
