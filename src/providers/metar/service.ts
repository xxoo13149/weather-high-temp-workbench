import type { LocationInfo, MetarObservation } from "../../domain/weather.js";
import { fetchJson } from "../../lib/http.js";

const METAR_API_BASE_URL = "https://aviationweather.gov/api/data/metar";
const METAR_SOURCE_URL_BASE = `${METAR_API_BASE_URL}?format=json&ids=`;
const RECENT_METAR_HOURS = 24;

const ICAO_BY_LOCATION: Partial<Record<LocationInfo["id"], string>> = {
  shanghai_pvg: "ZSPD",
  wuhan_wuh: "ZHHH",
  istanbul_ist: "LTFM",
  munich_muc: "EDDM",
  toronto_yyz: "CYYZ",
  miami_mia: "KMIA",
};

type RawMetarResponse = {
  icaoId?: string;
  receiptTime?: string;
  reportTime?: string;
  obsTime?: number;
  temp?: number;
  dewp?: number;
  wdir?: number;
  wspd?: number;
  rawOb?: string;
  name?: string;
};

export type MetarTemperatureSample = {
  observedAt: string;
  temperatureC: number;
};

const toIsoTime = (value: string | number | null | undefined): string | null => {
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value > 1e12 ? value : value * 1000;
    const parsed = new Date(millis);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  return null;
};

export const resolveMetarStationId = (locationId: LocationInfo["id"]): string | null =>
  ICAO_BY_LOCATION[locationId] ?? null;

const buildMetarSourceUrl = (stationId: string, hours = RECENT_METAR_HOURS) =>
  `${METAR_SOURCE_URL_BASE}${encodeURIComponent(stationId)}&hours=${hours}`;

const toTemperatureSamples = (payload: RawMetarResponse[]): MetarTemperatureSample[] =>
  payload
    .map((entry) => ({
      observedAt: toIsoTime(entry.reportTime) ?? toIsoTime(entry.obsTime) ?? toIsoTime(entry.receiptTime),
      temperatureC: typeof entry.temp === "number" ? entry.temp : null,
    }))
    .filter((entry): entry is MetarTemperatureSample => Boolean(entry.observedAt) && typeof entry.temperatureC === "number")
    .sort((left, right) => right.observedAt.localeCompare(left.observedAt));

export const fetchMetarSnapshot = async (
  location: LocationInfo,
  hours = RECENT_METAR_HOURS,
): Promise<{
  observation: Omit<MetarObservation, "stale" | "cacheHit"> | null;
  recentTemperatures: MetarTemperatureSample[];
}> => {
  const stationId = resolveMetarStationId(location.id);
  if (!stationId) {
    return {
      observation: null,
      recentTemperatures: [],
    };
  }

  const sourceUrl = buildMetarSourceUrl(stationId, hours);
  const payload = await fetchJson<RawMetarResponse[]>(sourceUrl);
  const recentTemperatures = toTemperatureSamples(payload);
  const latest = payload
    .filter((entry) => typeof entry.temp === "number")
    .sort((left, right) => {
      const leftTime = toIsoTime(left.reportTime) ?? toIsoTime(left.obsTime) ?? toIsoTime(left.receiptTime) ?? "";
      const rightTime = toIsoTime(right.reportTime) ?? toIsoTime(right.obsTime) ?? toIsoTime(right.receiptTime) ?? "";
      return rightTime.localeCompare(leftTime);
    })[0];

  if (!latest || typeof latest.temp !== "number") {
    return {
      observation: null,
      recentTemperatures,
    };
  }

  return {
    observation: {
      location,
      stationId,
      observedAt: toIsoTime(latest.reportTime) ?? toIsoTime(latest.obsTime) ?? toIsoTime(latest.receiptTime) ?? new Date().toISOString(),
      temperatureC: latest.temp,
      dewpointC: typeof latest.dewp === "number" ? latest.dewp : null,
      windDirectionDegrees: typeof latest.wdir === "number" ? latest.wdir : null,
      windSpeedKts: typeof latest.wspd === "number" ? latest.wspd : null,
      rawReport: typeof latest.rawOb === "string" ? latest.rawOb : null,
      stationName: typeof latest.name === "string" ? latest.name : null,
      sourceUrl,
      fetchedAt: new Date().toISOString(),
    },
    recentTemperatures,
  };
};

export const fetchLatestMetarObservation = async (
  location: LocationInfo,
): Promise<Omit<MetarObservation, "stale" | "cacheHit"> | null> => {
  return (await fetchMetarSnapshot(location)).observation;
};
