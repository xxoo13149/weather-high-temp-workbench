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
  tier: "primary" | "secondary";
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
  suggestedStakeUsd?: number | null;
  recommendation?: string | null;
  status?: KellyMarketStatus;
  detail?: string | null;
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

export interface KellyFrameAnalysisRow {
  id: string;
  label: string;
  timestampLabel?: string | null;
  marketLabel: string;
  marketPricePct: number | null;
  fairPricePct: number | null;
  yesEdgePct: number | null;
  noEdgePct: number | null;
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
  bankrollInput: string;
  minEdgeInput: string;
  riskMode: KellyRiskMode;
  riskModeOptions: KellySelectOption<KellyRiskMode>[];
  refreshDisabled?: boolean;
  marketUrl?: string | null;
  syncMetrics: KellySyncMetric[];
  summaryMetrics: KellySummaryMetric[];
  opportunities: KellyOpportunity[];
  probability: KellyProbabilityPanelData;
  markets: KellyMarketRow[];
  evidenceSections: KellyEvidenceSection[];
  methodologyNotes?: string[];
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
  onRiskModeChange?: (riskMode: KellyRiskMode) => void;
  onRefresh?: () => void;
  onSelectOpportunity?: (opportunityId: string) => void;
  onSelectMarket?: (marketId: string) => void;
  onSelectFrame?: (frameId: string) => void;
}
