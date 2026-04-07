import { describe, expect, test } from "vitest";

import type { KellyFramePoint, KellyMarketRow, KellyStreamMarketPatch, KellyWorkbenchResponse } from "../src/domain/weather.js";

const baseLocation = {
  id: "miami_mia",
  name: "Miami International Airport",
  timezone: "America/New_York",
} as const;

const buildTradableMarket = (): KellyMarketRow =>
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
      marketMotionState: "still",
    },
    streamHealth: {
      state: "connected",
      reasonCode: "ws_connected",
      message: "live",
      lastSignalAt: null,
      lastRepricedAt: null,
    },
    sourceStatus: [],
    warnings: [],
  }) satisfies KellyWorkbenchResponse;

describe("mergeKellyStreamPatches", () => {
  test("keeps negative-edge tradable rows in the main markets table after a live patch", async () => {
    const modulePath = new URL("../zip/src/kelly.ts", import.meta.url).href;
    const { mergeKellyStreamPatches } = (await import(modulePath)) as {
      mergeKellyStreamPatches: (
        snapshot: KellyWorkbenchResponse,
        patches: KellyStreamMarketPatch[],
        riskMode: KellyWorkbenchResponse["riskMode"],
        minEdge: number,
        frames?: KellyFramePoint[],
      ) => KellyWorkbenchResponse;
    };
    const patch: KellyStreamMarketPatch = {
      marketId: "market-1",
      lifecycle: "tradable",
      inactiveReason: null,
      entrySourceYes: "best-ask",
      entrySourceNo: "best-ask",
      yesPrice: 0.61,
      noPrice: 0.42,
      yesBestBid: 0.6,
      yesBestAsk: 0.61,
      noBestBid: 0.41,
      noBestAsk: 0.42,
      spreadPct: 0.01,
      edgeYes: -0.06,
      edgeNo: -0.02,
      kellyYes: 0,
      kellyNo: 0,
      recommendedSide: "none",
      suggestedStake: 0,
      updatedAt: "2026-03-28T00:05:00.000Z",
    };
    const frames: KellyFramePoint[] = [
      {
        id: "frame-1",
        marketId: "market-1",
        generatedAt: "2026-03-28T00:05:00.000Z",
        marketPrice: 0.42,
        fairPrice: 0.45,
        yesMarketPrice: 0.61,
        noMarketPrice: 0.42,
        fairYes: 0.55,
        fairNo: 0.45,
        yesEdge: -0.06,
        noEdge: -0.02,
        spreadPct: 0.01,
        selectedSide: "watch",
        note: "negative edge should stay visible",
      },
    ];

    const next = mergeKellyStreamPatches(buildSnapshot([buildTradableMarket()]), [patch], "balanced", 0.02, frames);

    expect(next.markets).toEqual([
      expect.objectContaining({
        marketId: "market-1",
        lifecycle: "tradable",
        edgeYes: -0.06,
        edgeNo: -0.02,
        recommendedSide: "none",
        suggestedStake: 0,
      }),
    ]);
    expect(next.inactiveMarkets).toEqual([]);
    expect(next.recommendations).toEqual([]);
    expect(next.bestObservation).toMatchObject({
      marketId: "market-1",
      suggestedStake: 0,
      side: "no",
    });
    expect(next.frameSeries).toEqual(frames);
  });
});
