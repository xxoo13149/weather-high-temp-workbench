export type KellyRiskMode = "conservative" | "balanced" | "aggressive";

export type KellyDirection = "yes" | "no" | "watch";

export type KellyTone = "neutral" | "accent" | "success" | "warning" | "danger";

export type KellyMarketStatus = "tradable" | "thin" | "locked";

export type KellyTimezoneGroup = "asia" | "europe" | "americas";

export interface KellyLocationOption {
  id: string;
  label: string;
  labelZh?: string | null;
  shortLabel?: string | null;
  timezone?: string | null;
  timezoneGroup?: KellyTimezoneGroup | null;
  disabled?: boolean;
}

export interface KellySelectOption<T extends string = string> {
  value: T;
  label: string;
  hint?: string | null;
  disabled?: boolean;
}

export interface KellyDateChip {
  value: string;
  label: string;
  shortLabel: string;
  selected?: boolean;
}

export interface KellyFieldErrors {
  bankroll?: string | null;
  minEdge?: string | null;
  actualTemperature?: string | null;
}

export interface KellySyncMetric {
  id: string;
  label: string;
  value: string;
  detail?: string | null;
  tone?: KellyTone;
}

export interface KellySummaryMetric {
  id: string;
  label: string;
  value: string;
  detail?: string | null;
  tone?: KellyTone;
}

export interface KellyOpportunity {
  id: string;
  marketId?: string | null;
  tier: "primary" | "secondary" | "watch";
  title: string;
  marketLabel: string;
  side: KellyDirection;
  thesis: string;
  confidenceLabel?: string | null;
  edgePct: number | null;
  fairPricePct: number | null;
  marketPricePct: number | null;
  kellyPct: number | null;
  suggestedStakeUsd: number | null;
  reasons: string[];
  tags?: string[];
  shortLabel?: string;
  dateLabel?: string;
  contractTypeLabel?: string | null;
}

export interface KellyCurvePoint {
  temperatureC: number;
  probabilityPct: number;
  label?: string | null;
}

export interface KellyThresholdMarker {
  id: string;
  label: string;
  temperatureC: number;
  detail?: string | null;
  marketId?: string | null;
  tone?: KellyTone;
}

export interface KellyConfidenceBand {
  id: string;
  fromC: number;
  toC: number;
  label: string;
  tone?: KellyTone;
}

export interface KellyProbabilityPanelData {
  title: string;
  subtitle: string;
  summary?: string | null;
  samples: KellyCurvePoint[];
  thresholds: KellyThresholdMarker[];
  confidenceBands?: KellyConfidenceBand[];
  notes?: string[];
}

export interface KellyMarketRow {
  id: string;
  marketId?: string | null;
  label: string;
  rangeLabel: string;
  yesPricePct: number | null;
  noPricePct: number | null;
  fairYesPct: number | null;
  fairNoPct: number | null;
  yesEdgePct: number | null;
  noEdgePct: number | null;
  yesKellyPct: number | null;
  noKellyPct: number | null;
  spreadPct?: number | null;
  suggestedStakeUsd?: number | null;
  recommendation?: string | null;
  recommendationSide?: string | null;
  status?: KellyMarketStatus;
  detail?: string | null;
  spreadLabel?: string | null;
  updatedAtLabel?: string | null;
  note?: string | null;
  isInactive?: boolean;
  inactiveReason?: string | null;
  contractType?: string | null;
  shortLabel?: string;
  dateLabel?: string;
  contractTypeLabel?: string;
}

export interface KellyEvidenceItem {
  id: string;
  label: string;
  value: string;
  detail?: string | null;
  tone?: KellyTone;
  sourceLabel?: string | null;
  sourceUrl?: string | null;
}

export interface KellyEvidenceSection {
  id: string;
  title: string;
  description?: string | null;
  items: KellyEvidenceItem[];
}

export interface KellyMethodologyModelRow {
  id: string;
  modelLabel: string;
  currentPredictionLabel: string;
  biasNowLabel: string;
  adjustedPeakLabel: string;
  weightLabel: string;
  statusLabel: string;
  detail?: string | null;
  included: boolean;
}

export interface KellyFrameAnalysisRow {
  id: string;
  label: string;
  timestampLabel?: string | null;
  marketLabel: string;
  yesPricePct: number | null;
  noPricePct: number | null;
  fairYesPct: number | null;
  fairNoPct: number | null;
  marketPricePct: number | null;
  fairPricePct: number | null;
  yesEdgePct: number | null;
  noEdgePct: number | null;
  spreadPct: number | null;
  weatherSignal: string;
  note?: string | null;
}

export interface KellyFrameAnalysisGroup {
  id: string;
  title: string;
  description?: string | null;
  rows: KellyFrameAnalysisRow[];
}

export interface KellyWorkbenchData {
  title: string;
  subtitle: string;
  locationId: string;
  locationOptions: KellyLocationOption[];
  targetDate: string;
  dateOptions: string[];
  dateChips: KellyDateChip[];
  bankrollInput: string;
  minEdgeInput: string;
  actualTemperatureInput: string;
  riskMode: KellyRiskMode;
  riskModeOptions: KellySelectOption<KellyRiskMode>[];
  refreshDisabled?: boolean;
  draftDirty?: boolean;
  statusNote?: string | null;
  fieldErrors?: KellyFieldErrors;
  marketUrl?: string | null;
  syncMetrics: KellySyncMetric[];
  summaryMetrics: KellySummaryMetric[];
  opportunities: KellyOpportunity[];
  opportunityEmptyState?: string | null;
  probability: KellyProbabilityPanelData;
  markets: KellyMarketRow[];
  inactiveMarkets?: KellyMarketRow[];
  marketEmptyState?: string | null;
  unresolvedMarkets: KellyMarketRow[];
  evidenceSections: KellyEvidenceSection[];
  methodologyNotes?: string[];
  methodologyModels?: KellyMethodologyModelRow[];
  frameAnalysisGroups: KellyFrameAnalysisGroup[];
}

export interface KellyWorkbenchProps {
  data: KellyWorkbenchData;
  className?: string;
  selectedMarketId?: string | null;
  selectedOpportunityId?: string | null;
  selectedFrameId?: string | null;
  disabled?: boolean;
  refreshing?: boolean;
  onLocationChange?: (locationId: string) => void;
  onTargetDateChange?: (targetDate: string) => void;
  onBankrollChange?: (value: string) => void;
  onMinEdgeChange?: (value: string) => void;
  onActualTemperatureChange?: (value: string) => void;
  onRiskModeChange?: (riskMode: KellyRiskMode) => void;
  onRefresh?: () => void;
  onSelectOpportunity?: (opportunityId: string) => void;
  onSelectMarket?: (marketId: string) => void;
  onSelectFrame?: (frameId: string) => void;
}
