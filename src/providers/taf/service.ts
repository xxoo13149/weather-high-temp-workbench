import { load } from "cheerio";

import type {
  LocationInfo,
  TafCloudLayerDetail,
  TafFlightCategory,
  TafForecastOverview,
  TafForecastSegment,
} from "../../domain/weather.js";
import { fetchJson, fetchText } from "../../lib/http.js";
import { resolveMetarStationId } from "../metar/service.js";
import { buildTafDailySummary, buildTafSegmentEnrichments } from "./parser.js";

const TAF_API_BASE_URL = "https://aviationweather.gov/api/data/taf";
const TAF_SOURCE_URL_BASE = `${TAF_API_BASE_URL}?format=json&ids=`;
const TAF_DECODED_PAGE_URL_BASE = "https://metarcentral.com/airport/";
const VISIBILITY_MAX_KM = 10;

type RawTafCloud = {
  cover?: string;
  base?: number;
  type?: string;
};

type RawTafForecast = {
  timeFrom?: string | number;
  timeTo?: string | number;
  fcstChange?: string | null;
  visib?: string | number | null;
  wdir?: string | number | null;
  wspd?: string | number | null;
  wgst?: string | number | null;
  clouds?: RawTafCloud[] | null;
  wx?: string[] | string | null;
  wxString?: string | null;
};

type RawTafResponse = {
  icaoId?: string;
  issueTime?: string | number;
  validTimeFrom?: string | number;
  validTimeTo?: string | number;
  rawTAF?: string;
  name?: string;
  fcsts?: RawTafForecast[] | null;
};

type DecodedForecastCard = {
  changeLabel: string;
  timeFrom: string | null;
  timeTo: string | null;
  flightCategory: TafFlightCategory | null;
  windDirectionDegrees: number | null;
  windSpeedKts: number | null;
  visibilityText: string | null;
  clouds: string[];
  weatherText: string | null;
};

type DecodedPageSnapshot = {
  rawTaf: string | null;
  stationName: string | null;
  forecasts: DecodedForecastCard[];
};

type FetchedTafForecast = Omit<TafForecastOverview, "stale" | "freshness" | "cacheHit">;

export type FetchedTafSnapshot = {
  forecast: FetchedTafForecast | null;
  forecasts: TafForecastSegment[];
};

const normalizeText = (value: string | null | undefined) => value?.replace(/\s+/g, " ").trim() ?? "";

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

const parseNumber = (value: string | number | null | undefined): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const buildTafSourceUrl = (stationId: string) => `${TAF_SOURCE_URL_BASE}${encodeURIComponent(stationId)}`;

const buildDecodedPageUrl = (stationId: string) => `${TAF_DECODED_PAGE_URL_BASE}${encodeURIComponent(stationId)}/taf`;

const visibilityMilesToKm = (miles: number) => {
  if (!Number.isFinite(miles) || miles <= 0) {
    return null;
  }

  return Math.min(VISIBILITY_MAX_KM, Math.round(miles * 1.60934));
};

const normalizeVisibilityKm = (value: string | number | null | undefined): number | null => {
  if (typeof value === "number") {
    return visibilityMilesToKm(value);
  }

  const normalized = normalizeText(value).toUpperCase().replace(/\s+/g, "");
  if (!normalized) {
    return null;
  }

  if (normalized === "CAVOK" || normalized === "P6SM" || normalized === ">6SM" || normalized === "6+") {
    return VISIBILITY_MAX_KM;
  }

  const statuteMilesMatch = /^(?:>|P)?(\d+(?:\.\d+)?)SM$/.exec(normalized);
  if (statuteMilesMatch) {
    const miles = Number.parseFloat(statuteMilesMatch[1]);
    return visibilityMilesToKm(miles);
  }

  if (/^\d+(?:\.\d+)?$/.test(normalized)) {
    return visibilityMilesToKm(Number.parseFloat(normalized));
  }

  if (/^\d{4}$/.test(normalized)) {
    const meters = Number.parseInt(normalized, 10);
    if (meters >= 9999) {
      return VISIBILITY_MAX_KM;
    }
    return Math.max(1, Math.round(meters / 1000));
  }

  return null;
};

const buildCloudToken = (cloud: RawTafCloud): string | null => {
  const cover = normalizeText(cloud.cover).toUpperCase();
  if (!cover) {
    return null;
  }

  const base = parseNumber(cloud.base);
  const cloudType = normalizeText(cloud.type).toUpperCase();
  const baseToken =
    typeof base === "number" && Number.isFinite(base) ? String(Math.round(base / 100)).padStart(3, "0") : "";

  return `${cover}${baseToken}${cloudType}`;
};

const buildCloudLayer = (cloud: RawTafCloud): TafCloudLayerDetail | null => {
  const cover = normalizeText(cloud.cover).toUpperCase();
  if (!cover) {
    return null;
  }

  const baseFt = parseNumber(cloud.base);
  const cloudType = normalizeText(cloud.type).toUpperCase() || null;
  const raw = buildCloudToken(cloud) ?? cover;

  return {
    raw,
    cover,
    baseFt: typeof baseFt === "number" && Number.isFinite(baseFt) ? Math.round(baseFt) : null,
    cloudType,
  };
};

const resolveCeilingFt = (cloudLayers: TafCloudLayerDetail[]) => {
  const ceilingCandidates = cloudLayers
    .filter((layer) => ["BKN", "OVC", "VV"].includes(layer.cover))
    .map((layer) => layer.baseFt)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  if (ceilingCandidates.length === 0) {
    return null;
  }

  return Math.min(...ceilingCandidates);
};

const resolveFlightCategory = (
  visibilityKm: number | null,
  cloudLayers: TafCloudLayerDetail[],
): TafFlightCategory | null => {
  const ceilingFt = resolveCeilingFt(cloudLayers);

  if ((visibilityKm !== null && visibilityKm < 2) || (ceilingFt !== null && ceilingFt < 500)) {
    return "LIFR";
  }

  if ((visibilityKm !== null && visibilityKm < 5) || (ceilingFt !== null && ceilingFt < 1000)) {
    return "IFR";
  }

  if ((visibilityKm !== null && visibilityKm <= 8) || (ceilingFt !== null && ceilingFt <= 3000)) {
    return "MVFR";
  }

  if (visibilityKm !== null || ceilingFt !== null || cloudLayers.length > 0) {
    return "VFR";
  }

  return null;
};

const parseFlightCategory = (value: string | null | undefined): TafFlightCategory | null => {
  const normalized = normalizeText(value).toUpperCase();
  if (normalized === "VFR" || normalized === "MVFR" || normalized === "IFR" || normalized === "LIFR") {
    return normalized;
  }
  return null;
};

const parseWindDetails = (value: string | null | undefined) => {
  const normalized = normalizeText(value).toUpperCase();
  if (!normalized) {
    return {
      windDirectionDegrees: null,
      windSpeedKts: null,
    };
  }

  const match = /(VRB|\d{3})°?\s+AT\s+(\d+(?:\.\d+)?)\s*KT/.exec(normalized);
  if (!match) {
    return {
      windDirectionDegrees: null,
      windSpeedKts: parseNumber(normalized),
    };
  }

  return {
    windDirectionDegrees: match[1] === "VRB" ? null : Number.parseInt(match[1], 10),
    windSpeedKts: Number.parseFloat(match[2]),
  };
};

const parseDecodedPageSnapshot = (html: string): DecodedPageSnapshot => {
  const $ = load(html);

  const currentTafSection = $("h3")
    .filter((_, element) => normalizeText($(element).text()) === "Current TAF Forecast")
    .first()
    .parent();

  const rawTaf =
    normalizeText(currentTafSection.find("div.font-mono .text-gray-900").first().text()) || null;

  const titleText = normalizeText($("title").first().text());
  const stationNameMatch = /^(.*?)\s+\([A-Z0-9]{3,4}\)\s+-\s+TAF Weather Forecast$/i.exec(titleText);
  const stationName = stationNameMatch?.[1] ?? null;

  const forecastHeading = $("h4")
    .filter((_, element) => normalizeText($(element).text()) === "Forecast Periods")
    .first();

  const forecastCards = forecastHeading
    .parent()
    .children("div")
    .filter((_, element) => $(element).find("h5").length > 0)
    .toArray()
    .map((card) => {
      const topSpans = $(card)
        .find("> div")
        .first()
        .find("span");
      const timeSpans = $(card).find("span[data-timestamp]").toArray();
      const detailMap = new Map<string, string>();

      $(card)
        .find("div.grid > div")
        .each((_, cell) => {
          const label = normalizeText($(cell).find(".font-medium").first().text());
          const value = normalizeText($(cell).find(".text-gray-900").first().text());
          if (label && value) {
            detailMap.set(label, value);
          }
        });

      const wind = parseWindDetails(detailMap.get("Wind"));

      return {
        changeLabel: normalizeText($(topSpans.get(0)).text()) || "BASE",
        timeFrom: toIsoTime(Number.parseInt($(timeSpans[0]).attr("data-timestamp") ?? "", 10)),
        timeTo: toIsoTime(Number.parseInt($(timeSpans[1]).attr("data-timestamp") ?? "", 10)),
        flightCategory: parseFlightCategory(
          $(card)
            .find("span")
            .toArray()
            .map((element) => normalizeText($(element).text()))
            .find((text) => ["VFR", "MVFR", "IFR", "LIFR"].includes(text)) ?? null,
        ),
        windDirectionDegrees: wind.windDirectionDegrees,
        windSpeedKts: wind.windSpeedKts,
        visibilityText: detailMap.get("Visibility") ?? null,
        clouds: normalizeText(detailMap.get("Clouds"))
          .split(/\s+/)
          .filter(Boolean),
        weatherText: detailMap.get("Weather") ?? null,
      } satisfies DecodedForecastCard;
    });

  return {
    rawTaf,
    stationName,
    forecasts: forecastCards,
  };
};

const pickOfficialTaf = (payload: RawTafResponse[], stationId: string): RawTafResponse | null => {
  const directMatch =
    payload.find((entry) => normalizeText(entry.icaoId).toUpperCase() === stationId) ?? payload[0] ?? null;
  return directMatch;
};

const normalizeChangeLabel = (value: string | null | undefined): string =>
  normalizeText(value).toUpperCase() || "BASE";

const buildWeatherCodes = (value: RawTafForecast["wx"]): string[] | undefined => {
  if (Array.isArray(value)) {
    const codes = value.map((entry) => normalizeText(entry).toUpperCase()).filter(Boolean);
    return codes.length > 0 ? codes : undefined;
  }

  const text = normalizeText(value).toUpperCase();
  if (!text) {
    return undefined;
  }

  return text.split(/\s+/).filter(Boolean);
};

const buildForecastFromOfficial = (
  officialForecast: RawTafForecast,
  decodedCard: DecodedForecastCard | null,
): TafForecastSegment => {
  const cloudLayers = (officialForecast.clouds ?? [])
    .map((cloud) => buildCloudLayer(cloud))
    .filter((cloud): cloud is TafCloudLayerDetail => Boolean(cloud));

  const clouds = cloudLayers.length > 0 ? cloudLayers.map((cloud) => cloud.raw) : decodedCard?.clouds ?? [];
  const visibilityKm = normalizeVisibilityKm(officialForecast.visib ?? decodedCard?.visibilityText);
  const weatherCodes = buildWeatherCodes(officialForecast.wx ?? officialForecast.wxString);
  const changeLabel = normalizeChangeLabel(officialForecast.fcstChange ?? decodedCard?.changeLabel);

  return {
    changeLabel,
    plainEnglish: null,
    timeFrom: toIsoTime(officialForecast.timeFrom) ?? decodedCard?.timeFrom ?? null,
    timeTo: toIsoTime(officialForecast.timeTo) ?? decodedCard?.timeTo ?? null,
    visibilityKm,
    clouds,
    cloudLayers: cloudLayers.length > 0 ? cloudLayers : undefined,
    windDirectionDegrees: parseNumber(officialForecast.wdir) ?? decodedCard?.windDirectionDegrees ?? null,
    windSpeedKts: parseNumber(officialForecast.wspd) ?? decodedCard?.windSpeedKts ?? null,
    windGustKts: parseNumber(officialForecast.wgst),
    weatherCodes,
    headlineZh: null,
    flightCategory: decodedCard?.flightCategory ?? resolveFlightCategory(visibilityKm, cloudLayers),
  };
};

const buildForecastFromDecoded = (decodedCard: DecodedForecastCard): TafForecastSegment => {
  const cloudLayers = decodedCard.clouds
    .map((cloudToken) => {
      const match = /^(VV|FEW|SCT|BKN|OVC|SKC|NSC|NCD)(\d{3})?([A-Z]+)?$/i.exec(cloudToken);
      if (!match) {
        return {
          raw: cloudToken,
          cover: cloudToken.slice(0, 3).toUpperCase(),
          baseFt: null,
          cloudType: null,
        } satisfies TafCloudLayerDetail;
      }

      return {
        raw: cloudToken.toUpperCase(),
        cover: match[1].toUpperCase(),
        baseFt: match[2] ? Number.parseInt(match[2], 10) * 100 : null,
        cloudType: match[3]?.toUpperCase() ?? null,
      } satisfies TafCloudLayerDetail;
    })
    .filter(Boolean);

  const visibilityKm = normalizeVisibilityKm(decodedCard.visibilityText);

  return {
    changeLabel: normalizeChangeLabel(decodedCard.changeLabel),
    plainEnglish: null,
    timeFrom: decodedCard.timeFrom,
    timeTo: decodedCard.timeTo,
    visibilityKm,
    clouds: decodedCard.clouds,
    cloudLayers: cloudLayers.length > 0 ? cloudLayers : undefined,
    windDirectionDegrees: decodedCard.windDirectionDegrees,
    windSpeedKts: decodedCard.windSpeedKts,
    windGustKts: null,
    headlineZh: null,
    flightCategory: decodedCard.flightCategory ?? resolveFlightCategory(visibilityKm, cloudLayers),
  };
};

const sortForecasts = (forecasts: TafForecastSegment[]) =>
  [...forecasts].sort((left, right) => {
    const leftTime = left.timeFrom ? Date.parse(left.timeFrom) : Number.NEGATIVE_INFINITY;
    const rightTime = right.timeFrom ? Date.parse(right.timeFrom) : Number.NEGATIVE_INFINITY;

    if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) {
      return left.changeLabel.localeCompare(right.changeLabel);
    }

    return leftTime - rightTime;
  });

const resolveActiveForecast = (
  forecasts: TafForecastSegment[],
  validFrom: string | null,
  validTo: string | null,
): TafForecastSegment | null => {
  if (forecasts.length === 0) {
    return null;
  }

  const now = Date.now();
  const active = forecasts.find((forecast) => {
    const fromMs = forecast.timeFrom ? Date.parse(forecast.timeFrom) : validFrom ? Date.parse(validFrom) : Number.NaN;
    const toMs = forecast.timeTo ? Date.parse(forecast.timeTo) : validTo ? Date.parse(validTo) : Number.NaN;

    if (Number.isNaN(fromMs) && Number.isNaN(toMs)) {
      return false;
    }

    if (Number.isNaN(fromMs)) {
      return now <= toMs;
    }

    if (Number.isNaN(toMs)) {
      return now >= fromMs;
    }

    return now >= fromMs && now < toMs;
  });

  return active ?? forecasts[0] ?? null;
};

export const fetchTafSnapshot = async (location: LocationInfo): Promise<FetchedTafSnapshot> => {
  const stationId = resolveMetarStationId(location.id);
  if (!stationId) {
    return {
      forecast: null,
      forecasts: [],
    };
  }

  const officialSourceUrl = buildTafSourceUrl(stationId);
  const sourceUrl = buildDecodedPageUrl(stationId);

  const [officialResult, decodedResult] = await Promise.allSettled([
    fetchJson<RawTafResponse[]>(officialSourceUrl),
    fetchText(sourceUrl),
  ]);

  if (officialResult.status === "rejected" && decodedResult.status === "rejected") {
    throw officialResult.reason ?? decodedResult.reason;
  }

  const officialEntry =
    officialResult.status === "fulfilled" ? pickOfficialTaf(officialResult.value ?? [], stationId) : null;
  const decodedSnapshot =
    decodedResult.status === "fulfilled"
      ? parseDecodedPageSnapshot(decodedResult.value)
      : {
          rawTaf: null,
          stationName: null,
          forecasts: [],
        };

  const decodedByIndex = decodedSnapshot.forecasts;
  const baseForecasts =
    officialEntry?.fcsts && officialEntry.fcsts.length > 0
      ? sortForecasts(
          officialEntry.fcsts.map((forecast, index) => buildForecastFromOfficial(forecast, decodedByIndex[index] ?? null)),
        )
      : sortForecasts(decodedByIndex.map((forecast) => buildForecastFromDecoded(forecast)));

  const issuedAt = toIsoTime(officialEntry?.issueTime);
  const validFrom = toIsoTime(officialEntry?.validTimeFrom) ?? baseForecasts[0]?.timeFrom ?? null;
  const validTo =
    toIsoTime(officialEntry?.validTimeTo) ??
    baseForecasts[baseForecasts.length - 1]?.timeTo ??
    baseForecasts[0]?.timeTo ??
    null;
  const fetchedAt = new Date().toISOString();
  const rawTaf = normalizeText(officialEntry?.rawTAF) || decodedSnapshot.rawTaf;
  const forecasts = buildTafSegmentEnrichments({
    rawTaf,
    forecasts: baseForecasts,
  });
  const activeForecast = resolveActiveForecast(forecasts, validFrom, validTo);
  const activeForecastIndex =
    activeForecast === null ? -1 : forecasts.findIndex((forecast) => forecast === activeForecast);

  if (!rawTaf && forecasts.length === 0) {
    return {
      forecast: null,
      forecasts: [],
    };
  }

  return {
    forecast: {
      location,
      stationId,
      stationName: officialEntry?.name ?? decodedSnapshot.stationName ?? location.name,
      issuedAt,
      validFrom,
      validTo,
      rawTaf: rawTaf || null,
      sourceUrl,
      officialSourceUrl,
      activeForecast,
      dailySummary: buildTafDailySummary({
        issuedAt,
        validFrom,
        validTo,
        rawTaf,
        forecasts,
        activeForecastIndex,
      }),
      fetchedAt,
    },
    forecasts,
  };
};
