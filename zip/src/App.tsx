import { useEffect, useMemo, useRef, useState } from "react";

import { getErrorMessage, weatherApi } from "./api";
import { AnalysisWorkspace } from "./components/AnalysisWorkspace";
import { CommandHeader } from "./components/CommandHeader";
import { InsightCard } from "./components/InsightCard";
import { KellyWorkbench } from "./components/KellyWorkbench";
import { LocationRail } from "./components/LocationRail";
import { TerminalBackdrop } from "./components/terminal/TerminalBackdrop";
import { WarningLines } from "./components/WarningLines";
import { WeatherOverview } from "./components/WeatherOverview";
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
import { deriveKellyRecommendations } from "./kelly";
import type { KellyRiskMode, KellyStreamMessage, KellyWorkbenchResponse } from "./types";

type AppPath = "/" | "/analysis" | "/kelly";
type RefreshState = "idle" | "pending" | "success" | "error";
type TimezoneGroup = "asia" | "europe" | "americas";
type AnalysisDataEnvelope<T> = {
  key: string;
  locationId: string;
  selectedTimestamp: string;
  generatedAt: string;
  data: T;
};

interface RouteState extends AnalysisWorkspaceState {
  path: AppPath;
  targetDate: string | null;
  bankroll: number;
  riskMode: KellyRiskMode;
  minEdge: number;
}

const parseNumber = (value: string | null) => {
  if (!value) {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
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
    bankroll: parseNumber(url.searchParams.get("bankroll")) ?? 1000,
    riskMode:
      url.searchParams.get("riskMode") === "conservative" ||
      url.searchParams.get("riskMode") === "aggressive" ||
      url.searchParams.get("riskMode") === "balanced"
        ? (url.searchParams.get("riskMode") as KellyRiskMode)
        : "balanced",
    minEdge: parseNumber(url.searchParams.get("minEdge")) ?? 0.02,
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
    if (state.bankroll !== 1000) {
      url.searchParams.set("bankroll", String(state.bankroll));
    }
    if (state.riskMode !== "balanced") {
      url.searchParams.set("riskMode", state.riskMode);
    }
    if (state.minEdge !== 0.02) {
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

export default function App() {
  const [routeState, setRouteState] = useState<RouteState>(() => parseRouteState());
  const [dashboard, setDashboard] = useState<DashboardViewModel | null>(null);
  const [insight, setInsight] = useState<InsightViewModel | null>(null);
  const [distribution, setDistribution] = useState<DistributionViewModel | null>(null);
  const [kellySnapshot, setKellySnapshot] = useState<KellyWorkbenchResponse | null>(null);
  const [loadingKelly, setLoadingKelly] = useState(false);
  const [kellyError, setKellyError] = useState<string | null>(null);
  const [kellyStreamState, setKellyStreamState] = useState<string>("idle");
  const [kellyRefreshNonce, setKellyRefreshNonce] = useState(0);

  const [railExpanded, setRailExpanded] = useState(false);
  const [activeTimezoneGroup, setActiveTimezoneGroup] = useState<TimezoneGroup>(DEFAULT_ACTIVE_TIMEZONE_GROUP);
  const [manualTemperatureText, setManualTemperatureText] = useState(() => {
    const initial = parseRouteState().actualTemperatureC;
    return initial !== null ? String(initial) : "";
  });
  const [referenceTemperatureMode, setReferenceTemperatureMode] = useState<"default" | "manual">(
    () => (parseRouteState().actualTemperatureC !== null ? "manual" : "default"),
  );
  const [cacheBust, setCacheBust] = useState(Date.now());
  const [favoriteLocationIds, setFavoriteLocationIds] = useState<string[]>([]);
  const [favoritePendingIds, setFavoritePendingIds] = useState<string[]>([]);
  const [locationTemperatures, setLocationTemperatures] = useState<Record<string, number | null>>({});
  const [refreshState, setRefreshState] = useState<RefreshState>("pending");
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
  const dashboardRequestSeqRef = useRef(0);
  const syncedGroupLocationIdRef = useRef<string | null>(null);
  const dashboardAbortRef = useRef<AbortController | null>(null);
  const insightAbortRef = useRef<AbortController | null>(null);
  const distributionAbortRef = useRef<AbortController | null>(null);
  const kellyAbortRef = useRef<AbortController | null>(null);
  const kellyRequestSeqRef = useRef(0);
  const kellySocketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const onPopState = () => {
      const next = parseRouteState();
      setRouteState(next);
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

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setRailExpanded(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [railExpanded]);

  const updateRouteState = (updater: (current: RouteState) => RouteState, mode: "replace" | "push" = "replace") => {
    setRouteState((current) => {
      const next = updater(current);
      commitRouteState(next, mode);
      return next;
    });
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

  useEffect(
    () => () => {
      clearRefreshResetTimer();
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
      const response = await weatherApi.fetchDashboard("1h", 24, locationId, { signal: controller.signal });
      if (requestSeq !== dashboardRequestSeqRef.current) {
        return;
      }

      const mappedDashboard = mapDashboardResponse(response);
      setDashboard(mappedDashboard);
      setDashboardError(null);
      setLocationTemperatures((current) => ({
        ...current,
        [locationId]:
          mappedDashboard.hourly.current?.temperatureC ??
          mappedDashboard.hourly.items[0]?.temperatureC ??
          null,
      }));

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
    void refreshDashboard(false, routeState.locationId);
    const timer = window.setInterval(
      () => void refreshDashboard(false, routeState.locationId),
      CONFIG.refresh.DASHBOARD_POLL_INTERVAL_MS,
    );
    return () => window.clearInterval(timer);
  }, [routeState.locationId]);

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
    const nextGroup =
      dashboard?.locationDirectory.find((location) => location.id === routeState.locationId)?.timezoneGroup ??
      DEFAULT_ACTIVE_TIMEZONE_GROUP;

    if (syncedGroupLocationIdRef.current !== routeState.locationId) {
      setActiveTimezoneGroup(nextGroup);
      syncedGroupLocationIdRef.current = routeState.locationId;
    }
  }, [dashboard?.locationDirectory, routeState.locationId]);

  useEffect(() => {
    if (routeState.path !== "/kelly") {
      return;
    }

    const locationTimezone =
      dashboard?.locationDirectory.find((location) => location.id === routeState.locationId)?.timezone ??
      dashboard?.hourly.locationTimezone;

    if (!locationTimezone || routeState.targetDate) {
      return;
    }

    updateRouteState((current) => ({
      ...current,
      targetDate: resolveTodayForTimezone(locationTimezone),
    }));
  }, [dashboard?.hourly.locationTimezone, dashboard?.locationDirectory, routeState.locationId, routeState.path, routeState.targetDate]);

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
    if (referenceTemperatureMode !== "default") {
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
  }, [defaultReferenceTemperature, manualTemperatureText, referenceTemperatureMode, routeState.actualTemperatureC]);

  useEffect(() => {
    if (!dashboard?.locationDirectory.length) {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const missingLocations = dashboard.locationDirectory.filter(
      (location) => !Object.prototype.hasOwnProperty.call(locationTemperatures, location.id),
    );

    if (!missingLocations.length) {
      return;
    }

    const loadTemperatures = async () => {
      const results = await Promise.allSettled(
        missingLocations.map(async (location) => {
          const response = await weatherApi.fetchHourly("1h", 1, location.id, { signal: controller.signal });
          return {
            id: location.id,
            temp: response.current?.temperatureC ?? response.items[0]?.temperatureC ?? null,
          };
        }),
      );

      if (cancelled) {
        return;
      }

      setLocationTemperatures((current) => {
        const next = { ...current };
        for (const result of results) {
          if (result.status === "fulfilled") {
            next[result.value.id] = result.value.temp;
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
  }, [dashboard?.locationDirectory, locationTemperatures]);

  useEffect(() => {
    if (!dashboard || routeState.path === "/kelly") {
      setInsight(null);
      setLatestInsightEnvelope(null);
      return;
    }

    let cancelled = false;
    insightAbortRef.current?.abort();
    const controller = new AbortController();
    insightAbortRef.current = controller;
    setLoadingInsight(true);

    const load = async () => {
      try {
        const response = await weatherApi.fetchInsights(
          routeState.locationId,
          routeState.selectedInsightTimestamp ?? undefined,
          routeState.actualTemperatureC ?? undefined,
          { signal: controller.signal },
        );

        if (cancelled) {
          return;
        }

        const mappedInsight = mapInsightResponse(response);
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
    if (routeState.path !== "/analysis" || routeState.tab !== "models" || !dashboard || !distributionTimestamp) {
      return;
    }

    let cancelled = false;
    distributionAbortRef.current?.abort();
    const controller = new AbortController();
    distributionAbortRef.current = controller;
    setLoadingDistribution(true);

    const load = async () => {
      try {
        const response = await weatherApi.fetchDistribution(
          routeState.locationId,
          distributionTimestamp,
          1,
          { signal: controller.signal },
        );

        if (cancelled) {
          return;
        }

        const mappedDistribution = mapDistributionResponse(response);
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
    if (routeState.path !== "/kelly" || !dashboard || !routeState.targetDate) {
      return;
    }

    let cancelled = false;
    const requestSeq = kellyRequestSeqRef.current + 1;
    kellyRequestSeqRef.current = requestSeq;
    kellyAbortRef.current?.abort();
    const controller = new AbortController();
    kellyAbortRef.current = controller;
    setLoadingKelly(true);
    setKellyStreamState("connecting");

    const load = async () => {
      try {
        const response = await weatherApi.fetchKellyWorkbench(
          routeState.locationId,
          routeState.targetDate ?? undefined,
          routeState.bankroll,
          routeState.riskMode,
          routeState.minEdge,
          routeState.actualTemperatureC ?? undefined,
          routeState.selectedHourlyTimestamp ?? undefined,
          { signal: controller.signal },
        );

        if (cancelled || requestSeq !== kellyRequestSeqRef.current) {
          return;
        }

        setKellySnapshot(response);
        setKellyError(null);
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
    dashboard?.generatedAt,
    kellyRefreshNonce,
    routeState.actualTemperatureC,
    routeState.locationId,
    routeState.path,
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

  useEffect(() => {
    if (!imageUrl || !dashboard?.multimodel.imageUrlFound) {
      return;
    }

    const preview = new Image();
    preview.decoding = "async";
    preview.src = imageUrl;
  }, [dashboard?.multimodel.imageUrlFound, imageUrl]);

  useEffect(() => {
    if (routeState.path !== "/kelly" || !routeState.targetDate || !kellySnapshot) {
      kellySocketRef.current?.close();
      kellySocketRef.current = null;
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

    kellySocketRef.current?.close();
    kellySocketRef.current = socket;
    setKellyStreamState("connecting");

    socket.onopen = () => {
      setKellyStreamState("connected");
    };

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as KellyStreamMessage;
        if (message.type === "status") {
          setKellyStreamState(message.state);
          return;
        }

        setKellyStreamState("connected");
        setKellySnapshot((current) => {
          if (!current) {
            return current;
          }

          const updates = new Map(message.markets.map((market) => [market.marketId, market]));
          const nextMarkets = current.markets.map((market) => {
            const patch = updates.get(market.marketId);
            return patch
              ? {
                  ...market,
                  yesPrice: patch.yesPrice,
                  noPrice: patch.noPrice,
                  yesBestBid: patch.yesBestBid,
                  yesBestAsk: patch.yesBestAsk,
                  noBestBid: patch.noBestBid,
                  noBestAsk: patch.noBestAsk,
                  spreadPct: patch.spreadPct,
                  edgeYes: patch.edgeYes,
                  edgeNo: patch.edgeNo,
                  kellyYes: patch.kellyYes,
                  kellyNo: patch.kellyNo,
                  recommendedSide: patch.recommendedSide,
                  suggestedStake: patch.suggestedStake,
                  updatedAt: patch.updatedAt,
                }
              : market;
          });

          return {
            ...current,
            generatedAt: message.generatedAt,
            markets: nextMarkets,
            recommendations: deriveKellyRecommendations(nextMarkets, routeState.bankroll, routeState.riskMode, routeState.minEdge),
            sourceStatus: current.sourceStatus.map((status) =>
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
      } catch {
        setKellyStreamState("degraded");
      }
    };

    socket.onclose = () => {
      if (kellySocketRef.current === socket) {
        setKellyStreamState("disconnected");
      }
    };

    socket.onerror = () => {
      setKellyStreamState("degraded");
    };

    return () => {
      socket.close();
      if (kellySocketRef.current === socket) {
        kellySocketRef.current = null;
      }
    };
  }, [
    kellySnapshot?.location.id,
    kellySnapshot?.targetDate,
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
  const displayedAnalysisInsight = latestAnalysisReady
    ? latestInsightEnvelope?.data ?? null
    : analysisSnapshotForLocation?.insight ?? insight;
  const displayedAnalysisDistribution = latestAnalysisReady
    ? latestDistributionEnvelope?.data ?? null
    : analysisSnapshotForLocation?.distribution ?? distribution;

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
    dashboard?.locationDirectory.find((location) => location.id === routeState.locationId)?.timezone ??
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
        routeState.locationId,
        locationTemperatures,
        favoriteLocationIds,
      ),
    [dashboard?.locationDirectory, favoriteLocationIds, locationTemperatures, routeState.locationId],
  );
  const locationGroups = useMemo(() => buildDockLocationGroups(locations), [locations]);

  const dashboardMatchesRoute = dashboard?.hourly.location.id === routeState.locationId;
  const workspaceReady = Boolean(dashboard) && dashboardMatchesRoute && !dashboardError;
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
        locationName={kellySnapshot?.location.name ?? homeViewModel.locationName}
        locationTimezone={activeLocationTimezone}
        updatedAt={dashboard?.sync.updatedAt ?? null}
        syncState={dashboard?.sync.state ?? "fresh"}
        refreshState={refreshState}
        refreshDisabled={loadingDashboard || (isKelly && loadingKelly)}
        currentPage={currentPage}
        railExpanded={railExpanded}
        favorite={favoriteLocationIds.includes(routeState.locationId)}
        favoriteDisabled={favoritePendingIds.includes(routeState.locationId)}
        favoriteError={favoritesError}
        onToggleRail={() => setRailExpanded((current) => !current)}
        onRefresh={() => {
          void refreshDashboard(true, routeState.locationId);
          if (isKelly) {
            setKellyRefreshNonce((current) => current + 1);
          }
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

      {!workspaceReady && !dashboardError ? (
        <section className="terminal-panel flex flex-1 items-center justify-center px-6 py-10">
          <div className="panel-section text-center">
            <div className="eyebrow">{UI_TEXT.app.loadingEyebrow}</div>
            <div className="mt-3 text-3xl font-semibold text-white">{UI_TEXT.app.loadingTitle}</div>
            <div className="mt-3 text-sm text-white/56">{UI_TEXT.app.loadingDescription}</div>
          </div>
        </section>
      ) : null}

      {workspaceReady ? (
        <div className={`${isAnalysis ? "analysis-layout-shell" : "terminal-layout"} workspace-stage`}>
          <LocationRail
            expanded={railExpanded}
            activeId={routeState.locationId}
            activeGroup={activeTimezoneGroup}
            groups={locationGroups}
            favoritePendingIds={favoritePendingIds}
            error={favoritesError}
            onGroupChange={setActiveTimezoneGroup}
            onSelect={(id) => {
              setRailExpanded(false);
              setReferenceTemperatureMode("default");
              setManualTemperatureText("");
              setDashboard(null);
              setInsight(null);
              setDistribution(null);
              setLatestInsightEnvelope(null);
              setLatestDistributionEnvelope(null);
              setAnalysisSnapshot(null);
              setLastConsistentAnalysisKey(null);
              setKellySnapshot(null);
              setKellyError(null);
              setKellyStreamState("idle");
              kellySocketRef.current?.close();
              setDashboardError(null);
              setInsightError(null);
              setDistributionError(null);
              updateRouteState((current) => ({
                ...current,
                locationId: id,
                actualTemperatureC: null,
                selectedInsightTimestamp: null,
                selectedHourlyTimestamp: null,
                targetDate: current.path === "/kelly" ? null : current.targetDate,
              }));
            }}
            onToggleFavorite={(id) => void toggleFavorite(id)}
          />

          {railExpanded ? (
            <button
              type="button"
              aria-label={UI_TEXT.app.closeRail}
              className="location-rail-overlay"
              onClick={() => setRailExpanded(false)}
            />
          ) : null}

          {isAnalysis ? (
            <div className={`workspace-shell workspace-shell-analysis-stage ${railExpanded ? "workspace-shell-muted" : ""}`}>
              <AnalysisWorkspace
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
            </div>
          ) : isKelly ? (
            <div className={`workspace-shell workspace-shell-kelly-stage ${railExpanded ? "workspace-shell-muted" : ""}`}>
              <KellyWorkbench
                snapshot={kellySnapshot}
                locations={dashboard.locationDirectory}
                activeLocationId={routeState.locationId}
                timezone={activeLocationTimezone}
                bankroll={routeState.bankroll}
                riskMode={routeState.riskMode}
                minEdge={routeState.minEdge}
                actualTemperatureText={manualTemperatureText}
                loading={loadingKelly}
                error={kellyError}
                streamState={kellyStreamState}
                onLocationChange={(locationId) => {
                  setReferenceTemperatureMode("default");
                  setManualTemperatureText("");
                  setDashboard(null);
                  setInsight(null);
                  setDistribution(null);
                  setKellySnapshot(null);
                  setKellyError(null);
                  setKellyStreamState("idle");
                  setDashboardError(null);
                  setInsightError(null);
                  setDistributionError(null);
                  kellySocketRef.current?.close();
                  updateRouteState(
                    (current) => ({
                      ...current,
                      locationId,
                      actualTemperatureC: null,
                      selectedInsightTimestamp: null,
                      selectedHourlyTimestamp: null,
                      targetDate: null,
                    }),
                    "push",
                  );
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
                onBankrollChange={(bankrollValue) =>
                  updateRouteState((current) => ({
                    ...current,
                    bankroll: bankrollValue && Number.isFinite(bankrollValue) && bankrollValue > 0 ? bankrollValue : 1000,
                  }))
                }
                onRiskModeChange={(nextRiskMode) =>
                  updateRouteState((current) => ({
                    ...current,
                    riskMode: nextRiskMode,
                  }))
                }
                onMinEdgeChange={(nextMinEdge) =>
                  updateRouteState((current) => ({
                    ...current,
                    minEdge:
                      nextMinEdge !== null && Number.isFinite(nextMinEdge) && nextMinEdge >= 0
                        ? Math.min(1, Math.max(0, nextMinEdge))
                        : 0.02,
                  }))
                }
                onActualTemperatureChange={(value) => {
                  setReferenceTemperatureMode(value.trim() ? "manual" : "default");
                  setManualTemperatureText(value);
                  const parsed = Number.parseFloat(value);
                  updateRouteState((current) => ({
                    ...current,
                    actualTemperatureC: Number.isFinite(parsed) ? parsed : null,
                  }));
                }}
                onRefresh={() => {
                  void refreshDashboard(true, routeState.locationId);
                  setKellyRefreshNonce((current) => current + 1);
                }}
              />
            </div>
          ) : (
            <div className={`home-shell ${railExpanded ? "workspace-shell-muted" : ""}`}>
              <WeatherOverview
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
              />

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
