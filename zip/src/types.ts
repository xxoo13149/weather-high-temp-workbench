import type {
  HourlyWeatherItem,
  HourlyWeatherResponse,
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
  KellyWorkbenchResponse as DomainKellyWorkbenchResponse,
  LocationDirectoryEntry,
  LocationInfo,
  MultiModelDistributionBucket,
  MultiModelDistributionHighlights,
  MultiModelDistributionMember,
  MultiModelDistributionResponse,
  MultiModelDistributionSourceProof,
  MultiModelInsightPeakModel,
  MultiModelInsightPeakTimeDistribution,
  MultiModelInsightRankedModel,
  MultiModelInsightResponse,
  MultiModelStatusResponse,
  WeatherReportMetrics,
  WeatherReportResponse,
} from "../../src/domain/weather.ts";

export type {
  HourlyWeatherItem,
  HourlyWeatherResponse,
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
  MultiModelDistributionBucket,
  MultiModelDistributionHighlights,
  MultiModelDistributionMember,
  MultiModelDistributionResponse,
  MultiModelDistributionSourceProof,
  MultiModelInsightPeakModel,
  MultiModelInsightPeakTimeDistribution,
  MultiModelInsightRankedModel,
  MultiModelInsightResponse,
  MultiModelStatusResponse,
  WeatherReportMetrics,
  WeatherReportResponse,
};

export type KellyWorkbenchResponse = DomainKellyWorkbenchResponse & {
  displayUnit?: KellyTemperatureUnit;
};

export interface ApiErrorPayload {
  code: string;
  message: string;
  retryable: boolean;
  staleAvailable: boolean;
  lastSuccessAt: string | null;
}

export interface DashboardSyncInfo {
  state: "fresh" | "stale";
  label: "synced" | "stale";
  updatedAt: string;
}

export interface DashboardResponse {
  generatedAt: string;
  sync: DashboardSyncInfo;
  locationDirectory: LocationDirectoryEntry[];
  hourly: HourlyWeatherResponse;
  report: WeatherReportResponse;
  multimodel: MultiModelStatusResponse & {
    imageProxyUrl: string;
    displayUpdatedAt: string | null;
    sourceType: "official-relayed-image";
    parity: "exact-image-relay";
    statusLabel: "fresh" | "stale" | "unavailable";
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
  displayName: string;
  displayNameZh: string;
  shortLabel: string;
  cityName: string;
  countryName: string;
  timezone: string;
  timezoneGroup: DockTimezoneGroup;
  temp: number | null;
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
