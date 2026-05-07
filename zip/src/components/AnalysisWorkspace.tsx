import {
  ArrowUpRight,
  BarChart3,
  ChevronDown,
  ChevronUp,
  Clock3,
  Image as ImageIcon,
  Info,
  ShieldCheck,
  Thermometer,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  UI_TEXT,
  describeMultimodelStatus,
  translatePredictabilityLabel,
  translateStatusLabel,
} from "../display-text";
import type { DashboardViewModel, DistributionViewModel, InsightViewModel } from "../mappers";
import { resolveModelCatalogEntry } from "../model-catalog";
import type { KellyTemperatureUnit, MultiModelDistributionBucket } from "../types";
import { formatDateTime, formatNumber, formatTemperature, formatTemperatureDelta, formatTime } from "../utils";
import { MetricTile } from "./MetricTile";
import { PredictabilityDots } from "./PredictabilityDots";
import { WarningLines } from "./WarningLines";

const NO_FILTER_MATCH_TEXT = "当前筛选暂无命中模型。";
const PROVIDER_UPDATE_FALLBACK = "实时 Last update 以 provider 页面为准";

const WEATHER_TIMESTAMP_LABEL = "天气时刻";
const MODEL_TIMESTAMP_LABEL = "模型时刻";
const WEATHER_TIMESTAMP_PENDING = "等待天气时刻";
const MODEL_TIMESTAMP_PENDING = "等待模型时刻";
const ANALYSIS_STATE_LABEL = "分析状态";
const IMAGE_STATE_LABEL = "原图状态";
const resolveStatusTone = (status: "ready" | "revalidating" | "fallback_error" | "unavailable") => {
  if (status === "ready") {
    return "success" as const;
  }
  if (status === "revalidating") {
    return "accent" as const;
  }
  return "warning" as const;
};

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

  return value > 0 ? `+${formatNumber(value)}` : formatNumber(value);
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

const formatBucketRangeLabel = (
  bucket: MultiModelDistributionBucket,
  displayUnit: KellyTemperatureUnit,
) =>
  `${formatTemperature(bucket.bucketStartC, displayUnit)} - ${formatTemperature(bucket.bucketEndC, displayUnit)}`;

const formatBucketLabelFromKey = (
  buckets: MultiModelDistributionBucket[] | null | undefined,
  label: string | null | undefined,
  displayUnit: KellyTemperatureUnit,
) => {
  if (!label) {
    return null;
  }

  const match = buckets?.find((item) => item.label === label);
  if (!match) {
    return label;
  }

  return formatBucketRangeLabel(match, displayUnit);
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

const ANALYSIS_CONFIDENCE_LABEL = {
  high: "高",
  medium: "中",
  low: "低",
} as const;

const ANALYSIS_SOURCE_STATUS_LABEL: Record<string, string> = {
  production: "已接入",
  planned: "计划接入",
  candidate: "待确认",
  unavailable: "暂不可用",
};

const describeAnalysisReferenceStation = (sourceMetadata: DashboardViewModel["sourceMetadata"]) =>
  sourceMetadata.contract.settlementReference.stationCode ?? sourceMetadata.contract.settlementReference.label;

const AnalysisStatusPill = ({
  label,
  tone = "muted",
}: {
  label: string;
  tone?: "good" | "warn" | "muted";
}) => (
  <span
    className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] ${
      tone === "good"
        ? "border-[rgba(216,255,79,0.24)] bg-[rgba(216,255,79,0.1)] text-[var(--accent)]"
        : tone === "warn"
          ? "border-[rgba(255,200,107,0.24)] bg-[rgba(255,200,107,0.1)] text-[var(--warning)]"
          : "border-white/10 bg-white/[0.03] text-white/54"
    }`}
  >
    {label}
  </span>
);

const CompactInfoCard = ({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string | null;
}) => (
  <div className="analysis-compact-info">
    <span className="analysis-compact-info__label">{label}</span>
    <strong className="analysis-compact-info__value">{value}</strong>
    {hint ? <span className="analysis-compact-info__hint">{hint}</span> : null}
  </div>
);

const CompactToggleButton = ({
  label,
  value,
  hint,
  active = false,
  expanded = false,
  onClick,
}: {
  label: string;
  value: string;
  hint?: string | null;
  active?: boolean;
  expanded?: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    className={`analysis-compact-toggle${active ? " is-active" : ""}${expanded ? " is-expanded" : ""}`}
    aria-expanded={expanded}
    onClick={onClick}
  >
    <span className="analysis-compact-toggle__copy">
      <span className="analysis-compact-toggle__label">{label}</span>
      <strong className="analysis-compact-toggle__value">{value}</strong>
      {hint ? <span className="analysis-compact-toggle__hint">{hint}</span> : null}
    </span>
    {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
  </button>
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
  emptyStateText,
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
  emptyStateText?: string;
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
          {loading ? UI_TEXT.analysis.distributionLoading : (emptyStateText ?? UI_TEXT.analysis.waitingModelData)}
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
  displayUnit,
  locationTimezone,
  selectedWeatherTimestamp,
  selectedModelTimestamp,
  analysisStatus,
  imageStatus,
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
  analysisRefreshing,
  pageLoading,
  mobileLayout,
  onTabChange,
}: {
  tab: "models" | "image";
  insight: InsightViewModel | null;
  distribution: DistributionViewModel | null;
  dashboard: DashboardViewModel | null;
  displayUnit: KellyTemperatureUnit;
  locationTimezone?: string;
  selectedWeatherTimestamp: string | null;
  selectedModelTimestamp: string | null;
  analysisStatus: DashboardViewModel["multimodel"]["analysisStatus"];
  imageStatus: DashboardViewModel["multimodel"]["imageStatus"];
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
  analysisRefreshing: boolean;
  pageLoading: boolean;
  mobileLayout: boolean;
  onTabChange: (tab: "models" | "image") => void;
}) => {
  const reportMetrics = dashboard?.report.metrics ?? null;
  const intradaySignals = dashboard?.intradaySignals ?? null;
  const sourceMetadata = dashboard?.sourceMetadata ?? null;
  const marketReference = dashboard?.marketReference ?? null;
  const [hoveredModelName, setHoveredModelName] = useState<string | null>(null);
  const [selectedModelName, setSelectedModelName] = useState<string | null>(null);
  const [activeDistributionFilter, setActiveDistributionFilter] = useState<ActiveDistributionFilter>({ kind: "none" });
  const [expandedFilterKind, setExpandedFilterKind] = useState<Exclude<ActiveDistributionFilter["kind"], "none"> | null>(
    null,
  );
  const [showAlphaEvidence, setShowAlphaEvidence] = useState(false);
  const [showContextDetails, setShowContextDetails] = useState(false);
  const [showProfileRuntime, setShowProfileRuntime] = useState(false);
  const [showProfileStrengths, setShowProfileStrengths] = useState(false);
  const [showProfileContext, setShowProfileContext] = useState(false);
  const [showMobileFilterSheet, setShowMobileFilterSheet] = useState(false);
  const [showMobileInspectorSheet, setShowMobileInspectorSheet] = useState(false);

  const isMobileLayout = mobileLayout;

  useEffect(() => {
    if (isMobileLayout) {
      setHoveredModelName(null);
      return;
    }
    setShowMobileFilterSheet(false);
    setShowMobileInspectorSheet(false);
  }, [isMobileLayout]);

  useEffect(() => {
    setHoveredModelName(null);
    setSelectedModelName(null);
    setActiveDistributionFilter({ kind: "none" });
    setExpandedFilterKind(null);
    setShowAlphaEvidence(false);
    setShowContextDetails(false);
    setShowProfileRuntime(false);
    setShowProfileStrengths(false);
    setShowProfileContext(false);
    setShowMobileFilterSheet(false);
    setShowMobileInspectorSheet(false);
  }, [analysisKey, lastConsistentAnalysisKey]);

  useEffect(() => {
    if (!selectedModelName) {
      setShowProfileRuntime(false);
      setShowProfileStrengths(false);
      setShowProfileContext(false);
      return;
    }

    setShowProfileStrengths(true);
  }, [selectedModelName]);

  useEffect(() => {
    if (activeDistributionFilter.kind === "none") {
      return;
    }

    setExpandedFilterKind((current) =>
      current === activeDistributionFilter.kind ? current : activeDistributionFilter.kind,
    );
  }, [activeDistributionFilter]);

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

  const previewModelName = filteredModels[0]?.modelName ?? insight?.rankedModels[0]?.modelName ?? null;
  const activeModelName = isMobileLayout ? selectedModelName : selectedModelName ?? hoveredModelName ?? previewModelName;
  const highlightedModelName = isMobileLayout ? selectedModelName : hoveredModelName;
  const activeModel =
    activeModelName && insight ? insight.rankedModels.find((item) => item.modelName === activeModelName) ?? null : null;
  const activeMember =
    activeModelName && distribution
      ? distribution.members.find((item) => item.modelName === activeModelName) ?? null
      : null;
  const activeInventory = activeModelName ? inventoryByModelName.get(activeModelName) ?? null : null;
  const activeCatalog = resolveModelCatalogEntry(activeInventory?.modelCode ?? activeModel?.modelName ?? null);

  const highlightedPeakTimestamp =
    highlightedModelName && insight
      ? insight.rankedModels.find((item) => item.modelName === highlightedModelName)?.dayPeakTimestamp ??
        (activeDistributionFilter.kind === "peakTime" ? activeDistributionFilter.timestamp : null)
      : activeDistributionFilter.kind === "peakTime"
        ? activeDistributionFilter.timestamp
        : null;

  const highlightedCurrentBucketLabel =
    highlightedModelName && distribution
      ? findBucketLabel(
          distribution.distribution,
          distribution.members.find((item) => item.modelName === highlightedModelName)?.temperatureC ?? null,
        ) ?? (activeDistributionFilter.kind === "currentTempBucket" ? activeDistributionFilter.label : null)
      : activeDistributionFilter.kind === "currentTempBucket"
        ? activeDistributionFilter.label
        : null;

  const highlightedDayPeakBucketLabel =
    highlightedModelName && distribution
      ? findBucketLabel(
          distribution.peakDistribution,
          distribution.members.find((item) => item.modelName === highlightedModelName)?.peakTemperatureC ?? null,
        ) ?? (activeDistributionFilter.kind === "dayPeakBucket" ? activeDistributionFilter.label : null)
      : activeDistributionFilter.kind === "dayPeakBucket"
        ? activeDistributionFilter.label
        : null;

  const highlightedCurrentBucketLabelDisplay = formatBucketLabelFromKey(
    distribution?.distribution,
    highlightedCurrentBucketLabel,
    displayUnit,
  );
  const highlightedDayPeakBucketLabelDisplay = formatBucketLabelFromKey(
    distribution?.peakDistribution,
    highlightedDayPeakBucketLabel,
    displayUnit,
  );

  const catalogHitCount = useMemo(
    () => (insight?.rankedModels ?? []).filter((model) => Boolean(catalogByModelName.get(model.modelName))).length,
    [catalogByModelName, insight?.rankedModels],
  );

  const softWarnings = useMemo(() => Array.from(new Set((warnings ?? []).filter(Boolean))), [warnings]);
  const resolvedAnalysisStatus = analysisStatus ?? "unavailable";
  const resolvedImageStatus = imageStatus ?? "unavailable";
  const analysisStatusCaption = describeMultimodelStatus("analysis", resolvedAnalysisStatus);
  const imageStatusCaption = describeMultimodelStatus("image", resolvedImageStatus);
  const weatherTimestampValue = selectedWeatherTimestamp
    ? formatTime(selectedWeatherTimestamp, locationTimezone)
    : "--";
  const weatherTimestampCaption = selectedWeatherTimestamp
    ? formatDateTime(selectedWeatherTimestamp, locationTimezone)
    : WEATHER_TIMESTAMP_PENDING;
  const modelTimestampValue = selectedModelTimestamp
    ? formatTime(selectedModelTimestamp, locationTimezone)
    : "--";
  const modelTimestampCaption = selectedModelTimestamp
    ? formatDateTime(selectedModelTimestamp, locationTimezone)
    : MODEL_TIMESTAMP_PENDING;
  const analysisUnavailable =
    !loadingInsight &&
    !loadingDistribution &&
    !insight &&
    !distribution &&
    !insightError &&
    !distributionError;
  const analysisEmptyStateText =
    !loadingInsight &&
    !loadingDistribution &&
    !insight &&
    !distribution &&
    !insightError &&
    !distributionError
      ? UI_TEXT.analysis.waitingModelData
      : undefined;

  const currentBucketSelectedLabel =
    activeDistributionFilter.kind === "currentTempBucket"
      ? formatBucketLabelFromKey(distribution?.distribution, activeDistributionFilter.label, displayUnit)
      : null;
  const dayPeakBucketSelectedLabel =
    activeDistributionFilter.kind === "dayPeakBucket"
      ? formatBucketLabelFromKey(distribution?.peakDistribution, activeDistributionFilter.label, displayUnit)
      : null;

  const interactionSummary = useMemo(() => {
    if (selectedModelName) {
      return `${UI_TEXT.analysis.lockedPrefix} ${selectedModelName}`;
    }
    if (!isMobileLayout && hoveredModelName) {
      return `${UI_TEXT.analysis.highlightedPrefix} ${hoveredModelName}`;
    }
    if (activeDistributionFilter.kind === "peakTime") {
      return `${UI_TEXT.analysis.peakPrefix} ${formatTime(activeDistributionFilter.timestamp, locationTimezone)}`;
    }
    if (activeDistributionFilter.kind === "currentTempBucket") {
      return `${UI_TEXT.analysis.bucketPrefix} ${
        currentBucketSelectedLabel ?? activeDistributionFilter.label ?? UI_TEXT.analysis.defaultBucketState
      }`;
    }
    if (activeDistributionFilter.kind === "dayPeakBucket") {
      return `${UI_TEXT.analysis.highestPeakDistribution} ${
        dayPeakBucketSelectedLabel ?? activeDistributionFilter.label ?? UI_TEXT.analysis.defaultBucketState
      }`;
    }
    return isMobileLayout ? UI_TEXT.analysis.tapHint : UI_TEXT.analysis.hoverHint;
  }, [
    activeDistributionFilter,
    currentBucketSelectedLabel,
    dayPeakBucketSelectedLabel,
    hoveredModelName,
    isMobileLayout,
    locationTimezone,
    selectedModelName,
  ]);

  const currentFilterSummary = useMemo(() => {
    if (activeDistributionFilter.kind === "peakTime") {
      return formatTime(activeDistributionFilter.timestamp, locationTimezone);
    }
    if (activeDistributionFilter.kind === "currentTempBucket") {
      return currentBucketSelectedLabel ?? activeDistributionFilter.label ?? UI_TEXT.analysis.filterAll;
    }
    if (activeDistributionFilter.kind === "dayPeakBucket") {
      return dayPeakBucketSelectedLabel ?? activeDistributionFilter.label ?? UI_TEXT.analysis.filterAll;
    }
    return UI_TEXT.analysis.filterAll;
  }, [activeDistributionFilter, currentBucketSelectedLabel, dayPeakBucketSelectedLabel, locationTimezone]);
  const hasActiveFilter = activeDistributionFilter.kind !== "none";
  const mobileFilterSummary =
    activeDistributionFilter.kind === "none"
      ? `${UI_TEXT.analysis.filterState} ${UI_TEXT.analysis.filterAll}`
      : interactionSummary;
  const clearAllFilters = () => {
    setActiveDistributionFilter({ kind: "none" });
    setExpandedFilterKind(null);
  };

  const peakCardItems = useMemo<DistributionPreviewItem[]>(
    () =>
      (insight?.peakTimeDistribution ?? []).map((item) => ({
        key: item.timestamp,
        label: formatTime(item.timestamp, locationTimezone),
        count: item.modelCount,
        ratio: insight?.modelCount ? item.modelCount / insight.modelCount : 0,
        meta: `${UI_TEXT.analysis.average} ${formatTemperature(item.avgPeakTemperatureC, displayUnit)}`,
      })),
    [displayUnit, insight?.modelCount, insight?.peakTimeDistribution, locationTimezone],
  );

  const currentBucketItems = useMemo<DistributionPreviewItem[]>(
    () =>
      (distribution?.distribution ?? []).map((bucket) => ({
        key: bucket.label,
        label: formatBucketRangeLabel(bucket, displayUnit),
        count: bucket.count,
        ratio: distribution?.modelCount ? bucket.count / distribution.modelCount : 0,
        meta: `${formatTemperature(bucket.bucketStartC, displayUnit)} - ${formatTemperature(bucket.bucketEndC, displayUnit)}`,
      })),
    [displayUnit, distribution?.distribution, distribution?.modelCount],
  );

  const dayPeakBucketItems = useMemo<DistributionPreviewItem[]>(
    () =>
      (distribution?.peakDistribution ?? []).map((bucket) => ({
        key: bucket.label,
        label: formatBucketRangeLabel(bucket, displayUnit),
        count: bucket.count,
        ratio: distribution?.modelCount ? bucket.count / distribution.modelCount : 0,
        meta: `${formatTemperature(bucket.bucketStartC, displayUnit)} - ${formatTemperature(bucket.bucketEndC, displayUnit)}`,
      })),
    [displayUnit, distribution?.modelCount, distribution?.peakDistribution],
  );

  const pickDominantDistributionItem = (items: DistributionPreviewItem[]) =>
    items.reduce<DistributionPreviewItem | null>((best, item) => {
      if (best === null) {
        return item;
      }

      if (item.count === best.count) {
        return item.ratio > best.ratio ? item : best;
      }

      return item.count > best.count ? item : best;
    }, null);

  const dominantPeakItem = pickDominantDistributionItem(peakCardItems);
  const dominantCurrentBucketItem = pickDominantDistributionItem(currentBucketItems);
  const dominantDayPeakBucketItem = pickDominantDistributionItem(dayPeakBucketItems);

  const buildDistributionHint = (item: DistributionPreviewItem | null) =>
    item ? `${item.count} ${UI_TEXT.analysis.modelUnit} / ${Math.round(item.ratio * 100)}%` : null;

  const activePeakPreviewItem =
    activeDistributionFilter.kind === "peakTime"
      ? peakCardItems.find((item) => item.key === activeDistributionFilter.timestamp) ?? dominantPeakItem
      : dominantPeakItem;
  const activeCurrentBucketPreviewItem =
    activeDistributionFilter.kind === "currentTempBucket"
      ? currentBucketItems.find((item) => item.key === activeDistributionFilter.label) ?? dominantCurrentBucketItem
      : dominantCurrentBucketItem;
  const activeDayPeakBucketPreviewItem =
    activeDistributionFilter.kind === "dayPeakBucket"
      ? dayPeakBucketItems.find((item) => item.key === activeDistributionFilter.label) ?? dominantDayPeakBucketItem
      : dominantDayPeakBucketItem;

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
  const modelsLoadingCaption =
    selectedWeatherTimestamp ? `${WEATHER_TIMESTAMP_LABEL} ${weatherTimestampCaption}` : UI_TEXT.analysis.distributionLoading;
  const handleTabSelect = (nextTab: "models" | "image") => {
    if (nextTab === tab) {
      return;
    }

    onTabChange(nextTab);
  };
  const modelProfileHint = isMobileLayout ? UI_TEXT.analysis.modelProfileMobileHint : UI_TEXT.analysis.modelProfileHint;
  const mobileInspectorMetrics = activeModel
    ? [
        `${UI_TEXT.analysis.currentPrediction} ${formatTemperature(activeModel.currentTemperatureC, displayUnit)}`,
        `${UI_TEXT.analysis.dayPeakTemperature} ${formatTemperature(activeModel.dayPeakTemperatureC, displayUnit)}`,
      ]
    : [];
  const mobileInspectorSummary = activeModel
    ? activeCatalog?.fullName ?? selectedModelName ?? UI_TEXT.analysis.modelProfile
    : interactionSummary;
  const mobileInspectorCaption = activeModel?.dayPeakTimestamp
    ? `${UI_TEXT.analysis.dayPeakTemperature} ${formatDateTime(activeModel.dayPeakTimestamp, locationTimezone)}`
    : modelProfileHint;

  const modelProfilePanel = (
    <section className="analysis-profile-panel rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="eyebrow flex items-center gap-2"><Info className="h-4 w-4 text-[var(--accent)]" />{UI_TEXT.analysis.modelProfile}</div>
        {selectedModelName ? <button type="button" onClick={() => setSelectedModelName(null)} className="text-xs text-white/48 transition hover:text-white/72">{UI_TEXT.analysis.clearLock}</button> : null}
      </div>

      {!activeModel ? (
        <div className="mt-4 space-y-4">
          <div className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-4 text-sm leading-6 text-white/60">{modelProfileHint}</div>
          <div className="analysis-profile-stat-grid">
            <MetricTile label={UI_TEXT.analysis.profileCoverage} value={insight ? `${catalogHitCount}/${insight.modelCount}` : "--"} caption={UI_TEXT.analysis.dynamicJoinCaption} />
            <MetricTile label={UI_TEXT.analysis.interactionState} value={interactionSummary} caption={analysisRefreshing ? UI_TEXT.analysis.distributionLoading : UI_TEXT.analysis.interactionClickHint} />
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="analysis-profile-card rounded-[18px] border border-white/8 bg-black/20 px-4 py-4">
            <div className="text-lg font-semibold text-white">{activeModel.modelName}</div>
            <div className="mt-1 text-sm text-white/54">{activeCatalog?.fullName ?? UI_TEXT.analysis.staticProfileMissing}</div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <MetricTile label={UI_TEXT.analysis.currentPrediction} value={formatTemperature(activeModel.currentTemperatureC, displayUnit)} caption={`${UI_TEXT.analysis.deviation} ${formatTemperatureDelta(activeModel.deltaToActualTemperatureC, displayUnit, 1, true)}`} tone="accent" />
              <MetricTile label={UI_TEXT.analysis.dayPeakTemperature} value={formatTemperature(activeModel.dayPeakTemperatureC, displayUnit)} caption={activeModel.dayPeakTimestamp ? formatDateTime(activeModel.dayPeakTimestamp, locationTimezone) : "--"} tone="warning" />
            </div>
            <div className="analysis-profile-meta-grid mt-4">
              <div>{`${UI_TEXT.analysis.profileOrganization}: ${activeCatalog?.agency ?? "--"}`}</div>
              <div>{`${UI_TEXT.analysis.profileType}: ${activeCatalog?.domainType ?? "--"}`}</div>
              <div>{`${UI_TEXT.analysis.profileCoverageLabel}: ${activeCatalog?.coverage ?? "--"}`}</div>
              <div>{`${UI_TEXT.analysis.profileResolution}: ${activeCatalog?.resolutionLabel ?? "--"}`}</div>
            </div>
            <div className="analysis-profile-runtime-grid mt-4">
              <CompactInfoCard
                label={UI_TEXT.analysis.profilePageUpdate}
                value={pageUpdateValue}
                hint={activeInventory?.sourceProvider ?? activeInventory?.sourceDisplayName ?? null}
              />
              <CompactInfoCard
                label={UI_TEXT.analysis.profileOfficialCadence}
                value={officialCadenceValue}
                hint={activeCatalog?.officialVerifiedAt ? `${UI_TEXT.analysis.profileVerifiedAt} ${activeCatalog.officialVerifiedAt}` : null}
              />
            </div>
          </div>

          <div className="analysis-inline-toggle-row">
            <button type="button" className="analysis-inline-toggle" aria-expanded={showProfileRuntime} onClick={() => setShowProfileRuntime((current) => !current)}>
              <span>{UI_TEXT.analysis.profileRuntime}</span>
              {showProfileRuntime ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            <button type="button" className="analysis-inline-toggle" aria-expanded={showProfileStrengths} onClick={() => setShowProfileStrengths((current) => !current)}>
              <span>{UI_TEXT.analysis.profileStrengths} / {UI_TEXT.analysis.profileLimits}</span>
              {showProfileStrengths ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            <button type="button" className="analysis-inline-toggle" aria-expanded={showProfileContext} onClick={() => setShowProfileContext((current) => !current)}>
              <span>{UI_TEXT.analysis.profileDistributionTemp}</span>
              {showProfileContext ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>

          <AnimatePresence initial={false}>
            {showProfileRuntime ? (
              <motion.div
                initial={{ opacity: 0, height: 0, y: -6 }}
                animate={{ opacity: 1, height: "auto", y: 0 }}
                exit={{ opacity: 0, height: 0, y: -6 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="analysis-profile-detail"
              >
                <RuntimeRow label={UI_TEXT.analysis.profilePageUpdate} value={pageUpdateValue} hint={activeInventory?.sourceProvider ?? activeInventory?.sourceDisplayName ?? null} />
                <RuntimeRow label={UI_TEXT.analysis.profileOfficialCadence} value={officialCadenceValue} hint={activeCatalog?.officialVerifiedAt ? `${UI_TEXT.analysis.profileVerifiedAt} ${activeCatalog.officialVerifiedAt}` : null} />
                <RuntimeRow label={UI_TEXT.analysis.profileFetchedAt} value={fetchedAtValue} hint={activeInventory?.pageOrder ? `#${activeInventory.pageOrder}` : null} />
                <RuntimeRow label={UI_TEXT.analysis.profileHorizon} value={activeCatalog?.forecastHorizon ?? "--"} hint={UI_TEXT.analysis.profileUpdate} />
              </motion.div>
            ) : null}
          </AnimatePresence>

          <AnimatePresence initial={false}>
            {showProfileStrengths && activeCatalog ? (
              <motion.div
                initial={{ opacity: 0, height: 0, y: -6 }}
                animate={{ opacity: 1, height: "auto", y: 0 }}
                exit={{ opacity: 0, height: 0, y: -6 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="analysis-profile-detail text-sm leading-6 text-white/64"
              >
                <div className="text-sm font-medium text-white">{UI_TEXT.analysis.profileStrengths}</div>
                {activeCatalog.strengthsZh.map((item) => <div key={item}>- {item}</div>)}
                <div className="mt-3 text-sm font-medium text-white">{UI_TEXT.analysis.profileLimits}</div>
                {activeCatalog.limitsZh.map((item) => <div key={item}>- {item}</div>)}
              </motion.div>
            ) : null}
          </AnimatePresence>

          <AnimatePresence initial={false}>
            {showProfileContext ? (
              <motion.div
                initial={{ opacity: 0, height: 0, y: -6 }}
                animate={{ opacity: 1, height: "auto", y: 0 }}
                exit={{ opacity: 0, height: 0, y: -6 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="analysis-profile-detail text-sm leading-6 text-white/64"
              >
                <div>{`${UI_TEXT.analysis.profileDistributionTemp}: ${activeMember ? formatTemperature(activeMember.temperatureC, displayUnit) : "--"}`}</div>
                <div>{`${UI_TEXT.analysis.profileBucket}: ${highlightedCurrentBucketLabelDisplay ?? "--"}`}</div>
                <div>{`${UI_TEXT.analysis.highestPeakDistribution}: ${highlightedDayPeakBucketLabelDisplay ?? "--"}`}</div>
                <div>{`${UI_TEXT.analysis.profilePeakHit}: ${activeDistributionFilter.kind === "peakTime" ? (activeModel.dayPeakTimestamp === activeDistributionFilter.timestamp ? UI_TEXT.analysis.hit : UI_TEXT.analysis.miss) : "--"}`}</div>
                <div>{`${UI_TEXT.analysis.profileNotes}: ${activeCatalog?.notes ?? "--"}`}</div>
              </motion.div>
            ) : null}
          </AnimatePresence>

          <div className="rounded-[18px] border border-[rgba(242,183,109,0.2)] bg-[rgba(242,183,109,0.08)] px-4 py-4 text-sm leading-6 text-white/66">{UI_TEXT.analysis.profileDisclaimer}</div>
          {activeCatalog?.officialSourceUrl ? <a href={activeCatalog.officialSourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm text-white/72 transition hover:text-white">{UI_TEXT.analysis.openOfficialSource}<ArrowUpRight className="h-4 w-4" /></a> : null}
        </div>
      )}
    </section>
  );
  const contextPanel = (
    <section className="analysis-flow-section analysis-flow-section--context analysis-context-panel rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="eyebrow flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-[var(--success)]" />证据与上下文</div>
          <div className="mt-2 text-sm leading-6 text-white/58">图表来源、时间来源和天气报告指标后置到这里，避免和 Alpha 结论抢首屏。</div>
        </div>
        <button type="button" className="analysis-inline-toggle" aria-expanded={showContextDetails} onClick={() => setShowContextDetails((current) => !current)}>
          <span>{showContextDetails ? "收起上下文" : "展开上下文"}</span>
          {showContextDetails ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      <div className="analysis-profile-stat-grid mt-4">
        <MetricTile label={UI_TEXT.analysis.chartSource} value={insight?.sourceProof.chartFormat ?? "--"} caption={insight?.sourceProof.chartEndpoint ?? "--"} />
        <MetricTile label={UI_TEXT.analysis.timestampSource} value={insight?.sourceProof.timestampSource ?? "--"} caption={`${UI_TEXT.analysis.sampleCount} ${insight?.sourceProof.timestampCount ?? "--"}`} />
        <PredictabilityDots score={reportMetrics?.predictabilityScore ?? null} label={`${UI_TEXT.analysis.predictabilityPrefix} ${translatePredictabilityLabel(reportMetrics?.predictability) ?? "--"}`} />
      </div>

      <AnimatePresence initial={false}>
        {showContextDetails ? (
          <motion.div
            initial={{ opacity: 0, height: 0, y: -6 }}
            animate={{ opacity: 1, height: "auto", y: 0 }}
            exit={{ opacity: 0, height: 0, y: -6 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="analysis-context-panel__expanded"
          >
            <MetricTile label={UI_TEXT.analysis.maxTemperature} value={formatTemperature(reportMetrics?.maxTemperatureC, displayUnit)} caption={reportMetrics?.forecastDayLabel ?? UI_TEXT.analysis.weatherReport} tone="warning" />
            <MetricTile label={UI_TEXT.analysis.uvIndex} value={reportMetrics?.uvIndex !== null && reportMetrics?.uvIndex !== undefined ? formatNumber(reportMetrics.uvIndex, 0) : "--"} caption={UI_TEXT.analysis.fromWeatherReport} tone="accent" />
            <MetricTile
              label={ANALYSIS_STATE_LABEL}
              value={translateStatusLabel(resolvedAnalysisStatus)}
              caption={`${analysisStatusCaption} / ${IMAGE_STATE_LABEL} ${translateStatusLabel(resolvedImageStatus)}`}
              tone={resolveStatusTone(resolvedAnalysisStatus)}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
  const mobileInspectorPanel = (
    <div className="analysis-flow-section analysis-flow-section--detail analysis-mobile-profile">
      <button type="button" className="analysis-mobile-inspector" onClick={() => setShowMobileInspectorSheet(true)} aria-haspopup="dialog" aria-expanded={showMobileInspectorSheet}>
        <div className="analysis-mobile-inspector__copy">
          <div className="eyebrow flex items-center gap-2"><Info className="h-4 w-4 text-[var(--accent)]" />{selectedModelName ? `${UI_TEXT.analysis.lockedPrefix} ${selectedModelName}` : UI_TEXT.analysis.modelProfile}</div>
          <div className="analysis-mobile-inspector__title">{mobileInspectorSummary}</div>
          <div className="analysis-mobile-inspector__caption">{mobileInspectorCaption}</div>
          {mobileInspectorMetrics.length > 0 ? <div className="analysis-mobile-inspector__metrics">{mobileInspectorMetrics.map((item) => <span key={item}>{item}</span>)}</div> : null}
        </div>
        <span className="analysis-mobile-inspector__cta">{UI_TEXT.insight.openDetails}</span>
      </button>

      <Sheet open={showMobileInspectorSheet} onOpenChange={setShowMobileInspectorSheet}>
        <SheetContent
          side="bottom"
          className="analysis-mobile-inspector-sheet max-h-[min(92svh,920px)] overflow-hidden p-0"
          aria-label={selectedModelName ? `${selectedModelName} ${UI_TEXT.analysis.modelProfile}` : UI_TEXT.analysis.modelProfile}
        >
          <div className="analysis-mobile-inspector-sheet__shell">
            <div className="analysis-mobile-inspector-sheet__handle" />
            <SheetHeader className="analysis-mobile-inspector-sheet__header">
              <SheetTitle>{selectedModelName ?? UI_TEXT.analysis.modelProfile}</SheetTitle>
              <SheetDescription>{mobileInspectorSummary}</SheetDescription>
            </SheetHeader>
            <div className="analysis-mobile-inspector-sheet__body">
              {modelProfilePanel}
              {contextPanel}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );

  return (
    <section className="analysis-panel terminal-panel" data-mobile-layout={isMobileLayout ? "true" : "false"}>
      <Tabs value={tab} onValueChange={(value) => handleTabSelect(value as "models" | "image")} className="panel-section flex h-full min-h-0 flex-col gap-4 p-5">
        <div className="analysis-header">
          <div>
            <div className="eyebrow">{UI_TEXT.analysis.eyebrow}</div>
            <h2 className="mt-3 text-[2rem] font-semibold tracking-[-0.04em] text-white">{UI_TEXT.analysis.title}</h2>
            <p className="mt-2 text-sm leading-6 text-white/58">{UI_TEXT.analysis.description}</p>
          </div>
          <TabsList className="analysis-tabs-list">
            <TabsTrigger value="models" onClick={() => handleTabSelect("models")}>
              {UI_TEXT.analysis.modelsTab}
            </TabsTrigger>
            <TabsTrigger value="image" onClick={() => handleTabSelect("image")}>
              {UI_TEXT.analysis.imageTab}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="models" className="min-h-0 flex-1">
          {pageLoading ? (
            <section className="flex h-full items-center justify-center rounded-[26px] border border-white/8 bg-white/[0.025] px-6 py-8">
              <div className="w-full max-w-3xl space-y-4">
                <div className="eyebrow">{UI_TEXT.analysis.eyebrow}</div>
                <div className="text-3xl font-semibold tracking-[-0.03em] text-white">{UI_TEXT.analysis.distributionLoading}</div>
                <div className="text-sm leading-6 text-white/58">{modelsLoadingCaption}</div>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="h-28 rounded-[22px] border border-white/8 bg-white/[0.03]" />
                  <div className="h-28 rounded-[22px] border border-white/8 bg-white/[0.03]" />
                  <div className="h-28 rounded-[22px] border border-white/8 bg-white/[0.03]" />
                </div>
              </div>
            </section>
          ) : (
          <ScrollArea className="h-full rounded-[26px] border border-white/8 bg-white/[0.025]">
            <div className="analysis-content space-y-4 p-4">
              {intradaySignals && sourceMetadata && marketReference ? (
                <section className="analysis-flow-section analysis-flow-section--conclusion analysis-alpha-panel rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="eyebrow flex items-center gap-2">
                        <ShieldCheck className="h-4 w-4 text-[var(--accent)]" />
                        Alpha 结论
                      </div>
                      <div className="mt-2 text-lg font-semibold text-white">{intradaySignals.headline}</div>
                      <div className="mt-2 text-sm leading-6 text-white/58">先确认今天大概落在哪个温度区间，再用分歧筛选与完整榜单决定是否值得继续深挖。</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <AnalysisStatusPill label={`把握度 ${ANALYSIS_CONFIDENCE_LABEL[intradaySignals.confidence]}`} tone="good" />
                      <AnalysisStatusPill label={`参考站点 ${describeAnalysisReferenceStation(sourceMetadata)}`} />
                      <AnalysisStatusPill label={`分析 ${translateStatusLabel(resolvedAnalysisStatus)}`} tone={resolvedAnalysisStatus === "ready" ? "good" : "warn"} />
                    </div>
                  </div>

                  <div className="analysis-alpha-grid mt-4">
                    <RuntimeRow label="大致判断" value={intradaySignals.baseCase} />
                    <RuntimeRow label="偏高的话" value={intradaySignals.upsideCase} />
                    <RuntimeRow label="偏低的话" value={intradaySignals.downsideCase} />
                  </div>

                  <div className="analysis-alpha-summary-strip mt-4">
                    <CompactInfoCard
                      label="证据条数"
                      value={`${intradaySignals.evidence.length} 条`}
                      hint={intradaySignals.evidence[0] ?? null}
                    />
                    <CompactInfoCard
                      label="数据源状态"
                      value={`${sourceMetadata.contract.currentSources.baselineForecast.label} / ${
                        ANALYSIS_SOURCE_STATUS_LABEL[sourceMetadata.contract.currentSources.baselineForecast.status] ??
                        sourceMetadata.contract.currentSources.baselineForecast.status
                      }`}
                      hint={`多模型 ${
                        ANALYSIS_SOURCE_STATUS_LABEL[sourceMetadata.contract.currentSources.modelEnvelope.status] ??
                        sourceMetadata.contract.currentSources.modelEnvelope.status
                      }`}
                    />
                    <CompactInfoCard
                      label="下一观察点"
                      value={intradaySignals.nextObservationAt ? formatTime(intradaySignals.nextObservationAt, locationTimezone) : "--"}
                      hint={
                        intradaySignals.nextObservationAt
                          ? formatDateTime(intradaySignals.nextObservationAt, locationTimezone)
                          : "等待下一次观察时刻"
                      }
                    />
                  </div>

                  <div className="analysis-inline-toggle-row mt-4">
                    <button type="button" className="analysis-inline-toggle" aria-expanded={showAlphaEvidence} onClick={() => setShowAlphaEvidence((current) => !current)}>
                      <span>展开证据链与数据口径</span>
                      {showAlphaEvidence ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                  </div>

                  <AnimatePresence initial={false}>
                    {showAlphaEvidence ? (
                      <motion.div
                        initial={{ opacity: 0, height: 0, y: -6 }}
                        animate={{ opacity: 1, height: "auto", y: 0 }}
                        exit={{ opacity: 0, height: 0, y: -6 }}
                        transition={{ duration: 0.2, ease: "easeOut" }}
                        className="analysis-alpha-evidence"
                      >
                        <div className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-3">
                          <div className="eyebrow flex items-center gap-2">
                            <Info className="h-4 w-4 text-[var(--accent-secondary)]" />
                            主要参考
                          </div>
                          <div className="mt-3 space-y-2 text-sm leading-6 text-white/68">
                            {intradaySignals.evidence.slice(0, 4).map((item) => (
                              <div key={item}>• {item}</div>
                            ))}
                          </div>
                        </div>

                        <div className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-3">
                          <div className="eyebrow flex items-center gap-2">
                            <Clock3 className="h-4 w-4 text-[var(--warning)]" />
                            数据参考
                          </div>
                          <div className="mt-3 space-y-2 text-sm leading-6 text-white/68">
                            <div>
                              小时预报：{sourceMetadata.contract.currentSources.baselineForecast.label} /{" "}
                              {ANALYSIS_SOURCE_STATUS_LABEL[sourceMetadata.contract.currentSources.baselineForecast.status] ??
                                sourceMetadata.contract.currentSources.baselineForecast.status}
                            </div>
                            <div>
                              多模型参考：{sourceMetadata.contract.currentSources.modelEnvelope.label} /{" "}
                              {ANALYSIS_SOURCE_STATUS_LABEL[sourceMetadata.contract.currentSources.modelEnvelope.status] ??
                                sourceMetadata.contract.currentSources.modelEnvelope.status}
                            </div>
                            <div>
                              机场天气提示：{ANALYSIS_SOURCE_STATUS_LABEL[sourceMetadata.contract.targetUpgrades.taf.status] ??
                                sourceMetadata.contract.targetUpgrades.taf.status}
                            </div>
                            <div>
                              下一观察点：{intradaySignals.nextObservationAt ? formatDateTime(intradaySignals.nextObservationAt, locationTimezone) : "--"}
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </section>
              ) : null}

              {softWarnings.length > 0 ? <WarningLines items={softWarnings.slice(0, 4)} /> : null}

              <div className="metric-grid">
                <MetricTile
                  label={UI_TEXT.analysis.referenceTemperature}
                  value={formatTemperature(actualTemperatureC, displayUnit)}
                  caption={`${WEATHER_TIMESTAMP_LABEL} ${weatherTimestampCaption}`}
                  tone="accent"
                />
                <MetricTile
                  label={MODEL_TIMESTAMP_LABEL}
                  value={modelTimestampValue}
                  caption={
                    insight
                      ? `${modelTimestampCaption} / ${insight.modelCount} ${UI_TEXT.analysis.modelUnit}`
                      : modelTimestampCaption
                  }
                />
                <MetricTile
                  label={UI_TEXT.analysis.temperatureSpread}
                  value={distribution ? formatTemperatureDelta(distribution.highlights.spreadTemperatureC, displayUnit) : "--"}
                  caption={UI_TEXT.analysis.temperatureSpreadCaption}
                  tone="warning"
                />
                <MetricTile label={UI_TEXT.analysis.catalogCoverage} value={insight ? `${catalogHitCount}/${insight.modelCount}` : "--"} caption={interactionSummary} tone="success" />
              </div>

              <div className="analysis-models-layout">
                <div className="analysis-models-main-flow space-y-4">
                  <section className="analysis-flow-section analysis-flow-section--filters rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="eyebrow">{UI_TEXT.analysis.filterState}</div>
                        <div className="mt-2 text-sm font-medium text-white">{currentFilterSummary}</div>
                        <div className="mt-1 text-xs text-white/48">{filteredModels.length} {UI_TEXT.analysis.modelUnit} / {analysisRefreshing ? UI_TEXT.analysis.distributionLoading : UI_TEXT.analysis.localFilterOnly}</div>
                      </div>
                      {!isMobileLayout && hasActiveFilter ? (
                        <button type="button" onClick={clearAllFilters} className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-xs text-white/58 transition hover:border-white/18 hover:text-white/78">
                          {UI_TEXT.analysis.clearAll}
                        </button>
                      ) : null}
                    </div>

                    {isMobileLayout ? (
                      <>
                        <div className="analysis-mobile-filter-summary mt-4">
                          <span className="analysis-mobile-filter-chip">{mobileFilterSummary}</span>
                          <span className="analysis-mobile-filter-chip">{filteredModels.length} {UI_TEXT.analysis.modelUnit}</span>
                          {hasActiveFilter ? <button type="button" onClick={clearAllFilters} className="analysis-mobile-filter-chip analysis-mobile-filter-chip--action">{UI_TEXT.analysis.clearAll}</button> : null}
                          <button type="button" onClick={() => setShowMobileFilterSheet(true)} className="analysis-mobile-filter-open">{UI_TEXT.analysis.filterState}</button>
                        </div>
                        <Sheet open={showMobileFilterSheet} onOpenChange={setShowMobileFilterSheet}>
                          <SheetContent side="bottom" className="analysis-mobile-filter-sheet max-h-[min(92svh,920px)] overflow-hidden p-0" aria-label={UI_TEXT.analysis.filterState}>
                            <div className="analysis-mobile-filter-sheet__shell">
                              <div className="analysis-mobile-inspector-sheet__handle" />
                              <SheetHeader className="analysis-mobile-inspector-sheet__header">
                                <SheetTitle>{UI_TEXT.analysis.filterState}</SheetTitle>
                                <SheetDescription>{mobileFilterSummary}</SheetDescription>
                              </SheetHeader>
                              <div className="analysis-mobile-filter-sheet__body">
                                <DistributionFilterCard
                                  title={UI_TEXT.analysis.peakDistribution}
                                  icon={<Clock3 className="h-4 w-4 text-[var(--warning)]" />}
                                  selectedLabel={activeDistributionFilter.kind === "peakTime" ? formatTime(activeDistributionFilter.timestamp, locationTimezone) : UI_TEXT.analysis.defaultBucketState}
                                  selectedCount={`${activeDistributionFilter.kind === "peakTime" && peakSet ? peakSet.size : insight?.modelCount ?? 0} ${UI_TEXT.analysis.modelUnit}`}
                                  activeKey={activeDistributionFilter.kind === "peakTime" ? activeDistributionFilter.timestamp : null}
                                  active={activeDistributionFilter.kind === "peakTime"}
                                  loading={loadingInsight}
                                  warning={insightError}
                                  emptyStateText={analysisEmptyStateText}
                                  onClear={clearAllFilters}
                                  items={peakCardItems}
                                  onToggle={(timestamp) => setActiveDistributionFilter((current) => current.kind === "peakTime" && current.timestamp === timestamp ? { kind: "none" } : { kind: "peakTime", timestamp })}
                                />
                                <DistributionFilterCard
                                  title={UI_TEXT.analysis.temperatureDistribution}
                                  icon={<Thermometer className="h-4 w-4 text-[var(--accent-secondary)]" />}
                                  selectedLabel={activeDistributionFilter.kind === "currentTempBucket" ? currentBucketSelectedLabel ?? activeDistributionFilter.label ?? UI_TEXT.analysis.defaultBucketState : UI_TEXT.analysis.defaultBucketState}
                                  selectedCount={`${activeDistributionFilter.kind === "currentTempBucket" && currentBucketSet ? currentBucketSet.size : distribution?.modelCount ?? 0} ${UI_TEXT.analysis.modelUnit}`}
                                  activeKey={activeDistributionFilter.kind === "currentTempBucket" ? activeDistributionFilter.label : null}
                                  active={activeDistributionFilter.kind === "currentTempBucket"}
                                  loading={loadingDistribution}
                                  warning={currentDistributionWarning}
                                  emptyStateText={analysisEmptyStateText}
                                  onClear={clearAllFilters}
                                  items={currentBucketItems}
                                  onToggle={(label) => setActiveDistributionFilter((current) => current.kind === "currentTempBucket" && current.label === label ? { kind: "none" } : { kind: "currentTempBucket", label })}
                                />
                                <DistributionFilterCard
                                  title={UI_TEXT.analysis.highestPeakDistribution}
                                  icon={<BarChart3 className="h-4 w-4 text-[var(--accent)]" />}
                                  selectedLabel={activeDistributionFilter.kind === "dayPeakBucket" ? dayPeakBucketSelectedLabel ?? activeDistributionFilter.label ?? UI_TEXT.analysis.defaultBucketState : UI_TEXT.analysis.defaultBucketState}
                                  selectedCount={`${activeDistributionFilter.kind === "dayPeakBucket" && dayPeakBucketSet ? dayPeakBucketSet.size : distribution?.modelCount ?? 0} ${UI_TEXT.analysis.modelUnit}`}
                                  activeKey={activeDistributionFilter.kind === "dayPeakBucket" ? activeDistributionFilter.label : null}
                                  active={activeDistributionFilter.kind === "dayPeakBucket"}
                                  loading={loadingDistribution}
                                  warning={dayPeakDistributionWarning}
                                  emptyStateText={analysisEmptyStateText}
                                  onClear={clearAllFilters}
                                  items={dayPeakBucketItems}
                                  onToggle={(label) => setActiveDistributionFilter((current) => current.kind === "dayPeakBucket" && current.label === label ? { kind: "none" } : { kind: "dayPeakBucket", label })}
                                />
                              </div>
                            </div>
                          </SheetContent>
                        </Sheet>
                      </>
                    ) : (
                      <>
                        <div className="analysis-filter-chip-row mt-4">
                          <CompactToggleButton
                            label={UI_TEXT.analysis.peakDistribution}
                            value={
                              activeDistributionFilter.kind === "peakTime"
                                ? formatTime(activeDistributionFilter.timestamp, locationTimezone)
                                : activePeakPreviewItem?.label ?? UI_TEXT.analysis.defaultBucketState
                            }
                            hint={buildDistributionHint(activePeakPreviewItem)}
                            active={activeDistributionFilter.kind === "peakTime"}
                            expanded={expandedFilterKind === "peakTime"}
                            onClick={() => setExpandedFilterKind((current) => current === "peakTime" ? null : "peakTime")}
                          />
                          <CompactToggleButton
                            label={UI_TEXT.analysis.temperatureDistribution}
                            value={
                              activeDistributionFilter.kind === "currentTempBucket"
                                ? currentBucketSelectedLabel ?? activeDistributionFilter.label ?? UI_TEXT.analysis.defaultBucketState
                                : activeCurrentBucketPreviewItem?.label ?? UI_TEXT.analysis.defaultBucketState
                            }
                            hint={buildDistributionHint(activeCurrentBucketPreviewItem)}
                            active={activeDistributionFilter.kind === "currentTempBucket"}
                            expanded={expandedFilterKind === "currentTempBucket"}
                            onClick={() => setExpandedFilterKind((current) => current === "currentTempBucket" ? null : "currentTempBucket")}
                          />
                          <CompactToggleButton
                            label={UI_TEXT.analysis.highestPeakDistribution}
                            value={
                              activeDistributionFilter.kind === "dayPeakBucket"
                                ? dayPeakBucketSelectedLabel ?? activeDistributionFilter.label ?? UI_TEXT.analysis.defaultBucketState
                                : activeDayPeakBucketPreviewItem?.label ?? UI_TEXT.analysis.defaultBucketState
                            }
                            hint={buildDistributionHint(activeDayPeakBucketPreviewItem)}
                            active={activeDistributionFilter.kind === "dayPeakBucket"}
                            expanded={expandedFilterKind === "dayPeakBucket"}
                            onClick={() => setExpandedFilterKind((current) => current === "dayPeakBucket" ? null : "dayPeakBucket")}
                          />
                        </div>

                        <AnimatePresence initial={false}>
                          {expandedFilterKind === "peakTime" ? (
                            <motion.div
                              initial={{ opacity: 0, height: 0, y: -6 }}
                              animate={{ opacity: 1, height: "auto", y: 0 }}
                              exit={{ opacity: 0, height: 0, y: -6 }}
                              transition={{ duration: 0.2, ease: "easeOut" }}
                              className="analysis-filter-panel"
                            >
                              <DistributionFilterCard
                                title={UI_TEXT.analysis.peakDistribution}
                                icon={<Clock3 className="h-4 w-4 text-[var(--warning)]" />}
                                selectedLabel={activeDistributionFilter.kind === "peakTime" ? formatTime(activeDistributionFilter.timestamp, locationTimezone) : UI_TEXT.analysis.defaultBucketState}
                                selectedCount={`${activeDistributionFilter.kind === "peakTime" && peakSet ? peakSet.size : insight?.modelCount ?? 0} ${UI_TEXT.analysis.modelUnit}`}
                                activeKey={activeDistributionFilter.kind === "peakTime" ? activeDistributionFilter.timestamp : null}
                                active={activeDistributionFilter.kind === "peakTime"}
                                loading={loadingInsight}
                                warning={insightError}
                                emptyStateText={analysisEmptyStateText}
                                onClear={clearAllFilters}
                                items={peakCardItems}
                                onToggle={(timestamp) => setActiveDistributionFilter((current) => current.kind === "peakTime" && current.timestamp === timestamp ? { kind: "none" } : { kind: "peakTime", timestamp })}
                              />
                            </motion.div>
                          ) : null}
                        </AnimatePresence>

                        <AnimatePresence initial={false}>
                          {expandedFilterKind === "currentTempBucket" ? (
                            <motion.div
                              initial={{ opacity: 0, height: 0, y: -6 }}
                              animate={{ opacity: 1, height: "auto", y: 0 }}
                              exit={{ opacity: 0, height: 0, y: -6 }}
                              transition={{ duration: 0.2, ease: "easeOut" }}
                              className="analysis-filter-panel"
                            >
                              <DistributionFilterCard
                                title={UI_TEXT.analysis.temperatureDistribution}
                                icon={<Thermometer className="h-4 w-4 text-[var(--accent-secondary)]" />}
                                selectedLabel={activeDistributionFilter.kind === "currentTempBucket" ? currentBucketSelectedLabel ?? activeDistributionFilter.label ?? UI_TEXT.analysis.defaultBucketState : UI_TEXT.analysis.defaultBucketState}
                                selectedCount={`${activeDistributionFilter.kind === "currentTempBucket" && currentBucketSet ? currentBucketSet.size : distribution?.modelCount ?? 0} ${UI_TEXT.analysis.modelUnit}`}
                                activeKey={activeDistributionFilter.kind === "currentTempBucket" ? activeDistributionFilter.label : null}
                                active={activeDistributionFilter.kind === "currentTempBucket"}
                                loading={loadingDistribution}
                                warning={currentDistributionWarning}
                                emptyStateText={analysisEmptyStateText}
                                onClear={clearAllFilters}
                                items={currentBucketItems}
                                onToggle={(label) => setActiveDistributionFilter((current) => current.kind === "currentTempBucket" && current.label === label ? { kind: "none" } : { kind: "currentTempBucket", label })}
                              />
                            </motion.div>
                          ) : null}
                        </AnimatePresence>

                        <AnimatePresence initial={false}>
                          {expandedFilterKind === "dayPeakBucket" ? (
                            <motion.div
                              initial={{ opacity: 0, height: 0, y: -6 }}
                              animate={{ opacity: 1, height: "auto", y: 0 }}
                              exit={{ opacity: 0, height: 0, y: -6 }}
                              transition={{ duration: 0.2, ease: "easeOut" }}
                              className="analysis-filter-panel"
                            >
                              <DistributionFilterCard
                                title={UI_TEXT.analysis.highestPeakDistribution}
                                icon={<BarChart3 className="h-4 w-4 text-[var(--accent)]" />}
                                selectedLabel={activeDistributionFilter.kind === "dayPeakBucket" ? dayPeakBucketSelectedLabel ?? activeDistributionFilter.label ?? UI_TEXT.analysis.defaultBucketState : UI_TEXT.analysis.defaultBucketState}
                                selectedCount={`${activeDistributionFilter.kind === "dayPeakBucket" && dayPeakBucketSet ? dayPeakBucketSet.size : distribution?.modelCount ?? 0} ${UI_TEXT.analysis.modelUnit}`}
                                activeKey={activeDistributionFilter.kind === "dayPeakBucket" ? activeDistributionFilter.label : null}
                                active={activeDistributionFilter.kind === "dayPeakBucket"}
                                loading={loadingDistribution}
                                warning={dayPeakDistributionWarning}
                                emptyStateText={analysisEmptyStateText}
                                onClear={clearAllFilters}
                                items={dayPeakBucketItems}
                                onToggle={(label) => setActiveDistributionFilter((current) => current.kind === "dayPeakBucket" && current.label === label ? { kind: "none" } : { kind: "dayPeakBucket", label })}
                              />
                            </motion.div>
                          ) : null}
                        </AnimatePresence>
                      </>
                    )}
                  </section>

                  <section className="analysis-flow-section analysis-flow-section--ranking rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="eyebrow flex items-center gap-2"><BarChart3 className="h-4 w-4 text-[var(--accent)]" />{UI_TEXT.analysis.fullRanking}</div>
                      {selectedModelName ? <button type="button" onClick={() => setSelectedModelName(null)} className="text-xs text-white/48 transition hover:text-white/72">{UI_TEXT.analysis.clearLock}</button> : null}
                    </div>
                    <div className="mt-4 space-y-3">
                      {filteredModels.length > 0 ? filteredModels.map((model, index) => {
                        const active = activeModelName === model.modelName;
                        const rowSelected = selectedModelName === model.modelName;
                        const matchedPeak = highlightedPeakTimestamp && model.dayPeakTimestamp === highlightedPeakTimestamp;
                        const matchedCurrentBucket = currentBucketSet?.has(model.modelName) ?? false;
                        const matchedDayPeakBucket = dayPeakBucketSet?.has(model.modelName) ?? false;
                        const catalogEntry = catalogByModelName.get(model.modelName);
                        const member = distribution?.members.find((item) => item.modelName === model.modelName) ?? null;
                        const inventoryEntry = inventoryByModelName.get(model.modelName) ?? null;
                        const rowBucketLabel = distribution
                          ? formatBucketLabelFromKey(
                              distribution.distribution,
                              findBucketLabel(distribution.distribution, member?.temperatureC ?? null),
                              displayUnit,
                            )
                          : null;
                        const rowRuntimeLabel = inventoryEntry?.pageLastUpdatedLabel
                          ? inventoryEntry.pageLastUpdatedLabel
                          : inventoryEntry?.pageLastUpdatedAt
                            ? formatTime(inventoryEntry.pageLastUpdatedAt, locationTimezone)
                            : null;
                        const peakSummaryValue = formatTemperature(model.dayPeakTemperatureC, displayUnit);
                        const peakSummaryTime = model.dayPeakTimestamp ? formatTime(model.dayPeakTimestamp, locationTimezone) : null;
                        return (
                          <article key={`${model.modelName}-${model.dayPeakTimestamp ?? "none"}`} onMouseEnter={isMobileLayout ? undefined : () => setHoveredModelName(model.modelName)} onMouseLeave={isMobileLayout ? undefined : () => setHoveredModelName(null)} className={`analysis-ranking-row rounded-[22px] border ${isMobileLayout ? "px-3 py-3" : "px-3.5 py-3.5"} transition ${active || matchedPeak || matchedCurrentBucket || matchedDayPeakBucket ? "border-[rgba(56,214,180,0.22)] bg-[rgba(56,214,180,0.08)]" : "border-white/8 bg-black/20 hover:border-white/16"}`}>
                            <button type="button" aria-pressed={rowSelected} onClick={() => setSelectedModelName((current) => current === model.modelName ? null : model.modelName)} className={`grid w-full cursor-pointer text-left ${isMobileLayout ? "grid-cols-[44px_minmax(0,1fr)] gap-2" : "gap-3 md:grid-cols-[60px_minmax(0,1fr)]"}`}>
                              <div className={`data-mono font-semibold text-white/72 ${isMobileLayout ? "text-lg" : "text-2xl"}`}>#{index + 1}</div>
                              <div className="min-w-0">
                                <div className="analysis-ranking-row__headline">
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                  <div className="text-lg font-semibold text-white">{model.modelName}</div>
                                  {!isMobileLayout && catalogEntry ? <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[11px] text-white/54">{UI_TEXT.analysis.hasCatalog}</span> : null}
                                  {matchedPeak ? <span className="rounded-full border border-[rgba(216,255,79,0.16)] bg-[rgba(216,255,79,0.08)] px-2 py-0.5 text-[11px] text-[var(--accent)]">峰值命中</span> : null}
                                </div>
                                <div className={`mt-1 text-white/56 ${isMobileLayout ? "text-[13px] leading-5" : "text-sm"}`}>{UI_TEXT.analysis.currentPrediction} {formatTemperature(model.currentTemperatureC, displayUnit)} / {UI_TEXT.analysis.deviation} {formatTemperatureDelta(model.deltaToActualTemperatureC, displayUnit, 1, true)}</div>
                                  </div>
                                  <div className="analysis-ranking-row__peak">
                                    <span className="analysis-ranking-row__peak-label">{UI_TEXT.analysis.dayPeakTemperature}</span>
                                    <strong className="data-mono">{peakSummaryValue}</strong>
                                    <span className="analysis-ranking-row__peak-time">{peakSummaryTime ?? UI_TEXT.analysis.noPeakMoment}</span>
                                  </div>
                                </div>
                                {!isMobileLayout ? <div className="analysis-ranking-row__meta mt-2">
                                  {catalogEntry?.agency ? <span>{catalogEntry.agency}</span> : null}
                                  {rowBucketLabel ? <span>{rowBucketLabel}</span> : null}
                                  {rowRuntimeLabel ? <span>{rowRuntimeLabel}</span> : null}
                                </div> : null}
                              </div>
                            </button>

                            <AnimatePresence initial={false}>
                              {!isMobileLayout && active ? (
                                <motion.div
                                  initial={{ opacity: 0, height: 0, y: -6 }}
                                  animate={{ opacity: 1, height: "auto", y: 0 }}
                                  exit={{ opacity: 0, height: 0, y: -6 }}
                                  transition={{ duration: 0.2, ease: "easeOut" }}
                                  className="analysis-ranking-row__expanded"
                                >
                                  <div>
                                    <span className="analysis-ranking-row__expanded-label">{UI_TEXT.analysis.dayPeakTemperature}</span>
                                    <strong>{model.dayPeakTimestamp ? `${peakSummaryValue} / ${formatDateTime(model.dayPeakTimestamp, locationTimezone)}` : peakSummaryValue}</strong>
                                  </div>
                                  <div>
                                    <span className="analysis-ranking-row__expanded-label">{UI_TEXT.analysis.profileBucket}</span>
                                    <strong>{rowBucketLabel ?? "--"}</strong>
                                  </div>
                                  <div>
                                    <span className="analysis-ranking-row__expanded-label">{UI_TEXT.analysis.profileOrganization}</span>
                                    <strong>{catalogEntry?.agency ?? "--"}</strong>
                                  </div>
                                  <div>
                                    <span className="analysis-ranking-row__expanded-label">{UI_TEXT.analysis.profileResolution}</span>
                                    <strong>{catalogEntry?.resolutionLabel ?? "--"}</strong>
                                  </div>
                                  <div>
                                    <span className="analysis-ranking-row__expanded-label">{UI_TEXT.analysis.profileNotes}</span>
                                    <strong>{catalogEntry?.notes ?? UI_TEXT.analysis.interactionClickHint}</strong>
                                  </div>
                                </motion.div>
                              ) : null}
                            </AnimatePresence>
                          </article>
                        );
                      }) : <div className="rounded-[20px] border border-white/8 bg-black/20 px-4 py-5 text-sm leading-6 text-white/56">{analysisUnavailable ? UI_TEXT.analysis.waitingModelData : NO_FILTER_MATCH_TEXT}</div>}
                    </div>
                    {loadingInsight ? <div className="mt-4 text-xs text-white/54">{UI_TEXT.analysis.rankingLoading}</div> : null}
                    {insightError ? <div className="mt-3 text-sm text-[var(--warning)]">{insightError}</div> : null}
                  </section>

                  {isMobileLayout ? mobileInspectorPanel : contextPanel}
                </div>

                <aside className={`${isMobileLayout ? "hidden " : ""}analysis-side-panel space-y-4`}>
                  {modelProfilePanel}
                </aside>
              </div>
            </div>
          </ScrollArea>
          )}
        </TabsContent>

        <TabsContent value="image" className="min-h-0 flex-1">
          <div className="analysis-image-layout">
            <section className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
              <div className="analysis-image-toolbar flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="eyebrow flex items-center gap-2"><ImageIcon className="h-4 w-4 text-[var(--accent)]" />{UI_TEXT.analysis.officialImage}</div>
                  <h3 className="mt-3 text-2xl font-semibold text-white">{UI_TEXT.analysis.officialImageViewer}</h3>
                  <p className="mt-2 text-sm leading-6 text-white/58">{UI_TEXT.analysis.officialImageDescription}</p>
                </div>
                {imageUrl ? <a href={imageUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white/72 transition hover:border-white/18 hover:text-white">{UI_TEXT.analysis.openInNewTab}<ArrowUpRight className="h-4 w-4" /></a> : null}
              </div>

              <div className="analysis-image-metric-grid mt-4 grid gap-3 sm:grid-cols-4">
                <MetricTile
                  label={ANALYSIS_STATE_LABEL}
                  value={translateStatusLabel(resolvedAnalysisStatus)}
                  caption={analysisStatusCaption}
                  tone={resolveStatusTone(resolvedAnalysisStatus)}
                />
                <MetricTile
                  label={IMAGE_STATE_LABEL}
                  value={translateStatusLabel(resolvedImageStatus)}
                  caption={imageStatusCaption}
                  tone={resolveStatusTone(resolvedImageStatus)}
                />
                <MetricTile label={UI_TEXT.analysis.readTime} value={imageUpdatedAt ? formatDateTime(imageUpdatedAt, locationTimezone) : "--"} caption={UI_TEXT.analysis.prewarmHint} />
                <MetricTile label={UI_TEXT.analysis.peakSummary} value={hasPeakSummary ? UI_TEXT.analysis.available : "--"} caption={peakSummary} tone="accent" />
              </div>
            </section>

            <section className="analysis-image-canvas rounded-[24px] border border-white/8 bg-black/20">
               {imageUrl ? <div className="analysis-image-scroll"><img key={imageUrl} src={imageUrl} alt="meteoblue official multimodel chart" className="analysis-image rounded-[20px] border border-white/8 bg-black/30 shadow-[0_18px_60px_rgba(0,0,0,0.28)]" decoding="async" fetchPriority="high" /></div> : <div className="flex h-full min-h-[380px] items-center justify-center px-6 text-sm text-white/58">{imageStatusCaption}</div>}
             </section>
           </div>
         </TabsContent>
      </Tabs>
    </section>
  );
};
