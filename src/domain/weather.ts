export type HourlyMode = "1h" | "3h";
export type HourlySourceType = "week-table-1h" | "week-table-3h" | "week-meteogram-highcharts";
export type HourlyFieldName = "precipitationProbabilityPct" | "feelsLikeC" | "windDirection";
export type HourlyFieldCoverageSource = HourlySourceType | "mixed";
export type HourlyFieldCoverageCompleteness = "full" | "partial" | "missing";
export type HourlyFieldMissingReason = "source-unpublished" | "parser-unrecognized" | "fallback-unavailable";

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
  enabled: boolean;
  sortOrder: number;
  weekPageUrl: string;
  multimodelPageUrl: string;
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

export interface MultiModelImageResponse {
  contentType: string;
  body: Buffer;
  cacheHit: boolean;
  stale: boolean;
  headers: Record<string, string>;
}

export interface MultiModelStatusResponse {
  location: LocationInfo;
  pageFetchedAt: string | null;
  imageFetchedAt: string | null;
  imageUrlFound: boolean;
  cacheHit: boolean;
  stale: boolean;
  lastError: string | null;
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

export interface MultiModelDistributionResponse {
  location: LocationInfo;
  fetchedAt: string;
  stale: boolean;
  cacheHit: boolean;
  pageUrl: string;
  sourceType: "meteoblue-page-highcharts";
  requestedTimestamp: string | null;
  selectedTimestamp: string;
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
  cacheHit: boolean;
  pageUrl: string;
  sourceType: "meteoblue-page-highcharts";
  selectedTimestamp: string;
  selectedTimestampReason: "requested" | "nearest-now" | "first-available";
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
export type KellySourceState = "fresh" | "stale" | "degraded" | "unavailable" | "connected" | "disconnected";

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
  currentReferenceSource: "manual" | "hourly-current" | "hourly-selected" | "model-mean";
  currentWeatherTimestamp: string | null;
  currentModelTimestamp: string | null;
  targetModelTimestamp: string | null;
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
  parseStatus: "matched" | "unresolved";
  exclusionReason: string | null;
  yesTokenId: string | null;
  noTokenId: string | null;
  yesPrice: number | null;
  noPrice: number | null;
  yesBestBid: number | null;
  yesBestAsk: number | null;
  noBestBid: number | null;
  noBestAsk: number | null;
  spreadPct: number | null;
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

export interface KellyRecommendation {
  slot: "primary" | "secondary";
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

export interface KellyWorkbenchResponse {
  location: LocationInfo;
  targetDate: string;
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
  recommendations: KellyRecommendation[];
  sourceLinks: KellySourceLinks;
  sourceStatus: KellySourceStatus[];
  warnings: string[];
}

export interface KellyStreamMarketPatch {
  marketId: string;
  yesPrice: number | null;
  noPrice: number | null;
  yesBestBid: number | null;
  yesBestAsk: number | null;
  noBestBid: number | null;
  noBestAsk: number | null;
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
      message: string;
    }
  | {
      type: "markets";
      generatedAt: string;
      markets: KellyStreamMarketPatch[];
    };

export interface KellyRequestOptions {
  targetDate?: string;
  bankroll?: number;
  riskMode?: KellyRiskMode;
  minEdge?: number;
  actualTemperatureC?: number;
  selectedHourTimestamp?: string;
}

export interface KellyStreamHandle {
  close(): Promise<void> | void;
}

export interface UserFavoritesResponse {
  fetchedAt: string;
  locationIds: LocationInfo["id"][];
}

export interface WeatherService {
  getHourly(locationId: LocationInfo["id"], mode: HourlyMode, limit?: number): Promise<HourlyWeatherResponse>;
  getWeatherReport(locationId: LocationInfo["id"]): Promise<WeatherReportResponse>;
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
  getUserFavorites?(): Promise<UserFavoritesResponse>;
  setUserFavorite?(locationId: LocationInfo["id"], favorite: boolean): Promise<UserFavoritesResponse>;
}
