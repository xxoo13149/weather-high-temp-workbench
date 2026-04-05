import { AppError } from "../../domain/errors.js";
import type { HourlyWeatherItem } from "../../domain/weather.js";
import { parseLocalDateTimeInTimeZone, toIsoInTimeZone } from "../../lib/time.js";

export const WEEK_METEOGRAM_VERSION = "2026-03-29.2";

interface MeteogramRoot {
  credits?: {
    text?: string;
  };
  series?: MeteogramSeries[];
}

interface MeteogramSeries {
  name?: string;
  type?: string;
  xAxis?: number;
  yAxis?: number;
  data?: MeteogramPoint[];
}

interface MeteogramPoint {
  x?: number;
  y?: number | null;
  name?: string;
  marker?: {
    symbol?: string;
  };
  direction?: number | null;
}

const TEMPERATURE_SERIES = "Temperature";
const PRECIPITATION_SERIES = "Precipitation";
const SHOWERS_SERIES = "Showers";
const WIND_SPEED_SERIES = "Wind speed";
const WIND_GUST_SERIES = "Wind gust";
const WIND_DIRECTION_SERIES = "Wind direction";
const PICTOGRAM_SERIES = "Pictograms";

const directionBuckets = [
  "N",
  "NNE",
  "NE",
  "ENE",
  "E",
  "ESE",
  "SE",
  "SSE",
  "S",
  "SSW",
  "SW",
  "WSW",
  "W",
  "WNW",
  "NW",
  "NNW",
] as const;

const normalizeUrl = (href: string): string => {
  const decoded = href.trim().replace(/&amp;/g, "&");
  if (decoded.startsWith("//")) {
    return `https:${decoded}`;
  }

  return new URL(decoded, "https://www.meteoblue.com").toString();
};

const assertWeekMeteogramHighchartsUrl = (url: string): string => {
  if (!url.includes("/images/meteogram") || !url.includes("format=highcharts")) {
    throw new AppError(
      503,
      "WEEK_METEOGRAM_URL_INVALID",
      "Resolved link does not look like a week meteogram highcharts export.",
      {
        retryable: true,
      },
    );
  }

  return url;
};

export const extractWeekMeteogramHighchartsUrl = (html: string): string => {
  const match = html.match(/(?:data-url|data-href|href)=\"([^\"]*images\/meteogram[^\"]*format=highcharts[^\"]*)\"/i);
  if (!match) {
    throw new AppError(
      503,
      "WEEK_METEOGRAM_URL_NOT_FOUND",
      "Could not find a meteoblue week meteogram highcharts link.",
      {
        retryable: true,
      },
    );
  }

  return assertWeekMeteogramHighchartsUrl(normalizeUrl(match[1]));
};

const parseMeteogramJson = (raw: string): MeteogramRoot => {
  try {
    return JSON.parse(raw.replace(/^\uFEFF/, "")) as MeteogramRoot;
  } catch (error) {
    throw new AppError(
      503,
      "WEEK_METEOGRAM_PARSE_FAILED",
      `Could not parse meteoblue week meteogram payload: ${String(error)}`,
      {
        retryable: true,
      },
    );
  }
};

const round = (value: number, digits: number): number => Number.parseFloat(value.toFixed(digits));

const toWallClockValue = (timestamp: number): string => {
  const iso = new Date(timestamp).toISOString();
  return iso.slice(0, 19).replace("T", " ");
};

const pointTimestampToIso = (point: MeteogramPoint, timeZone: string): string | null => {
  const sourceText = typeof point.name === "string" && point.name.trim() !== "" ? point.name.trim() : typeof point.x === "number" ? toWallClockValue(point.x) : null;
  if (!sourceText) {
    return null;
  }

  const parsed = parseLocalDateTimeInTimeZone(sourceText, timeZone);
  return parsed ? toIsoInTimeZone(parsed, timeZone) : null;
};

const makeSeriesMap = (series: MeteogramSeries | undefined, timeZone: string): Map<string, MeteogramPoint> => {
  const map = new Map<string, MeteogramPoint>();
  for (const point of series?.data ?? []) {
    const timestamp = pointTimestampToIso(point, timeZone);
    if (!timestamp) {
      continue;
    }

    map.set(timestamp, point);
  }

  return map;
};

const toWindDirection = (degrees: number | null | undefined): string | null => {
  if (typeof degrees !== "number" || Number.isNaN(degrees)) {
    return null;
  }

  const normalized = ((degrees % 360) + 360) % 360;
  const index = Math.round(normalized / 22.5) % directionBuckets.length;
  return directionBuckets[index] ?? null;
};

const extractMarkerUrl = (symbol: string | undefined): string | null => {
  if (!symbol) {
    return null;
  }

  const match = symbol.match(/^url\((.+)\)$/i);
  return match ? match[1] : null;
};

const parseSourceUpdatedAt = (text: string | undefined, timeZone: string): string | null => {
  if (!text) {
    return null;
  }

  const match = text.match(/Last update:\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/i);
  if (!match) {
    return null;
  }

  const parsed = parseLocalDateTimeInTimeZone(`${match[1]} ${match[2]}`, timeZone);
  return parsed ? toIsoInTimeZone(parsed, timeZone) : null;
};

const findSeries = (series: MeteogramSeries[], name: string): MeteogramSeries | undefined =>
  series.find((entry) => entry.name === name);

export interface ParsedWeekMeteogram {
  sourceUpdatedAt: string | null;
  items: HourlyWeatherItem[];
}

export const parseWeekMeteogramHighcharts = (raw: string, timeZone: string): ParsedWeekMeteogram => {
  const root = parseMeteogramJson(raw);
  const seriesList = root.series ?? [];

  const temperatureSeries = findSeries(seriesList, TEMPERATURE_SERIES);
  if (!temperatureSeries || !Array.isArray(temperatureSeries.data) || temperatureSeries.data.length === 0) {
    throw new AppError(
      503,
      "WEEK_METEOGRAM_TEMPERATURE_NOT_FOUND",
      "Could not find hourly temperature data in the week meteogram payload.",
      {
        retryable: true,
      },
    );
  }

  const precipitationMap = makeSeriesMap(findSeries(seriesList, PRECIPITATION_SERIES), timeZone);
  const showersMap = makeSeriesMap(findSeries(seriesList, SHOWERS_SERIES), timeZone);
  const windSpeedMap = makeSeriesMap(findSeries(seriesList, WIND_SPEED_SERIES), timeZone);
  const windGustMap = makeSeriesMap(findSeries(seriesList, WIND_GUST_SERIES), timeZone);
  const windDirectionMap = makeSeriesMap(findSeries(seriesList, WIND_DIRECTION_SERIES), timeZone);
  const pictogramMap = makeSeriesMap(findSeries(seriesList, PICTOGRAM_SERIES), timeZone);

  const datedPoints = temperatureSeries.data
    .map((point) => ({ point, timestamp: pointTimestampToIso(point, timeZone) }))
    .filter((entry): entry is { point: MeteogramPoint; timestamp: string } => entry.timestamp !== null);

  const items = datedPoints.map((entry, index) => {
    const nextTimestamp = datedPoints[index + 1]?.timestamp ?? null;
    const precipitation = (precipitationMap.get(entry.timestamp)?.y ?? 0) + (showersMap.get(entry.timestamp)?.y ?? 0);
    const windSpeed = windSpeedMap.get(entry.timestamp)?.y;
    const windGust = windGustMap.get(entry.timestamp)?.y;
    const pictogram = pictogramMap.get(entry.timestamp);

    return {
      timestamp: entry.timestamp,
      endAt: nextTimestamp,
      summary: null,
      summaryZh: null,
      iconUrl: extractMarkerUrl(pictogram?.marker?.symbol),
      temperatureC: typeof entry.point.y === "number" ? round(entry.point.y, 1) : null,
      feelsLikeC: null,
      windDirection: toWindDirection(windDirectionMap.get(entry.timestamp)?.direction),
      windSpeedKphMin: typeof windSpeed === "number" ? round(windSpeed, 1) : null,
      windSpeedKphMax:
        typeof windGust === "number"
          ? round(windGust, 1)
          : typeof windSpeed === "number"
            ? round(windSpeed, 1)
            : null,
      precipitationMm: round(precipitation, 2),
      precipitationProbabilityPct: null,
    } satisfies HourlyWeatherItem;
  });

  if (items.length === 0) {
    throw new AppError(
      503,
      "WEEK_METEOGRAM_EMPTY",
      "The week meteogram payload did not contain any hourly timestamps.",
      {
        retryable: true,
      },
    );
  }

  return {
    sourceUpdatedAt: parseSourceUpdatedAt(root.credits?.text, timeZone),
    items,
  };
};
