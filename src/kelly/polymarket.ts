import WebSocket, { type RawData } from "ws";

import { config, type RegisteredLocation } from "../config.js";
import type {
  KellyContractType,
  KellyMarketRow,
  KellySourceLinks,
  KellyStreamHandle,
  KellyStreamMessage,
  KellyTemperatureUnit,
} from "../domain/weather.js";
import { fetchJson } from "../lib/http.js";

const POLYMARKET_EVENT_BASE_URL = "https://polymarket.com/event";
const POLYMARKET_DISCOVERY_TIMEOUT_MS = Math.min(config.httpTimeoutMs, 2_500);
const POLYMARKET_MAX_SEARCH_TERMS = 4;

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
}

export interface PolymarketDiscoveryResult {
  fetchedAt: string;
  candidates: PolymarketCandidate[];
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

const clamp01 = (value: number | null | undefined): number | null => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }

  return Math.max(0, Math.min(1, value));
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
  const dateTokens = buildTargetDateTokens(targetDate);
  const city = location.cityName;

  return unique(
    [
      `${city} high temperature ${targetDate}`,
      `${city} weather ${targetDate}`,
      `${city} temperature ${targetDate}`,
      `${city} weather`,
      `${city} high temperature`,
      `${location.code} weather`,
      `${city} ${dateTokens[1] ?? targetDate}`,
    ]
      .map((value) => value.trim())
      .filter(Boolean),
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

      return unwrapMarketCollection((event as Record<string, unknown>).markets);
    });
  }

  return [];
};

const detectUnit = (text: string): KellyTemperatureUnit => (/\b(?:°|deg(?:ree)?s?)?\s*f\b/i.test(text) ? "F" : "C");

const toCelsius = (value: number, unit: KellyTemperatureUnit): number =>
  unit === "F" ? ((value - 32) * 5) / 9 : value;

const formatBucketLabel = (
  contractType: KellyContractType,
  startC: number | null,
  endC: number | null,
): string => {
  if (startC === null && endC === null) {
    return "Unparsed";
  }

  if (contractType === "exact" && startC !== null) {
    return `${startC.toFixed(1)}C exact`;
  }

  if (contractType === "atLeast" && startC !== null) {
    return `>= ${startC.toFixed(1)}C`;
  }

  if (contractType === "atMost" && endC !== null) {
    return `<= ${endC.toFixed(1)}C`;
  }

  if (startC !== null && endC !== null) {
    return `${startC.toFixed(1)}C - ${endC.toFixed(1)}C`;
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
): { contractType: KellyContractType; startC: number | null; endC: number | null; unit: KellyTemperatureUnit } | null => {
  const unit = detectUnit(combinedText);
  const bounds = parseFromBounds(raw, unit);
  if (bounds) {
    return { ...bounds, unit };
  }

  const threshold = parseNumber(raw.groupItemThreshold) ?? parseNumber(raw.line);
  if (threshold !== null) {
    const thresholdC = toCelsius(threshold, unit);
    if (/(at least|or above|above|over|higher|>=)/i.test(combinedText)) {
      return { contractType: "atLeast", startC: thresholdC, endC: null, unit };
    }
    if (/(at most|or below|below|under|less than|<=)/i.test(combinedText)) {
      return { contractType: "atMost", startC: null, endC: thresholdC, unit };
    }
    if (/exact/i.test(combinedText)) {
      return { contractType: "exact", startC: thresholdC, endC: thresholdC, unit };
    }
  }

  const rangeMatch = combinedText.match(
    /(-?\d+(?:\.\d+)?)\s*(?:°|º|deg(?:ree)?s?)?\s*([cf])?\s*(?:to|-|–|—)\s*(-?\d+(?:\.\d+)?)\s*(?:°|º|deg(?:ree)?s?)?\s*([cf])?/i,
  );
  if (rangeMatch) {
    const explicitUnit = (rangeMatch[2] ?? rangeMatch[4] ?? unit).toUpperCase() as KellyTemperatureUnit;
    const startC = toCelsius(Number.parseFloat(rangeMatch[1] ?? "0"), explicitUnit);
    const endC = toCelsius(Number.parseFloat(rangeMatch[3] ?? "0"), explicitUnit);
    return { contractType: "range", startC: Math.min(startC, endC), endC: Math.max(startC, endC), unit: explicitUnit };
  }

  const singleMatch = combinedText.match(/(-?\d+(?:\.\d+)?)\s*(?:°|º|deg(?:ree)?s?)?\s*([cf])?/i);
  if (singleMatch) {
    const explicitUnit = (singleMatch[2] ?? unit).toUpperCase() as KellyTemperatureUnit;
    const valueC = toCelsius(Number.parseFloat(singleMatch[1] ?? "0"), explicitUnit);
    if (/(at least|or above|above|over|higher|>=)/i.test(combinedText)) {
      return { contractType: "atLeast", startC: valueC, endC: null, unit: explicitUnit };
    }
    if (/(at most|or below|below|under|less than|<=)/i.test(combinedText)) {
      return { contractType: "atMost", startC: null, endC: valueC, unit: explicitUnit };
    }
    if (/exact/i.test(combinedText)) {
      return { contractType: "exact", startC: valueC, endC: valueC, unit: explicitUnit };
    }
  }

  return null;
};

const hasWeatherKeywords = (text: string): boolean =>
  /\b(weather|temperature|high temp|high temperature|daily high|forecast high)\b/i.test(text);

const dateMatches = (location: RegisteredLocation, targetDate: string, raw: Record<string, unknown>, text: string): boolean => {
  const candidateDates = [
    parseString(raw.endDateIso),
    parseString(raw.endDate),
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

  return buildTargetDateTokens(targetDate).some((token) => normalizeText(text).includes(normalizeText(token)));
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

const normalizeCandidate = (
  raw: Record<string, unknown>,
  location: RegisteredLocation,
  targetDate: string,
): PolymarketCandidate | null => {
  const title =
    parseString(raw.question) ??
    parseString(raw.title) ??
    parseString(raw.groupItemTitle) ??
    parseString(raw.name);
  if (!title) {
    return null;
  }

  const eventTitle =
    parseString(raw.eventTitle) ??
    parseString((raw.event as Record<string, unknown> | undefined)?.title);
  const description = parseString(raw.description);
  const combinedText = [title, eventTitle, description].filter(Boolean).join(" ");
  const parsedContract = parseTemperatureContract(raw, combinedText);
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
  const status =
    matchedLocation && matchedDate && weatherKeywords && parsedContract && yesTokenId && noTokenId ? "matched" : "unresolved";

  let exclusionReason: string | null = null;
  if (!matchedLocation) {
    exclusionReason = "Location alias did not match the market text.";
  } else if (!matchedDate) {
    exclusionReason = "Target date could not be confirmed from market metadata.";
  } else if (!weatherKeywords) {
    exclusionReason = "Market text does not look like a weather high-temperature contract.";
  } else if (!parsedContract) {
    exclusionReason = "Temperature bucket could not be parsed into a supported contract type.";
  } else if (!yesTokenId || !noTokenId) {
    exclusionReason = "Polymarket token ids were not available for both outcomes.";
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
    ),
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
  const bestBid = clamp01(parseNumber(bids[0]?.price));
  const bestAsk = clamp01(parseNumber(asks[0]?.price));
  const midpoint =
    bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : (bestAsk ?? bestBid ?? null);

  return {
    tokenId,
    bestBid,
    bestAsk,
    midpoint,
    updatedAt: new Date().toISOString(),
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
    const results = await Promise.all(
      [0, 100].map(async (offset) => {
        const path = `/markets?active=true&closed=false&limit=100&offset=${offset}`;
        return await this.trySearchEndpoint(path);
      }),
    );

    return results.flat();
  }

  async discoverMarkets(location: RegisteredLocation, targetDate: string): Promise<PolymarketDiscoveryResult> {
    const collected = new Map<string, Record<string, unknown>>();

    const searchTerms = buildSearchTerms(location, targetDate).slice(0, POLYMARKET_MAX_SEARCH_TERMS);
    const searchResults = await Promise.all(searchTerms.map(async (term) => ({ term, results: await this.searchMarkets(term) })));

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

    return {
      fetchedAt: new Date().toISOString(),
      candidates,
      sourceLinks: {
        meteoblueWeekUrl: location.weekPageUrl,
        meteoblueMultimodelUrl: location.multimodelPageUrl,
        polymarketSearchUrl: `${this.gammaBaseUrl}/public-search?q=${encodeURIComponent(
          `${location.cityName} weather ${targetDate}`,
        )}`,
        marketUrls: candidates
          .map((candidate) => candidate.marketUrl)
          .filter((value): value is string => Boolean(value))
          .slice(0, 12),
      },
    };
  }

  async fetchOrderBooks(tokenIds: string[]): Promise<Map<string, NormalizedOrderBook>> {
    const uniqueTokenIds = unique(tokenIds.filter(Boolean));
    const entries = await Promise.allSettled(
      uniqueTokenIds.map(async (tokenId) => {
        const payload = await fetchJson<unknown>(toOrderBookUrl(this.clobBaseUrl, tokenId), {
          signal: AbortSignal.timeout(POLYMARKET_DISCOVERY_TIMEOUT_MS),
        });
        return normalizeOrderBook(tokenId, payload);
      }),
    );

    return new Map(
      entries
        .filter((entry): entry is PromiseFulfilledResult<NormalizedOrderBook> => entry.status === "fulfilled")
        .map((entry) => [entry.value.tokenId, entry.value]),
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
        message: "No token ids were available for the matched markets.",
      });
      return {
        close() {},
      };
    }

    const socket = new WebSocket(this.clobWsUrl);
    let closed = false;

    socket.on("open", () => {
      onMessage({
        type: "status",
        generatedAt: new Date().toISOString(),
        state: "connected",
        message: "Connected to Polymarket market feed.",
      });

      socket.send(
        JSON.stringify({
          type: "subscribe",
          channel: "market",
          asset_ids: uniqueTokenIds,
          assets_ids: uniqueTokenIds,
        }),
      );
    });

    socket.on("message", (payload: RawData) => {
      const occurredAt = new Date().toISOString();
      onSignal(occurredAt);

      let parsed: unknown = null;
      try {
        parsed = JSON.parse(payload.toString());
      } catch {
        parsed = null;
      }

      const normalized = JSON.stringify(parsed ?? payload.toString()).toLowerCase();
      if (normalized.includes("error")) {
        onMessage({
          type: "status",
          generatedAt: occurredAt,
          state: "degraded",
          message: "Polymarket market stream reported an upstream error. Falling back to periodic price sync.",
        });
      }
    });

    socket.on("close", () => {
      if (!closed) {
        onMessage({
          type: "status",
          generatedAt: new Date().toISOString(),
          state: "disconnected",
          message: "Polymarket market feed disconnected.",
        });
      }
    });

    socket.on("error", () => {
      onMessage({
        type: "status",
        generatedAt: new Date().toISOString(),
        state: "degraded",
        message: "Polymarket market feed connection failed.",
      });
    });

    return {
      close() {
        closed = true;
        try {
          socket.close();
        } catch {
          // ignore close errors
        }
      },
    };
  }
}

export const buildDiscoveryWarnings = (candidates: PolymarketCandidate[]): string[] => {
  const matchedCount = candidates.filter((candidate) => candidate.parseStatus === "matched").length;
  if (matchedCount > 0) {
    return [];
  }

  if (candidates.length === 0) {
    return ["未找到可解析的 Polymarket 天气高温合约。"];
  }

  return ["已发现候选市场，但未能稳定解析出符合当前地点和日期的温度档位。"];
};
