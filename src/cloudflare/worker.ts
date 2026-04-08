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
import { KELLY_BRIDGE_SHARED_SECRET_HEADER } from "../kelly/bridge-contract.js";
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
  KELLY_BRIDGE_SHARED_SECRET?: string;
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
const KELLY_BRIDGE_TIMEOUT_MS = 8_000;
const KELLY_BRIDGE_COOLDOWN_MS = 30_000;

type KellyBridgeProxyState = {
  consecutiveFailures: number;
  cooldownUntil: number;
  lastFailureAt: string | null;
  lastFailureCode: string | null;
  lastFailureMessage: string | null;
  lastSuccessAt: string | null;
};

let servicePromise: Promise<MeteoblueWeatherService> | null = null;
let kellyBridgeProxyState: KellyBridgeProxyState = {
  consecutiveFailures: 0,
  cooldownUntil: 0,
  lastFailureAt: null,
  lastFailureCode: null,
  lastFailureMessage: null,
  lastSuccessAt: null,
};

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

const recordKellyBridgeSuccess = (occurredAt: string) => {
  kellyBridgeProxyState = {
    ...kellyBridgeProxyState,
    consecutiveFailures: 0,
    cooldownUntil: 0,
    lastSuccessAt: occurredAt,
  };
};

const recordKellyBridgeFailure = (code: string, message: string, occurredAt: string) => {
  kellyBridgeProxyState = {
    ...kellyBridgeProxyState,
    consecutiveFailures: kellyBridgeProxyState.consecutiveFailures + 1,
    cooldownUntil: Date.now() + KELLY_BRIDGE_COOLDOWN_MS,
    lastFailureAt: occurredAt,
    lastFailureCode: code,
    lastFailureMessage: message,
  };
};

const resolveKellyBridgeCooldownError = () => {
  const remainingMs = Math.max(0, kellyBridgeProxyState.cooldownUntil - Date.now());
  const remainingSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
  return new AppError(
    503,
    "KELLY_BRIDGE_COOLDOWN",
    `Kelly bridge 正在冷却恢复，约 ${remainingSeconds}s 后再试。当前继续保留上一份快照。`,
    {
      retryable: true,
      lastSuccessAt: kellyBridgeProxyState.lastSuccessAt,
    },
  );
};

const readBridgeResponseMessage = async (response: Response): Promise<string | null> => {
  try {
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.includes("application/json")) {
      const payload = (await response.clone().json()) as { message?: unknown } | null;
      return typeof payload?.message === "string" ? payload.message : null;
    }

    const text = (await response.clone().text()).replace(/\s+/g, " ").trim();
    return text ? text.slice(0, 240) : null;
  } catch {
    return null;
  }
};

const isAbortError = (error: unknown) =>
  error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error
      ? error.name === "AbortError"
      : false;

const buildKellyBridgeRequest = (request: Request, env: WorkerEnv): Request | null => {
  const bridgeBaseUrl = resolveKellyBridgeBaseUrl(env);
  if (!bridgeBaseUrl) {
    return null;
  }

  const incomingUrl = new URL(request.url);
  const headers = new Headers(request.headers);
  headers.set("x-forwarded-host", incomingUrl.host);
  headers.set("x-forwarded-proto", incomingUrl.protocol.replace(":", ""));
  const sharedSecret = env.KELLY_BRIDGE_SHARED_SECRET?.trim();
  if (sharedSecret) {
    headers.set(KELLY_BRIDGE_SHARED_SECRET_HEADER, sharedSecret);
  }

  return new Request(`${bridgeBaseUrl}${incomingUrl.pathname}${incomingUrl.search}`, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    redirect: "manual",
  });
};

const proxyKellyRequest = async (
  request: Request,
  env: WorkerEnv,
  options?: {
    expectWebSocket?: boolean;
  },
): Promise<Response | null> => {
  const proxyRequest = buildKellyBridgeRequest(request, env);
  if (!proxyRequest) {
    return null;
  }

  if (kellyBridgeProxyState.cooldownUntil > Date.now()) {
    throw resolveKellyBridgeCooldownError();
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), KELLY_BRIDGE_TIMEOUT_MS);

  try {
    const timedRequest = new Request(proxyRequest, {
      signal: controller.signal,
    });
    const response = await fetch(timedRequest);
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    const occurredAt = new Date().toISOString();
    const expectsWebSocket = options?.expectWebSocket === true;
    const isWebSocketUpgrade = response.status === 101;
    const isJson = contentType.includes("application/json");
    const isHtml = contentType.includes("text/html");

    if (expectsWebSocket) {
      if (isWebSocketUpgrade) {
        recordKellyBridgeSuccess(occurredAt);
        return response;
      }

      if (response.status >= 500 || isHtml) {
        const detail = await readBridgeResponseMessage(response);
        const message = detail
          ? `Kelly bridge WebSocket 上游异常：${detail}`
          : "Kelly bridge WebSocket 上游当前不可用。";
        recordKellyBridgeFailure("KELLY_BRIDGE_UNAVAILABLE", message, occurredAt);
        throw new AppError(502, "KELLY_BRIDGE_UNAVAILABLE", message, {
          retryable: true,
          lastSuccessAt: kellyBridgeProxyState.lastSuccessAt,
        });
      }

      recordKellyBridgeSuccess(occurredAt);
      return response;
    }

    if (response.ok && isJson) {
      recordKellyBridgeSuccess(occurredAt);
      return response;
    }

    if (!response.ok && response.status < 500 && isJson) {
      recordKellyBridgeSuccess(occurredAt);
      return response;
    }

    const detail = await readBridgeResponseMessage(response);
    const code = response.status >= 500 || isHtml ? "KELLY_BRIDGE_UNAVAILABLE" : "KELLY_BRIDGE_BAD_RESPONSE";
    const message =
      code === "KELLY_BRIDGE_BAD_RESPONSE"
        ? `Kelly bridge 返回了不可识别的响应（status ${response.status}，content-type ${contentType || "unknown"}）。`
        : detail
          ? `Kelly bridge 当前不可用：${detail}`
          : `Kelly bridge 当前不可用（status ${response.status}）。`;
    recordKellyBridgeFailure(code, message, occurredAt);
    throw new AppError(response.status >= 500 ? 502 : 502, code, message, {
      retryable: true,
      lastSuccessAt: kellyBridgeProxyState.lastSuccessAt,
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    const occurredAt = new Date().toISOString();
    if (isAbortError(error)) {
      const message = `Kelly bridge 在 ${Math.round(KELLY_BRIDGE_TIMEOUT_MS / 1000)}s 内未完成响应。`;
      recordKellyBridgeFailure("KELLY_BRIDGE_TIMEOUT", message, occurredAt);
      throw new AppError(504, "KELLY_BRIDGE_TIMEOUT", message, {
        retryable: true,
        lastSuccessAt: kellyBridgeProxyState.lastSuccessAt,
      });
    }

    const message = `Kelly bridge 请求失败：${error instanceof Error ? error.message : String(error)}`;
    recordKellyBridgeFailure("KELLY_BRIDGE_UNAVAILABLE", message, occurredAt);
    throw new AppError(
      502,
      "KELLY_BRIDGE_UNAVAILABLE",
      message,
      {
        retryable: true,
        lastSuccessAt: kellyBridgeProxyState.lastSuccessAt,
      },
    );
  } finally {
    clearTimeout(timeoutId);
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

  const bridgedResponse = await proxyKellyRequest(request, env, { expectWebSocket: true });
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
    return jsonResponse({
      ok: true,
      service: "weather-worker",
      buildId,
      startedAt,
      kellyBridge: {
        configured: Boolean(resolveKellyBridgeBaseUrl(env)),
        baseUrl: resolveKellyBridgeBaseUrl(env),
        timeoutMs: KELLY_BRIDGE_TIMEOUT_MS,
        cooldownMs: KELLY_BRIDGE_COOLDOWN_MS,
        cooldownActive: kellyBridgeProxyState.cooldownUntil > Date.now(),
        cooldownUntil:
          kellyBridgeProxyState.cooldownUntil > 0 ? new Date(kellyBridgeProxyState.cooldownUntil).toISOString() : null,
        consecutiveFailures: kellyBridgeProxyState.consecutiveFailures,
        lastSuccessAt: kellyBridgeProxyState.lastSuccessAt,
        lastFailureAt: kellyBridgeProxyState.lastFailureAt,
        lastFailureCode: kellyBridgeProxyState.lastFailureCode,
        lastFailureMessage: kellyBridgeProxyState.lastFailureMessage,
      },
    });
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
