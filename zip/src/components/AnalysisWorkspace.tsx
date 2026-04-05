import {
  ArrowUpRight,
  BarChart3,
  Clock3,
  Image as ImageIcon,
  Info,
  ShieldCheck,
  Thermometer,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UI_TEXT, translatePredictabilityLabel, translateStatusLabel } from "../display-text";
import type { DashboardViewModel, DistributionViewModel, InsightViewModel } from "../mappers";
import { resolveModelCatalogEntry } from "../model-catalog";
import type { MultiModelDistributionBucket } from "../types";
import { formatDateTime, formatNumber, formatTime } from "../utils";
import { MetricTile } from "./MetricTile";
import { PredictabilityDots } from "./PredictabilityDots";
import { WarningLines } from "./WarningLines";

const DEGREE_C = "°C";
const NO_FILTER_MATCH_TEXT = "当前筛选暂无命中模型。";
const PROVIDER_UPDATE_FALLBACK = "实时 Last update 以 provider 页面为准";

type ActiveDistributionFilter =
  | { kind: "none" }
  | { kind: "peakTime"; timestamp: string }
  | { kind: "currentTempBucket"; label: string }
  | { kind: "dayPeakBucket"; label: string };

type DistributionPreviewItem = {
  key: string;
  label: string;
  count: number;
  ratio: number;
  meta: string;
};

const formatDelta = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "--";
  }

  return `${value > 0 ? "+" : ""}${formatNumber(value)}${DEGREE_C}`;
};

const sumBucketCount = (buckets: MultiModelDistributionBucket[]) =>
  buckets.reduce((sum, bucket) => sum + bucket.count, 0);

const findBucketLabel = (
  buckets: MultiModelDistributionBucket[],
  value: number | null | undefined,
) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return null;
  }

  const match = buckets.find((bucket, index) => {
    const isLast = index === buckets.length - 1;
    return value >= bucket.bucketStartC && (value < bucket.bucketEndC || (isLast && value <= bucket.bucketEndC));
  });

  return match?.label ?? null;
};

const RuntimeRow = ({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string | null;
}) => (
  <div className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-3">
    <div className="eyebrow">{label}</div>
    <div className="mt-2 text-sm font-medium leading-6 text-white">{value}</div>
    {hint ? <div className="mt-1 text-xs leading-5 text-white/48">{hint}</div> : null}
  </div>
);

const DistributionFilterCard = ({
  title,
  icon,
  selectedLabel,
  selectedCount,
  activeKey,
  active,
  loading,
  warning,
  onClear,
  items,
  onToggle,
}: {
  title: string;
  icon: ReactNode;
  selectedLabel: string;
  selectedCount: string;
  activeKey: string | null;
  active: boolean;
  loading: boolean;
  warning: string | null;
  onClear: () => void;
  items: DistributionPreviewItem[];
  onToggle: (key: string) => void;
}) => (
  <section className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="eyebrow flex items-center gap-2">
          {icon}
          {title}
        </div>
        <div className="mt-2 text-sm font-medium text-white">{selectedLabel}</div>
        <div className="mt-1 text-xs text-white/48">{selectedCount}</div>
      </div>
      {active ? (
        <button
          type="button"
          onClick={onClear}
          className="shrink-0 rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-white/58 transition hover:border-white/18 hover:text-white/78"
        >
          {UI_TEXT.analysis.clear}
        </button>
      ) : null}
    </div>

    <div className="mt-4 space-y-2.5">
      {items.length > 0 ? (
        items.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => onToggle(item.key)}
            className={`block w-full rounded-[16px] border px-3 py-2.5 text-left transition ${
              active && activeKey === item.key
                ? "border-[rgba(255,255,255,0.18)] bg-white/[0.06]"
                : "border-white/8 bg-black/20 hover:border-white/16"
            }`}
          >
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium text-white">{item.label}</span>
              <span className="text-white/54">
                {item.count} {UI_TEXT.analysis.modelUnit}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/8">
              <div
                className="h-full rounded-full bg-[linear-gradient(90deg,var(--accent),rgba(255,255,255,0.55))]"
                style={{ width: `${Math.max(8, Math.round(item.ratio * 100))}%` }}
              />
            </div>
            <div className="mt-2 text-[11px] leading-5 text-white/46">{item.meta}</div>
          </button>
        ))
      ) : (
        <div className="rounded-[16px] border border-white/8 bg-black/20 px-3 py-3 text-xs leading-5 text-white/48">
          {loading ? UI_TEXT.analysis.distributionLoading : UI_TEXT.analysis.waitingModelData}
        </div>
      )}
    </div>

    {warning ? <div className="mt-3 text-xs leading-5 text-[var(--warning)]">{warning}</div> : null}
  </section>
);

export const AnalysisWorkspace = ({
  tab,
  insight,
  distribution,
  dashboard,
  locationTimezone,
  imageUrl,
  imageUpdatedAt,
  loadingInsight,
  loadingDistribution,
  insightError,
  distributionError,
  actualTemperatureC,
  warnings,
  peakSummary,
  analysisKey,
  lastConsistentAnalysisKey,
  onTabChange,
}: {
  tab: "models" | "image";
  insight: InsightViewModel | null;
  distribution: DistributionViewModel | null;
  dashboard: DashboardViewModel | null;
  locationTimezone?: string;
  imageUrl: string | null;
  imageUpdatedAt: string | null;
  loadingInsight: boolean;
  loadingDistribution: boolean;
  insightError: string | null;
  distributionError: string | null;
  actualTemperatureC: number | null;
  warnings: string[];
  peakSummary: string;
  analysisKey: string | null;
  lastConsistentAnalysisKey: string | null;
  onTabChange: (tab: "models" | "image") => void;
}) => {
  const reportMetrics = dashboard?.report.metrics ?? null;
  const [hoveredModelName, setHoveredModelName] = useState<string | null>(null);
  const [selectedModelName, setSelectedModelName] = useState<string | null>(null);
  const [activeDistributionFilter, setActiveDistributionFilter] = useState<ActiveDistributionFilter>({ kind: "none" });

  const modelInventory = useMemo(
    () => insight?.modelInventory ?? distribution?.modelInventory ?? [],
    [distribution?.modelInventory, insight?.modelInventory],
  );
  const inventoryByModelName = useMemo(
    () => new Map(modelInventory.map((item) => [item.modelName, item] as const)),
    [modelInventory],
  );
  const catalogByModelName = useMemo(() => {
    const map = new Map<string, ReturnType<typeof resolveModelCatalogEntry>>();
    for (const item of modelInventory) {
      map.set(item.modelName, resolveModelCatalogEntry(item.modelCode ?? item.modelName));
    }
    for (const model of insight?.rankedModels ?? []) {
      if (!map.has(model.modelName)) {
        map.set(model.modelName, resolveModelCatalogEntry(model.modelName));
      }
    }
    return map;
  }, [insight?.rankedModels, modelInventory]);

  const currentDistributionReady = useMemo(() => {
    if (!distribution) {
      return false;
    }
    return (
      distribution.modelCount === distribution.members.length &&
      sumBucketCount(distribution.distribution) === distribution.modelCount
    );
  }, [distribution]);

  const dayPeakDistributionReady = useMemo(() => {
    if (!distribution) {
      return false;
    }
    return (
      distribution.modelCount === distribution.members.length &&
      sumBucketCount(distribution.peakDistribution) === distribution.modelCount
    );
  }, [distribution]);

  const peakSet = useMemo(() => {
    if (activeDistributionFilter.kind !== "peakTime" || !insight) {
      return null;
    }
    const match = insight.peakTimeDistribution.find((item) => item.timestamp === activeDistributionFilter.timestamp);
    return match ? new Set(match.modelNames) : null;
  }, [activeDistributionFilter, insight]);

  const currentBucketSet = useMemo(() => {
    if (activeDistributionFilter.kind !== "currentTempBucket" || !distribution || !currentDistributionReady) {
      return null;
    }
    const match = distribution.distribution.find((bucket) => bucket.label === activeDistributionFilter.label);
    return match ? new Set(match.models) : null;
  }, [activeDistributionFilter, currentDistributionReady, distribution]);

  const dayPeakBucketSet = useMemo(() => {
    if (activeDistributionFilter.kind !== "dayPeakBucket" || !distribution || !dayPeakDistributionReady) {
      return null;
    }
    const match = distribution.peakDistribution.find((bucket) => bucket.label === activeDistributionFilter.label);
    return match ? new Set(match.models) : null;
  }, [activeDistributionFilter, dayPeakDistributionReady, distribution]);

  const filteredModels = useMemo(() => {
    const ranked = insight?.rankedModels ?? [];
    return ranked.filter((model) => {
      if (peakSet && !peakSet.has(model.modelName)) {
        return false;
      }
      if (currentBucketSet && !currentBucketSet.has(model.modelName)) {
        return false;
      }
      if (dayPeakBucketSet && !dayPeakBucketSet.has(model.modelName)) {
        return false;
      }
      return true;
    });
  }, [currentBucketSet, dayPeakBucketSet, insight?.rankedModels, peakSet]);

  const activeModelName = selectedModelName ?? hoveredModelName;
  const activeModel =
    activeModelName && insight ? insight.rankedModels.find((item) => item.modelName === activeModelName) ?? null : null;
  const activeMember =
    activeModelName && distribution
      ? distribution.members.find((item) => item.modelName === activeModelName) ?? null
      : null;
  const activeInventory = activeModelName ? inventoryByModelName.get(activeModelName) ?? null : null;
  const activeCatalog = resolveModelCatalogEntry(activeInventory?.modelCode ?? activeModel?.modelName ?? null);

  const highlightedPeakTimestamp =
    hoveredModelName && insight
      ? insight.rankedModels.find((item) => item.modelName === hoveredModelName)?.dayPeakTimestamp ??
        (activeDistributionFilter.kind === "peakTime" ? activeDistributionFilter.timestamp : null)
      : activeDistributionFilter.kind === "peakTime"
        ? activeDistributionFilter.timestamp
        : null;

  const highlightedCurrentBucketLabel =
    hoveredModelName && distribution
      ? findBucketLabel(
          distribution.distribution,
          distribution.members.find((item) => item.modelName === hoveredModelName)?.temperatureC ?? null,
        ) ?? (activeDistributionFilter.kind === "currentTempBucket" ? activeDistributionFilter.label : null)
      : activeDistributionFilter.kind === "currentTempBucket"
        ? activeDistributionFilter.label
        : null;

  const highlightedDayPeakBucketLabel =
    hoveredModelName && distribution
      ? findBucketLabel(
          distribution.peakDistribution,
          distribution.members.find((item) => item.modelName === hoveredModelName)?.peakTemperatureC ?? null,
        ) ?? (activeDistributionFilter.kind === "dayPeakBucket" ? activeDistributionFilter.label : null)
      : activeDistributionFilter.kind === "dayPeakBucket"
        ? activeDistributionFilter.label
        : null;

  const catalogHitCount = useMemo(
    () => (insight?.rankedModels ?? []).filter((model) => Boolean(catalogByModelName.get(model.modelName))).length,
    [catalogByModelName, insight?.rankedModels],
  );

  const softWarnings = useMemo(() => Array.from(new Set((warnings ?? []).filter(Boolean))), [warnings]);
  const analysisRefreshing = Boolean(
    analysisKey &&
      lastConsistentAnalysisKey &&
      analysisKey !== lastConsistentAnalysisKey &&
      (loadingInsight || loadingDistribution),
  );

  const interactionSummary = useMemo(() => {
    if (selectedModelName) {
      return `${UI_TEXT.analysis.lockedPrefix} ${selectedModelName}`;
    }
    if (hoveredModelName) {
      return `${UI_TEXT.analysis.highlightedPrefix} ${hoveredModelName}`;
    }
    if (activeDistributionFilter.kind === "peakTime") {
      return `${UI_TEXT.analysis.peakPrefix} ${formatTime(activeDistributionFilter.timestamp, locationTimezone)}`;
    }
    if (activeDistributionFilter.kind === "currentTempBucket") {
      return `${UI_TEXT.analysis.bucketPrefix} ${activeDistributionFilter.label}`;
    }
    if (activeDistributionFilter.kind === "dayPeakBucket") {
      return `${UI_TEXT.analysis.highestPeakDistribution} ${activeDistributionFilter.label}`;
    }
    return UI_TEXT.analysis.hoverHint;
  }, [activeDistributionFilter, hoveredModelName, locationTimezone, selectedModelName]);

  const currentFilterSummary = useMemo(() => {
    if (activeDistributionFilter.kind === "peakTime") {
      return formatTime(activeDistributionFilter.timestamp, locationTimezone);
    }
    if (activeDistributionFilter.kind === "currentTempBucket" || activeDistributionFilter.kind === "dayPeakBucket") {
      return activeDistributionFilter.label;
    }
    return UI_TEXT.analysis.filterAll;
  }, [activeDistributionFilter, locationTimezone]);

  const peakCardItems = useMemo<DistributionPreviewItem[]>(
    () =>
      (insight?.peakTimeDistribution ?? []).map((item) => ({
        key: item.timestamp,
        label: formatTime(item.timestamp, locationTimezone),
        count: item.modelCount,
        ratio: insight?.modelCount ? item.modelCount / insight.modelCount : 0,
        meta: `${UI_TEXT.analysis.average} ${formatNumber(item.avgPeakTemperatureC)}${DEGREE_C}`,
      })),
    [insight?.modelCount, insight?.peakTimeDistribution, locationTimezone],
  );

  const currentBucketItems = useMemo<DistributionPreviewItem[]>(
    () =>
      (distribution?.distribution ?? []).map((bucket) => ({
        key: bucket.label,
        label: bucket.label,
        count: bucket.count,
        ratio: distribution?.modelCount ? bucket.count / distribution.modelCount : 0,
        meta: `${formatNumber(bucket.bucketStartC)}${DEGREE_C} - ${formatNumber(bucket.bucketEndC)}${DEGREE_C}`,
      })),
    [distribution?.distribution, distribution?.modelCount],
  );

  const dayPeakBucketItems = useMemo<DistributionPreviewItem[]>(
    () =>
      (distribution?.peakDistribution ?? []).map((bucket) => ({
        key: bucket.label,
        label: bucket.label,
        count: bucket.count,
        ratio: distribution?.modelCount ? bucket.count / distribution.modelCount : 0,
        meta: `${formatNumber(bucket.bucketStartC)}${DEGREE_C} - ${formatNumber(bucket.bucketEndC)}${DEGREE_C}`,
      })),
    [distribution?.modelCount, distribution?.peakDistribution],
  );

  const currentDistributionWarning =
    distributionError ?? (!loadingDistribution && distribution && !currentDistributionReady ? UI_TEXT.analysis.integrityIssue : null);
  const dayPeakDistributionWarning =
    distributionError ?? (!loadingDistribution && distribution && !dayPeakDistributionReady ? UI_TEXT.analysis.integrityIssue : null);

  const pageUpdateValue = useMemo(() => {
    if (activeInventory?.pageLastUpdatedLabel) {
      return activeInventory.pageLastUpdatedLabel;
    }
    if (activeInventory?.pageLastUpdatedAt) {
      return formatDateTime(activeInventory.pageLastUpdatedAt, locationTimezone);
    }
    if (activeCatalog?.sourceLevel === "provider" || /wrf/i.test(activeModel?.modelName ?? "")) {
      return PROVIDER_UPDATE_FALLBACK;
    }
    return UI_TEXT.analysis.profileCurrentRunUnavailable;
  }, [activeCatalog?.sourceLevel, activeInventory?.pageLastUpdatedAt, activeInventory?.pageLastUpdatedLabel, activeModel?.modelName, locationTimezone]);

  const officialCadenceValue = activeCatalog?.officialUpdateCadence ?? activeCatalog?.updateCadence ?? "--";
  const fetchedAtValue = distribution?.fetchedAt
    ? formatDateTime(distribution.fetchedAt, locationTimezone)
    : insight?.fetchedAt
      ? formatDateTime(insight.fetchedAt, locationTimezone)
      : "--";
  const hasPeakSummary = Boolean(insight?.peakTimeDistribution.length || distribution?.peakDistribution.length);

  return (
    <section className="analysis-panel terminal-panel">
      <Tabs value={tab} onValueChange={(value) => onTabChange(value as "models" | "image")} className="panel-section flex h-full min-h-0 flex-col gap-4 p-5">
        <div className="analysis-header">
          <div>
            <div className="eyebrow">{UI_TEXT.analysis.eyebrow}</div>
            <h2 className="mt-3 text-[2rem] font-semibold tracking-[-0.04em] text-white">{UI_TEXT.analysis.title}</h2>
            <p className="mt-2 text-sm leading-6 text-white/58">{UI_TEXT.analysis.description}</p>
          </div>
          <TabsList>
            <TabsTrigger value="models">{UI_TEXT.analysis.modelsTab}</TabsTrigger>
            <TabsTrigger value="image">{UI_TEXT.analysis.imageTab}</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="models" className="min-h-0 flex-1">
          <ScrollArea className="h-full rounded-[26px] border border-white/8 bg-white/[0.025]">
            <div className="analysis-content space-y-4 p-4">
              <div className="metric-grid">
                <MetricTile label={UI_TEXT.analysis.referenceTemperature} value={actualTemperatureC !== null ? `${formatNumber(actualTemperatureC)}${DEGREE_C}` : "--"} caption={UI_TEXT.header.home} tone="accent" />
                <MetricTile label={UI_TEXT.analysis.modelCount} value={insight ? String(insight.modelCount) : "--"} caption={insight?.selectedTimestamp ? formatDateTime(insight.selectedTimestamp, locationTimezone) : UI_TEXT.analysis.waitingModelData} />
                <MetricTile label={UI_TEXT.analysis.temperatureSpread} value={distribution ? `${formatNumber(distribution.highlights.spreadTemperatureC)}${DEGREE_C}` : "--"} caption={UI_TEXT.analysis.temperatureSpreadCaption} tone="warning" />
                <MetricTile label={UI_TEXT.analysis.catalogCoverage} value={insight ? `${catalogHitCount}/${insight.modelCount}` : "--"} caption={interactionSummary} tone="success" />
              </div>

              {softWarnings.length > 0 ? <WarningLines items={softWarnings.slice(0, 4)} /> : null}

              <div className="analysis-models-layout">
                <div className="space-y-4">
                  <section className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="eyebrow">{UI_TEXT.analysis.filterState}</div>
                        <div className="mt-2 text-sm font-medium text-white">{currentFilterSummary}</div>
                        <div className="mt-1 text-xs text-white/48">{filteredModels.length} {UI_TEXT.analysis.modelUnit} · {analysisRefreshing ? UI_TEXT.analysis.distributionLoading : UI_TEXT.analysis.localFilterOnly}</div>
                      </div>
                      {activeDistributionFilter.kind !== "none" ? (
                        <button type="button" onClick={() => setActiveDistributionFilter({ kind: "none" })} className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-xs text-white/58 transition hover:border-white/18 hover:text-white/78">
                          {UI_TEXT.analysis.clearAll}
                        </button>
                      ) : null}
                    </div>

                    <div className="mt-4 grid gap-4 xl:grid-cols-3">
                      <DistributionFilterCard
                        title={UI_TEXT.analysis.peakDistribution}
                        icon={<Clock3 className="h-4 w-4 text-[var(--warning)]" />}
                        selectedLabel={activeDistributionFilter.kind === "peakTime" ? formatTime(activeDistributionFilter.timestamp, locationTimezone) : UI_TEXT.analysis.defaultBucketState}
                        selectedCount={`${activeDistributionFilter.kind === "peakTime" && peakSet ? peakSet.size : insight?.modelCount ?? 0} ${UI_TEXT.analysis.modelUnit}`}
                        activeKey={activeDistributionFilter.kind === "peakTime" ? activeDistributionFilter.timestamp : null}
                        active={activeDistributionFilter.kind === "peakTime"}
                        loading={loadingInsight}
                        warning={insightError}
                        onClear={() => setActiveDistributionFilter({ kind: "none" })}
                        items={peakCardItems}
                        onToggle={(timestamp) => setActiveDistributionFilter((current) => current.kind === "peakTime" && current.timestamp === timestamp ? { kind: "none" } : { kind: "peakTime", timestamp })}
                      />
                      <DistributionFilterCard
                        title={UI_TEXT.analysis.temperatureDistribution}
                        icon={<Thermometer className="h-4 w-4 text-[var(--accent-secondary)]" />}
                        selectedLabel={activeDistributionFilter.kind === "currentTempBucket" ? activeDistributionFilter.label : UI_TEXT.analysis.defaultBucketState}
                        selectedCount={`${activeDistributionFilter.kind === "currentTempBucket" && currentBucketSet ? currentBucketSet.size : distribution?.modelCount ?? 0} ${UI_TEXT.analysis.modelUnit}`}
                        activeKey={activeDistributionFilter.kind === "currentTempBucket" ? activeDistributionFilter.label : null}
                        active={activeDistributionFilter.kind === "currentTempBucket"}
                        loading={loadingDistribution}
                        warning={currentDistributionWarning}
                        onClear={() => setActiveDistributionFilter({ kind: "none" })}
                        items={currentBucketItems}
                        onToggle={(label) => setActiveDistributionFilter((current) => current.kind === "currentTempBucket" && current.label === label ? { kind: "none" } : { kind: "currentTempBucket", label })}
                      />
                      <DistributionFilterCard
                        title={UI_TEXT.analysis.highestPeakDistribution}
                        icon={<BarChart3 className="h-4 w-4 text-[var(--accent)]" />}
                        selectedLabel={activeDistributionFilter.kind === "dayPeakBucket" ? activeDistributionFilter.label : UI_TEXT.analysis.defaultBucketState}
                        selectedCount={`${activeDistributionFilter.kind === "dayPeakBucket" && dayPeakBucketSet ? dayPeakBucketSet.size : distribution?.modelCount ?? 0} ${UI_TEXT.analysis.modelUnit}`}
                        activeKey={activeDistributionFilter.kind === "dayPeakBucket" ? activeDistributionFilter.label : null}
                        active={activeDistributionFilter.kind === "dayPeakBucket"}
                        loading={loadingDistribution}
                        warning={dayPeakDistributionWarning}
                        onClear={() => setActiveDistributionFilter({ kind: "none" })}
                        items={dayPeakBucketItems}
                        onToggle={(label) => setActiveDistributionFilter((current) => current.kind === "dayPeakBucket" && current.label === label ? { kind: "none" } : { kind: "dayPeakBucket", label })}
                      />
                    </div>
                  </section>

                  <section className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="eyebrow flex items-center gap-2"><BarChart3 className="h-4 w-4 text-[var(--accent)]" />{UI_TEXT.analysis.fullRanking}</div>
                      {selectedModelName ? <button type="button" onClick={() => setSelectedModelName(null)} className="text-xs text-white/48 transition hover:text-white/72">{UI_TEXT.analysis.clearLock}</button> : null}
                    </div>
                    <div className="mt-4 space-y-3">
                      {filteredModels.length > 0 ? filteredModels.map((model, index) => {
                        const active = activeModelName === model.modelName;
                        const matchedPeak = highlightedPeakTimestamp && model.dayPeakTimestamp === highlightedPeakTimestamp;
                        const matchedCurrentBucket = currentBucketSet?.has(model.modelName) ?? false;
                        const matchedDayPeakBucket = dayPeakBucketSet?.has(model.modelName) ?? false;
                        const catalogEntry = catalogByModelName.get(model.modelName);
                        return (
                          <article key={`${model.modelName}-${model.dayPeakTimestamp ?? "none"}`} onMouseEnter={() => setHoveredModelName(model.modelName)} onMouseLeave={() => setHoveredModelName(null)} onClick={() => setSelectedModelName((current) => current === model.modelName ? null : model.modelName)} className={`grid cursor-pointer gap-3 rounded-[22px] border px-4 py-4 transition md:grid-cols-[72px_minmax(0,1fr)_220px] ${active || matchedPeak || matchedCurrentBucket || matchedDayPeakBucket ? "border-[rgba(56,214,180,0.22)] bg-[rgba(56,214,180,0.08)]" : "border-white/8 bg-black/20 hover:border-white/16"}`}>
                            <div className="data-mono text-2xl font-semibold text-white/72">#{index + 1}</div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="text-lg font-semibold text-white">{model.modelName}</div>
                                {catalogEntry ? <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[11px] text-white/54">{UI_TEXT.analysis.hasCatalog}</span> : null}
                              </div>
                              <div className="mt-1 text-sm text-white/56">{UI_TEXT.analysis.currentPrediction} {formatNumber(model.currentTemperatureC)}{DEGREE_C} · {UI_TEXT.analysis.deviation} {formatDelta(model.deltaToActualTemperatureC)}</div>
                            </div>
                            <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-3">
                              <div className="eyebrow">{UI_TEXT.analysis.dayPeakTemperature}</div>
                              <div className="data-mono mt-2 text-2xl font-semibold text-white">{formatNumber(model.dayPeakTemperatureC)}{DEGREE_C}</div>
                              <div className="mt-2 text-xs text-white/54">{model.dayPeakTimestamp ? formatDateTime(model.dayPeakTimestamp, locationTimezone) : UI_TEXT.analysis.noPeakMoment}</div>
                            </div>
                          </article>
                        );
                      }) : <div className="rounded-[20px] border border-white/8 bg-black/20 px-4 py-5 text-sm leading-6 text-white/56">{NO_FILTER_MATCH_TEXT}</div>}
                    </div>
                    {loadingInsight ? <div className="mt-4 text-xs text-white/54">{UI_TEXT.analysis.rankingLoading}</div> : null}
                    {insightError ? <div className="mt-3 text-sm text-[var(--warning)]">{insightError}</div> : null}
                  </section>

                  <div className="analysis-grid analysis-grid-secondary">
                    <section className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                      <div className="eyebrow flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-[var(--success)]" />{UI_TEXT.analysis.sourceProof}</div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <MetricTile label={UI_TEXT.analysis.chartSource} value={insight?.sourceProof.chartFormat ?? "--"} caption={insight?.sourceProof.chartEndpoint ?? "--"} />
                        <MetricTile label={UI_TEXT.analysis.timestampSource} value={insight?.sourceProof.timestampSource ?? "--"} caption={`${UI_TEXT.analysis.sampleCount} ${insight?.sourceProof.timestampCount ?? "--"}`} />
                      </div>
                    </section>

                    <section className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                      <div className="eyebrow">{UI_TEXT.analysis.extendedMetrics}</div>
                      <div className="mt-4 space-y-4">
                        <MetricTile label={UI_TEXT.analysis.maxTemperature} value={reportMetrics?.maxTemperatureC !== null && reportMetrics?.maxTemperatureC !== undefined ? `${formatNumber(reportMetrics.maxTemperatureC)}${DEGREE_C}` : "--"} caption={reportMetrics?.forecastDayLabel ?? UI_TEXT.analysis.weatherReport} tone="warning" />
                        <MetricTile label={UI_TEXT.analysis.uvIndex} value={reportMetrics?.uvIndex !== null && reportMetrics?.uvIndex !== undefined ? formatNumber(reportMetrics.uvIndex, 0) : "--"} caption={UI_TEXT.analysis.fromWeatherReport} tone="accent" />
                        <PredictabilityDots score={reportMetrics?.predictabilityScore ?? null} label={`${UI_TEXT.analysis.predictabilityPrefix} ${translatePredictabilityLabel(reportMetrics?.predictability) ?? "--"}`} />
                      </div>
                    </section>
                  </div>
                </div>

                <aside className="analysis-side-panel space-y-4">
                  <section className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="eyebrow flex items-center gap-2"><Info className="h-4 w-4 text-[var(--accent)]" />{UI_TEXT.analysis.modelProfile}</div>
                      {selectedModelName ? <button type="button" onClick={() => setSelectedModelName(null)} className="text-xs text-white/48 transition hover:text-white/72">{UI_TEXT.analysis.clearLock}</button> : null}
                    </div>

                    {!activeModel ? (
                      <div className="mt-4 space-y-4">
                        <div className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-4 text-sm leading-6 text-white/60">{UI_TEXT.analysis.modelProfileHint}</div>
                        <MetricTile label={UI_TEXT.analysis.profileCoverage} value={insight ? `${catalogHitCount}/${insight.modelCount}` : "--"} caption={UI_TEXT.analysis.dynamicJoinCaption} />
                        <MetricTile label={UI_TEXT.analysis.interactionState} value={interactionSummary} caption={analysisRefreshing ? UI_TEXT.analysis.distributionLoading : UI_TEXT.analysis.interactionClickHint} />
                      </div>
                    ) : (
                      <div className="mt-4 space-y-4">
                        <div className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-4">
                          <div className="text-lg font-semibold text-white">{activeModel.modelName}</div>
                          <div className="mt-1 text-sm text-white/54">{activeCatalog?.fullName ?? UI_TEXT.analysis.staticProfileMissing}</div>
                          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                            <MetricTile label={UI_TEXT.analysis.currentPrediction} value={`${formatNumber(activeModel.currentTemperatureC)}${DEGREE_C}`} caption={`${UI_TEXT.analysis.deviation} ${formatDelta(activeModel.deltaToActualTemperatureC)}`} tone="accent" />
                            <MetricTile label={UI_TEXT.analysis.dayPeakTemperature} value={`${formatNumber(activeModel.dayPeakTemperatureC)}${DEGREE_C}`} caption={activeModel.dayPeakTimestamp ? formatDateTime(activeModel.dayPeakTimestamp, locationTimezone) : "--"} tone="warning" />
                          </div>
                        </div>

                        <div className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-4 text-sm leading-6 text-white/64">
                          <div>{UI_TEXT.analysis.profileOrganization}：{activeCatalog?.agency ?? "--"}</div>
                          <div>{UI_TEXT.analysis.profileType}：{activeCatalog?.domainType ?? "--"}</div>
                          <div>{UI_TEXT.analysis.profileCoverageLabel}：{activeCatalog?.coverage ?? "--"}</div>
                          <div>{UI_TEXT.analysis.profileResolution}：{activeCatalog?.resolutionLabel ?? "--"}</div>
                          <div>{UI_TEXT.analysis.profileUpdate}：{officialCadenceValue}</div>
                          <div>{UI_TEXT.analysis.profileHorizon}：{activeCatalog?.forecastHorizon ?? "--"}</div>
                        </div>

                        <div className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-4">
                          <div className="text-sm font-medium text-white">{UI_TEXT.analysis.profileRuntime}</div>
                          <div className="mt-3 grid gap-3">
                            <RuntimeRow label={UI_TEXT.analysis.profilePageUpdate} value={pageUpdateValue} hint={activeInventory?.sourceProvider ?? activeInventory?.sourceDisplayName ?? null} />
                            <RuntimeRow label={UI_TEXT.analysis.profileOfficialCadence} value={officialCadenceValue} hint={activeCatalog?.officialVerifiedAt ? `${UI_TEXT.analysis.profileVerifiedAt} ${activeCatalog.officialVerifiedAt}` : null} />
                            <RuntimeRow label={UI_TEXT.analysis.profileFetchedAt} value={fetchedAtValue} hint={activeInventory?.pageOrder ? `#${activeInventory.pageOrder}` : null} />
                          </div>
                        </div>

                        {activeCatalog ? (
                          <div className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-4 text-sm leading-6 text-white/64">
                            <div className="text-sm font-medium text-white">{UI_TEXT.analysis.profileStrengths}</div>
                            {activeCatalog.strengthsZh.map((item) => <div key={item}>- {item}</div>)}
                            <div className="mt-3 text-sm font-medium text-white">{UI_TEXT.analysis.profileLimits}</div>
                            {activeCatalog.limitsZh.map((item) => <div key={item}>- {item}</div>)}
                          </div>
                        ) : null}

                        <div className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-4 text-sm leading-6 text-white/64">
                          <div>{UI_TEXT.analysis.profileDistributionTemp}：{activeMember ? `${formatNumber(activeMember.temperatureC)}${DEGREE_C}` : "--"}</div>
                          <div>{UI_TEXT.analysis.profileBucket}：{highlightedCurrentBucketLabel ?? "--"}</div>
                          <div>{UI_TEXT.analysis.highestPeakDistribution}：{highlightedDayPeakBucketLabel ?? "--"}</div>
                          <div>{UI_TEXT.analysis.profilePeakHit}：{activeDistributionFilter.kind === "peakTime" ? activeModel.dayPeakTimestamp === activeDistributionFilter.timestamp ? UI_TEXT.analysis.hit : UI_TEXT.analysis.miss : "--"}</div>
                          <div>{UI_TEXT.analysis.profileNotes}：{activeCatalog?.notes ?? "--"}</div>
                        </div>

                        <div className="rounded-[18px] border border-[rgba(242,183,109,0.2)] bg-[rgba(242,183,109,0.08)] px-4 py-4 text-sm leading-6 text-white/66">{UI_TEXT.analysis.profileDisclaimer}</div>
                        {activeCatalog?.officialSourceUrl ? <a href={activeCatalog.officialSourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm text-white/72 transition hover:text-white">{UI_TEXT.analysis.openOfficialSource}<ArrowUpRight className="h-4 w-4" /></a> : null}
                      </div>
                    )}
                  </section>
                </aside>
              </div>
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="image" className="min-h-0 flex-1">
          <div className="analysis-image-layout">
            <section className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="eyebrow flex items-center gap-2"><ImageIcon className="h-4 w-4 text-[var(--accent)]" />{UI_TEXT.analysis.officialImage}</div>
                  <h3 className="mt-3 text-2xl font-semibold text-white">{UI_TEXT.analysis.officialImageViewer}</h3>
                  <p className="mt-2 text-sm leading-6 text-white/58">{UI_TEXT.analysis.officialImageDescription}</p>
                </div>
                {imageUrl ? <a href={imageUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white/72 transition hover:border-white/18 hover:text-white">{UI_TEXT.analysis.openInNewTab}<ArrowUpRight className="h-4 w-4" /></a> : null}
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-4">
                <MetricTile label={UI_TEXT.analysis.currentStatus} value={translateStatusLabel(dashboard?.multimodel.statusLabel ?? null)} caption={dashboard?.multimodel.stale ? UI_TEXT.analysis.cachedVersionCaption : UI_TEXT.analysis.latestVersionCaption} tone={dashboard?.multimodel.stale ? "warning" : "success"} />
                <MetricTile label={UI_TEXT.analysis.displayVersion} value={dashboard?.multimodel.stale ? UI_TEXT.analysis.cachedImage : UI_TEXT.analysis.latestImage} caption={dashboard?.multimodel.lastError ? UI_TEXT.analysis.backgroundRefreshFailed : UI_TEXT.analysis.backgroundRefreshReady} />
                <MetricTile label={UI_TEXT.analysis.readTime} value={imageUpdatedAt ? formatDateTime(imageUpdatedAt, locationTimezone) : "--"} caption={UI_TEXT.analysis.prewarmHint} />
                <MetricTile label={UI_TEXT.analysis.peakSummary} value={hasPeakSummary ? UI_TEXT.analysis.available : "--"} caption={peakSummary} tone="accent" />
              </div>
            </section>

            <section className="analysis-image-canvas rounded-[24px] border border-white/8 bg-black/20">
              {imageUrl ? <div className="analysis-image-scroll"><img src={imageUrl} alt="meteoblue official multimodel chart" className="analysis-image rounded-[20px] border border-white/8 bg-black/30 shadow-[0_18px_60px_rgba(0,0,0,0.28)]" decoding="async" fetchPriority="high" /></div> : <div className="flex h-full min-h-[380px] items-center justify-center px-6 text-sm text-white/58">{UI_TEXT.analysis.imageUnavailable}</div>}
            </section>
          </div>
        </TabsContent>
      </Tabs>
    </section>
  );
};
