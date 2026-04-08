import { describe, expect, test, vi } from "vitest";

import { LOCATION_REGISTRY } from "../src/config.js";
import { buildKellyWorkbench } from "../src/kelly/workbench.js";

const location = LOCATION_REGISTRY.miami_mia;

const modelInventory = [
  { modelName: "IFS", displayName: "IFS", pageOrder: 0, pageLastUpdatedAt: null, pageLastUpdatedLabel: null, sourceDisplayName: "IFS", modelCode: "IFS" },
  { modelName: "ECMWF", displayName: "ECMWF", pageOrder: 1, pageLastUpdatedAt: null, pageLastUpdatedLabel: null, sourceDisplayName: "ECMWF", modelCode: "ECMWF" },
  { modelName: "GFS", displayName: "GFS", pageOrder: 2, pageLastUpdatedAt: null, pageLastUpdatedLabel: null, sourceDisplayName: "GFS", modelCode: "GFS" },
];

const rankedModels = [
  { modelName: "IFS", currentTemperatureC: 20.2, deltaToActualTemperatureC: 0.2, dayPeakTemperatureC: 30.2, dayPeakTimestamp: "2026-03-28T18:00:00-04:00" },
  { modelName: "ECMWF", currentTemperatureC: 19.7, deltaToActualTemperatureC: -0.3, dayPeakTemperatureC: 29.8, dayPeakTimestamp: "2026-03-28T18:00:00-04:00" },
  { modelName: "GFS", currentTemperatureC: 20.5, deltaToActualTemperatureC: 0.5, dayPeakTemperatureC: 31.1, dayPeakTimestamp: "2026-03-28T19:00:00-04:00" },
];

const distributionMembers = [
  { modelName: "IFS", temperatureC: 20.2, peakTemperatureC: 30.2, peakTimestamp: "2026-03-28T18:00:00-04:00" },
  { modelName: "ECMWF", temperatureC: 19.7, peakTemperatureC: 29.8, peakTimestamp: "2026-03-28T18:00:00-04:00" },
  { modelName: "GFS", temperatureC: 20.5, peakTemperatureC: 31.1, peakTimestamp: "2026-03-28T19:00:00-04:00" },
];

const createOrderBook = (tokenId: string, bestAsk: number, updatedAt = "2026-03-28T10:00:01.000Z") => ({
  tokenId,
  bestBid: Number((bestAsk - 0.02).toFixed(3)),
  bestAsk,
  midpoint: Number((bestAsk - 0.01).toFixed(3)),
  updatedAt,
});

const createBuildArgs = ({
  firstYesAsk = 0.42,
  firstNoAsk = 0.58,
  secondYesAsk = 0.78,
  secondNoAsk = 0.82,
  repricedAt = null as string | null,
  frameSeries = [
    {
      id: "2026-03-28T10:00:02.000Z:market-yes-30",
      marketId: "market-yes-30",
      generatedAt: "2026-03-28T10:00:02.000Z",
      marketPrice: 0.42,
      fairPrice: 0.58,
      yesMarketPrice: 0.42,
      noMarketPrice: 0.58,
      fairYes: 0.58,
      fairNo: 0.42,
      yesEdge: 0.16,
      noEdge: -0.16,
      spreadPct: 0.02,
      selectedSide: "yes" as const,
      note: "测试帧：主仓行情。",
    },
  ],
} = {}): Parameters<typeof buildKellyWorkbench>[0] => ({
  location,
  targetDate: "2026-03-28",
  hourly: {
    location: { id: location.id, name: location.name, timezone: location.timezone },
    fetchedAt: "2026-03-28T10:00:00.000Z",
    sourceObservedAt: "2026-03-28T10:00:00.000Z",
    mode: "1h" as const,
    periodHours: 1,
    sourceType: "week-table-1h" as const,
    stale: false,
    pageUrl: location.weekPageUrl,
    parserVersion: "test",
    items: [
      {
        timestamp: "2026-03-28T16:00:00-04:00",
        endAt: null,
        summary: null,
        summaryZh: "下午升温明显",
        iconUrl: null,
        temperatureC: 20,
        feelsLikeC: 20,
        windDirection: null,
        windSpeedKphMin: null,
        windSpeedKphMax: null,
        precipitationMm: null,
        precipitationProbabilityPct: null,
      },
    ],
    fieldCoverage: {
      precipitationProbabilityPct: {
        availableHours: 0,
        totalHours: 1,
        source: "week-table-1h" as const,
        completeness: "missing" as const,
        missingReasons: {
          "source-unpublished": 1,
          "parser-unrecognized": 0,
          "fallback-unavailable": 0,
        },
      },
      feelsLikeC: {
        availableHours: 1,
        totalHours: 1,
        source: "week-table-1h" as const,
        completeness: "full" as const,
        missingReasons: {
          "source-unpublished": 0,
          "parser-unrecognized": 0,
          "fallback-unavailable": 0,
        },
      },
      windDirection: {
        availableHours: 0,
        totalHours: 1,
        source: "week-table-1h" as const,
        completeness: "missing" as const,
        missingReasons: {
          "source-unpublished": 1,
          "parser-unrecognized": 0,
          "fallback-unavailable": 0,
        },
      },
      mixedSources: ["week-table-1h" as const],
    },
    partial: false,
    warnings: [],
    cacheHit: true,
    current: {
      timestamp: "2026-03-28T16:00:00-04:00",
      temperatureC: 20,
      index: 0,
    },
  },
  report: {
    location: { id: location.id, name: location.name, timezone: location.timezone },
    fetchedAt: "2026-03-28T10:00:00.000Z",
    sourceObservedAt: "2026-03-28T10:00:00.000Z",
    stale: false,
    cacheHit: true,
    pageUrl: location.weekPageUrl,
    parserVersion: "test",
    available: true,
    titleEn: "Weather report",
    sourceTextEn: "Warm afternoon expected.",
    textZh: "下午升温明显，最高温接近 30C。",
    metrics: {
      forecastDayLabel: "Friday",
      maxTemperatureC: 30,
      uvIndex: null,
      overnightWindKphMin: null,
      overnightWindKphMax: null,
      daytimeWindKphMin: null,
      daytimeWindKphMax: null,
      overnightWindDirection: null,
      daytimeWindDirection: null,
      confidence: "high" as const,
      predictability: "high" as const,
      predictabilityScore: 3 as const,
    },
    warnings: [],
  },
  metarObservation: null,
  insight: {
    location: { id: location.id, name: location.name, timezone: location.timezone },
    fetchedAt: "2026-03-28T10:00:00.000Z",
    stale: false,
    cacheHit: true,
    pageUrl: location.multimodelPageUrl,
    sourceType: "meteoblue-page-highcharts" as const,
    selectedTimestamp: "2026-03-28T16:00:00-04:00",
    selectedTimestampReason: "requested" as const,
    availableTimestamps: ["2026-03-28T16:00:00-04:00"],
    modelCount: 3,
    modelInventory,
    referenceTemperature: { temperatureC: 20, source: "assumed-client-value" as const },
    closestModel: null,
    rankedModels,
    peakTimeDistribution: [],
    sourceProof: {
      dataFromPage: true,
      usesOfficialApi: false,
      chartFormat: "highcharts" as const,
      pageFetchedAt: "2026-03-28T10:00:00.000Z",
      chartEndpoint: "https://example.com/chart",
      parserVersion: "test",
      modelNames: ["IFS", "ECMWF", "GFS"],
      timestampCount: 1,
      timestampSource: "point-name-local" as const,
      xLabelOffsetMinutes: null,
    },
    warnings: [],
  },
  distribution: {
    location: { id: location.id, name: location.name, timezone: location.timezone },
    fetchedAt: "2026-03-28T10:00:00.000Z",
    stale: false,
    cacheHit: true,
    pageUrl: location.multimodelPageUrl,
    sourceType: "meteoblue-page-highcharts" as const,
    requestedTimestamp: "2026-03-28T16:00:00-04:00",
    selectedTimestamp: "2026-03-28T16:00:00-04:00",
    availableTimestamps: ["2026-03-28T16:00:00-04:00"],
    bucketSizeC: 1,
    modelCount: 3,
    modelInventory,
    members: distributionMembers,
    distribution: [],
    peakDistribution: [],
    sourceProof: {
      dataFromPage: true,
      usesOfficialApi: false,
      chartFormat: "highcharts" as const,
      pageFetchedAt: "2026-03-28T10:00:00.000Z",
      chartEndpoint: "https://example.com/chart",
      parserVersion: "test",
      modelNames: ["IFS", "ECMWF", "GFS"],
      timestampCount: 1,
      timestampSource: "point-name-local" as const,
      xLabelOffsetMinutes: null,
    },
    highlights: {
      spreadTemperatureC: 1.3,
      dominantBucket: { bucketStartC: 20, bucketEndC: 21, label: "20-21", count: 3, models: ["IFS", "ECMWF", "GFS"] },
      dominantPeakBucket: { bucketStartC: 30, bucketEndC: 31, label: "30-31", count: 2, models: ["IFS", "ECMWF"] },
      coolestMember: { modelName: "ECMWF", temperatureC: 19.7, peakTemperatureC: 29.8, peakTimestamp: "2026-03-28T18:00:00-04:00" },
      warmestMember: { modelName: "GFS", temperatureC: 20.5, peakTemperatureC: 31.1, peakTimestamp: "2026-03-28T19:00:00-04:00" },
      highestPeakMember: { modelName: "GFS", temperatureC: 20.5, peakTemperatureC: 31.1, peakTimestamp: "2026-03-28T19:00:00-04:00" },
    },
    stats: {
      minTemperatureC: 19.7,
      maxTemperatureC: 20.5,
      meanTemperatureC: 20.13,
    },
    warnings: [],
  },
  discoveryCandidates: [
    {
      marketId: "market-16c",
      slug: "market-16c",
      title: "Will the high temperature be at least 16°C on Mar 28, 2026?",
      marketUrl: "https://example.com/market-16c",
      conditionId: "condition-16c",
      contractType: "atLeast" as const,
      unit: "C" as const,
      bucketStartC: 16,
      bucketEndC: null,
      bucketLabel: ">= 16.0C",
      lifecycle: "tradable",
      inactiveReason: null,
      parseStatus: "matched" as const,
      exclusionReason: null,
      yesTokenId: "yes-16",
      noTokenId: "no-16",
      updatedAt: "2026-03-28T10:00:00.000Z",
      eventTitle: "Miami weather",
      eventUrl: "https://example.com/event",
      liquidity: 3000,
      volume24h: 800,
      description: "Lower temp test market",
      resolutionSource: "National Weather Service",
    },
    {
      marketId: "market-yes-30",
      slug: "market-yes-30",
      title: "Will the high temperature in Miami be at least 30C on Mar 28, 2026?",
      marketUrl: "https://example.com/market-yes-30",
      conditionId: "condition-1",
      contractType: "atLeast" as const,
      unit: "C" as const,
      bucketStartC: 30,
      bucketEndC: null,
      bucketLabel: ">= 30.0C",
      lifecycle: "tradable",
      inactiveReason: null,
      parseStatus: "matched" as const,
      exclusionReason: null,
      yesTokenId: "yes-1",
      noTokenId: "no-1",
      updatedAt: "2026-03-28T10:00:00.000Z",
      eventTitle: "Miami weather",
      eventUrl: "https://example.com/event",
      liquidity: 10000,
      volume24h: 5000,
      description: "Primary market rule summary",
      resolutionSource: "National Weather Service",
    },
    {
      marketId: "market-watch-31",
      slug: "market-watch-31",
      title: "Will the high temperature in Miami be at least 31C on Mar 28, 2026?",
      marketUrl: "https://example.com/market-watch-31",
      conditionId: "condition-2",
      contractType: "atLeast" as const,
      unit: "C" as const,
      bucketStartC: 31,
      bucketEndC: null,
      bucketLabel: ">= 31.0C",
      lifecycle: "tradable",
      inactiveReason: null,
      parseStatus: "matched" as const,
      exclusionReason: null,
      yesTokenId: "yes-2",
      noTokenId: "no-2",
      updatedAt: "2026-03-28T10:00:00.000Z",
      eventTitle: "Miami weather",
      eventUrl: "https://example.com/event",
      liquidity: 6500,
      volume24h: 2200,
      description: "Observation market rule summary",
      resolutionSource: "National Weather Service",
    },
    {
      marketId: "market-unresolved",
      slug: "market-unresolved",
      title: "Will Miami break the heat record this weekend?",
      marketUrl: "https://example.com/market-unresolved",
      conditionId: "condition-3",
      contractType: "range" as const,
      unit: "C" as const,
      bucketStartC: null,
      bucketEndC: null,
      bucketLabel: "Unparsed",
      lifecycle: "unresolved",
      inactiveReason: null,
      parseStatus: "unresolved" as const,
      exclusionReason: "Market title could not be mapped to a temperature bucket.",
      yesTokenId: null,
      noTokenId: null,
      updatedAt: "2026-03-28T10:00:00.000Z",
      eventTitle: "Miami weather",
      eventUrl: "https://example.com/event",
      liquidity: 3000,
      volume24h: 900,
      description: "Rule summary text",
      resolutionSource: "National Weather Service",
    },
  ],
  discoveryFetchedAt: "2026-03-28T10:00:00.000Z",
  sourceLinks: {
    meteoblueWeekUrl: location.weekPageUrl,
    meteoblueMultimodelUrl: location.multimodelPageUrl,
    polymarketSearchUrl: "https://example.com/search",
    marketUrls: ["https://example.com/market-yes-30", "https://example.com/market-watch-31"],
  },
  orderBooks: new Map([
    ["yes-1", createOrderBook("yes-1", firstYesAsk)],
    ["no-1", createOrderBook("no-1", firstNoAsk)],
    ["yes-2", createOrderBook("yes-2", secondYesAsk)],
    ["no-2", createOrderBook("no-2", secondNoAsk)],
    ["yes-16", createOrderBook("yes-16", 0.35)],
    ["no-16", createOrderBook("no-16", 0.65)],
  ]),
  priceFetchedAt: "2026-03-28T10:00:01.000Z",
  generatedAt: "2026-03-28T10:00:02.000Z",
  repricedAt,
  frameSeries,
  options: {
    targetDate: "2026-03-28",
    bankroll: 1000,
    riskMode: "balanced" as const,
    minEdge: 0.02,
    actualTemperatureC: 20,
  },
  warnings: [],
});

describe("buildKellyWorkbench", () => {
  test("returns structured methodology, unresolved markets, frame series, and a distinct observation contract", () => {
    const result = buildKellyWorkbench(createBuildArgs());

    expect(result.targetDate).toBe("2026-03-28");
    expect(result.probabilityCurve.length).toBeGreaterThan(5);
    expect(result.recommendations[0]).toMatchObject({
      slot: "primary",
      marketId: expect.stringMatching(/market-(16c|yes-30)/),
      side: "yes",
    });
    expect(result.bestObservation).toMatchObject({
      slot: "observation",
      marketId: "market-watch-31",
      suggestedStake: 0,
    });
    expect(result.unresolvedMarkets).toHaveLength(1);
    expect(result.unresolvedMarkets[0]?.marketId).toBe("market-unresolved");

    expect(result.marketEvidence).toHaveLength(4);
    expect(result.marketEvidence.find((market) => market.marketId === "market-unresolved")).toMatchObject({
      marketId: "market-unresolved",
      parseStatus: "unresolved",
      ruleSummary: "Rule summary text",
      resolutionSource: "National Weather Service",
    });

    expect(result.methodology.formulaVersion).toBe("model-current-bias-v1");
    expect(result.methodology.summaries).toMatchObject({
      referenceRule: expect.stringContaining("T_ref"),
      adjustmentRule: expect.stringContaining("adjustedPeak"),
      weightRule: expect.stringContaining("权重"),
      shrinkRule: expect.stringContaining("shrink"),
      pricingRule: expect.stringContaining("Kelly"),
      observationRule: expect.stringContaining("观察位"),
    });
    expect(result.methodology.models).toHaveLength(3);
    expect(result.methodology.formulaNotes.length).toBeGreaterThanOrEqual(6);
    expect(result.methodology.shrinkMode).toBe("heuristic");
    expect(result.methodology.shrinkInputs).toMatchObject({
      disagreement: expect.any(Number),
      biasDispersion: expect.any(Number),
      missingRatio: expect.any(Number),
      stalePenalty: expect.any(Number),
    });
    expect(result.methodology.models.every((model) => model.weightBreakdown)).toBe(true);
    expect(result.methodology.probabilitySteps).toMatchObject({
      gridStepC: 0.1,
      details: expect.any(Array),
    });

    const positiveMarket = result.markets.find((market) => market.marketId === "market-16c");
    expect(positiveMarket).toBeDefined();
    expect(positiveMarket?.bucketStartC).toBe(16);
    expect(result.markets.every((market) => market.parseStatus === "matched")).toBe(true);

    expect(result.frameSeries).toHaveLength(1);
    expect(result.frameSeries[0]).toMatchObject({
      marketId: "market-yes-30",
      yesMarketPrice: 0.42,
      noMarketPrice: 0.58,
      fairYes: 0.58,
      fairNo: 0.42,
      selectedSide: "yes",
      note: "测试帧：主仓行情。",
    });
  });

  test("falls back to an observation when no market clears the execution threshold", () => {
    const args = createBuildArgs({
      firstYesAsk: 0.95,
      firstNoAsk: 0.95,
      secondYesAsk: 0.95,
      secondNoAsk: 0.95,
      frameSeries: [],
    });
    args.orderBooks.set("yes-16", createOrderBook("yes-16", 0.99));
    args.orderBooks.set("no-16", createOrderBook("no-16", 0.99));
    const result = buildKellyWorkbench(args);
    expect(result.recommendations).toEqual([]);
    expect(result.bestObservation).not.toBeNull();
    expect(result.bestObservation).toMatchObject({
      slot: "observation",
      suggestedStake: 0,
    });
    expect(["market-16c", "market-yes-30", "market-watch-31"]).toContain(result.bestObservation?.marketId);
    expect(result.bestObservation?.reason).toBeTruthy();
    expect(result.unresolvedMarkets).toHaveLength(1);
    expect(result.marketEvidence.map((market) => market.marketId)).toContain("market-unresolved");
  });

  test("retains negative edge rows when orderbooks exist", () => {
    const result = buildKellyWorkbench(createBuildArgs());
    const negativeMarket = result.markets.find((market) => market.marketId === "market-watch-31");
    expect(negativeMarket).toBeDefined();
    expect(negativeMarket?.edgeNo).toBeLessThan(0);
    expect(negativeMarket?.recommendedSide).toBe("none");
    expect(negativeMarket?.suggestedStake).toBe(0);
  });

  test("keeps borderline but still executable asks in the main table", () => {
    const args = createBuildArgs({
      firstYesAsk: 0.011,
      firstNoAsk: 0.989,
      secondYesAsk: 0.012,
      secondNoAsk: 0.988,
      frameSeries: [],
    });
    args.orderBooks.set("yes-16", createOrderBook("yes-16", 0.011));
    args.orderBooks.set("no-16", createOrderBook("no-16", 0.989));

    const result = buildKellyWorkbench(args);

    expect(result.markets.some((market) => market.marketId === "market-16c")).toBe(true);
    expect(result.markets.some((market) => market.marketId === "market-yes-30")).toBe(true);
    expect(result.inactiveMarkets.some((market) => market.inactiveReason === "no_executable_prices")).toBe(false);
  });

  test("moves markets without orderbooks into the inactive list", () => {
    const args = createBuildArgs();
    args.orderBooks.delete("yes-2");
    args.orderBooks.delete("no-2");
    const result = buildKellyWorkbench(args);

    expect(result.markets.some((market) => market.marketId === "market-watch-31")).toBe(false);
    expect(result.inactiveMarkets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          marketId: "market-watch-31",
          lifecycle: expect.stringMatching(/inactive|ended/),
        }),
      ]),
    );
  });

  test("keeps 0.002/0.999 books in the main table when best asks still exist", () => {
    const args = createBuildArgs({
      frameSeries: [],
    });
    args.orderBooks.set("yes-16", {
      bestBid: 0.001,
      bestAsk: 0.002,
      midpoint: 0.0015,
      updatedAt: "2026-03-28T10:00:01.000Z",
      status: "available",
    });
    args.orderBooks.set("no-16", {
      bestBid: 0.998,
      bestAsk: 0.999,
      midpoint: 0.9985,
      updatedAt: "2026-03-28T10:00:01.000Z",
      status: "available",
    });

    const result = buildKellyWorkbench(args);

    expect(result.markets.some((market) => market.marketId === "market-16c")).toBe(true);
    expect(
      result.inactiveMarkets.some(
        (market) => market.marketId === "market-16c" && market.inactiveReason === "no_executable_prices",
      ),
    ).toBe(false);
  });

  test("uses explicit repricedAt and reports still motion when no stream frames exist", () => {
    const result = buildKellyWorkbench(
      createBuildArgs({
        frameSeries: [],
        repricedAt: "2026-03-28T10:00:01.000Z",
      }),
    );

    expect(result.freshness).toMatchObject({
      orderbookFetchedAt: "2026-03-28T10:00:01.000Z",
      repricedAt: "2026-03-28T10:00:01.000Z",
      lastStreamEventAt: null,
      marketMotionState: "still",
    });
    expect(result.streamHealth).toMatchObject({
      state: "unavailable",
      reasonCode: "awaiting_client_subscription",
      lastSignalAt: null,
      lastRepricedAt: null,
    });
  });

  test("available target dates cap at today plus two days", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-03-28T08:00:00.000Z"));

      const args = createBuildArgs();
      args.distribution.availableTimestamps = [
        "2026-03-27T00:00:00-04:00",
        "2026-03-28T00:00:00-04:00",
        "2026-03-29T00:00:00-04:00",
        "2026-03-30T00:00:00-04:00",
        "2026-03-31T00:00:00-04:00",
      ];

      const result = buildKellyWorkbench(args);
      expect(result.availableTargetDates).toEqual(["2026-03-28", "2026-03-29", "2026-03-30"]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("resolves Fahrenheit display unit when most markets report F", () => {
    const args = createBuildArgs();
    const fCandidates = args.discoveryCandidates.slice(0, 2).map((candidate) => ({
      ...candidate,
      unit: "F" as const,
      bucketLabel: candidate.bucketLabel.replace("C", "F"),
    }));
    args.discoveryCandidates = fCandidates;
    const allowedTokens = new Set(
      fCandidates.flatMap((candidate) => [candidate.yesTokenId, candidate.noTokenId].filter(Boolean)),
    );
    args.orderBooks = new Map(
      [...args.orderBooks].filter(([tokenId]) => allowedTokens.has(tokenId)),
    );

    const result = buildKellyWorkbench(args);
    expect(result.markets.length).toBeGreaterThan(0);
    expect(result.displayUnit).toBe("F");
  });

  test("prefers matched market units for display even when unresolved rows remain Celsius", () => {
    const args = createBuildArgs();
    args.discoveryCandidates = [
      {
        ...args.discoveryCandidates[0],
        unit: "F" as const,
        bucketLabel: ">= 60.8F",
      },
      {
        ...args.discoveryCandidates[3],
        unit: "C" as const,
      },
    ];
    args.orderBooks = new Map([
      ["yes-16", createOrderBook("yes-16", 0.35)],
      ["no-16", createOrderBook("no-16", 0.65)],
    ]);

    const result = buildKellyWorkbench(args);

    expect(result.markets).toHaveLength(1);
    expect(result.unresolvedMarkets).toHaveLength(1);
    expect(result.displayUnit).toBe("F");
  });

  test("applies an observed temperature floor so already-broken low buckets cannot stay Yes", () => {
    const args = createBuildArgs({
      frameSeries: [],
    });
    args.options.actualTemperatureC = 18;
    args.hourly.current = {
      timestamp: "2026-03-28T16:00:00-04:00",
      temperatureC: 18,
      index: 0,
    };
    args.discoveryCandidates = [
      {
        ...args.discoveryCandidates[0],
        marketId: "market-under-17",
        slug: "market-under-17",
        contractType: "atMost",
        bucketStartC: null,
        bucketEndC: 17,
        bucketLabel: "<= 17.0C",
        title: "Will the high temperature in Miami be at most 17C on Mar 28, 2026?",
        yesTokenId: "yes-under-17",
        noTokenId: "no-under-17",
      },
      {
        ...args.discoveryCandidates[1],
        marketId: "market-atleast-16",
        slug: "market-atleast-16",
        bucketStartC: 16,
        bucketLabel: ">= 16.0C",
        yesTokenId: "yes-atleast-16",
        noTokenId: "no-atleast-16",
      },
    ];
    args.orderBooks = new Map([
      ["yes-under-17", createOrderBook("yes-under-17", 0.02)],
      ["no-under-17", createOrderBook("no-under-17", 0.98)],
      ["yes-atleast-16", createOrderBook("yes-atleast-16", 0.65)],
      ["no-atleast-16", createOrderBook("no-atleast-16", 0.35)],
    ]);

    const result = buildKellyWorkbench(args);
    const under17 = result.markets.find((market) => market.marketId === "market-under-17");
    const atleast16 = result.markets.find((market) => market.marketId === "market-atleast-16");

    expect(result.weatherEvidence.observationFloorTemperatureC).toBe(18);
    expect(result.weatherEvidence.observationFloorSource).toBe("manual");
    expect(under17).toMatchObject({
      fairYes: 0,
      fairNo: 1,
      recommendedSide: "no",
    });
    expect(atleast16).toMatchObject({
      fairYes: 1,
      fairNo: 0,
    });
  });

  test("defaults display unit to Celsius when no markets exist", () => {
    const args = createBuildArgs();
    args.discoveryCandidates = [];
    args.orderBooks = new Map();

    const result = buildKellyWorkbench(args);
    expect(result.markets).toHaveLength(0);
    expect(result.displayUnit).toBe("C");
  });
});
