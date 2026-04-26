import { load } from "cheerio";

import { AppError } from "../../domain/errors.js";
import type { HourlyFieldMissingReason, HourlyWeatherItem, WeatherReportMetrics } from "../../domain/weather.js";
import { parseLocalDateTimeInTimeZone, parseObservedTime, toIsoInTimeZone } from "../../lib/time.js";

export const WEEK_PARSER_VERSION = "2026-04-04.2";
type CheerioRoot = ReturnType<typeof load>;
type CheerioSelection = ReturnType<CheerioRoot>;
type ParsedTemperatureUnit = "C" | "F";

interface ParsedWeatherReport {
  available: boolean;
  titleEn: string | null;
  sourceTextEn: string | null;
  textZh: string | null;
  metrics: WeatherReportMetrics;
  warnings: string[];
}

export interface ParsedWeekData {
  sourceObservedAt: string | null;
  oneHourItems: HourlyWeatherItem[];
  oneHourWarnings: string[];
  oneHourPartial: boolean;
  oneHourFieldDiagnostics: ParsedOneHourFieldDiagnostics;
  threeHourItems: HourlyWeatherItem[];
  warnings: string[];
  partial: boolean;
  report: ParsedWeatherReport;
}

type ParsedFieldMissingReason = Exclude<HourlyFieldMissingReason, "fallback-unavailable">;
type ParsedOneHourFieldName = "feelsLikeC" | "precipitationProbabilityPct" | "windDirection";

export interface ParsedOneHourFieldDiagnosticEntry {
  rowFound: boolean;
  missingByTimestamp: Record<string, ParsedFieldMissingReason>;
}

export interface ParsedOneHourFieldDiagnostics {
  feelsLikeC: ParsedOneHourFieldDiagnosticEntry;
  precipitationProbabilityPct: ParsedOneHourFieldDiagnosticEntry;
  windDirection: ParsedOneHourFieldDiagnosticEntry;
}

interface ParsedOneHourModeResult {
  items: HourlyWeatherItem[];
  diagnostics: ParsedOneHourFieldDiagnostics;
}

const createEmptyOneHourFieldDiagnostics = (): ParsedOneHourFieldDiagnostics => ({
  feelsLikeC: {
    rowFound: false,
    missingByTimestamp: {},
  },
  precipitationProbabilityPct: {
    rowFound: false,
    missingByTimestamp: {},
  },
  windDirection: {
    rowFound: false,
    missingByTimestamp: {},
  },
});

const setMissingReason = (
  diagnostics: ParsedOneHourFieldDiagnostics,
  field: ParsedOneHourFieldName,
  timestamp: string,
  reason: ParsedFieldMissingReason,
) => {
  diagnostics[field].missingByTimestamp[timestamp] = reason;
};

type PredictabilityLevel = "very_high" | "high" | "medium" | "low";

interface PredictabilityResult {
  level: PredictabilityLevel | null;
  score: 1 | 2 | 3 | 4 | null;
}

const normalizeText = (value: string): string =>
  value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const hasExplicitTimezoneOffset = (value: string): boolean => /(?:[+-]\d{2}:\d{2}|Z)$/i.test(value);

const normalizeTimestampByTimezone = (rawTimestamp: string, timezone: string): string => {
  const normalized = normalizeText(rawTimestamp);
  if (!normalized) {
    return "";
  }

  if (hasExplicitTimezoneOffset(normalized)) {
    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.getTime())) {
      return toIsoInTimeZone(parsed, timezone);
    }

    return normalized;
  }

  const parsedLocal = parseLocalDateTimeInTimeZone(normalized, timezone);
  if (parsedLocal) {
    return toIsoInTimeZone(parsedLocal, timezone);
  }

  const parsedFallback = new Date(normalized);
  if (!Number.isNaN(parsedFallback.getTime())) {
    return toIsoInTimeZone(parsedFallback, timezone);
  }

  return normalized;
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const containsChinese = (value: string): boolean => /[\u4e00-\u9fff]/.test(value);
const containsLatinLetters = (value: string): boolean => /[A-Za-z]/.test(value);

const windDirectionMap: Record<string, string> = {
  North: "\u5317\u98ce",
  Northeast: "\u4e1c\u5317\u98ce",
  East: "\u4e1c\u98ce",
  Southeast: "\u4e1c\u5357\u98ce",
  South: "\u5357\u98ce",
  Southwest: "\u897f\u5357\u98ce",
  West: "\u897f\u98ce",
  Northwest: "\u897f\u5317\u98ce",
};

const weekdayMap: Record<string, string> = {
  Monday: "\u5468\u4e00",
  Tuesday: "\u5468\u4e8c",
  Wednesday: "\u5468\u4e09",
  Thursday: "\u5468\u56db",
  Friday: "\u5468\u4e94",
  Saturday: "\u5468\u516d",
  Sunday: "\u5468\u65e5",
};

const predictabilityLabelMap: Record<PredictabilityLevel, string> = {
  very_high: "\u5f88\u9ad8",
  high: "\u8f83\u9ad8",
  medium: "\u4e2d\u7b49",
  low: "\u504f\u4f4e",
};

const emptyReportMetrics = (): WeatherReportMetrics => ({
  forecastDayLabel: null,
  maxTemperatureC: null,
  uvIndex: null,
  overnightWindKphMin: null,
  overnightWindKphMax: null,
  daytimeWindKphMin: null,
  daytimeWindKphMax: null,
  overnightWindDirection: null,
  daytimeWindDirection: null,
  confidence: null,
  predictability: null,
  predictabilityScore: null,
});

const parseNumber = (value: string): number | null => {
  const match = normalizeText(value).match(/-?\d+(?:\.\d+)?/);
  return match ? Number.parseFloat(match[0]) : null;
};

const roundCanonicalTemperatureC = (value: number): number => Number.parseFloat(value.toFixed(1));

const normalizeTemperatureToC = (value: number | null, unit: ParsedTemperatureUnit): number | null => {
  if (value === null) {
    return null;
  }

  return unit === "F" ? roundCanonicalTemperatureC(((value - 32) * 5) / 9) : value;
};

const parseTemperature = (value: string, unit: ParsedTemperatureUnit): number | null =>
  normalizeTemperatureToC(parseNumber(value), unit);

const formatCanonicalTemperatureC = (value: number): string => {
  const rounded = roundCanonicalTemperatureC(value);
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
};

const parseTemperatureUnitToken = (raw: string | null | undefined): ParsedTemperatureUnit | null => {
  const normalized = normalizeText(raw ?? "").toUpperCase();
  if (normalized === "C" || normalized === "°C" || normalized === "CELSIUS") {
    return "C";
  }
  if (normalized === "F" || normalized === "°F" || normalized === "FAHRENHEIT") {
    return "F";
  }

  return null;
};

const resolvePageTemperatureUnit = ($: CheerioRoot, fallbackUnit: ParsedTemperatureUnit): ParsedTemperatureUnit => {
  const selectedUnitCandidates = [
    $("li.selected a.unit[data-type='temp'][data-unit]").first().attr("data-unit"),
    $("a.unit.selected[data-type='temp'][data-unit]").first().attr("data-unit"),
    $("[aria-current='true'][data-type='temp'][data-unit]").first().attr("data-unit"),
    $("[aria-selected='true'][data-type='temp'][data-unit]").first().attr("data-unit"),
  ];

  for (const candidate of selectedUnitCandidates) {
    const parsed = parseTemperatureUnitToken(candidate);
    if (parsed) {
      return parsed;
    }
  }

  const signals = [
    normalizeText($("section.weather-report-text").text()),
    normalizeText($("table.hourly-view, table.one-hourly-view, table.three-hourly-view").text()),
  ]
    .filter(Boolean)
    .join(" ");

  const hasFahrenheitSignal = /(?:°|\bdegrees?\b)\s*F\b|fahrenheit/i.test(signals);
  const hasCelsiusSignal = /(?:°|\bdegrees?\b)\s*C\b|celsius/i.test(signals);

  if (hasFahrenheitSignal && !hasCelsiusSignal) {
    return "F";
  }

  if (hasCelsiusSignal && !hasFahrenheitSignal) {
    return "C";
  }

  return fallbackUnit;
};

const parsePercent = (value: string): number | null => {
  const match = normalizeText(value).match(/(\d+(?:\.\d+)?)\s*%/);
  return match ? Number.parseFloat(match[1]) : null;
};

const parseRange = (value: string): { min: number; max: number } | null => {
  const match = normalizeText(value).match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);
  if (!match) {
    return null;
  }

  return { min: Number.parseFloat(match[1]), max: Number.parseFloat(match[2]) };
};

const parsePrecipitation = (value: string): number | null => {
  const cleaned = normalizeText(value);
  if (cleaned === "" || cleaned === "-") {
    return 0;
  }

  return parseNumber(cleaned);
};

const translateDirection = (value: string | null): string | null => (value ? windDirectionMap[value] ?? value : null);
const translateWeekday = (value: string | null): string | null => (value ? weekdayMap[value] ?? value : null);

const normalizeTranslatedSentence = (value: string): string => {
  const normalized = normalizeText(value)
    .replace(/\s+([\u3002\uff0c\uff1b\uff01\uff1f])/g, "$1")
    .replace(/([\u3002\uff0c\uff1b\uff01\uff1f])\s+/g, "$1")
    .trim();
  if (!normalized) {
    return "";
  }

  return /[\u3002\uff01\uff1f]$/.test(normalized) ? normalized : `${normalized}\u3002`;
};

const hourlySummaryMap: Array<{ pattern: RegExp; zh: string }> = [
  { pattern: /^clear$/i, zh: "\u6674\u6717" },
  { pattern: /^sunny$/i, zh: "\u6674\u5929" },
  { pattern: /^mostly sunny$/i, zh: "\u5927\u90e8\u6674\u6717" },
  { pattern: /^partly cloudy$/i, zh: "\u5c40\u90e8\u591a\u4e91" },
  { pattern: /^mostly cloudy$/i, zh: "\u5927\u90e8\u591a\u4e91" },
  { pattern: /^cloudy$/i, zh: "\u9634\u5929" },
  { pattern: /^overcast$/i, zh: "\u9634\u6c89" },
  { pattern: /^fog$/i, zh: "\u6709\u96fe" },
  { pattern: /^mist$/i, zh: "\u8584\u96fe" },
  { pattern: /^light rain$/i, zh: "\u5c0f\u96e8" },
  { pattern: /^rain$/i, zh: "\u964d\u96e8" },
  { pattern: /^heavy rain$/i, zh: "\u5927\u96e8" },
  { pattern: /^showers$/i, zh: "\u9635\u96e8" },
  { pattern: /^light showers$/i, zh: "\u96f6\u661f\u9635\u96e8" },
  { pattern: /^heavy showers$/i, zh: "\u5f3a\u9635\u96e8" },
  { pattern: /^thunderstorms?$/i, zh: "\u96f7\u66b4" },
  { pattern: /^light snow$/i, zh: "\u5c0f\u96ea" },
  { pattern: /^snow$/i, zh: "\u964d\u96ea" },
  { pattern: /^heavy snow$/i, zh: "\u5927\u96ea" },
  { pattern: /^sleet$/i, zh: "\u96e8\u5939\u96ea" },
  { pattern: /^windy$/i, zh: "\u98ce\u529b\u8f83\u5927" },
];

export const translateHourlySummary = (value: string | null): string | null => {
  const normalized = normalizeText(value ?? "");
  if (!normalized) {
    return null;
  }

  for (const item of hourlySummaryMap) {
    if (item.pattern.test(normalized)) {
      return normalizeTranslatedSentence(item.zh);
    }
  }

  if (!containsLatinLetters(normalized)) {
    return normalizeTranslatedSentence(normalized);
  }

  return null;
};

export const sanitizeHourlySummaryZh = (summaryZh: string | null, summaryEn: string | null): string | null => {
  const normalizedZh = normalizeText(summaryZh ?? "");
  if (normalizedZh && containsChinese(normalizedZh) && !containsLatinLetters(normalizedZh)) {
    return normalizeTranslatedSentence(normalizedZh);
  }

  return translateHourlySummary(summaryEn);
};

const windDirectionTokens = [
  "Northwest",
  "Northeast",
  "Southwest",
  "Southeast",
  "North",
  "South",
  "East",
  "West",
  "NNW",
  "NNE",
  "ENE",
  "ESE",
  "SSE",
  "SSW",
  "WSW",
  "WNW",
  "NE",
  "SE",
  "SW",
  "NW",
  "N",
  "E",
  "S",
  "W",
] as const;

const windDirectionCanonicalMap: Partial<Record<(typeof windDirectionTokens)[number], string>> = {
  North: "N",
  Northeast: "NE",
  East: "E",
  Southeast: "SE",
  South: "S",
  Southwest: "SW",
  West: "W",
  Northwest: "NW",
};

const parseWindDirectionToken = (value: string): string | null => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  for (const token of windDirectionTokens) {
    const matcher = new RegExp(`\\b${escapeRegExp(token)}\\b`, "i");
    if (matcher.test(normalized)) {
      return windDirectionCanonicalMap[token] ?? token;
    }
  }

  return null;
};

const buildBaseItems = (
  $: ReturnType<typeof load>,
  table: ReturnType<ReturnType<typeof load>>,
  iconClass: string,
  timezone: string,
): HourlyWeatherItem[] =>
  table
    .find("tr.times time")
    .toArray()
    .map((timeElement, index) => {
      const icon = table.find(`tr.icons img.${iconClass}`).toArray()[index];
      return {
        timestamp: normalizeTimestampByTimezone($(timeElement).attr("datetime") ?? "", timezone),
        endAt: null,
        summary: icon ? normalizeText($(icon).attr("alt") ?? "") || null : null,
        summaryZh: icon ? translateHourlySummary(normalizeText($(icon).attr("alt") ?? "")) : null,
        iconUrl: icon ? normalizeText($(icon).attr("src") ?? "") || null : null,
        temperatureC: null,
        feelsLikeC: null,
        windDirection: null,
        windSpeedKphMin: null,
        windSpeedKphMax: null,
        precipitationMm: null,
        precipitationProbabilityPct: null,
      } satisfies HourlyWeatherItem;
    })
    .filter((item) => item.timestamp !== "");

const assignNumericCells = (
  $: ReturnType<typeof load>,
  row: ReturnType<ReturnType<typeof load>>,
  items: HourlyWeatherItem[],
  parser: (value: string) => number | null,
  assign: (item: HourlyWeatherItem, value: number | null) => void,
): void => {
  row.find("td").each((index, cell) => {
    const item = items[index];
    if (!item) {
      return;
    }

    assign(item, parser($(cell).text()));
  });
};

const findFirstRow = (table: CheerioSelection, selectors: string[]): CheerioSelection => {
  for (const selector of selectors) {
    const row = table.find(selector).first();
    if (row.length > 0) {
      return row;
    }
  }

  return table.find("__missing__").first();
};

const collectCellSignals = ($: CheerioRoot, cell: CheerioSelection): string[] => {
  const values = new Set<string>();

  const push = (raw: string | null | undefined) => {
    const normalized = normalizeText(raw ?? "");
    if (normalized) {
      values.add(normalized);
    }
  };

  push(cell.text());
  push(cell.find("script").text());

  cell
    .find("*")
    .addBack()
    .each((_index, element) => {
      if (!("attribs" in element) || typeof element.attribs !== "object" || element.attribs === null) {
        return;
      }

      const attributes = element.attribs as Record<string, unknown>;
      for (const [name, value] of Object.entries(attributes)) {
        if (name === "title" || name === "aria-label" || name === "alt" || name.startsWith("data-")) {
          push(typeof value === "string" ? value : null);
        }
      }
    });

  return [...values];
};

const hasMeaningfulSignal = (signals: string[]): boolean =>
  signals.some((value) => value !== "-" && value !== "--" && value !== "—");

const parseNumberFromSignals = (signals: string[]): number | null => {
  for (const signal of signals) {
    const parsed = parseNumber(signal);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
};

const parseRangeFromSignals = (signals: string[]): { min: number; max: number } | null => {
  for (const signal of signals) {
    const parsed = parseRange(signal);
    if (parsed) {
      return parsed;
    }
  }

  return null;
};

const extractWindDirectionFromCell = ($: CheerioRoot, cell: CheerioSelection): string | null => {
  const candidates = [
    ...collectCellSignals($, cell),
    normalizeText(cell.find(".winddir").first().text()),
    normalizeText(cell.find(".winddir").first().attr("title") ?? ""),
    normalizeText(cell.find(".winddir").first().attr("aria-label") ?? ""),
    normalizeText(cell.attr("data-winddir") ?? ""),
    normalizeText(cell.find("[data-winddir]").first().attr("data-winddir") ?? ""),
    normalizeText(cell.find("[data-direction]").first().attr("data-direction") ?? ""),
  ];

  for (const candidate of Array.from(new Set(candidates.filter(Boolean)))) {
    const parsed = parseWindDirectionToken(candidate);
    if (parsed) {
      return parsed;
    }
  }

  return null;
};

const extractWindRangeFromCell = ($: CheerioRoot, cell: CheerioSelection) =>
  parseRangeFromSignals([
    ...collectCellSignals($, cell),
    normalizeText(cell.find(".cell").first().attr("title") ?? ""),
  ]);

const extractPrecipitationProbabilityFromCell = ($: CheerioRoot, cell: CheerioSelection): number | null => {
  const candidates = [
    normalizeText(cell.find(".precip-prob").first().text()),
    normalizeText(cell.find(".precip-prob").first().attr("title") ?? ""),
    normalizeText(cell.find(".precip-prob").first().attr("aria-label") ?? ""),
    normalizeText(cell.attr("data-precip-prob") ?? ""),
    normalizeText(cell.attr("data-precipprob") ?? ""),
    normalizeText(cell.attr("data-tooltip") ?? ""),
    normalizeText(cell.attr("data-original-title") ?? ""),
    normalizeText(cell.find("[data-precip-prob]").first().attr("data-precip-prob") ?? ""),
    normalizeText(cell.find("[data-precipprob]").first().attr("data-precipprob") ?? ""),
    ...collectCellSignals($, cell),
  ];

  for (const candidate of Array.from(new Set(candidates.filter(Boolean)))) {
    const parsed = parsePercent(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
};

const extractPrecipitationAmountFromCell = (
  $: CheerioRoot,
  cell: CheerioSelection,
  probabilityPct: number | null,
): number | null => {
  const explicitCandidates = [
    normalizeText(cell.find(".precip").first().text()),
    normalizeText(cell.find("[data-precip]").first().attr("data-precip") ?? ""),
    normalizeText(cell.find("[data-precip-amount]").first().attr("data-precip-amount") ?? ""),
    normalizeText(cell.attr("data-precip") ?? ""),
    normalizeText(cell.attr("data-precip-amount") ?? ""),
    normalizeText(cell.find("span").first().text()),
  ].filter(Boolean);

  for (const candidate of explicitCandidates) {
    const parsed = parsePrecipitation(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }

  const signals = collectCellSignals($, cell);
  if (signals.length === 0) {
    return null;
  }

  for (const signal of signals) {
    const withoutProbability =
      probabilityPct !== null
        ? normalizeText(signal.replace(new RegExp(`${probabilityPct}\\s*%`, "g"), ""))
        : normalizeText(signal.replace(/\d+(?:\.\d+)?\s*%/g, ""));
    const parsed = parsePrecipitation(withoutProbability);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
};

const finalizeEndTimestamps = (items: HourlyWeatherItem[]): HourlyWeatherItem[] =>
  items.map((item, index) => ({ ...item, endAt: items[index + 1]?.timestamp ?? item.endAt }));

const appendFieldMissingWarning = (
  warnings: string[],
  items: HourlyWeatherItem[],
  field: "feelsLikeC" | "precipitationProbabilityPct" | "windDirection",
  label: string,
): void => {
  if (items.length === 0) {
    return;
  }

  const missing = items.reduce((count, item) => (item[field] === null ? count + 1 : count), 0);
  if (missing > 0) {
    warnings.push(`1h ${label} missing for ${missing}/${items.length} hours from source table.`);
  }
};

const parseOneHourMode = (
  $: CheerioRoot,
  warnings: string[],
  timezone: string,
  pageTemperatureUnit: ParsedTemperatureUnit,
): ParsedOneHourModeResult => {
  const diagnostics = createEmptyOneHourFieldDiagnostics();
  const table = $("table.hourly-view, table.one-hourly-view").first();
  if (table.length === 0) {
    warnings.push("1h table not found.");
    return {
      items: [],
      diagnostics,
    };
  }

  const items = buildBaseItems($, table, "picon1h", timezone);
  if (items.length === 0) {
    warnings.push("1h table exists but contains no time columns.");
    return {
      items: [],
      diagnostics,
    };
  }

  assignNumericCells(
    $,
    findFirstRow(table, ["tr.temperatures", "tr.temperature", "tr.air-temperature"]),
    items,
    (value) => parseTemperature(value, pageTemperatureUnit),
    (item, value) => {
      item.temperatureC = value;
    },
  );

  const feelsLikeRow = findFirstRow(table, [
    "tr.windchills",
    "tr.feelslike",
    "tr.feels-like",
    "tr.feels_like",
    "tr.apparent-temperatures",
    "tr.apparent-temperature",
    "tr.apparenttemperature",
  ]);
  diagnostics.feelsLikeC.rowFound = feelsLikeRow.length > 0;

  if (feelsLikeRow.length > 0) {
    feelsLikeRow.find("td").each((index, cell) => {
      const item = items[index];
      if (!item) {
        return;
      }

      const wrapped = $(cell);
      const signals = collectCellSignals($, wrapped);
      const value = normalizeTemperatureToC(parseNumberFromSignals(signals), pageTemperatureUnit);
      if (value !== null) {
        item.feelsLikeC = value;
        return;
      }

      setMissingReason(
        diagnostics,
        "feelsLikeC",
        item.timestamp,
        hasMeaningfulSignal(signals) ? "parser-unrecognized" : "source-unpublished",
      );
    });
  } else {
    items.forEach((item) => setMissingReason(diagnostics, "feelsLikeC", item.timestamp, "parser-unrecognized"));
  }

  const directionSignals = new Map<string, string[]>();
  const rememberSignals = (timestamp: string, signals: string[]) => {
    const previous = directionSignals.get(timestamp) ?? [];
    directionSignals.set(timestamp, [...previous, ...signals]);
  };

  const directionRow = findFirstRow(table, [
    "tr.winddirs",
    "tr.winddir",
    "tr.winddirection",
    "tr.wind-directions",
    "tr.wind-direction",
  ]);
  const windSpeedRow = findFirstRow(table, ["tr.windspeeds", "tr.winds", "tr.wind-speed", "tr.wind-speeds"]);
  diagnostics.windDirection.rowFound = directionRow.length > 0 || windSpeedRow.length > 0;

  directionRow.find("td").each((index, cell) => {
    const item = items[index];
    if (!item) {
      return;
    }

    const wrapped = $(cell);
    const signals = collectCellSignals($, wrapped);
    rememberSignals(item.timestamp, signals);
    item.windDirection = extractWindDirectionFromCell($, wrapped) ?? item.windDirection;
  });

  windSpeedRow.find("td").each((index, cell) => {
    const item = items[index];
    if (!item) {
      return;
    }

    const wrapped = $(cell);
    const signals = collectCellSignals($, wrapped);
    rememberSignals(item.timestamp, signals);
    item.windDirection = item.windDirection ?? extractWindDirectionFromCell($, wrapped);
    const range = extractWindRangeFromCell($, wrapped);
    item.windSpeedKphMin = range?.min ?? item.windSpeedKphMin;
    item.windSpeedKphMax = range?.max ?? item.windSpeedKphMax;
  });

  if (!diagnostics.windDirection.rowFound) {
    items.forEach((item) => setMissingReason(diagnostics, "windDirection", item.timestamp, "parser-unrecognized"));
  }

  const probabilitySignals = new Map<string, string[]>();
  const rememberProbabilitySignals = (timestamp: string, signals: string[]) => {
    const previous = probabilitySignals.get(timestamp) ?? [];
    probabilitySignals.set(timestamp, [...previous, ...signals]);
  };

  const amountRow = findFirstRow(table, [
    "tr.precips",
    "tr.precipitations",
    "tr.precip-amount",
    "tr.precipitation",
    "tr.rain",
  ]);
  const probabilityRow = findFirstRow(table, [
    "tr.precipprobs",
    "tr.precip-probs",
    "tr.precipprobability",
    "tr.precip-probability",
    "tr.precip_probability",
    "tr.precipprob",
    "tr.pop",
  ]);
  diagnostics.precipitationProbabilityPct.rowFound = amountRow.length > 0 || probabilityRow.length > 0;

  probabilityRow.find("td").each((index, cell) => {
    const item = items[index];
    if (!item) {
      return;
    }

    const wrapped = $(cell);
    const signals = collectCellSignals($, wrapped);
    rememberProbabilitySignals(item.timestamp, signals);
    item.precipitationProbabilityPct = extractPrecipitationProbabilityFromCell($, wrapped);
  });

  amountRow.find("td").each((index, cell) => {
    const item = items[index];
    if (!item) {
      return;
    }

    const wrapped = $(cell);
    const signals = collectCellSignals($, wrapped);
    rememberProbabilitySignals(item.timestamp, signals);
    item.precipitationProbabilityPct =
      item.precipitationProbabilityPct ?? extractPrecipitationProbabilityFromCell($, wrapped);
    item.precipitationMm = extractPrecipitationAmountFromCell($, wrapped, item.precipitationProbabilityPct);
  });

  if (!diagnostics.precipitationProbabilityPct.rowFound) {
    items.forEach((item) =>
      setMissingReason(diagnostics, "precipitationProbabilityPct", item.timestamp, "parser-unrecognized"),
    );
  }

  for (const item of items) {
    if (item.feelsLikeC === null && !diagnostics.feelsLikeC.missingByTimestamp[item.timestamp]) {
      setMissingReason(diagnostics, "feelsLikeC", item.timestamp, "source-unpublished");
    }

    if (item.windDirection === null && !diagnostics.windDirection.missingByTimestamp[item.timestamp]) {
      const signals = directionSignals.get(item.timestamp) ?? [];
      setMissingReason(
        diagnostics,
        "windDirection",
        item.timestamp,
        hasMeaningfulSignal(signals) ? "parser-unrecognized" : "source-unpublished",
      );
    }

    if (
      item.precipitationProbabilityPct === null &&
      !diagnostics.precipitationProbabilityPct.missingByTimestamp[item.timestamp]
    ) {
      const signals = probabilitySignals.get(item.timestamp) ?? [];
      setMissingReason(
        diagnostics,
        "precipitationProbabilityPct",
        item.timestamp,
        hasMeaningfulSignal(signals) ? "parser-unrecognized" : "source-unpublished",
      );
    }
  }

  const finalized = finalizeEndTimestamps(items);
  appendFieldMissingWarning(warnings, finalized, "feelsLikeC", "feelsLikeC");
  appendFieldMissingWarning(warnings, finalized, "precipitationProbabilityPct", "precipitationProbabilityPct");
  appendFieldMissingWarning(warnings, finalized, "windDirection", "windDirection");
  return {
    items: finalized,
    diagnostics,
  };
};

const parseThreeHourMode = (
  $: ReturnType<typeof load>,
  warnings: string[],
  timezone: string,
  pageTemperatureUnit: ParsedTemperatureUnit,
): HourlyWeatherItem[] => {
  const table = $("div.three-hourly-table table.three-hourly-view, table.three-hourly-view").first();
  if (table.length === 0) {
    warnings.push("3h table not found.");
    return [];
  }

  const items = buildBaseItems($, table, "picon3h", timezone);
  if (items.length === 0) {
    warnings.push("3h table exists but contains no time columns.");
    return [];
  }

  assignNumericCells(
    $,
    table.find("tr.temperatures, tr.temperature").first(),
    items,
    (value) => parseTemperature(value, pageTemperatureUnit),
    (item, value) => {
    item.temperatureC = value;
    },
  );

  assignNumericCells(
    $,
    table.find("tr.windchills, tr.feelslike, tr.feels-like, tr.apparent-temperatures").first(),
    items,
    (value) => parseTemperature(value, pageTemperatureUnit),
    (item, value) => {
      item.feelsLikeC = value;
    },
  );

  table.find("tr.winddirs td, tr.winddir td, tr.wind-directions td").each((index, cell) => {
    const item = items[index];
    if (!item) {
      return;
    }

    item.windDirection = extractWindDirectionFromCell($, $(cell));
  });

  table.find("tr.windspeeds td, tr.winds td").each((index, cell) => {
    const item = items[index];
    if (!item) {
      return;
    }

    const range = extractWindRangeFromCell($, $(cell));
    item.windSpeedKphMin = range?.min ?? null;
    item.windSpeedKphMax = range?.max ?? null;
  });

  assignNumericCells($, table.find("tr.precips, tr.precipitations").first(), items, parsePrecipitation, (item, value) => {
    item.precipitationMm = value;
  });

  assignNumericCells($, table.find("tr.precipprobs, tr.precip-probs, tr.pop").first(), items, parsePercent, (item, value) => {
    item.precipitationProbabilityPct = value;
  });

  return finalizeEndTimestamps(items);
};

export const mergeHourlyItems = (preferredItems: HourlyWeatherItem[], fallbackItems: HourlyWeatherItem[]): HourlyWeatherItem[] => {
  if (fallbackItems.length === 0) {
    return preferredItems;
  }

  if (preferredItems.length === 0) {
    return fallbackItems;
  }

  const preferredByTimestamp = new Map(preferredItems.map((item) => [item.timestamp, item]));
  const merged = fallbackItems.map((fallback) => {
    const preferred = preferredByTimestamp.get(fallback.timestamp);
    if (!preferred) {
      return fallback;
    }

    return {
      ...fallback,
      ...preferred,
      summary: preferred.summary ?? fallback.summary,
      summaryZh: preferred.summaryZh ?? fallback.summaryZh,
      iconUrl: preferred.iconUrl ?? fallback.iconUrl,
      temperatureC: preferred.temperatureC ?? fallback.temperatureC,
      feelsLikeC: preferred.feelsLikeC ?? fallback.feelsLikeC,
      windDirection: preferred.windDirection ?? fallback.windDirection,
      windSpeedKphMin: preferred.windSpeedKphMin ?? fallback.windSpeedKphMin,
      windSpeedKphMax: preferred.windSpeedKphMax ?? fallback.windSpeedKphMax,
      precipitationMm: preferred.precipitationMm ?? fallback.precipitationMm,
      precipitationProbabilityPct: preferred.precipitationProbabilityPct ?? fallback.precipitationProbabilityPct,
      endAt: preferred.endAt ?? fallback.endAt,
    };
  });

  const mergedTimestamps = new Set(merged.map((item) => item.timestamp));
  const appendOnlyPreferred = preferredItems.filter((item) => !mergedTimestamps.has(item.timestamp));
  return [...merged, ...appendOnlyPreferred];
};

const parsePredictabilityFromText = (text: string): PredictabilityResult => {
  const normalized = normalizeText(text).toLowerCase();
  if (!normalized.includes("predictability")) {
    return { level: null, score: null };
  }

  if (normalized.includes("very high")) {
    return { level: "very_high", score: 4 };
  }
  if (normalized.includes("high")) {
    return { level: "high", score: 3 };
  }
  if (normalized.includes("medium") || normalized.includes("moderate")) {
    return { level: "medium", score: 2 };
  }
  if (normalized.includes("low")) {
    return { level: "low", score: 1 };
  }

  return { level: null, score: null };
};

const extractPredictabilityHint = ($: ReturnType<typeof load>): PredictabilityResult => {
  const fromTabTitle = parsePredictabilityFromText(normalizeText($(".tab.active .tab-predictability").first().attr("title") ?? ""));
  if (fromTabTitle.level) {
    return fromTabTitle;
  }

  const fromMessage = parsePredictabilityFromText(normalizeText($(".predictability-message").first().text()));
  if (fromMessage.level) {
    return fromMessage;
  }

  return { level: null, score: null };
};

const parseWeatherReportMetrics = (
  bodyText: string,
  predictabilityHint: PredictabilityResult,
  pageTemperatureUnit: ParsedTemperatureUnit,
): WeatherReportMetrics => {
  const maxTemperatureC = parseTemperature(
    bodyText.match(/Temperatures peaking at ([^.]*)\./i)?.[1] ??
      bodyText.match(/Temperatures as high as ([^.]*) are foreseen\./i)?.[1] ??
      bodyText.match(/Temperature highs are likely to reach ([^.]*)\./i)?.[1] ??
      "",
    pageTemperatureUnit,
  );

  const uvIndex = parseNumber(
    bodyText.match(/UV-Index as high as ([^ ]+)/i)?.[1] ??
      bodyText.match(/UV-Index rising to ([^, .]+)/i)?.[1] ??
      bodyText.match(/UV-Index climbs up to ([^, .]+)/i)?.[1] ??
      "",
  );

  const overnightWindMatch =
    bodyText.match(/Overnight(?: into ([A-Za-z]+))?(?: blows| expect)? [^(]*\((\d+) to (\d+) km\/h\)/i) ??
    bodyText.match(/Night and day expect [^(]*\((\d+) to (\d+) km\/h\)/i);

  const daytimeWindMatch =
    bodyText.match(/(?:By day|At daytime|During the day|In the course of day|In the course of the day) [^(]*\((\d+) to (\d+) km\/h\)/i) ??
    bodyText.match(/Night and day expect [^(]*\((\d+) to (\d+) km\/h\)/i);

  const directionMatch =
    bodyText.match(/Winds blowing overnight from ([A-Za-z]+) and by day from ([A-Za-z]+)/i) ??
    bodyText.match(/Winds blowing at night and in the morning from ([A-Za-z]+) and during the afternoon from ([A-Za-z]+)/i) ??
    bodyText.match(/Winds blowing overnight from ([A-Za-z]+), in the morning from ([A-Za-z]+) and during the afternoon from ([A-Za-z]+)/i);

  const confidenceSentence =
    bodyText.match(/for ([A-Za-z]+) is expected to be very accurate/i) ??
    bodyText.match(/for ([A-Za-z]+) is likely to be accurate/i) ??
    bodyText.match(/for ([A-Za-z]+) can be accurate in parts but deviations are expected/i) ??
    bodyText.match(/for ([A-Za-z]+) is likely to be uncertain/i);

  const confidenceFromSentence = confidenceSentence
    ? /very accurate|likely to be accurate/i.test(confidenceSentence[0])
      ? "high"
      : /accurate in parts|deviations are expected/i.test(confidenceSentence[0])
        ? "medium"
        : "low"
    : null;

  const confidenceFromPredictability =
    predictabilityHint.level === "very_high" || predictabilityHint.level === "high"
      ? "high"
      : predictabilityHint.level === "medium"
        ? "medium"
        : predictabilityHint.level === "low"
          ? "low"
          : null;

  const overnightMin = overnightWindMatch && overnightWindMatch.length >= 4 ? Number.parseFloat(overnightWindMatch[2]) : null;
  const overnightMax = overnightWindMatch && overnightWindMatch.length >= 4 ? Number.parseFloat(overnightWindMatch[3]) : null;
  const daytimeMin = daytimeWindMatch ? Number.parseFloat(daytimeWindMatch[1]) : null;
  const daytimeMax = daytimeWindMatch ? Number.parseFloat(daytimeWindMatch[2]) : null;

  return {
    forecastDayLabel: confidenceSentence?.[1] ?? overnightWindMatch?.[1] ?? null,
    maxTemperatureC,
    uvIndex,
    overnightWindKphMin: overnightMin,
    overnightWindKphMax: overnightMax,
    daytimeWindKphMin: daytimeMin,
    daytimeWindKphMax: daytimeMax,
    overnightWindDirection: directionMatch?.[1] ?? null,
    daytimeWindDirection: directionMatch?.[2] ?? null,
    confidence: confidenceFromSentence ?? confidenceFromPredictability,
    predictability: predictabilityHint.level,
    predictabilityScore: predictabilityHint.score,
  };
};

const buildNarrativeFallback = (metrics: WeatherReportMetrics): string => {
  const details: string[] = [];
  if (metrics.maxTemperatureC !== null) {
    details.push(`\u6700\u9ad8\u6c14\u6e29\u7ea6 ${formatCanonicalTemperatureC(metrics.maxTemperatureC)}\u00b0C`);
  }
  if (metrics.daytimeWindKphMin !== null && metrics.daytimeWindKphMax !== null) {
    details.push(`\u767d\u5929\u98ce\u901f\u7ea6 ${metrics.daytimeWindKphMin}\u2013${metrics.daytimeWindKphMax} km/h`);
  }

  if (details.length === 0) {
    return "\u5929\u6c14\u6458\u8981\u6682\u65f6\u4e0d\u53ef\u7528\uff0c\u8bf7\u7a0d\u540e\u5237\u65b0\u3002";
  }

  return normalizeTranslatedSentence(`\u5929\u6c14\u6982\u89c8\uff1a${details.join("\uff1b")}`);
};

const splitIntoSentences = (value: string): string[] =>
  (normalizeText(value).match(/[^.!?]+[.!?]?/g) ?? []).map((sentence) => normalizeText(sentence)).filter(Boolean);

const renderTemperatureNarrative = (
  prefix: string,
  rawTemperature: string,
  pageTemperatureUnit: ParsedTemperatureUnit,
): string => {
  const normalizedTemperatureC = parseTemperature(rawTemperature, pageTemperatureUnit);
  if (normalizedTemperatureC === null) {
    return `${prefix} ${normalizeText(rawTemperature)}。`;
  }

  return `${prefix} ${formatCanonicalTemperatureC(normalizedTemperatureC)}°C。`;
};

const sentenceTranslators: Array<{
  pattern: RegExp;
  render: (match: RegExpMatchArray, pageTemperatureUnit: ParsedTemperatureUnit) => string;
}> = [
  {
    pattern: /^During the night and in the morning a few clouds are expected, and some more clouds roll across (?:after noon|in the afternoon)\.?$/i,
    render: () => "\u591c\u95f4\u5230\u4e0a\u5348\u4e91\u91cf\u8f83\u5c11\uff0c\u4e0b\u5348\u4e91\u91cf\u5c06\u9010\u6e10\u589e\u591a\u3002",
  },
  {
    pattern: /^The sun will not be visible\.?$/i,
    render: () => "\u5168\u5929\u65e5\u7167\u8f83\u5f31\u3002",
  },
  {
    pattern: /^Temperatures peaking at ([^.]*)\.?$/i,
    render: (match, pageTemperatureUnit) => renderTemperatureNarrative("\u6700\u9ad8\u6c14\u6e29\u7ea6", match[1], pageTemperatureUnit),
  },
  {
    pattern: /^Temperatures as high as ([^.]*) are foreseen\.?$/i,
    render: (match, pageTemperatureUnit) => renderTemperatureNarrative("\u6700\u9ad8\u6c14\u6e29\u53ef\u8fbe", match[1], pageTemperatureUnit),
  },
  {
    pattern: /^With a UV-Index as high as ([^ ]+) make sure to properly protect your skin\.?$/i,
    render: () => "",
  },
  {
    pattern: /^The UV-Index climbs up to ([^, .]+),.*$/i,
    render: () => "",
  },
  {
    pattern: /^Overnight into ([A-Za-z]+) [^(]*\((\d+) to (\d+) km\/h\)\.?$/i,
    render: (match) => `${translateWeekday(match[1]) ?? match[1]}\u51cc\u6668\u524d\u540e\u6709\u8f7b\u98ce\uff0c\u98ce\u901f\u7ea6 ${match[2]}\u2013${match[3]} km/h\u3002`,
  },
  {
    pattern: /^(?:By day|At daytime|During the day|In the course of day|In the course of the day) [^(]*\((\d+) to (\d+) km\/h\)\.?$/i,
    render: (match) => `\u767d\u5929\u98ce\u901f\u7ea6 ${match[1]}\u2013${match[2]} km/h\u3002`,
  },
  {
    pattern: /^Winds blowing overnight from ([A-Za-z]+) and by day from ([A-Za-z]+)\.?$/i,
    render: (match) => `\u591c\u95f4\u4ee5${translateDirection(match[1]) ?? match[1]}\u4e3a\u4e3b\uff0c\u767d\u5929\u8f6c\u4e3a${translateDirection(match[2]) ?? match[2]}\u3002`,
  },
  {
    pattern: /^The weather forecast for .+ for ([A-Za-z]+) is likely to be accurate\.?$/i,
    render: () => "",
  },
  {
    pattern: /^The weather forecast for .+ for ([A-Za-z]+) is expected to be very accurate\.?$/i,
    render: () => "",
  },
  {
    pattern: /^The weather forecast for .+ for ([A-Za-z]+) can be accurate in parts but deviations are expected\.?$/i,
    render: () => "",
  },
  {
    pattern: /^The weather forecast for .+ for ([A-Za-z]+) is likely to be uncertain\.?$/i,
    render: () => "",
  },
];

const translateSentence = (sentence: string, pageTemperatureUnit: ParsedTemperatureUnit): string | null => {
  for (const translator of sentenceTranslators) {
    const match = sentence.match(translator.pattern);
    if (match) {
      return normalizeTranslatedSentence(translator.render(match, pageTemperatureUnit));
    }
  }

  if (!containsLatinLetters(sentence)) {
    return normalizeTranslatedSentence(sentence);
  }

  return null;
};

const ensureChineseNarrative = (textZh: string | null, metrics: WeatherReportMetrics): string => {
  const normalized = normalizeText(textZh ?? "");
  if (!normalized || !containsChinese(normalized) || containsLatinLetters(normalized)) {
    return buildNarrativeFallback(metrics);
  }

  return normalized;
};

const translateNarrativeFromEnglish = (
  sourceTextEn: string,
  titleEn: string,
  metrics: WeatherReportMetrics,
  pageTemperatureUnit: ParsedTemperatureUnit,
): string => {
  const body = normalizeText(sourceTextEn.replace(titleEn, "").trim());
  if (!body) {
    return buildNarrativeFallback(metrics);
  }

  const translated: string[] = [];
  for (const sentence of splitIntoSentences(body)) {
    const zh = translateSentence(sentence, pageTemperatureUnit);
    if (!zh) {
      return buildNarrativeFallback(metrics);
    }
    if (normalizeText(zh)) {
      translated.push(zh);
    }
  }

  const deduped = Array.from(new Set(translated.map((sentence) => normalizeText(sentence))));
  if (deduped.length === 0) {
    return buildNarrativeFallback(metrics);
  }

  return ensureChineseNarrative(deduped.join(""), metrics);
};

export const sanitizeReportTextZh = ({
  textZh,
  sourceTextEn,
  titleEn,
  metrics,
  pageTemperatureUnit,
}: {
  textZh: string | null;
  sourceTextEn: string | null;
  titleEn: string | null;
  metrics: WeatherReportMetrics;
  pageTemperatureUnit: ParsedTemperatureUnit;
}): string => {
  const normalized = normalizeText(textZh ?? "");
  if (normalized !== "" && containsChinese(normalized) && !containsLatinLetters(normalized)) {
    return normalized;
  }

  if (sourceTextEn) {
    return translateNarrativeFromEnglish(sourceTextEn, titleEn ?? "", metrics, pageTemperatureUnit);
  }

  return buildNarrativeFallback(metrics);
};

const extractReportFromHeading = ($: ReturnType<typeof load>, locationName: string): { titleEn: string; sourceTextEn: string } | null => {
  const candidates = $("h3.report-heading, section.weather-report-text h3, h3")
    .toArray()
    .map((heading) => {
      const title = normalizeText($(heading).text());
      if (!/^Weather report for /i.test(title)) {
        return null;
      }

      const directParagraph = normalizeText($(heading).nextAll("p").first().text());
      const parentParagraph = normalizeText($(heading).parent().find("p").first().text());
      const body = directParagraph || parentParagraph;
      if (!body) {
        return null;
      }

      return {
        titleEn: title,
        sourceTextEn: normalizeText(`${title} ${body}`),
        locationMatched: title.toLowerCase().includes(locationName.toLowerCase()),
      };
    })
    .filter((item): item is { titleEn: string; sourceTextEn: string; locationMatched: boolean } => item !== null);

  if (candidates.length === 0) {
    return null;
  }

  const best = [...candidates].sort((left, right) => {
    if (left.locationMatched !== right.locationMatched) {
      return left.locationMatched ? -1 : 1;
    }

    return right.sourceTextEn.length - left.sourceTextEn.length;
  })[0];

  return best ? { titleEn: best.titleEn, sourceTextEn: best.sourceTextEn } : null;
};

const extractWeatherReport = (
  $: ReturnType<typeof load>,
  locationName: string,
  pageTemperatureUnit: ParsedTemperatureUnit,
): ParsedWeatherReport => {
  const fallbackTitleEn = `Weather report for ${locationName}`;
  const fullText = normalizeText($.root().text());
  const headingExtraction = extractReportFromHeading($, locationName);
  const titleEn = headingExtraction?.titleEn ?? fallbackTitleEn;
  let sourceTextEn = headingExtraction?.sourceTextEn ?? null;
  const warnings: string[] = [];

  if (!sourceTextEn && fullText.includes(titleEn)) {
    const startIndex = fullText.indexOf(titleEn);
    const tail = fullText.slice(startIndex);
    const sentences = tail.match(/[^.]+\./g) ?? [];
    sourceTextEn = normalizeText(sentences.slice(0, 10).join(" ")) || null;
  }

  if (!sourceTextEn) {
    warnings.push("Weather report text could not be extracted from the page heading block.");
    return {
      available: false,
      titleEn,
      sourceTextEn: null,
      textZh: "\u5929\u6c14\u62a5\u544a\u6587\u672c\u6682\u65f6\u4e0d\u53ef\u7528\uff0c\u8bf7\u7a0d\u540e\u5237\u65b0\u3002",
      metrics: emptyReportMetrics(),
      warnings,
    };
  }

  const bodyText = normalizeText(sourceTextEn.replace(titleEn, "").trim());
  const predictabilityHint = extractPredictabilityHint($);
  const metrics = parseWeatherReportMetrics(bodyText, predictabilityHint, pageTemperatureUnit);
  const textZh = sanitizeReportTextZh({
    textZh: null,
    sourceTextEn,
    titleEn,
    metrics,
    pageTemperatureUnit,
  });

  if (!headingExtraction) {
    warnings.push("Weather report heading block not found, used text fallback extraction.");
  }

  return {
    available: true,
    titleEn,
    sourceTextEn,
    textZh,
    metrics,
    warnings,
  };
};

export const parseWeekPage = (
  html: string,
  referenceDate: Date,
  timezone: string,
  locationName: string,
  fallbackDisplayUnit: ParsedTemperatureUnit = "C",
): ParsedWeekData => {
  const $ = load(html);
  const oneHourWarnings: string[] = [];
  const warnings: string[] = [];
  const pageTemperatureUnit = resolvePageTemperatureUnit($, fallbackDisplayUnit);

  const observedTimeText = normalizeText($("a.current-weather .current-description span").last().text()) || null;
  const sourceObservedAt = parseObservedTime(observedTimeText, referenceDate, timezone)?.toISOString() ?? null;
  const oneHourParsed = parseOneHourMode($, oneHourWarnings, timezone, pageTemperatureUnit);
  const threeHourItems = parseThreeHourMode($, warnings, timezone, pageTemperatureUnit);
  const report = extractWeatherReport($, locationName, pageTemperatureUnit);

  if (oneHourParsed.items.length === 0 && threeHourItems.length === 0) {
    throw new AppError(502, "WEEK_PARSE_FAILED", "Could not parse any hourly forecast data from the week page.", {
      retryable: true,
    });
  }

  return {
    sourceObservedAt,
    oneHourItems: oneHourParsed.items,
    oneHourWarnings,
    oneHourPartial: oneHourWarnings.length > 0,
    oneHourFieldDiagnostics: oneHourParsed.diagnostics,
    threeHourItems,
    warnings,
    partial: warnings.length > 0,
    report,
  };
};

