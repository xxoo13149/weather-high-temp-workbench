import { join } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";
import WebSocket from "ws";

import type { WeatherService } from "../src/domain/weather.js";
import { createApp } from "../src/app.js";

const frontendDistDir = join(process.cwd(), "tests", "fixtures", "frontend-dist");

const buildLocationInfo = (locationId: "miami_mia" | "shanghai_pvg") => ({
  id: locationId,
  name: locationId === "miami_mia" ? "Miami International Airport" : "Shanghai Pudong International Airport",
  timezone: locationId === "miami_mia" ? "America/New_York" : "Asia/Shanghai",
});

const createService = () => {
  const getKellyWorkbench = vi.fn().mockImplementation(
    async (
      locationId: "miami_mia" | "shanghai_pvg",
      options?: {
        targetDate?: string;
        bankroll?: number;
        riskMode?: string;
        minEdge?: number;
        actualTemperatureC?: number;
        selectedHourTimestamp?: string;
      },
    ) => ({
      location: buildLocationInfo(locationId),
      targetDate: options?.targetDate ?? "2026-03-28",
      availableTargetDates: ["2026-03-28"],
      generatedAt: "2026-03-27T15:30:00.000Z",
      bankroll: options?.bankroll ?? 1000,
      riskMode: options?.riskMode ?? "balanced",
      riskMultiplier: 0.5,
      minEdge: options?.minEdge ?? 0.02,
      weatherEvidence: {
        location: buildLocationInfo(locationId),
        targetDate: options?.targetDate ?? "2026-03-28",
        availableTargetDates: ["2026-03-28"],
        currentReferenceTemperatureC: options?.actualTemperatureC ?? 24.5,
        currentReferenceSource: "manual" as const,
        currentWeatherTimestamp: options?.selectedHourTimestamp ?? "2026-03-28T03:00:00+08:00",
        currentModelTimestamp: options?.selectedHourTimestamp ?? "2026-03-28T03:00:00+08:00",
        targetModelTimestamp: "2026-03-28T05:00:00+08:00",
        sourceSummaryZh: "test summary",
        hourlyPageUrl: `https://example.com/week/${locationId}`,
        multimodelPageUrl: `https://example.com/multimodel/${locationId}`,
        fetchedAt: "2026-03-27T15:30:00.000Z",
        stale: false,
        participatingModelCount: 2,
        excludedModels: [{ modelName: "ICON", reason: "missing day peak" }],
      },
      distributionSummary: {
        meanTemperatureC: 21,
        medianTemperatureC: 21,
        modeTemperatureC: 21,
        mostLikelyRangeLabel: "21C - 22C",
        shrink: 0.81,
        usableModelCount: 2,
        totalModelCount: 3,
        peakSpreadC: 1.2,
      },
      probabilityCurve: [
        { temperatureC: 20, density: 0.25, cumulative: 0.25 },
        { temperatureC: 21, density: 0.45, cumulative: 0.7 },
        { temperatureC: 22, density: 0.3, cumulative: 1 },
      ],
      bucketProbabilities: [
        {
          marketId: "range:21-22",
          label: "21C - 22C",
          contractType: "range" as const,
          bucketStartC: 21,
          bucketEndC: 22,
          probabilityYes: 0.45,
          probabilityNo: 0.55,
        },
      ],
      markets: [
        {
          marketId: "market-1",
          slug: "market-1",
          title: "Will the high temperature be at least 21C?",
          marketUrl: "https://example.com/polymarket/market-1",
          conditionId: "condition-1",
          liquidity: 1000,
          volume24h: 500,
          contractType: "atLeast" as const,
          unit: "C" as const,
          bucketStartC: 21,
          bucketEndC: null,
          bucketLabel: ">= 21C",
          parseStatus: "matched" as const,
          exclusionReason: null,
          yesTokenId: "yes-1",
          noTokenId: "no-1",
          yesPrice: 0.41,
          noPrice: 0.59,
          yesBestBid: 0.4,
          yesBestAsk: 0.42,
          noBestBid: 0.58,
          noBestAsk: 0.6,
          spreadPct: 0.02,
          fairYes: 0.55,
          fairNo: 0.45,
          edgeYes: 0.13,
          edgeNo: -0.15,
          kellyYes: 0.1,
          kellyNo: 0,
          recommendedSide: "yes" as const,
          suggestedStake: 100,
          updatedAt: "2026-03-27T15:30:00.000Z",
          lifecycle: "tradable",
          entrySourceYes: "best-ask",
          entrySourceNo: "midpoint",
        },
      ],
      inactiveMarkets: [
        {
          marketId: "market-ended",
          title: "Ended contract",
          marketUrl: "https://example.com/polymarket/market-ended",
          lifecycle: "inactive",
          inactiveReason: "closed",
          entrySourceYes: "best-ask",
          entrySourceNo: "midpoint",
          yesTokenId: "yes-ended",
          noTokenId: "no-ended",
        },
      ],
      recommendations: [
        {
          slot: "primary" as const,
          marketId: "market-1",
          title: "Will the high temperature be at least 21C?",
          marketUrl: "https://example.com/polymarket/market-1",
          side: "yes" as const,
          edge: 0.13,
          fairPrice: 0.55,
          marketPrice: 0.42,
          kellyFraction: 0.1,
          suggestedStake: 100,
          reason: "test recommendation",
        },
      ],
      bestObservation: {
        slot: "secondary" as const,
        marketId: "market-1",
        title: "Will the high temperature be at least 21C?",
        marketUrl: "https://example.com/polymarket/market-1",
        side: "yes" as const,
        edge: 0.13,
        fairPrice: 0.55,
        marketPrice: 0.42,
        kellyFraction: 0.1,
        suggestedStake: 0,
        reason: "watch only",
      },
      unresolvedMarkets: [
        {
          marketId: "market-unresolved",
          slug: "market-unresolved",
          title: "Miami heat record market",
          marketUrl: "https://example.com/polymarket/market-unresolved",
          conditionId: "condition-2",
          liquidity: 100,
          volume24h: 20,
          contractType: "range" as const,
          unit: "C" as const,
          bucketStartC: null,
          bucketEndC: null,
          bucketLabel: "Unparsed",
          parseStatus: "unresolved" as const,
          exclusionReason: "Could not map title to a temperature bucket.",
          yesTokenId: null,
          noTokenId: null,
          yesPrice: null,
          noPrice: null,
          yesBestBid: null,
          yesBestAsk: null,
          noBestBid: null,
          noBestAsk: null,
          spreadPct: null,
          fairYes: 0.5,
          fairNo: 0.5,
          edgeYes: 0,
          edgeNo: 0,
          kellyYes: 0,
          kellyNo: 0,
          recommendedSide: "none" as const,
          suggestedStake: 0,
          updatedAt: "2026-03-27T15:30:00.000Z",
        },
      ],
      marketEvidence: [
        {
          marketId: "market-1",
          title: "Will the high temperature be at least 21C?",
          eventTitle: "Miami weather",
          marketUrl: "https://example.com/polymarket/market-1",
          eventUrl: "https://example.com/polymarket/event",
          parseStatus: "matched" as const,
          exclusionReason: null,
          ruleSummary: "Settles from official weather source.",
          resolutionSource: "National Weather Service",
          pageFetchedAt: "2026-03-27T15:29:00.000Z",
        },
      ],
      methodology: {
        generatedAt: "2026-03-27T15:30:00.000Z",
        referenceTemperatureC: options?.actualTemperatureC ?? 24.5,
        referenceSource: "manual" as const,
        shrink: 0.81,
        shrinkMode: "heuristic",
        shrinkInputs: {
          disagreement: 0.4,
          biasDispersion: 0.15,
          missingRatio: 0.25,
          stalePenalty: 0,
        },
        peakSpreadC: 1.2,
        usableModelCount: 2,
        totalModelCount: 3,
        formulaNotes: ["edge = fair - entry", "kelly uses capped fraction"],
        models: [
          {
            modelName: "IFS",
            modelCode: "IFS",
            currentPredictionC: 24.7,
            dayPeakTemperatureC: 31.2,
            biasNowC: 0.2,
            adjustedPeakTemperatureC: 31.07,
            sigmaC: 1.1,
            weight: 0.6,
            included: true,
            exclusionReason: null,
            weightBreakdown: {
              biasWeight: 0.8,
              consensusWeight: 0.9,
              rankWeight: 1.25,
            },
          },
        ],
        probabilitySteps: [
          { label: "Low", probability: 0.2 },
          { label: "Mid", probability: 0.7 },
          { label: "High", probability: 0.1 },
        ],
      },
      frameSeries: [
        {
          id: "frame-1",
          marketId: "market-1",
          generatedAt: "2026-03-27T15:30:00.000Z",
          marketPrice: 0.42,
          fairPrice: 0.55,
          yesMarketPrice: 0.42,
          noMarketPrice: 0.6,
          fairYes: 0.55,
          fairNo: 0.45,
          yesEdge: 0.13,
          noEdge: -0.15,
          spreadPct: 0.02,
          selectedSide: "yes" as const,
          note: "frame note",
        },
      ],
      freshness: {
        weatherGeneratedAt: "2026-03-27T15:30:00.000Z",
        marketDiscoveredAt: "2026-03-27T15:31:00.000Z",
        orderbookFetchedAt: "2026-03-27T15:32:00.000Z",
        repricedAt: "2026-03-27T15:32:00.000Z",
        lastStreamEventAt: "2026-03-27T15:31:30.000Z",
        marketMotionState: "stable",
      },
      streamHealth: {
        state: "connected",
        reasonCode: "ws_connected",
        message: "live stream is healthy",
        lastSignalAt: "2026-03-27T15:31:30.000Z",
        lastRepricedAt: "2026-03-27T15:32:00.000Z",
      },
      sourceLinks: {
        meteoblueWeekUrl: `https://example.com/week/${locationId}`,
        meteoblueMultimodelUrl: `https://example.com/multimodel/${locationId}`,
        polymarketSearchUrl: `https://example.com/polymarket/search/${locationId}`,
        marketUrls: ["https://example.com/polymarket/market-1"],
      },
      sourceStatus: [
        {
          kind: "weather" as const,
          state: "fresh" as const,
          label: "weather",
          detail: "ok",
          updatedAt: "2026-03-27T15:30:00.000Z",
        },
      ],
      warnings: [],
    }),
  );

  return {
    getKellyWorkbench,
  } as unknown as WeatherService;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("kelly api regression", () => {
  test("passes selectedHour through and exposes the richer Kelly snapshot shape", async () => {
    const service = createService();
    const app = createApp(service, { frontendDistDir });
    const response = await app.inject({
      method: "GET",
      url: "/api/weather/kelly?locationId=miami_mia&targetDate=2026-03-28&bankroll=2500&riskMode=aggressive&minEdge=0.03&actualTemperatureC=24.5&selectedHour=2026-03-28T03:00:00%2B08:00",
    });

    expect(response.statusCode).toBe(200);
    expect(service.getKellyWorkbench).toHaveBeenCalledWith(
      "miami_mia",
      expect.objectContaining({
        targetDate: "2026-03-28",
        bankroll: 2500,
        riskMode: "aggressive",
        minEdge: 0.03,
        actualTemperatureC: 24.5,
        selectedHourTimestamp: "2026-03-28T03:00:00+08:00",
      }),
    );
    expect(response.json()).toMatchObject({
      location: { id: "miami_mia" },
      targetDate: "2026-03-28",
      bestObservation: expect.objectContaining({ marketId: "market-1" }),
      unresolvedMarkets: [expect.objectContaining({ marketId: "market-unresolved" })],
      marketEvidence: [expect.objectContaining({ marketId: "market-1" })],
      methodology: expect.objectContaining({
        formulaNotes: expect.arrayContaining(["edge = fair - entry"]),
        models: [expect.objectContaining({ modelCode: "IFS" })],
      }),
      frameSeries: [expect.objectContaining({ marketId: "market-1", yesEdge: 0.13 })],
      markets: expect.arrayContaining([
        expect.objectContaining({ marketId: "market-1" }),
      ]),
      inactiveMarkets: expect.arrayContaining([
        expect.objectContaining({ lifecycle: "inactive" }),
      ]),
    });

    await app.close();
  });

  test("exposes inactive markets plus richness in freshness/stream health", async () => {
    const service = createService();
    const app = createApp(service, { frontendDistDir });
    const response = await app.inject({
      method: "GET",
      url: "/api/weather/kelly?locationId=shanghai_pvg",
    });

    expect(response.json()).toMatchObject({
      inactiveMarkets: [
        expect.objectContaining({
          marketId: "market-ended",
          lifecycle: "inactive",
          inactiveReason: "closed",
        }),
      ],
      freshness: expect.objectContaining({
        weatherGeneratedAt: "2026-03-27T15:30:00.000Z",
        orderbookFetchedAt: "2026-03-27T15:32:00.000Z",
      }),
      streamHealth: expect.objectContaining({
        state: "connected",
        reasonCode: "ws_connected",
        lastSignalAt: "2026-03-27T15:31:30.000Z",
      }),
    });

    await app.close();
  });

  test("does not expose unresolved markets in the main list", async () => {
    const service = createService();
    const app = createApp(service, { frontendDistDir });
    const response = await app.inject({
      method: "GET",
      url: "/api/weather/kelly?locationId=miami_mia",
    });

    const payload = response.json();
    expect(payload.markets.some((market: unknown) => (market as any)?.marketId === "market-unresolved")).toBe(false);
    expect(payload.unresolvedMarkets).toEqual(expect.arrayContaining([expect.objectContaining({ marketId: "market-unresolved" })]));

    await app.close();
  });

  test("forwards Kelly stream messages over websocket without crashing the route handler", async () => {
    const closeMock = vi.fn();
    const service = createService();
    service.createKellyStream = vi.fn(async (_locationId, _options, onMessage) => {
      onMessage({
        type: "status",
        generatedAt: "2026-03-27T15:32:00.000Z",
        state: "connected",
        reasonCode: "no_recent_market_motion",
        message: "实时流已连接，最近还没有新的盘口变动。",
        lastSignalAt: null,
        lastRepricedAt: "2026-03-27T15:32:00.000Z",
      });

      return {
        close: closeMock,
      };
    });

    const app = createApp(service, { frontendDistDir });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const payload = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const socket = new WebSocket(
        `ws://127.0.0.1:${port}/api/weather/kelly/stream?locationId=miami_mia&targetDate=2026-03-28`,
      );

      socket.once("message", (buffer) => {
        resolve(JSON.parse(buffer.toString()) as Record<string, unknown>);
        socket.close();
      });
      socket.once("error", reject);
    });

    expect(payload).toMatchObject({
      type: "status",
      state: "connected",
      reasonCode: "no_recent_market_motion",
    });
    expect(service.createKellyStream).toHaveBeenCalledWith(
      "miami_mia",
      expect.objectContaining({
        targetDate: "2026-03-28",
      }),
      expect.any(Function),
    );

    await vi.waitFor(() => {
      expect(closeMock).toHaveBeenCalledTimes(1);
    });
    await app.close();
  });
});
