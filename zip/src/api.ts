import { CONFIG } from "./config";
import type {
  ApiErrorPayload,
  DashboardResponse,
  HourlyWeatherResponse,
  KellyWorkbenchResponse,
  MultiModelDistributionResponse,
  MultiModelInsightResponse,
  MultiModelStatusResponse,
  SystemStatusResponse,
  UserFavoritesResponse,
  WeatherReportResponse,
} from "./types";

export class WeatherApiError extends Error {
  readonly status: number;
  readonly payload: ApiErrorPayload | null;

  constructor(message: string, status: number, payload: ApiErrorPayload | null = null) {
    super(message);
    this.name = "WeatherApiError";
    this.status = status;
    this.payload = payload;
  }
}

const NETWORK_RETRY_DELAY_MS = 350;
const TRANSIENT_API_RETRY_STATUSES = new Set([502, 503, 504]);

const buildUrl = (
  basePath: string,
  path: string,
  searchParams?: Record<string, string | number | boolean | undefined>,
) => {
  const baseUrl = `${basePath}${path}`;
  const url = new URL(baseUrl, window.location.origin);

  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value === undefined) {
        continue;
      }

      url.searchParams.set(key, String(value));
    }
  }

  if (CONFIG.api.BASE_URL.startsWith("http")) {
    return url.toString();
  }

  return `${url.pathname}${url.search}`;
};

const isApiErrorPayload = (value: unknown): value is ApiErrorPayload =>
  typeof value === "object" &&
  value !== null &&
  "code" in value &&
  "message" in value &&
  "retryable" in value &&
  "staleAvailable" in value &&
  "lastSuccessAt" in value;

const isGetRequest = (init?: RequestInit) => (init?.method ?? "GET").toUpperCase() === "GET";

const isAbortError = (error: unknown) =>
  error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error
      ? error.name === "AbortError"
      : false;

const isGenericFetchFailure = (error: unknown) =>
  error instanceof Error &&
  /failed to fetch|networkerror|load failed|network request failed/i.test(error.message);

const shouldRetryTransientApiStatus = (
  status: number,
  payload: ApiErrorPayload | null,
  init?: RequestInit,
) => isGetRequest(init) && TRANSIENT_API_RETRY_STATUSES.has(status) && payload?.retryable !== false;

const requestJson = async <T>(
  basePath: string,
  path: string,
  searchParams?: Record<string, string | number | boolean | undefined>,
  init?: RequestInit,
): Promise<T> => {
  const requestUrl = buildUrl(basePath, path, searchParams);
  const requestInit: RequestInit = {
    ...init,
    headers: {
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  };
  const executeFetch = async () => await fetch(requestUrl, requestInit);
  let response: Response | null = null;
  let attempt = 0;

  while (attempt < 2) {
    try {
      response = await executeFetch();
    } catch (error) {
      if (!isGetRequest(init) || isAbortError(error) || !isGenericFetchFailure(error) || attempt > 0) {
        throw error;
      }

      attempt += 1;
      await new Promise((resolve) => globalThis.setTimeout(resolve, NETWORK_RETRY_DELAY_MS));
      continue;
    }

    if (response.ok) {
      break;
    }

    let payload: ApiErrorPayload | null = null;

    try {
      const json = (await response.clone().json()) as unknown;
      if (isApiErrorPayload(json)) {
        payload = json;
      }
    } catch {
      payload = null;
    }

    if (attempt === 0 && shouldRetryTransientApiStatus(response.status, payload, init)) {
      attempt += 1;
      await new Promise((resolve) => globalThis.setTimeout(resolve, NETWORK_RETRY_DELAY_MS));
      continue;
    }

    throw new WeatherApiError(payload?.message ?? `Request failed with status ${response.status}.`, response.status, payload);
  }

  if (!response || !response.ok) {
    throw new WeatherApiError("Request failed before a response was received.", 502, null);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new WeatherApiError(
      `Expected JSON from ${requestUrl} but received '${contentType || "unknown"}'. The request may have fallen back to the frontend shell.`,
      502,
      null,
    );
  }

  try {
    return (await response.json()) as T;
  } catch (error) {
    throw new WeatherApiError(
      `Could not parse JSON from ${requestUrl}: ${error instanceof Error ? error.message : String(error)}`,
      502,
      null,
    );
  }
};

export const weatherApi = {
  fetchDashboard: (mode: "1h" | "3h" = "1h", limit = 24, locationId?: string, init?: RequestInit) =>
    requestJson<DashboardResponse>(CONFIG.api.BASE_URL, CONFIG.api.DASHBOARD, { mode, limit, locationId }, init),

  fetchHourly: (mode: "1h" | "3h" = "1h", limit = 24, locationId?: string, init?: RequestInit) =>
    requestJson<HourlyWeatherResponse>(CONFIG.api.BASE_URL, CONFIG.api.HOURLY, { mode, limit, locationId }, init),

  fetchReport: (locationId?: string) => requestJson<WeatherReportResponse>(CONFIG.api.BASE_URL, CONFIG.api.REPORT, { locationId }),

  fetchSystemStatus: (init?: RequestInit) =>
    requestJson<SystemStatusResponse>(CONFIG.api.SYSTEM_BASE_URL, CONFIG.api.SYSTEM_STATUS, undefined, init),

  fetchMultiModelStatus: (locationId?: string) =>
    requestJson<MultiModelStatusResponse>(CONFIG.api.BASE_URL, CONFIG.api.MULTIMODEL_STATUS, { locationId }),

  fetchDistribution: (locationId?: string, timestamp?: string, bucketSize = 1, init?: RequestInit) =>
    requestJson<MultiModelDistributionResponse>(CONFIG.api.BASE_URL, CONFIG.api.MULTIMODEL_DISTRIBUTION, {
      locationId,
      timestamp,
      bucketSize,
    }, init),

  fetchInsights: (
    locationId?: string,
    timestamp?: string,
    actualTemperatureC?: number,
    init?: RequestInit,
  ) =>
    requestJson<MultiModelInsightResponse>(CONFIG.api.BASE_URL, CONFIG.api.MULTIMODEL_INSIGHTS, {
      locationId,
      timestamp,
      actualTemperatureC,
    }, init),

  fetchKellyWorkbench: (
    locationId?: string,
    targetDate?: string,
    bankroll?: number,
    riskMode?: "conservative" | "balanced" | "aggressive",
    minEdge?: number,
    actualTemperatureC?: number,
    selectedHour?: string,
    forceRefresh?: boolean,
    init?: RequestInit,
  ) =>
    requestJson<KellyWorkbenchResponse>(
      CONFIG.api.BASE_URL,
      CONFIG.api.KELLY,
      {
        locationId,
        targetDate,
        bankroll,
        riskMode,
        minEdge,
        actualTemperatureC,
        selectedHour,
        forceRefresh,
      },
      init,
    ),

  fetchFavorites: () =>
    requestJson<UserFavoritesResponse>(CONFIG.api.USER_BASE_URL, CONFIG.api.FAVORITES),

  setFavoriteLocation: (locationId: string, favorite: boolean) =>
    requestJson<UserFavoritesResponse>(
      CONFIG.api.USER_BASE_URL,
      `${CONFIG.api.FAVORITES}/${encodeURIComponent(locationId)}`,
      undefined,
      {
        method: "PUT",
        body: JSON.stringify({ favorite }),
      },
    ),

  buildMultiModelImageUrl: (locationId?: string, allowStale = true, cacheBust?: number) =>
    buildUrl(CONFIG.api.BASE_URL, CONFIG.api.MULTIMODEL_IMAGE, {
      locationId,
      allowStale,
      ts: cacheBust,
    }),

  buildKellyStreamUrl: (
    locationId?: string,
    targetDate?: string,
    bankroll?: number,
    riskMode?: "conservative" | "balanced" | "aggressive",
    minEdge?: number,
    actualTemperatureC?: number,
    selectedHour?: string,
  ) => {
    const url = new URL(
      buildUrl(CONFIG.api.BASE_URL, CONFIG.api.KELLY_STREAM, {
        locationId,
        targetDate,
        bankroll,
        riskMode,
        minEdge,
        actualTemperatureC,
        selectedHour,
      }),
      window.location.origin,
    );

    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.toString();
  },
};

export const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof WeatherApiError) {
    if (!error.payload && isGenericFetchFailure(error)) {
      return fallback;
    }
    return error.payload?.message ?? error.message;
  }

  if (isGenericFetchFailure(error)) {
    return fallback;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
};
