import { afterEach, describe, expect, test, vi } from "vitest";

import type { KellyMarketRow, KellyStreamMessage, KellyWorkbenchResponse } from "../src/domain/weather.js";
import { MeteoblueWeatherService } from "../src/providers/meteoblue/service.js";

const baseLocation = {
  id: "miami_mia",
  name: "Miami International Airport",
  timezone: "America/New_York",
} as const;

const buildMatchedMarket = (): KellyMarketRow =>
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
  }) satisfies KellyMarketRow;

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
    distributionSummary: {} as KellyWorkbenchResponse["distributionSummary"],
    probabilityCurve: [],
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MeteoblueWeatherService.createKellyStream reason codes", () => {
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

    await handle.close();
  });

  test("emits reprice_failed and polling_fallback when the first repricing fails", async () => {
    const service = new MeteoblueWeatherService();
    vi.spyOn(service, "getKellyWorkbench").mockResolvedValue(buildSnapshot([buildMatchedMarket()]));

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

    expect(messages[0]).toMatchObject({
      type: "status",
      state: "degraded",
      reasonCode: "polling_fallback",
    });
    expect(messages[1]).toMatchObject({
      type: "status",
      state: "degraded",
      reasonCode: "reprice_failed",
    });

    await handle.close();
    expect(upstreamClose).toHaveBeenCalledTimes(1);
  });
});
