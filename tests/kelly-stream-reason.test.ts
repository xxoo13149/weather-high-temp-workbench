import { afterEach, describe, expect, test, vi } from "vitest";

import type { KellyMarketRow, KellyStreamMessage, KellyWorkbenchResponse } from "../src/domain/weather.js";
import { MeteoblueWeatherService } from "../src/providers/meteoblue/service.js";

const baseLocation = {
  id: "miami_mia",
  name: "Miami International Airport",
  timezone: "America/New_York",
} as const;

const buildMatchedMarket = (overrides: Partial<KellyMarketRow> = {}): KellyMarketRow =>
  ({
    marketId: "market-1",
    slug: "market-1",
    title: "Will the high temperature be at least 21C?",
    marketUrl: "https://example.com/market-1",
    conditionId: "condition-1",
    liquidity: 1000,
    volume24h: 500,
    contractType: "atLeast",
    unit: "C",
    bucketStartC: 21,
    bucketEndC: null,
    bucketLabel: ">= 21C",
    lifecycle: "tradable",
    inactiveReason: null,
    parseStatus: "matched",
    exclusionReason: null,
    yesTokenId: "yes-1",
    noTokenId: "no-1",
    entrySourceYes: "best-ask",
    entrySourceNo: "best-ask",
    yesPrice: 0.42,
    noPrice: 0.58,
    yesBestBid: 0.41,
    yesBestAsk: 0.42,
    noBestBid: 0.57,
    noBestAsk: 0.58,
    spreadPct: 0.01,
    rawProbabilityYes: 0.55,
    rawProbabilityNo: 0.45,
    fairYes: 0.55,
    fairNo: 0.45,
    edgeYes: 0.13,
    edgeNo: -0.13,
    kellyYes: 0.1,
    kellyNo: 0,
    recommendedSide: "yes",
    suggestedStake: 100,
    updatedAt: "2026-03-28T00:00:00.000Z",
    ...overrides,
  }) satisfies KellyMarketRow;

const buildOrderBook = (tokenId: string, bestBid: number, bestAsk: number, updatedAt = "2026-03-28T00:00:00.000Z") => ({
  tokenId,
  bestBid,
  bestAsk,
  midpoint: (bestBid + bestAsk) / 2,
  updatedAt,
  status: "available" as const,
});

const buildSnapshot = (markets: KellyMarketRow[]): KellyWorkbenchResponse =>
  ({
    location: baseLocation,
    targetDate: "2026-03-28",
    displayUnit: "C",
    availableTargetDates: ["2026-03-28"],
    generatedAt: "2026-03-28T00:00:00.000Z",
    bankroll: 1000,
    riskMode: "balanced",
    riskMultiplier: 0.5,
    minEdge: 0.02,
    weatherEvidence: {} as KellyWorkbenchResponse["weatherEvidence"],
    distributionSummary: {
      meanTemperatureC: 22,
      medianTemperatureC: 22,
      modeTemperatureC: 22,
      mostLikelyRangeLabel: "22C",
      shrink: 0.86,
      usableModelCount: 1,
      totalModelCount: 1,
      peakSpreadC: 0.5,
    },
    probabilityCurve: [
      { temperatureC: 20, density: 3, cumulative: 0.3 },
      { temperatureC: 21, density: 3, cumulative: 0.6 },
      { temperatureC: 22, density: 2, cumulative: 0.8 },
      { temperatureC: 23, density: 2, cumulative: 1 },
    ],
    bucketProbabilities: [],
    markets,
    inactiveMarkets: [],
    recommendations: [],
    bestObservation: null,
    unresolvedMarkets: [],
    marketEvidence: [],
    methodology: {} as KellyWorkbenchResponse["methodology"],
    frameSeries: [],
    sourceLinks: {
      meteoblueWeekUrl: "https://example.com/week",
      meteoblueMultimodelUrl: "https://example.com/multimodel",
      polymarketSearchUrl: "https://example.com/search",
      marketUrls: [],
    },
    freshness: {
      weatherGeneratedAt: null,
      marketDiscoveredAt: null,
      orderbookFetchedAt: null,
      repricedAt: null,
      lastStreamEventAt: null,
      marketMotionState: "unavailable",
    },
    streamHealth: {
      state: "unavailable",
      reasonCode: "snapshot_loaded",
      message: "snapshot",
      lastSignalAt: null,
      lastRepricedAt: null,
    },
    sourceStatus: [],
    warnings: [],
  }) satisfies KellyWorkbenchResponse;

const mockStreamWeatherDependencies = (
  service: MeteoblueWeatherService,
  overrides?: {
    hourlyTemperatureC?: number;
    metarTemperatureC?: number | null;
    hourlyTimestamp?: string;
    metarObservedAt?: string;
  },
) => {
  const hourlyTemperatureC = overrides?.hourlyTemperatureC ?? 22;
  const metarTemperatureC = overrides?.metarTemperatureC ?? hourlyTemperatureC;
  const hourlyTimestamp = overrides?.hourlyTimestamp ?? "2026-03-28T16:00:00-04:00";
  const metarObservedAt = overrides?.metarObservedAt ?? "2026-03-28T16:05:00-04:00";

  vi.spyOn(service, "getHourly").mockResolvedValue({
    location: baseLocation,
    pageUrl: "https://example.com/week",
    mode: "1h",
    sourceType: "week-table-1h",
    fetchedAt: "2026-03-28T20:00:00.000Z",
    sourceObservedAt: "2026-03-28T20:00:00.000Z",
    stale: false,
    cacheHit: true,
    partial: false,
    warnings: [],
    current: {
      timestamp: hourlyTimestamp,
      temperatureC: hourlyTemperatureC,
      index: 0,
    },
    items: [
      {
        timestamp: hourlyTimestamp,
        temperatureC: hourlyTemperatureC,
        apparentTemperatureC: hourlyTemperatureC,
        precipitationProbability: 0,
        relativeHumidity: 0.6,
        windSpeedKph: 10,
        weatherCode: null,
        icon: null,
      },
    ],
  } as any);

  vi.spyOn(service as any, "getMetarCache").mockReturnValue({
    get: vi.fn().mockResolvedValue({
      value: {
        observation:
          metarTemperatureC === null
            ? null
            : {
                location: baseLocation,
                stationId: "KMIA",
                observedAt: metarObservedAt,
                temperatureC: metarTemperatureC,
                dewpointC: 12,
                windDirectionDegrees: 130,
                windSpeedKts: 11,
                rawReport: "METAR KMIA latest",
                stationName: "Miami Intl",
                sourceUrl: "https://example.com/metar",
                fetchedAt: "2026-03-28T20:05:00.000Z",
              },
        recentTemperatures: [],
      },
      stale: false,
      cacheHit: true,
    }),
  });

  vi.spyOn(service, "getMultiModelInsight").mockRejectedValue(new Error("skip insight refresh in stream test"));
};

const closeKellyStream = async (handle: { close: () => Promise<void> | void }) => {
  const wasUsingFakeTimers = vi.isFakeTimers();
  if (!wasUsingFakeTimers) {
    vi.useFakeTimers();
  }

  await handle.close();
  await vi.advanceTimersByTimeAsync(90_000);

  if (!wasUsingFakeTimers) {
    vi.useRealTimers();
  }
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MeteoblueWeatherService.createKellyStream reason codes", () => {
  test("keeps cached token books when an orderbook refresh only resolves a subset of tokens", async () => {
    const service = new MeteoblueWeatherService();
    const cache = (service as any).getKellyOrderBookCache("miami_mia", "2026-03-28");
    const previousBooks = new Map([
      ["yes-1", buildOrderBook("yes-1", 0.41, 0.42, "2026-03-28T00:00:00.000Z")],
      ["no-1", buildOrderBook("no-1", 0.57, 0.58, "2026-03-28T00:00:00.000Z")],
      ["yes-2", buildOrderBook("yes-2", 0.36, 0.37, "2026-03-28T00:00:00.000Z")],
      ["no-2", buildOrderBook("no-2", 0.63, 0.64, "2026-03-28T00:00:00.000Z")],
    ]);

    (cache as any).entry = {
      value: previousBooks,
      storedAt: new Date("2026-03-28T00:00:00.000Z"),
      expiresAt: Date.now() - 1,
    };

    vi.spyOn(service as any, "getKellyMarketCache").mockReturnValue({
      get: vi.fn().mockResolvedValue({
        value: {
          fetchedAt: "2026-03-28T00:00:00.000Z",
          candidates: [
            { parseStatus: "matched", yesTokenId: "yes-1", noTokenId: "no-1" },
            { parseStatus: "matched", yesTokenId: "yes-2", noTokenId: "no-2" },
          ],
          inactiveCandidates: [],
          sourceLinks: {},
        },
        stale: false,
        cacheHit: false,
        freshness: "fresh",
      }),
    });

    const client = (service as any).polymarketClient as {
      fetchOrderBooks: (...args: unknown[]) => Promise<Map<string, ReturnType<typeof buildOrderBook>>>;
    };
    vi.spyOn(client, "fetchOrderBooks").mockResolvedValue(
      new Map([
        ["yes-1", buildOrderBook("yes-1", 0.43, 0.44, "2026-03-28T00:05:00.000Z")],
        ["no-1", buildOrderBook("no-1", 0.55, 0.56, "2026-03-28T00:05:00.000Z")],
      ]),
    );

    const result = await cache.get();

    expect(result.value).toEqual(
      new Map([
        ["yes-1", buildOrderBook("yes-1", 0.43, 0.44, "2026-03-28T00:05:00.000Z")],
        ["no-1", buildOrderBook("no-1", 0.55, 0.56, "2026-03-28T00:05:00.000Z")],
        ["yes-2", buildOrderBook("yes-2", 0.36, 0.37, "2026-03-28T00:00:00.000Z")],
        ["no-2", buildOrderBook("no-2", 0.63, 0.64, "2026-03-28T00:00:00.000Z")],
      ]),
    );
  });

  test("emits no_matched_markets when no subscribable market remains", async () => {
    const service = new MeteoblueWeatherService();
    vi.spyOn(service, "getKellyWorkbench").mockResolvedValue(buildSnapshot([]));

    const messages: KellyStreamMessage[] = [];
    const handle = await service.createKellyStream("miami_mia", { targetDate: "2026-03-28" }, (message) => {
      messages.push(message);
    });

    expect(messages).toEqual([
      expect.objectContaining({
        type: "status",
        state: "unavailable",
        reasonCode: "no_matched_markets",
      }),
    ]);

    await closeKellyStream(handle);
  });

  test("releases bootstrap subscriber state when stream initialization throws", async () => {
    vi.useFakeTimers();
    const service = new MeteoblueWeatherService();
    vi.spyOn(service, "getKellyWorkbench").mockResolvedValue(buildSnapshot([buildMatchedMarket()]));
    vi.spyOn(service as any, "ensureKellyStreamHubUpstream").mockRejectedValue(new Error("bootstrap failure"));

    await expect(service.createKellyStream("miami_mia", { targetDate: "2026-03-28" }, () => {})).rejects.toThrow(
      "bootstrap failure",
    );
    expect(service.getKellyRuntimeHealth()).toEqual(
      expect.objectContaining({
        openStreamCount: 0,
        activeHubCount: 1,
      }),
    );

    await vi.advanceTimersByTimeAsync(90_000);
    expect(service.getKellyRuntimeHealth()).toEqual(
      expect.objectContaining({
        openStreamCount: 0,
        activeHubCount: 0,
      }),
    );
    vi.useRealTimers();
  });

  test("reprices stream against the snapshot-resolved targetDate", async () => {
    const service = new MeteoblueWeatherService();
    const snapshot = buildSnapshot([buildMatchedMarket()]);
    snapshot.targetDate = "2026-03-27";
    snapshot.availableTargetDates = ["2026-03-27", "2026-03-28"];
    snapshot.freshness.repricedAt = "2026-03-27T10:00:00.000Z";
    vi.spyOn(service, "getKellyWorkbench").mockResolvedValue(snapshot);

    const repriceSpy = vi.spyOn(service as any, "repriceKellyStreamSnapshot").mockResolvedValue({
      books: new Map(),
      framePoints: [],
      generatedAt: "2026-03-27T10:01:00.000Z",
      orderbookObservedAt: "2026-03-27T10:01:00.000Z",
      repricedAt: "2026-03-27T10:01:00.000Z",
      repricedMarkets: [buildMatchedMarket({ updatedAt: "2026-03-27T10:01:00.000Z" })],
    });

    const client = (service as any).polymarketClient as {
      createMarketStream: (...args: unknown[]) => { close: () => void | Promise<void> };
    };
    const upstreamClose = vi.fn();
    vi.spyOn(client, "createMarketStream").mockReturnValue({
      close: upstreamClose,
    });
    vi.spyOn(service as any, "fetchFreshKellyOrderBooks").mockResolvedValue(
      new Map([
        ["yes-1", buildOrderBook("yes-1", 0.41, 0.42, "2026-03-27T10:01:00.000Z")],
        ["no-1", buildOrderBook("no-1", 0.57, 0.58, "2026-03-27T10:01:00.000Z")],
      ]),
    );

    const messages: KellyStreamMessage[] = [];
    const handle = await service.createKellyStream("miami_mia", { targetDate: "2026-03-28" }, (message) => {
      messages.push(message);
    });

    expect(repriceSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        targetDate: "2026-03-27",
        options: expect.objectContaining({
          targetDate: "2026-03-27",
        }),
      }),
    );
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "markets",
          lastRepricedAt: "2026-03-27T10:01:00.000Z",
        }),
      ]),
    );

    await closeKellyStream(handle);
    expect(upstreamClose).toHaveBeenCalledTimes(1);
  });

  test("emits reprice_failed and polling_fallback when the first repricing fails", async () => {
    const service = new MeteoblueWeatherService();
    vi.spyOn(service, "getKellyWorkbench").mockResolvedValue(buildSnapshot([buildMatchedMarket()]));
    mockStreamWeatherDependencies(service);

    const client = (service as any).polymarketClient as {
      createMarketStream: (...args: unknown[]) => { close: () => void | Promise<void> };
      fetchOrderBooks: (...args: unknown[]) => Promise<unknown>;
    };
    const upstreamClose = vi.fn();

    vi.spyOn(client, "createMarketStream").mockReturnValue({
      close: upstreamClose,
    });
    vi.spyOn(client, "fetchOrderBooks").mockRejectedValue(new Error("boom"));

    const messages: KellyStreamMessage[] = [];
    const handle = await service.createKellyStream("miami_mia", { targetDate: "2026-03-28" }, (message) => {
      messages.push(message);
    });

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "status",
          state: "degraded",
          reasonCode: "polling_fallback",
        }),
        expect.objectContaining({
          type: "status",
          state: "degraded",
          reasonCode: "reprice_failed",
        }),
      ]),
    );

    await closeKellyStream(handle);
    expect(upstreamClose).toHaveBeenCalledTimes(1);
  });

  test("reuses retained orderbooks when the live refresh fails but cached coverage is complete", async () => {
    const service = new MeteoblueWeatherService();
    vi.spyOn(service, "getKellyWorkbench").mockResolvedValue(buildSnapshot([buildMatchedMarket()]));
    mockStreamWeatherDependencies(service);

    const cache = (service as any).getKellyOrderBookCache("miami_mia", "2026-03-28");
    (cache as any).entry = {
      value: new Map([
        ["yes-1", buildOrderBook("yes-1", 0.41, 0.42, "2026-03-28T00:00:00.000Z")],
        ["no-1", buildOrderBook("no-1", 0.57, 0.58, "2026-03-28T00:00:00.000Z")],
      ]),
      storedAt: new Date("2026-03-28T00:00:00.000Z"),
      expiresAt: Date.now() + 60_000,
    };

    const client = (service as any).polymarketClient as {
      createMarketStream: (...args: unknown[]) => { close: () => void | Promise<void> };
      fetchOrderBooks: (...args: unknown[]) => Promise<unknown>;
    };
    const upstreamClose = vi.fn();
    vi.spyOn(client, "createMarketStream").mockReturnValue({
      close: upstreamClose,
    });
    vi.spyOn(client, "fetchOrderBooks").mockRejectedValue(new Error("orderbook timeout"));

    const messages: KellyStreamMessage[] = [];
    const handle = await service.createKellyStream("miami_mia", { targetDate: "2026-03-28" }, (message) => {
      messages.push(message);
    });

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "markets",
          markets: [expect.objectContaining({ marketId: "market-1" })],
          lastRepricedAt: expect.any(String),
        }),
      ]),
    );
    expect(messages.some((message) => message.type === "status" && message.reasonCode === "reprice_failed")).toBe(false);
    expect(messages.some((message) => message.type === "status" && message.reasonCode === "polling_fallback")).toBe(false);
    expect(service.getKellyRuntimeHealth()).toEqual(
      expect.objectContaining({
        lastOrderbookAttemptAt: expect.any(String),
        lastOrderbookFailureAt: expect.any(String),
        lastOrderbookFailureCode: "Error",
      }),
    );

    await closeKellyStream(handle);
    expect(upstreamClose).toHaveBeenCalledTimes(1);
  });

  test("continues repricing with retained orderbooks when a later live refresh fails", async () => {
    vi.useFakeTimers();
    const service = new MeteoblueWeatherService();
    vi.spyOn(service, "getKellyWorkbench").mockResolvedValue(buildSnapshot([buildMatchedMarket()]));
    mockStreamWeatherDependencies(service);

    const client = (service as any).polymarketClient as {
      createMarketStream: (
        ...args: unknown[]
      ) => { close: () => void | Promise<void> };
      fetchOrderBooks: (...args: unknown[]) => Promise<unknown>;
    };
    const upstreamClose = vi.fn();
    let upstreamOnSignal: ((occurredAt: string) => void) | null = null;

    vi.spyOn(client, "createMarketStream").mockImplementation((_tokenIds, _onMessage, onSignal) => {
      upstreamOnSignal = onSignal as (occurredAt: string) => void;
      return {
        close: upstreamClose,
      };
    });
    vi.spyOn(client, "fetchOrderBooks")
      .mockResolvedValueOnce(
        new Map([
          ["yes-1", buildOrderBook("yes-1", 0.41, 0.42)],
          ["no-1", buildOrderBook("no-1", 0.57, 0.58)],
        ]),
      )
      .mockRejectedValueOnce(new Error("boom"));

    const messages: KellyStreamMessage[] = [];
    const handle = await service.createKellyStream("miami_mia", { targetDate: "2026-03-28" }, (message) => {
      messages.push(message);
    });

    messages.length = 0;
    if (!upstreamOnSignal) {
      throw new Error("Expected upstream signal callback to be captured.");
    }

    (upstreamOnSignal as (occurredAt: string) => void)("2026-03-28T00:02:00.000Z");
    await vi.advanceTimersByTimeAsync(1_000);

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "markets",
          lastSignalAt: "2026-03-28T00:02:00.000Z",
          lastRepricedAt: expect.any(String),
          markets: [expect.objectContaining({ marketId: "market-1" })],
        }),
      ]),
    );
    expect(messages.some((message) => message.type === "status" && message.reasonCode === "reprice_failed")).toBe(false);
    expect(messages.some((message) => message.type === "status" && message.reasonCode === "polling_fallback")).toBe(false);
    expect(service.getKellyRuntimeHealth()).toEqual(
      expect.objectContaining({
        lastOrderbookFailureAt: expect.any(String),
        lastOrderbookFailureCode: "Error",
      }),
    );

    await closeKellyStream(handle);
    expect(upstreamClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  test("subscribes all matched markets with tokens, including inactive rows", async () => {
    const service = new MeteoblueWeatherService();
    mockStreamWeatherDependencies(service);
    const inactiveMatched = {
      ...buildMatchedMarket(),
      marketId: "market-inactive",
      slug: "market-inactive",
      lifecycle: "inactive",
      inactiveReason: "expired",
      yesTokenId: "yes-inactive",
      noTokenId: "no-inactive",
    } satisfies KellyMarketRow;

    vi.spyOn(service, "getKellyWorkbench").mockResolvedValue({
      ...buildSnapshot([buildMatchedMarket()]),
      inactiveMarkets: [inactiveMatched],
    });

    const client = (service as any).polymarketClient as {
      createMarketStream: (...args: unknown[]) => { close: () => void | Promise<void> };
      fetchOrderBooks: (...args: unknown[]) => Promise<unknown>;
    };
    const upstreamClose = vi.fn();
    const createStreamSpy = vi.spyOn(client, "createMarketStream").mockReturnValue({
      close: upstreamClose,
    });
    vi.spyOn(client, "fetchOrderBooks").mockResolvedValue(
      new Map([
        ["yes-1", { tokenId: "yes-1", bestBid: 0.41, bestAsk: 0.42, midpoint: 0.415, spread: 0.01, updatedAt: "2026-03-28T00:00:00.000Z" }],
        ["no-1", { tokenId: "no-1", bestBid: 0.57, bestAsk: 0.58, midpoint: 0.575, spread: 0.01, updatedAt: "2026-03-28T00:00:00.000Z" }],
      ]),
    );

    const handle = await service.createKellyStream("miami_mia", { targetDate: "2026-03-28" }, () => {});

    expect(createStreamSpy).toHaveBeenCalledWith(
      ["yes-1", "no-1", "yes-inactive", "no-inactive"],
      expect.any(Function),
      expect.any(Function),
    );

    await closeKellyStream(handle);
    expect(upstreamClose).toHaveBeenCalledTimes(1);
  });

  test("reuses one upstream Polymarket stream for subscribers sharing the same location and targetDate", async () => {
    vi.useFakeTimers();
    const service = new MeteoblueWeatherService();
    vi.spyOn(service, "getKellyWorkbench").mockImplementation(async (_locationId, options) => ({
      ...buildSnapshot([buildMatchedMarket()]),
      bankroll: options?.bankroll ?? 1_000,
      riskMode: (options?.riskMode as KellyWorkbenchResponse["riskMode"]) ?? "balanced",
      minEdge: options?.minEdge ?? 0.02,
    }));

    const client = (service as any).polymarketClient as {
      createMarketStream: (...args: unknown[]) => { close: () => void | Promise<void> };
    };
    const upstreamClose = vi.fn();
    const createStreamSpy = vi.spyOn(client, "createMarketStream").mockReturnValue({
      close: upstreamClose,
    });
    vi.spyOn(service as any, "fetchFreshKellyOrderBooks").mockResolvedValue(
      new Map([
        ["yes-1", buildOrderBook("yes-1", 0.41, 0.42)],
        ["no-1", buildOrderBook("no-1", 0.57, 0.58)],
      ]),
    );
    vi.spyOn(service as any, "repriceKellyStreamSnapshot").mockImplementation(async (input: any) => ({
      books: new Map(),
      framePoints: [],
      generatedAt: `2026-03-28T00:00:0${input.bankroll === 1_000 ? "1" : "2"}.000Z`,
      orderbookObservedAt: "2026-03-28T00:00:00.000Z",
      repricedAt: `2026-03-28T00:00:0${input.bankroll === 1_000 ? "1" : "2"}.000Z`,
      repricedMarkets: [
        buildMatchedMarket({
          suggestedStake: input.bankroll,
          updatedAt: `2026-03-28T00:00:0${input.bankroll === 1_000 ? "1" : "2"}.000Z`,
        }),
      ],
    }));

    const firstMessages: KellyStreamMessage[] = [];
    const secondMessages: KellyStreamMessage[] = [];
    const first = await service.createKellyStream("miami_mia", { targetDate: "2026-03-28", bankroll: 1_000 }, (message) => {
      firstMessages.push(message);
    });
    const second = await service.createKellyStream("miami_mia", { targetDate: "2026-03-28", bankroll: 2_000 }, (message) => {
      secondMessages.push(message);
    });

    expect(createStreamSpy).toHaveBeenCalledTimes(1);
    expect(firstMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "markets",
          markets: [expect.objectContaining({ suggestedStake: 1_000 })],
        }),
      ]),
    );
    expect(secondMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "markets",
          markets: [expect.objectContaining({ suggestedStake: 2_000 })],
        }),
      ]),
    );

    await closeKellyStream(first);
    await closeKellyStream(second);
    expect(upstreamClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  test("re-emits the retained market patch when a later repricing fails", async () => {
    vi.useFakeTimers();
    const service = new MeteoblueWeatherService();
    vi.spyOn(service, "getKellyWorkbench").mockResolvedValue(buildSnapshot([buildMatchedMarket()]));

    const client = (service as any).polymarketClient as {
      createMarketStream: (
        tokenIds: string[],
        onMessage: (message: KellyStreamMessage) => void,
        onSignal: (occurredAt: string) => void,
      ) => { close: () => void | Promise<void> };
    };
    const upstreamClose = vi.fn();
    let triggerSignal: ((occurredAt: string) => void) | null = null;
    vi.spyOn(client, "createMarketStream").mockImplementation((_tokenIds, _onMessage, onSignal) => {
      triggerSignal = onSignal;
      return {
        close: upstreamClose,
      };
    });
    vi.spyOn(service as any, "fetchFreshKellyOrderBooks").mockResolvedValue(
      new Map([
        ["yes-1", buildOrderBook("yes-1", 0.41, 0.42)],
        ["no-1", buildOrderBook("no-1", 0.57, 0.58)],
      ]),
    );
    vi.spyOn(service as any, "repriceKellyStreamSnapshot")
      .mockResolvedValueOnce({
        books: new Map(),
        framePoints: [],
        generatedAt: "2026-03-28T00:00:01.000Z",
        orderbookObservedAt: "2026-03-28T00:00:01.000Z",
        repricedAt: "2026-03-28T00:00:01.000Z",
        repricedMarkets: [
          buildMatchedMarket({
            suggestedStake: 111,
            updatedAt: "2026-03-28T00:00:01.000Z",
          }),
        ],
      })
      .mockRejectedValueOnce(new Error("reprice failed"));

    const messages: KellyStreamMessage[] = [];
    const handle = await service.createKellyStream("miami_mia", { targetDate: "2026-03-28" }, (message) => {
      messages.push(message);
    });

    const signal =
      triggerSignal ??
      ((_occurredAt: string) => {
        throw new Error("Expected upstream signal callback to be captured.");
      });
    signal("2026-03-28T00:00:05.000Z");
    await vi.advanceTimersByTimeAsync(750);

    const marketMessages = messages.filter((message) => message.type === "markets");
    expect(marketMessages.length).toBeGreaterThanOrEqual(3);
    expect(marketMessages.at(-1)).toMatchObject({
      type: "markets",
      lastSignalAt: "2026-03-28T00:00:05.000Z",
      lastRepricedAt: "2026-03-28T00:00:01.000Z",
      markets: [expect.objectContaining({ suggestedStake: 111 })],
    });
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "status",
          reasonCode: "reprice_failed",
          message: expect.stringContaining("沿用上一轮结果"),
        }),
      ]),
    );

    await closeKellyStream(handle);
    expect(upstreamClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  test("keeps tradable rows when live repricing only refreshes a subset of cached token books", async () => {
    const service = new MeteoblueWeatherService();
    mockStreamWeatherDependencies(service);
    const secondMarket = buildMatchedMarket({
      marketId: "market-2",
      slug: "market-2",
      title: "Will the high temperature be at least 22C?",
      conditionId: "condition-2",
      bucketStartC: 22,
      bucketLabel: ">= 22C",
      yesTokenId: "yes-2",
      noTokenId: "no-2",
      yesPrice: 0.37,
      noPrice: 0.63,
      yesBestBid: 0.36,
      yesBestAsk: 0.37,
      noBestBid: 0.62,
      noBestAsk: 0.63,
      fairYes: 0.54,
      fairNo: 0.46,
      rawProbabilityYes: 0.54,
      rawProbabilityNo: 0.46,
      edgeYes: 0.17,
      edgeNo: -0.17,
      kellyYes: 0.09,
      suggestedStake: 90,
      updatedAt: "2026-03-28T00:00:00.000Z",
    });
    vi.spyOn(service, "getKellyWorkbench").mockResolvedValue(buildSnapshot([buildMatchedMarket(), secondMarket]));

    const cache = (service as any).getKellyOrderBookCache("miami_mia", "2026-03-28");
    (cache as any).entry = {
      value: new Map([
        ["yes-1", buildOrderBook("yes-1", 0.41, 0.42)],
        ["no-1", buildOrderBook("no-1", 0.57, 0.58)],
        ["yes-2", buildOrderBook("yes-2", 0.36, 0.37)],
        ["no-2", buildOrderBook("no-2", 0.62, 0.63)],
      ]),
      storedAt: new Date("2026-03-28T00:00:00.000Z"),
      expiresAt: Date.now() + 60_000,
    };

    const client = (service as any).polymarketClient as {
      createMarketStream: (...args: unknown[]) => { close: () => void | Promise<void> };
      fetchOrderBooks: (...args: unknown[]) => Promise<unknown>;
    };
    const upstreamClose = vi.fn();

    vi.spyOn(client, "createMarketStream").mockReturnValue({
      close: upstreamClose,
    });
    vi.spyOn(client, "fetchOrderBooks").mockResolvedValue(
      new Map([
        ["yes-1", buildOrderBook("yes-1", 0.43, 0.44, "2026-03-28T00:05:00.000Z")],
        ["no-1", buildOrderBook("no-1", 0.55, 0.56, "2026-03-28T00:05:00.000Z")],
      ]),
    );

    const messages: KellyStreamMessage[] = [];
    const handle = await service.createKellyStream("miami_mia", { targetDate: "2026-03-28" }, (message) => {
      messages.push(message);
    });

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "markets",
          markets: expect.arrayContaining([
            expect.objectContaining({
              marketId: "market-1",
              lifecycle: "tradable",
            }),
            expect.objectContaining({
              marketId: "market-2",
              lifecycle: "tradable",
            }),
          ]),
        }),
      ]),
    );
    expect(messages.some((message) => message.type === "status" && message.reasonCode === "reprice_failed")).toBe(false);

    await closeKellyStream(handle);
    expect(upstreamClose).toHaveBeenCalledTimes(1);
  });

  test("emits no_recent_market_motion while a connected realtime stream stays idle", async () => {
    vi.useFakeTimers();
    const service = new MeteoblueWeatherService();
    vi.spyOn(service, "getKellyWorkbench").mockResolvedValue(buildSnapshot([buildMatchedMarket()]));
    mockStreamWeatherDependencies(service);

    const client = (service as any).polymarketClient as {
      createMarketStream: (...args: unknown[]) => { close: () => void | Promise<void> };
      fetchOrderBooks: (...args: unknown[]) => Promise<unknown>;
    };
    const upstreamClose = vi.fn();

    vi.spyOn(client, "createMarketStream").mockImplementation((_tokenIds, onMessage) => {
      (onMessage as (message: KellyStreamMessage) => void)({
        type: "status",
        generatedAt: "2026-03-28T00:00:00.000Z",
        state: "connected",
        reasonCode: "ws_connected",
        message: "connected",
      });
      return {
        close: upstreamClose,
      };
    });
    vi.spyOn(client, "fetchOrderBooks").mockResolvedValue(
      new Map([
        ["yes-1", { tokenId: "yes-1", bestBid: 0.41, bestAsk: 0.42, midpoint: 0.415, spread: 0.01, updatedAt: "2026-03-28T00:00:00.000Z" }],
        ["no-1", { tokenId: "no-1", bestBid: 0.57, bestAsk: 0.58, midpoint: 0.575, spread: 0.01, updatedAt: "2026-03-28T00:00:00.000Z" }],
      ]),
    );

    const messages: KellyStreamMessage[] = [];
    const handle = await service.createKellyStream("miami_mia", { targetDate: "2026-03-28" }, (message) => {
      messages.push(message);
    });

    messages.length = 0;
    await vi.advanceTimersByTimeAsync(21_000);

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "status",
          state: "connected",
          reasonCode: "no_recent_market_motion",
        }),
      ]),
    );
    expect(messages.some((message) => message.type === "status" && message.reasonCode === "polling_fallback")).toBe(false);

    await closeKellyStream(handle);
    expect(upstreamClose).toHaveBeenCalledTimes(1);
  });

  test("emits the snapshot market patch before the first live repricing finishes", async () => {
    const service = new MeteoblueWeatherService();
    const snapshot = buildSnapshot([buildMatchedMarket()]);
    snapshot.freshness.repricedAt = "2026-03-28T00:00:00.000Z";
    vi.spyOn(service, "getKellyWorkbench").mockResolvedValue(snapshot);
    mockStreamWeatherDependencies(service);

    const client = (service as any).polymarketClient as {
      createMarketStream: (...args: unknown[]) => { close: () => void | Promise<void> };
      fetchOrderBooks: (...args: unknown[]) => Promise<unknown>;
    };
    const upstreamClose = vi.fn();
    let resolveBooks: ((value: Map<string, ReturnType<typeof buildOrderBook>>) => void) | null = null;
    const pendingBooks = new Promise<Map<string, ReturnType<typeof buildOrderBook>>>((resolve) => {
      resolveBooks = resolve;
    });

    vi.spyOn(client, "createMarketStream").mockReturnValue({
      close: upstreamClose,
    });
    vi.spyOn(client, "fetchOrderBooks").mockReturnValue(pendingBooks);

    const messages: KellyStreamMessage[] = [];
    const handlePromise = service.createKellyStream("miami_mia", { targetDate: "2026-03-28" }, (message) => {
      messages.push(message);
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(messages).toEqual([
      expect.objectContaining({
        type: "markets",
        generatedAt: snapshot.generatedAt,
        lastSignalAt: null,
        lastRepricedAt: "2026-03-28T00:00:00.000Z",
        markets: [expect.objectContaining({ marketId: "market-1" })],
        frames: snapshot.frameSeries,
      }),
    ]);

    const finishBooks =
      resolveBooks ??
      ((_value: Map<string, ReturnType<typeof buildOrderBook>>) => {
        throw new Error("Expected orderbook promise resolver to be captured.");
      });
    finishBooks(
      new Map([
        ["yes-1", buildOrderBook("yes-1", 0.41, 0.42)],
        ["no-1", buildOrderBook("no-1", 0.57, 0.58)],
      ]),
    );

    const handle = await handlePromise;
    await closeKellyStream(handle);
    expect(upstreamClose).toHaveBeenCalledTimes(1);
  });

  test("emits market patches without repeating ws_connected after every repricing", async () => {
    vi.useFakeTimers();
    const service = new MeteoblueWeatherService();
    vi.spyOn(service, "getKellyWorkbench").mockResolvedValue(buildSnapshot([buildMatchedMarket()]));
    mockStreamWeatherDependencies(service);

    const client = (service as any).polymarketClient as {
      createMarketStream: (
        ...args: unknown[]
      ) => { close: () => void | Promise<void> };
      fetchOrderBooks: (...args: unknown[]) => Promise<unknown>;
    };
    const upstreamClose = vi.fn();
    let upstreamOnSignal: ((occurredAt: string) => void) | null = null;

    vi.spyOn(client, "createMarketStream").mockImplementation((_tokenIds, _onMessage, onSignal) => {
      upstreamOnSignal = onSignal as (occurredAt: string) => void;
      return {
        close: upstreamClose,
      };
    });
    vi.spyOn(client, "fetchOrderBooks").mockResolvedValue(
      new Map([
        ["yes-1", { tokenId: "yes-1", bestBid: 0.41, bestAsk: 0.42, midpoint: 0.415, spread: 0.01, updatedAt: "2026-03-28T00:00:00.000Z" }],
        ["no-1", { tokenId: "no-1", bestBid: 0.57, bestAsk: 0.58, midpoint: 0.575, spread: 0.01, updatedAt: "2026-03-28T00:00:00.000Z" }],
      ]),
    );

    const messages: KellyStreamMessage[] = [];
    const handle = await service.createKellyStream("miami_mia", { targetDate: "2026-03-28" }, (message) => {
      messages.push(message);
    });

    messages.length = 0;
    const triggerSignal = upstreamOnSignal;
    if (!triggerSignal) {
      throw new Error("Expected upstream signal callback to be captured.");
    }

    (triggerSignal as (occurredAt: string) => void)("2026-03-28T00:02:00.000Z");
    await vi.advanceTimersByTimeAsync(1_000);

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "markets",
        }),
      ]),
    );
    expect(messages.some((message) => message.type === "status" && message.reasonCode === "ws_connected")).toBe(false);

    await closeKellyStream(handle);
    expect(upstreamClose).toHaveBeenCalledTimes(1);
  });

  test("reuses cached multimodel context across rapid Kelly reprices", async () => {
    vi.useFakeTimers();
    const service = new MeteoblueWeatherService();
    const snapshot = buildSnapshot([buildMatchedMarket()]);
    vi.spyOn(service, "getKellyWorkbench").mockResolvedValue(snapshot);
    mockStreamWeatherDependencies(service);

    (service as any).writeKellyStreamModelContext(
      "miami_mia::2026-03-28::1000::balanced::0.02::default-temp::default-hour",
      snapshot.probabilityCurve,
      snapshot.distributionSummary.shrink,
    );

    const insightSpy = vi.spyOn(service, "getMultiModelInsight");
    const distributionSpy = vi.spyOn(service, "getMultiModelDistribution");
    const client = (service as any).polymarketClient as {
      createMarketStream: (
        ...args: unknown[]
      ) => { close: () => void | Promise<void> };
      fetchOrderBooks: (...args: unknown[]) => Promise<unknown>;
    };
    const upstreamClose = vi.fn();
    let upstreamOnSignal: ((occurredAt: string) => void) | null = null;

    vi.spyOn(client, "createMarketStream").mockImplementation((_tokenIds, _onMessage, onSignal) => {
      upstreamOnSignal = onSignal as (occurredAt: string) => void;
      return {
        close: upstreamClose,
      };
    });
    vi.spyOn(client, "fetchOrderBooks").mockResolvedValue(
      new Map([
        ["yes-1", { tokenId: "yes-1", bestBid: 0.41, bestAsk: 0.42, midpoint: 0.415, spread: 0.01, updatedAt: "2026-03-28T00:00:00.000Z" }],
        ["no-1", { tokenId: "no-1", bestBid: 0.57, bestAsk: 0.58, midpoint: 0.575, spread: 0.01, updatedAt: "2026-03-28T00:00:00.000Z" }],
      ]),
    );

    const handle = await service.createKellyStream("miami_mia", { targetDate: "2026-03-28" }, () => {});

    if (!upstreamOnSignal) {
      throw new Error("Expected upstream signal callback to be captured.");
    }

    (upstreamOnSignal as (occurredAt: string) => void)("2026-03-28T00:02:00.000Z");
    await vi.advanceTimersByTimeAsync(1_000);

    expect(insightSpy).not.toHaveBeenCalled();
    expect(distributionSpy).not.toHaveBeenCalled();

    await closeKellyStream(handle);
    expect(upstreamClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  test("keeps repricing while polling fallback is active", async () => {
    vi.useFakeTimers();
    const service = new MeteoblueWeatherService();
    vi.spyOn(service, "getKellyWorkbench").mockResolvedValue(buildSnapshot([buildMatchedMarket()]));
    mockStreamWeatherDependencies(service);

    const client = (service as any).polymarketClient as {
      createMarketStream: (
        ...args: unknown[]
      ) => { close: () => void | Promise<void> };
      fetchOrderBooks: (...args: unknown[]) => Promise<unknown>;
    };
    const upstreamClose = vi.fn();
    let upstreamOnMessage: ((message: KellyStreamMessage) => void) | null = null;

    vi.spyOn(client, "createMarketStream").mockImplementation((_tokenIds, onMessage) => {
      upstreamOnMessage = onMessage as (message: KellyStreamMessage) => void;
      return {
        close: upstreamClose,
      };
    });
    const fetchBooksSpy = vi.spyOn(client, "fetchOrderBooks").mockResolvedValue(
      new Map([
        ["yes-1", { tokenId: "yes-1", bestBid: 0.41, bestAsk: 0.42, midpoint: 0.415, spread: 0.01, updatedAt: "2026-03-28T00:00:00.000Z" }],
        ["no-1", { tokenId: "no-1", bestBid: 0.57, bestAsk: 0.58, midpoint: 0.575, spread: 0.01, updatedAt: "2026-03-28T00:00:00.000Z" }],
      ]),
    );

    const messages: KellyStreamMessage[] = [];
    const handle = await service.createKellyStream("miami_mia", { targetDate: "2026-03-28" }, (message) => {
      messages.push(message);
    });

    messages.length = 0;
    if (!upstreamOnMessage) {
      throw new Error("Expected upstream stream callback to be captured.");
    }
    (upstreamOnMessage as (message: KellyStreamMessage) => void)({
      type: "status",
      generatedAt: "2026-03-28T00:01:00.000Z",
      state: "degraded",
      reasonCode: "polling_fallback",
      message: "fallback",
    });
    await vi.advanceTimersByTimeAsync(30_000);

    expect(fetchBooksSpy).toHaveBeenCalledTimes(2);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "status",
          reasonCode: "polling_fallback",
        }),
        expect.objectContaining({
          type: "markets",
        }),
        expect.objectContaining({
          type: "status",
          reasonCode: "polling_fallback",
          lastRepricedAt: expect.any(String),
        }),
      ]),
    );

    await closeKellyStream(handle);
    expect(upstreamClose).toHaveBeenCalledTimes(1);
  });

  test("reprices with the latest observation floor so impossible contracts drop out during stream updates", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-28T20:30:00.000Z"));

    const service = new MeteoblueWeatherService();
    const floorSensitiveMarket = {
      ...buildMatchedMarket(),
      marketId: "market-under-17",
      slug: "market-under-17",
      title: "Will the high temperature be at most 17C?",
      contractType: "atMost",
      bucketStartC: null,
      bucketEndC: 17,
      bucketLabel: "<= 17C",
      fairYes: 0.4,
      fairNo: 0.6,
      rawProbabilityYes: 0.4,
      rawProbabilityNo: 0.6,
      yesTokenId: "yes-under-17",
      noTokenId: "no-under-17",
      recommendedSide: "yes",
      suggestedStake: 100,
    } satisfies KellyMarketRow;

    vi.spyOn(service, "getKellyWorkbench").mockResolvedValue({
      ...buildSnapshot([floorSensitiveMarket]),
      probabilityCurve: [
        { temperatureC: 16, density: 2, cumulative: 0.2 },
        { temperatureC: 17, density: 3, cumulative: 0.5 },
        { temperatureC: 18, density: 3, cumulative: 0.8 },
        { temperatureC: 19, density: 2, cumulative: 1 },
      ],
    });
    vi.spyOn(service, "getMultiModelInsight").mockRejectedValue(new Error("skip insight refresh in stream test"));

    vi.spyOn(service, "getHourly").mockResolvedValue({
      location: baseLocation,
      pageUrl: "https://example.com/week",
      mode: "1h",
      sourceType: "week-table-1h",
      fetchedAt: "2026-03-28T20:00:00.000Z",
      sourceObservedAt: "2026-03-28T20:00:00.000Z",
      stale: false,
      cacheHit: true,
      partial: false,
      warnings: [],
      current: {
        timestamp: "2026-03-28T16:00:00-04:00",
        temperatureC: 18,
        index: 0,
      },
      items: [
        {
          timestamp: "2026-03-28T16:00:00-04:00",
          temperatureC: 18,
          apparentTemperatureC: 18,
          precipitationProbability: 0,
          relativeHumidity: 0.6,
          windSpeedKph: 10,
          weatherCode: null,
          icon: null,
        },
      ],
    } as any);

    vi.spyOn(service as any, "getMetarCache").mockReturnValue({
      get: vi.fn().mockResolvedValue({
        value: {
          observation: {
            location: baseLocation,
            stationId: "KMIA",
            observedAt: "2026-03-28T16:05:00-04:00",
            temperatureC: 18,
            dewpointC: 12,
            windDirectionDegrees: 130,
            windSpeedKts: 11,
            rawReport: "METAR KMIA latest",
            stationName: "Miami Intl",
            sourceUrl: "https://example.com/metar",
            fetchedAt: "2026-03-28T20:05:00.000Z",
          },
          recentTemperatures: [],
        },
        stale: false,
        cacheHit: true,
      }),
    });

    const client = (service as any).polymarketClient as {
      createMarketStream: (...args: unknown[]) => { close: () => void | Promise<void> };
      fetchOrderBooks: (...args: unknown[]) => Promise<unknown>;
    };
    const upstreamClose = vi.fn();

    vi.spyOn(client, "createMarketStream").mockReturnValue({
      close: upstreamClose,
    });
    vi.spyOn(client, "fetchOrderBooks").mockResolvedValue(
      new Map([
        ["yes-under-17", { tokenId: "yes-under-17", bestBid: 0.01, bestAsk: 0.02, midpoint: 0.015, updatedAt: "2026-03-28T20:30:00.000Z" }],
        ["no-under-17", { tokenId: "no-under-17", bestBid: 0.98, bestAsk: 0.99, midpoint: 0.985, updatedAt: "2026-03-28T20:30:00.000Z" }],
      ]),
    );

    const messages: KellyStreamMessage[] = [];
    const handle = await service.createKellyStream("miami_mia", { targetDate: "2026-03-28" }, (message) => {
      messages.push(message);
    });

    const marketMessage = messages
      .filter((message): message is Extract<KellyStreamMessage, { type: "markets" }> => message.type === "markets")
      .at(-1);
    expect(marketMessage).toBeDefined();
    expect(marketMessage?.markets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          marketId: "market-under-17",
          lifecycle: "inactive",
          inactiveReason: "observation_floor",
          observationFloorBlocked: true,
          fairYes: 0,
          fairNo: 1,
          recommendedSide: "none",
          suggestedStake: 0,
        }),
      ]),
    );

    await closeKellyStream(handle);
    expect(upstreamClose).toHaveBeenCalledTimes(1);
  });
});
