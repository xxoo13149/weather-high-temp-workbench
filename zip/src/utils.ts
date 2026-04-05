import { CONFIG } from "./config";

const WIND_DIRECTION_DEGREES: Record<string, number> = {
  N: 0,
  NNE: 22.5,
  NE: 45,
  ENE: 67.5,
  E: 90,
  ESE: 112.5,
  SE: 135,
  SSE: 157.5,
  S: 180,
  SSW: 202.5,
  SW: 225,
  WSW: 247.5,
  W: 270,
  WNW: 292.5,
  NW: 315,
  NNW: 337.5,
  NORTH: 0,
  NORTHEAST: 45,
  EAST: 90,
  SOUTHEAST: 135,
  SOUTH: 180,
  SOUTHWEST: 225,
  WEST: 270,
  NORTHWEST: 315,
};

const timeFormatterCache = new Map<string, Intl.DateTimeFormat>();
const dateTimeFormatterCache = new Map<string, Intl.DateTimeFormat>();
const monthDayFormatterCache = new Map<string, Intl.DateTimeFormat>();

const buildFormatterKey = (locale: string, timeZone: string | null) => `${locale}::${timeZone ?? "local"}`;

const getCachedFormatter = (
  cache: Map<string, Intl.DateTimeFormat>,
  key: string,
  build: () => Intl.DateTimeFormat,
) => {
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const formatter = build();
  cache.set(key, formatter);
  return formatter;
};

const withTimeZone = <T extends Intl.DateTimeFormatOptions>(options: T, timeZone?: string) =>
  timeZone ? { ...options, timeZone } : options;

const getTimeFormatter = (timeZone?: string) =>
  getCachedFormatter(timeFormatterCache, buildFormatterKey("zh-CN", timeZone ?? null), () =>
    new Intl.DateTimeFormat(
      "zh-CN",
      withTimeZone(
        {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        },
        timeZone,
      ),
    ),
  );

const getDateTimeFormatter = (timeZone?: string) =>
  getCachedFormatter(dateTimeFormatterCache, buildFormatterKey("zh-CN", timeZone ?? null), () =>
    new Intl.DateTimeFormat(
      "zh-CN",
      withTimeZone(
        {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        },
        timeZone,
      ),
    ),
  );

const getMonthDayFormatter = (timeZone?: string) =>
  getCachedFormatter(monthDayFormatterCache, buildFormatterKey("zh-CN", timeZone ?? null), () =>
    new Intl.DateTimeFormat(
      "zh-CN",
      withTimeZone(
        {
          month: "2-digit",
          day: "2-digit",
        },
        timeZone,
      ),
    ),
  );

const formatWithFormatter = (
  isoString: string | null | undefined,
  resolveFormatter: (timeZone?: string) => Intl.DateTimeFormat,
  timeZone?: string,
) => {
  if (!isoString) {
    return CONFIG.fallback.nullValue;
  }

  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return isoString;
  }

  try {
    return resolveFormatter(timeZone).format(date);
  } catch {
    return resolveFormatter(undefined).format(date);
  }
};

export const formatTime = (isoString: string | null | undefined, timeZone?: string) =>
  formatWithFormatter(isoString, getTimeFormatter, timeZone);

export const formatDateTime = (isoString: string | null | undefined, timeZone?: string) =>
  formatWithFormatter(isoString, getDateTimeFormatter, timeZone);

export const formatMonthDay = (isoString: string | null | undefined, timeZone?: string) =>
  formatWithFormatter(isoString, getMonthDayFormatter, timeZone);

export const formatNumber = (value: number | null | undefined, digits = 1) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return CONFIG.fallback.nullValue;
  }

  const rounded = Number.parseFloat(value.toFixed(digits));
  if (Math.abs(rounded - Math.round(rounded)) < 1e-9) {
    return String(Math.round(rounded));
  }

  return rounded.toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
};

export const valueOrDash = (value: number | null | undefined, suffix = "", digits = 1) =>
  value === null || value === undefined || Number.isNaN(value)
    ? CONFIG.fallback.nullValue
    : `${formatNumber(value, digits)}${suffix}`;

export const getWindDirectionDegrees = (direction: string | null | undefined) => {
  if (!direction) {
    return null;
  }

  const normalized = direction.trim().toUpperCase();
  return normalized in WIND_DIRECTION_DEGREES ? WIND_DIRECTION_DEGREES[normalized] : null;
};

export const getWindDirectionLabel = (direction: string | null | undefined) => {
  if (!direction) {
    return CONFIG.fallback.nullValue;
  }

  return direction.trim().toUpperCase();
};
