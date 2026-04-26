import { CONFIG } from "./config";
import type {
  DashboardResponse,
  DashboardSyncInfo,
  DashboardMetarSnapshot,
  DashboardTafSnapshot,
  DockLocation,
  DockLocationGroup,
  HourlyWeatherItem,
  MultiModelDistributionResponse,
  MultiModelInsightRankedModel,
  MultiModelInsightResponse,
  DashboardSourceMetadata,
  IntradaySignalsSummary,
  MarketReferenceSummary,
  SupplementalEvidenceSnapshot,
  WeatherReportResponse,
} from "./types";
import { translatePredictabilityLabel } from "./display-text";

const sanitizeNumber = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const sanitizeString = (value: string | null | undefined) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const ICAO_STATION_CODE_PATTERN = /^[A-Z0-9]{4}$/;

const buildStationCodes = (location: DashboardResponse["locationDirectory"][number]) => {
  const codes = new Set<string>();
  const addCode = (value: string | null | undefined) => {
    const normalized = sanitizeString(value)?.toUpperCase();
    if (normalized) {
      codes.add(normalized);
    }
  };

  const locationCode = sanitizeString(location.code)?.toUpperCase();
  if (locationCode && ICAO_STATION_CODE_PATTERN.test(locationCode)) {
    codes.add(locationCode);
    return [...codes];
  }

  const contract = location.sourceMetadata;
  addCode(contract?.settlementReference?.stationCode);

  Object.values(contract?.currentSources ?? {}).forEach((source) => addCode(source.stationCode));
  addCode(contract?.targetUpgrades?.openMeteoMultiModel?.stationCode);
  addCode(contract?.targetUpgrades?.taf?.stationCode);
  contract?.targetUpgrades?.officialEnhancements?.forEach((source) => addCode(source.stationCode));

  return [...codes];
};

export interface DashboardViewModel {
  generatedAt: string;
  displayUnit: DashboardResponse["displayUnit"];
  sync: DashboardSyncInfo;
  locationDirectory: DashboardResponse["locationDirectory"];
  metar: DashboardMetarSnapshot;
  taf: DashboardTafSnapshot;
  hourly: {
    location: DashboardResponse["hourly"]["location"];
    locationName: string;
    locationTimezone: string;
    fetchedAt: DashboardResponse["hourly"]["fetchedAt"];
    sourceObservedAt: DashboardResponse["hourly"]["sourceObservedAt"];
    sourceType: DashboardResponse["hourly"]["sourceType"];
    fieldCoverage: DashboardResponse["hourly"]["fieldCoverage"];
    stale: boolean;
    freshness: DashboardResponse["hourly"]["freshness"];
    warnings: string[];
    pageUrl: string;
    items: HourlyWeatherItem[];
    current: DashboardResponse["hourly"]["current"];
  };
  report: WeatherReportResponse;
  multimodel: DashboardResponse["multimodel"];
  supplementalEvidence: SupplementalEvidenceSnapshot | null;
  sourceMetadata: DashboardSourceMetadata;
  intradaySignals: IntradaySignalsSummary;
  marketReference: MarketReferenceSummary;
}

export interface DistributionViewModel extends MultiModelDistributionResponse {}
export interface InsightViewModel extends MultiModelInsightResponse {}

export interface QuickModelMatch extends MultiModelInsightRankedModel {
  rank: number;
}

export interface HomeViewModel {
  locationName: string;
  summaryText: string;
  currentItem: HourlyWeatherItem | null;
  selectedItem: HourlyWeatherItem | null;
  items: HourlyWeatherItem[];
  quickMatches: QuickModelMatch[];
  predictabilityScore: WeatherReportResponse["metrics"]["predictabilityScore"];
  predictabilityLabel: string;
  fieldCoverage: DashboardResponse["hourly"]["fieldCoverage"] | null;
}

export interface AnalysisWorkspaceState {
  tab: "models" | "image";
  locationId: string;
  selectedInsightTimestamp: string | null;
  actualTemperatureC: number | null;
  selectedHourlyTimestamp: string | null;
}

export const mapDashboardResponse = (
  dashboard: DashboardResponse,
  fallbackReport?: WeatherReportResponse,
): DashboardViewModel => {
  const report =
    dashboard.report.available && dashboard.report.textZh ? dashboard.report : (fallbackReport ?? dashboard.report);

  return {
    generatedAt: dashboard.generatedAt,
    displayUnit: dashboard.displayUnit,
    sync: dashboard.sync,
    locationDirectory: dashboard.locationDirectory,
    metar: dashboard.metar ?? {
      observation: null,
      recentTemperatures: [],
    },
    taf: dashboard.taf ?? {
      forecast: null,
      forecasts: [],
    },
    hourly: {
      location: dashboard.hourly.location,
      locationName: dashboard.hourly.location.name,
      locationTimezone: dashboard.hourly.location.timezone,
      fetchedAt: dashboard.hourly.fetchedAt,
      sourceObservedAt: dashboard.hourly.sourceObservedAt,
      sourceType: dashboard.hourly.sourceType,
      fieldCoverage: dashboard.hourly.fieldCoverage,
      stale: dashboard.hourly.stale,
      freshness: dashboard.hourly.freshness,
      warnings: dashboard.hourly.warnings,
      pageUrl: dashboard.hourly.pageUrl,
      current: dashboard.hourly.current,
      items: dashboard.hourly.items.map((item) => ({
        ...item,
        summary: sanitizeString(item.summary),
        summaryZh: sanitizeString(item.summaryZh),
        iconUrl: sanitizeString(item.iconUrl),
        temperatureC: sanitizeNumber(item.temperatureC),
        feelsLikeC: sanitizeNumber(item.feelsLikeC),
        windDirection: sanitizeString(item.windDirection),
        windSpeedKphMin: sanitizeNumber(item.windSpeedKphMin),
        windSpeedKphMax: sanitizeNumber(item.windSpeedKphMax),
        precipitationMm: sanitizeNumber(item.precipitationMm),
        precipitationProbabilityPct: sanitizeNumber(item.precipitationProbabilityPct),
      })),
    },
    report,
    multimodel: dashboard.multimodel,
    supplementalEvidence: dashboard.supplementalEvidence ?? null,
    sourceMetadata: dashboard.sourceMetadata,
    intradaySignals: dashboard.intradaySignals,
    marketReference: dashboard.marketReference,
  };
};

export const mapDistributionResponse = (distribution: MultiModelDistributionResponse): DistributionViewModel => ({
  ...distribution,
  members: distribution.members.map((member) => ({
    ...member,
    temperatureC: sanitizeNumber(member.temperatureC),
    peakTemperatureC: sanitizeNumber(member.peakTemperatureC),
  })),
});

export const mapInsightResponse = (insight: MultiModelInsightResponse): InsightViewModel => {
  const mappedRankedModels = insight.rankedModels.map((model) => ({
    ...model,
    currentTemperatureC: sanitizeNumber(model.currentTemperatureC),
    deltaToActualTemperatureC: sanitizeNumber(model.deltaToActualTemperatureC),
    dayPeakTemperatureC: sanitizeNumber(model.dayPeakTemperatureC),
  }));

  const mappedClosestModel = insight.closestModel
    ? {
        ...insight.closestModel,
        currentTemperatureC: sanitizeNumber(insight.closestModel.currentTemperatureC),
        deltaToActualTemperatureC: sanitizeNumber(insight.closestModel.deltaToActualTemperatureC),
        dayPeakTemperatureC: sanitizeNumber(insight.closestModel.dayPeakTemperatureC),
      }
    : null;

  return {
    ...insight,
    referenceTemperature: {
      ...insight.referenceTemperature,
      temperatureC: sanitizeNumber(insight.referenceTemperature.temperatureC),
    },
    closestModel: mappedRankedModels[0] ?? mappedClosestModel,
    rankedModels: mappedRankedModels,
    peakTimeDistribution: insight.peakTimeDistribution.map((item) => ({
      ...item,
      avgPeakTemperatureC: sanitizeNumber(item.avgPeakTemperatureC),
      minPeakTemperatureC: sanitizeNumber(item.minPeakTemperatureC),
      maxPeakTemperatureC: sanitizeNumber(item.maxPeakTemperatureC),
      peakModels: item.peakModels.map((peakModel) => ({
        ...peakModel,
        dayPeakTemperatureC: sanitizeNumber(peakModel.dayPeakTemperatureC),
      })),
    })),
  };
};

export const pickSelectedTimestamp = (items: HourlyWeatherItem[], currentTimestamp: string | null) => {
  if (!items.length) {
    return null;
  }

  if (currentTimestamp && items.some((item) => item.timestamp === currentTimestamp)) {
    return currentTimestamp;
  }

  const now = Date.now();
  const currentItem =
    items.find((item) => {
      const start = new Date(item.timestamp).getTime();
      const end = item.endAt ? new Date(item.endAt).getTime() : start + 60 * 60 * 1000;
      return now >= start && now < end;
    }) ??
    items.find((item) => new Date(item.timestamp).getTime() >= now) ??
    items[0];

  return currentItem.timestamp;
};

export const buildDockLocations = (
  locationDirectory: DashboardResponse["locationDirectory"],
  activeLocationId: string,
  locationTemperatures: Record<string, number | null>,
  favoriteLocationIds: string[],
): DockLocation[] => {
  const groupOrder: DockLocation["timezoneGroup"][] = ["asia", "europe", "africa", "americas", "oceania"];

  return locationDirectory
    .filter((location) => location.enabled)
    .map((location) => ({
      id: location.id,
      code: location.code,
      stationCodes: buildStationCodes(location),
      displayName: location.displayName,
      displayNameZh: location.displayNameZh,
      shortLabel: location.shortLabel,
      cityName: location.cityName,
      countryName: location.countryName,
      timezone: location.timezone,
      timezoneGroup: location.timezoneGroup,
      temp: Object.prototype.hasOwnProperty.call(locationTemperatures, location.id)
        ? locationTemperatures[location.id] ?? null
        : null,
      displayUnit: location.displayUnit,
      isFavorite: favoriteLocationIds.includes(location.id),
      isActive: location.id === activeLocationId,
      enabled: location.enabled,
      sortOrder: location.sortOrder,
    }))
    .sort(
      (left, right) =>
        groupOrder.indexOf(left.timezoneGroup) - groupOrder.indexOf(right.timezoneGroup) ||
        Number(right.isFavorite) - Number(left.isFavorite) ||
        left.sortOrder - right.sortOrder ||
        left.displayName.localeCompare(right.displayName),
    );
};

export const buildDockLocationGroups = (locations: DockLocation[]): DockLocationGroup[] => {
  const groupLabels: Partial<Record<DockLocation["timezoneGroup"], string>> = {
    asia: "亚洲",
    europe: "欧洲",
    americas: "美洲",
  };

  const groups: DockLocationGroup[] = [
    { group: "asia", label: groupLabels.asia, items: [] },
    { group: "europe", label: groupLabels.europe, items: [] },
    { group: "africa", label: "非洲", items: [] },
    { group: "americas", label: groupLabels.americas, items: [] },
    { group: "oceania", label: "大洋洲", items: [] },
  ];

  const groupMap = new Map(groups.map((group) => [group.group, group]));
  for (const location of locations) {
    groupMap.get(location.timezoneGroup)?.items.push(location);
  }

  return groups;
};

export const buildQuickModelMatches = (insight: InsightViewModel | null, limit = 3): QuickModelMatch[] =>
  (insight?.rankedModels ?? []).slice(0, limit).map((model, index) => ({
    ...model,
    rank: index + 1,
  }));

export const buildHomeViewModel = ({
  dashboard,
  reportText,
  items,
  currentItem,
  selectedItem,
  insight,
}: {
  dashboard: DashboardViewModel | null;
  reportText: string;
  items: HourlyWeatherItem[];
  currentItem: HourlyWeatherItem | null;
  selectedItem: HourlyWeatherItem | null;
  insight: InsightViewModel | null;
}): HomeViewModel => ({
  locationName: dashboard?.hourly.locationName ?? CONFIG.location.DEFAULT_NAME,
  summaryText: reportText,
  currentItem,
  selectedItem,
  items,
  quickMatches: buildQuickModelMatches(insight),
  predictabilityScore: dashboard?.report.metrics.predictabilityScore ?? null,
  predictabilityLabel:
    translatePredictabilityLabel(dashboard?.report.metrics.predictability) ?? CONFIG.fallback.nullValue,
  fieldCoverage: dashboard?.hourly.fieldCoverage ?? null,
});
