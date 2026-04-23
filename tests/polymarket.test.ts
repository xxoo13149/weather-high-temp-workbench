import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { fetchJsonMock, MockWebSocket, MockNativeWebSocket, wsInstances, nativeWsInstances } = vi.hoisted(() => {
  const fetchJsonMock = vi.fn();
  const wsInstances: MockWebSocket[] = [];
  const nativeWsInstances: MockNativeWebSocket[] = [];

  class MockWebSocket {
    static OPEN = 1;
    static CLOSED = 3;

    readyState = MockWebSocket.OPEN;
    sent: string[] = [];
    private readonly handlers = new Map<string, Array<(payload?: unknown) => void>>();

    constructor(public readonly url: string) {
      wsInstances.push(this);
    }

    on(event: string, handler: (payload?: unknown) => void) {
      const existing = this.handlers.get(event) ?? [];
      existing.push(handler);
      this.handlers.set(event, existing);
      return this;
    }

    send(payload: string) {
      this.sent.push(String(payload));
    }

    close() {
      this.readyState = MockWebSocket.CLOSED;
      this.emit("close");
    }

    emit(event: string, payload?: unknown) {
      for (const handler of this.handlers.get(event) ?? []) {
        handler(payload);
      }
    }
  }

  class MockNativeWebSocket {
    static OPEN = 1;
    static CLOSED = 3;

    readyState = MockNativeWebSocket.OPEN;
    sent: string[] = [];
    private readonly handlers = new Map<string, Array<(payload?: unknown) => void>>();

    constructor(public readonly url: string) {
      nativeWsInstances.push(this);
    }

    addEventListener(event: string, handler: (payload?: unknown) => void) {
      const existing = this.handlers.get(event) ?? [];
      existing.push(handler);
      this.handlers.set(event, existing);
    }

    send(payload: string) {
      this.sent.push(String(payload));
    }

    close() {
      this.readyState = MockNativeWebSocket.CLOSED;
      this.emit("close");
    }

    emit(event: string, payload?: unknown) {
      for (const handler of this.handlers.get(event) ?? []) {
        handler(payload);
      }
    }
  }

  return {
    fetchJsonMock,
    MockWebSocket,
    MockNativeWebSocket,
    wsInstances,
    nativeWsInstances,
  };
});

vi.mock("../src/lib/http.js", () => ({
  fetchJson: fetchJsonMock,
}));

vi.mock("ws", () => ({
  default: MockWebSocket,
}));

import { LOCATION_REGISTRY } from "../src/config.js";

describe("PolymarketClient", () => {
  beforeEach(() => {
    vi.resetModules();
    fetchJsonMock.mockReset();
    wsInstances.length = 0;
    nativeWsInstances.length = 0;
    vi.stubGlobal("WebSocket", MockWebSocket);
    fetchJsonMock.mockResolvedValue([
      {
        id: "market-1",
        slug: "highest-temperature-in-miami-on-april-8-2026-82-83f",
        question: "Will the highest temperature in Miami be between 82-83 F on April 8?",
        eventTitle: "Highest temperature in Miami on April 8?",
        conditionId: "condition-1",
        outcomes: ["Yes", "No"],
        clobTokenIds: ["yes-1", "no-1"],
        volume24hr: 12000,
        liquidity: 34000,
        endDateIso: "2026-04-08T23:59:00-04:00",
        description: "Resolution uses Wunderground history for Miami Intl Airport.",
        resolutionSource: "https://www.wunderground.com/history/daily/us/fl/miami/KMIA",
        acceptingOrders: true,
      },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    wsInstances.length = 0;
    nativeWsInstances.length = 0;
  });

  test("discovers and parses a Fahrenheit range market", async () => {
    const { PolymarketClient } = await import("../src/kelly/polymarket.js");
    const client = new PolymarketClient();
    const result = await client.discoverMarkets(LOCATION_REGISTRY.miami_mia, "2026-04-08");

    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0]).toMatchObject({
      parseStatus: "matched",
      contractType: "range",
      unit: "F",
      yesTokenId: "yes-1",
      noTokenId: "no-1",
    });
    expect(result.candidates[0]?.bucketStartC).toBeCloseTo(27.78, 2);
    expect(result.candidates[0]?.bucketEndC).toBeCloseTo(28.33, 2);
    expect(result.candidates[0]?.bucketLabel).toBe("82.0F - 83.0F");
    expect(result.candidates[0]?.title).toBe("Will the highest temperature in Miami be between 82-83 F on April 8?");
  });

  test("prefers search discovery before exact event probing", async () => {
    const { PolymarketClient } = await import("../src/kelly/polymarket.js");
    const client = new PolymarketClient();

    await client.discoverMarkets(LOCATION_REGISTRY.miami_mia, "2026-04-08");

    expect(fetchJsonMock).toHaveBeenCalled();
    expect(fetchJsonMock.mock.calls.some(([url]) => String(url).includes("/public-search"))).toBe(true);
    expect(fetchJsonMock.mock.calls.some(([url]) => String(url).includes("/events?limit=1&slug="))).toBe(false);
  });

  test("keeps Masroor discovery aligned to the exact venue instead of silently reusing Karachi markets", async () => {
    fetchJsonMock.mockResolvedValue([]);

    const { PolymarketClient } = await import("../src/kelly/polymarket.js");
    const client = new PolymarketClient();

    await client.discoverMarkets(LOCATION_REGISTRY.masroor_opmr, "2026-04-22");

    const requestedUrls = fetchJsonMock.mock.calls.map(([url]) => String(url));
    expect(requestedUrls.some((url) => url.includes("Masroor"))).toBe(true);
    expect(requestedUrls.some((url) => url.includes("Karachi"))).toBe(false);
  });

  test("filters closed and non-accepting markets during discovery", async () => {
    const closedMarket = {
      id: "market-closed",
      slug: "highest-temp-closed",
      question: "Will the highest temperature in Miami be 84F on April 8?",
      eventTitle: "Highest temperature in Miami on April 8?",
      conditionId: "condition-closed",
      outcomes: ["Yes", "No"],
      clobTokenIds: ["yes-closed", "no-closed"],
      volume24hr: 5000,
      liquidity: 20000,
      closed: true,
      acceptingOrders: false,
      endDateIso: "2026-04-08T12:00:00-04:00",
    };
    fetchJsonMock.mockResolvedValue([
      {
        id: "market-allowed",
        slug: "highest-temperature-allowed",
        question: "Will the highest temperature in Miami be 83F on April 8?",
        eventTitle: "Highest temperature in Miami on April 8?",
        conditionId: "condition-allowed",
        outcomes: ["Yes", "No"],
        clobTokenIds: ["yes-allowed", "no-allowed"],
        volume24hr: 8000,
        liquidity: 25000,
        endDateIso: "2026-04-08T23:59:00-04:00",
        acceptingOrders: true,
      },
      closedMarket,
    ]);

    const { PolymarketClient } = await import("../src/kelly/polymarket.js");
    const client = new PolymarketClient();
    const result = await client.discoverMarkets(LOCATION_REGISTRY.miami_mia, "2026-04-08");

    expect(result.candidates.some((candidate) => candidate.marketId === "market-closed")).toBe(false);
    expect(result.candidates.some((candidate) => candidate.marketId === "market-allowed")).toBe(true);
    expect(result.inactiveCandidates.some((candidate) => candidate.marketId === "market-closed")).toBe(true);
  });

  test("keeps Istanbul same-day 18C and 19C or higher markets tradable", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-07T12:00:00.000Z"));
    fetchJsonMock.mockResolvedValue([
      {
        id: "ist-18",
        slug: "highest-temperature-istanbul-18c-april-7",
        question: "Will the highest temperature in Istanbul be 18C on April 7?",
        eventTitle: "Highest temperature in Istanbul on April 7?",
        conditionId: "condition-ist-18",
        outcomes: ["Yes", "No"],
        clobTokenIds: ["yes-ist-18", "no-ist-18"],
        volume24hr: 6400,
        liquidity: 19000,
        endDateIso: "2026-04-07",
        resolveDate: "2026-04-07T00:15:00Z",
        acceptingOrders: true,
        closed: false,
        archived: false,
        enableOrderBook: true,
      },
      {
        id: "ist-19-plus",
        slug: "highest-temperature-istanbul-19c-or-higher-april-7",
        question: "Will the highest temperature in Istanbul be 19C or higher on April 7?",
        eventTitle: "Highest temperature in Istanbul on April 7?",
        conditionId: "condition-ist-19-plus",
        outcomes: ["Yes", "No"],
        clobTokenIds: ["yes-ist-19-plus", "no-ist-19-plus"],
        volume24hr: 7200,
        liquidity: 20500,
        endDateIso: "2026-04-07",
        resolutionDate: "2026-04-07T00:20:00Z",
        acceptingOrders: true,
        closed: false,
        archived: false,
        enableOrderBook: true,
      },
    ]);

    const { PolymarketClient } = await import("../src/kelly/polymarket.js");
    const client = new PolymarketClient();
    const result = await client.discoverMarkets(LOCATION_REGISTRY.istanbul_ist, "2026-04-07");

    expect(result.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          marketId: "ist-18",
          lifecycle: "tradable",
          inactiveReason: null,
          contractType: "exact",
          bucketStartC: 18,
          bucketEndC: 18,
        }),
        expect.objectContaining({
          marketId: "ist-19-plus",
          lifecycle: "tradable",
          inactiveReason: null,
          contractType: "atLeast",
          bucketLabel: ">= 19.0C",
        }),
      ]),
    );
    expect(result.inactiveCandidates.some((entry) => entry.marketId === "ist-18" || entry.marketId === "ist-19-plus")).toBe(false);
  });

  test("rejects markets whose question references the wrong date despite metadata match", async () => {
    fetchJsonMock.mockResolvedValue([
      {
        id: "misdated",
        slug: "highest-temp-misdated",
        question: "Will the highest temperature in Miami be 83F on April 8?",
        eventTitle: "Highest temperature in Miami on April 8?",
        conditionId: "condition-misdated",
        outcomes: ["Yes", "No"],
        clobTokenIds: ["yes-misdated", "no-misdated"],
        volume24hr: 6000,
        liquidity: 21000,
        resolveDate: "2026-04-07T10:00:00Z",
        acceptingOrders: true,
      },
    ]);

    const { PolymarketClient } = await import("../src/kelly/polymarket.js");
    const client = new PolymarketClient();
    const result = await client.discoverMarkets(LOCATION_REGISTRY.miami_mia, "2026-04-07");
    const candidate = result.candidates.find((entry) => entry.marketId === "misdated");

    expect(candidate).toBeDefined();
    expect(candidate?.parseStatus).toBe("unresolved");
  });

  test("matches markets when textual date aligns even if endDateIso differs", async () => {
    fetchJsonMock.mockResolvedValue([
      {
        id: "textual-match",
        slug: "highest-temp-textual-match",
        question: "Will the highest temperature in Miami be 84F on April 7?",
        eventTitle: "Highest temperature in Miami on April 7?",
        conditionId: "condition-textual-match",
        outcomes: ["Yes", "No"],
        clobTokenIds: ["yes-textual", "no-textual"],
        volume24hr: 6000,
        liquidity: 20000,
        resolveDate: "2026-04-07T10:00:00Z",
        endDateIso: "2026-04-08T23:59:00-04:00",
        acceptingOrders: true,
      },
    ]);

    const { PolymarketClient } = await import("../src/kelly/polymarket.js");
    const client = new PolymarketClient();
    const result = await client.discoverMarkets(LOCATION_REGISTRY.miami_mia, "2026-04-07");
    const candidate = result.candidates.find((entry) => entry.marketId === "textual-match");

    expect(candidate).toBeDefined();
    expect(candidate?.parseStatus).toBe("matched");
  });

  test("does not expire same-day markets when endDateIso is date-only", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T12:00:00.000Z"));
    fetchJsonMock.mockResolvedValue([
      {
        id: "market-same-day",
        slug: "highest-temperature-same-day",
        question: "Will the highest temperature in Miami be 83F on April 8?",
        eventTitle: "Highest temperature in Miami on April 8?",
        conditionId: "condition-same-day",
        outcomes: ["Yes", "No"],
        clobTokenIds: ["yes-same-day", "no-same-day"],
        volume24hr: 8000,
        liquidity: 25000,
        endDateIso: "2026-04-08",
        acceptingOrders: true,
      },
    ]);

    const { PolymarketClient } = await import("../src/kelly/polymarket.js");
    const client = new PolymarketClient();
    const result = await client.discoverMarkets(LOCATION_REGISTRY.miami_mia, "2026-04-08");
    const candidate = result.candidates.find((entry) => entry.marketId === "market-same-day");

    expect(candidate).toMatchObject({
      lifecycle: "tradable",
      inactiveReason: null,
      endsAt: "2026-04-08",
    });
    expect(result.inactiveCandidates.some((entry) => entry.marketId === "market-same-day")).toBe(false);
  });

  test("expires markets when the upstream end timestamp is already in the past", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T12:00:00.000Z"));
    fetchJsonMock.mockResolvedValue([
      {
        id: "market-expired",
        slug: "highest-temperature-expired",
        question: "Will the highest temperature in Miami be 83F on April 8?",
        eventTitle: "Highest temperature in Miami on April 8?",
        conditionId: "condition-expired",
        outcomes: ["Yes", "No"],
        clobTokenIds: ["yes-expired", "no-expired"],
        volume24hr: 8000,
        liquidity: 25000,
        endDateIso: "2026-04-08T11:00:00Z",
      },
    ]);

    const { PolymarketClient } = await import("../src/kelly/polymarket.js");
    const client = new PolymarketClient();
    const result = await client.discoverMarkets(LOCATION_REGISTRY.miami_mia, "2026-04-08");
    const candidate = result.inactiveCandidates.find((entry) => entry.marketId === "market-expired");

    expect(candidate).toMatchObject({
      lifecycle: "inactive",
      inactiveReason: "expired",
      endsAt: "2026-04-08T11:00:00Z",
    });
    expect(result.candidates.some((entry) => entry.marketId === "market-expired")).toBe(false);
  });

  test("fetchOrderBooks picks the best bid and ask from unsorted orderbook levels", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      bids: [
        { price: "0.31", size: "15" },
        { price: "0.42", size: "10" },
        { price: "1.20", size: "2" },
      ],
      asks: [
        { price: "0.45", size: "8" },
        { price: "0.37", size: "11" },
        { price: "-0.10", size: "1" },
      ],
    });

    const { PolymarketClient } = await import("../src/kelly/polymarket.js");
    const client = new PolymarketClient();
    const books = await client.fetchOrderBooks(["token-1"]);

    expect(fetchJsonMock).toHaveBeenCalledTimes(1);
    expect(books.get("token-1")).toMatchObject({
      tokenId: "token-1",
      bestBid: 0.42,
      bestAsk: 0.37,
      midpoint: 0.395,
      status: "available",
    });
  });

  test("fetchOrderBooks throws when every token request fails so callers can fall back to stale books", async () => {
    fetchJsonMock.mockRejectedValue(new Error("upstream unavailable"));

    const { PolymarketClient } = await import("../src/kelly/polymarket.js");
    const client = new PolymarketClient();

    await expect(client.fetchOrderBooks(["token-1", "token-2"])).rejects.toThrow(
      "Polymarket orderbook fetch returned no usable books.",
    );
  });

  test("treats official market channel signals as repricing triggers and preserves upstream timestamps", async () => {
    const { PolymarketClient } = await import("../src/kelly/polymarket.js");
    const client = new PolymarketClient();
    const messages: unknown[] = [];
    const signals: string[] = [];

    const handle = client.createMarketStream(
      ["token-1"],
      (message) => {
        messages.push(message);
      },
      (occurredAt) => {
        signals.push(occurredAt);
      },
    );

    const socket = wsInstances.at(-1);
    expect(socket).toBeDefined();

    socket?.emit("open");
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "status",
          state: "connected",
          reasonCode: "ws_connected",
        }),
      ]),
    );
    expect(socket?.sent[0]).toContain("\"type\":\"market\"");
    expect(socket?.sent[0]).toContain("\"custom_feature_enabled\":true");

    socket?.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          event_type: "market_resolved",
          asset_id: "token-1",
          winning_asset_id: "token-1",
          timestamp: 1_775_525_900,
        }),
      ),
    );

    socket?.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          event_type: "new_market",
          asset_id: "token-1",
          timestamp: 1_775_525_905,
        }),
      ),
    );

    await Promise.resolve();
    expect(signals).toEqual(["2026-04-07T01:38:20.000Z", "2026-04-07T01:38:25.000Z"]);
    handle.close();
  });

  test("does not treat an idle market stream as broken while heartbeat pings are active", async () => {
    vi.useFakeTimers();
    const { PolymarketClient } = await import("../src/kelly/polymarket.js");
    const client = new PolymarketClient();
    const messages: unknown[] = [];

    const handle = client.createMarketStream(
      ["token-1"],
      (message) => {
        messages.push(message);
      },
      () => {},
    );

    const socket = wsInstances.at(-1);
    expect(socket).toBeDefined();

    socket?.emit("open");
    messages.length = 0;

    await vi.advanceTimersByTimeAsync(120_000);

    expect(messages).toEqual([]);
    expect(socket?.sent.filter((entry) => entry === "PING").length).toBeGreaterThan(0);

    handle.close();
  });

  test("does not force a reconnect just because the market channel stays quiet", async () => {
    vi.useFakeTimers();
    const { PolymarketClient } = await import("../src/kelly/polymarket.js");
    const client = new PolymarketClient();
    const messages: unknown[] = [];

    const handle = client.createMarketStream(
      ["token-1"],
      (message) => {
        messages.push(message);
      },
      () => {},
    );

    const socket = wsInstances.at(-1);
    expect(socket).toBeDefined();

    socket?.emit("open");
    await vi.advanceTimersByTimeAsync(90_000);

    expect(wsInstances).toHaveLength(1);
    expect(messages).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "status",
          reasonCode: "polling_fallback",
        }),
      ]),
    );

    handle.close();
  });

  test("reconnects after an unexpected websocket close", async () => {
    vi.useFakeTimers();
    const { PolymarketClient } = await import("../src/kelly/polymarket.js");
    const client = new PolymarketClient();
    const messages: unknown[] = [];

    const handle = client.createMarketStream(
      ["token-1"],
      (message) => {
        messages.push(message);
      },
      () => {},
    );

    const socket = wsInstances.at(-1);
    expect(socket).toBeDefined();

    socket?.emit("open");
    messages.length = 0;

    socket?.emit("close");

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "status",
          state: "degraded",
          reasonCode: "polling_fallback",
        }),
      ]),
    );

    await vi.advanceTimersByTimeAsync(1_500);
    expect(wsInstances).toHaveLength(2);

    const reconnectedSocket = wsInstances.at(-1);
    reconnectedSocket?.emit("open");

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "status",
          state: "connected",
          reasonCode: "ws_connected",
        }),
      ]),
    );

    handle.close();
  });

  test("reconnects after websocket error closes the transport", async () => {
    vi.useFakeTimers();
    const { PolymarketClient } = await import("../src/kelly/polymarket.js");
    const client = new PolymarketClient();
    const messages: unknown[] = [];

    const handle = client.createMarketStream(
      ["token-1"],
      (message) => {
        messages.push(message);
      },
      () => {},
    );

    const socket = wsInstances.at(-1);
    expect(socket).toBeDefined();

    socket?.emit("open");
    messages.length = 0;

    socket?.emit("error", new Error("boom"));

    expect(socket?.readyState).toBe(MockWebSocket.CLOSED);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "status",
          state: "degraded",
          reasonCode: "polling_fallback",
        }),
      ]),
    );

    await vi.advanceTimersByTimeAsync(1_500);
    expect(wsInstances).toHaveLength(2);

    handle.close();
  });

  test("uses the native Worker WebSocket runtime when available", async () => {
    vi.stubGlobal("WebSocket", MockNativeWebSocket);
    vi.stubGlobal("WebSocketPair", class MockWorkerWebSocketPair {});

    const { PolymarketClient } = await import("../src/kelly/polymarket.js");
    const client = new PolymarketClient();
    const messages: unknown[] = [];
    const signals: string[] = [];

    const handle = client.createMarketStream(
      ["token-1"],
      (message) => {
        messages.push(message);
      },
      (occurredAt) => {
        signals.push(occurredAt);
      },
    );

    expect(wsInstances).toHaveLength(0);
    expect(nativeWsInstances).toHaveLength(1);

    const socket = nativeWsInstances.at(-1);
    socket?.emit("open");
    socket?.emit("message", {
      data: JSON.stringify({
        event_type: "price_change",
        asset_id: "token-1",
        timestamp: 1_775_525_900,
      }),
    });

    await Promise.resolve();
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "status",
          state: "connected",
          reasonCode: "ws_connected",
        }),
      ]),
    );
    expect(signals).toEqual(["2026-04-07T01:38:20.000Z"]);

    handle.close();
  });

  test("parses 16C titles without producing negative buckets", async () => {
    fetchJsonMock.mockResolvedValue([
      {
        id: "market-16c",
        slug: "highest-temperature-16c",
        question: "Will the highest temperature in Miami be at most 16C on April 8?",
        eventTitle: "Highest temperature in Miami on April 8?",
        conditionId: "condition-16c",
        outcomes: ["Yes", "No"],
        clobTokenIds: ["yes-16", "no-16"],
        volume24hr: 6000,
        liquidity: 15000,
        endDateIso: "2026-04-08T23:59:00-04:00",
        acceptingOrders: true,
      },
    ]);

    const { PolymarketClient } = await import("../src/kelly/polymarket.js");
    const client = new PolymarketClient();
    const result = await client.discoverMarkets(LOCATION_REGISTRY.miami_mia, "2026-04-08");

    const candidate = result.candidates.find((item) => item.slug === "highest-temperature-16c");
    expect(candidate).toBeDefined();
    expect(candidate?.bucketEndC).toBeGreaterThanOrEqual(16);
    expect(candidate?.bucketLabel).toContain("16");
  });

  test("does not emit a warning when matched markets are present but temporarily inactive", async () => {
    const { buildDiscoveryWarnings } = await import("../src/kelly/polymarket.js");

    expect(
      buildDiscoveryWarnings([
        {
          marketId: "market-inactive",
          slug: "market-inactive",
          title: "Inactive market",
          marketUrl: "https://example.com/market/inactive",
          conditionId: "condition-inactive",
          contractType: "exact",
          unit: "C",
          bucketStartC: 22,
          bucketEndC: 22,
          bucketLabel: "22C",
          lifecycle: "inactive",
          inactiveReason: "closed",
          parseStatus: "matched",
          exclusionReason: null,
          yesTokenId: "yes-inactive",
          noTokenId: "no-inactive",
          updatedAt: "2026-04-08T23:59:00.000Z",
          eventTitle: "Highest temperature test event",
          eventUrl: "https://example.com/event/inactive",
          liquidity: 100,
          volume24h: 10,
          description: null,
          resolutionSource: null,
          active: false,
          closed: true,
          acceptingOrders: false,
          archived: false,
          enableOrderBook: true,
          endsAt: "2026-04-08T23:59:00.000Z",
        },
      ] as any),
    ).toEqual([]);
  });
});
