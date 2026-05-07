export type HourlyMode = "1h" | "3h";
export type HourlySourceType = "week-table-1h" | "week-table-3h" | "week-meteogram-highcharts";
export type HourlyFieldName = "precipitationProbabilityPct" | "feelsLikeC" | "windDirection";
export type HourlyFieldCoverageSource = HourlySourceType | "mixed";
export type HourlyFieldCoverageCompleteness = "full" | "partial" | "missing";
export type HourlyFieldMissingReason = "source-unpublished" | "parser-unrecognized" | "fallback-unavailable";
export type DataFreshnessState = "fresh" | "revalidating" | "fallback_error";
export type MultiModelImageAvailability = "ready" | "revalidating" | "fallback_error" | "unavailable";
export type MultiModelAnalysisAvailability = "ready" | "revalidating" | "fallback_error" | "unavailable";

export interface HourlyFieldCoverageEntry {
  availableHours: number;
  totalHours: number;
  source: HourlyFieldCoverageSource;
  completeness: HourlyFieldCoverageCompleteness;
  missingReasons: Record<HourlyFieldMissingReason, number>;
}

export interface HourlyFieldCoverage {
  precipitationProbabilityPct: HourlyFieldCoverageEntry;
  feelsLikeC: HourlyFieldCoverageEntry;
  windDirection: HourlyFieldCoverageEntry;
  mixedSources: HourlySourceType[];
}

export interface LocationInfo {
  id: import("../config.js").LocationId;
  name: string;
  timezone: string;
}

export interface LocationDirectoryEntry {
  id: LocationInfo["id"];
  code: string;
  displayName: string;
  displayNameZh: string;
  shortLabel: string;
  cityName: string;
  countryName: string;
  timezone: string;
  timezoneGroup: import("../config.js").TimezoneGroup;
  displayUnit: import("../config.js").DisplayTemperatureUnit;
  fallbackDisplayUnit: import("../config.js").DisplayTemperatureUnit;
  enabled: boolean;
  sortOrder: number;
  weekPageUrl: string;
  multimodelPageUrl: string;
  sourceMetadata?: LocationSourceContract;
}

export type LocationRolloutTier = "tier-1" | "tier-2" | "tier-3";
export type LocationCapabilityStatus = "production" | "planned" | "candidate" | "unavailable";

export interface LocationContractSource {
  key: string;
  label: string;
  status: LocationCapabilityStatus;
  detail: string;
  stationCode: string | null;
}

export interface LocationSettlementReference {
  label: string;
  kind: "metar" | "official-station" | "airport-reference" | "pending-contract";
  stationCode: string | null;
  detail: string;
}

export interface LocationSourceContract {
  contractVersion: string;
  rolloutTier: LocationRolloutTier;
  settlementReference: LocationSettlementReference;
  currentSources: {
    baselineForecast: LocationContractSource;
    modelEnvelope: LocationContractSource;
    primaryObservation: LocationContractSource;
  };
  targetUpgrades: {
    openMeteoMultiModel: LocationContractSource;
    taf: LocationContractSource & {
      role: "airport-disruption-confirmation";
    };
    officialEnhancements: LocationContractSource[];
  };
  peakWindowLocal: {
    startHour: number;
    endHour: number;
    rationale: string;
  };
  kellyMarketMapping: {
    status: LocationCapabilityStatus;
    detail: string;
  };
}

export interface IntradaySignalsSummary {
  headline: string;
  confidence: "high" | "medium" | "low";
  baseCase: string;
  upsideCase: string;
  downsideCase: string;
  nextObservationAt: string | null;
  evidence: string[];
  invalidationRules: string[];
  confirmationRules: string[];
}

export interface MarketReferenceSummary {
  mode: "qualitative-only";
  summary: string;
  kellyRoute: string;
  targetDate: string | null;
  notes: string[];
}

export interface DashboardSourceMetadata {
  contract: LocationSourceContract;
  freshness: {
    hourly: DataFreshnessState;
    report: DataFreshnessState;
    multimodel: DataFreshnessState;
  };
}

export interface HourlyWeatherItem {
  timestamp: string;
  endAt: string | null;
  summary: string | null;
  summaryZh: string | null;
  iconUrl: string | null;
  temperatureC: number | null;
  feelsLikeC: number | null;
  windDirection: string | null;
  windSpeedKphMin: number | null;
  windSpeedKphMax: number | null;
  precipitationMm: number | null;
  precipitationProbabilityPct: number | null;
}

export interface HourlyWeatherResponse {
  location: LocationInfo;
  fetchedAt: string;
  sourceObservedAt: string | null;
  mode: HourlyMode;
  periodHours: number;
  sourceType: HourlySourceType;
  stale: boolean;
  freshness: DataFreshnessState;
  pageUrl: string;
  parserVersion: string;
  items: HourlyWeatherItem[];
  fieldCoverage: HourlyFieldCoverage;
  partial: boolean;
  warnings: string[];
  cacheHit: boolean;
  current: {
    timestamp: string;
    temperatureC: number | null;
    index: number;
  } | null;
}

export interface WeatherReportMetrics {
  forecastDayLabel: string | null;
  maxTemperatureC: number | null;
  uvIndex: number | null;
  overnightWindKphMin: number | null;
  overnightWindKphMax: number | null;
  daytimeWindKphMin: number | null;
  daytimeWindKphMax: number | null;
  overnightWindDirection: string | null;
  daytimeWindDirection: string | null;
  confidence: "high" | "medium" | "low" | null;
  predictability: "very_high" | "high" | "medium" | "low" | null;
  predictabilityScore: 1 | 2 | 3 | 4 | null;
}

export interface WeatherReportResponse {
  location: LocationInfo;
  fetchedAt: string;
  sourceObservedAt: string | null;
  stale: boolean;
  freshness: DataFreshnessState;
  cacheHit: boolean;
  pageUrl: string;
  parserVersion: string;
  available: boolean;
  titleEn: string | null;
  sourceTextEn: string | null;
  textZh: string | null;
  metrics: WeatherReportMetrics;
  warnings: string[];
}

export interface MetarObservation {
  location: LocationInfo;
  stationId: string;
  observedAt: string;
  temperatureC: number;
  dewpointC: number | null;
  windDirectionDegrees: number | null;
  windSpeedKts: number | null;
  rawReport: string | null;
  stationName: string | null;
  sourceUrl: string;
  fetchedAt: string;
  stale: boolean;
  freshness: DataFreshnessState;
  cacheHit: boolean;
}

export interface MetarTemperatureSample {
  observedAt: string;
  temperatureC: number;
}

export interface MetarRecentReport {
  stationId: string;
  stationName: string | null;
  observedAt: string;
  temperatureC: number | null;
  dewpointC: number | null;
  windDirectionDegrees: number | null;
  windSpeedKts: number | null;
  rawReport: string | null;
}

export interface DashboardMetarSnapshot {
  observation: MetarObservation | null;
  recentTemperatures: MetarTemperatureSample[];
  recentReports?: MetarRecentReport[];
  recentObservations?: MetarRecentReport[];
}

const toMetarRecentReport = (
  observation: Pick<
    MetarObservation,
    | "stationId"
    | "stationName"
    | "observedAt"
    | "temperatureC"
    | "dewpointC"
    | "windDirectionDegrees"
    | "windSpeedKts"
    | "rawReport"
  >,
): MetarRecentReport => ({
  stationId: observation.stationId,
  stationName: observation.stationName,
  observedAt: observation.observedAt,
  temperatureC: observation.temperatureC,
  dewpointC: observation.dewpointC,
  windDirectionDegrees: observation.windDirectionDegrees,
  windSpeedKts: observation.windSpeedKts,
  rawReport: observation.rawReport,
});

export const normalizeDashboardMetarSnapshot = (
  snapshot?: DashboardMetarSnapshot | null,
): DashboardMetarSnapshot => {
  const observation = snapshot?.observation ?? null;
  const recentTemperatures = snapshot?.recentTemperatures ?? [];
  const fallbackReports =
    observation && typeof observation.stationId === "string" && typeof observation.observedAt === "string"
      ? [toMetarRecentReport(observation)]
      : [];
  const recentReports = snapshot?.recentReports ?? snapshot?.recentObservations ?? fallbackReports;
  const recentObservations = snapshot?.recentObservations ?? recentReports;

  return {
    observation,
    recentTemperatures,
    recentReports,
    recentObservations,
  };
};

export type TafFlightCategory = "VFR" | "MVFR" | "IFR" | "LIFR";

export interface TafCloudLayerDetail {
  raw: string;
  cover: string;
  baseFt: number | null;
  cloudType: string | null;
}

export interface TafWindShearSummary {
  raw: string;
  heightFtAgl: number | null;
  directionDegrees: number | null;
  speedKts: number | null;
}

export type TafPhenomenonCategory = "precipitation" | "visibility" | "thunderstorm" | "wind" | "other";

export interface TafPhenomenon {
  raw: string;
  code: string;
  labelZh: string;
  category: TafPhenomenonCategory;
}

export interface TafTemperatureExtreme {
  raw: string;
  kind: "max" | "min";
  temperatureC: number;
  occursAt: string | null;
}

export interface TafTemperatureTrendSummary {
  headlineZh: string;
  detailZh: string;
  currentPhaseZh: string | null;
  nextTurningPointKind: "max" | "min" | null;
  nextTurningPointAt: string | null;
  nextTurningPointTemperatureC: number | null;
}

export interface TafTrendSummary {
  changeLabel: string;
  timeFrom: string | null;
  timeTo: string | null;
  headlineZh: string;
}

export interface TafDailySummary {
  headlineZh: string;
  maxTemperatureC: number | null;
  minTemperatureC: number | null;
  temperatureExtremes: TafTemperatureExtreme[];
  temperatureTrend: TafTemperatureTrendSummary | null;
  dominantWeather: TafPhenomenon[];
  activeHeadlineZh: string | null;
  activeWeatherTextZh: string | null;
  activeWindTextZh: string | null;
  activeCloudTextZh: string | null;
  changeHighlights: TafTrendSummary[];
}

export interface TafForecastSegment {
  changeLabel: string;
  plainEnglish: string | null;
  timeFrom: string | null;
  timeTo: string | null;
  visibilityKm: number | null;
  clouds: string[];
  cloudLayers?: TafCloudLayerDetail[];
  windDirectionDegrees: number | null;
  windSpeedKts: number | null;
  windGustKts: number | null;
  weatherCodes?: string[];
  weather?: TafPhenomenon[];
  windShear?: TafWindShearSummary | null;
  headlineZh?: string | null;
  flightCategory: TafFlightCategory | null;
}

export interface TafForecastOverview {
  location: LocationInfo;
  stationId: string;
  stationName: string | null;
  issuedAt: string | null;
  validFrom: string | null;
  validTo: string | null;
  rawTaf: string | null;
  sourceUrl: string;
  officialSourceUrl: string;
  activeForecast: TafForecastSegment | null;
  dailySummary?: TafDailySummary | null;
  fetchedAt: string;
  stale: boolean;
  freshness: DataFreshnessState;
  cacheHit: boolean;
}

export interface DashboardTafSnapshot {
  forecast: TafForecastOverview | null;
  forecasts: TafForecastSegment[];
}

export interface MultiModelImageResponse {
  contentType: string;
  body: Buffer;
  cacheHit: boolean;
  stale: boolean;
  freshness: DataFreshnessState;
  headers: Record<string, string>;
}

export interface MultiModelStatusResponse {
  location: LocationInfo;
  displayUnit: KellyTemperatureUnit;
  fallbackDisplayUnit: KellyTemperatureUnit;
  pageFetchedAt: string | null;
  imageFetchedAt: string | null;
  imageUrlFound: boolean;
  cacheHit: boolean;
  stale: boolean;
  freshness: DataFreshnessState;
  imageStatus: MultiModelImageAvailability;
  analysisStatus: MultiModelAnalysisAvailability;
  lastError: string | null;
  diagnosticCode?: string | null;
  lastSuccessAt: string | null;
  imageUrl: string | null;
  pageUrl: string;
}

export interface MultiModelInventoryItem {
  modelName: string;
  displayName: string;
  pageOrder: number;
  pageLastUpdatedAt: string | null;
  pageLastUpdatedLabel: string | null;
  sourceDisplayName: string;
  modelCode?: string | null;
  sourceProvider?: string | null;
  coverage?: string | null;
  resolution?: string | null;
  forecastHorizon?: string | null;
}

export interface MultiModelDistributionMember {
  modelName: string;
  temperatureC: number;
  peakTemperatureC: number;
  peakTimestamp: string | null;
}

export interface MultiModelDistributionBucket {
  bucketStartC: number;
  bucketEndC: number;
  label: string;
  count: number;
  models: string[];
}

export interface MultiModelDistributionSourceProof {
  dataFromPage: true;
  usesOfficialApi: false;
  chartFormat: "highcharts";
  pageFetchedAt: string;
  chartEndpoint: string;
  parserVersion: string;
  modelNames: string[];
  timestampCount: number;
  timestampSource: "point-name-local" | "x-timezone-converted";
  xLabelOffsetMinutes: number | null;
}

export interface MultiModelDistributionHighlights {
  spreadTemperatureC: number;
  dominantBucket: MultiModelDistributionBucket;
  dominantPeakBucket: MultiModelDistributionBucket;
  coolestMember: MultiModelDistributionMember;
  warmestMember: MultiModelDistributionMember;
  highestPeakMember: MultiModelDistributionMember;
}

export type MultiModelTimestampResolutionReason =
  | "requested"
  | "requested-fallback"
  | "nearest-now"
  | "first-available";

export interface MultiModelDistributionResponse {
  location: LocationInfo;
  fetchedAt: string;
  stale: boolean;
  freshness: DataFreshnessState;
  cacheHit: boolean;
  pageUrl: string;
  sourceType: "meteoblue-page-highcharts";
  displayUnit: KellyTemperatureUnit;
  fallbackDisplayUnit: KellyTemperatureUnit;
  requestedTimestamp: string | null;
  requestedTimestampValid: boolean;
  resolvedTimestamp: string;
  resolvedTimestampReason: MultiModelTimestampResolutionReason;
  selectedTimestamp: string;
  selectedTimestampReason: MultiModelTimestampResolutionReason;
  availableTimestamps: string[];
  bucketSizeC: number;
  modelCount: number;
  modelInventory: MultiModelInventoryItem[];
  members: MultiModelDistributionMember[];
  distribution: MultiModelDistributionBucket[];
  peakDistribution: MultiModelDistributionBucket[];
  sourceProof: MultiModelDistributionSourceProof;
  highlights: MultiModelDistributionHighlights;
  stats: {
    minTemperatureC: number;
    maxTemperatureC: number;
    meanTemperatureC: number;
  };
  warnings: string[];
}

export interface MultiModelInsightPeakModel {
  modelName: string;
  dayPeakTemperatureC: number;
}

export interface MultiModelInsightRankedModel {
  modelName: string;
  currentTemperatureC: number;
  deltaToActualTemperatureC: number;
  dayPeakTemperatureC: number;
  dayPeakTimestamp: string | null;
}

export interface MultiModelInsightPeakTimeDistribution {
  timestamp: string;
  modelCount: number;
  avgPeakTemperatureC: number;
  minPeakTemperatureC: number;
  maxPeakTemperatureC: number;
  modelNames: string[];
  peakModels: MultiModelInsightPeakModel[];
}

export interface MultiModelInsightResponse {
  location: LocationInfo;
  fetchedAt: string;
  stale: boolean;
  freshness: DataFreshnessState;
  cacheHit: boolean;
  pageUrl: string;
  sourceType: "meteoblue-page-highcharts";
  displayUnit: KellyTemperatureUnit;
  fallbackDisplayUnit: KellyTemperatureUnit;
  requestedTimestamp: string | null;
  requestedTimestampValid: boolean;
  resolvedTimestamp: string;
  resolvedTimestampReason: MultiModelTimestampResolutionReason;
  selectedTimestamp: string;
  selectedTimestampReason: MultiModelTimestampResolutionReason;
  availableTimestamps: string[];
  modelCount: number;
  modelInventory: MultiModelInventoryItem[];
  referenceTemperature: {
    temperatureC: number;
    source: "assumed-client-value" | "selected-model-mean";
  };
  closestModel: MultiModelInsightRankedModel | null;
  rankedModels: MultiModelInsightRankedModel[];
  peakTimeDistribution: MultiModelInsightPeakTimeDistribution[];
  sourceProof: MultiModelDistributionSourceProof;
  warnings: string[];
}

export type KellyRiskMode = "conservative" | "balanced" | "aggressive";
export type KellyContractType = "range" | "atLeast" | "atMost" | "exact";
export type KellyTemperatureUnit = "C" | "F";
export type KellyOriginMode = "remote" | "local-fallback";
export type KellyCircuitState = "closed" | "open" | "half-open";
export type KellySourceState = "fresh" | "stale" | "degraded" | "unavailable" | "connected" | "disconnected";
export type KellyMarketLifecycle = "tradable" | "inactive" | "unresolved";
export type KellyInactiveReason =
  | "closed"
  | "accepting_orders_disabled"
  | "archived"
  | "expired"
  | "missing_tokens"
  | "no_orderbook"
  | "no_executable_prices"
  | "observation_floor";
export type KellyEntrySource = "best-ask" | "midpoint" | "unavailable";
export type KellyMarketMotionState = "live" | "still" | "polling-fallback" | "unavailable";
export type KellyStreamReasonCode =
  | "awaiting_client_subscription"
  | "no_matched_markets"
  | "missing_tokens"
  | "ws_connected"
  | "ws_error"
  | "upstream_error"
  | "reprice_failed"
  | "polling_fallback"
  | "no_recent_market_motion"
  | "snapshot_loaded";

export interface KellySourceStatus {
  kind: "weather" | "market-discovery" | "orderbooks" | "stream";
  state: KellySourceState;
  label: string;
  detail: string | null;
  updatedAt: string | null;
}

export interface KellyExcludedModel {
  modelName: string;
  reason: string;
}

export interface KellyWeatherEvidence {
  location: LocationInfo;
  targetDate: string;
  availableTargetDates: string[];
  currentReferenceTemperatureC: number | null;
  currentReferenceSource: "manual" | "metar" | "hourly-current" | "hourly-selected" | "model-mean";
  currentWeatherTimestamp: string | null;
  currentModelTimestamp: string | null;
  targetModelTimestamp: string | null;
  observationFloorTemperatureC: number | null;
  observationFloorSource: "manual" | "metar" | "hourly-current" | "hourly-observed" | "none";
  observationFloorObservedAt: string | null;
  metarObservation: MetarObservation | null;
  tafForecast: TafForecastOverview | null;
  sourceSummaryZh: string | null;
  hourlyPageUrl: string;
  multimodelPageUrl: string;
  fetchedAt: string;
  stale: boolean;
  participatingModelCount: number;
  excludedModels: KellyExcludedModel[];
}

export interface KellyProbabilityCurvePoint {
  temperatureC: number;
  density: number;
  cumulative: number;
}

export interface KellyBucketProbability {
  marketId: string;
  label: string;
  contractType: KellyContractType;
  bucketStartC: number | null;
  bucketEndC: number | null;
  probabilityYes: number;
  probabilityNo: number;
}

export interface KellyMarketRow {
  marketId: string;
  slug: string | null;
  title: string;
  marketUrl: string | null;
  conditionId: string | null;
  liquidity: number | null;
  volume24h: number | null;
  contractType: KellyContractType;
  unit: KellyTemperatureUnit;
  bucketStartC: number | null;
  bucketEndC: number | null;
  bucketLabel: string;
  lifecycle: KellyMarketLifecycle;
  inactiveReason: KellyInactiveReason | null;
  observationFloorBlocked?: boolean;
  parseStatus: "matched" | "unresolved";
  exclusionReason: string | null;
  yesTokenId: string | null;
  noTokenId: string | null;
  entrySourceYes: KellyEntrySource;
  entrySourceNo: KellyEntrySource;
  yesPrice: number | null;
  noPrice: number | null;
  yesBestBid: number | null;
  yesBestAsk: number | null;
  noBestBid: number | null;
  noBestAsk: number | null;
  spreadPct: number | null;
  rawProbabilityYes: number;
  rawProbabilityNo: number;
  fairYes: number;
  fairNo: number;
  edgeYes: number;
  edgeNo: number;
  kellyYes: number;
  kellyNo: number;
  recommendedSide: "yes" | "no" | "none";
  suggestedStake: number;
  updatedAt: string | null;
}

export type KellyRecommendationSlot = "primary" | "secondary" | "observation";

export interface KellyRecommendation {
  slot: KellyRecommendationSlot;
  marketId: string;
  title: string;
  marketUrl: string | null;
  side: "yes" | "no";
  edge: number;
  fairPrice: number;
  marketPrice: number;
  kellyFraction: number;
  suggestedStake: number;
  reason: string;
}

export interface KellyMethodologyFormulaSummary {
  referenceRule: string;
  adjustmentRule: string;
  weightRule: string;
  shrinkRule: string;
  pricingRule: string;
  observationRule: string;
}

export interface KellyMethodologyModel {
  modelName: string;
  modelCode: string | null;
  currentPredictionC: number | null;
  dayPeakTemperatureC: number | null;
  biasNowC: number | null;
  adjustedPeakTemperatureC: number | null;
  sigmaC: number | null;
  weight: number | null;
  weightBreakdown:
    | {
        biasWeight: number;
        consensusWeight: number;
        rankWeight: number;
        normalizedWeight: number;
      }
    | null;
  included: boolean;
  exclusionReason: string | null;
}

export interface KellyMethodologyShrinkInputs {
  disagreement: number;
  biasDispersion: number;
  missingRatio: number;
  stalePenalty: number;
  disagreementFactor: number;
  biasDispersionFactor: number;
  missingRatioFactor: number;
  clampFloor: number;
  clampCeiling: number;
  rawShrink: number;
}

export interface KellyMethodologyWeightBreakdown {
  biasWeight: number;
  consensusWeight: number;
  rankWeight: number;
  normalizedWeight: number;
}

export interface KellyProbabilityStep {
  marketId: string;
  contractType: KellyContractType;
  lowerBoundC: number | null;
  upperBoundC: number | null;
  pRaw: number;
  pFinal: number;
}

export interface KellyMethodologyProbabilitySteps {
  gridStepC: number;
  referencePriority: string[];
  contractProbabilityRule: string;
  shrinkRule: string;
  fairPriceRule: string;
  entryPriceRule: string;
  edgeRule: string;
  kellyRule: string;
  details?: KellyProbabilityStep[];
}

export type KellyShrinkMode = "heuristic";

export interface KellyMethodology {
  generatedAt: string;
  formulaVersion: string;
  referenceTemperatureC: number | null;
  referenceSource: KellyWeatherEvidence["currentReferenceSource"];
  shrink: number;
  shrinkMode: KellyShrinkMode;
  shrinkInputs: KellyMethodologyShrinkInputs;
  weightBreakdown: KellyMethodologyWeightBreakdown;
  peakSpreadC: number;
  usableModelCount: number;
  totalModelCount: number;
  summaries: KellyMethodologyFormulaSummary;
  probabilitySteps: KellyMethodologyProbabilitySteps;
  formulaNotes: string[];
  models: KellyMethodologyModel[];
}

export interface KellyMarketEvidence {
  marketId: string;
  title: string;
  eventTitle: string | null;
  marketUrl: string | null;
  eventUrl: string | null;
  lifecycle: KellyMarketLifecycle;
  inactiveReason: KellyInactiveReason | null;
  parseStatus: "matched" | "unresolved";
  exclusionReason: string | null;
  ruleSummary: string | null;
  resolutionSource: string | null;
  pageFetchedAt: string | null;
}

export interface KellyFramePoint {
  id: string;
  marketId: string;
  generatedAt: string;
  marketPrice: number | null;
  fairPrice: number | null;
  yesMarketPrice: number | null;
  noMarketPrice: number | null;
  fairYes: number;
  fairNo: number;
  yesEdge: number;
  noEdge: number;
  spreadPct: number | null;
  selectedSide: "yes" | "no" | "watch";
  note: string | null;
}

export interface KellyDistributionSummary {
  meanTemperatureC: number;
  medianTemperatureC: number;
  modeTemperatureC: number;
  mostLikelyRangeLabel: string;
  shrink: number;
  usableModelCount: number;
  totalModelCount: number;
  peakSpreadC: number;
}

export interface KellySourceLinks {
  meteoblueWeekUrl: string;
  meteoblueMultimodelUrl: string;
  polymarketSearchUrl: string;
  marketUrls: string[];
}

export interface KellyFreshness {
  weatherGeneratedAt: string | null;
  marketDiscoveredAt: string | null;
  orderbookFetchedAt: string | null;
  repricedAt: string | null;
  lastStreamEventAt: string | null;
  marketMotionState: KellyMarketMotionState;
}

export interface KellyStreamHealth {
  state: KellySourceState;
  reasonCode: KellyStreamReasonCode;
  message: string;
  lastSignalAt: string | null;
  lastRepricedAt: string | null;
}

export interface KellyRuntimeStageTimings {
  hourly: number | null;
  report: number | null;
  metar: number | null;
  insight: number | null;
  distribution: number | null;
  marketDiscovery: number | null;
  orderbook: number | null;
  pricing: number | null;
  total: number | null;
}

export interface KellyRuntimeHealth {
  service: "kelly-origin";
  lastSnapshotSuccessAt: string | null;
  lastSnapshotErrorAt: string | null;
  lastSnapshotError: string | null;
  lastMarketDiscoveryAt: string | null;
  lastOrderbookAttemptAt?: string | null;
  lastOrderbookSuccessAt?: string | null;
  lastOrderbookFailureAt?: string | null;
  lastOrderbookFailureCode?: string | null;
  lastOrderbookAt: string | null;
  lastRepricedAt: string | null;
  lastSignalAt: string | null;
  lastStreamEventAt: string | null;
  openStreamCount: number;
  activeHubCount: number;
  fallbackMode: boolean;
  lastStageTimingsMs: KellyRuntimeStageTimings;
}

export interface KellyWorkbenchResponse {
  location: LocationInfo;
  targetDate: string;
  displayUnit: KellyTemperatureUnit;
  availableTargetDates: string[];
  generatedAt: string;
  bankroll: number;
  riskMode: KellyRiskMode;
  riskMultiplier: number;
  minEdge: number;
  weatherEvidence: KellyWeatherEvidence;
  distributionSummary: KellyDistributionSummary;
  probabilityCurve: KellyProbabilityCurvePoint[];
  bucketProbabilities: KellyBucketProbability[];
  markets: KellyMarketRow[];
  inactiveMarkets: KellyMarketRow[];
  recommendations: KellyRecommendation[];
  bestObservation: KellyRecommendation | null;
  unresolvedMarkets: KellyMarketRow[];
  marketEvidence: KellyMarketEvidence[];
  methodology: KellyMethodology;
  frameSeries: KellyFramePoint[];
  sourceLinks: KellySourceLinks;
  freshness: KellyFreshness;
  streamHealth: KellyStreamHealth;
  sourceStatus: KellySourceStatus[];
  warnings: string[];
}

export interface KellyStreamMarketPatch {
  marketId: string;
  lifecycle: KellyMarketLifecycle;
  inactiveReason: KellyInactiveReason | null;
  observationFloorBlocked: boolean;
  entrySourceYes: KellyEntrySource;
  entrySourceNo: KellyEntrySource;
  yesPrice: number | null;
  noPrice: number | null;
  yesBestBid: number | null;
  yesBestAsk: number | null;
  noBestBid: number | null;
  noBestAsk: number | null;
  rawProbabilityYes: number;
  rawProbabilityNo: number;
  fairYes: number;
  fairNo: number;
  spreadPct: number | null;
  edgeYes: number;
  edgeNo: number;
  kellyYes: number;
  kellyNo: number;
  recommendedSide: "yes" | "no" | "none";
  suggestedStake: number;
  updatedAt: string | null;
}

export type KellyStreamMessage =
  | {
      type: "status";
      generatedAt: string;
      state: KellySourceState;
      reasonCode: KellyStreamReasonCode;
      message: string;
      lastSignalAt?: string | null;
      lastRepricedAt?: string | null;
      originMode?: KellyOriginMode;
      circuitState?: KellyCircuitState;
    }
  | {
      type: "markets";
      generatedAt: string;
      markets: KellyStreamMarketPatch[];
      frames: KellyFramePoint[];
      lastSignalAt?: string | null;
      lastRepricedAt?: string | null;
      originMode?: KellyOriginMode;
      circuitState?: KellyCircuitState;
    };

export interface KellyRequestOptions {
  targetDate?: string;
  bankroll?: number;
  riskMode?: KellyRiskMode;
  minEdge?: number;
  actualTemperatureC?: number;
  selectedHourTimestamp?: string;
  forceRefresh?: boolean;
}

export interface KellyStreamHandle {
  close(): Promise<void> | void;
}

export interface UserFavoritesResponse {
  fetchedAt: string;
  locationIds: LocationInfo["id"][];
}

export interface RuntimeCacheBucketStatus {
  entryCount: number;
  freshCount: number;
  revalidatingCount: number;
  fallbackErrorCount: number;
  inFlightCount: number;
  lastSuccessAt: string | null;
}

export type KellyPrewarmRuntimeState = "disabled" | "skipped" | "scheduled" | "running" | "idle" | "stopped";

export interface KellyPrewarmRuntimeConfig {
  delayMs: number;
  intervalMs: number;
  concurrency: number;
  locationIds: LocationInfo["id"][];
  forceRefreshCount: number;
  nextDayWarmCount: number;
  nextDayWarmAfterLocalHour: number;
}

export interface KellyPrewarmPassFailure {
  locationId: LocationInfo["id"];
  error: string;
}

export interface KellyPrewarmLastPassStatus {
  passIndex: number;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  total: number;
  succeeded: number;
  failed: number;
  forceRefreshLocationIds: LocationInfo["id"][];
  nextDayLocationIds: LocationInfo["id"][];
  failures: KellyPrewarmPassFailure[];
}

export interface KellyPrewarmRuntimeStatus {
  state: KellyPrewarmRuntimeState;
  enabled: boolean;
  startedAt: string | null;
  heartbeatAt: string | null;
  nextScheduledAt: string | null;
  inFlight: boolean;
  config: KellyPrewarmRuntimeConfig | null;
  lastPass: KellyPrewarmLastPassStatus | null;
  consecutiveFailurePasses: number;
  lastCrash: {
    at: string;
    error: string;
  } | null;
}

export interface ServiceRuntimeStatus {
  caches: {
    week: RuntimeCacheBucketStatus;
    multiModelImage: RuntimeCacheBucketStatus;
    multiModelDistribution: RuntimeCacheBucketStatus;
  };
  kelly: KellyRuntimeHealth | null;
  prewarm: KellyPrewarmRuntimeStatus | null;
}

export interface SystemStatusSourceCoverage {
  key: string;
  label: string;
  scope: "current" | "target";
  productionCount: number;
  plannedCount: number;
  candidateCount: number;
  unavailableCount: number;
}

export interface SystemStatusResponse {
  ok: true;
  service: string;
  buildId: string;
  startedAt: string;
  generatedAt: string;
  roadmap: {
    profile: "polyweather-absorption-v1";
    cleanRoom: true;
    probabilityLayerEnabled: false;
    marketNarrative: "qualitative-only";
  };
  sourceContractsVersion: string;
  locationCoverage: {
    totalEnabled: number;
    byTimezoneGroup: Record<import("../config.js").TimezoneGroup, number>;
    byRolloutTier: Record<LocationRolloutTier, number>;
  };
  sourceCoverage: SystemStatusSourceCoverage[];
  runtime: ServiceRuntimeStatus | null;
  kellyProxy?: Record<string, unknown>;
  watchdog?: Record<string, unknown> | null;
}

export interface WeatherService {
  getHourly(locationId: LocationInfo["id"], mode: HourlyMode, limit?: number): Promise<HourlyWeatherResponse>;
  getWeatherReport(locationId: LocationInfo["id"]): Promise<WeatherReportResponse>;
  getMetarSnapshot?(locationId: LocationInfo["id"]): Promise<DashboardMetarSnapshot>;
  getTafSnapshot?(locationId: LocationInfo["id"]): Promise<DashboardTafSnapshot>;
  getMultiModelImage(locationId: LocationInfo["id"], allowStale: boolean): Promise<MultiModelImageResponse>;
  getMultiModelStatus(locationId: LocationInfo["id"]): Promise<MultiModelStatusResponse>;
  getMultiModelDistribution(
    locationId: LocationInfo["id"],
    timestamp?: string,
    bucketSizeC?: number,
  ): Promise<MultiModelDistributionResponse>;
  getMultiModelInsight(
    locationId: LocationInfo["id"],
    timestamp?: string,
    actualTemperatureC?: number,
  ): Promise<MultiModelInsightResponse>;
  getKellyWorkbench?(
    locationId: LocationInfo["id"],
    options?: KellyRequestOptions,
  ): Promise<KellyWorkbenchResponse>;
  createKellyStream?(
    locationId: LocationInfo["id"],
    options: KellyRequestOptions,
    onMessage: (message: KellyStreamMessage) => void,
  ): Promise<KellyStreamHandle>;
  getKellyRuntimeHealth?(): KellyRuntimeHealth;
  getSystemStatus?(): ServiceRuntimeStatus;
  getUserFavorites?(): Promise<UserFavoritesResponse>;
  setUserFavorite?(locationId: LocationInfo["id"], favorite: boolean): Promise<UserFavoritesResponse>;
}
