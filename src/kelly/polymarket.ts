import WebSocket, { type RawData } from "ws";

import { config, type RegisteredLocation } from "../config.js";
import type {
  KellyContractType,
  KellyInactiveReason,
  KellyMarketLifecycle,
  KellyMarketRow,
  KellySourceLinks,
  KellyStreamHandle,
  KellyStreamMessage,
  KellyTemperatureUnit,
} from "../domain/weather.js";
import { fetchJson, fetchText } from "../lib/http.js";

const POLYMARKET_EVENT_BASE_URL = "https://polymarket.com/event";
const POLYMARKET_DISCOVERY_TIMEOUT_MS = Math.min(config.httpTimeoutMs, 2_500);
const POLYMARKET_MAX_SEARCH_TERMS = 6;
const POLYMARKET_DISCOVERY_CONCURRENCY = 2;
const POLYMARKET_ORDERBOOK_CONCURRENCY = 4;
const POLYMARKET_MAX_EVENT_PAYLOAD_CHARS = 1_500_000;
const POLYMARKET_MAX_EVENT_VISIT_COUNT = 25_000;
const POLYMARKET_STREAM_HEARTBEAT_MS = 10_000;
const POLYMARKET_STREAM_RECONNECT_BASE_MS = 1_500;
const POLYMARKET_STREAM_RECONNECT_MAX_MS = 15_000;
type RawOrderLevel = {
  price?: string | number | null;
  size?: string | number | null;
};

export type NormalizedOrderBook = {
  tokenId: string;
  bestBid: number | null;
  bestAsk: number | null;
  midpoint: number | null;
  updatedAt: string;
  status: "available" | "no-orderbook";
};

export interface PolymarketCandidate extends Pick<
  KellyMarketRow,
  | "marketId"
  | "slug"
  | "title"
  | "marketUrl"
  | "conditionId"
  | "contractType"
  | "unit"
  | "bucketStartC"
  | "bucketEndC"
  | "bucketLabel"
  | "lifecycle"
  | "inactiveReason"
  | "parseStatus"
  | "exclusionReason"
  | "yesTokenId"
  | "noTokenId"
  | "updatedAt"
> {
  eventTitle: string | null;
  eventUrl: string | null;
  liquidity: number | null;
  volume24h: number | null;
  description?: string | null;
  resolutionSource?: string | null;
  active?: boolean | null;
  closed?: boolean | null;
  acceptingOrders?: boolean | null;
  archived?: boolean | null;
  enableOrderBook?: boolean | null;
  endsAt?: string | null;
}

export interface PolymarketDiscoveryResult {
  fetchedAt: string;
  candidates: PolymarketCandidate[];
  inactiveCandidates: PolymarketCandidate[];
  sourceLinks: KellySourceLinks;
}

const monthFormatterShort = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const monthFormatterLong = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const parseString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const parseNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const parseBoolean = (value: unknown): boolean | null => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }

  return null;
};

const parseStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((entry) => parseString(entry)).filter((entry): entry is string => Boolean(entry));
  }

  const parsedString = parseString(value);
  if (!parsedString) {
    return [];
  }

  try {
    const parsed = JSON.parse(parsedString) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map((entry) => parseString(entry)).filter((entry): entry is string => Boolean(entry));
    }
  } catch {
    return [];
  }

  return [];
};

const normalizeText = (value: string | null | undefined): string =>
  (value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const toLocalDate = (isoLike: string, timeZone: string): string | null => {
  const parsed = new Date(isoLike);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(parsed);
};

const unique = <T>(values: T[]): T[] => Array.from(new Set(values));

const sanitizeTemperatureText = (value: string): string =>
  value
    .normalize("NFKC")
    .replace(/\u00c2/g, "")
    .replace(/[℃]/g, " C ")
    .replace(/[℉]/g, " F ")
    .replace(/[°º˚]/g, " degree ")
    .replace(/\bfahrenheit\b/gi, " F ")
    .replace(/\bcelsius\b/gi, " C ")
    .replace(/[–—−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

const detectKellyTemperatureUnit = (text: string): KellyTemperatureUnit => {
  const sanitized = sanitizeTemperatureText(text);
  return /\b(?:fahrenheit|f)\b/i.test(sanitized) ? "F" : "C";
};

const mapWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  if (items.length === 0) {
    return [];
  }

  const limit = Math.max(1, Math.floor(concurrency));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await mapper(items[currentIndex]!, currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
};

const sanitizeKellyTemperatureText = (value: string): string =>
  value
    .normalize("NFKC")
    .replace(/[Â]/g, "")
    .replace(/℃/g, " °C ")
    .replace(/℉/g, " °F ")
    .replace(/([0-9])\s*[°º˚]\s*c\b/gi, "$1 °C")
    .replace(/([0-9])\s*[°º˚]\s*f\b/gi, "$1 °F")
    .replace(/\bdegrees?\s*c(?:elsius)?\b/gi, " °C ")
    .replace(/\bdegrees?\s*f(?:ahrenheit)?\b/gi, " °F ")
    .replace(/\bcelsius\b/gi, " C ")
    .replace(/\bfahrenheit\b/gi, " F ")
    .replace(/[–—−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

const sanitizeDisplayText = (value: string | null): string | null => {
  const sanitized = parseString(value);
  if (!sanitized) {
    return null;
  }

  return sanitizeTemperatureText(sanitized)
    .replace(/\s+([?!.,:;])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .trim();
};

const detectNormalizedKellyTemperatureUnit = (text: string): KellyTemperatureUnit =>
  /(?:°\s*F\b|\b-?\d+(?:\.\d+)?\s*F\b|\bFAHRENHEIT\b)/i.test(text) ? "F" : "C";

const clamp01 = (value: number | null | undefined): number | null => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }

  return Math.max(0, Math.min(1, value));
};

const parseOrderPrice = (value: unknown): number | null => {
  const parsed = parseNumber(value);
  if (parsed === null || parsed < 0 || parsed > 1) {
    return null;
  }

  return parsed;
};

const resolveOrderBookUpdatedAt = (record: Record<string, unknown> | null | undefined): string => {
  const numericTimestamp = parseNumber(record?.timestamp);
  if (numericTimestamp !== null) {
    const millis = numericTimestamp > 1e12 ? numericTimestamp : numericTimestamp * 1000;
    const parsed = new Date(millis);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  const isoLike = parseString(record?.updatedAt) ?? parseString(record?.timestampIso);
  if (isoLike) {
    const parsed = new Date(isoLike);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return new Date().toISOString();
};

const resolveWsRecordOccurredAt = (record: Record<string, unknown>): string | null => {
  const numericTimestamp =
    parseNumber(record.timestamp) ??
    parseNumber(record.ts) ??
    parseNumber(record.created_at) ??
    parseNumber(record.updated_at);
  if (numericTimestamp !== null) {
    const millis = numericTimestamp > 1e12 ? numericTimestamp : numericTimestamp * 1000;
    const parsed = new Date(millis);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  const isoLike =
    parseString(record.timestampIso) ??
    parseString(record.timestamp_iso) ??
    parseString(record.createdAt) ??
    parseString(record.updatedAt);
  if (isoLike) {
    const parsed = new Date(isoLike);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return null;
};

const resolveWsOccurredAt = (records: Record<string, unknown>[], fallbackIso: string): string => {
  const resolved = records
    .map((record) => resolveWsRecordOccurredAt(record))
    .filter((value): value is string => Boolean(value))
    .sort();

  return resolved.at(-1) ?? fallbackIso;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toWsRecords = (value: unknown): Record<string, unknown>[] => {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }

  return isRecord(value) ? [value] : [];
};

const resolveWsRecordType = (record: Record<string, unknown>): string | null =>
  [
    parseString(record.event_type),
    parseString(record.type),
    parseString(record.event),
    parseString(record.channel),
    parseString(record.message_type),
  ]
    .find((value): value is string => Boolean(value))
    ?.toLowerCase() ?? null;

const isKeepaliveText = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  if (/^(?:ping|pong)$/i.test(trimmed) || trimmed === "{}") {
    return true;
  }

  if (!(trimmed.startsWith("{") && trimmed.endsWith("}"))) {
    return false;
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (Object.keys(parsed).length === 0) {
      return true;
    }

    const keepaliveType = parseString(parsed.type) ?? parseString(parsed.event);
    return typeof keepaliveType === "string" && /^(?:ping|pong)$/i.test(keepaliveType);
  } catch {
    return false;
  }
};

const isUpstreamWsErrorRecord = (record: Record<string, unknown>): boolean => {
  const type = resolveWsRecordType(record);
  if (type === "error") {
    return true;
  }

  const status = parseString(record.status)?.toLowerCase();
  if (status === "error") {
    return true;
  }

  if (parseString(record.error)) {
    return true;
  }

  return /\berror\b/i.test(parseString(record.message) ?? "");
};

const isMarketSignalRecord = (record: Record<string, unknown>): boolean => {
  const type = resolveWsRecordType(record);
  if (
    type &&
    [
      "book",
      "orderbook",
      "price_change",
      "trade",
      "last_trade_price",
      "tick_size_change",
      "best_bid_ask",
      "market_resolved",
      "new_market",
    ].includes(type)
  ) {
    return true;
  }

  return [
    "asset_id",
    "assetId",
    "token_id",
    "tokenId",
    "best_bid",
    "best_ask",
    "price",
    "last_trade_price",
    "bids",
    "asks",
  ].some((key) => key in record);
};

const hasExplicitTimeComponent = (value: string): boolean => /(?:[t\s]\d{2}:\d{2}(?::\d{2})?)/i.test(value);

const resolveExpiryTimestamp = (values: Array<string | null | undefined>): number | null => {
  for (const value of values) {
    if (!value || !hasExplicitTimeComponent(value)) {
      continue;
    }

    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return null;
};

const buildTargetDateTokens = (targetDate: string): string[] => {
  const iso = `${targetDate}T00:00:00.000Z`;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return [targetDate];
  }

  const short = monthFormatterShort.format(parsed);
  const long = monthFormatterLong.format(parsed);
  const shortMonthDay = short.replace(/,?\s+\d{4}$/, "");
  const longMonthDay = long.replace(/,?\s+\d{4}$/, "");

  return unique([
    targetDate,
    short.toLowerCase(),
    long.toLowerCase(),
    shortMonthDay.toLowerCase(),
    longMonthDay.toLowerCase(),
  ]);
};

const MONTH_NAME_TO_NUMBER: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

const formatIsoDate = (year: number, month: number, day: number): string | null => {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const isoMonth = String(month).padStart(2, "0");
  const isoDay = String(day).padStart(2, "0");
  return `${year}-${isoMonth}-${isoDay}`;
};

const extractExplicitDatesFromText = (text: string, defaultYear: number): string[] => {
  const matches = new Set<string>();

  const isoRegex = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
  for (const match of text.matchAll(isoRegex)) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const iso = formatIsoDate(year, month, day);
    if (iso) {
      matches.add(iso);
    }
  }

  const monthRegex = /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?\b/gi;
  for (const match of text.matchAll(monthRegex)) {
    const monthToken = match[1].toLowerCase();
    const monthNumber = MONTH_NAME_TO_NUMBER[monthToken];
    const day = Number(match[2]);
    const year = match[3] ? Number(match[3]) : defaultYear;
    const iso = formatIsoDate(year, monthNumber, day);
    if (iso) {
      matches.add(iso);
    }
  }

  return Array.from(matches);
};

const buildLocationTokens = (location: RegisteredLocation): string[] =>
  unique(
    [
      location.code,
      location.shortLabel,
      location.cityName,
      location.displayName,
      location.countryName,
      `${location.cityName} airport`,
      `${location.cityName} weather`,
      `${location.cityName} high temperature`,
    ]
      .map((value) => normalizeText(value))
      .filter(Boolean),
  );

const buildSearchTerms = (location: RegisteredLocation, targetDate: string): string[] => {
  const [isoDate, shortDateWithYear, longDateWithYear, shortDate, longDate] = buildTargetDateTokens(targetDate);
  const city = location.cityName;

  return unique(
    [
      `highest temperature in ${city} on ${longDateWithYear ?? isoDate}`,
      `highest temperature in ${city} on ${longDate ?? shortDate ?? isoDate}`,
      `highest temperature ${city} ${isoDate}`,
      `${city} daily temperature ${longDateWithYear ?? isoDate}`,
      `${city} high temperature ${isoDate}`,
      `${city} high temperature ${longDate ?? shortDateWithYear ?? isoDate}`,
      `${city} temperature ${isoDate}`,
      `${location.code} temperature ${isoDate}`,
      `${city} weather ${isoDate}`,
    ]
      .map((value) => value.trim())
      .filter(Boolean),
  );
};

const slugifyPolymarketSegment = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

const buildEventSlugCandidates = (location: RegisteredLocation, targetDate: string): string[] => {
  const parsed = new Date(`${targetDate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return [];
  }

  const month = new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: "UTC",
  })
    .format(parsed)
    .toLowerCase();
  const day = String(parsed.getUTCDate());
  const year = String(parsed.getUTCFullYear());
  const citySlug = slugifyPolymarketSegment(location.cityName);
  const displaySlug = slugifyPolymarketSegment(location.displayName.replace(/\b(?:airport|international)\b/gi, ""));

  return unique(
    [citySlug, displaySlug]
      .filter(Boolean)
      .map((placeSlug) => `highest-temperature-in-${placeSlug}-on-${month}-${day}-${year}`),
  );
};

const extractPageMarketRecords = (html: string, eventSlug: string): Record<string, unknown>[] => {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/i);
  if (!match?.[1]) {
    return [];
  }

  if (match[1].length > POLYMARKET_MAX_EVENT_PAYLOAD_CHARS) {
    return [];
  }

  let payload: unknown;
  try {
    payload = JSON.parse(match[1]);
  } catch {
    return [];
  }

  const eventCandidates: Record<string, unknown>[] = [];
  let visitedCount = 0;
  const visit = (value: unknown) => {
    if (visitedCount >= POLYMARKET_MAX_EVENT_VISIT_COUNT) {
      return;
    }
    visitedCount += 1;

    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }

    if (!isRecord(value)) {
      return;
    }

    if (parseString(value.slug) === eventSlug && Array.isArray(value.markets) && value.markets.length > 0) {
      eventCandidates.push(value);
    }

    for (const nested of Object.values(value)) {
      visit(nested);
    }
  };

  visit(payload);

  const eventRecord = eventCandidates.find((candidate) => Array.isArray(candidate.markets) && candidate.markets.length > 0);
  if (!eventRecord || !Array.isArray(eventRecord.markets)) {
    return [];
  }

  const eventTitle = parseString(eventRecord.title);
  const eventDescription = parseString(eventRecord.description);
  const eventResolutionSource = parseString(eventRecord.resolutionSource);

  return eventRecord.markets
    .filter(isRecord)
    .map((market) => ({
      ...market,
      event: eventRecord,
      eventTitle,
      eventSlug,
      description: parseString(market.description) ?? eventDescription,
      resolutionSource: parseString(market.resolutionSource) ?? eventResolutionSource,
      slug: parseString(market.slug) ?? parseString(eventRecord.slug),
    }));
};

const extractEventEndpointMarkets = (payload: unknown): Record<string, unknown>[] => {
  const events = Array.isArray(payload) ? payload.filter(isRecord) : [];
  return events.flatMap((eventRecord) =>
    unwrapMarketCollection({
      events: [eventRecord],
    }),
  );
};

const unwrapMarketCollection = (value: unknown): Record<string, unknown>[] => {
  if (Array.isArray(value)) {
    return value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
  }

  if (typeof value !== "object" || value === null) {
    return [];
  }

  const record = value as Record<string, unknown>;

  if (Array.isArray(record.data)) {
    return unwrapMarketCollection(record.data);
  }

  if (Array.isArray(record.markets)) {
    return unwrapMarketCollection(record.markets);
  }

  if (Array.isArray(record.events)) {
    return record.events.flatMap((event) => {
      if (typeof event !== "object" || event === null) {
        return [];
      }

      const eventRecord = event as Record<string, unknown>;
      return unwrapMarketCollection(eventRecord.markets).map((market) => ({
        ...market,
        event:
          typeof (market as Record<string, unknown>).event === "object" &&
          (market as Record<string, unknown>).event !== null
            ? (market as Record<string, unknown>).event
            : eventRecord,
        eventTitle: parseString((market as Record<string, unknown>).eventTitle) ?? parseString(eventRecord.title),
        eventSlug: parseString((market as Record<string, unknown>).eventSlug) ?? parseString(eventRecord.slug),
      }));
    });
  }

  return [];
};

const detectUnit = (text: string): KellyTemperatureUnit => (/\b(?:°|deg(?:ree)?s?)?\s*f\b/i.test(text) ? "F" : "C");

const toCelsius = (value: number, unit: KellyTemperatureUnit): number =>
  unit === "F" ? ((value - 32) * 5) / 9 : value;

const toDisplayTemperature = (valueC: number, unit: KellyTemperatureUnit): number =>
  unit === "F" ? (valueC * 9) / 5 + 32 : valueC;

const formatBucketLabel = (
  contractType: KellyContractType,
  startC: number | null,
  endC: number | null,
  unit: KellyTemperatureUnit,
): string => {
  if (startC === null && endC === null) {
    return "Unparsed";
  }

  const suffix = unit === "F" ? "F" : "C";
  if (contractType === "exact" && startC !== null) {
    return `${toDisplayTemperature(startC, unit).toFixed(1)}${suffix} exact`;
  }

  if (contractType === "atLeast" && startC !== null) {
    return `>= ${toDisplayTemperature(startC, unit).toFixed(1)}${suffix}`;
  }

  if (contractType === "atMost" && endC !== null) {
    return `<= ${toDisplayTemperature(endC, unit).toFixed(1)}${suffix}`;
  }

  if (startC !== null && endC !== null) {
    return `${toDisplayTemperature(startC, unit).toFixed(1)}${suffix} - ${toDisplayTemperature(
      endC,
      unit,
    ).toFixed(1)}${suffix}`;
  }

  return "Unparsed";
};

const parseFromBounds = (
  raw: Record<string, unknown>,
  unit: KellyTemperatureUnit,
): { contractType: KellyContractType; startC: number | null; endC: number | null } | null => {
  const lower = parseNumber(raw.lowerBound);
  const upper = parseNumber(raw.upperBound);

  if (lower === null && upper === null) {
    return null;
  }

  if (lower !== null && upper !== null) {
    const lowerC = toCelsius(lower, unit);
    const upperC = toCelsius(upper, unit);
    if (Math.abs(lowerC - upperC) < 0.001) {
      return { contractType: "exact", startC: lowerC, endC: lowerC };
    }
    return { contractType: "range", startC: Math.min(lowerC, upperC), endC: Math.max(lowerC, upperC) };
  }

  if (lower !== null) {
    return { contractType: "atLeast", startC: toCelsius(lower, unit), endC: null };
  }

  return { contractType: "atMost", startC: null, endC: toCelsius(upper ?? 0, unit) };
};

const parseTemperatureContract = (
  raw: Record<string, unknown>,
  combinedText: string,
): { contractType: KellyContractType; startC: number | null; endC: number | null; unit: KellyTemperatureUnit } | null =>
  parseTemperatureContractV2(raw, combinedText);

const parseTemperatureContractV2 = (
  raw: Record<string, unknown>,
  combinedText: string,
): { contractType: KellyContractType; startC: number | null; endC: number | null; unit: KellyTemperatureUnit } | null => {
  const sanitizedText = sanitizeKellyTemperatureText(combinedText);
  const unit = detectNormalizedKellyTemperatureUnit(sanitizedText);
  const bounds = parseFromBounds(raw, unit);
  if (bounds) {
    return { ...bounds, unit };
  }

  const threshold = parseNumber(raw.groupItemThreshold) ?? parseNumber(raw.line);
  const hasExplicitTemperature = /(-?\d+(?:\.\d+)?)\s*(?:°\s*)?[cf]\b/i.test(sanitizedText);
  if (threshold !== null && !hasExplicitTemperature) {
    const thresholdC = toCelsius(threshold, unit);
    if (/(at least|or above|above|over|higher|>=)/i.test(sanitizedText)) {
      return { contractType: "atLeast", startC: thresholdC, endC: null, unit };
    }
    if (/(at most|or below|below|under|less than|<=)/i.test(sanitizedText)) {
      return { contractType: "atMost", startC: null, endC: thresholdC, unit };
    }
    if (/exact/i.test(sanitizedText)) {
      return { contractType: "exact", startC: thresholdC, endC: thresholdC, unit };
    }
  }

  const rangeMatch = sanitizedText.match(
    /(?:between\s+|from\s+)?(-?\d+(?:\.\d+)?)\s*(?:°\s*)?([cf])?\s*(?:to|through|and|-)\s*(-?\d+(?:\.\d+)?)\s*(?:°\s*)?([cf])?\b/i,
  );
  if (rangeMatch) {
    const explicitUnit = (rangeMatch[2] ?? rangeMatch[4] ?? unit).toUpperCase() as KellyTemperatureUnit;
    const startC = toCelsius(Number.parseFloat(rangeMatch[1] ?? "0"), explicitUnit);
    const endC = toCelsius(Number.parseFloat(rangeMatch[3] ?? "0"), explicitUnit);
    return { contractType: "range", startC: Math.min(startC, endC), endC: Math.max(startC, endC), unit: explicitUnit };
  }

  const comparatorPrefixMatch = sanitizedText.match(
    /(at least|or above|and above|above|over|higher|at most|or below|and below|below|under|lower|less than|exact(?:ly)?|>=|<=)\s*(-?\d+(?:\.\d+)?)\s*(?:°\s*)?([cf])?\b/i,
  );
  if (comparatorPrefixMatch) {
    const explicitUnit = (comparatorPrefixMatch[3] ?? unit).toUpperCase() as KellyTemperatureUnit;
    const valueC = toCelsius(Number.parseFloat(comparatorPrefixMatch[2] ?? "0"), explicitUnit);
    const comparator = comparatorPrefixMatch[1]?.toLowerCase() ?? "";
    if (/(at least|or above|above|over|higher|>=)/i.test(comparator)) {
      return { contractType: "atLeast", startC: valueC, endC: null, unit: explicitUnit };
    }
    if (/(at most|or below|below|under|less than|<=)/i.test(comparator)) {
      return { contractType: "atMost", startC: null, endC: valueC, unit: explicitUnit };
    }
    if (/exact/i.test(comparator)) {
      return { contractType: "exact", startC: valueC, endC: valueC, unit: explicitUnit };
    }
  }

  const comparatorSuffixMatch = sanitizedText.match(
    /(-?\d+(?:\.\d+)?)\s*(?:°\s*)?([cf])?\s*(or above|or below|and above|and below|above|below|over|under|higher|lower)\b/i,
  );
  if (comparatorSuffixMatch) {
    const explicitUnit = (comparatorSuffixMatch[2] ?? unit).toUpperCase() as KellyTemperatureUnit;
    const valueC = toCelsius(Number.parseFloat(comparatorSuffixMatch[1] ?? "0"), explicitUnit);
    const comparator = comparatorSuffixMatch[3]?.toLowerCase() ?? "";
    if (/(above|over|higher)/i.test(comparator)) {
      return { contractType: "atLeast", startC: valueC, endC: null, unit: explicitUnit };
    }
    if (/(below|under|lower)/i.test(comparator)) {
      return { contractType: "atMost", startC: null, endC: valueC, unit: explicitUnit };
    }
  }

  const exactMatch = sanitizedText.match(/(-?\d+(?:\.\d+)?)\s*(?:°\s*)?([cf])\b/i);
  if (exactMatch) {
    const explicitUnit = exactMatch[2].toUpperCase() as KellyTemperatureUnit;
    const valueC = toCelsius(Number.parseFloat(exactMatch[1] ?? "0"), explicitUnit);
    const comparatorHint = sanitizedText.match(/\b(or above|or below|and above|and below|above|below|over|under|higher|lower)\b/i);
    if (comparatorHint) {
      const comparator = comparatorHint[1]?.toLowerCase() ?? "";
      if (/(above|over|higher)/i.test(comparator)) {
        return { contractType: "atLeast", startC: valueC, endC: null, unit: explicitUnit };
      }
      if (/(below|under|lower)/i.test(comparator)) {
        return { contractType: "atMost", startC: null, endC: valueC, unit: explicitUnit };
      }
    }
    return { contractType: "exact", startC: valueC, endC: valueC, unit: explicitUnit };
  }

  return null;
};

const hasWeatherKeywords = (text: string): boolean =>
  /\b(weather|temperature|high temp|high temperature|daily high|forecast high)\b/i.test(text);

const dateMatches = (location: RegisteredLocation, targetDate: string, raw: Record<string, unknown>, text: string): boolean => {
  const normalizedText = normalizeText(text);
  const targetYear = Number.parseInt(targetDate.slice(0, 4), 10);
  const explicitDates = extractExplicitDatesFromText(normalizedText, Number.isFinite(targetYear) ? targetYear : new Date().getUTCFullYear());

  if (explicitDates.length > 0) {
    return explicitDates.includes(targetDate);
  }

  const candidateDates = [
    parseString(raw.resolveDate),
    parseString(raw.resolutionDate),
    parseString(raw.eventStartDate),
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => toLocalDate(value, location.timezone))
    .filter((value): value is string => Boolean(value));

  if (candidateDates.includes(targetDate)) {
    return true;
  }

  const normalizedTokens = buildTargetDateTokens(targetDate).map((token) => normalizeText(token));
  return normalizedTokens.some((token) => normalizedText.includes(token));
};

const locationMatches = (location: RegisteredLocation, text: string): boolean => {
  const normalized = normalizeText(text);
  return buildLocationTokens(location).some((token) => normalized.includes(token));
};

const marketKey = (raw: Record<string, unknown>, fallbackTitle: string) =>
  parseString(raw.id) ??
  parseString(raw.marketId) ??
  parseString(raw.conditionId) ??
  parseString(raw.slug) ??
  fallbackTitle;

const buildEventUrl = (raw: Record<string, unknown>): string | null => {
  const eventSlug =
    parseString(raw.eventSlug) ??
    parseString((raw.event as Record<string, unknown> | undefined)?.slug) ??
    parseString(raw.slug);
  if (!eventSlug) {
    return null;
  }

  return `${POLYMARKET_EVENT_BASE_URL}/${eventSlug}`;
};

const partitionDiscoveryCandidates = (candidates: PolymarketCandidate[]): {
  active: PolymarketCandidate[];
  inactive: PolymarketCandidate[];
} => {
  const active: PolymarketCandidate[] = [];
  const inactive: PolymarketCandidate[] = [];

  for (const candidate of candidates) {
    if (candidate.lifecycle === "inactive") {
      inactive.push(candidate);
      continue;
    }

    active.push(candidate);
  }

  return { active, inactive };
};

const resolveLifecycle = (raw: Record<string, unknown>): {
  lifecycle: KellyMarketLifecycle;
  inactiveReason: KellyInactiveReason | null;
  active: boolean | null;
  closed: boolean | null;
  acceptingOrders: boolean | null;
  archived: boolean | null;
  enableOrderBook: boolean | null;
  endsAt: string | null;
} => {
  const eventRecord =
    typeof raw.event === "object" && raw.event !== null ? (raw.event as Record<string, unknown>) : undefined;
  const active = parseBoolean(raw.active) ?? parseBoolean(eventRecord?.active);
  const closed = parseBoolean(raw.closed) ?? parseBoolean(eventRecord?.closed);
  const acceptingOrders =
    parseBoolean(raw.acceptingOrders) ??
    parseBoolean(raw.accepting_orders) ??
    parseBoolean(eventRecord?.acceptingOrders) ??
    parseBoolean(eventRecord?.accepting_orders);
  const archived = parseBoolean(raw.archived) ?? parseBoolean(eventRecord?.archived);
  const enableOrderBook =
    parseBoolean(raw.enableOrderBook) ??
    parseBoolean(raw.enable_order_book) ??
    parseBoolean(eventRecord?.enableOrderBook) ??
    parseBoolean(eventRecord?.enable_order_book);
  const endsAt =
    parseString(raw.closedTime) ??
    parseString(raw.endDateIso) ??
    parseString(raw.endDate) ??
    parseString(raw.umaEndDate) ??
    parseString(raw.resolveDate) ??
    parseString(raw.resolutionDate) ??
    parseString(raw.gameStartTime) ??
    parseString(eventRecord?.closedTime) ??
    parseString(eventRecord?.endDateIso) ??
    parseString(eventRecord?.endDate) ??
    parseString(eventRecord?.umaEndDate) ??
    parseString(eventRecord?.resolveDate);
  const expiryAt = resolveExpiryTimestamp([
    parseString(raw.closedTime),
    parseString(raw.endDateIso),
    parseString(raw.endDate),
    parseString(raw.umaEndDate),
    parseString(eventRecord?.closedTime),
    parseString(eventRecord?.endDateIso),
    parseString(eventRecord?.endDate),
    parseString(eventRecord?.umaEndDate),
  ]);

  if (closed === true) {
    return { lifecycle: "inactive", inactiveReason: "closed", active, closed, acceptingOrders, archived, enableOrderBook, endsAt };
  }

  if (acceptingOrders === false) {
    return {
      lifecycle: "inactive",
      inactiveReason: "accepting_orders_disabled",
      active,
      closed,
      acceptingOrders,
      archived,
      enableOrderBook,
      endsAt,
    };
  }

  if (archived === true) {
    return { lifecycle: "inactive", inactiveReason: "archived", active, closed, acceptingOrders, archived, enableOrderBook, endsAt };
  }

  if (enableOrderBook === false) {
    return {
      lifecycle: "inactive",
      inactiveReason: "accepting_orders_disabled",
      active,
      closed,
      acceptingOrders,
      archived,
      enableOrderBook,
      endsAt,
    };
  }

  const hasExplicitTradableSignal =
    closed === false || acceptingOrders === true || archived === false || enableOrderBook === true;

  if (!hasExplicitTradableSignal && expiryAt !== null && expiryAt < Date.now()) {
    return { lifecycle: "inactive", inactiveReason: "expired", active, closed, acceptingOrders, archived, enableOrderBook, endsAt };
  }

  return { lifecycle: "tradable", inactiveReason: null, active, closed, acceptingOrders, archived, enableOrderBook, endsAt };
};

const normalizeCandidate = (
  raw: Record<string, unknown>,
  location: RegisteredLocation,
  targetDate: string,
): PolymarketCandidate | null => {
  const rawTitle =
    parseString(raw.question) ??
    parseString(raw.title) ??
    parseString(raw.groupItemTitle) ??
    parseString(raw.name);
  if (!rawTitle) {
    return null;
  }

  const rawEventTitle =
    parseString(raw.eventTitle) ??
    parseString((raw.event as Record<string, unknown> | undefined)?.title);
  const rawDescription = parseString(raw.description);
  const title = sanitizeDisplayText(rawTitle) ?? rawTitle;
  const eventTitle = sanitizeDisplayText(rawEventTitle) ?? rawEventTitle;
  const description = sanitizeDisplayText(rawDescription) ?? rawDescription;
  const resolutionSource =
    parseString(raw.resolutionSource) ??
    parseString(raw.resolution_source) ??
    parseString((raw.event as Record<string, unknown> | undefined)?.resolutionSource);
  const combinedText = [rawTitle, rawEventTitle, rawDescription].filter(Boolean).join(" ");
  const parsedContract =
    parseTemperatureContractV2(raw, [rawTitle, rawEventTitle].filter(Boolean).join(" ")) ??
    parseTemperatureContractV2(raw, combinedText) ??
    parseTemperatureContract(raw, combinedText);
  const matchedLocation = locationMatches(location, combinedText);
  const matchedDate = dateMatches(location, targetDate, raw, combinedText);
  const weatherKeywords = hasWeatherKeywords(combinedText);
  const outcomeLabels = parseStringArray(raw.outcomes);
  const tokenIds = parseStringArray(raw.clobTokenIds);
  const yesIndex = outcomeLabels.findIndex((outcome) => /^yes$/i.test(outcome));
  const noIndex = outcomeLabels.findIndex((outcome) => /^no$/i.test(outcome));
  const yesTokenId = tokenIds[yesIndex >= 0 ? yesIndex : 0] ?? null;
  const noTokenId = tokenIds[noIndex >= 0 ? noIndex : 1] ?? null;
  const marketUrl = buildEventUrl(raw);
  const eventUrl = buildEventUrl(raw);
  const conditionId = parseString(raw.conditionId);
  const lifecycleState = resolveLifecycle(raw);
  const status =
    matchedLocation && matchedDate && weatherKeywords && parsedContract && yesTokenId && noTokenId ? "matched" : "unresolved";

  let exclusionReason: string | null = null;
  if (!matchedLocation) {
    exclusionReason = "市场标题或规则文本里没有稳定命中当前地点别名。";
  } else if (!matchedDate) {
    exclusionReason = "市场元数据里无法稳定确认目标日期。";
  } else if (!weatherKeywords) {
    exclusionReason = "市场文本看起来不是天气最高温合约。";
  } else if (!parsedContract) {
    exclusionReason = "温度档位暂时无法解析成支持的合约类型。";
  } else if (!yesTokenId || !noTokenId) {
    exclusionReason = "Polymarket 没有提供完整的 Yes/No token 标识。";
  } else if (lifecycleState.inactiveReason === "closed") {
    exclusionReason = "该市场已结束，不再纳入当前可交易主表。";
  } else if (lifecycleState.inactiveReason === "accepting_orders_disabled") {
    exclusionReason = "该市场当前不再接受下单。";
  } else if (lifecycleState.inactiveReason === "archived") {
    exclusionReason = "该市场已归档。";
  } else if (lifecycleState.inactiveReason === "expired") {
    exclusionReason = "该市场结束时间已过。";
  }

  return {
    marketId: marketKey(raw, title),
    slug: parseString(raw.slug),
    title,
    marketUrl,
    conditionId,
    contractType: parsedContract?.contractType ?? "exact",
    unit: parsedContract?.unit ?? "C",
    bucketStartC: parsedContract?.startC ?? null,
    bucketEndC: parsedContract?.endC ?? null,
    bucketLabel: formatBucketLabel(
      parsedContract?.contractType ?? "exact",
      parsedContract?.startC ?? null,
      parsedContract?.endC ?? null,
      parsedContract?.unit ?? "C",
    ),
    lifecycle:
      lifecycleState.lifecycle === "inactive"
        ? "inactive"
        : status === "unresolved"
          ? "unresolved"
          : lifecycleState.lifecycle,
    inactiveReason:
      lifecycleState.lifecycle === "inactive"
        ? lifecycleState.inactiveReason
        : status === "unresolved"
          ? (!yesTokenId || !noTokenId ? "missing_tokens" : null)
          : lifecycleState.inactiveReason,
    parseStatus: status,
    exclusionReason,
    yesTokenId,
    noTokenId,
    updatedAt:
      parseString(raw.updatedAt) ??
      parseString(raw.lastUpdated) ??
      parseString(raw.endDateIso) ??
      parseString(raw.endDate),
    eventTitle,
    eventUrl,
    liquidity: parseNumber(raw.liquidity),
    volume24h: parseNumber(raw.volume24hr) ?? parseNumber(raw.volume24h) ?? parseNumber(raw.volume),
    description,
    resolutionSource,
    active: lifecycleState.active,
    closed: lifecycleState.closed,
    acceptingOrders: lifecycleState.acceptingOrders,
    archived: lifecycleState.archived,
    enableOrderBook: lifecycleState.enableOrderBook,
    endsAt: lifecycleState.endsAt,
  };
};

const toOrderBookUrl = (baseUrl: string, tokenId: string) => `${baseUrl}/book?token_id=${encodeURIComponent(tokenId)}`;

const normalizeOrderBook = (tokenId: string, payload: unknown): NormalizedOrderBook => {
  const record =
    typeof payload === "object" && payload !== null && "book" in (payload as Record<string, unknown>)
      ? ((payload as Record<string, unknown>).book as Record<string, unknown> | null)
      : (payload as Record<string, unknown> | null);

  const bids = Array.isArray(record?.bids) ? (record?.bids as RawOrderLevel[]) : [];
  const asks = Array.isArray(record?.asks) ? (record?.asks as RawOrderLevel[]) : [];
  const bestBid =
    bids.reduce<number | null>((best, level) => {
      const price = parseOrderPrice(level?.price);
      if (price === null) {
        return best;
      }
      return best === null ? price : Math.max(best, price);
    }, null);
  const bestAsk =
    asks.reduce<number | null>((best, level) => {
      const price = parseOrderPrice(level?.price);
      if (price === null) {
        return best;
      }
      return best === null ? price : Math.min(best, price);
    }, null);
  const midpoint =
    bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : (bestAsk ?? bestBid ?? null);

  return {
    tokenId,
    bestBid,
    bestAsk,
    midpoint,
    updatedAt: resolveOrderBookUpdatedAt(record),
    status: "available",
  };
};

export class PolymarketClient {
  private readonly gammaBaseUrl = config.polymarketGammaBaseUrl.replace(/\/+$/, "");
  private readonly clobBaseUrl = config.polymarketClobBaseUrl.replace(/\/+$/, "");
  private readonly clobWsUrl = config.polymarketClobWsUrl;

  private async trySearchEndpoint(path: string): Promise<Record<string, unknown>[]> {
    try {
      const payload = await fetchJson<unknown>(`${this.gammaBaseUrl}${path}`, {
        signal: AbortSignal.timeout(POLYMARKET_DISCOVERY_TIMEOUT_MS),
      });
      return unwrapMarketCollection(payload);
    } catch {
      return [];
    }
  }

  private async searchMarkets(term: string): Promise<Record<string, unknown>[]> {
    const encoded = encodeURIComponent(term);
    const candidates = [
      `/public-search?q=${encoded}`,
      `/public-search?query=${encoded}`,
      `/markets?search=${encoded}&active=true&closed=false&limit=100`,
    ];

    for (const path of candidates) {
      const results = await this.trySearchEndpoint(path);
      if (results.length > 0) {
        return results;
      }
    }

    return [];
  }

  private async fallbackActiveMarkets(): Promise<Record<string, unknown>[]> {
    const results = await mapWithConcurrency([0, 100], POLYMARKET_DISCOVERY_CONCURRENCY, async (offset) => {
        const path = `/markets?active=true&closed=false&limit=100&offset=${offset}`;
        return await this.trySearchEndpoint(path);
      });

    return results.flat();
  }

  private async fetchExactEventMarkets(location: RegisteredLocation, targetDate: string): Promise<Record<string, unknown>[]> {
    for (const eventSlug of buildEventSlugCandidates(location, targetDate)) {
      try {
        const payload = await fetchJson<unknown>(`${this.gammaBaseUrl}/events?limit=1&slug=${encodeURIComponent(eventSlug)}`, {
          signal: AbortSignal.timeout(POLYMARKET_DISCOVERY_TIMEOUT_MS),
        });
        const records = extractEventEndpointMarkets(payload);
        if (records.length > 0) {
          return records;
        }
      } catch {
        // Try the next slug candidate.
      }
    }

    return [];
  }

  private async fetchEventPageMarkets(location: RegisteredLocation, targetDate: string): Promise<Record<string, unknown>[]> {
    for (const eventSlug of buildEventSlugCandidates(location, targetDate)) {
      try {
        const html = await fetchText(`${POLYMARKET_EVENT_BASE_URL}/${eventSlug}`);
        const records = extractPageMarketRecords(html, eventSlug);
        if (records.length > 0) {
          return records;
        }
      } catch {
        // Try the next event page candidate.
      }
    }

    return [];
  }

  async discoverMarkets(location: RegisteredLocation, targetDate: string): Promise<PolymarketDiscoveryResult> {
    const collected = new Map<string, Record<string, unknown>>();

    for (const entry of await this.fetchExactEventMarkets(location, targetDate)) {
      const title =
        parseString(entry.question) ??
        parseString(entry.title) ??
        parseString(entry.groupItemTitle) ??
        parseString(entry.slug) ??
        `exact-event-${collected.size}`;
      collected.set(marketKey(entry, title), entry);
    }

    const searchTerms = buildSearchTerms(location, targetDate).slice(0, POLYMARKET_MAX_SEARCH_TERMS);
    if (collected.size === 0) {
      const searchResults = await mapWithConcurrency(
        searchTerms,
        POLYMARKET_DISCOVERY_CONCURRENCY,
        async (term) => ({ term, results: await this.searchMarkets(term) }),
      );

      for (const { term, results } of searchResults) {
        for (const entry of results) {
          const title =
            parseString(entry.question) ??
            parseString(entry.title) ??
            parseString(entry.groupItemTitle) ??
            parseString(entry.slug) ??
            `${term}-${collected.size}`;
          collected.set(marketKey(entry, title), entry);
        }
      }
    }

    if (collected.size === 0) {
      for (const entry of await this.fetchEventPageMarkets(location, targetDate)) {
        const title =
          parseString(entry.question) ??
          parseString(entry.title) ??
          parseString(entry.groupItemTitle) ??
          parseString(entry.slug) ??
          `page-${collected.size}`;
        collected.set(marketKey(entry, title), entry);
      }
    }

    if (collected.size === 0) {
      for (const entry of await this.fallbackActiveMarkets()) {
        const title =
          parseString(entry.question) ??
          parseString(entry.title) ??
          parseString(entry.groupItemTitle) ??
          parseString(entry.slug) ??
          `fallback-${collected.size}`;
        collected.set(marketKey(entry, title), entry);
      }
    }

    const candidates = Array.from(collected.values())
      .map((entry) => normalizeCandidate(entry, location, targetDate))
      .filter((entry): entry is PolymarketCandidate => Boolean(entry))
      .sort((left, right) => {
        if (left.parseStatus !== right.parseStatus) {
          return left.parseStatus === "matched" ? -1 : 1;
        }
        return (right.volume24h ?? 0) - (left.volume24h ?? 0);
      });

    const finalCandidates = Array.from(collected.values())
      .map((entry) => normalizeCandidate(entry, location, targetDate))
      .filter((entry): entry is PolymarketCandidate => Boolean(entry))
      .sort((left, right) => {
        if (left.parseStatus !== right.parseStatus) {
          return left.parseStatus === "matched" ? -1 : 1;
        }
        return (right.volume24h ?? 0) - (left.volume24h ?? 0);
      });
    const { active: visibleCandidates, inactive: inactiveCandidates } = partitionDiscoveryCandidates(finalCandidates);

    return {
      fetchedAt: new Date().toISOString(),
      candidates: visibleCandidates,
      inactiveCandidates,
      sourceLinks: {
        meteoblueWeekUrl: location.weekPageUrl,
        meteoblueMultimodelUrl: location.multimodelPageUrl,
        polymarketSearchUrl: `${this.gammaBaseUrl}/public-search?q=${encodeURIComponent(
          searchTerms[0] ?? `${location.cityName} high temperature ${targetDate}`,
        )}`,
        marketUrls: visibleCandidates
          .map((candidate) => candidate.marketUrl)
          .filter((value): value is string => Boolean(value))
          .slice(0, 12),
      },
    };
  }

  async fetchOrderBooks(tokenIds: string[]): Promise<Map<string, NormalizedOrderBook>> {
    const uniqueTokenIds = unique(tokenIds.filter(Boolean));
    const entries = await mapWithConcurrency(uniqueTokenIds, POLYMARKET_ORDERBOOK_CONCURRENCY, async (tokenId) => {
        try {
          const payload = await fetchJson<unknown>(toOrderBookUrl(this.clobBaseUrl, tokenId), {
            signal: AbortSignal.timeout(POLYMARKET_DISCOVERY_TIMEOUT_MS),
          });
          return normalizeOrderBook(tokenId, payload);
        } catch (error) {
          if (String(error).toLowerCase().includes("no orderbook exists")) {
            return {
              tokenId,
              bestBid: null,
              bestAsk: null,
              midpoint: null,
              updatedAt: new Date().toISOString(),
              status: "no-orderbook" as const,
            };
          }

          return null;
        }
      });

    return new Map(
      entries
        .filter((entry): entry is NormalizedOrderBook => Boolean(entry))
        .map((entry) => [entry.tokenId, entry]),
    );
  }

  createMarketStream(
    tokenIds: string[],
    onMessage: (message: KellyStreamMessage) => void,
    onSignal: (occurredAt: string) => void,
  ): KellyStreamHandle {
    const uniqueTokenIds = unique(tokenIds.filter(Boolean));
    if (uniqueTokenIds.length === 0) {
      onMessage({
        type: "status",
        generatedAt: new Date().toISOString(),
        state: "unavailable",
        reasonCode: "missing_tokens",
        message: "当前匹配到的市场没有完整 token 标识，无法建立实时流。",
      });
      return {
        close() {},
      };
    }

    let closed = false;
    let socket: WebSocket | null = null;
    let heartbeatTimer: NodeJS.Timeout | null = null;
    let reconnectTimer: NodeJS.Timeout | null = null;
    let reconnectAttempt = 0;

    const clearHeartbeat = () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    };

    const clearReconnect = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const clearSocketRuntime = () => {
      clearHeartbeat();
    };

    const scheduleReconnect = (message: string) => {
      if (closed || reconnectTimer) {
        return;
      }

      clearSocketRuntime();
      onMessage({
        type: "status",
        generatedAt: new Date().toISOString(),
        state: "degraded",
        reasonCode: "polling_fallback",
        message,
      });

      const delay = Math.min(
        POLYMARKET_STREAM_RECONNECT_MAX_MS,
        POLYMARKET_STREAM_RECONNECT_BASE_MS * 2 ** reconnectAttempt,
      );
      reconnectAttempt = Math.min(reconnectAttempt + 1, 8);

      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (!closed) {
          connect();
        }
      }, delay);
    };

    const connect = () => {
      if (closed) {
        return;
      }

      const nextSocket = new WebSocket(this.clobWsUrl);
      socket = nextSocket;

      nextSocket.on("open", () => {
        if (socket !== nextSocket || closed) {
          return;
        }

        reconnectAttempt = 0;
        onMessage({
          type: "status",
          generatedAt: new Date().toISOString(),
          state: "connected",
          reasonCode: "ws_connected",
          message: "已连接 Polymarket 市场实时流。",
        });

        nextSocket.send(
          JSON.stringify({
            assets_ids: uniqueTokenIds,
            type: "market",
            custom_feature_enabled: true,
          }),
        );

        // Keep the upstream market channel alive with official PING heartbeats.
        // Quiet books are valid, so close/error should drive reconnects instead
        // of a synthetic idle watchdog.
        heartbeatTimer = setInterval(() => {
          if (nextSocket.readyState !== WebSocket.OPEN) {
            return;
          }

          try {
            nextSocket.send("PING");
          } catch {
            // ignore heartbeat send errors; close/error handlers publish status
          }
        }, POLYMARKET_STREAM_HEARTBEAT_MS);
        return;
      });

      nextSocket.on("message", (payload: RawData) => {
        if (socket !== nextSocket || closed) {
          return;
        }

        const rawText = payload.toString();
        if (!rawText.trim() || isKeepaliveText(rawText)) {
          return;
        }

        let parsed: unknown = rawText;
        try {
          parsed = JSON.parse(rawText);
        } catch {
          if (/\berror\b/i.test(rawText)) {
            onMessage({
              type: "status",
              generatedAt: new Date().toISOString(),
              state: "degraded",
              reasonCode: "upstream_error",
              message: "Polymarket 上游实时流返回异常文本，当前回退到轮询盘口同步。",
            });
          }
          return;
        }

        const records = toWsRecords(parsed);
        const occurredAt = resolveWsOccurredAt(records, new Date().toISOString());
        if (records.some(isUpstreamWsErrorRecord)) {
          onMessage({
            type: "status",
            generatedAt: occurredAt,
            state: "degraded",
            reasonCode: "upstream_error",
            message: "Polymarket 上游实时流返回错误，当前回退到轮询盘口同步。",
          });
          return;
        }

        if (records.some(isMarketSignalRecord)) {
          onSignal(occurredAt);
          return;
        }

        const normalized = JSON.stringify(parsed).toLowerCase();
        if (normalized.includes("error")) {
          onMessage({
            type: "status",
            generatedAt: occurredAt,
            state: "degraded",
            reasonCode: "upstream_error",
            message: "Polymarket 上游实时流返回异常，当前回退到周期性盘口同步。",
          });
        }
      });

      nextSocket.on("close", () => {
        if (socket !== nextSocket) {
          return;
        }

        clearSocketRuntime();
        socket = null;
        if (!closed) {
          scheduleReconnect("Polymarket 实时流已断开，正在重连并回退到轮询。");
        }
      });

      nextSocket.on("error", () => {
        if (socket !== nextSocket) {
          return;
        }

        clearSocketRuntime();
        socket = null;
        scheduleReconnect("Polymarket 实时流异常，正在重连并回退到轮询。");
        try {
          nextSocket.close();
        } catch {
          // ignore close errors while reconnect is already scheduled
        }
      });
    };

    connect();

    return {
      close() {
        closed = true;
        clearReconnect();
        clearSocketRuntime();
        try {
          socket?.close();
        } catch {
          // ignore close errors
        }
        socket = null;
      },
    };
  }
}

export const buildDiscoveryWarnings = (candidates: PolymarketCandidate[]): string[] => {
  const matchedCount = candidates.filter((candidate) => candidate.parseStatus === "matched").length;
  const tradableCount = candidates.filter(
    (candidate) => candidate.parseStatus === "matched" && candidate.lifecycle === "tradable",
  ).length;
  if (tradableCount > 0) {
    return [];
  }

  if (candidates.length === 0) {
    return ["未找到可解析的 Polymarket 天气高温合约。"];
  }

  if (matchedCount > 0) {
    return ["已匹配到市场，但当前都已结束或暂不可交易。"];
  }

  return ["已发现候选市场，但未能稳定解析出符合当前地点和日期的温度档位。"];
};
