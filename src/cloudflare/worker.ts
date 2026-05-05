import { DEFAULT_LOCATION, LOCATION_REGISTRY } from "../config.js";
import { AppError, isAppError } from "../domain/errors.js";
import type {
  DashboardMetarSnapshot,
  DashboardTafSnapshot,
  HourlyFieldCoverage,
  HourlyMode,
  HourlySourceType,
  HourlyWeatherResponse,
  KellyCircuitState,
  KellyRequestOptions,
  KellyRiskMode,
  KellyStreamMessage,
  LocationInfo,
  WeatherReportMetrics,
  WeatherReportResponse,
} from "../domain/weather.js";
import { normalizeDashboardMetarSnapshot } from "../domain/weather.js";
import {
  buildDashboardEnhancements,
  buildLocationDirectory,
  buildMetricsText,
  buildSystemStatusResponse,
  getLocationSourceContract,
} from "../operational-metadata.js";
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
  KELLY_SERVER_BASE_URL?: string;
  KELLY_STREAM_PROXY_MODE?: string;
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

type CloudflareResponseWithWebSocket = Response & {
  webSocket?: CloudflareWebSocket;
};

type KellyStreamProxyMode = "local-only" | "canary" | "remote-first";

type KellyProxyCircuitTracker = {
  failureTimestamps: number[];
  consecutiveFailures: number;
  openUntil: number | null;
  halfOpenProbeInFlight: boolean;
  lastOriginSuccessAt: string | null;
  lastOriginFailureAt: string | null;
  lastOriginFailureCode: string | null;
  localFallbackActive: boolean;
};

let runtimeBuildId: string | null = null;
let runtimeStartedAt: string | null = null;

let servicePromise: Promise<MeteoblueWeatherService> | null = null;

const KELLY_PROXY_FAILURE_THRESHOLD = 3;
const KELLY_PROXY_FAILURE_WINDOW_MS = 60_000;
const KELLY_PROXY_OPEN_DURATION_MS = 5 * 60_000;
const KELLY_PROXY_GET_TIMEOUT_MS = 14_000;
const DASHBOARD_PROXY_GET_TIMEOUT_MS = 14_000;
const KELLY_PROXY_STREAM_TIMEOUT_MS = 6_000;

const createKellyProxyCircuitTracker = (): KellyProxyCircuitTracker => ({
  failureTimestamps: [],
  consecutiveFailures: 0,
  openUntil: null,
  halfOpenProbeInFlight: false,
  lastOriginSuccessAt: null,
  lastOriginFailureAt: null,
  lastOriginFailureCode: null,
  localFallbackActive: false,
});

const kellyGetProxyCircuit = createKellyProxyCircuitTracker();
const kellyStreamProxyCircuit = createKellyProxyCircuitTracker();
const dashboardGetProxyCircuit = createKellyProxyCircuitTracker();

const ensureRuntimeMetadata = () => {
  const rawBuildId =
    typeof process !== "undefined" && process.env && typeof process.env.BUILD_ID === "string"
      ? process.env.BUILD_ID.trim()
      : "";

  if (!runtimeBuildId) {
    const generatedBuildId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? `worker-${crypto.randomUUID()}`
        : `worker-${Math.random().toString(36).slice(2, 10)}`;
    runtimeBuildId = rawBuildId || generatedBuildId;
  }

  if (!runtimeStartedAt) {
    runtimeStartedAt = new Date().toISOString();
  }

  return {
    buildId: runtimeBuildId,
    startedAt: runtimeStartedAt,
  };
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

const parseForceRefresh = (raw: string | null): boolean | undefined => {
  if (raw === null || raw === "") {
    return undefined;
  }

  if (raw === "true" || raw === "1") {
    return true;
  }

  if (raw === "false" || raw === "0") {
    return false;
  }

  throw new AppError(400, "BAD_REQUEST", "Query parameter 'forceRefresh' must be boolean.");
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
  forceRefresh: parseForceRefresh(url.searchParams.get("forceRefresh")),
});

const DEFAULT_CACHE_CONTROL = "no-store, max-age=0";
const EDGE_CACHE_TTL_SECONDS = {
  hourly: 45,
  report: 45,
  dashboard: 30,
  multimodelStatus: 45,
  multimodelInsight: 90,
  multimodelDistribution: 90,
} as const;
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

const buildEdgeCacheControl = (ttlSeconds: number) =>
  `public, max-age=0, s-maxage=${ttlSeconds}, stale-while-revalidate=${ttlSeconds}`;

const jsonResponse = (payload: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": DEFAULT_CACHE_CONTROL,
      ...(headers ?? {}),
    },
  });

const withEdgeJsonCache = async <T>(
  request: Request,
  ctx: WorkerContext,
  ttlSeconds: number,
  loader: () => Promise<T>,
  options?: {
    shouldCache?: (payload: T) => boolean;
  },
): Promise<Response> => {
  const edgeCache =
    typeof caches === "undefined" ? null : ((caches as CacheStorage & { default?: Cache }).default ?? null);
  if (!edgeCache) {
    return jsonResponse(await loader());
  }

  const cacheKey = new Request(request.url, {
    method: "GET",
  });
  const cachedResponse = await edgeCache.match(cacheKey);
  if (cachedResponse) {
    return cachedResponse;
  }

  const cacheControl = buildEdgeCacheControl(ttlSeconds);
  const payload = await loader();
  if (options?.shouldCache && !options.shouldCache(payload)) {
    return jsonResponse(payload);
  }

  const response = jsonResponse(payload, 200, {
    "cache-control": cacheControl,
    "cdn-cache-control": cacheControl,
  });
  ctx.waitUntil(edgeCache.put(cacheKey, response.clone()));
  return response;
};

const hasFreshFreshness = (payload: unknown) =>
  typeof payload !== "object" ||
  payload === null ||
  !("freshness" in payload) ||
  (payload as { freshness?: unknown }).freshness === "fresh";

const hasCacheableMultimodelFreshness = (payload: unknown) => {
  if (typeof payload !== "object" || payload === null || !("freshness" in payload)) {
    return true;
  }

  const freshness = (payload as { freshness?: unknown }).freshness;
  return freshness === "fresh" || freshness === "fallback_error";
};

const hasCacheableMultimodelStatus = (payload: unknown) => {
  if (!hasCacheableMultimodelFreshness(payload)) {
    return false;
  }

  if (
    typeof payload === "object" &&
    payload !== null &&
    "imageStatus" in payload &&
    "analysisStatus" in payload &&
    (payload as { imageStatus?: unknown }).imageStatus === "unavailable" &&
    (payload as { analysisStatus?: unknown }).analysisStatus === "unavailable"
  ) {
    return false;
  }

  return true;
};

const hasFreshDashboardSync = (payload: unknown) =>
  typeof payload === "object" &&
  payload !== null &&
  "sync" in payload &&
  typeof (payload as { sync?: { freshness?: unknown } }).sync?.freshness === "string" &&
  (payload as { sync: { freshness: string } }).sync.freshness === "fresh";

const resolvePayloadFreshness = (
  payload: unknown,
  staleFallback: boolean,
): "fresh" | "revalidating" | "fallback_error" => {
  if (typeof payload === "object" && payload !== null && typeof (payload as { freshness?: unknown }).freshness === "string") {
    return (payload as { freshness: "fresh" | "revalidating" | "fallback_error" }).freshness;
  }

  return staleFallback ? "fallback_error" : "fresh";
};

const loadDashboardMetarSnapshot = async (
  service: Awaited<ReturnType<typeof getService>>,
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
  service: Awaited<ReturnType<typeof getService>>,
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

const handleError = (error: unknown) => {
  if (isAppError(error)) {
    return jsonResponse(error.toPayload(), error.statusCode);
  }

  const fallback = new AppError(500, "INTERNAL_SERVER_ERROR", "Unexpected server error.");
  return jsonResponse(fallback.toPayload(), 500);
};

const sendSocketMessage = (socket: CloudflareWebSocket, message: KellyStreamMessage) => {
  try {
    socket.send(JSON.stringify(message));
  } catch {
    socket.close();
  }
};

const createWebSocketUpgradeResponse = (client: CloudflareWebSocket): Response => {
  try {
    return new Response(null, {
      status: 101,
      ...( { webSocket: client } as ResponseInit ),
    });
  } catch {
    const response = new Response(null, {
      status: 200,
      headers: {
        "x-worker-websocket-upgrade": "101",
      },
    });
    Object.defineProperty(response, "webSocket", {
      configurable: true,
      value: client,
    });
    return response;
  }
};

const resolveKellyServerBaseUrl = (env: WorkerEnv): string | null => {
  const raw = env.KELLY_SERVER_BASE_URL?.trim();
  if (!raw) {
    return null;
  }

  try {
    const parsed = new URL(raw);
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    throw new AppError(500, "INVALID_KELLY_SERVER_BASE_URL", "Worker env 'KELLY_SERVER_BASE_URL' must be a valid absolute URL.");
  }
};

const resolveKellyStreamProxyMode = (env: WorkerEnv): KellyStreamProxyMode => {
  const raw = env.KELLY_STREAM_PROXY_MODE?.trim().toLowerCase();
  if (!raw) {
    return "canary";
  }

  if (raw === "local-only" || raw === "canary" || raw === "remote-first") {
    return raw;
  }

  throw new AppError(
    500,
    "INVALID_KELLY_STREAM_PROXY_MODE",
    "Worker env 'KELLY_STREAM_PROXY_MODE' must be local-only, canary, or remote-first.",
  );
};

const buildOriginProxyRequest = (request: Request, env: WorkerEnv): Request | null => {
  const baseUrl = resolveKellyServerBaseUrl(env);
  if (!baseUrl) {
    return null;
  }

  const incomingUrl = new URL(request.url);
  const upstreamUrl = `${baseUrl}${incomingUrl.pathname}${incomingUrl.search}`;
  const headers = new Headers(request.headers);
  headers.set("x-weather-kelly-proxy", "cloudflare-worker");
  if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
    headers.set("Connection", "Upgrade");
    headers.set("Upgrade", "websocket");
  }
  return new Request(upstreamUrl, {
    method: request.method,
    headers,
  });
};

const pruneKellyProxyFailures = (circuit: KellyProxyCircuitTracker, now = Date.now()) => {
  circuit.failureTimestamps = circuit.failureTimestamps.filter(
    (timestamp) => now - timestamp <= KELLY_PROXY_FAILURE_WINDOW_MS,
  );
};

const resolveKellyProxyCircuitState = (circuit: KellyProxyCircuitTracker): KellyCircuitState => {
  if (circuit.openUntil !== null) {
    return Date.now() < circuit.openUntil ? "open" : "half-open";
  }

  return circuit.halfOpenProbeInFlight ? "half-open" : "closed";
};

const recordKellyOriginSuccess = (circuit: KellyProxyCircuitTracker) => {
  circuit.failureTimestamps = [];
  circuit.consecutiveFailures = 0;
  circuit.openUntil = null;
  circuit.halfOpenProbeInFlight = false;
  circuit.lastOriginSuccessAt = new Date().toISOString();
  circuit.localFallbackActive = false;
};

const recordKellyOriginFailure = (circuit: KellyProxyCircuitTracker, reasonCode: string) => {
  const now = Date.now();
  pruneKellyProxyFailures(circuit, now);
  circuit.failureTimestamps.push(now);
  circuit.consecutiveFailures += 1;
  circuit.lastOriginFailureAt = new Date(now).toISOString();
  circuit.lastOriginFailureCode = reasonCode;
  circuit.localFallbackActive = true;
  circuit.halfOpenProbeInFlight = false;

  if (circuit.failureTimestamps.length >= KELLY_PROXY_FAILURE_THRESHOLD) {
    circuit.openUntil = now + KELLY_PROXY_OPEN_DURATION_MS;
  }
};

const shouldBypassKellyOrigin = (circuit: KellyProxyCircuitTracker) => {
  if (circuit.openUntil === null) {
    return false;
  }

  if (Date.now() < circuit.openUntil) {
    return true;
  }

  if (circuit.halfOpenProbeInFlight) {
    return true;
  }

  circuit.halfOpenProbeInFlight = true;
  return false;
};

const isKellyOriginJsonResponse = (response: Response) =>
  (response.headers.get("content-type") ?? "").toLowerCase().includes("application/json");

const readKellyOriginJsonError = async (response: Response): Promise<{ code?: string; message?: string } | null> => {
  try {
    const payload = (await response.clone().json()) as unknown;
    if (typeof payload !== "object" || payload === null) {
      return null;
    }

    const record = payload as Record<string, unknown>;
    return {
      code: typeof record.code === "string" ? record.code : undefined,
      message: typeof record.message === "string" ? record.message : undefined,
    };
  } catch {
    return null;
  }
};

const isKellyOriginLocationVersionSkew = async (request: Request, response: Response) => {
  if (response.status !== 400 || !isKellyOriginJsonResponse(response)) {
    return false;
  }

  const rawLocationId = new URL(request.url).searchParams.get("locationId")?.trim();
  if (!rawLocationId || !(rawLocationId in LOCATION_REGISTRY)) {
    return false;
  }

  const payload = await readKellyOriginJsonError(response);
  return (
    payload?.code === "BAD_REQUEST" &&
    typeof payload.message === "string" &&
    payload.message.includes("Query parameter 'locationId' is not supported")
  );
};

const extractKellyOriginMetarStationId = (payload: unknown) => {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const metarObservation = (payload as { weatherEvidence?: { metarObservation?: unknown } }).weatherEvidence?.metarObservation;
  if (typeof metarObservation !== "object" || metarObservation === null) {
    return null;
  }

  const stationId = (metarObservation as { stationId?: unknown }).stationId;
  return typeof stationId === "string" && stationId.trim() !== "" ? stationId.trim().toUpperCase() : null;
};

const isKellyOriginMetarContractSkew = async (request: Request, response: Response) => {
  if (!response.ok || !isKellyOriginJsonResponse(response)) {
    return false;
  }

  const rawLocationId = new URL(request.url).searchParams.get("locationId")?.trim();
  if (!rawLocationId || !(rawLocationId in LOCATION_REGISTRY)) {
    return false;
  }

  const locationId = rawLocationId as LocationInfo["id"];
  const contract = getLocationSourceContract(locationId);
  if (
    contract.currentSources.primaryObservation.key !== "aviationweather-metar" ||
    !contract.currentSources.primaryObservation.stationCode
  ) {
    return false;
  }

  const payload = await response.clone().json().catch(() => null);
  const stationId = extractKellyOriginMetarStationId(payload);
  if (!stationId) {
    return false;
  }

  return stationId !== contract.currentSources.primaryObservation.stationCode.trim().toUpperCase();
};

const extractDashboardOriginMetarStationId = (payload: unknown) => {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const metarObservation = (payload as { metar?: { observation?: unknown } }).metar?.observation;
  if (typeof metarObservation !== "object" || metarObservation === null) {
    return null;
  }

  const stationId = (metarObservation as { stationId?: unknown }).stationId;
  if (typeof stationId === "string" && stationId.trim() !== "") {
    return stationId.trim().toUpperCase();
  }

  return null;
};

const extractDashboardOriginTafStationId = (payload: unknown) => {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const tafForecast = (payload as { taf?: { forecast?: unknown } }).taf?.forecast;
  if (typeof tafForecast !== "object" || tafForecast === null) {
    return null;
  }

  const stationId = (tafForecast as { stationId?: unknown }).stationId;
  if (typeof stationId === "string" && stationId.trim() !== "") {
    return stationId.trim().toUpperCase();
  }

  return null;
};

const isDashboardOriginMetarContractSkew = async (request: Request, response: Response) => {
  if (!response.ok || !isKellyOriginJsonResponse(response)) {
    return false;
  }

  const rawLocationId = new URL(request.url).searchParams.get("locationId")?.trim();
  if (!rawLocationId || !(rawLocationId in LOCATION_REGISTRY)) {
    return false;
  }

  const locationId = rawLocationId as LocationInfo["id"];
  const contract = getLocationSourceContract(locationId);
  if (
    contract.currentSources.primaryObservation.key !== "aviationweather-metar" ||
    !contract.currentSources.primaryObservation.stationCode
  ) {
    return false;
  }

  const payload = await response.clone().json().catch(() => null);
  const stationId = extractDashboardOriginMetarStationId(payload);
  if (!stationId) {
    return false;
  }

  return stationId !== contract.currentSources.primaryObservation.stationCode.trim().toUpperCase();
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isNullableObjectRecord = (value: unknown): value is Record<string, unknown> | null =>
  value === null || isObjectRecord(value);

const hasOwnKey = (record: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(record, key);

const isDashboardOriginAviationContractSkew = async (request: Request, response: Response) => {
  if (!response.ok || !isKellyOriginJsonResponse(response)) {
    return false;
  }

  const rawLocationId = new URL(request.url).searchParams.get("locationId")?.trim();
  if (!rawLocationId || !(rawLocationId in LOCATION_REGISTRY)) {
    return false;
  }

  const locationId = rawLocationId as LocationInfo["id"];
  const payload = await response.clone().json().catch(() => null);
  if (!isObjectRecord(payload)) {
    return false;
  }

  const metarPayload = hasOwnKey(payload, "metar") ? payload.metar : undefined;
  const tafPayload = hasOwnKey(payload, "taf") ? payload.taf : undefined;
  if (metarPayload !== undefined && !isNullableObjectRecord(metarPayload)) {
    return true;
  }
  if (tafPayload !== undefined && !isNullableObjectRecord(tafPayload)) {
    return true;
  }

  const metar = isObjectRecord(metarPayload) ? metarPayload : null;
  if (metar) {
    if (hasOwnKey(metar, "observation") && !isNullableObjectRecord(metar.observation)) {
      return true;
    }
    if (hasOwnKey(metar, "recentTemperatures") && !Array.isArray(metar.recentTemperatures)) {
      return true;
    }
    if (hasOwnKey(metar, "recentReports") && !Array.isArray(metar.recentReports)) {
      return true;
    }
    if (hasOwnKey(metar, "recentObservations") && !Array.isArray(metar.recentObservations)) {
      return true;
    }
  }

  const taf = isObjectRecord(tafPayload) ? tafPayload : null;
  if (taf) {
    if (hasOwnKey(taf, "forecast") && !isNullableObjectRecord(taf.forecast)) {
      return true;
    }
    if (hasOwnKey(taf, "forecasts") && !Array.isArray(taf.forecasts)) {
      return true;
    }

    const tafForecast = isObjectRecord(taf.forecast) ? taf.forecast : null;
    if (tafForecast) {
      if (hasOwnKey(tafForecast, "activeForecast") && !isNullableObjectRecord(tafForecast.activeForecast)) {
        return true;
      }
      if (hasOwnKey(tafForecast, "dailySummary") && !isNullableObjectRecord(tafForecast.dailySummary)) {
        return true;
      }
      if (hasOwnKey(tafForecast, "rawTaf") && tafForecast.rawTaf !== null && typeof tafForecast.rawTaf !== "string") {
        return true;
      }
    }
  }

  const expectedTafStationId = getLocationSourceContract(locationId).targetUpgrades.taf.stationCode?.trim().toUpperCase();
  if (!expectedTafStationId) {
    return false;
  }

  const tafStationId = extractDashboardOriginTafStationId(payload);
  return Boolean(tafStationId && tafStationId !== expectedTafStationId);
};

type OriginProxyAttemptResult =
  | { kind: "unconfigured" }
  | { kind: "passthrough"; response: Response }
  | { kind: "fallback"; reasonCode: string; circuitState: KellyCircuitState };

const logOriginProxyResult = (
  request: Request,
  details: {
    requestKind: "dashboard" | "get" | "stream";
    originMode: "remote" | "local-fallback";
    reasonCode: string;
    circuitState: KellyCircuitState;
  },
) => {
  const url = new URL(request.url);
  const log = details.originMode === "remote" ? console.info : console.warn;
  log("[kelly-proxy]", {
    requestKind: details.requestKind,
    originMode: details.originMode,
    reasonCode: details.reasonCode,
    circuitState: details.circuitState,
    locationId: url.searchParams.get("locationId"),
    targetDate: url.searchParams.get("targetDate"),
  });
};

const fetchKellyOriginGet = async (
  request: Request,
  env: WorkerEnv,
  timeoutMs: number,
): Promise<OriginProxyAttemptResult> => {
  const proxyRequest = buildOriginProxyRequest(request, env);
  if (!proxyRequest) {
    return { kind: "unconfigured" };
  }

  if (shouldBypassKellyOrigin(kellyGetProxyCircuit)) {
    kellyGetProxyCircuit.localFallbackActive = true;
    const circuitState = resolveKellyProxyCircuitState(kellyGetProxyCircuit);
    logOriginProxyResult(request, {
      requestKind: "get",
      originMode: "local-fallback",
      reasonCode: "origin_circuit_open",
      circuitState,
    });
    return {
      kind: "fallback",
      reasonCode: "origin_circuit_open",
      circuitState,
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(
      new Request(proxyRequest, {
        signal: controller.signal,
      }),
    );

    if (await isKellyOriginMetarContractSkew(request, response)) {
      const reasonCode = "origin_metar_contract_skew";
      recordKellyOriginFailure(kellyGetProxyCircuit, reasonCode);
      logOriginProxyResult(request, {
        requestKind: "get",
        originMode: "local-fallback",
        reasonCode,
        circuitState: resolveKellyProxyCircuitState(kellyGetProxyCircuit),
      });
      return {
        kind: "fallback",
        reasonCode,
        circuitState: resolveKellyProxyCircuitState(kellyGetProxyCircuit),
      };
    }

    if (response.ok) {
      recordKellyOriginSuccess(kellyGetProxyCircuit);
      logOriginProxyResult(request, {
        requestKind: "get",
        originMode: "remote",
        reasonCode: "origin_ok",
        circuitState: resolveKellyProxyCircuitState(kellyGetProxyCircuit),
      });
      return {
        kind: "passthrough",
        response,
      };
    }

    if (await isKellyOriginLocationVersionSkew(request, response)) {
      const reasonCode = "origin_location_version_skew";
      recordKellyOriginFailure(kellyGetProxyCircuit, reasonCode);
      logOriginProxyResult(request, {
        requestKind: "get",
        originMode: "local-fallback",
        reasonCode,
        circuitState: resolveKellyProxyCircuitState(kellyGetProxyCircuit),
      });
      return {
        kind: "fallback",
        reasonCode,
        circuitState: resolveKellyProxyCircuitState(kellyGetProxyCircuit),
      };
    }

    if (response.status >= 400 && response.status < 500 && isKellyOriginJsonResponse(response)) {
      recordKellyOriginSuccess(kellyGetProxyCircuit);
      logOriginProxyResult(request, {
        requestKind: "get",
        originMode: "remote",
        reasonCode: `origin_status_${response.status}`,
        circuitState: resolveKellyProxyCircuitState(kellyGetProxyCircuit),
      });
      return {
        kind: "passthrough",
        response,
      };
    }

    const reasonCode = `origin_status_${response.status}`;
    recordKellyOriginFailure(kellyGetProxyCircuit, reasonCode);
    logOriginProxyResult(request, {
      requestKind: "get",
      originMode: "local-fallback",
      reasonCode,
      circuitState: resolveKellyProxyCircuitState(kellyGetProxyCircuit),
    });
    return {
      kind: "fallback",
      reasonCode,
      circuitState: resolveKellyProxyCircuitState(kellyGetProxyCircuit),
    };
  } catch (error) {
    const reasonCode = error instanceof Error && error.name === "AbortError" ? "origin_timeout" : "origin_fetch_failed";
    recordKellyOriginFailure(kellyGetProxyCircuit, reasonCode);
    logOriginProxyResult(request, {
      requestKind: "get",
      originMode: "local-fallback",
      reasonCode,
      circuitState: resolveKellyProxyCircuitState(kellyGetProxyCircuit),
    });
    return {
      kind: "fallback",
      reasonCode,
      circuitState: resolveKellyProxyCircuitState(kellyGetProxyCircuit),
    };
  } finally {
    clearTimeout(timeoutId);
  }
};

const fetchDashboardOriginGet = async (
  request: Request,
  env: WorkerEnv,
  timeoutMs: number,
): Promise<OriginProxyAttemptResult> => {
  const proxyRequest = buildOriginProxyRequest(request, env);
  if (!proxyRequest) {
    return { kind: "unconfigured" };
  }

  if (shouldBypassKellyOrigin(dashboardGetProxyCircuit)) {
    dashboardGetProxyCircuit.localFallbackActive = true;
    const circuitState = resolveKellyProxyCircuitState(dashboardGetProxyCircuit);
    logOriginProxyResult(request, {
      requestKind: "dashboard",
      originMode: "local-fallback",
      reasonCode: "origin_circuit_open",
      circuitState,
    });
    return {
      kind: "fallback",
      reasonCode: "origin_circuit_open",
      circuitState,
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(
      new Request(proxyRequest, {
        signal: controller.signal,
      }),
    );

    if (await isKellyOriginLocationVersionSkew(request, response)) {
      const reasonCode = "origin_location_version_skew";
      recordKellyOriginFailure(dashboardGetProxyCircuit, reasonCode);
      logOriginProxyResult(request, {
        requestKind: "dashboard",
        originMode: "local-fallback",
        reasonCode,
        circuitState: resolveKellyProxyCircuitState(dashboardGetProxyCircuit),
      });
      return {
        kind: "fallback",
        reasonCode,
        circuitState: resolveKellyProxyCircuitState(dashboardGetProxyCircuit),
      };
    }

    if (await isDashboardOriginMetarContractSkew(request, response)) {
      const reasonCode = "origin_metar_contract_skew";
      recordKellyOriginFailure(dashboardGetProxyCircuit, reasonCode);
      logOriginProxyResult(request, {
        requestKind: "dashboard",
        originMode: "local-fallback",
        reasonCode,
        circuitState: resolveKellyProxyCircuitState(dashboardGetProxyCircuit),
      });
      return {
        kind: "fallback",
        reasonCode,
        circuitState: resolveKellyProxyCircuitState(dashboardGetProxyCircuit),
      };
    }

    if (await isDashboardOriginAviationContractSkew(request, response)) {
      const reasonCode = "origin_aviation_contract_skew";
      recordKellyOriginFailure(dashboardGetProxyCircuit, reasonCode);
      logOriginProxyResult(request, {
        requestKind: "dashboard",
        originMode: "local-fallback",
        reasonCode,
        circuitState: resolveKellyProxyCircuitState(dashboardGetProxyCircuit),
      });
      return {
        kind: "fallback",
        reasonCode,
        circuitState: resolveKellyProxyCircuitState(dashboardGetProxyCircuit),
      };
    }

    if (response.ok) {
      recordKellyOriginSuccess(dashboardGetProxyCircuit);
      logOriginProxyResult(request, {
        requestKind: "dashboard",
        originMode: "remote",
        reasonCode: "origin_ok",
        circuitState: resolveKellyProxyCircuitState(dashboardGetProxyCircuit),
      });
      return {
        kind: "passthrough",
        response,
      };
    }

    if (response.status >= 400 && response.status < 500 && isKellyOriginJsonResponse(response)) {
      recordKellyOriginSuccess(dashboardGetProxyCircuit);
      logOriginProxyResult(request, {
        requestKind: "dashboard",
        originMode: "remote",
        reasonCode: `origin_status_${response.status}`,
        circuitState: resolveKellyProxyCircuitState(dashboardGetProxyCircuit),
      });
      return {
        kind: "passthrough",
        response,
      };
    }

    const reasonCode = `origin_status_${response.status}`;
    recordKellyOriginFailure(dashboardGetProxyCircuit, reasonCode);
    logOriginProxyResult(request, {
      requestKind: "dashboard",
      originMode: "local-fallback",
      reasonCode,
      circuitState: resolveKellyProxyCircuitState(dashboardGetProxyCircuit),
    });
    return {
      kind: "fallback",
      reasonCode,
      circuitState: resolveKellyProxyCircuitState(dashboardGetProxyCircuit),
    };
  } catch (error) {
    const reasonCode = error instanceof Error && error.name === "AbortError" ? "origin_timeout" : "origin_fetch_failed";
    recordKellyOriginFailure(dashboardGetProxyCircuit, reasonCode);
    logOriginProxyResult(request, {
      requestKind: "dashboard",
      originMode: "local-fallback",
      reasonCode,
      circuitState: resolveKellyProxyCircuitState(dashboardGetProxyCircuit),
    });
    return {
      kind: "fallback",
      reasonCode,
      circuitState: resolveKellyProxyCircuitState(dashboardGetProxyCircuit),
    };
  } finally {
    clearTimeout(timeoutId);
  }
};

const isKellyOriginWebSocketUpgrade = (response: Response): response is CloudflareResponseWithWebSocket =>
  response.status === 101 && Boolean((response as CloudflareResponseWithWebSocket).webSocket);

const shouldAttemptKellyOriginStream = (request: Request, env: WorkerEnv) => {
  const mode = resolveKellyStreamProxyMode(env);
  if (mode === "local-only") {
    return false;
  }

  if (mode === "remote-first") {
    return true;
  }

  return request.headers.get("x-kelly-origin-canary") === "1";
};

const fetchKellyOriginStream = async (
  request: Request,
  env: WorkerEnv,
): Promise<OriginProxyAttemptResult> => {
  const proxyRequest = buildOriginProxyRequest(request, env);
  if (!proxyRequest) {
    return { kind: "unconfigured" };
  }

  if (shouldBypassKellyOrigin(kellyStreamProxyCircuit)) {
    kellyStreamProxyCircuit.localFallbackActive = true;
    const circuitState = resolveKellyProxyCircuitState(kellyStreamProxyCircuit);
    logOriginProxyResult(request, {
      requestKind: "stream",
      originMode: "local-fallback",
      reasonCode: "origin_circuit_open",
      circuitState,
    });
    return {
      kind: "fallback",
      reasonCode: "origin_circuit_open",
      circuitState,
    };
  }

  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const fetchTask = fetch(
    new Request(proxyRequest, {
      signal: controller.signal,
    }),
  )
    .then((response) => ({ kind: "response" as const, response }))
    .catch((error) => ({ kind: "error" as const, error }));
  const timeoutTask = new Promise<{ kind: "timeout" }>((resolve) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      resolve({ kind: "timeout" });
    }, KELLY_PROXY_STREAM_TIMEOUT_MS);
  });

  try {
    const settled = await Promise.race([fetchTask, timeoutTask]);
    if (settled.kind === "timeout") {
      const reasonCode = "origin_timeout";
      recordKellyOriginFailure(kellyStreamProxyCircuit, reasonCode);
      logOriginProxyResult(request, {
        requestKind: "stream",
        originMode: "local-fallback",
        reasonCode,
        circuitState: resolveKellyProxyCircuitState(kellyStreamProxyCircuit),
      });
      return {
        kind: "fallback",
        reasonCode,
        circuitState: resolveKellyProxyCircuitState(kellyStreamProxyCircuit),
      };
    }

    if (settled.kind === "error") {
      const reasonCode =
        settled.error instanceof Error && settled.error.name === "AbortError" ? "origin_timeout" : "origin_fetch_failed";
      recordKellyOriginFailure(kellyStreamProxyCircuit, reasonCode);
      logOriginProxyResult(request, {
        requestKind: "stream",
        originMode: "local-fallback",
        reasonCode,
        circuitState: resolveKellyProxyCircuitState(kellyStreamProxyCircuit),
      });
      return {
        kind: "fallback",
        reasonCode,
        circuitState: resolveKellyProxyCircuitState(kellyStreamProxyCircuit),
      };
    }

    const response = settled.response;

    if (isKellyOriginWebSocketUpgrade(response)) {
      recordKellyOriginSuccess(kellyStreamProxyCircuit);
      logOriginProxyResult(request, {
        requestKind: "stream",
        originMode: "remote",
        reasonCode: "origin_ws_proxy",
        circuitState: resolveKellyProxyCircuitState(kellyStreamProxyCircuit),
      });
      return {
        kind: "passthrough",
        response,
      };
    }

    const reasonCode =
      response.status === 101 ? "origin_missing_websocket" : `origin_status_${response.status}`;
    recordKellyOriginFailure(kellyStreamProxyCircuit, reasonCode);
    logOriginProxyResult(request, {
      requestKind: "stream",
      originMode: "local-fallback",
      reasonCode,
      circuitState: resolveKellyProxyCircuitState(kellyStreamProxyCircuit),
    });
    return {
      kind: "fallback",
      reasonCode,
      circuitState: resolveKellyProxyCircuitState(kellyStreamProxyCircuit),
    };
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

const buildKellyProxyHealth = (env: WorkerEnv) => ({
  configured: Boolean(resolveKellyServerBaseUrl(env)),
  originBaseUrl: resolveKellyServerBaseUrl(env),
  circuitState: resolveKellyProxyCircuitState(kellyGetProxyCircuit),
  consecutiveFailures: kellyGetProxyCircuit.consecutiveFailures,
  openUntil:
    kellyGetProxyCircuit.openUntil === null ? null : new Date(kellyGetProxyCircuit.openUntil).toISOString(),
  lastOriginSuccessAt: kellyGetProxyCircuit.lastOriginSuccessAt,
  lastOriginFailureAt: kellyGetProxyCircuit.lastOriginFailureAt,
  lastOriginFailureCode: kellyGetProxyCircuit.lastOriginFailureCode,
  localFallbackActive: kellyGetProxyCircuit.localFallbackActive,
  streamMode: resolveKellyStreamProxyMode(env),
  streamLastOriginSuccessAt: kellyStreamProxyCircuit.lastOriginSuccessAt,
  streamLastOriginFailureAt: kellyStreamProxyCircuit.lastOriginFailureAt,
  streamLastOriginFailureCode: kellyStreamProxyCircuit.lastOriginFailureCode,
  streamLocalFallbackActive: kellyStreamProxyCircuit.localFallbackActive,
  dashboardCircuitState: resolveKellyProxyCircuitState(dashboardGetProxyCircuit),
  dashboardLastOriginSuccessAt: dashboardGetProxyCircuit.lastOriginSuccessAt,
  dashboardLastOriginFailureAt: dashboardGetProxyCircuit.lastOriginFailureAt,
  dashboardLastOriginFailureCode: dashboardGetProxyCircuit.lastOriginFailureCode,
  dashboardLocalFallbackActive: dashboardGetProxyCircuit.localFallbackActive,
});

const handleKellyStream = async (request: Request, env: WorkerEnv, ctx: WorkerContext) => {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Expected Upgrade: websocket", { status: 426 });
  }

  let originAttempt: OriginProxyAttemptResult | null = null;
  if (shouldAttemptKellyOriginStream(request, env)) {
    originAttempt = await fetchKellyOriginStream(request, env);
    if (originAttempt.kind === "passthrough") {
      return originAttempt.response;
    }
  }

  const url = new URL(request.url);
  const locationId = parseQueryLocationId(url.searchParams.get("locationId"));

  const pair = new ((globalThis as unknown as { WebSocketPair: WebSocketPairCtor }).WebSocketPair)();
  const client = pair[0];
  const server = pair[1];
  server.accept();

  const service = await getService(env);

  ctx.waitUntil(
    (async () => {
      if (!service.createKellyStream) {
        sendSocketMessage(server, {
          type: "status",
          generatedAt: new Date().toISOString(),
          state: "unavailable",
          reasonCode: "upstream_error",
          message: "Kelly real-time stream is not configured.",
        });
        server.close(1011, "kelly-stream-unavailable");
        return;
      }

      try {
        const stream = await service.createKellyStream(locationId, parseKellyOptions(url), (message) =>
          sendSocketMessage(
            server,
            originAttempt?.kind === "fallback"
              ? {
                  ...message,
                  originMode: "local-fallback",
                  circuitState: originAttempt.circuitState,
                }
              : message,
          ),
        );

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
          message: error instanceof Error ? error.message : "Kelly realtime stream initialization failed.",
        });
        server.close(1011, "kelly-stream-error");
      }
    })(),
  );

  return createWebSocketUpgradeResponse(client);
};

const handleApiRequest = async (request: Request, env: WorkerEnv, ctx: WorkerContext): Promise<Response> => {
  const url = new URL(request.url);
  const runtimeMetadata = ensureRuntimeMetadata();

  if (request.method === "GET" && url.pathname === "/healthz") {
    return jsonResponse({
      ok: true,
      service: "weather-worker",
      buildId: runtimeMetadata.buildId,
      startedAt: runtimeMetadata.startedAt,
      kellyProxy: buildKellyProxyHealth(env),
    });
  }

  if (request.method === "GET" && url.pathname === "/api/system/status") {
    return jsonResponse(
      buildSystemStatusResponse({
        service: "weather-worker",
        buildId: runtimeMetadata.buildId,
        startedAt: runtimeMetadata.startedAt,
        runtime: servicePromise ? (await getService(env)).getSystemStatus?.() ?? null : null,
        kellyProxy: buildKellyProxyHealth(env),
      }),
    );
  }

  if (request.method === "GET" && url.pathname === "/metrics") {
    const status = buildSystemStatusResponse({
      service: "weather-worker",
      buildId: runtimeMetadata.buildId,
      startedAt: runtimeMetadata.startedAt,
      runtime: servicePromise ? (await getService(env)).getSystemStatus?.() ?? null : null,
      kellyProxy: buildKellyProxyHealth(env),
    });
    return new Response(buildMetricsText(status), {
      status: 200,
      headers: {
        "content-type": "text/plain; version=0.0.4; charset=utf-8",
      },
    });
  }

  if (request.method === "GET" && url.pathname === "/api/weather/kelly") {
    const originAttempt = await fetchKellyOriginGet(request, env, KELLY_PROXY_GET_TIMEOUT_MS);
    if (originAttempt.kind === "passthrough") {
      return originAttempt.response;
    }

    const service = await getService(env);
    const locationId = parseQueryLocationId(url.searchParams.get("locationId"));
    if (!service.getKellyWorkbench) {
      throw new AppError(503, "KELLY_UNAVAILABLE", "Kelly workbench is not configured.", {
        retryable: false,
      });
    }
    return jsonResponse(await service.getKellyWorkbench(locationId, parseKellyOptions(url)));
  }

  if (request.method === "GET" && url.pathname === "/api/weather/dashboard") {
    const originAttempt = await fetchDashboardOriginGet(request, env, DASHBOARD_PROXY_GET_TIMEOUT_MS);
    if (originAttempt.kind === "passthrough") {
      return originAttempt.response;
    }
  }

  const service = await getService(env);
  const locationId = parseQueryLocationId(url.searchParams.get("locationId"));

  switch (`${request.method} ${url.pathname}`) {
    case "GET /api/weather/hourly":
      return await withEdgeJsonCache(
        request,
        ctx,
        EDGE_CACHE_TTL_SECONDS.hourly,
        async () =>
          await service.getHourly(
            locationId,
            parseMode(url.searchParams.get("mode")),
            parseLimit(url.searchParams.get("limit")),
          ),
        {
          shouldCache: hasFreshFreshness,
        },
      );

    case "GET /api/weather/report":
      return await withEdgeJsonCache(request, ctx, EDGE_CACHE_TTL_SECONDS.report, async () => await service.getWeatherReport(locationId), {
        shouldCache: hasFreshFreshness,
      });

    case "GET /api/weather/dashboard": {
      const mode = parseMode(url.searchParams.get("mode"));
      const limit = parseLimit(url.searchParams.get("limit"));
      return await withEdgeJsonCache(
        request,
        ctx,
        EDGE_CACHE_TTL_SECONDS.dashboard,
        async () => {
          const [hourlyResult, multimodel, reportResult, metar, taf] = await Promise.all([
            service.getHourly(locationId, mode, limit).then(
              (value) => ({ ok: true as const, value }),
              (error) => ({ ok: false as const, error }),
            ),
            service.getMultiModelStatus(locationId),
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

          return {
            generatedAt: new Date().toISOString(),
            displayUnit: LOCATION_REGISTRY[locationId].fallbackDisplayUnit,
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
        },
        {
          shouldCache: hasFreshDashboardSync,
        },
      );
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
      return await withEdgeJsonCache(
        request,
        ctx,
        EDGE_CACHE_TTL_SECONDS.multimodelStatus,
        async () => await service.getMultiModelStatus(locationId),
        {
          shouldCache: hasCacheableMultimodelStatus,
        },
      );

    case "GET /api/weather/multimodel/distribution":
      return await withEdgeJsonCache(
        request,
        ctx,
        EDGE_CACHE_TTL_SECONDS.multimodelDistribution,
        async () =>
          await service.getMultiModelDistribution(
            locationId,
            parseTimestamp(url.searchParams.get("timestamp")),
            parseBucketSize(url.searchParams.get("bucketSize")),
          ),
        {
          shouldCache: hasCacheableMultimodelFreshness,
        },
      );

    case "GET /api/weather/multimodel/insights":
      if (!service.getMultiModelInsight) {
        throw new AppError(503, "MULTIMODEL_INSIGHT_UNAVAILABLE", "Multimodel insights endpoint is not configured.", {
          retryable: false,
        });
      }
      return await withEdgeJsonCache(
        request,
        ctx,
        EDGE_CACHE_TTL_SECONDS.multimodelInsight,
        async () =>
          await service.getMultiModelInsight(
            locationId,
            parseTimestamp(url.searchParams.get("timestamp")),
            parseActualTemperatureC(url.searchParams.get("actualTemperatureC")),
          ),
        {
          shouldCache: hasCacheableMultimodelFreshness,
        },
      );

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

const isApiRequest = (pathname: string) =>
  pathname === "/healthz" || pathname === "/metrics" || pathname.startsWith("/api/");

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: WorkerContext): Promise<Response> {
    const url = new URL(request.url);
    ensureRuntimeMetadata();

    try {
      if (url.pathname === "/api/weather/kelly/stream") {
        return await handleKellyStream(request, env, ctx);
      }

      if (isApiRequest(url.pathname)) {
        return await handleApiRequest(request, env, ctx);
      }

      return await env.ASSETS.fetch(request);
    } catch (error) {
      return handleError(error);
    }
  },
};

