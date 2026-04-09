import { lazy, startTransition, Suspense, useEffect, useMemo, useRef, useState } from "react";

import { getErrorMessage, weatherApi } from "./api";
import { CommandHeader } from "./components/CommandHeader";
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
import type { DockTimezoneGroup, KellyRiskMode, KellyStreamMessage, KellyWorkbenchResponse } from "./types";

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
type WarmCacheEntry<T> = {
  cachedAt: number;
  data: T;
};
type LocationTransitionState = {
  pendingLocationId: string | null;
  stage: "idle" | "dashboard" | "warming";
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
const LOCATION_PREWARM_DELAY_MS = 180;
const KELLY_DATE_WARM_DELAY_MS = 220;
const KELLY_STREAM_RECONNECT_BASE_MS = 1_500;
const KELLY_STREAM_RECONNECT_MAX_MS = 12_000;

const parseNumber = (value: string | null) => {
  if (!value) {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatKellyMinEdgeInput = (minEdge: number) => (minEdge * 100).toFixed(1);

const buildKellyDraftFromRoute = (state: Pick<RouteState, "bankroll" | "minEdge" | "riskMode" | "actualTemperatureC">): KellyDraftControls => ({
  bankrollInput: String(state.bankroll),
  minEdgeInput: formatKellyMinEdgeInput(state.minEdge),
  riskMode: state.riskMode,
  actualTemperatureText: state.actualTemperatureC !== null ? String(state.actualTemperatureC) : "",
});

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

  return {
    path: pathname,
    tab: url.searchParams.get("tab") === "image" ? "image" : "models",
    locationId: url.searchParams.get("locationId") ?? CONFIG.location.DEFAULT_ID,
    selectedInsightTimestamp: url.searchParams.get("timestamp"),
    actualTemperatureC: parseNumber(url.searchParams.get("actualTemperatureC")),
    selectedHourlyTimestamp: url.searchParams.get("selectedHour"),
    targetDate: url.searchParams.get("targetDate"),
    bankroll: parseNumber(url.searchParams.get("bankroll")) ?? KELLY_DEFAULT_BANKROLL,
    riskMode:
      url.searchParams.get("riskMode") === "conservative" ||
      url.searchParams.get("riskMode") === "aggressive" ||
      url.searchParams.get("riskMode") === "balanced"
        ? (url.searchParams.get("riskMode") as KellyRiskMode)
        : "balanced",
    minEdge: parseNumber(url.searchParams.get("minEdge")) ?? KELLY_DEFAULT_MIN_EDGE,
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

  if (state.actualTemperatureC !== null) {
    url.searchParams.set("actualTemperatureC", String(state.actualTemperatureC));
  }

  if (state.selectedHourlyTimestamp) {
    url.searchParams.set("selectedHour", state.selectedHourlyTimestamp);
  }

  if (state.path === "/kelly") {
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
  insightTimestamp: string | null,
) => {
  const items = dashboard?.hourly.items ?? [];

  if (insightTimestamp) {
    const exact = items.find((item) => item.timestamp === insightTimestamp && typeof item.temperatureC === "number");
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

const resolveTodayForTimezone = (timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const DEFAULT_ACTIVE_TIMEZONE_GROUP: TimezoneGroup = "asia";

const buildAnalysisBatchKey = (
  locationId: string | null | undefined,
  selectedTimestamp: string | null | undefined,
  generatedAt: string | null | undefined,
) => {
  if (!locationId || !selectedTimestamp || !generatedAt) {
    return null;
  }

  return `${locationId}::${selectedTimestamp}::${generatedAt}`;
};

const WARM_CACHE_TTL_MS = 60_000;
const KELLY_WARM_CACHE_TTL_MS = 60_000;
const LOCATION_TEMPERATURE_TTL_MS = 15 * 60_000;
const LOCATION_TEMPERATURE_CONCURRENCY = 3;

const normalizeNumberKeyPart = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "auto";

const buildInsightWarmKey = (
  locationId: string,
  selectedTimestamp: string | null,
  actualTemperatureC: number | null,
) => `${locationId}::${selectedTimestamp ?? "latest"}::${normalizeNumberKeyPart(actualTemperatureC)}`;

const buildDistributionWarmKey = (locationId: string, selectedTimestamp: string | null) =>
  `${locationId}::${selectedTimestamp ?? "latest"}`;

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

const readWarmCacheAge = <T,>(cache: Map<string, WarmCacheEntry<T>>, key: string) => {
  const entry = cache.get(key);
  if (!entry) {
    return Number.POSITIVE_INFINITY;
  }

  return Date.now() - entry.cachedAt;
};

const writeWarmCacheEntry = <T,>(cache: Map<string, WarmCacheEntry<T>>, key: string, data: T) => {
  cache.set(key, {
    cachedAt: Date.now(),
    data,
  });

  return data;
};

const resolveTimezoneGroupForLocation = (
  locationDirectory: DashboardViewModel["locationDirectory"] | undefined,
  locationId: string,
): TimezoneGroup | null =>
  (locationDirectory?.find((location) => location.id === locationId)?.timezoneGroup as TimezoneGroup | undefined) ?? null;

const buildWarmLocationTargets = (path: AppPath, tab: AnalysisWorkspaceState["tab"]): WarmLocationTargets => {
  if (path === "/kelly") {
    return {
      home: true,
      analysis: true,
      kelly: false,
      image: true,
    };
  }

  if (path === "/analysis") {
    return {
      home: true,
      analysis: tab === "image",
      kelly: true,
      image: tab === "models",
    };
  }

  return {
    home: false,
    analysis: true,
    kelly: true,
    image: true,
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
    actualTemperatureC: routeState.actualTemperatureC,
  }));
  const [kellyDraftControls, setKellyDraftControls] = useState(() => buildKellyDraftFromRoute(routeState));

  const [railExpanded, setRailExpanded] = useState(false);
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
  const [lastConsistentAnalysisKey, setLastConsistentAnalysisKey] = useState<string | null>(null);
  const [analysisSnapshot, setAnalysisSnapshot] = useState<{
    key: string;
    locationId: string;
    insight: InsightViewModel;
    distribution: DistributionViewModel;
  } | null>(null);
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
  const lastDashboardRefreshAtRef = useRef(0);
  const locationTransitionInFlightRef = useRef(false);
  const locationTransitionSeqRef = useRef(0);
  const dashboardRequestSeqRef = useRef(0);
  const railScrollLockYRef = useRef(0);
  const dashboardAbortRef = useRef<AbortController | null>(null);
  const insightAbortRef = useRef<AbortController | null>(null);
  const distributionAbortRef = useRef<AbortController | null>(null);
  const kellyAbortRef = useRef<AbortController | null>(null);
  const warmAbortRef = useRef<AbortController | null>(null);
  const kellyDateWarmAbortRef = useRef<AbortController | null>(null);
  const kellyRequestSeqRef = useRef(0);
  const kellySocketRef = useRef<WebSocket | null>(null);
  const kellySocketReconnectTimerRef = useRef<number | null>(null);
  const kellySocketRetryCountRef = useRef(0);
  const dashboardWarmCacheRef = useRef<Map<string, WarmCacheEntry<DashboardViewModel>>>(
    new Map<string, WarmCacheEntry<DashboardViewModel>>(),
  );
  const insightWarmCacheRef = useRef<Map<string, WarmCacheEntry<InsightViewModel>>>(
    new Map<string, WarmCacheEntry<InsightViewModel>>(),
  );
  const distributionWarmCacheRef = useRef<Map<string, WarmCacheEntry<DistributionViewModel>>>(
    new Map<string, WarmCacheEntry<DistributionViewModel>>(),
  );
  const insightInFlightRef = useRef<Map<string, Promise<InsightViewModel>>>(new Map<string, Promise<InsightViewModel>>());
  const distributionInFlightRef = useRef<Map<string, Promise<DistributionViewModel | null>>>(
    new Map<string, Promise<DistributionViewModel | null>>(),
  );
  const kellyWarmCacheRef = useRef<Map<string, WarmCacheEntry<KellyWorkbenchResponse>>>(
    new Map<string, WarmCacheEntry<KellyWorkbenchResponse>>(),
  );
  const kellyInFlightRef = useRef<Map<string, Promise<KellyWorkbenchResponse>>>(
    new Map<string, Promise<KellyWorkbenchResponse>>(),
  );
  const locationTemperatureWarmCacheRef = useRef<Map<string, WarmCacheEntry<number | null>>>(
    new Map<string, WarmCacheEntry<number | null>>(),
  );
  const displayedLocationId = routeState.locationId;
  const currentLocationTimezoneGroup =
    resolveTimezoneGroupForLocation(dashboard?.locationDirectory, displayedLocationId) ??
    resolveTimezoneGroupForLocation(
      dashboardWarmCacheRef.current.get(displayedLocationId)?.data.locationDirectory,
      displayedLocationId,
    );
  const activeTimezoneGroup = browsingTimezoneGroup ?? currentLocationTimezoneGroup ?? DEFAULT_ACTIVE_TIMEZONE_GROUP;

  const clearKellySocketReconnectTimer = () => {
    if (kellySocketReconnectTimerRef.current !== null) {
      window.clearTimeout(kellySocketReconnectTimerRef.current);
      kellySocketReconnectTimerRef.current = null;
    }
  };

  const resetKellySocketRuntime = () => {
    clearKellySocketReconnectTimer();
    kellySocketRetryCountRef.current = 0;
  };

  useEffect(() => {
    const onPopState = () => {
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
        actualTemperatureC: next.actualTemperatureC,
      });
      setKellyDraftControls(buildKellyDraftFromRoute(next));
      setKellyFieldErrors({});
      setReferenceTemperatureMode(next.actualTemperatureC !== null ? "manual" : "default");
      setManualTemperatureText(next.actualTemperatureC !== null ? String(next.actualTemperatureC) : "");
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!railExpanded) {
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
      window.scrollTo({ top: railScrollLockYRef.current, behavior: "auto" });
    };
  }, [railExpanded]);

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
      actualTemperatureC: routeState.actualTemperatureC,
    });
    setKellyDraftControls(buildKellyDraftFromRoute(routeState));
    setKellyFieldErrors({});
  }, [routeState.actualTemperatureC, routeState.bankroll, routeState.minEdge, routeState.riskMode]);

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
    const response = await weatherApi.fetchDashboard("1h", 24, locationId, { signal });
    return mapDashboardResponse(response);
  };

  const fetchInsightSnapshot = async ({
    locationId,
    selectedTimestamp,
    actualTemperatureC,
    signal,
  }: {
    locationId: string;
    selectedTimestamp: string | null;
    actualTemperatureC: number | null;
    signal: AbortSignal;
  }) => {
    const insightKey = buildInsightWarmKey(locationId, selectedTimestamp, actualTemperatureC);
    const cachedInsight = readWarmCacheEntry<InsightViewModel>(insightWarmCacheRef.current, insightKey);
    if (cachedInsight) {
      return cachedInsight;
    }

    const inFlight = insightInFlightRef.current.get(insightKey);
    if (inFlight) {
      return await inFlight;
    }

    const request = weatherApi
      .fetchInsights(locationId, selectedTimestamp ?? undefined, actualTemperatureC ?? undefined, {
        signal,
      })
      .then((response) => writeWarmCacheEntry(insightWarmCacheRef.current, insightKey, mapInsightResponse(response)));

    insightInFlightRef.current.set(insightKey, request);

    try {
      return await request;
    } finally {
      if (insightInFlightRef.current.get(insightKey) === request) {
        insightInFlightRef.current.delete(insightKey);
      }
    }
  };

  const fetchDistributionSnapshot = async ({
    locationId,
    selectedTimestamp,
    signal,
  }: {
    locationId: string;
    selectedTimestamp: string | null;
    signal: AbortSignal;
  }) => {
    if (!selectedTimestamp) {
      return null;
    }

    const distributionKey = buildDistributionWarmKey(locationId, selectedTimestamp);
    const cachedDistribution = readWarmCacheEntry<DistributionViewModel>(distributionWarmCacheRef.current, distributionKey);
    if (cachedDistribution) {
      return cachedDistribution;
    }

    const inFlight = distributionInFlightRef.current.get(distributionKey);
    if (inFlight) {
      return await inFlight;
    }

    const request = weatherApi
      .fetchDistribution(locationId, selectedTimestamp, 1, { signal })
      .then((response) =>
        writeWarmCacheEntry(distributionWarmCacheRef.current, distributionKey, mapDistributionResponse(response)),
      );

    distributionInFlightRef.current.set(distributionKey, request);

    try {
      return await request;
    } finally {
      if (distributionInFlightRef.current.get(distributionKey) === request) {
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
    if (!bypassCache) {
      const cachedKelly = readWarmCacheEntry<KellyWorkbenchResponse>(
        kellyWarmCacheRef.current,
        kellyKey,
        KELLY_WARM_CACHE_TTL_MS,
      );
      if (cachedKelly) {
        return cachedKelly;
      }

      const inFlight = kellyInFlightRef.current.get(kellyKey);
      if (inFlight) {
        return await inFlight;
      }
    }

    const request = weatherApi
      .fetchKellyWorkbench(
        locationId,
        targetDate,
        bankroll,
        riskMode,
        minEdge,
        actualTemperatureC ?? undefined,
        selectedHour ?? undefined,
        { signal },
      )
      .then((response) =>
        writeWarmCacheEntry(kellyWarmCacheRef.current, kellyKey, compactKellySnapshotForClient(response)),
      );

    if (!bypassCache) {
      kellyInFlightRef.current.set(kellyKey, request);
    }

    try {
      return await request;
    } finally {
      if (!bypassCache && kellyInFlightRef.current.get(kellyKey) === request) {
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

    const insightKey =
      nextInsight ? buildAnalysisBatchKey(locationId, nextInsight.selectedTimestamp, generatedAt) : null;
    const distributionKey =
      nextDistribution ? buildAnalysisBatchKey(locationId, nextDistribution.selectedTimestamp, generatedAt) : null;

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
      setAnalysisSnapshot({
        key: insightKey,
        locationId,
        insight: nextInsight,
        distribution: nextDistribution,
      });
      setLastConsistentAnalysisKey(insightKey);
      return;
    }

    setAnalysisSnapshot(null);
    setLastConsistentAnalysisKey(null);
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
  }: {
    locationId: string;
    selectedTimestamp: string | null;
    actualTemperatureC: number | null;
    targetDate: string;
    bankroll: number;
    riskMode: KellyRiskMode;
    minEdge: number;
    targets: WarmLocationTargets;
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
        }),
      );
    }

    if (targets.analysis && selectedTimestamp !== null) {
      warmTasks.push(() =>
        fetchDistributionSnapshot({
          locationId,
          selectedTimestamp,
          signal: controller.signal,
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
      setLocationTransitionState((current) =>
        current.pendingLocationId === locationId
          ? {
              pendingLocationId: null,
              stage: "idle",
            }
          : current,
      );
      return;
    }

    setLocationTransitionState({
      pendingLocationId: locationId,
      stage: "warming",
    });

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
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
        }
      }
    } finally {
      if (warmAbortRef.current === controller) {
        warmAbortRef.current = null;
      }

      setLocationTransitionState((current) =>
        current.pendingLocationId === locationId
          ? {
              pendingLocationId: null,
              stage: "idle",
            }
          : current,
      );
    }
  };

  const transitionToLocation = async (locationId: string, historyMode: "replace" | "push" = "push") => {
    if (locationId === routeState.locationId && dashboard?.hourly.location.id === locationId) {
      setRailExpanded(false);
      return;
    }

    if (locationTransitionState.pendingLocationId === locationId) {
      setRailExpanded(false);
      return;
    }

    const requestSeq = locationTransitionSeqRef.current + 1;
    locationTransitionSeqRef.current = requestSeq;
    dashboardAbortRef.current?.abort();
    const controller = new AbortController();
    dashboardAbortRef.current = controller;
    const currentPath = routeState.path;
    const currentTab = routeState.tab;

    const hydrateCurrentSurface = ({
      selectedTimestamp,
      actualTemperatureC,
      targetDate,
    }: {
      selectedTimestamp: string | null;
      actualTemperatureC: number | null;
      targetDate: string;
    }) => {
      const nextInsight = readWarmCacheEntry<InsightViewModel>(
        insightWarmCacheRef.current,
        buildInsightWarmKey(locationId, selectedTimestamp, actualTemperatureC),
      );
      const nextDistribution =
        selectedTimestamp === null
          ? null
          : readWarmCacheEntry<DistributionViewModel>(
              distributionWarmCacheRef.current,
              buildDistributionWarmKey(locationId, selectedTimestamp),
            );
      const nextKelly = readWarmCacheEntry<KellyWorkbenchResponse>(
        kellyWarmCacheRef.current,
        buildKellyWarmKey({
          locationId,
          targetDate,
          bankroll: routeState.bankroll,
          riskMode: routeState.riskMode,
          minEdge: routeState.minEdge,
          actualTemperatureC,
          selectedHour: selectedTimestamp,
        }),
        KELLY_WARM_CACHE_TTL_MS,
      );

      if (currentPath === "/analysis" && currentTab === "models") {
        return {
          nextInsight,
          nextDistribution,
          nextKelly: null,
        };
      }

      if (currentPath === "/kelly") {
        return {
          nextInsight: null,
          nextDistribution: null,
          nextKelly,
        };
      }

      if (currentPath === "/") {
        return {
          nextInsight,
          nextDistribution: null,
          nextKelly: null,
        };
      }

      return {
        nextInsight: null,
        nextDistribution: null,
        nextKelly: null,
      };
    };

    const commitLocationTransition = ({
      nextDashboard,
      selectedTimestamp,
      nextTargetDate,
      nextActualTemperature,
      nextInsight,
      nextDistribution,
      nextKelly,
    }: {
      nextDashboard: DashboardViewModel;
      selectedTimestamp: string | null;
      nextTargetDate: string;
      nextActualTemperature: number | null;
      nextInsight: InsightViewModel | null;
      nextDistribution: DistributionViewModel | null;
      nextKelly: KellyWorkbenchResponse | null;
    }) => {
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
        setKellySnapshot((current) => nextKelly ?? current);
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
          selectedInsightTimestamp: selectedTimestamp,
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
        bankroll: routeState.bankroll,
        riskMode: routeState.riskMode,
        minEdge: routeState.minEdge,
        targets: buildWarmLocationTargets(currentPath, currentTab),
      });
    };

    setRailExpanded(false);
    locationTransitionInFlightRef.current = true;
    warmAbortRef.current?.abort();
    kellyDateWarmAbortRef.current?.abort();
    kellyAbortRef.current?.abort();
    kellySocketRef.current?.close();
    kellySocketRef.current = null;
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
    setLoadingDashboard(!dashboard);
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

    const cachedDashboard = readWarmCacheEntry<DashboardViewModel>(dashboardWarmCacheRef.current, locationId);
    if (cachedDashboard) {
      const cachedSelectedHour = pickSelectedTimestamp(cachedDashboard.hourly.items, null);
      const cachedTargetDate = resolveTodayForTimezone(cachedDashboard.hourly.locationTimezone);
      const cachedActualTemperature = resolveDefaultReferenceTemperature(cachedDashboard, cachedSelectedHour);
      const primed = hydrateCurrentSurface({
        selectedTimestamp: cachedSelectedHour,
        actualTemperatureC: cachedActualTemperature,
        targetDate: cachedTargetDate,
      });
      if (requestSeq !== locationTransitionSeqRef.current) {
        return;
      }

      commitLocationTransition({
        nextDashboard: cachedDashboard,
        selectedTimestamp: cachedSelectedHour,
        nextTargetDate: cachedTargetDate,
        nextActualTemperature: cachedActualTemperature,
        nextInsight: primed.nextInsight,
        nextDistribution: primed.nextDistribution,
        nextKelly: primed.nextKelly,
      });
      if (dashboardAbortRef.current === controller) {
        dashboardAbortRef.current = null;
      }
      locationTransitionInFlightRef.current = false;
      setLoadingDashboard(false);
      return;
    }

    try {
      const nextDashboard = await fetchDashboardSnapshot(locationId, controller.signal);

      if (requestSeq !== locationTransitionSeqRef.current) {
        return;
      }

      const selectedTimestamp = pickSelectedTimestamp(nextDashboard.hourly.items, null);
      const nextTargetDate = resolveTodayForTimezone(nextDashboard.hourly.locationTimezone);
      const nextActualTemperature = resolveDefaultReferenceTemperature(nextDashboard, selectedTimestamp);
      const primed = hydrateCurrentSurface({
        selectedTimestamp,
        actualTemperatureC: nextActualTemperature,
        targetDate: nextTargetDate,
      });

      if (requestSeq !== locationTransitionSeqRef.current) {
        return;
      }

      commitLocationTransition({
        nextDashboard,
        selectedTimestamp,
        nextTargetDate,
        nextActualTemperature,
        nextInsight: primed.nextInsight,
        nextDistribution: primed.nextDistribution,
        nextKelly: primed.nextKelly,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      if (requestSeq === locationTransitionSeqRef.current) {
        setDashboardError(getErrorMessage(error, UI_TEXT.errors.dashboard));
        setLocationTransitionState({
          pendingLocationId: null,
          stage: "idle",
        });
      }
    } finally {
      if (requestSeq === locationTransitionSeqRef.current) {
        setLoadingDashboard(false);
      }

      if (dashboardAbortRef.current === controller) {
        dashboardAbortRef.current = null;
      }
      if (requestSeq === locationTransitionSeqRef.current) {
        locationTransitionInFlightRef.current = false;
      }
    }
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
    setKellyAppliedControls(parsed);
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
      actualTemperatureC: parsed.actualTemperatureC,
    }));
    setKellyRefreshNonce((current) => current + 1);
  };

  useEffect(
    () => () => {
      clearRefreshResetTimer();
      resetKellySocketRuntime();
      warmAbortRef.current?.abort();
      kellyDateWarmAbortRef.current?.abort();
      kellyAbortRef.current?.abort();
      kellySocketRef.current?.close();
    },
    [],
  );

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

    if (refreshInFlightRef.current && refreshInFlightLocationRef.current === locationId) {
      return;
    }

    const requestSeq = dashboardRequestSeqRef.current + 1;
    dashboardRequestSeqRef.current = requestSeq;
    refreshInFlightRef.current = true;
    refreshInFlightLocationRef.current = locationId;
    dashboardAbortRef.current?.abort();
    const controller = new AbortController();
    dashboardAbortRef.current = controller;
    setLoadingDashboard(true);
    if (manual) {
      clearRefreshResetTimer();
      setRefreshState("pending");
    }
    const startedAt = Date.now();

    try {
      const mappedDashboard = await fetchDashboardSnapshot(locationId, controller.signal);
      if (requestSeq !== dashboardRequestSeqRef.current) {
        return;
      }

      cacheDashboardSnapshot(locationId, mappedDashboard);
      setDashboardError(null);

      if (manual) {
        setCacheBust(Date.now());
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

      if (error instanceof DOMException && error.name === "AbortError") {
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
      if (dashboardAbortRef.current === controller) {
        dashboardAbortRef.current = null;
      }
      refreshInFlightRef.current = false;
      refreshInFlightLocationRef.current = null;
    }
  };

  useEffect(() => {
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

      if (locationTransitionInFlightRef.current || refreshInFlightRef.current) {
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
  }, [dashboard?.hourly.location.id, routeState.locationId, routeState.path]);

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

      if (
        nextSelectedHour === current.selectedHourlyTimestamp &&
        nextInsightTimestamp === current.selectedInsightTimestamp
      ) {
        return current;
      }

      return {
        ...current,
        selectedHourlyTimestamp: nextSelectedHour,
        selectedInsightTimestamp: nextInsightTimestamp,
      };
    });
  }, [dashboard]);

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
      targetDate: resolveTodayForTimezone(locationTimezone),
    }));
  }, [dashboard?.hourly.locationTimezone, dashboard?.locationDirectory, routeState.locationId, routeState.path, routeState.targetDate]);

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
            actualTemperatureC: routeState.actualTemperatureC,
            selectedHour: routeState.selectedHourlyTimestamp,
            signal: controller.signal,
          });
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
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
    routeState.actualTemperatureC,
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

  const effectiveInsightTimestamp = routeState.selectedInsightTimestamp ?? insight?.selectedTimestamp ?? null;
  const defaultReferenceTemperature = resolveDefaultReferenceTemperature(dashboard, effectiveInsightTimestamp);

  useEffect(() => {
    if (routeState.path === "/kelly" || referenceTemperatureMode !== "default") {
      return;
    }

    const nextText = defaultReferenceTemperature !== null ? String(defaultReferenceTemperature) : "";
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
  }, [defaultReferenceTemperature, manualTemperatureText, referenceTemperatureMode, routeState.actualTemperatureC, routeState.path]);

  useEffect(() => {
    if (!dashboard?.locationDirectory.length) {
      return;
    }

    if (loadingDashboard || locationTransitionState.stage !== "idle") {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const visibleGroup = browsingTimezoneGroup ?? activeTimezoneGroup;
    const staleLocations = dashboard.locationDirectory.filter((location) => {
      if (location.timezoneGroup !== visibleGroup) {
        return false;
      }

      return readWarmCacheAge(locationTemperatureWarmCacheRef.current, location.id) > LOCATION_TEMPERATURE_TTL_MS;
    });

    if (!staleLocations.length) {
      return;
    }

    const loadTemperatures = async () => {
      const queue = [...staleLocations];
      const workers = Array.from({ length: Math.min(LOCATION_TEMPERATURE_CONCURRENCY, queue.length) }, async () => {
        while (queue.length > 0) {
          const location = queue.shift();
          if (!location || controller.signal.aborted) {
            return;
          }

          const response = await weatherApi.fetchHourly("1h", 1, location.id, { signal: controller.signal });
          const temp = response.current?.temperatureC ?? response.items[0]?.temperatureC ?? null;
          writeWarmCacheEntry(locationTemperatureWarmCacheRef.current, location.id, temp);
        }
      });

      await Promise.allSettled(workers);

      if (cancelled) {
        return;
      }

      setLocationTemperatures((current) => {
        const next = { ...current };
        for (const location of staleLocations) {
          const entry = locationTemperatureWarmCacheRef.current.get(location.id);
          const cached =
            entry && Date.now() - entry.cachedAt <= LOCATION_TEMPERATURE_TTL_MS
              ? entry.data
              : undefined;
          if (cached !== undefined || location.id in next) {
            next[location.id] = cached ?? null;
          }
        }
        return next;
      });
    };

    void loadTemperatures();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    activeTimezoneGroup,
    browsingTimezoneGroup,
    dashboard?.locationDirectory,
    loadingDashboard,
    locationTransitionState.stage,
  ]);

  useEffect(() => {
    const dashboardAligned = dashboard?.hourly.location.id === routeState.locationId;
    if (!dashboard || !dashboardAligned || routeState.path === "/kelly") {
      setInsight(null);
      setLatestInsightEnvelope(null);
      return;
    }

    const insightKey = buildInsightWarmKey(
      routeState.locationId,
      routeState.selectedInsightTimestamp ?? null,
      routeState.actualTemperatureC ?? null,
    );
    const cachedInsight = readWarmCacheEntry<InsightViewModel>(insightWarmCacheRef.current, insightKey);
    if (cachedInsight) {
      setInsight(cachedInsight);
      const key = buildAnalysisBatchKey(routeState.locationId, cachedInsight.selectedTimestamp, dashboard.generatedAt);
      if (key) {
        setLatestInsightEnvelope({
          key,
          locationId: routeState.locationId,
          selectedTimestamp: cachedInsight.selectedTimestamp,
          generatedAt: dashboard.generatedAt,
          data: cachedInsight,
        });
      }
      setInsightError(null);
      setLoadingInsight(false);
      return;
    }

    let cancelled = false;
    insightAbortRef.current?.abort();
    const controller = new AbortController();
    insightAbortRef.current = controller;
    setLoadingInsight(true);

    const load = async () => {
      try {
        const mappedInsight = await fetchInsightSnapshot({
          locationId: routeState.locationId,
          selectedTimestamp: routeState.selectedInsightTimestamp ?? null,
          actualTemperatureC: routeState.actualTemperatureC ?? null,
          signal: controller.signal,
        });

        if (cancelled) {
          return;
        }

        const generatedAt = dashboard.generatedAt;
        const key = buildAnalysisBatchKey(routeState.locationId, mappedInsight.selectedTimestamp, generatedAt);

        setInsight(mappedInsight);
        if (key) {
          setLatestInsightEnvelope({
            key,
            locationId: routeState.locationId,
            selectedTimestamp: mappedInsight.selectedTimestamp,
            generatedAt,
            data: mappedInsight,
          });
        }
        setInsightError(null);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        if (!cancelled) {
          setInsightError(getErrorMessage(error, UI_TEXT.errors.insight));
        }
      } finally {
        if (!cancelled) {
          setLoadingInsight(false);
        }
        if (insightAbortRef.current === controller) {
          insightAbortRef.current = null;
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [dashboard?.generatedAt, routeState.actualTemperatureC, routeState.locationId, routeState.path, routeState.selectedInsightTimestamp]);

  useEffect(() => {
    if (!insight) {
      return;
    }

    if (routeState.selectedInsightTimestamp && insight.availableTimestamps.includes(routeState.selectedInsightTimestamp)) {
      return;
    }

    updateRouteState((current) => ({
      ...current,
      selectedInsightTimestamp: insight.selectedTimestamp,
    }));
  }, [insight]);

  useEffect(() => {
    const distributionTimestamp = (routeState.selectedInsightTimestamp ?? insight?.selectedTimestamp) ?? null;
    const dashboardAligned = dashboard?.hourly.location.id === routeState.locationId;
    if (
      routeState.path !== "/analysis" ||
      routeState.tab !== "models" ||
      !dashboard ||
      !dashboardAligned ||
      !distributionTimestamp
    ) {
      return;
    }

    const distributionKey = buildDistributionWarmKey(routeState.locationId, distributionTimestamp);
    const cachedDistribution = readWarmCacheEntry<DistributionViewModel>(distributionWarmCacheRef.current, distributionKey);
    if (cachedDistribution) {
      setDistribution(cachedDistribution);
      const key = buildAnalysisBatchKey(routeState.locationId, cachedDistribution.selectedTimestamp, dashboard.generatedAt);
      if (key) {
        setLatestDistributionEnvelope({
          key,
          locationId: routeState.locationId,
          selectedTimestamp: cachedDistribution.selectedTimestamp,
          generatedAt: dashboard.generatedAt,
          data: cachedDistribution,
        });
      }
      setDistributionError(null);
      setLoadingDistribution(false);
      return;
    }

    let cancelled = false;
    distributionAbortRef.current?.abort();
    const controller = new AbortController();
    distributionAbortRef.current = controller;
    setLoadingDistribution(true);

    const load = async () => {
      try {
        const mappedDistribution = await fetchDistributionSnapshot({
          locationId: routeState.locationId,
          selectedTimestamp: distributionTimestamp,
          signal: controller.signal,
        });

        if (cancelled) {
          return;
        }

        if (!mappedDistribution) {
          setDistribution(null);
          setLatestDistributionEnvelope(null);
          setDistributionError(null);
          return;
        }

        const generatedAt = dashboard.generatedAt;
        const key = buildAnalysisBatchKey(routeState.locationId, mappedDistribution.selectedTimestamp, generatedAt);

        setDistribution(mappedDistribution);
        if (key) {
          setLatestDistributionEnvelope({
            key,
            locationId: routeState.locationId,
            selectedTimestamp: mappedDistribution.selectedTimestamp,
            generatedAt,
            data: mappedDistribution,
          });
        }
        setDistributionError(null);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        if (!cancelled) {
          setDistributionError(getErrorMessage(error, UI_TEXT.errors.distribution));
        }
      } finally {
        if (!cancelled) {
          setLoadingDistribution(false);
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
    dashboard?.generatedAt,
    insight?.selectedTimestamp,
    routeState.locationId,
    routeState.path,
    routeState.selectedInsightTimestamp,
    routeState.tab,
  ]);

  useEffect(() => {
    const dashboardAligned = dashboard?.hourly.location.id === routeState.locationId;
    if (routeState.path !== "/kelly" || !dashboard || !dashboardAligned || !routeState.targetDate) {
      setManualRefreshingKelly(false);
      return;
    }

    const kellyKey = buildKellyWarmKey({
      locationId: routeState.locationId,
      targetDate: routeState.targetDate,
      bankroll: routeState.bankroll,
      riskMode: routeState.riskMode,
      minEdge: routeState.minEdge,
      actualTemperatureC: routeState.actualTemperatureC,
      selectedHour: routeState.selectedHourlyTimestamp,
    });
    const cachedKelly = readWarmCacheEntry<KellyWorkbenchResponse>(
      kellyWarmCacheRef.current,
      kellyKey,
      KELLY_WARM_CACHE_TTL_MS,
    );
    if (cachedKelly) {
      setKellySnapshot(cachedKelly);
      setKellyError(null);
      setKellyStreamState(cachedKelly.streamHealth.state);
      setLoadingKelly(false);
      setManualRefreshingKelly(false);
      return;
    }

    let cancelled = false;
    const requestSeq = kellyRequestSeqRef.current + 1;
    kellyRequestSeqRef.current = requestSeq;
    kellyAbortRef.current?.abort();
    const controller = new AbortController();
    kellyAbortRef.current = controller;
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
          actualTemperatureC: routeState.actualTemperatureC,
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
        if (error instanceof DOMException && error.name === "AbortError") {
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
    routeState.actualTemperatureC,
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

    if (latestInsightEnvelope.key !== latestDistributionEnvelope.key) {
      return;
    }

    setAnalysisSnapshot({
      key: latestInsightEnvelope.key,
      locationId: latestInsightEnvelope.locationId,
      insight: latestInsightEnvelope.data,
      distribution: latestDistributionEnvelope.data,
    });
    setLastConsistentAnalysisKey(latestInsightEnvelope.key);
  }, [latestDistributionEnvelope, latestInsightEnvelope]);

  const report = dashboard?.report;
  const reportText = report?.textZh ?? CONFIG.fallback.emptyText;
  const imageUrl = dashboard ? weatherApi.buildMultiModelImageUrl(routeState.locationId, true, cacheBust) : null;
  const imageUpdatedAt = dashboard?.multimodel.displayUpdatedAt ?? dashboard?.sync.updatedAt ?? null;
  const isAnalysis = routeState.path === "/analysis";
  const isKelly = routeState.path === "/kelly";
  const currentPage = isKelly ? "kelly" : isAnalysis ? "analysis" : "home";
  const isLocationTransitionPending = locationTransitionState.stage === "dashboard";

  useEffect(() => {
    if (!imageUrl || !dashboard?.multimodel.imageUrlFound) {
      return;
    }

    const preview = new Image();
    preview.decoding = "async";
    preview.src = imageUrl;
  }, [dashboard?.multimodel.imageUrlFound, imageUrl]);

  useEffect(() => {
    const kellySnapshotAligned =
      kellySnapshot?.location.id === routeState.locationId && kellySnapshot?.targetDate === routeState.targetDate;

    if (routeState.path !== "/kelly" || !routeState.targetDate) {
      kellySocketRef.current?.close();
      kellySocketRef.current = null;
      resetKellySocketRuntime();
      setKellyStreamState("idle");
      return;
    }

    if (!kellySnapshot || !kellySnapshotAligned) {
      kellySocketRef.current?.close();
      kellySocketRef.current = null;
      clearKellySocketReconnectTimer();
      setKellyStreamState(kellySnapshot?.streamHealth.state ?? "idle");
      return;
    }

    const socket = new WebSocket(
      weatherApi.buildKellyStreamUrl(
        routeState.locationId,
        routeState.targetDate ?? undefined,
        routeState.bankroll,
        routeState.riskMode,
        routeState.minEdge,
        routeState.actualTemperatureC ?? undefined,
        routeState.selectedHourlyTimestamp ?? undefined,
      ),
    );
    let intentionalClose = false;
    let reconnectRequested = false;

    kellySocketRef.current?.close();
    kellySocketRef.current = socket;
    setKellyStreamState("connecting");

    const applyStatusMessage = (message: Extract<KellyStreamMessage, { type: "status" }>) => {
      setKellyStreamState(message.state);
      setKellySnapshot((current) => {
        if (!current) {
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
              return {
                ...status,
                state: "fresh",
                detail: "最近一次盘口快照已用于重定价。",
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
      clearKellySocketReconnectTimer();
      kellySocketRetryCountRef.current = 0;
      setKellyStreamState("connecting");
    };

    socket.onmessage = (event) => {
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
            if (!current) {
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
      socket.close();
      if (kellySocketRef.current === socket) {
        kellySocketRef.current = null;
      }
    };
  }, [
    kellyRefreshNonce,
    kellySnapshot?.location.id,
    kellySnapshot?.targetDate,
    kellySocketReconnectNonce,
    routeState.actualTemperatureC,
    routeState.bankroll,
    routeState.locationId,
    routeState.minEdge,
    routeState.path,
    routeState.riskMode,
    routeState.selectedHourlyTimestamp,
    routeState.targetDate,
  ]);

  const currentAnalysisKey = buildAnalysisBatchKey(
    routeState.locationId,
    routeState.selectedInsightTimestamp ?? insight?.selectedTimestamp ?? null,
    dashboard?.generatedAt ?? null,
  );
  const latestAnalysisReady =
    Boolean(
      latestInsightEnvelope &&
        latestDistributionEnvelope &&
        currentAnalysisKey &&
        latestInsightEnvelope.key === latestDistributionEnvelope.key &&
        latestInsightEnvelope.key === currentAnalysisKey,
    ) && isAnalysis;
  const analysisSnapshotForLocation =
    analysisSnapshot && analysisSnapshot.locationId === routeState.locationId ? analysisSnapshot : null;
  const fallbackAnalysisSnapshot =
    analysisSnapshotForLocation ??
    ((loadingInsight || loadingDistribution || Boolean(locationTransitionState.pendingLocationId)) ? analysisSnapshot : null);
  const displayedAnalysisInsight = latestAnalysisReady
    ? latestInsightEnvelope?.data ?? null
    : analysisSnapshotForLocation?.insight ?? fallbackAnalysisSnapshot?.insight ?? insight;
  const displayedAnalysisDistribution = latestAnalysisReady
    ? latestDistributionEnvelope?.data ?? null
    : analysisSnapshotForLocation?.distribution ?? fallbackAnalysisSnapshot?.distribution ?? distribution;

  const translatedWarnings = collectDisplayWarnings({
    dashboardWarnings: dashboard?.hourly.warnings,
    reportWarnings: report?.warnings,
    insightWarnings: isAnalysis ? displayedAnalysisInsight?.warnings : insight?.warnings,
    distributionWarnings: isAnalysis ? displayedAnalysisDistribution?.warnings : distribution?.warnings,
  });
  const homepageWarnings = collectHomeDisplayWarnings({
    dashboardWarnings: dashboard?.hourly.warnings,
    reportWarnings: report?.warnings,
    insightWarnings: insight?.warnings,
    distributionWarnings: distribution?.warnings,
  });
  const activeLocationTimezone =
    dashboard?.locationDirectory.find((location) => location.id === displayedLocationId)?.timezone ??
    dashboardWarmCacheRef.current.get(displayedLocationId)?.data.locationDirectory.find((location) => location.id === displayedLocationId)?.timezone ??
    insight?.location.timezone ??
    distribution?.location.timezone ??
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
        insight,
      }),
    [currentHourItem, dashboard, insight, items, reportText, selectedItem],
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

  const hasCommittedSnapshot = Boolean(dashboard);
  const workspaceMuted = isLocationTransitionPending && !hasCommittedSnapshot;
  const kellyRefreshDisabled = !routeState.targetDate || manualRefreshingKelly || isLocationTransitionPending;
  const headerRefreshState = isKelly
    ? manualRefreshingKelly || isLocationTransitionPending
      ? "pending"
      : "idle"
    : refreshState;
  const headerRefreshDisabled = isKelly
    ? kellyRefreshDisabled
    : refreshState === "pending" || isLocationTransitionPending;
  const peakSummary = displayedAnalysisInsight
    ? buildPeakSummary(displayedAnalysisInsight.peakTimeDistribution, activeLocationTimezone)
    : UI_TEXT.analysis.peakSummaryLoading;

  return (
    <div
      className={`weather-shell ${railExpanded ? "weather-shell-rail-open" : ""} ${currentPage === "analysis" ? "weather-shell-analysis" : currentPage === "kelly" ? "weather-shell-kelly" : "weather-shell-home"}`}
      data-page={currentPage}
    >
      <TerminalBackdrop />

      <CommandHeader
        locationName={
          currentPage === "kelly"
            ? (kellySnapshot?.location.name ?? displayedLocation?.displayName ?? homeViewModel.locationName)
            : (displayedLocation?.displayName ?? homeViewModel.locationName)
        }
        pendingLocationName={pendingLocationName}
        transitioning={isLocationTransitionPending}
        locationTimezone={activeLocationTimezone}
        updatedAt={dashboard?.sync.updatedAt ?? null}
        syncState={dashboard?.sync.state ?? "fresh"}
        refreshState={headerRefreshState}
        refreshDisabled={headerRefreshDisabled}
        currentPage={currentPage}
        railExpanded={railExpanded}
        favorite={favoriteLocationIds.includes(routeState.locationId)}
        favoriteDisabled={favoritePendingIds.includes(routeState.locationId)}
        favoriteError={favoritesError}
        onToggleRail={() => setRailExpanded((current) => !current)}
        onRefresh={() => {
          if (isKelly) {
            applyKellyDraftControls();
            return;
          }

          void refreshDashboard(true, routeState.locationId);
        }}
        onToggleFavorite={() => void toggleFavorite(routeState.locationId)}
        onNavigateHome={() => {
          setRailExpanded(false);
          updateRouteState(
            (current) => ({
              ...current,
              path: "/",
            }),
            "push",
          );
        }}
        onNavigateAnalysis={() => {
          setRailExpanded(false);
          updateRouteState(
            (current) => ({
              ...current,
              path: "/analysis",
            }),
            "push",
          );
        }}
        onNavigateKelly={() => {
          setRailExpanded(false);
          updateRouteState(
            (current) => ({
              ...current,
              path: "/kelly",
            }),
            "push",
          );
        }}
      />

      {dashboardError ? <WarningLines items={[dashboardError]} /> : null}

      {!hasCommittedSnapshot && !dashboardError ? (
        <section className="terminal-panel flex flex-1 items-center justify-center px-6 py-10">
          <div className="panel-section text-center">
            <div className="eyebrow">{UI_TEXT.app.loadingEyebrow}</div>
            <div className="mt-3 text-3xl font-semibold text-white">{UI_TEXT.app.loadingTitle}</div>
            <div className="mt-3 text-sm text-white/56">{UI_TEXT.app.loadingDescription}</div>
          </div>
        </section>
      ) : null}

      {hasCommittedSnapshot && dashboard ? (
        <div className={`${isAnalysis ? "analysis-layout-shell" : "terminal-layout"} workspace-stage`}>
          <LocationRail
            expanded={railExpanded}
            activeId={displayedLocationId}
            pendingId={locationTransitionState.pendingLocationId}
            activeGroup={activeTimezoneGroup}
            groups={locationGroups}
            favoritePendingIds={favoritePendingIds}
            error={favoritesError}
            onGroupChange={(group) => {
              setBrowsingTimezoneGroup(group);
            }}
            onSelect={(id) => {
              const nextGroup = locations.find((location) => location.id === id)?.timezoneGroup;
              if (nextGroup) {
                setBrowsingTimezoneGroup(nextGroup);
              }
              void transitionToLocation(id, "push");
            }}
            onToggleFavorite={(id) => void toggleFavorite(id)}
            onDismiss={() => setRailExpanded(false)}
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
                  tab={routeState.tab}
                  insight={displayedAnalysisInsight}
                  distribution={displayedAnalysisDistribution}
                  dashboard={dashboard}
                  locationTimezone={activeLocationTimezone}
                  imageUrl={imageUrl}
                  imageUpdatedAt={imageUpdatedAt}
                  loadingInsight={loadingInsight}
                  loadingDistribution={loadingDistribution}
                  insightError={insightError}
                  distributionError={distributionError}
                  actualTemperatureC={routeState.actualTemperatureC}
                  warnings={translatedWarnings}
                  peakSummary={peakSummary}
                  analysisKey={currentAnalysisKey}
                  lastConsistentAnalysisKey={lastConsistentAnalysisKey}
                  onTabChange={(tabValue) =>
                    updateRouteState(
                      (current) => ({
                        ...current,
                        path: "/analysis",
                        tab: tabValue,
                      }),
                      "push",
                    )
                  }
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
                  predictabilityScore={dashboard.report.metrics.predictabilityScore ?? null}
                  predictabilityLabel={dashboard.report.metrics.predictability}
                />
              </Suspense>

              <aside className="home-support-column home-quick-insight-column analysis-column scrollbar-terminal overflow-y-auto pr-1">
                <InsightCard
                  insight={insight}
                  loading={loadingInsight}
                  error={insightError}
                  locationTimezone={activeLocationTimezone}
                  selectedInsightTimestamp={routeState.selectedInsightTimestamp}
                  actualTemperatureC={routeState.actualTemperatureC}
                  manualTemperatureText={manualTemperatureText}
                  referenceMode={referenceTemperatureMode}
                  onSelectTimestamp={(value) =>
                    updateRouteState((current) => ({
                      ...current,
                      selectedInsightTimestamp: value,
                      selectedHourlyTimestamp: value ?? current.selectedHourlyTimestamp,
                    }))
                  }
                  onTemperatureChange={(value) => {
                    setReferenceTemperatureMode("manual");
                    setManualTemperatureText(value);
                    const parsed = Number.parseFloat(value);
                    updateRouteState((current) => ({
                      ...current,
                      actualTemperatureC: Number.isFinite(parsed) ? parsed : null,
                    }));
                  }}
                  onResetTemperature={() => {
                    setReferenceTemperatureMode("default");
                    setManualTemperatureText(defaultReferenceTemperature !== null ? String(defaultReferenceTemperature) : "");
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
                />

                {homepageWarnings.length > 0 ? <WarningLines items={homepageWarnings.slice(0, 2)} /> : null}
              </aside>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
