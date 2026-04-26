import type {
  DataFreshnessState,
  DashboardMetarSnapshot,
  DashboardTafSnapshot,
  DashboardSourceMetadata,
  HourlyWeatherItem,
  HourlyWeatherResponse,
  IntradaySignalsSummary,
  KellyTemperatureUnit,
  MetarObservation,
  MetarRecentReport,
  KellyBucketProbability,
  KellyDistributionSummary,
  KellyFramePoint,
  KellyMarketRow,
  KellyRecommendation,
  KellyRequestOptions,
  KellyRiskMode,
  KellySourceLinks,
  KellySourceStatus,
  KellyStreamMarketPatch,
  KellyStreamMessage,
  KellyWeatherEvidence,
  KellyFreshness,
  KellyStreamHealth,
  KellyWorkbenchResponse as DomainKellyWorkbenchResponse,
  LocationDirectoryEntry,
  LocationInfo,
  MultiModelAnalysisAvailability,
  MultiModelDistributionBucket,
  MultiModelDistributionHighlights,
  MultiModelDistributionMember,
  MultiModelDistributionResponse,
  MultiModelDistributionSourceProof,
  MultiModelInsightPeakModel,
  MultiModelInsightPeakTimeDistribution,
  MultiModelInsightRankedModel,
  MultiModelInsightResponse,
  MultiModelImageAvailability,
  MultiModelStatusResponse,
  MarketReferenceSummary,
  SystemStatusResponse,
  TafForecastSegment,
  TafForecastOverview,
  TafCloudLayerDetail,
  TafDailySummary,
  TafPhenomenon,
  WeatherReportMetrics,
  WeatherReportResponse,
} from "../../src/domain/weather.ts";

export type {
  DataFreshnessState,
  DashboardMetarSnapshot,
  DashboardTafSnapshot,
  DashboardSourceMetadata,
  HourlyWeatherItem,
  HourlyWeatherResponse,
  IntradaySignalsSummary,
  KellyBucketProbability,
  KellyDistributionSummary,
  KellyFramePoint,
  KellyMarketRow,
  KellyRecommendation,
  KellyRequestOptions,
  KellyRiskMode,
  KellySourceLinks,
  KellySourceStatus,
  KellyStreamMarketPatch,
  KellyStreamMessage,
  KellyWeatherEvidence,
  KellyFreshness,
  KellyStreamHealth,
  KellyTemperatureUnit,
  LocationDirectoryEntry,
  LocationInfo,
  MetarObservation,
  MetarRecentReport,
  MultiModelAnalysisAvailability,
  MultiModelDistributionBucket,
  MultiModelDistributionHighlights,
  MultiModelDistributionMember,
  MultiModelDistributionResponse,
  MultiModelDistributionSourceProof,
  MultiModelInsightPeakModel,
  MultiModelInsightPeakTimeDistribution,
  MultiModelInsightRankedModel,
  MultiModelInsightResponse,
  MultiModelImageAvailability,
  MultiModelStatusResponse,
  MarketReferenceSummary,
  SystemStatusResponse,
  TafCloudLayerDetail,
  TafDailySummary,
  TafForecastSegment,
  TafForecastOverview,
  TafPhenomenon,
  WeatherReportMetrics,
  WeatherReportResponse,
};

export type KellyWorkbenchResponse = DomainKellyWorkbenchResponse;

export interface ApiErrorPayload {
  code: string;
  message: string;
  retryable: boolean;
  staleAvailable: boolean;
  lastSuccessAt: string | null;
}

export interface DashboardSyncInfo {
  state: DataFreshnessState;
  label: "synced" | "revalidating" | "fallback_error";
  updatedAt: string;
}

export interface DashboardResponse {
  generatedAt: string;
  displayUnit: KellyTemperatureUnit;
  sync: DashboardSyncInfo;
  locationDirectory: LocationDirectoryEntry[];
  hourly: HourlyWeatherResponse;
  report: WeatherReportResponse;
  metar: DashboardMetarSnapshot;
  taf: DashboardTafSnapshot;
  sourceMetadata: DashboardSourceMetadata;
  intradaySignals: IntradaySignalsSummary;
  marketReference: MarketReferenceSummary;
  multimodel: MultiModelStatusResponse & {
    imageProxyUrl: string;
    displayUpdatedAt: string | null;
    sourceType: "official-relayed-image";
    parity: "exact-image-relay";
    statusLabel: "ready" | "revalidating" | "fallback_error" | "unavailable";
  };
}

export interface UserFavoritesResponse {
  fetchedAt: string;
  locationIds: LocationInfo["id"][];
}

export type DockTimezoneGroup = LocationDirectoryEntry["timezoneGroup"];

export interface DockLocation {
  id: string;
  code: string;
  stationCodes: string[];
  displayName: string;
  displayNameZh: string;
  shortLabel: string;
  cityName: string;
  countryName: string;
  timezone: string;
  timezoneGroup: DockTimezoneGroup;
  temp: number | null;
  displayUnit: KellyTemperatureUnit;
  isFavorite: boolean;
  isActive: boolean;
  enabled: boolean;
  sortOrder: number;
}

export interface DockLocationGroup {
  group: DockTimezoneGroup;
  label: string;
  items: DockLocation[];
}
