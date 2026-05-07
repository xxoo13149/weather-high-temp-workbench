import { lazy, startTransition, Suspense, useEffect, useMemo, useRef, useState } from "react";

import { WeatherApiError, getErrorMessage, isAbortLikeError, weatherApi } from "./api";
import { CommandHeader } from "./components/CommandHeader";
import { HomeReferenceCard } from "./components/HomeReferenceCard";
import { InsightCard } from "./components/InsightCard";
import { LocationRail } from "./components/LocationRail";
import { TerminalBackdrop } from "./components/terminal/TerminalBackdrop";
import { WarningLines } from "./components/WarningLines";
const LazyWeatherOverview = lazy(() => import("./components/WeatherOverview").then((mod) => ({ default: mod.WeatherOverview })));
const LazyAnalysisWorkspace = lazy(() =>
  import("./components/AnalysisWorkspace").then((mod) => ({ default: mod.AnalysisWorkspace })),
);
const LazyKellyWorkbench = lazy(() => import("./components/KellyWorkbench").then((mod) => ({ default: mod.KellyWorkbench })));
import { CONFIG } from "./config";
import { detectShellMobileLayout, observeShellMobileLayout } from "./layout";
import {
  UI_TEXT,
  buildPeakSummary,
  collectDisplayWarnings,
  collectHomeDisplayWarnings,
  toDecisionSummaryText,
} from "./display-text";
import {
  buildDockLocationGroups,
  buildDockLocations,
  buildHomeViewModel,
  mapDashboardResponse,
  mapDistributionResponse,
  mapInsightResponse,
  pickSelectedTimestamp,
  type AnalysisWorkspaceState,
  type DashboardViewModel,
  type DistributionViewModel,
  type InsightViewModel,
} from "./mappers";
import { mergeKellyStreamPatches } from "./kelly";
import type {
  DockTimezoneGroup,
  KellyRiskMode,
  KellyStreamMessage,
  KellyWorkbenchResponse,
} from "./types";
import { convertTemperatureToC, formatTemperatureInputValue } from "./utils";

type AppPath = "/" | "/analysis" | "/kelly";
type RefreshState = "idle" | "pending" | "success" | "error";
type TimezoneGroup = DockTimezoneGroup;
type AnalysisDataEnvelope<T> = {
  key: string;
  locationId: string;
  selectedTimestamp: string;
  generatedAt: string;
  data: T;
};
type AnalysisSnapshot = {
  key: string;
  locationId: string;
  insight: InsightViewModel;
  distribution: DistributionViewModel;
};
type WarmCacheEntry<T> = {
  cachedAt: number;
  data: T;
};
type InFlightEntry<T> = {
  startedAt: number;
  promise: Promise<T>;
};
type LocationTransitionState = {
  pendingLocationId: string | null;
  stage: "idle" | "dashboard";
};
type WarmLocationTargets = {
  home: boolean;
  analysis: boolean;
  kelly: boolean;
  image: boolean;
};

interface RouteState extends AnalysisWorkspaceState {
  path: AppPath;
  targetDate: string | null;
  bankroll: number;
  riskMode: KellyRiskMode;
  minEdge: number;
  kellyActualTemperatureC: number | null;
}

type KellyDraftControls = {
  bankrollInput: string;
  minEdgeInput: string;
  riskMode: KellyRiskMode;
  actualTemperatureText: string;
};

type KellyFieldErrors = {
  bankroll?: string | null;
  minEdge?: string | null;
  actualTemperature?: string | null;
};

type ParsedKellyDraftControls = {
  bankroll: number;
  minEdge: number;
  riskMode: KellyRiskMode;
  actualTemperatureC: number | null;
};

const KELLY_DEFAULT_BANKROLL = 1000;
const KELLY_DEFAULT_MIN_EDGE = 0.02;
const SILENT_REFRESH_STALE_MS = 10 * 60 * 1000;
const DASHBOARD_WARM_CACHE_TTL_MS = SILENT_REFRESH_STALE_MS;
const DASHBOARD_PREWARM_CONCURRENCY = 2;
const LOCATION_PREWARM_DELAY_MS = 180;
const KELLY_DATE_WARM_DELAY_MS = 220;
// Cross-date warm issues two extra Kelly snapshots right after bootstrap.
const ENABLE_KELLY_DATE_WARM = false;
const KELLY_STREAM_RECONNECT_BASE_MS = 1_500;
const KELLY_STREAM_RECONNECT_MAX_MS = 12_000;
const SHARED_IN_FLIGHT_STALE_MS = 15_000;
const ANALYSIS_SNAPSHOT_CLIENT_TIMEOUT_MS = 20_000;
const DASHBOARD_SNAPSHOT_CLIENT_TIMEOUT_MS = 20_000;
const KELLY_SNAPSHOT_CLIENT_TIMEOUT_MS = 20_000;
const KELLY_FOCUS_RECOVERY_STALE_MS = 20_000;
const KELLY_FOCUS_RECOVERY_COOLDOWN_MS = 1_500;
const MOBILE_RAIL_HISTORY_KEY = "__weatherMobileRail";
const MULTIMODEL_WARMUP_RETRY_DELAYS_MS = [900, 1_600, 2_600, 4_000, 6_000];
const MULTIMODEL_WARMUP_RETRY_CODES = new Set([
  "MULTIMODEL_DISTRIBUTION_REFRESH_IN_PROGRESS",
  "MULTIMODEL_DISTRIBUTION_UNAVAILABLE",
  "MULTIMODEL_HIGHCHARTS_TIMEOUT",
  "MULTIMODEL_INSIGHT_REFRESH_IN_PROGRESS",
  "MULTIMODEL_INSIGHT_UNAVAILABLE",
  "MULTIMODEL_PAGE_TIMEOUT",
  "MULTIMODEL_CACHE_LOAD_BUSY",
  "UPSTREAM_BAD_STATUS",
  "UPSTREAM_FETCH_FAILED",
]);

const hasMobileRailHistoryState = (state: unknown) =>
  Boolean(state && typeof state === "object" && (state as Record<string, unknown>)[MOBILE_RAIL_HISTORY_KEY] === true);

const withMobileRailHistoryState = (state: unknown) => ({
  ...(state && typeof state === "object" ? (state as Record<string, unknown>) : {}),
  [MOBILE_RAIL_HISTORY_KEY]: true,
});

const withoutMobileRailHistoryState = (state: unknown) => {
  if (!state || typeof state !== "object") {
    return null;
  }

  const nextState = { ...(state as Record<string, unknown>) };
  delete nextState[MOBILE_RAIL_HISTORY_KEY];
  return Object.keys(nextState).length > 0 ? nextState : null;
};

const parseNumber = (value: string | null) => {
  if (!value) {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatKellyMinEdgeInput = (minEdge: number) => (minEdge * 100).toFixed(1);

const buildKellyDraftFromRoute = (
  state: Pick<RouteState, "bankroll" | "minEdge" | "riskMode" | "kellyActualTemperatureC">,
): KellyDraftControls => ({
  bankrollInput: String(state.bankroll),
  minEdgeInput: formatKellyMinEdgeInput(state.minEdge),
  riskMode: state.riskMode,
  actualTemperatureText: state.kellyActualTemperatureC !== null ? String(state.kellyActualTemperatureC) : "",
});

const createAbortError = () => new DOMException("The operation was aborted.", "AbortError");

const awaitAbortable = <T,>(promise: Promise<T>, signal: AbortSignal) => {
  if (signal.aborted) {
    return Promise.reject(createAbortError());
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(createAbortError());
    };

    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
};

const withClientTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> => {
  let timerId: number | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timerId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timerId !== null) {
      window.clearTimeout(timerId);
    }
  }
};

const waitForAbortableDelay = (delayMs: number, signal: AbortSignal) => {
  if (signal.aborted) {
    return Promise.reject(createAbortError());
  }

  return new Promise<void>((resolve, reject) => {
    const timerId = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      window.clearTimeout(timerId);
      signal.removeEventListener("abort", onAbort);
      reject(createAbortError());
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
};

const resolveWeatherApiErrorCode = (error: unknown) =>
  error instanceof WeatherApiError ? error.payload?.diagnosticCode ?? error.payload?.code ?? null : null;

const isMultiModelWarmupRetryError = (error: unknown) => {
  if (!(error instanceof WeatherApiError)) {
    return false;
  }

  const code = resolveWeatherApiErrorCode(error);
  return Boolean(code && MULTIMODEL_WARMUP_RETRY_CODES.has(code) && error.payload?.retryable !== false);
};

const withMultiModelWarmupRetry = async <T,>(
  load: () => Promise<T>,
  signal: AbortSignal,
  enabled: boolean,
): Promise<T> => {
  let attempt = 0;

  while (true) {
    try {
      return await load();
    } catch (error) {
      if (
        !enabled ||
        isAbortLikeError(error) ||
        !isMultiModelWarmupRetryError(error) ||
        attempt >= MULTIMODEL_WARMUP_RETRY_DELAYS_MS.length
      ) {
        throw error;
      }

      await waitForAbortableDelay(MULTIMODEL_WARMUP_RETRY_DELAYS_MS[attempt] ?? 1_000, signal);
      attempt += 1;
    }
  }
};

const canReuseKellyWarmSnapshot = (snapshot: KellyWorkbenchResponse) =>
  snapshot.markets.length > 0 || snapshot.inactiveMarkets.length > 0 || snapshot.streamHealth.state !== "unavailable";

const readReusableInFlight = <T,>(cache: Map<string, InFlightEntry<T>>, key: string) => {
  const entry = cache.get(key);
  if (!entry) {
    return null;
  }

  if (Date.now() - entry.startedAt > SHARED_IN_FLIGHT_STALE_MS) {
    cache.delete(key);
    return null;
  }

  return entry;
};

const parseIsoTime = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseKellyDraftControls = (draft: KellyDraftControls): {
  parsed: ParsedKellyDraftControls | null;
  errors: KellyFieldErrors;
} => {
  const errors: KellyFieldErrors = {};

  const bankrollInput = draft.bankrollInput.trim();
  const bankroll = Number.parseFloat(bankrollInput);
  if (!bankrollInput) {
    errors.bankroll = "请输入本金。";
  } else if (!Number.isFinite(bankroll) || bankroll <= 0) {
    errors.bankroll = "本金必须大于 0。";
  }

  const minEdgeInput = draft.minEdgeInput.trim();
  const minEdgePercent = Number.parseFloat(minEdgeInput);
  if (!minEdgeInput) {
    errors.minEdge = "请输入最小优势。";
  } else if (!Number.isFinite(minEdgePercent) || minEdgePercent < 0 || minEdgePercent > 100) {
    errors.minEdge = "最小优势需在 0% 到 100% 之间。";
  }

  const actualTemperatureInput = draft.actualTemperatureText.trim();
  let actualTemperatureC: number | null = null;
  if (actualTemperatureInput) {
    actualTemperatureC = Number.parseFloat(actualTemperatureInput);
    if (!Number.isFinite(actualTemperatureC)) {
      errors.actualTemperature = "参考温度必须是有效数字，留空则沿用系统参考值。";
    }
  }

  if (errors.bankroll || errors.minEdge || errors.actualTemperature) {
    return {
      parsed: null,
      errors,
    };
  }

  return {
    parsed: {
      bankroll,
      minEdge: Math.min(1, Math.max(0, minEdgePercent / 100)),
      actualTemperatureC,
      riskMode: draft.riskMode,
    },
    errors: {},
  };
};

const parseRouteState = (): RouteState => {
  const url = new URL(window.location.href);
  const pathname = url.pathname === "/analysis" ? "/analysis" : url.pathname === "/kelly" ? "/kelly" : "/";
  const legacyActualTemperature = parseNumber(url.searchParams.get("actualTemperatureC"));
  const kellyActualTemperature = parseNumber(url.searchParams.get("kellyActualTemperatureC"));
  const selectedHourlyTimestamp = url.searchParams.get("selectedHour");

  return {
    path: pathname,
    tab: url.searchParams.get("tab") === "image" ? "image" : "models",
    locationId: url.searchParams.get("locationId") ?? CONFIG.location.DEFAULT_ID,
    selectedInsightTimestamp: url.searchParams.get("timestamp") ?? (pathname === "/kelly" ? null : selectedHourlyTimestamp),
    actualTemperatureC: pathname === "/kelly" ? null : legacyActualTemperature,
    selectedHourlyTimestamp,
    targetDate: url.searchParams.get("targetDate"),
    bankroll: parseNumber(url.searchParams.get("bankroll")) ?? KELLY_DEFAULT_BANKROLL,
    riskMode:
      url.searchParams.get("riskMode") === "conservative" ||
      url.searchParams.get("riskMode") === "aggressive" ||
      url.searchParams.get("riskMode") === "balanced"
        ? (url.searchParams.get("riskMode") as KellyRiskMode)
        : "balanced",
    minEdge: parseNumber(url.searchParams.get("minEdge")) ?? KELLY_DEFAULT_MIN_EDGE,
    kellyActualTemperatureC: kellyActualTemperature ?? (pathname === "/kelly" ? legacyActualTemperature : null),
  };
};

const buildRouteUrl = (state: RouteState) => {
  const url = new URL(window.location.href);
  url.pathname = state.path;
  url.search = "";

  if (state.path === "/analysis") {
    url.searchParams.set("tab", state.tab);
  }

  if (state.path === "/kelly" && state.targetDate) {
    url.searchParams.set("targetDate", state.targetDate);
  }

  if (state.locationId && state.locationId !== CONFIG.location.DEFAULT_ID) {
    url.searchParams.set("locationId", state.locationId);
  }

  if (state.selectedInsightTimestamp) {
    url.searchParams.set("timestamp", state.selectedInsightTimestamp);
  }

  if (state.path !== "/kelly" && state.actualTemperatureC !== null) {
    url.searchParams.set("actualTemperatureC", String(state.actualTemperatureC));
  }

  if (state.selectedHourlyTimestamp) {
    url.searchParams.set("selectedHour", state.selectedHourlyTimestamp);
  }

  if (state.path === "/kelly") {
    if (state.kellyActualTemperatureC !== null) {
      url.searchParams.set("kellyActualTemperatureC", String(state.kellyActualTemperatureC));
    }
    if (state.bankroll !== KELLY_DEFAULT_BANKROLL) {
      url.searchParams.set("bankroll", String(state.bankroll));
    }
    if (state.riskMode !== "balanced") {
      url.searchParams.set("riskMode", state.riskMode);
    }
    if (state.minEdge !== KELLY_DEFAULT_MIN_EDGE) {
      url.searchParams.set("minEdge", String(state.minEdge));
    }
  }

  return `${url.pathname}${url.search}`;
};

const commitRouteState = (state: RouteState, mode: "replace" | "push" = "replace") => {
  const nextUrl = buildRouteUrl(state);
  const currentUrl = `${window.location.pathname}${window.location.search}`;

  if (nextUrl === currentUrl) {
    return;
  }

  const updater = mode === "push" ? window.history.pushState : window.history.replaceState;
  updater.call(window.history, null, "", nextUrl);
};

const resolveDefaultReferenceTemperature = (
  dashboard: DashboardViewModel | null,
  weatherTimestamp: string | null,
) => {
  const items = dashboard?.hourly.items ?? [];

  if (weatherTimestamp) {
    const exact = items.find((item) => item.timestamp === weatherTimestamp && typeof item.temperatureC === "number");
    if (exact && typeof exact.temperatureC === "number") {
      return exact.temperatureC;
    }
  }

  const currentIndex = dashboard?.hourly.current?.index ?? -1;
  if (currentIndex >= 0 && typeof items[currentIndex]?.temperatureC === "number") {
    return items[currentIndex]?.temperatureC ?? null;
  }

  return items.find((item) => typeof item.temperatureC === "number")?.temperatureC ?? null;
};

const resolveDateKeyForTimezone = (value: Date, timeZone: string) => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error(`Could not resolve local date parts for time zone '${timeZone}'.`);
  }

  return `${year}-${month}-${day}`;
};

const resolveTodayForTimezone = (timeZone: string) => resolveDateKeyForTimezone(new Date(), timeZone);
const resolveKellyTargetDateForSelection = (timeZone: string, selectedTimestamp: string | null) =>
  (selectedTimestamp ? resolveDateKeyForTimezone(new Date(selectedTimestamp), timeZone) : null) ??
  resolveTodayForTimezone(timeZone);

const DEFAULT_ACTIVE_TIMEZONE_GROUP: TimezoneGroup = "asia";

const buildAnalysisBatchKey = (
  locationId: string | null | undefined,
  selectedTimestamp: string | null | undefined,
) => {
  if (!locationId || !selectedTimestamp) {
    return null;
  }

  return `${locationId}::${selectedTimestamp}`;
};

const WARM_CACHE_TTL_MS = 60_000;
const KELLY_WARM_CACHE_TTL_MS = 60_000;
const LOCATION_TEMPERATURE_TTL_MS = 15 * 60_000;

const normalizeNumberKeyPart = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "auto";

const pickAlignedAnalysisEnvelope = <T,>(
  envelope: AnalysisDataEnvelope<T> | null,
  locationId: string,
) => {
  if (!envelope) {
    return null;
  }

  return envelope.locationId === locationId ? envelope : null;
};

const buildInsightWarmKey = (
  locationId: string,
  selectedTimestamp: string | null,
  actualTemperatureC: number | null,
) => `${locationId}::${selectedTimestamp ?? "latest"}::${normalizeNumberKeyPart(actualTemperatureC)}`;

const buildDistributionWarmKey = (
  locationId: string,
  selectedTimestamp: string | null,
) => `${locationId}::${selectedTimestamp ?? "latest"}`;

const buildKellyWarmKey = ({
  locationId,
  targetDate,
  bankroll,
  riskMode,
  minEdge,
  actualTemperatureC,
  selectedHour,
}: {
  locationId: string;
  targetDate: string | null;
  bankroll: number;
  riskMode: KellyRiskMode;
  minEdge: number;
  actualTemperatureC: number | null;
  selectedHour: string | null;
}) =>
  [
    locationId,
    targetDate ?? "today",
    String(bankroll),
    riskMode,
    minEdge.toFixed(4),
    normalizeNumberKeyPart(actualTemperatureC),
    selectedHour ?? "latest",
  ].join("::");

const readWarmCacheEntry = <T,>(
  cache: Map<string, WarmCacheEntry<T>>,
  key: string,
  ttlMs = WARM_CACHE_TTL_MS,
): T | null => {
  const entry = cache.get(key);
  if (!entry) {
    return null;
  }

  if (Date.now() - entry.cachedAt > ttlMs) {
    cache.delete(key);
    return null;
  }

  return entry.data;
};

const writeWarmCacheEntry = <T,>(cache: Map<string, WarmCacheEntry<T>>, key: string, data: T) => {
  cache.set(key, {
    cachedAt: Date.now(),
    data,
  });

  return data;
};

const invalidateWarmCacheByLocation = <T,>(cache: Map<string, WarmCacheEntry<T>>, locationId: string) => {
  const prefix = `${locationId}::`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
};

const resolveTimezoneGroupForLocation = (
  locationDirectory: DashboardViewModel["locationDirectory"] | undefined,
  locationId: string,
): TimezoneGroup | null =>
  (locationDirectory?.find((location) => location.id === locationId)?.timezoneGroup as TimezoneGroup | undefined) ?? null;

const resolveDisplayUnitForLocation = (
  locationDirectory: DashboardViewModel["locationDirectory"] | undefined,
  locationId: string,
) => locationDirectory?.find((location) => location.id === locationId)?.displayUnit ?? null;

const buildWarmLocationTargets = (path: AppPath, tab: AnalysisWorkspaceState["tab"]): WarmLocationTargets => {
  if (path === "/kelly") {
    return {
      home: false,
      analysis: false,
      kelly: true,
      image: false,
    };
  }

  if (path === "/analysis") {
    return {
      home: false,
      analysis: tab === "models",
      kelly: false,
      image: tab === "image",
    };
  }

  return {
    home: true,
    analysis: false,
    kelly: false,
    image: false,
  };
};

const resolveKellyMotionStateFromStream = (
  state: string,
  reasonCode: KellyWorkbenchResponse["streamHealth"]["reasonCode"] | null | undefined,
): KellyWorkbenchResponse["freshness"]["marketMotionState"] => {
  if (reasonCode === "no_matched_markets" || reasonCode === "missing_tokens") {
    return "unavailable";
  }

  if (reasonCode === "polling_fallback" || reasonCode === "ws_error" || reasonCode === "upstream_error") {
    return "polling-fallback";
  }

  if (state === "connected") {
    return reasonCode === "no_recent_market_motion" ? "still" : "live";
  }

  return "still";
};

const resolveKellySourceState = (
  state: string,
  reasonCode: KellyWorkbenchResponse["streamHealth"]["reasonCode"] | null | undefined,
): KellyWorkbenchResponse["sourceStatus"][number]["state"] => {
  if (state === "connected") {
    return "fresh";
  }

  if (state === "degraded" || state === "disconnected") {
    return "degraded";
  }

  if (reasonCode === "no_matched_markets" || reasonCode === "missing_tokens") {
    return "unavailable";
  }

  return "unavailable";
};

const RouteSurfaceFallback = ({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) => (
  <section className="terminal-panel">
    <div className="panel-section">
      <div className="eyebrow">按需加载</div>
      <h2 className="mt-3 text-xl font-semibold text-white">{title}</h2>
      <p className="mt-3 text-sm text-white/64">{detail}</p>
    </div>
  </section>
);

const compactKellySnapshotForClient = (snapshot: KellyWorkbenchResponse): KellyWorkbenchResponse => ({
  ...snapshot,
  frameSeries: [],
  unresolvedMarkets: [],
});

export default function App() {
  const [routeState, setRouteState] = useState<RouteState>(() => parseRouteState());
  const [analysisTab, setAnalysisTab] = useState<RouteState["tab"]>(routeState.tab);
  const initialManualTemperatureText = routeState.actualTemperatureC !== null ? String(routeState.actualTemperatureC) : "";
  const [dashboard, setDashboard] = useState<DashboardViewModel | null>(null);
  const [insight, setInsight] = useState<InsightViewModel | null>(null);
  const [distribution, setDistribution] = useState<DistributionViewModel | null>(null);
  const [kellySnapshot, setKellySnapshot] = useState<KellyWorkbenchResponse | null>(null);
  const [loadingKelly, setLoadingKelly] = useState(false);
  const [kellyError, setKellyError] = useState<string | null>(null);
  const [kellyStreamState, setKellyStreamState] = useState<string>("idle");
  const [manualRefreshingKelly, setManualRefreshingKelly] = useState(false);
  const [kellyRefreshNonce, setKellyRefreshNonce] = useState(0);
  const [kellySocketReconnectNonce, setKellySocketReconnectNonce] = useState(0);
  const [kellyFieldErrors, setKellyFieldErrors] = useState<KellyFieldErrors>({});
  const [kellyAppliedControls, setKellyAppliedControls] = useState(() => ({
    bankroll: routeState.bankroll,
    riskMode: routeState.riskMode,
    minEdge: routeState.minEdge,
    kellyActualTemperatureC: routeState.kellyActualTemperatureC,
  }));
  const [kellyDraftControls, setKellyDraftControls] = useState(() => buildKellyDraftFromRoute(routeState));

  const [railExpanded, setRailExpanded] = useState(false);
  const [isMobileLayout, setIsMobileLayout] = useState(detectShellMobileLayout);
  const [browsingTimezoneGroup, setBrowsingTimezoneGroup] = useState<TimezoneGroup | null>(null);
  const [manualTemperatureText, setManualTemperatureText] = useState(initialManualTemperatureText);
  const [referenceTemperatureMode, setReferenceTemperatureMode] = useState<"default" | "manual">(
    () => (routeState.actualTemperatureC !== null ? "manual" : "default"),
  );
  const [cacheBust, setCacheBust] = useState(Date.now());
  const [favoriteLocationIds, setFavoriteLocationIds] = useState<string[]>([]);
  const [favoritePendingIds, setFavoritePendingIds] = useState<string[]>([]);
  const [locationTemperatures, setLocationTemperatures] = useState<Record<string, number | null>>({});
  const [locationTransitionState, setLocationTransitionState] = useState<LocationTransitionState>({
    pendingLocationId: null,
    stage: "idle",
  });
  const [refreshState, setRefreshState] = useState<RefreshState>("idle");
  const [manualAnalysisRefreshPending, setManualAnalysisRefreshPending] = useState(false);
  const [analysisReloadNonce, setAnalysisReloadNonce] = useState(0);
  const [lastConsistentAnalysisKey, setLastConsistentAnalysisKey] = useState<string | null>(null);
  const [analysisSnapshot, setAnalysisSnapshot] = useState<AnalysisSnapshot | null>(null);
  const [latestInsightEnvelope, setLatestInsightEnvelope] = useState<AnalysisDataEnvelope<InsightViewModel> | null>(null);
  const [latestDistributionEnvelope, setLatestDistributionEnvelope] = useState<AnalysisDataEnvelope<DistributionViewModel> | null>(null);

  const [loadingDashboard, setLoadingDashboard] = useState(true);
  const [loadingInsight, setLoadingInsight] = useState(false);
  const [loadingDistribution, setLoadingDistribution] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [insightError, setInsightError] = useState<string | null>(null);
  const [distributionError, setDistributionError] = useState<string | null>(null);
  const [favoritesError, setFavoritesError] = useState<string | null>(null);
  const refreshResetTimerRef = useRef<number | null>(null);
  const refreshInFlightRef = useRef(false);
  const refreshInFlightLocationRef = useRef<string | null>(null);
  const refreshInFlightManualRef = useRef(false);
  const lastDashboardRefreshAtRef = useRef(0);
  const dashboardRequestStartedAtRef = useRef(0);
  const locationTransitionInFlightRef = useRef(false);
  const locationTransitionSeqRef = useRef(0);
  const dashboardRequestSeqRef = useRef(0);
  const railScrollLockYRef = useRef(0);
  const previousMobileLayoutRef = useRef(isMobileLayout);
  const transitionDashboardAbortRef = useRef<AbortController | null>(null);
  const refreshDashboardAbortRef = useRef<AbortController | null>(null);
  const insightAbortRef = useRef<AbortController | null>(null);
  const distributionAbortRef = useRef<AbortController | null>(null);
  const analysisRequestEpochRef = useRef(0);
  const kellyAbortRef = useRef<AbortController | null>(null);
  const warmAbortRef = useRef<AbortController | null>(null);
  const kellyDateWarmAbortRef = useRef<AbortController | null>(null);
  const kellyRequestSeqRef = useRef(0);
  const kellyRequestStartedAtRef = useRef(0);
  const kellyFocusRecoveryAtRef = useRef(0);
  const kellySocketRef = useRef<WebSocket | null>(null);
  const kellySocketSuppressedRef = useRef<WebSocket | null>(null);
  const kellySocketReconnectTimerRef = useRef<number | null>(null);
  const kellySocketRetryCountRef = useRef(0);
  const dashboardWarmCacheRef = useRef<Map<string, WarmCacheEntry<DashboardViewModel>>>(
    new Map<string, WarmCacheEntry<DashboardViewModel>>(),
  );
  const dashboardWarmInFlightRef = useRef<Map<string, InFlightEntry<DashboardViewModel>>>(
    new Map<string, InFlightEntry<DashboardViewModel>>(),
  );
  const mobileRailTriggerRef = useRef<HTMLButtonElement | null>(null);
  const mobileRailFocusRestoreRef = useRef(false);
  const insightWarmCacheRef = useRef<Map<string, WarmCacheEntry<InsightViewModel>>>(
    new Map<string, WarmCacheEntry<InsightViewModel>>(),
  );
  const distributionWarmCacheRef = useRef<Map<string, WarmCacheEntry<DistributionViewModel>>>(
    new Map<string, WarmCacheEntry<DistributionViewModel>>(),
  );
  const insightInFlightRef = useRef<Map<string, InFlightEntry<InsightViewModel>>>(
    new Map<string, InFlightEntry<InsightViewModel>>(),
  );
  const distributionInFlightRef = useRef<Map<string, InFlightEntry<DistributionViewModel | null>>>(
    new Map<string, InFlightEntry<DistributionViewModel | null>>(),
  );
  const kellyWarmCacheRef = useRef<Map<string, WarmCacheEntry<KellyWorkbenchResponse>>>(
    new Map<string, WarmCacheEntry<KellyWorkbenchResponse>>(),
  );
  const kellyInFlightRef = useRef<Map<string, InFlightEntry<KellyWorkbenchResponse>>>(
    new Map<string, InFlightEntry<KellyWorkbenchResponse>>(),
  );
  const locationTemperatureWarmCacheRef = useRef<Map<string, WarmCacheEntry<number | null>>>(
    new Map<string, WarmCacheEntry<number | null>>(),
  );
  const analysisRuntimeRef = useRef({
    routeLocationId: routeState.locationId,
    routePath: routeState.path,
    routeTab: routeState.tab,
    selectedInsightTimestamp: routeState.selectedInsightTimestamp ?? null,
    actualTemperatureC: routeState.actualTemperatureC ?? null,
    loadingInsight,
    loadingDistribution,
    insightError,
    distributionError,
    latestInsightEnvelope: null as AnalysisDataEnvelope<InsightViewModel> | null,
    latestDistributionEnvelope: null as AnalysisDataEnvelope<DistributionViewModel> | null,
  });
  const routeStateRef = useRef(routeState);
  routeStateRef.current = routeState;
  const dashboardRef = useRef<DashboardViewModel | null>(dashboard);
  dashboardRef.current = dashboard;
  const railExpandedRef = useRef(railExpanded);
  railExpandedRef.current = railExpanded;
  const mobileLayoutRef = useRef(isMobileLayout);
  mobileLayoutRef.current = isMobileLayout;
  const desktopRailExpanded = railExpanded && !isMobileLayout;
  analysisRuntimeRef.current = {
    routeLocationId: routeState.locationId,
    routePath: routeState.path,
    routeTab: routeState.tab,
    selectedInsightTimestamp: routeState.selectedInsightTimestamp ?? null,
    actualTemperatureC: routeState.actualTemperatureC ?? null,
    loadingInsight,
    loadingDistribution,
    insightError,
    distributionError,
    latestInsightEnvelope,
    latestDistributionEnvelope,
  };
  useEffect(() => {
    setAnalysisTab(routeState.tab);
  }, [routeState.tab]);

  const displayedLocationId = routeState.locationId;
  const currentLocationTimezoneGroup =
    resolveTimezoneGroupForLocation(dashboard?.locationDirectory, displayedLocationId) ??
    resolveTimezoneGroupForLocation(
      dashboardWarmCacheRef.current.get(displayedLocationId)?.data.locationDirectory,
      displayedLocationId,
    );
  const activeDisplayUnit =
    (kellySnapshot?.location.id === displayedLocationId ? kellySnapshot.displayUnit : null) ??
    resolveDisplayUnitForLocation(dashboard?.locationDirectory, displayedLocationId) ??
    resolveDisplayUnitForLocation(
      dashboardWarmCacheRef.current.get(displayedLocationId)?.data.locationDirectory,
      displayedLocationId,
    ) ??
    dashboard?.displayUnit ??
    "C";
  const activeTimezoneGroup = browsingTimezoneGroup ?? currentLocationTimezoneGroup ?? DEFAULT_ACTIVE_TIMEZONE_GROUP;

  const clearKellySocketReconnectTimer = () => {
    if (kellySocketReconnectTimerRef.current !== null) {
      window.clearTimeout(kellySocketReconnectTimerRef.current);
      kellySocketReconnectTimerRef.current = null;
    }
  };

  const cancelOrdinaryWeatherRequests = () => {
    transitionDashboardAbortRef.current?.abort();
    transitionDashboardAbortRef.current = null;
    refreshDashboardAbortRef.current?.abort();
    refreshDashboardAbortRef.current = null;
    insightAbortRef.current?.abort();
    insightAbortRef.current = null;
    distributionAbortRef.current?.abort();
    distributionAbortRef.current = null;
    warmAbortRef.current?.abort();
    warmAbortRef.current = null;
    refreshInFlightRef.current = false;
    refreshInFlightLocationRef.current = null;
    refreshInFlightManualRef.current = false;
    dashboardRequestStartedAtRef.current = 0;
    locationTransitionInFlightRef.current = false;
  };

  const resetOrdinaryWeatherLoadingStates = () => {
    setLoadingDashboard(false);
    setLoadingInsight(false);
    setLoadingDistribution(false);
  };

  const resetKellySocketRuntime = () => {
    clearKellySocketReconnectTimer();
    kellySocketRetryCountRef.current = 0;
    kellySocketSuppressedRef.current = null;
  };

  const detachKellySocketHandlers = (socket: WebSocket | null) => {
    if (!socket) {
      return;
    }

    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
  };

  const closeKellySocket = () => {
    clearKellySocketReconnectTimer();
    const socket = kellySocketRef.current;
    if (!socket) {
      return;
    }

    kellySocketSuppressedRef.current = socket;
    kellySocketRef.current = null;
    detachKellySocketHandlers(socket);
    try {
      socket.close();
    } catch {
      if (kellySocketSuppressedRef.current === socket) {
        kellySocketSuppressedRef.current = null;
      }
    }
    if (kellySocketSuppressedRef.current === socket) {
      kellySocketSuppressedRef.current = null;
    }
  };

  const stripMobileRailHistoryState = () => {
    if (!hasMobileRailHistoryState(window.history.state)) {
      return;
    }

    window.history.replaceState(withoutMobileRailHistoryState(window.history.state), "", window.location.href);
  };

  const collapseRail = (mode: "dismiss" | "programmatic" = "programmatic") => {
    if (!mobileLayoutRef.current) {
      mobileRailFocusRestoreRef.current = false;
      setRailExpanded(false);
      return;
    }

    mobileRailFocusRestoreRef.current = mode === "dismiss" && railExpandedRef.current;
    const hasHistoryEntry = hasMobileRailHistoryState(window.history.state);
    if (mode === "dismiss" && railExpandedRef.current && hasHistoryEntry) {
      window.history.back();
      return;
    }

    if (hasHistoryEntry) {
      stripMobileRailHistoryState();
    }

    setRailExpanded(false);
  };

  const expandRail = () => {
    if (railExpandedRef.current) {
      return;
    }

    mobileRailFocusRestoreRef.current = false;
    if (mobileLayoutRef.current && !hasMobileRailHistoryState(window.history.state)) {
      window.history.pushState(withMobileRailHistoryState(window.history.state), "", window.location.href);
    }

    setRailExpanded(true);
  };

  const toggleRailVisibility = () => {
    if (railExpandedRef.current) {
      collapseRail("dismiss");
      return;
    }

    expandRail();
  };

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const next = parseRouteState();
      const nextGroup =
        resolveTimezoneGroupForLocation(dashboard?.locationDirectory, next.locationId) ??
        resolveTimezoneGroupForLocation(
          dashboardWarmCacheRef.current.get(next.locationId)?.data.locationDirectory,
          next.locationId,
        );
      setBrowsingTimezoneGroup((current) => nextGroup ?? current);
      setRouteState(next);
      setKellyAppliedControls({
        bankroll: next.bankroll,
        riskMode: next.riskMode,
        minEdge: next.minEdge,
        kellyActualTemperatureC: next.kellyActualTemperatureC,
      });
      setKellyDraftControls(buildKellyDraftFromRoute(next));
      setKellyFieldErrors({});
      setReferenceTemperatureMode(next.actualTemperatureC !== null ? "manual" : "default");
      const nextDisplayUnit =
        resolveDisplayUnitForLocation(dashboard?.locationDirectory, next.locationId) ??
        resolveDisplayUnitForLocation(
          dashboardWarmCacheRef.current.get(next.locationId)?.data.locationDirectory,
          next.locationId,
        ) ??
        "C";
      setManualTemperatureText(formatTemperatureInputValue(next.actualTemperatureC, nextDisplayUnit));

      if (!mobileLayoutRef.current) {
        return;
      }

      if (hasMobileRailHistoryState(event.state)) {
        mobileRailFocusRestoreRef.current = false;
        setRailExpanded(true);
        return;
      }

      if (railExpandedRef.current) {
        mobileRailFocusRestoreRef.current = true;
        setRailExpanded(false);
      }
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (railExpanded) {
      return;
    }

    setBrowsingTimezoneGroup(null);
  }, [railExpanded]);

  useEffect(() => {
    if (!desktopRailExpanded) {
      return;
    }

    const lockedScrollY = window.scrollY;
    railScrollLockYRef.current = lockedScrollY;
    const { body } = document;
    const previousOverflow = body.style.overflow;
    const previousPosition = body.style.position;
    const previousTop = body.style.top;
    const previousWidth = body.style.width;
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${lockedScrollY}px`;
    body.style.width = "100%";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setRailExpanded(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      body.style.overflow = previousOverflow;
      body.style.position = previousPosition;
      body.style.top = previousTop;
      body.style.width = previousWidth;
      const restoreScrollTop = railScrollLockYRef.current;
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          window.scrollTo({ top: restoreScrollTop, behavior: "auto" });
        });
      });
    };
  }, [desktopRailExpanded]);

  useEffect(() => {
    if (previousMobileLayoutRef.current === isMobileLayout) {
      return;
    }

    previousMobileLayoutRef.current = isMobileLayout;
    collapseRail("programmatic");
    setBrowsingTimezoneGroup(null);
  }, [isMobileLayout]);

  useEffect(() => {
    return observeShellMobileLayout(setIsMobileLayout);
  }, []);

  const updateRouteState = (updater: (current: RouteState) => RouteState, mode: "replace" | "push" = "replace") => {
    setRouteState((current) => {
      const next = updater(current);
      commitRouteState(next, mode);
      return next;
    });
  };

  useEffect(() => {
    setKellyAppliedControls({
      bankroll: routeState.bankroll,
      riskMode: routeState.riskMode,
      minEdge: routeState.minEdge,
      kellyActualTemperatureC: routeState.kellyActualTemperatureC,
    });
    setKellyDraftControls(buildKellyDraftFromRoute(routeState));
    setKellyFieldErrors({});
  }, [routeState.bankroll, routeState.kellyActualTemperatureC, routeState.minEdge, routeState.riskMode]);

  const cacheDashboardSnapshot = (locationId: string, nextDashboard: DashboardViewModel) => {
    lastDashboardRefreshAtRef.current = Date.now();
    writeWarmCacheEntry(dashboardWarmCacheRef.current, locationId, nextDashboard);
    setDashboard(nextDashboard);
    setLocationTemperatures((current) => ({
      ...current,
      [locationId]:
        nextDashboard.hourly.current?.temperatureC ??
        nextDashboard.hourly.items[0]?.temperatureC ??
        null,
    }));
  };

  const fetchDashboardSnapshot = async (locationId: string, signal: AbortSignal) => {
    const response = await withClientTimeout(
      weatherApi.fetchDashboard("1h", 24, locationId, { signal }),
      DASHBOARD_SNAPSHOT_CLIENT_TIMEOUT_MS,
      `Dashboard refresh timed out after ${Math.round(DASHBOARD_SNAPSHOT_CLIENT_TIMEOUT_MS / 1_000)}s.`,
    );
    return mapDashboardResponse(response);
  };

  const fetchInsightSnapshot = async ({
    locationId,
    selectedTimestamp,
    actualTemperatureC,
    signal,
    bypassCache = false,
    allowInFlightReuse = true,
    retryWarmup = true,
  }: {
    locationId: string;
    selectedTimestamp: string | null;
    actualTemperatureC: number | null;
    signal: AbortSignal;
    bypassCache?: boolean;
    allowInFlightReuse?: boolean;
    retryWarmup?: boolean;
  }): Promise<InsightViewModel> => {
    const insightKey = buildInsightWarmKey(locationId, selectedTimestamp, actualTemperatureC);
    const useSharedInFlight = !bypassCache && allowInFlightReuse;
    if (!bypassCache) {
      const cachedInsight = readWarmCacheEntry<InsightViewModel>(insightWarmCacheRef.current, insightKey);
      if (cachedInsight) {
        return cachedInsight;
      }

      if (useSharedInFlight) {
        const inFlight = readReusableInFlight<InsightViewModel>(insightInFlightRef.current, insightKey);
        if (inFlight) {
          return await awaitAbortable(inFlight.promise, signal);
        }
      }
    }

    const request = withClientTimeout(
      withMultiModelWarmupRetry(
        () =>
          weatherApi.fetchInsights(locationId, selectedTimestamp ?? undefined, actualTemperatureC ?? undefined, {
            signal,
          }),
        signal,
        retryWarmup,
      ),
      ANALYSIS_SNAPSHOT_CLIENT_TIMEOUT_MS,
      `Insight refresh timed out after ${Math.round(ANALYSIS_SNAPSHOT_CLIENT_TIMEOUT_MS / 1_000)}s.`,
    )
      .then((response) => writeWarmCacheEntry(insightWarmCacheRef.current, insightKey, mapInsightResponse(response)));
    const entry = {
      startedAt: Date.now(),
      promise: request,
    };

    if (useSharedInFlight) {
      insightInFlightRef.current.set(insightKey, entry);
    }

    try {
      return await awaitAbortable(request, signal);
    } finally {
      if (useSharedInFlight && insightInFlightRef.current.get(insightKey) === entry) {
        insightInFlightRef.current.delete(insightKey);
      }
    }
  };

  const fetchDistributionSnapshot = async ({
    locationId,
    selectedTimestamp,
    signal,
    bypassCache = false,
    allowInFlightReuse = true,
    retryWarmup = true,
  }: {
    locationId: string;
    selectedTimestamp: string | null;
    signal: AbortSignal;
    bypassCache?: boolean;
    allowInFlightReuse?: boolean;
    retryWarmup?: boolean;
  }): Promise<DistributionViewModel | null> => {
    if (!selectedTimestamp) {
      return null;
    }

    const distributionKey = buildDistributionWarmKey(locationId, selectedTimestamp);
    const useSharedInFlight = !bypassCache && allowInFlightReuse;
    if (!bypassCache) {
      const cachedDistribution = readWarmCacheEntry<DistributionViewModel>(
        distributionWarmCacheRef.current,
        distributionKey,
      );
      if (cachedDistribution) {
        return cachedDistribution;
      }

      if (useSharedInFlight) {
        const inFlight = readReusableInFlight<DistributionViewModel | null>(
          distributionInFlightRef.current,
          distributionKey,
        );
        if (inFlight) {
          return await awaitAbortable(inFlight.promise, signal);
        }
      }
    }

    const request = withClientTimeout(
      withMultiModelWarmupRetry(
        () => weatherApi.fetchDistribution(locationId, selectedTimestamp, 1, { signal }),
        signal,
        retryWarmup,
      ),
      ANALYSIS_SNAPSHOT_CLIENT_TIMEOUT_MS,
      `Distribution refresh timed out after ${Math.round(ANALYSIS_SNAPSHOT_CLIENT_TIMEOUT_MS / 1_000)}s.`,
    )
      .then((response) =>
        writeWarmCacheEntry(distributionWarmCacheRef.current, distributionKey, mapDistributionResponse(response)),
      );
    const entry = {
      startedAt: Date.now(),
      promise: request,
    };

    if (useSharedInFlight) {
      distributionInFlightRef.current.set(distributionKey, entry);
    }

    try {
      return await awaitAbortable(request, signal);
    } finally {
      if (useSharedInFlight && distributionInFlightRef.current.get(distributionKey) === entry) {
        distributionInFlightRef.current.delete(distributionKey);
      }
    }
  };

  const fetchKellySnapshot = async ({
    locationId,
    targetDate,
    bankroll,
    riskMode,
    minEdge,
    actualTemperatureC,
    selectedHour,
    signal,
    bypassCache = false,
    allowInFlightReuse = true,
  }: {
    locationId: string;
    targetDate: string;
    bankroll: number;
    riskMode: KellyRiskMode;
    minEdge: number;
    actualTemperatureC: number | null;
    selectedHour: string | null;
    signal: AbortSignal;
    bypassCache?: boolean;
    allowInFlightReuse?: boolean;
  }): Promise<KellyWorkbenchResponse> => {
    const kellyKey = buildKellyWarmKey({
      locationId,
      targetDate,
      bankroll,
      riskMode,
      minEdge,
      actualTemperatureC,
      selectedHour,
    });
    const useSharedInFlight = !bypassCache && allowInFlightReuse;
    if (!bypassCache) {
      const cachedKelly = readWarmCacheEntry<KellyWorkbenchResponse>(
        kellyWarmCacheRef.current,
        kellyKey,
        KELLY_WARM_CACHE_TTL_MS,
      );
      if (cachedKelly) {
        return cachedKelly;
      }

      if (useSharedInFlight) {
        const inFlight = readReusableInFlight<KellyWorkbenchResponse>(kellyInFlightRef.current, kellyKey);
        if (inFlight) {
          return await awaitAbortable(inFlight.promise, signal);
        }
      }
    }

    const request = withClientTimeout(
      weatherApi.fetchKellyWorkbench(
        locationId,
        targetDate,
        bankroll,
        riskMode,
        minEdge,
        actualTemperatureC ?? undefined,
        selectedHour ?? undefined,
        bypassCache,
        { signal },
      ),
      KELLY_SNAPSHOT_CLIENT_TIMEOUT_MS,
      `Kelly refresh timed out after ${Math.round(KELLY_SNAPSHOT_CLIENT_TIMEOUT_MS / 1_000)}s.`,
    )
      .then((response) => {
        const compacted = compactKellySnapshotForClient(response);
        return writeWarmCacheEntry(kellyWarmCacheRef.current, kellyKey, compacted);
      });
    const entry = {
      startedAt: Date.now(),
      promise: request,
    };

    if (useSharedInFlight) {
      kellyInFlightRef.current.set(kellyKey, entry);
    }

    try {
      return await awaitAbortable(request, signal);
    } finally {
      if (useSharedInFlight && kellyInFlightRef.current.get(kellyKey) === entry) {
        kellyInFlightRef.current.delete(kellyKey);
      }
    }
  };

  const invalidateKellyWarmCache = ({
    locationId,
    targetDate,
    bankroll,
    riskMode,
    minEdge,
    actualTemperatureC,
    selectedHour,
  }: {
    locationId: string;
    targetDate: string;
    bankroll: number;
    riskMode: KellyRiskMode;
    minEdge: number;
    actualTemperatureC: number | null;
    selectedHour: string | null;
  }) => {
    const kellyKey = buildKellyWarmKey({
      locationId,
      targetDate,
      bankroll,
      riskMode,
      minEdge,
      actualTemperatureC,
      selectedHour,
    });
    kellyWarmCacheRef.current.delete(kellyKey);
  };

  const clearAnalysisSurfaceState = () => {
    analysisRequestEpochRef.current += 1;
  };

  const invalidateAnalysisWarmCaches = (locationId: string) => {
    invalidateWarmCacheByLocation(insightWarmCacheRef.current, locationId);
    invalidateWarmCacheByLocation(distributionWarmCacheRef.current, locationId);
  };

  const seedAnalysisSnapshot = ({
    locationId,
    generatedAt,
    nextInsight,
    nextDistribution,
  }: {
    locationId: string;
    generatedAt: string;
    nextInsight: InsightViewModel | null;
    nextDistribution: DistributionViewModel | null;
  }) => {
    setInsight(nextInsight);
    setDistribution(nextDistribution);

    const insightKey = nextInsight ? buildAnalysisBatchKey(locationId, nextInsight.selectedTimestamp) : null;
    const distributionKey = nextDistribution
      ? buildAnalysisBatchKey(locationId, nextDistribution.selectedTimestamp)
      : null;

    setLatestInsightEnvelope(
      nextInsight && insightKey
        ? {
            key: insightKey,
            locationId,
            selectedTimestamp: nextInsight.selectedTimestamp,
            generatedAt,
            data: nextInsight,
          }
        : null,
    );
    setLatestDistributionEnvelope(
      nextDistribution && distributionKey
        ? {
            key: distributionKey,
            locationId,
            selectedTimestamp: nextDistribution.selectedTimestamp,
            generatedAt,
            data: nextDistribution,
          }
        : null,
    );

    if (nextInsight && nextDistribution && insightKey && distributionKey && insightKey === distributionKey) {
      const snapshot = {
        key: insightKey,
        locationId,
        insight: nextInsight,
        distribution: nextDistribution,
      } satisfies AnalysisSnapshot;
      setAnalysisSnapshot(snapshot);
      setLastConsistentAnalysisKey(insightKey);
      return;
    }
  };

  const warmLocationSurfaces = async ({
    locationId,
    selectedTimestamp,
    actualTemperatureC,
    targetDate,
    bankroll,
    riskMode,
    minEdge,
    targets,
    bypassCache = false,
  }: {
    locationId: string;
    selectedTimestamp: string | null;
    actualTemperatureC: number | null;
    targetDate: string;
    bankroll: number;
    riskMode: KellyRiskMode;
    minEdge: number;
    targets: WarmLocationTargets;
    bypassCache?: boolean;
  }) => {
    warmAbortRef.current?.abort();
    const warmTasks: Array<() => Promise<unknown>> = [];
    const shouldPreloadImage = targets.image;
    const controller = new AbortController();
    warmAbortRef.current = controller;

    if (targets.home || targets.analysis) {
      warmTasks.push(() =>
        fetchInsightSnapshot({
          locationId,
          selectedTimestamp,
          actualTemperatureC,
          signal: controller.signal,
          bypassCache,
        }),
      );
    }

    if (targets.kelly) {
      warmTasks.push(() =>
        fetchKellySnapshot({
          locationId,
          targetDate,
          bankroll,
          riskMode,
          minEdge,
          actualTemperatureC,
          selectedHour: selectedTimestamp,
          signal: controller.signal,
          bypassCache,
        }),
      );
    }

    if (shouldPreloadImage) {
      const imageUrl = weatherApi.buildMultiModelImageUrl(locationId, true);
      const preview = new Image();
      preview.decoding = "async";
      preview.src = imageUrl;
    }

    if (warmTasks.length === 0 && !shouldPreloadImage) {
      if (warmAbortRef.current === controller) {
        warmAbortRef.current = null;
      }
      return;
    }

    try {
      await new Promise((resolve) => window.setTimeout(resolve, LOCATION_PREWARM_DELAY_MS));
      const results = await Promise.allSettled(
        warmTasks.map(async (task) => {
          if (controller.signal.aborted) {
            return;
          }

          await task();
        }),
      );

      for (const result of results) {
        if (controller.signal.aborted) {
          return;
        }

        if (result.status === "rejected") {
          const error = result.reason;
          if (isAbortLikeError(error)) {
            return;
          }
        }
      }
    } finally {
      if (warmAbortRef.current === controller) {
        warmAbortRef.current = null;
      }
    }
  };

  const performLocationTransition = async (
    locationId: string,
    historyMode: "replace" | "push" = "push",
    requestSeq = locationTransitionSeqRef.current + 1,
  ) => {
    const liveRouteState = routeStateRef.current;
    const liveDashboard = dashboardRef.current;

    if (locationId === liveRouteState.locationId && liveDashboard?.hourly.location.id === locationId) {
      if (requestSeq === locationTransitionSeqRef.current) {
        setLocationTransitionState({
          pendingLocationId: null,
          stage: "idle",
        });
        locationTransitionInFlightRef.current = false;
      }
      collapseRail("programmatic");
      return;
    }

    locationTransitionSeqRef.current = requestSeq;
    cancelOrdinaryWeatherRequests();
    const controller = new AbortController();
    transitionDashboardAbortRef.current = controller;
    const currentPath = liveRouteState.path;
    const currentTab = liveRouteState.tab;
    console.info("[location-transition:start]", {
      locationId,
      requestSeq,
      currentLocationId: liveRouteState.locationId,
      path: currentPath,
      tab: currentTab,
    });

    const createImmediateSurfaceSeed = (selectedTimestamp: string | null) => {
      // Commit city changes as soon as the dashboard is available. Analysis,
      // Kelly, and homepage snapshots hydrate through route-bound loaders after
      // the location switch, so multimodel latency never blocks navigation.
      return {
        nextModelTimestamp: selectedTimestamp,
        nextInsight: null,
        nextDistribution: null,
        nextKelly: null,
      };
    };

    const commitLocationTransition = ({
      nextDashboard,
      selectedTimestamp,
      nextModelTimestamp,
      nextTargetDate,
      nextActualTemperature,
      nextInsight,
      nextDistribution,
      nextKelly,
    }: {
      nextDashboard: DashboardViewModel;
      selectedTimestamp: string | null;
      nextModelTimestamp: string | null;
      nextTargetDate: string;
      nextActualTemperature: number | null;
      nextInsight: InsightViewModel | null;
      nextDistribution: DistributionViewModel | null;
      nextKelly: KellyWorkbenchResponse | null;
    }) => {
      transitionCommitted = true;
      cacheDashboardSnapshot(locationId, nextDashboard);

      if (currentPath === "/analysis" && currentTab === "models") {
        if (nextInsight && nextDistribution) {
          seedAnalysisSnapshot({
            locationId,
            generatedAt: nextDashboard.generatedAt,
            nextInsight,
            nextDistribution,
          });
        }
        setLoadingInsight(!nextInsight);
        setLoadingDistribution(!nextDistribution);
        setLoadingKelly(false);
      } else if (currentPath === "/kelly") {
        setKellySnapshot(nextKelly ?? null);
        setLoadingKelly(!nextKelly);
        setLoadingInsight(false);
        setLoadingDistribution(false);
      } else {
        if (nextInsight) {
          seedAnalysisSnapshot({
            locationId,
            generatedAt: nextDashboard.generatedAt,
            nextInsight,
            nextDistribution: null,
          });
        }
        setLoadingInsight(!nextInsight);
        setLoadingDistribution(false);
        setLoadingKelly(false);
      }

      updateRouteState(
        (current) => ({
          ...current,
          locationId,
          actualTemperatureC: nextActualTemperature,
          kellyActualTemperatureC: nextActualTemperature,
          selectedInsightTimestamp: nextModelTimestamp,
          selectedHourlyTimestamp: selectedTimestamp,
          targetDate: nextTargetDate,
        }),
        historyMode,
      );

      void warmLocationSurfaces({
        locationId,
        selectedTimestamp,
        actualTemperatureC: nextActualTemperature,
        targetDate: nextTargetDate,
        bankroll: liveRouteState.bankroll,
        riskMode: liveRouteState.riskMode,
        minEdge: liveRouteState.minEdge,
        targets: buildWarmLocationTargets(currentPath, currentTab),
      });
    };

    collapseRail("programmatic");
    locationTransitionInFlightRef.current = true;
    kellyDateWarmAbortRef.current?.abort();
    kellyAbortRef.current?.abort();
    closeKellySocket();
    resetKellySocketRuntime();
    setReferenceTemperatureMode("default");
    setManualTemperatureText("");
      setKellyError(null);
      setKellyStreamState("idle");
    setManualRefreshingKelly(false);
    setDashboardError(null);
    setInsightError(null);
    setDistributionError(null);
    setLocationTransitionState({
      pendingLocationId: locationId,
      stage: "dashboard",
    });
    setLoadingDashboard(!liveDashboard);
    if (currentPath === "/") {
      setLoadingInsight(true);
    }
    if (currentPath === "/analysis" && currentTab === "models") {
      setLoadingInsight(true);
      setLoadingDistribution(true);
    }
    if (currentPath === "/kelly") {
      setLoadingKelly(true);
    }

    let shouldPostTransitionRefresh = false;
    let transitionCommitted = false;

    try {
      const cachedDashboard = readWarmCacheEntry<DashboardViewModel>(dashboardWarmCacheRef.current, locationId);
      if (cachedDashboard) {
        const cachedSelectedHour = pickSelectedTimestamp(cachedDashboard.hourly.items, null);
        const cachedTargetDate = resolveKellyTargetDateForSelection(
          cachedDashboard.hourly.locationTimezone,
          cachedSelectedHour,
        );
        const cachedActualTemperature = resolveDefaultReferenceTemperature(cachedDashboard, cachedSelectedHour);
        const primed = createImmediateSurfaceSeed(cachedSelectedHour);

        commitLocationTransition({
          nextDashboard: cachedDashboard,
          selectedTimestamp: cachedSelectedHour,
          nextModelTimestamp: primed.nextModelTimestamp,
          nextTargetDate: cachedTargetDate,
          nextActualTemperature: cachedActualTemperature,
          nextInsight: primed.nextInsight,
          nextDistribution: primed.nextDistribution,
          nextKelly: primed.nextKelly,
        });

        shouldPostTransitionRefresh = true;
        return;
      }

      const nextDashboard = await fetchDashboardSnapshot(locationId, controller.signal);

      if (requestSeq !== locationTransitionSeqRef.current) {
        return;
      }

      const selectedTimestamp = pickSelectedTimestamp(nextDashboard.hourly.items, null);
      const nextTargetDate = resolveKellyTargetDateForSelection(
        nextDashboard.hourly.locationTimezone,
        selectedTimestamp,
      );
      const nextActualTemperature = resolveDefaultReferenceTemperature(nextDashboard, selectedTimestamp);
      const primed = createImmediateSurfaceSeed(selectedTimestamp);

      commitLocationTransition({
        nextDashboard,
        selectedTimestamp,
        nextModelTimestamp: primed.nextModelTimestamp,
        nextTargetDate,
        nextActualTemperature,
        nextInsight: primed.nextInsight,
        nextDistribution: primed.nextDistribution,
        nextKelly: primed.nextKelly,
      });
    } catch (error) {
      if (isAbortLikeError(error)) {
        if (requestSeq === locationTransitionSeqRef.current) {
          console.info("[location-transition:aborted]", {
            locationId,
            requestSeq,
            stage: locationTransitionState.stage,
          });
        }
        return;
      }

      if (requestSeq === locationTransitionSeqRef.current) {
        console.warn("[location-transition:error]", {
          locationId,
          requestSeq,
          error: getErrorMessage(error, UI_TEXT.errors.dashboard),
        });
        setDashboardError(getErrorMessage(error, UI_TEXT.errors.dashboard));
      }
    } finally {
      if (requestSeq === locationTransitionSeqRef.current) {
        setLoadingDashboard(false);
        if (!transitionCommitted) {
          setLoadingInsight(false);
          setLoadingDistribution(false);
          setLoadingKelly(false);
        }
        setLocationTransitionState({
          pendingLocationId: null,
          stage: "idle",
        });
        locationTransitionInFlightRef.current = false;
        console.info("[location-transition:finalized]", {
          locationId,
          requestSeq,
          stage: "idle",
        });
        if (shouldPostTransitionRefresh) {
          void refreshDashboard(false, locationId);
        }
      }

      if (transitionDashboardAbortRef.current === controller) {
        transitionDashboardAbortRef.current = null;
      }
    }
  };

  const transitionToLocation = (locationId: string, historyMode: "replace" | "push" = "push") => {
    const liveRouteState = routeStateRef.current;
    const liveDashboard = dashboardRef.current;

    if (locationId === liveRouteState.locationId && liveDashboard?.hourly.location.id === locationId) {
      locationTransitionSeqRef.current += 1;
      cancelOrdinaryWeatherRequests();
      resetOrdinaryWeatherLoadingStates();
      setLoadingKelly(false);
      setLocationTransitionState({
        pendingLocationId: null,
        stage: "idle",
      });
      collapseRail("programmatic");
      return;
    }

    if (locationTransitionInFlightRef.current) {
      cancelOrdinaryWeatherRequests();
    }

    clearAnalysisSurfaceState();
    void performLocationTransition(locationId, historyMode);
  };

  const clearRefreshResetTimer = () => {
    if (refreshResetTimerRef.current !== null) {
      window.clearTimeout(refreshResetTimerRef.current);
      refreshResetTimerRef.current = null;
    }
  };

  const settleRefreshState = (nextState: Exclude<RefreshState, "pending">) => {
    clearRefreshResetTimer();
    setRefreshState(nextState);
    refreshResetTimerRef.current = window.setTimeout(
      () => setRefreshState("idle"),
      nextState === "success" ? CONFIG.refresh.SUCCESS_FEEDBACK_MS : CONFIG.refresh.ERROR_FEEDBACK_MS,
    );
  };

  const appliedKellyDraft = buildKellyDraftFromRoute(kellyAppliedControls);
  const kellyDraftDirty =
    kellyDraftControls.bankrollInput !== appliedKellyDraft.bankrollInput ||
    kellyDraftControls.minEdgeInput !== appliedKellyDraft.minEdgeInput ||
    kellyDraftControls.actualTemperatureText !== appliedKellyDraft.actualTemperatureText ||
    kellyDraftControls.riskMode !== appliedKellyDraft.riskMode;

  const applyKellyDraftControls = () => {
    if (routeState.path !== "/kelly" || !routeState.targetDate) {
      return;
    }

    const { parsed, errors } = parseKellyDraftControls(kellyDraftControls);
    if (!parsed) {
      setKellyFieldErrors(errors);
      return;
    }

    setKellyFieldErrors({});
    setKellyError(null);
    setManualRefreshingKelly(true);
    setKellyAppliedControls({
      bankroll: parsed.bankroll,
      riskMode: parsed.riskMode,
      minEdge: parsed.minEdge,
      kellyActualTemperatureC: parsed.actualTemperatureC,
    });
    invalidateKellyWarmCache({
      locationId: routeState.locationId,
      targetDate: routeState.targetDate,
      bankroll: parsed.bankroll,
      riskMode: parsed.riskMode,
      minEdge: parsed.minEdge,
      actualTemperatureC: parsed.actualTemperatureC,
      selectedHour: routeState.selectedHourlyTimestamp,
    });
    updateRouteState((current) => ({
      ...current,
      bankroll: parsed.bankroll,
      riskMode: parsed.riskMode,
      minEdge: parsed.minEdge,
      kellyActualTemperatureC: parsed.actualTemperatureC,
    }));
    setKellyRefreshNonce((current) => current + 1);
  };

  useEffect(
    () => () => {
      clearRefreshResetTimer();
      resetKellySocketRuntime();
      cancelOrdinaryWeatherRequests();
      kellyDateWarmAbortRef.current?.abort();
      kellyAbortRef.current?.abort();
      closeKellySocket();
    },
    [],
  );

  useEffect(() => {
    if (routeState.path !== "/analysis" || routeState.tab !== "models") {
      setManualAnalysisRefreshPending(false);
    }
  }, [routeState.path, routeState.tab]);

  useEffect(() => {
    let cancelled = false;

    const loadFavorites = async () => {
      try {
        const response = await weatherApi.fetchFavorites();
        if (!cancelled) {
          setFavoriteLocationIds(response.locationIds);
          setFavoritesError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setFavoritesError(getErrorMessage(error, UI_TEXT.errors.favorites));
        }
      }
    };

    void loadFavorites();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleFavorite = async (locationId: string) => {
    if (favoritePendingIds.includes(locationId)) {
      return;
    }

    const currentlyFavorite = favoriteLocationIds.includes(locationId);
    const previousFavoriteLocationIds = favoriteLocationIds;
    const optimistic = currentlyFavorite
      ? favoriteLocationIds.filter((id) => id !== locationId)
      : [...favoriteLocationIds, locationId];

    setFavoritePendingIds((current) => [...current, locationId]);
    setFavoriteLocationIds(optimistic);

    try {
      const response = await weatherApi.setFavoriteLocation(locationId, !currentlyFavorite);
      setFavoriteLocationIds(response.locationIds);
      setFavoritesError(null);
    } catch (error) {
      setFavoriteLocationIds(previousFavoriteLocationIds);
      setFavoritesError(getErrorMessage(error, UI_TEXT.errors.favorites));
    } finally {
      setFavoritePendingIds((current) => current.filter((id) => id !== locationId));
    }
  };

  const refreshDashboard = async (manual = false, locationId = routeState.locationId) => {
    if (locationTransitionInFlightRef.current) {
      return;
    }

    const shouldRefreshAnalysisSurface =
      manual &&
      locationId === routeState.locationId &&
      routeState.path === "/analysis" &&
      routeState.tab === "models";

    if (refreshInFlightRef.current && refreshInFlightLocationRef.current === locationId) {
      if (manual && refreshInFlightManualRef.current) {
        clearRefreshResetTimer();
        setRefreshState("pending");
        return;
      }

      if (!manual && Date.now() - dashboardRequestStartedAtRef.current <= SHARED_IN_FLIGHT_STALE_MS) {
        return;
      }

      refreshDashboardAbortRef.current?.abort();
      refreshInFlightRef.current = false;
      refreshInFlightLocationRef.current = null;
      refreshInFlightManualRef.current = false;
    }

    const requestSeq = dashboardRequestSeqRef.current + 1;
    dashboardRequestSeqRef.current = requestSeq;
    refreshInFlightRef.current = true;
    refreshInFlightLocationRef.current = locationId;
    refreshInFlightManualRef.current = manual;
    refreshDashboardAbortRef.current?.abort();
    const controller = new AbortController();
    refreshDashboardAbortRef.current = controller;
    setLoadingDashboard(true);
    if (manual) {
      clearRefreshResetTimer();
      setRefreshState("pending");
      if (shouldRefreshAnalysisSurface) {
        analysisRequestEpochRef.current += 1;
        insightAbortRef.current?.abort();
        insightAbortRef.current = null;
        distributionAbortRef.current?.abort();
        distributionAbortRef.current = null;
        setLoadingInsight(false);
        setLoadingDistribution(false);
        setManualAnalysisRefreshPending(false);
      }
    }
    const startedAt = Date.now();
    dashboardRequestStartedAtRef.current = startedAt;

    try {
      const mappedDashboard = await fetchDashboardSnapshot(locationId, controller.signal);
      if (requestSeq !== dashboardRequestSeqRef.current) {
        return;
      }

      cacheDashboardSnapshot(locationId, mappedDashboard);
      setDashboardError(null);

      if (manual) {
        setCacheBust(Date.now());
        if (locationId === routeState.locationId && routeState.path !== "/kelly") {
          invalidateAnalysisWarmCaches(locationId);
          setInsightError(null);
          setDistributionError(null);
          setAnalysisReloadNonce((current) => current + 1);
        }
        if (shouldRefreshAnalysisSurface) {
          setLoadingInsight(true);
          setLoadingDistribution(true);
          setManualAnalysisRefreshPending(true);
        }
      }

      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs < CONFIG.refresh.MIN_VISIBLE_PENDING_MS) {
        await new Promise((resolve) => window.setTimeout(resolve, CONFIG.refresh.MIN_VISIBLE_PENDING_MS - elapsedMs));
      }

      if (manual) {
        settleRefreshState("success");
      }
    } catch (error) {
      if (requestSeq !== dashboardRequestSeqRef.current) {
        return;
      }

      if (isAbortLikeError(error)) {
        return;
      }

      setDashboardError(getErrorMessage(error, UI_TEXT.errors.dashboard));
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs < CONFIG.refresh.MIN_VISIBLE_PENDING_MS) {
        await new Promise((resolve) => window.setTimeout(resolve, CONFIG.refresh.MIN_VISIBLE_PENDING_MS - elapsedMs));
      }
      if (manual) {
        settleRefreshState("error");
      }
    } finally {
      if (requestSeq !== dashboardRequestSeqRef.current) {
        return;
      }

      setLoadingDashboard(false);
      if (refreshDashboardAbortRef.current === controller) {
        refreshDashboardAbortRef.current = null;
      }
      if (requestSeq === dashboardRequestSeqRef.current) {
        dashboardRequestStartedAtRef.current = 0;
      }
      refreshInFlightRef.current = false;
      refreshInFlightLocationRef.current = null;
      refreshInFlightManualRef.current = false;
    }
  };

  useEffect(() => {
    if (locationTransitionState.stage !== "idle" || locationTransitionInFlightRef.current) {
      return;
    }

    if (dashboard?.hourly.location.id !== routeState.locationId) {
      void refreshDashboard(false, routeState.locationId);
    }

    if (routeState.path === "/kelly") {
      return;
    }

    const maybeRefreshOnFocus = () => {
      if (document.visibilityState === "hidden") {
        return;
      }

      if (
        refreshInFlightRef.current &&
        Date.now() - dashboardRequestStartedAtRef.current > SHARED_IN_FLIGHT_STALE_MS
      ) {
        refreshDashboardAbortRef.current?.abort();
        setLoadingDashboard(false);
        refreshInFlightRef.current = false;
        refreshInFlightLocationRef.current = null;
        refreshInFlightManualRef.current = false;
      }

      if (
        locationTransitionInFlightRef.current ||
        refreshInFlightRef.current ||
        locationTransitionState.stage !== "idle"
      ) {
        return;
      }

      if (Date.now() - lastDashboardRefreshAtRef.current < SILENT_REFRESH_STALE_MS) {
        return;
      }

      void refreshDashboard(false, routeState.locationId);
    };

    window.addEventListener("focus", maybeRefreshOnFocus);
    document.addEventListener("visibilitychange", maybeRefreshOnFocus);

    return () => {
      window.removeEventListener("focus", maybeRefreshOnFocus);
      document.removeEventListener("visibilitychange", maybeRefreshOnFocus);
    };
  }, [
    dashboard?.hourly.location.id,
    locationTransitionState.stage,
    routeState.locationId,
    routeState.path,
  ]);

  useEffect(() => {
    if (routeState.path !== "/kelly" || !routeState.targetDate) {
      return;
    }

    const maybeRecoverKellyOnFocus = () => {
      if (document.visibilityState === "hidden" || locationTransitionInFlightRef.current) {
        return;
      }

      const now = Date.now();
      if (now - kellyFocusRecoveryAtRef.current < KELLY_FOCUS_RECOVERY_COOLDOWN_MS) {
        return;
      }

      if (kellyAbortRef.current && now - kellyRequestStartedAtRef.current > SHARED_IN_FLIGHT_STALE_MS) {
        kellyAbortRef.current.abort();
        kellyAbortRef.current = null;
        kellyRequestStartedAtRef.current = 0;
      }

      if (kellyAbortRef.current) {
        return;
      }

      const kellySnapshotAligned =
        kellySnapshot?.location.id === routeState.locationId && kellySnapshot?.targetDate === routeState.targetDate;
      const lastKellySignalAt = parseIsoTime(
        kellySnapshotAligned
          ? (kellySnapshot?.freshness.lastStreamEventAt ??
            kellySnapshot?.streamHealth.lastSignalAt ??
            kellySnapshot?.freshness.repricedAt)
          : null,
      );
      const streamStale = lastKellySignalAt === null || now - lastKellySignalAt > KELLY_FOCUS_RECOVERY_STALE_MS;
      const dashboardNeedsRefresh =
        dashboard?.hourly.location.id !== routeState.locationId ||
        now - lastDashboardRefreshAtRef.current > SILENT_REFRESH_STALE_MS;
      const kellyNeedsSnapshotReload = !kellySnapshotAligned || !kellySnapshot || kellyError !== null;
      const kellyNeedsSocketRecovery =
        kellyStreamState === "idle" ||
        kellyStreamState === "degraded" ||
        kellyStreamState === "disconnected" ||
        streamStale;
      const kellyNeedsRecovery = kellyNeedsSnapshotReload || kellyNeedsSocketRecovery;
      const shouldRefreshDashboard = dashboardNeedsRefresh && !kellyNeedsRecovery;

      if (!shouldRefreshDashboard && !kellyNeedsRecovery) {
        return;
      }

      kellyFocusRecoveryAtRef.current = now;

      if (shouldRefreshDashboard) {
        void refreshDashboard(false, routeState.locationId);
      }

      if (kellyNeedsRecovery) {
        setKellySocketReconnectNonce((current) => current + 1);
        if (kellyNeedsSnapshotReload) {
          invalidateKellyWarmCache({
            locationId: routeState.locationId,
            targetDate: routeState.targetDate,
            bankroll: routeState.bankroll,
            riskMode: routeState.riskMode,
            minEdge: routeState.minEdge,
            actualTemperatureC: routeState.kellyActualTemperatureC,
            selectedHour: routeState.selectedHourlyTimestamp,
          });
          setKellyRefreshNonce((current) => current + 1);
        }
      }
    };

    window.addEventListener("focus", maybeRecoverKellyOnFocus);
    document.addEventListener("visibilitychange", maybeRecoverKellyOnFocus);

    return () => {
      window.removeEventListener("focus", maybeRecoverKellyOnFocus);
      document.removeEventListener("visibilitychange", maybeRecoverKellyOnFocus);
    };
  }, [
    dashboard?.hourly.location.id,
    kellyError,
    kellySnapshot,
    kellyStreamState,
    routeState.kellyActualTemperatureC,
    routeState.bankroll,
    routeState.locationId,
    routeState.minEdge,
    routeState.path,
    routeState.riskMode,
    routeState.selectedHourlyTimestamp,
    routeState.targetDate,
  ]);

  useEffect(() => {
    if (!dashboard) {
      return;
    }

    updateRouteState((current) => {
      const nextSelectedHour = pickSelectedTimestamp(dashboard.hourly.items, current.selectedHourlyTimestamp);
      const nextInsightTimestamp =
        current.selectedInsightTimestamp &&
        dashboard.hourly.items.some((item) => item.timestamp === current.selectedInsightTimestamp)
          ? current.selectedInsightTimestamp
          : nextSelectedHour;
      const nextKellyTargetDate =
        current.path === "/kelly"
          ? resolveKellyTargetDateForSelection(dashboard.hourly.locationTimezone, nextSelectedHour)
          : current.targetDate;
      const nextActualTemperature =
        current.path !== "/kelly" && referenceTemperatureMode === "default"
          ? resolveDefaultReferenceTemperature(dashboard, nextSelectedHour)
          : current.actualTemperatureC;
      const isAutoKellyTargetDate =
        current.path === "/kelly" &&
        (current.targetDate === null ||
          current.targetDate === resolveTodayForTimezone(dashboard.hourly.locationTimezone) ||
          current.targetDate === resolveKellyTargetDateForSelection(dashboard.hourly.locationTimezone, current.selectedHourlyTimestamp));

      if (nextSelectedHour === current.selectedHourlyTimestamp) {
        if (
          nextInsightTimestamp === current.selectedInsightTimestamp &&
          nextActualTemperature === current.actualTemperatureC &&
          (!isAutoKellyTargetDate || nextKellyTargetDate === current.targetDate)
        ) {
          return current;
        }
      }

      return {
        ...current,
        selectedHourlyTimestamp: nextSelectedHour,
        selectedInsightTimestamp: nextInsightTimestamp,
        actualTemperatureC: nextActualTemperature,
        targetDate: isAutoKellyTargetDate ? nextKellyTargetDate : current.targetDate,
      };
    });
  }, [dashboard, referenceTemperatureMode]);

  useEffect(() => {
    if (routeState.path !== "/kelly") {
      return;
    }

    const locationTimezone =
      dashboard?.locationDirectory.find((location) => location.id === routeState.locationId)?.timezone ??
      dashboard?.hourly.locationTimezone;

    if (!locationTimezone) {
      return;
    }

    if (routeState.targetDate) {
      return;
    }

    updateRouteState((current) => ({
      ...current,
      targetDate: resolveKellyTargetDateForSelection(locationTimezone, current.selectedHourlyTimestamp),
    }));
  }, [
    dashboard?.hourly.locationTimezone,
    dashboard?.locationDirectory,
    routeState.locationId,
    routeState.path,
    routeState.selectedHourlyTimestamp,
    routeState.targetDate,
  ]);

  useEffect(() => {
    if (routeState.path !== "/kelly" || !kellySnapshot) {
      return;
    }

    const nextTargetDate =
      (routeState.targetDate && kellySnapshot.availableTargetDates.includes(routeState.targetDate)
        ? routeState.targetDate
        : null) ??
      kellySnapshot.targetDate ??
      kellySnapshot.availableTargetDates[0] ??
      null;

    if (!nextTargetDate || nextTargetDate === routeState.targetDate) {
      return;
    }

    updateRouteState((current) => ({
      ...current,
      targetDate: nextTargetDate,
    }));
  }, [
    kellySnapshot?.availableTargetDates,
    kellySnapshot?.targetDate,
    routeState.path,
    routeState.targetDate,
  ]);

  useEffect(() => {
    const availableTargetDates = kellySnapshot?.availableTargetDates ?? [];

    if (
      !ENABLE_KELLY_DATE_WARM ||
      routeState.path !== "/kelly" ||
      !routeState.targetDate ||
      availableTargetDates.length === 0 ||
      loadingKelly ||
      manualRefreshingKelly ||
      locationTransitionState.stage !== "idle"
    ) {
      kellyDateWarmAbortRef.current?.abort();
      kellyDateWarmAbortRef.current = null;
      return;
    }

    const remainingDates = availableTargetDates
      .filter((date) => date !== routeState.targetDate)
      .slice(0, 2);

    if (remainingDates.length === 0) {
      kellyDateWarmAbortRef.current?.abort();
      kellyDateWarmAbortRef.current = null;
      return;
    }

    kellyDateWarmAbortRef.current?.abort();
    const controller = new AbortController();
    kellyDateWarmAbortRef.current = controller;

    const warmDates = async () => {
      await new Promise((resolve) => window.setTimeout(resolve, KELLY_DATE_WARM_DELAY_MS));
      if (controller.signal.aborted) {
        return;
      }

      for (const targetDate of remainingDates) {
        if (controller.signal.aborted) {
          return;
        }

        try {
          await fetchKellySnapshot({
            locationId: routeState.locationId,
            targetDate,
            bankroll: routeState.bankroll,
            riskMode: routeState.riskMode,
            minEdge: routeState.minEdge,
            actualTemperatureC: routeState.kellyActualTemperatureC,
            selectedHour: routeState.selectedHourlyTimestamp,
            signal: controller.signal,
          });
        } catch (error) {
          if (isAbortLikeError(error)) {
            return;
          }
        }
      }
    };

    void warmDates();

    return () => {
      controller.abort();
      if (kellyDateWarmAbortRef.current === controller) {
        kellyDateWarmAbortRef.current = null;
      }
    };
  }, [
    kellySnapshot?.availableTargetDates?.join("|"),
    routeState.kellyActualTemperatureC,
    routeState.bankroll,
    routeState.locationId,
    routeState.minEdge,
    routeState.path,
    routeState.riskMode,
    routeState.selectedHourlyTimestamp,
    routeState.targetDate,
    loadingKelly,
    locationTransitionState.stage,
    manualRefreshingKelly,
  ]);

  const items = dashboard?.hourly.items ?? [];
  const selectedIndex = items.findIndex((item) => item.timestamp === routeState.selectedHourlyTimestamp);
  const selectedItem = items[selectedIndex >= 0 ? selectedIndex : 0] ?? null;
  const currentHourItem =
    dashboard?.hourly.current && items[dashboard.hourly.current.index]
      ? items[dashboard.hourly.current.index] ?? null
      : selectedItem;

  const insightDisplayUnit = insight?.displayUnit ?? activeDisplayUnit;
  const defaultReferenceTemperature = resolveDefaultReferenceTemperature(dashboard, routeState.selectedHourlyTimestamp);

  useEffect(() => {
    if (routeState.path === "/kelly" || referenceTemperatureMode !== "default") {
      return;
    }

    const nextText = formatTemperatureInputValue(defaultReferenceTemperature, insightDisplayUnit);
    if (manualTemperatureText !== nextText) {
      setManualTemperatureText(nextText);
    }

    if (routeState.actualTemperatureC === defaultReferenceTemperature) {
      return;
    }

    updateRouteState((current) => ({
      ...current,
      actualTemperatureC: defaultReferenceTemperature,
    }));
  }, [
    defaultReferenceTemperature,
    insightDisplayUnit,
    manualTemperatureText,
    referenceTemperatureMode,
    routeState.actualTemperatureC,
    routeState.path,
  ]);

  useEffect(() => {
    if (referenceTemperatureMode !== "manual") {
      return;
    }

    const nextText = formatTemperatureInputValue(routeState.actualTemperatureC, insightDisplayUnit);
    if (manualTemperatureText !== nextText) {
      setManualTemperatureText(nextText);
    }
  }, [insightDisplayUnit, manualTemperatureText, referenceTemperatureMode, routeState.actualTemperatureC]);

  useEffect(() => {
    if (!dashboard?.locationDirectory.length) {
      return;
    }

    if (!railExpanded) {
      return;
    }

    if (loadingDashboard || locationTransitionState.stage !== "idle") {
      return;
    }

    const visibleGroup = browsingTimezoneGroup ?? activeTimezoneGroup;
    setLocationTemperatures((current) => {
      const next = { ...current };

      for (const location of dashboard.locationDirectory) {
        if (location.timezoneGroup !== visibleGroup) {
          continue;
        }

        if (location.id === dashboard.hourly.location.id) {
          const liveTemp = dashboard.hourly.current?.temperatureC ?? dashboard.hourly.items[0]?.temperatureC ?? null;
          writeWarmCacheEntry(locationTemperatureWarmCacheRef.current, location.id, liveTemp);
          next[location.id] = liveTemp;
          continue;
        }

        const cachedTemp = readWarmCacheEntry<number | null>(
          locationTemperatureWarmCacheRef.current,
          location.id,
          LOCATION_TEMPERATURE_TTL_MS,
        );
        if (cachedTemp !== null) {
          next[location.id] = cachedTemp;
          continue;
        }

        const cachedDashboard = readWarmCacheEntry<DashboardViewModel>(
          dashboardWarmCacheRef.current,
          location.id,
          DASHBOARD_WARM_CACHE_TTL_MS,
        );
        if (!cachedDashboard) {
          continue;
        }

        const dashboardTemp =
          cachedDashboard.hourly.current?.temperatureC ?? cachedDashboard.hourly.items[0]?.temperatureC ?? null;
        writeWarmCacheEntry(locationTemperatureWarmCacheRef.current, location.id, dashboardTemp);
        next[location.id] = dashboardTemp;
      }

      return next;
    });
  }, [
    activeTimezoneGroup,
    browsingTimezoneGroup,
    dashboard?.locationDirectory,
    loadingDashboard,
    locationTransitionState.stage,
    railExpanded,
  ]);

  useEffect(() => {
    const awaitingLocationCommit =
      locationTransitionState.pendingLocationId !== null &&
      locationTransitionState.pendingLocationId !== routeState.locationId;
    const dashboardAligned = dashboard?.hourly.location.id === routeState.locationId;
    if (routeState.path === "/kelly") {
      setInsight(null);
      setDistribution(null);
      setLatestInsightEnvelope(null);
      setLatestDistributionEnvelope(null);
      return;
    }

    if (awaitingLocationCommit) {
      return;
    }

    if (!dashboard || !dashboardAligned) {
      setInsight(null);
      setDistribution(null);
      setLatestInsightEnvelope(null);
      setLatestDistributionEnvelope(null);
      return;
    }

    const generatedAt = dashboard.generatedAt;
    const requestLocationId = routeState.locationId;
    const defaultSelectedHour = pickSelectedTimestamp(dashboard.hourly.items, routeState.selectedHourlyTimestamp);
    const requestSelectedTimestamp =
      routeState.selectedInsightTimestamp &&
      dashboard.hourly.items.some((item) => item.timestamp === routeState.selectedInsightTimestamp)
        ? routeState.selectedInsightTimestamp
        : defaultSelectedHour;
    const defaultActualTemperature = resolveDefaultReferenceTemperature(dashboard, requestSelectedTimestamp);
    const routeTimestampsHydrated =
      routeState.selectedHourlyTimestamp === defaultSelectedHour &&
      routeState.selectedInsightTimestamp === requestSelectedTimestamp;
    const routeActualTemperatureHydrated =
      referenceTemperatureMode !== "default" || routeState.actualTemperatureC === defaultActualTemperature;

    if (!routeTimestampsHydrated || !routeActualTemperatureHydrated) {
      return;
    }

    const requestActualTemperature =
      routeState.actualTemperatureC ?? defaultActualTemperature;
    const requestEpoch = analysisRequestEpochRef.current;
    const insightKey = buildInsightWarmKey(
      requestLocationId,
      requestSelectedTimestamp,
      requestActualTemperature,
    );
    const cachedInsight = readWarmCacheEntry<InsightViewModel>(insightWarmCacheRef.current, insightKey);
    const distributionKey = buildDistributionWarmKey(requestLocationId, requestSelectedTimestamp);
    const cachedDistribution = requestSelectedTimestamp
      ? readWarmCacheEntry<DistributionViewModel>(distributionWarmCacheRef.current, distributionKey)
      : null;

    const shouldRevalidateHomeInsight = routeState.path !== "/analysis" && cachedInsight;

    if (shouldRevalidateHomeInsight) {
      setInsight(cachedInsight);
      const key = buildAnalysisBatchKey(requestLocationId, cachedInsight.selectedTimestamp);
      if (key) {
        setLatestInsightEnvelope({
          key,
          locationId: requestLocationId,
          selectedTimestamp: cachedInsight.selectedTimestamp,
          generatedAt,
          data: cachedInsight,
        });
      }
      setInsightError(null);
      setLoadingDistribution(false);
    }

    let cancelled = false;
    insightAbortRef.current?.abort();
    distributionAbortRef.current?.abort();
    const controller = new AbortController();
    insightAbortRef.current = controller;
    if (routeState.path === "/analysis") {
      distributionAbortRef.current = controller;
    }
    setLoadingInsight(!shouldRevalidateHomeInsight);
    if (routeState.path === "/analysis") {
      setLoadingDistribution(true);
    } else {
      setLoadingDistribution(false);
      setDistribution(null);
      setLatestDistributionEnvelope(null);
    }

    const load = async () => {
      const isCurrentAnalysisRequest = () => {
        if (cancelled || requestEpoch !== analysisRequestEpochRef.current) {
          return false;
        }

        const liveAnalysisRuntime = analysisRuntimeRef.current;
        const liveRouteState = routeStateRef.current;
        const liveSelectedTimestamp =
          liveAnalysisRuntime.selectedInsightTimestamp ?? liveRouteState.selectedHourlyTimestamp ?? null;
        const liveActualTemperature =
          liveAnalysisRuntime.actualTemperatureC ??
          resolveDefaultReferenceTemperature(dashboardRef.current, liveSelectedTimestamp);

        return (
          liveAnalysisRuntime.routeLocationId === requestLocationId &&
          liveAnalysisRuntime.routePath === routeState.path &&
          liveSelectedTimestamp === requestSelectedTimestamp &&
          liveActualTemperature === requestActualTemperature
        );
      };

      try {
        const insightPromise =
          shouldRevalidateHomeInsight
            ? fetchInsightSnapshot({
                locationId: requestLocationId,
                selectedTimestamp: requestSelectedTimestamp,
                actualTemperatureC: requestActualTemperature,
                signal: controller.signal,
                bypassCache: true,
                allowInFlightReuse: false,
              })
            : cachedInsight
              ? Promise.resolve(cachedInsight)
              : fetchInsightSnapshot({
                locationId: requestLocationId,
                selectedTimestamp: requestSelectedTimestamp,
                actualTemperatureC: requestActualTemperature,
                signal: controller.signal,
              });
        let insightTask: InsightViewModel | null = null;
        let insightBatchKey: string | null = null;

        try {
          insightTask = await insightPromise;
        } catch (error) {
          if (isAbortLikeError(error)) {
            return;
          }
          if (!isCurrentAnalysisRequest()) {
            return;
          }
          setInsightError(getErrorMessage(error, UI_TEXT.errors.insight));
        } finally {
          if (isCurrentAnalysisRequest()) {
            setLoadingInsight(false);
          }
        }

        if (insightTask) {
          if (!isCurrentAnalysisRequest()) {
            return;
          }

          insightBatchKey = buildAnalysisBatchKey(requestLocationId, insightTask.selectedTimestamp);
          setInsight(insightTask);
          if (insightBatchKey) {
            setLatestInsightEnvelope({
              key: insightBatchKey,
              locationId: requestLocationId,
              selectedTimestamp: insightTask.selectedTimestamp,
              generatedAt,
              data: insightTask,
            });
          }
          setInsightError(null);
        }

        if (routeState.path !== "/analysis") {
          return;
        }

        if (!insightTask) {
          if (isCurrentAnalysisRequest()) {
            setDistributionError(null);
          }
          return;
        }

        let analysisTask: DistributionViewModel | null = null;
        let distributionFailure: string | null = null;
        const distributionTimestamp = insightTask.selectedTimestamp;
        const alignedCachedDistribution =
          cachedDistribution?.selectedTimestamp === distributionTimestamp
            ? cachedDistribution
            : readWarmCacheEntry<DistributionViewModel>(
                distributionWarmCacheRef.current,
                buildDistributionWarmKey(requestLocationId, distributionTimestamp),
              );

        try {
          analysisTask =
            alignedCachedDistribution ??
            (await fetchDistributionSnapshot({
              locationId: requestLocationId,
              selectedTimestamp: distributionTimestamp,
              signal: controller.signal,
            }));
        } catch (error) {
          if (isAbortLikeError(error)) {
            return;
          }
          distributionFailure = getErrorMessage(error, UI_TEXT.errors.distribution);
        }

        if (!isCurrentAnalysisRequest()) {
          return;
        }

        if (!insightTask && !analysisTask && !distributionFailure) {
          return;
        }

        if (analysisTask) {
          const distributionBatchKey = buildAnalysisBatchKey(requestLocationId, analysisTask.selectedTimestamp);
          setDistribution(analysisTask);
          if (distributionBatchKey) {
            setLatestDistributionEnvelope({
              key: distributionBatchKey,
              locationId: requestLocationId,
              selectedTimestamp: analysisTask.selectedTimestamp,
              generatedAt,
              data: analysisTask,
            });
          }
          if (insightBatchKey && distributionBatchKey && insightBatchKey === distributionBatchKey && insightTask) {
            setAnalysisSnapshot({
              key: insightBatchKey,
              locationId: requestLocationId,
              insight: insightTask,
              distribution: analysisTask,
            });
            setLastConsistentAnalysisKey(insightBatchKey);
          }
        }
        if (distributionFailure && !analysisTask) {
          setDistributionError(distributionFailure);
        } else {
          setDistributionError(null);
        }
      } catch (error) {
        if (isAbortLikeError(error)) {
          return;
        }
        if (!cancelled && requestEpoch === analysisRequestEpochRef.current) {
          setInsightError(getErrorMessage(error, UI_TEXT.errors.insight));
          if (routeState.path === "/analysis") {
            setDistributionError(getErrorMessage(error, UI_TEXT.errors.distribution));
          }
        }
      } finally {
        if (!cancelled && requestEpoch === analysisRequestEpochRef.current) {
          setLoadingInsight(false);
          if (routeState.path === "/analysis") {
            setLoadingDistribution(false);
          }
          setManualAnalysisRefreshPending(false);
        }
        if (insightAbortRef.current === controller) {
          insightAbortRef.current = null;
        }
        if (distributionAbortRef.current === controller) {
          distributionAbortRef.current = null;
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    analysisReloadNonce,
    dashboard?.hourly.location.id,
    locationTransitionState.pendingLocationId,
    referenceTemperatureMode,
    routeState.actualTemperatureC,
    routeState.locationId,
    routeState.path,
    routeState.selectedInsightTimestamp,
    routeState.selectedHourlyTimestamp,
    routeState.tab,
  ]);

  useEffect(() => {
    const awaitingLocationCommit =
      locationTransitionState.pendingLocationId !== null &&
      locationTransitionState.pendingLocationId !== routeState.locationId;
    if (awaitingLocationCommit || routeState.path === "/kelly") {
      return;
    }

    const alignedInsightEnvelope = pickAlignedAnalysisEnvelope<InsightViewModel>(
      latestInsightEnvelope,
      routeState.locationId,
    );
    const activeInsight = alignedInsightEnvelope?.data ?? null;
    if (!activeInsight) {
      return;
    }

    if (
      routeState.selectedInsightTimestamp &&
      activeInsight.availableTimestamps.includes(routeState.selectedInsightTimestamp)
    ) {
      return;
    }

    updateRouteState((current) => ({
      ...current,
      selectedInsightTimestamp: activeInsight.selectedTimestamp,
    }));
  }, [
    dashboard?.hourly.location.id,
    latestInsightEnvelope,
    locationTransitionState.pendingLocationId,
    routeState.locationId,
    routeState.path,
    routeState.selectedInsightTimestamp,
  ]);

  useEffect(() => {
    if (routeState.path !== "/kelly" || !routeState.targetDate) {
      setManualRefreshingKelly(false);
      return;
    }

    const kellyKey = buildKellyWarmKey({
      locationId: routeState.locationId,
      targetDate: routeState.targetDate,
      bankroll: routeState.bankroll,
      riskMode: routeState.riskMode,
      minEdge: routeState.minEdge,
      actualTemperatureC: routeState.kellyActualTemperatureC,
      selectedHour: routeState.selectedHourlyTimestamp,
    });
    const cachedKelly = readWarmCacheEntry<KellyWorkbenchResponse>(
      kellyWarmCacheRef.current,
      kellyKey,
      KELLY_WARM_CACHE_TTL_MS,
    );
    if (cachedKelly && canReuseKellyWarmSnapshot(cachedKelly)) {
      setKellySnapshot(cachedKelly);
      setKellyError(null);
      setKellyStreamState(cachedKelly.streamHealth.state);
      setLoadingKelly(false);
      setManualRefreshingKelly(false);
      kellyRequestStartedAtRef.current = 0;
      return;
    }
    if (cachedKelly) {
      kellyWarmCacheRef.current.delete(kellyKey);
    }

    let cancelled = false;
    const requestSeq = kellyRequestSeqRef.current + 1;
    kellyRequestSeqRef.current = requestSeq;
    kellyAbortRef.current?.abort();
    const controller = new AbortController();
    kellyAbortRef.current = controller;
    kellyRequestStartedAtRef.current = Date.now();
    if (!manualRefreshingKelly) {
      setLoadingKelly(true);
    }

    const load = async () => {
      try {
        const response = await fetchKellySnapshot({
          locationId: routeState.locationId,
          targetDate: routeState.targetDate,
          bankroll: routeState.bankroll,
          riskMode: routeState.riskMode,
          minEdge: routeState.minEdge,
          actualTemperatureC: routeState.kellyActualTemperatureC,
          selectedHour: routeState.selectedHourlyTimestamp,
          signal: controller.signal,
          bypassCache: manualRefreshingKelly,
        });

        if (cancelled || requestSeq !== kellyRequestSeqRef.current) {
          return;
        }

        setKellySnapshot(response);
        setKellyError(null);
        setKellyStreamState(response.streamHealth.state);
      } catch (error) {
        if (isAbortLikeError(error)) {
          return;
        }
        if (!cancelled && requestSeq === kellyRequestSeqRef.current) {
          setKellyError(getErrorMessage(error, "Kelly 实验台读取失败。"));
        }
      } finally {
        if (!cancelled && requestSeq === kellyRequestSeqRef.current) {
          setLoadingKelly(false);
          setManualRefreshingKelly(false);
        }
        if (kellyAbortRef.current === controller) {
          kellyAbortRef.current = null;
        }
        if (requestSeq === kellyRequestSeqRef.current) {
          kellyRequestStartedAtRef.current = 0;
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    routeState.bankroll,
    kellyRefreshNonce,
    routeState.kellyActualTemperatureC,
    routeState.locationId,
    routeState.minEdge,
    routeState.path,
    routeState.riskMode,
    routeState.selectedHourlyTimestamp,
    routeState.targetDate,
  ]);

  useEffect(() => {
    if (!latestInsightEnvelope || !latestDistributionEnvelope) {
      return;
    }

    if (
      latestInsightEnvelope.locationId !== routeState.locationId ||
      latestDistributionEnvelope.locationId !== routeState.locationId ||
      latestInsightEnvelope.key !== latestDistributionEnvelope.key
    ) {
      return;
    }

    const snapshot = {
      key: latestInsightEnvelope.key,
      locationId: latestInsightEnvelope.locationId,
      insight: latestInsightEnvelope.data,
      distribution: latestDistributionEnvelope.data,
    } satisfies AnalysisSnapshot;
    setAnalysisSnapshot(snapshot);
    setLastConsistentAnalysisKey(latestInsightEnvelope.key);
  }, [latestDistributionEnvelope, latestInsightEnvelope, routeState.locationId]);

  const isAnalysis = routeState.path === "/analysis";
  const isKelly = routeState.path === "/kelly";
  const currentPage = isKelly ? "kelly" : isAnalysis ? "analysis" : "home";
  const report = dashboard?.report;
  const reportText = report?.textZh ?? CONFIG.fallback.emptyText;
  const analysisLocationCommitPending =
    isAnalysis &&
    locationTransitionState.pendingLocationId !== null &&
    locationTransitionState.pendingLocationId !== routeState.locationId;
  const rawImageAvailabilityStatus = dashboard?.multimodel.imageStatus ?? "unavailable";
  const imageUrl =
    analysisLocationCommitPending
      ? null
      : dashboard && dashboard.multimodel.imageUrlFound && rawImageAvailabilityStatus !== "unavailable"
        ? weatherApi.buildMultiModelImageUrl(routeState.locationId, true, cacheBust)
        : null;
  const imageAvailabilityStatus = analysisLocationCommitPending ? "revalidating" : rawImageAvailabilityStatus;
  const imageUpdatedAt =
    analysisLocationCommitPending
      ? null
      : imageAvailabilityStatus !== "unavailable"
      ? (dashboard?.multimodel.displayUpdatedAt ?? dashboard?.sync.updatedAt ?? null)
      : null;
  const isLocationTransitionPending = locationTransitionState.stage === "dashboard";

  useEffect(() => {
    if (!imageUrl) {
      return;
    }

    if (routeState.path !== "/analysis" || routeState.tab !== "image") {
      return;
    }

    const preview = new Image();
    preview.decoding = "async";
    preview.src = imageUrl;
  }, [imageUrl, routeState.path, routeState.tab]);

  useEffect(() => {
    const kellySnapshotAligned =
      kellySnapshot?.location.id === routeState.locationId && kellySnapshot?.targetDate === routeState.targetDate;

    if (routeState.path !== "/kelly" || !routeState.targetDate) {
      closeKellySocket();
      resetKellySocketRuntime();
      setKellyStreamState("idle");
      kellyRequestStartedAtRef.current = 0;
      return;
    }

    if (!kellySnapshot || !kellySnapshotAligned) {
      closeKellySocket();
      resetKellySocketRuntime();
      setKellyStreamState("idle");
      return;
    }

    const socket = new WebSocket(
      weatherApi.buildKellyStreamUrl(
        routeState.locationId,
        routeState.targetDate ?? undefined,
        routeState.bankroll,
        routeState.riskMode,
        routeState.minEdge,
        routeState.kellyActualTemperatureC ?? undefined,
        routeState.selectedHourlyTimestamp ?? undefined,
      ),
    );
    let intentionalClose = false;
    let reconnectRequested = false;

    closeKellySocket();
    kellySocketRef.current = socket;
    kellySocketSuppressedRef.current = null;
    setKellyStreamState("connecting");

    const applyStatusMessage = (message: Extract<KellyStreamMessage, { type: "status" }>) => {
      if (kellySocketRef.current !== socket) {
        return;
      }

      setKellyStreamState(message.state);
      setKellySnapshot((current) => {
        if (
          !current ||
          current.location.id !== routeState.locationId ||
          current.targetDate !== routeState.targetDate
        ) {
          return current;
        }

        const updatedAt = message.lastRepricedAt ?? message.lastSignalAt ?? message.generatedAt;
        return {
          ...current,
          streamHealth: {
            state: message.state,
            reasonCode: message.reasonCode,
            message: message.message,
            lastSignalAt: message.lastSignalAt ?? current.streamHealth.lastSignalAt,
            lastRepricedAt: message.lastRepricedAt ?? current.streamHealth.lastRepricedAt,
          },
          freshness: {
            ...current.freshness,
            lastStreamEventAt: message.lastSignalAt ?? current.freshness.lastStreamEventAt,
            repricedAt: message.lastRepricedAt ?? current.freshness.repricedAt,
            marketMotionState: resolveKellyMotionStateFromStream(message.state, message.reasonCode),
          },
          sourceStatus: current.sourceStatus.map((status) => {
            if (status.kind === "stream") {
              return {
                ...status,
                state: resolveKellySourceState(message.state, message.reasonCode),
                detail: message.message,
                updatedAt,
              };
            }

            if (status.kind === "orderbooks" && message.lastRepricedAt) {
              const degradedOrderbookStatus =
                message.reasonCode === "reprice_failed" ||
                message.reasonCode === "polling_fallback" ||
                message.reasonCode === "ws_error" ||
                message.reasonCode === "upstream_error";
              return {
                ...status,
                state: degradedOrderbookStatus ? "degraded" : "fresh",
                detail: degradedOrderbookStatus
                  ? "最近一次成功盘口快照仍在使用，当前等待下一轮有效重定价。"
                  : "最近一次盘口快照已用于重定价。",
                updatedAt: message.lastRepricedAt,
              };
            }

            return status;
          }),
        } satisfies KellyWorkbenchResponse;
      });
    };

    const scheduleReconnect = (
      message: Extract<KellyStreamMessage, { type: "status" }>,
      closeSocket = false,
    ) => {
      if (kellySocketRef.current !== socket) {
        return;
      }

      if (intentionalClose || reconnectRequested) {
        return;
      }

      reconnectRequested = true;
      if (kellySocketRef.current === socket) {
        kellySocketRef.current = null;
      }

      applyStatusMessage(message);

      const attempt = kellySocketRetryCountRef.current;
      const delay =
        Math.min(KELLY_STREAM_RECONNECT_MAX_MS, KELLY_STREAM_RECONNECT_BASE_MS * 2 ** attempt) +
        Math.min(750, attempt * 125);
      kellySocketRetryCountRef.current = Math.min(attempt + 1, 8);

      clearKellySocketReconnectTimer();
      kellySocketReconnectTimerRef.current = window.setTimeout(() => {
        clearKellySocketReconnectTimer();
        if (routeState.path !== "/kelly" || !routeState.targetDate) {
          return;
        }

        setKellySocketReconnectNonce((current) => current + 1);
      }, delay);

      if (closeSocket && socket.readyState < WebSocket.CLOSING) {
        try {
          socket.close();
        } catch {
          // ignore close errors while a reconnect is already scheduled
        }
      }
    };

    socket.onopen = () => {
      if (kellySocketRef.current !== socket) {
        return;
      }

      clearKellySocketReconnectTimer();
      kellySocketRetryCountRef.current = 0;
      setKellyStreamState("connecting");
    };

    socket.onmessage = (event) => {
      if (kellySocketRef.current !== socket) {
        return;
      }

      kellySocketRetryCountRef.current = 0;
      try {
        const message = JSON.parse(event.data) as KellyStreamMessage;
        if (message.type === "status") {
          startTransition(() => {
            applyStatusMessage(message);
          });
          return;
        }

        startTransition(() => {
          setKellyStreamState("connected");
          setKellySnapshot((current) => {
            if (
              !current ||
              current.location.id !== routeState.locationId ||
              current.targetDate !== routeState.targetDate
            ) {
              return current;
            }

            const merged = mergeKellyStreamPatches(
              current,
              message.markets,
              routeState.riskMode,
              routeState.minEdge,
              message.frames,
            );

          return {
            ...merged,
            generatedAt: message.generatedAt,
            streamHealth: {
              state: "connected",
              reasonCode: "ws_connected",
              message: "已收到实时盘口更新。",
              lastSignalAt: message.lastSignalAt ?? current.streamHealth.lastSignalAt,
              lastRepricedAt: message.lastRepricedAt ?? current.streamHealth.lastRepricedAt,
            },
            freshness: {
              ...merged.freshness,
              orderbookFetchedAt: message.lastRepricedAt ?? merged.freshness.orderbookFetchedAt,
              repricedAt: message.lastRepricedAt ?? merged.freshness.repricedAt,
              lastStreamEventAt: message.lastSignalAt ?? message.generatedAt,
              marketMotionState: "live",
            },
            sourceStatus: merged.sourceStatus.map((status) =>
              status.kind === "stream"
                ? {
                    ...status,
                    state: "fresh",
                    detail: "已收到实时盘口更新。",
                    updatedAt: message.generatedAt,
                  }
                : status,
            ),
            } satisfies KellyWorkbenchResponse;
          });
        });
      } catch {
        startTransition(() => {
          applyStatusMessage({
          type: "status",
          generatedAt: new Date().toISOString(),
          state: "degraded",
          reasonCode: "upstream_error",
          message: "实时流返回了无法解析的消息，当前等待后端恢复。",
          });
        });
      }
    };

    socket.onclose = () => {
      if (kellySocketRef.current !== socket) {
        return;
      }

      scheduleReconnect({
        type: "status",
        generatedAt: new Date().toISOString(),
        state: "degraded",
        reasonCode: "ws_error",
        message: "实时流连接中断，正在自动重连。",
        lastSignalAt: kellySnapshot.streamHealth.lastSignalAt,
        lastRepricedAt: kellySnapshot.streamHealth.lastRepricedAt,
      });
    };

    socket.onerror = () => {
      if (kellySocketRef.current !== socket) {
        return;
      }

      scheduleReconnect(
        {
          type: "status",
          generatedAt: new Date().toISOString(),
          state: "degraded",
          reasonCode: "ws_error",
          message: "实时流异常，正在自动重连；当前若需要会继续回退到轮询。",
          lastSignalAt: kellySnapshot.streamHealth.lastSignalAt,
          lastRepricedAt: kellySnapshot.streamHealth.lastRepricedAt,
        },
        true,
      );
    };

    return () => {
      intentionalClose = true;
      clearKellySocketReconnectTimer();
      detachKellySocketHandlers(socket);
      socket.close();
      if (kellySocketRef.current === socket) {
        kellySocketRef.current = null;
      }
      if (kellySocketSuppressedRef.current === socket) {
        kellySocketSuppressedRef.current = null;
      }
    };
  }, [
    kellyRefreshNonce,
    kellySnapshot?.location.id,
    kellySnapshot?.targetDate,
    kellySocketReconnectNonce,
    routeState.kellyActualTemperatureC,
    routeState.bankroll,
    routeState.locationId,
    routeState.minEdge,
    routeState.path,
    routeState.riskMode,
    routeState.selectedHourlyTimestamp,
    routeState.targetDate,
  ]);

  const latestInsightForCurrentLocation = pickAlignedAnalysisEnvelope<InsightViewModel>(
    latestInsightEnvelope,
    routeState.locationId,
  );
  const latestDistributionForCurrentLocation = pickAlignedAnalysisEnvelope<DistributionViewModel>(
    latestDistributionEnvelope,
    routeState.locationId,
  );
  const homepageInsight =
    latestInsightForCurrentLocation?.data ??
    (insight?.location.id === routeState.locationId ? insight : null);
  const homepageDistribution =
    latestDistributionForCurrentLocation?.data ??
    (distribution?.location.id === routeState.locationId ? distribution : null);
  const requestedAnalysisTimestamp =
    routeState.selectedInsightTimestamp ?? latestInsightForCurrentLocation?.selectedTimestamp ?? null;
  const currentAnalysisKey = buildAnalysisBatchKey(routeState.locationId, requestedAnalysisTimestamp);
  const latestInsightForCurrentBatch =
    latestInsightForCurrentLocation &&
    (!requestedAnalysisTimestamp || latestInsightForCurrentLocation.selectedTimestamp === requestedAnalysisTimestamp)
      ? latestInsightForCurrentLocation
      : null;
  const latestDistributionForCurrentBatch =
    latestDistributionForCurrentLocation &&
    (!requestedAnalysisTimestamp ||
      latestDistributionForCurrentLocation.selectedTimestamp === requestedAnalysisTimestamp)
      ? latestDistributionForCurrentLocation
      : null;
  const latestInsightMatchesCurrentBatch = Boolean(
    latestInsightForCurrentBatch &&
      currentAnalysisKey &&
      latestInsightForCurrentBatch.key === currentAnalysisKey,
  );
  const latestDistributionMatchesCurrentBatch = Boolean(
    latestDistributionForCurrentBatch &&
      currentAnalysisKey &&
      latestDistributionForCurrentBatch.key === currentAnalysisKey,
  );
  const analysisSnapshotForLocation =
    analysisSnapshot && analysisSnapshot.locationId === routeState.locationId ? analysisSnapshot : null;
  const analysisSnapshotWhileTransitioning =
    isAnalysis &&
    analysisSnapshot?.locationId === routeState.locationId &&
    (isLocationTransitionPending || loadingInsight || loadingDistribution || manualAnalysisRefreshPending)
      ? analysisSnapshot
      : null;
  const displayedAnalysisSnapshot = analysisSnapshotForLocation ?? analysisSnapshotWhileTransitioning;
  const homepageStableAnalysisSnapshot =
    latestInsightForCurrentLocation &&
    latestDistributionForCurrentLocation &&
    latestInsightForCurrentLocation.key === latestDistributionForCurrentLocation.key
      ? {
          insight: latestInsightForCurrentLocation.data,
          distribution: latestDistributionForCurrentLocation.data,
        }
      : analysisSnapshotForLocation;
  const homepageCommittedInsight = homepageStableAnalysisSnapshot?.insight ?? null;
  const homepageCommittedDistribution = homepageStableAnalysisSnapshot?.distribution ?? null;
  const lastConsistentAnalysisKeyForLocation = lastConsistentAnalysisKey?.startsWith(`${routeState.locationId}::`)
    ? lastConsistentAnalysisKey
    : null;
  const effectiveLastConsistentAnalysisKey = analysisLocationCommitPending
    ? null
    : displayedAnalysisSnapshot?.key ?? lastConsistentAnalysisKeyForLocation;
  const displayedAnalysisInsight = isAnalysis
    ? analysisLocationCommitPending
      ? null
      : latestInsightMatchesCurrentBatch
      ? latestInsightForCurrentBatch?.data ?? null
      : displayedAnalysisSnapshot?.insight ?? null
    : insight;
  const displayedAnalysisDistribution = isAnalysis
    ? analysisLocationCommitPending
      ? null
      : latestDistributionMatchesCurrentBatch
      ? latestDistributionForCurrentBatch?.data ?? null
      : displayedAnalysisSnapshot?.distribution ?? null
    : distribution;
  const hasRenderableAnalysisData = Boolean(displayedAnalysisInsight || displayedAnalysisDistribution);
  const analysisPageLoading =
    isAnalysis &&
    routeState.tab === "models" &&
    (loadingInsight || loadingDistribution || manualAnalysisRefreshPending) &&
    !hasRenderableAnalysisData &&
    !insightError &&
    !distributionError;
  const analysisAvailabilityStatus =
    insightError || distributionError
      ? "fallback_error"
      : analysisLocationCommitPending || analysisPageLoading || loadingInsight || loadingDistribution || manualAnalysisRefreshPending
        ? "revalidating"
        : hasRenderableAnalysisData
          ? "ready"
          : "unavailable";
  const effectiveModelTimestamp =
    requestedAnalysisTimestamp ?? displayedAnalysisDistribution?.selectedTimestamp ?? null;
  const dashboardDefaultSelectedTimestamp = dashboard
    ? pickSelectedTimestamp(dashboard.hourly.items, null)
    : null;
  const shouldSuppressRequestedTimestampFallbackWarning = Boolean(
    dashboard?.hourly.location.id === routeState.locationId &&
      dashboardDefaultSelectedTimestamp &&
      referenceTemperatureMode === "default" &&
      routeState.selectedInsightTimestamp === dashboardDefaultSelectedTimestamp &&
      routeState.selectedHourlyTimestamp === dashboardDefaultSelectedTimestamp,
  );

  const translatedWarnings = collectDisplayWarnings({
    dashboardWarnings: dashboard?.hourly.warnings,
    reportWarnings: report?.warnings,
    insightWarnings: isAnalysis ? displayedAnalysisInsight?.warnings : insight?.warnings,
    distributionWarnings: isAnalysis ? displayedAnalysisDistribution?.warnings : distribution?.warnings,
    suppressRequestedTimestampFallback: shouldSuppressRequestedTimestampFallbackWarning,
  });
  const homepageWarnings = collectHomeDisplayWarnings({
    dashboardWarnings: dashboard?.hourly.warnings,
    reportWarnings: report?.warnings,
    insightWarnings: homepageCommittedInsight?.warnings,
    distributionWarnings: homepageCommittedDistribution?.warnings,
    suppressRequestedTimestampFallback: shouldSuppressRequestedTimestampFallbackWarning,
  });
  const activeLocationTimezone =
    dashboard?.locationDirectory.find((location) => location.id === displayedLocationId)?.timezone ??
    dashboardWarmCacheRef.current.get(displayedLocationId)?.data.locationDirectory.find((location) => location.id === displayedLocationId)?.timezone ??
    homepageInsight?.location.timezone ??
    homepageDistribution?.location.timezone ??
    dashboard?.hourly.locationTimezone ??
    undefined;

  const homeViewModel = useMemo(
    () =>
      buildHomeViewModel({
        dashboard,
        reportText,
        items,
        currentItem: currentHourItem,
        selectedItem,
        insight: homepageInsight,
      }),
    [currentHourItem, dashboard, homepageInsight, items, reportText, selectedItem],
  );

  const locations = useMemo(
    () =>
      buildDockLocations(
        dashboard?.locationDirectory ?? [],
        displayedLocationId,
        locationTemperatures,
        favoriteLocationIds,
      ),
    [dashboard?.locationDirectory, displayedLocationId, favoriteLocationIds, locationTemperatures],
  );
  const locationGroups = useMemo(() => buildDockLocationGroups(locations), [locations]);
  const displayedLocation = locations.find((location) => location.id === displayedLocationId) ?? null;
  const pendingLocation =
    (locationTransitionState.pendingLocationId
      ? locations.find((location) => location.id === locationTransitionState.pendingLocationId) ?? null
      : null) ??
    null;
  const pendingLocationName = pendingLocation?.displayName ?? null;
  const headerLocationName =
    currentPage === "kelly"
      ? (kellySnapshot?.location.name ?? displayedLocation?.displayName ?? homeViewModel.locationName)
      : (displayedLocation?.displayName ?? homeViewModel.locationName);
  const headerLocationShortName =
    displayedLocation?.cityName ?? displayedLocation?.displayNameZh ?? displayedLocation?.displayName ?? homeViewModel.locationName;
  const headerLocationCode = displayedLocation?.code ?? null;

  const hasCommittedSnapshot = Boolean(dashboard);
  const showDashboardWarning = hasCommittedSnapshot && Boolean(dashboardError);
  const showDashboardFallback = !hasCommittedSnapshot && Boolean(dashboardError);
  const showDashboardBootstrap = !hasCommittedSnapshot && !showDashboardFallback;
  const workspaceMuted = isLocationTransitionPending && !hasCommittedSnapshot;
  const kellyRefreshDisabled = !routeState.targetDate || manualRefreshingKelly || isLocationTransitionPending;
  const headerRefreshState = isKelly
    ? manualRefreshingKelly || isLocationTransitionPending
      ? "pending"
      : "idle"
    : refreshState;
  const headerRefreshDisabled = isKelly
    ? kellyRefreshDisabled
    : isLocationTransitionPending || refreshState === "pending";
  const headerSyncState =
    dashboardError && dashboard?.sync.state === "fallback_error"
      ? "fallback_error"
      : "fresh";
  const closeRail = () => collapseRail("dismiss");
  const toggleRail = () => toggleRailVisibility();
  const openRail = () => expandRail();
  const handleShellNavigation = (path: AppPath) => {
    collapseRail("programmatic");
    updateRouteState(
      (current) => ({
        ...current,
        path,
      }),
      "push",
    );
  };
  const handleRailLocationSelect = (id: string) => {
    void transitionToLocation(id, "push");
  };
  const peakSummary = displayedAnalysisInsight
    ? buildPeakSummary(displayedAnalysisInsight.peakTimeDistribution, activeLocationTimezone)
    : UI_TEXT.analysis.peakSummaryLoading;
  const homepageInsightCard = hasCommittedSnapshot && dashboard ? (
    <InsightCard
      insight={homepageInsight}
      loading={loadingInsight}
      error={insightError}
      displayUnit={insightDisplayUnit}
      locationTimezone={activeLocationTimezone}
      selectedWeatherTimestamp={routeState.selectedHourlyTimestamp}
      selectedModelTimestamp={effectiveModelTimestamp}
      actualTemperatureC={routeState.actualTemperatureC}
      manualTemperatureText={manualTemperatureText}
      referenceMode={referenceTemperatureMode}
      onSelectTimestamp={(value) =>
        updateRouteState((current) => {
          const nextSelectedTimestamp = value ?? current.selectedInsightTimestamp ?? current.selectedHourlyTimestamp;
          const nextActualTemperature =
            referenceTemperatureMode === "default"
              ? resolveDefaultReferenceTemperature(dashboardRef.current, nextSelectedTimestamp)
              : current.actualTemperatureC;

          return {
            ...current,
            selectedInsightTimestamp: nextSelectedTimestamp,
            selectedHourlyTimestamp: nextSelectedTimestamp,
            actualTemperatureC: nextActualTemperature,
          };
        })
      }
      onTemperatureChange={(value) => {
        setReferenceTemperatureMode("manual");
        setManualTemperatureText(value);
        const parsed = Number.parseFloat(value);
        updateRouteState((current) => ({
          ...current,
          actualTemperatureC: Number.isFinite(parsed) ? convertTemperatureToC(parsed, insightDisplayUnit) : null,
        }));
      }}
      onResetTemperature={() => {
        setReferenceTemperatureMode("default");
        setManualTemperatureText(formatTemperatureInputValue(defaultReferenceTemperature, insightDisplayUnit));
        updateRouteState((current) => ({
          ...current,
          actualTemperatureC: defaultReferenceTemperature,
        }));
      }}
      onOpenDetails={() =>
        updateRouteState(
          (current) => ({
            ...current,
            path: "/analysis",
            tab: "models",
          }),
          "push",
        )
      }
      mobileSummary={isMobileLayout}
    />
  ) : null;
  const homepageReferenceCard = hasCommittedSnapshot && dashboard ? (
    <HomeReferenceCard
      hourly={dashboard.hourly}
      metar={dashboard.metar}
      taf={dashboard.taf}
      report={dashboard.report}
      multimodel={dashboard.multimodel}
      insight={homepageCommittedInsight}
      sourceMetadata={dashboard.sourceMetadata}
      pageUrl={dashboard.hourly.pageUrl}
      displayUnit={dashboard.displayUnit ?? activeDisplayUnit}
      locationTimezone={activeLocationTimezone}
      mobileSummary={isMobileLayout}
    />
  ) : null;
  const homepageWarningLines =
    homepageWarnings.length > 0 ? <WarningLines items={homepageWarnings.slice(0, 2)} /> : null;
  const desktopHomepageSupportContent = (
    <>
      {homepageInsightCard}
      {homepageReferenceCard}
      {homepageWarningLines}
    </>
  );
  const mobileHomepageSupportContent = (
    <>
      {homepageReferenceCard}
      {homepageWarningLines}
      {homepageInsightCard}
    </>
  );

  return (
    <div
      className={`weather-shell ${desktopRailExpanded ? "weather-shell-rail-open" : ""} ${currentPage === "analysis" ? "weather-shell-analysis" : currentPage === "kelly" ? "weather-shell-kelly" : "weather-shell-home"}`}
      data-page={currentPage}
      data-mobile-layout={isMobileLayout ? "true" : "false"}
    >
      <TerminalBackdrop />

      <CommandHeader
        locationName={headerLocationName}
        locationShortName={headerLocationShortName}
        locationCode={headerLocationCode}
        pendingLocationName={pendingLocationName}
        transitioning={isLocationTransitionPending}
        locationTimezone={activeLocationTimezone}
        updatedAt={dashboard?.sync.updatedAt ?? null}
        syncState={headerSyncState}
        refreshState={headerRefreshState}
        refreshDisabled={headerRefreshDisabled}
        currentPage={currentPage}
        mobile={isMobileLayout}
        railExpanded={railExpanded}
        onToggleRail={toggleRail}
        onOpenRail={openRail}
        mobileLocationTriggerRef={mobileRailTriggerRef}
        onRefresh={() => {
          if (isKelly) {
            applyKellyDraftControls();
            return;
          }

          void refreshDashboard(true, routeState.locationId);
        }}
        onNavigateHome={() => handleShellNavigation("/")}
        onNavigateAnalysis={() => handleShellNavigation("/analysis")}
        onNavigateKelly={() => handleShellNavigation("/kelly")}
      />

      {showDashboardWarning && dashboardError ? <WarningLines items={[dashboardError]} /> : null}

      {showDashboardFallback && dashboardError ? (
        <section className="terminal-panel flex flex-1 items-center justify-center px-6 py-10">
          <div className="panel-section max-w-2xl text-center">
            <div className="eyebrow">首屏快照暂时不可用</div>
            <div className="mt-3 text-3xl font-semibold text-white">决策台还没有拿到可展示的数据。</div>
            <p className="mt-3 text-sm leading-6 text-white/70">{dashboardError}</p>
            <p className="mt-2 text-sm leading-6 text-white/52">
              可以直接点右上角刷新重试；一旦首屏快照恢复，首页和工作区会继续按当前地点正常加载。
            </p>
            <button
              type="button"
              className="mt-6 inline-flex items-center justify-center rounded-full border border-white/18 bg-white/8 px-5 py-2 text-sm font-medium text-white transition hover:border-white/28 hover:bg-white/12"
              onClick={() => {
                void refreshDashboard(true, routeState.locationId);
              }}
            >
              立即重试
            </button>
          </div>
        </section>
      ) : null}

      {showDashboardBootstrap ? (
        <section className="terminal-panel flex flex-1 items-center justify-center px-6 py-10">
          <div className="panel-section max-w-2xl text-center">
            <div className="eyebrow">{UI_TEXT.app.loadingEyebrow}</div>
            <div className="mt-3 text-3xl font-semibold text-white">{UI_TEXT.app.loadingTitle}</div>
            <div className="mt-3 text-sm text-white/56">{UI_TEXT.app.loadingDescription}</div>
            <p className="mt-4 text-sm leading-6 text-white/52">
              首次打开如果还在接入数据，顶部导航仍可操作，也可以直接重试当前地点。
            </p>
            <button
              type="button"
              className="mt-6 inline-flex items-center justify-center rounded-full border border-white/18 bg-white/8 px-5 py-2 text-sm font-medium text-white transition hover:border-white/28 hover:bg-white/12"
              onClick={() => {
                void refreshDashboard(true, routeState.locationId);
              }}
            >
              立即重试
            </button>
          </div>
        </section>
      ) : null}

      {hasCommittedSnapshot && dashboard ? (
        <div className={`${isAnalysis ? "analysis-layout-shell" : "terminal-layout"} workspace-stage`}>
          <LocationRail
            mobile={isMobileLayout}
            expanded={railExpanded}
            activeId={displayedLocationId}
            pendingId={locationTransitionState.pendingLocationId}
            activeGroup={activeTimezoneGroup}
            groups={locationGroups}
            favoritePendingIds={favoritePendingIds}
            favoriteError={favoritesError}
            onGroupChange={(group) => {
              setBrowsingTimezoneGroup(group);
            }}
            onSelect={handleRailLocationSelect}
            onToggleFavorite={(id) => void toggleFavorite(id)}
            onDismiss={closeRail}
            onExpand={openRail}
            returnFocusRef={mobileRailTriggerRef}
            restoreFocusOnCloseRef={mobileRailFocusRestoreRef}
          />

          {isAnalysis ? (
            <div className={`workspace-shell workspace-shell-analysis-stage ${workspaceMuted ? "workspace-shell-muted" : ""}`}>
              <Suspense
                fallback={
                  <RouteSurfaceFallback
                    title="分析工作区加载中..."
                    detail="正在按需加载模型与图像工作面。"
                  />
                }
              >
                <LazyAnalysisWorkspace
                  tab={analysisTab}
                  insight={displayedAnalysisInsight}
                  distribution={displayedAnalysisDistribution}
                  dashboard={dashboard}
                  mobileLayout={isMobileLayout}
                  displayUnit={
                    displayedAnalysisInsight?.displayUnit ??
                    displayedAnalysisDistribution?.displayUnit ??
                    activeDisplayUnit
                  }
                  locationTimezone={activeLocationTimezone}
                  selectedWeatherTimestamp={routeState.selectedHourlyTimestamp}
                  selectedModelTimestamp={effectiveModelTimestamp}
                  analysisStatus={analysisAvailabilityStatus}
                  imageStatus={imageAvailabilityStatus}
                  imageUrl={imageUrl}
                  imageUpdatedAt={imageUpdatedAt}
                  loadingInsight={loadingInsight}
                  loadingDistribution={loadingDistribution}
                  insightError={insightError}
                  distributionError={distributionError}
                  actualTemperatureC={routeState.actualTemperatureC}
                  warnings={translatedWarnings}
                  peakSummary={peakSummary}
                  analysisKey={analysisLocationCommitPending ? null : currentAnalysisKey}
                  lastConsistentAnalysisKey={effectiveLastConsistentAnalysisKey}
                  analysisRefreshing={manualAnalysisRefreshPending}
                  pageLoading={analysisPageLoading}
                  onTabChange={(tabValue) => {
                    setAnalysisTab(tabValue);
                    updateRouteState(
                      (current) => ({
                        ...current,
                        path: "/analysis",
                        tab: tabValue,
                      }),
                      "push",
                    );
                  }}
                />
              </Suspense>
            </div>
          ) : isKelly ? (
            <div className={`workspace-shell workspace-shell-kelly-stage ${workspaceMuted ? "workspace-shell-muted" : ""}`}>
              <Suspense
                fallback={
                  <RouteSurfaceFallback
                    title="Kelly 实验台加载中..."
                    detail="正在按需加载盘口决策工作面。"
                  />
                }
              >
                <LazyKellyWorkbench
                  snapshot={kellySnapshot}
                  sourceMetadata={dashboard.sourceMetadata}
                  intradaySignals={dashboard.intradaySignals}
                  marketReference={dashboard.marketReference}
                  locations={dashboard.locationDirectory}
                  activeLocationId={routeState.locationId}
                  timezone={activeLocationTimezone}
                  bankrollInput={kellyDraftControls.bankrollInput}
                  riskMode={kellyDraftControls.riskMode}
                  minEdgeInput={kellyDraftControls.minEdgeInput}
                  actualTemperatureText={kellyDraftControls.actualTemperatureText}
                  draftDirty={kellyDraftDirty}
                  fieldErrors={kellyFieldErrors}
                  loading={loadingKelly}
                  refreshing={manualRefreshingKelly}
                  refreshDisabled={kellyRefreshDisabled}
                  error={kellyError}
                  streamState={kellyStreamState}
                  onLocationChange={(locationId) => {
                    void transitionToLocation(locationId, "push");
                  }}
                  onTargetDateChange={(targetDate) =>
                    updateRouteState(
                      (current) => ({
                        ...current,
                        targetDate,
                      }),
                      "push",
                    )
                  }
                  onBankrollChange={(value) => {
                    setKellyFieldErrors((current) => ({ ...current, bankroll: null }));
                    setKellyDraftControls((current) => ({
                      ...current,
                      bankrollInput: value,
                    }));
                  }}
                  onRiskModeChange={(nextRiskMode) =>
                    setKellyDraftControls((current) => ({
                      ...current,
                      riskMode: nextRiskMode,
                    }))
                  }
                  onMinEdgeChange={(value) => {
                    setKellyFieldErrors((current) => ({ ...current, minEdge: null }));
                    setKellyDraftControls((current) => ({
                      ...current,
                      minEdgeInput: value,
                    }));
                  }}
                  onActualTemperatureChange={(value) => {
                    setKellyFieldErrors((current) => ({ ...current, actualTemperature: null }));
                    setKellyDraftControls((current) => ({
                      ...current,
                      actualTemperatureText: value,
                    }));
                  }}
                  onRefresh={applyKellyDraftControls}
                />
              </Suspense>
            </div>
          ) : (
            <div className={`home-shell ${workspaceMuted ? "workspace-shell-muted" : ""}`}>
              <Suspense
                fallback={
                  <RouteSurfaceFallback
                    title="首页决策台加载中..."
                    detail="正在按需加载当前地点的首页工作面。"
                  />
                }
              >
                <LazyWeatherOverview
                  pageUrl={dashboard.hourly.pageUrl}
                  reportText={toDecisionSummaryText(homeViewModel.summaryText)}
                  items={homeViewModel.items}
                  metar={dashboard.metar}
                  taf={dashboard.taf}
                  displayUnit={dashboard.displayUnit ?? activeDisplayUnit}
                  locationTimezone={activeLocationTimezone}
                  selectedTimestamp={routeState.selectedHourlyTimestamp}
                  onSelectTimestamp={(timestamp) =>
                    updateRouteState((current) => ({
                      ...current,
                      selectedHourlyTimestamp: timestamp,
                      selectedInsightTimestamp: timestamp,
                    }))
                  }
                  currentItem={homeViewModel.currentItem}
                  selectedItem={homeViewModel.selectedItem}
                  intradaySignals={dashboard.intradaySignals}
                  marketReference={dashboard.marketReference}
                  predictabilityScore={dashboard.report.metrics.predictabilityScore ?? null}
                  predictabilityLabel={dashboard.report.metrics.predictability}
                />
              </Suspense>

              <aside className="home-support-column home-quick-insight-column analysis-column scrollbar-terminal overflow-visible pr-1 2xl:overflow-y-auto">
                {isMobileLayout ? mobileHomepageSupportContent : desktopHomepageSupportContent}
              </aside>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
