import { useEffect, useMemo, useRef, useState } from "react";

import { getErrorMessage, weatherApi } from "./api";
import { AnalysisWorkspace } from "./components/AnalysisWorkspace";
import { CommandHeader } from "./components/CommandHeader";
import { InsightCard } from "./components/InsightCard";
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

type AppPath = "/" | "/analysis";
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

  return {
    path: url.pathname === "/analysis" ? "/analysis" : "/",
    tab: url.searchParams.get("tab") === "image" ? "image" : "models",
    locationId: url.searchParams.get("locationId") ?? CONFIG.location.DEFAULT_ID,
    selectedInsightTimestamp: url.searchParams.get("timestamp"),
    actualTemperatureC: parseNumber(url.searchParams.get("actualTemperatureC")),
    selectedHourlyTimestamp: url.searchParams.get("selectedHour"),
  };
};

const buildRouteUrl = (state: RouteState) => {
  const url = new URL(window.location.href);
  url.pathname = state.path;
  url.search = "";

  if (state.path === "/analysis") {
    url.searchParams.set("tab", state.tab);
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

  const [railExpanded, setRailExpanded] = useState(false);
  const [activeTimezoneGroup, setActiveTimezoneGroup] = useState<TimezoneGroup>(DEFAULT_ACTIVE_TIMEZONE_GROUP);
  const [manualTemperatureText, setManualTemperatureText] = useState("");
  const [referenceTemperatureMode, setReferenceTemperatureMode] = useState<"default" | "manual">("default");
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

  useEffect(() => {
    const onPopState = () => {
      setRouteState(parseRouteState());
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
    if (!dashboard) {
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
  }, [dashboard?.generatedAt, routeState.actualTemperatureC, routeState.locationId, routeState.selectedInsightTimestamp]);

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

  useEffect(() => {
    if (!imageUrl || !dashboard?.multimodel.imageUrlFound) {
      return;
    }

    const preview = new Image();
    preview.decoding = "async";
    preview.src = imageUrl;
  }, [dashboard?.multimodel.imageUrlFound, imageUrl]);

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
  const homepageReady = Boolean(dashboard) && dashboardMatchesRoute && !dashboardError;
  const peakSummary = displayedAnalysisInsight
    ? buildPeakSummary(displayedAnalysisInsight.peakTimeDistribution, activeLocationTimezone)
    : UI_TEXT.analysis.peakSummaryLoading;

  return (
    <div
      className={`weather-shell ${railExpanded ? "weather-shell-rail-open" : ""} ${isAnalysis ? "weather-shell-analysis" : "weather-shell-home"}`}
      data-page={isAnalysis ? "analysis" : "home"}
    >
      <TerminalBackdrop />

      <CommandHeader
        locationName={homeViewModel.locationName}
        locationTimezone={activeLocationTimezone}
        updatedAt={dashboard?.sync.updatedAt ?? null}
        syncState={dashboard?.sync.state ?? "fresh"}
        refreshState={refreshState}
        refreshDisabled={loadingDashboard}
        isAnalysis={isAnalysis}
        railExpanded={railExpanded}
        favorite={favoriteLocationIds.includes(routeState.locationId)}
        favoriteDisabled={favoritePendingIds.includes(routeState.locationId)}
        favoriteError={favoritesError}
        onToggleRail={() => setRailExpanded((current) => !current)}
        onRefresh={() => void refreshDashboard(true, routeState.locationId)}
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
      />

      {dashboardError ? <WarningLines items={[dashboardError]} /> : null}

      {!homepageReady && !dashboardError ? (
        <section className="terminal-panel flex flex-1 items-center justify-center px-6 py-10">
          <div className="panel-section text-center">
            <div className="eyebrow">{UI_TEXT.app.loadingEyebrow}</div>
            <div className="mt-3 text-3xl font-semibold text-white">{UI_TEXT.app.loadingTitle}</div>
            <div className="mt-3 text-sm text-white/56">{UI_TEXT.app.loadingDescription}</div>
          </div>
        </section>
      ) : null}

      {homepageReady ? (
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
              setDashboardError(null);
              setInsightError(null);
              setDistributionError(null);
              updateRouteState((current) => ({
                ...current,
                locationId: id,
                actualTemperatureC: null,
                selectedInsightTimestamp: null,
                selectedHourlyTimestamp: null,
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
