import {
  normalizeDashboardMetarSnapshot,
  type DashboardMetarSnapshot,
  type LocationInfo,
  type MetarObservation,
  type MetarRecentReport,
  type MetarTemperatureSample,
} from "../../domain/weather.js";
import { RefreshableCache } from "../../lib/cache.js";
import { fetchBinary, fetchJson } from "../../lib/http.js";

const METAR_API_BASE_URL = "https://aviationweather.gov/api/data/metar";
const METAR_SOURCE_URL_BASE = `${METAR_API_BASE_URL}?format=json&ids=`;
const METAR_CACHE_CSV_URL = "https://aviationweather.gov/data/cache/metars.cache.csv.gz";
const RECENT_METAR_HOURS = 24;
const DASHBOARD_RECENT_REPORT_HOURS = 4;
const METAR_CACHE_TTL_MS = 60_000;

const ICAO_BY_LOCATION: Partial<Record<LocationInfo["id"], string>> = {
  amsterdam_ams: "EHAM",
  ankara_esb: "LTAC",
  atlanta_atl: "KATL",
  austin_aus: "KAUS",
  beijing_pek: "ZBAA",
  buenosaires_eze: "SAEZ",
  busan_pus: "RKPK",
  capetown_cpt: "FACT",
  chengdu_ctu: "ZUUU",
  chicago_ord: "KORD",
  chongqing_ckg: "ZUCK",
  dallas_dal: "KDAL",
  denver_bfk: "KBKF",
  guangzhou_can: "ZGGG",
  helsinki_hel: "EFHK",
  hongkong_hkg: "VHHH",
  houston_hou: "KHOU",
  shanghai_pvg: "ZSPD",
  istanbul_ist: "LTFM",
  jakarta_hlp: "WIHH",
  jeddah_jed: "OEJN",
  karachi_khi: "OPKC",
  kualalumpur_kul: "WMKK",
  lagos_los: "DNMM",
  london_lcy: "EGLC",
  lucknow_lko: "VILK",
  madrid_mad: "LEMD",
  manila_mnl: "RPLL",
  // OPMR currently has no public METAR feed on AviationWeather, so we temporarily fall back to the
  // nearby Karachi airport station to keep the city-level observation chain available.
  masroor_opmr: "OPKC",
  mexicocity_mex: "MMMX",
  milan_mxp: "LIMC",
  moscow_vko: "UUWW",
  munich_muc: "EDDM",
  miami_mia: "KMIA",
  newyork_lga: "KLGA",
  panamacity_pac: "MPMG",
  paris_cdg: "LFPG",
  losangeles_lax: "KLAX",
  sanfrancisco_sfo: "KSFO",
  saopaulo_gru: "SBGR",
  seattle_sea: "KSEA",
  seoul_icn: "RKSI",
  shenzhen_szx: "ZGSZ",
  singapore_sin: "WSSS",
  taipei_tpe: "RCTP",
  telaviv_tlv: "LLBG",
  tokyo_hnd: "RJTT",
  toronto_yyz: "CYYZ",
  warsaw_waw: "EPWA",
  wellington_wlg: "NZWN",
  wuhan_wuh: "ZHHH",
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

type CachedMetarRow = {
  stationId: string;
  observedAt: string;
  temperatureC: number | null;
  dewpointC: number | null;
  windDirectionDegrees: number | null;
  windSpeedKts: number | null;
  rawReport: string | null;
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

const parseCsvLine = (line: string) => {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
        continue;
      }

      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
};

const parseNumber = (value: string | undefined) => {
  if (!value) {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const decompressGzipUtf8 = async (body: Buffer) => {
  if (typeof DecompressionStream !== "undefined") {
    const bytes = new Uint8Array(body);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return await new Response(stream).text();
  }

  const { gunzipSync } = await import("node:zlib");
  return gunzipSync(body).toString("utf-8");
};

const loadCachedMetarIndex = async () => {
  const { body } = await fetchBinary(METAR_CACHE_CSV_URL, {
    headers: {
      accept: "text/csv,application/gzip,*/*",
    },
  });
  const csv = await decompressGzipUtf8(body);
  const [headerLine, ...lines] = csv.split(/\r?\n/).filter(Boolean);
  if (!headerLine) {
    return new Map<string, CachedMetarRow>();
  }

  const headers = parseCsvLine(headerLine);
  const getColumnIndex = (columnName: string) => headers.indexOf(columnName);
  const stationIdIndex = getColumnIndex("station_id");
  const observationTimeIndex = getColumnIndex("observation_time");
  const temperatureIndex = getColumnIndex("temp_c");
  const dewpointIndex = getColumnIndex("dewpoint_c");
  const windDirectionIndex = getColumnIndex("wind_dir_degrees");
  const windSpeedIndex = getColumnIndex("wind_speed_kt");
  const rawTextIndex = getColumnIndex("raw_text");

  if (
    stationIdIndex === -1 ||
    observationTimeIndex === -1 ||
    temperatureIndex === -1 ||
    dewpointIndex === -1 ||
    windDirectionIndex === -1 ||
    windSpeedIndex === -1 ||
    rawTextIndex === -1
  ) {
    return new Map<string, CachedMetarRow>();
  }

  const index = new Map<string, CachedMetarRow>();
  for (const line of lines) {
    const row = parseCsvLine(line);
    const stationId = row[stationIdIndex]?.trim();
    const observedAt = toIsoTime(row[observationTimeIndex]);
    if (!stationId || !observedAt) {
      continue;
    }

    const existing = index.get(stationId);
    if (existing && existing.observedAt.localeCompare(observedAt) >= 0) {
      continue;
    }

    index.set(stationId, {
      stationId,
      observedAt,
      temperatureC: parseNumber(row[temperatureIndex]),
      dewpointC: parseNumber(row[dewpointIndex]),
      windDirectionDegrees: parseNumber(row[windDirectionIndex]),
      windSpeedKts: parseNumber(row[windSpeedIndex]),
      rawReport: row[rawTextIndex] || null,
    });
  }

  return index;
};

const metarCurrentCache = new RefreshableCache<Map<string, CachedMetarRow>>(METAR_CACHE_TTL_MS, loadCachedMetarIndex);

const getCachedLatestMetar = async (stationId: string) => {
  const result = await metarCurrentCache.get({
    allowStaleOnError: true,
    staleWhileRevalidate: true,
  });
  return result.value.get(stationId) ?? null;
};

export const __resetMetarTestState = () => {
  metarCurrentCache.invalidate();
};

const resolveObservedAt = (entry: Pick<RawMetarResponse, "reportTime" | "obsTime" | "receiptTime">) =>
  toIsoTime(entry.reportTime) ?? toIsoTime(entry.obsTime) ?? toIsoTime(entry.receiptTime);

const toRecentReport = (entry: RawMetarResponse, fallbackStationId: string): MetarRecentReport | null => {
  const observedAt = resolveObservedAt(entry);
  if (!observedAt) {
    return null;
  }

  return {
    stationId: typeof entry.icaoId === "string" && entry.icaoId.trim() ? entry.icaoId.trim().toUpperCase() : fallbackStationId,
    stationName: typeof entry.name === "string" ? entry.name : null,
    observedAt,
    temperatureC: typeof entry.temp === "number" ? entry.temp : null,
    dewpointC: typeof entry.dewp === "number" ? entry.dewp : null,
    windDirectionDegrees: typeof entry.wdir === "number" ? entry.wdir : null,
    windSpeedKts: typeof entry.wspd === "number" ? entry.wspd : null,
    rawReport: typeof entry.rawOb === "string" ? entry.rawOb : null,
  };
};

const toRecentTemperatures = (reports: MetarRecentReport[]): MetarTemperatureSample[] =>
  reports
    .filter((entry): entry is MetarRecentReport & { temperatureC: number } => typeof entry.temperatureC === "number")
    .map((entry) => ({
      observedAt: entry.observedAt,
      temperatureC: entry.temperatureC,
    }));

const toRecentReports = (reports: MetarRecentReport[], recentHours = DASHBOARD_RECENT_REPORT_HOURS): MetarRecentReport[] => {
  const latestObservedAt = reports[0]?.observedAt;
  if (!latestObservedAt) {
    return [];
  }

  const latestTime = Date.parse(latestObservedAt);
  if (Number.isNaN(latestTime)) {
    return [];
  }

  const cutoffTime = latestTime - recentHours * 60 * 60 * 1000;
  return reports.filter((entry) => Date.parse(entry.observedAt) >= cutoffTime).slice(0, 4);
};

const toRecentReportFromCache = (stationId: string, cached: CachedMetarRow): MetarRecentReport => ({
  stationId,
  stationName: null,
  observedAt: cached.observedAt,
  temperatureC: cached.temperatureC,
  dewpointC: cached.dewpointC,
  windDirectionDegrees: cached.windDirectionDegrees,
  windSpeedKts: cached.windSpeedKts,
  rawReport: cached.rawReport,
});

const toObservationFromCache = (location: LocationInfo, stationId: string, cached: CachedMetarRow): DashboardMetarSnapshot => {
  const sourceUrl = buildMetarSourceUrl(stationId);
  const recentReport = toRecentReportFromCache(stationId, cached);

  return normalizeDashboardMetarSnapshot({
    observation:
      typeof cached.temperatureC === "number"
        ? {
            location,
            stationId,
            observedAt: cached.observedAt,
            temperatureC: cached.temperatureC,
            dewpointC: cached.dewpointC,
            windDirectionDegrees: cached.windDirectionDegrees,
            windSpeedKts: cached.windSpeedKts,
            rawReport: cached.rawReport,
            stationName: null,
            sourceUrl,
            fetchedAt: new Date().toISOString(),
            stale: false,
            freshness: "fresh",
            cacheHit: true,
          }
        : null,
    recentTemperatures:
      typeof cached.temperatureC === "number"
        ? [
            {
              observedAt: cached.observedAt,
              temperatureC: cached.temperatureC,
            },
          ]
        : [],
    recentObservations: [recentReport],
    recentReports: [recentReport],
  });
};

export const fetchMetarSnapshot = async (
  location: LocationInfo,
  hours = RECENT_METAR_HOURS,
): Promise<DashboardMetarSnapshot> => {
  const stationId = resolveMetarStationId(location.id);
  if (!stationId) {
    return normalizeDashboardMetarSnapshot();
  }

  const sourceUrl = buildMetarSourceUrl(stationId, hours);
  const cachedLatest = await getCachedLatestMetar(stationId).catch(() => null);
  let payload: RawMetarResponse[];
  try {
    payload = await fetchJson<RawMetarResponse[]>(sourceUrl);
  } catch {
    if (cachedLatest) {
      return toObservationFromCache(location, stationId, cachedLatest);
    }

    // METAR is an auxiliary observation source; an upstream parse/fetch miss should degrade to no observation,
    // not take down the Kelly workbench for the whole city.
    return normalizeDashboardMetarSnapshot();
  }

  if (!Array.isArray(payload)) {
    return cachedLatest ? toObservationFromCache(location, stationId, cachedLatest) : normalizeDashboardMetarSnapshot();
  }

  const reports = payload
    .map((entry) => toRecentReport(entry, stationId))
    .filter((entry): entry is MetarRecentReport => Boolean(entry))
    .sort((left, right) => right.observedAt.localeCompare(left.observedAt));
  const recentTemperatures = toRecentTemperatures(reports);
  const recentReports = toRecentReports(reports);
  const latest = reports.find(
    (entry): entry is MetarRecentReport & { temperatureC: number } => typeof entry.temperatureC === "number",
  );

  if (!latest) {
    if (cachedLatest) {
      const snapshot = toObservationFromCache(location, stationId, cachedLatest);
      return normalizeDashboardMetarSnapshot({
        observation: snapshot.observation,
        recentTemperatures: recentTemperatures.length > 0 ? recentTemperatures : snapshot.recentTemperatures,
        recentReports: recentReports.length > 0 ? recentReports : snapshot.recentReports,
        recentObservations: recentReports.length > 0 ? recentReports : snapshot.recentObservations,
      });
    }

    return normalizeDashboardMetarSnapshot({
      observation: null,
      recentTemperatures,
      recentReports,
      recentObservations: recentReports,
    });
  }

  return normalizeDashboardMetarSnapshot({
    observation: {
      location,
      stationId: latest.stationId,
      observedAt: latest.observedAt,
      temperatureC: latest.temperatureC,
      dewpointC: latest.dewpointC,
      windDirectionDegrees: latest.windDirectionDegrees,
      windSpeedKts: latest.windSpeedKts,
      rawReport: latest.rawReport,
      stationName: latest.stationName,
      sourceUrl,
      fetchedAt: new Date().toISOString(),
      stale: false,
      freshness: "fresh",
      cacheHit: false,
    },
    recentTemperatures,
    recentReports,
    recentObservations: recentReports,
  });
};

export const fetchLatestMetarObservation = async (
  location: LocationInfo,
): Promise<Omit<MetarObservation, "stale" | "cacheHit"> | null> => {
  return (await fetchMetarSnapshot(location)).observation;
};
