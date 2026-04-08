import { join } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import type { WeatherService } from "../src/domain/weather.js";
import { createApp } from "../src/app.js";

const frontendDistDir = join(process.cwd(), "tests", "fixtures", "frontend-dist");
const frontendTitle = "Shanghai Pudong International Airport 天气看板";
const reportZh = "最高气温约 21°C。";

const fieldCoverage = {
  precipitationProbabilityPct: {
    availableHours: 0,
    totalHours: 0,
    source: "week-meteogram-highcharts" as const,
    completeness: "missing" as const,
    missingReasons: {
      "source-unpublished": 0,
      "parser-unrecognized": 0,
      "fallback-unavailable": 0,
    },
  },
  feelsLikeC: {
    availableHours: 0,
    totalHours: 0,
    source: "week-meteogram-highcharts" as const,
    completeness: "missing" as const,
    missingReasons: {
      "source-unpublished": 0,
      "parser-unrecognized": 0,
      "fallback-unavailable": 0,
    },
  },
  windDirection: {
    availableHours: 0,
    totalHours: 0,
    source: "week-meteogram-highcharts" as const,
    completeness: "missing" as const,
    missingReasons: {
      "source-unpublished": 0,
      "parser-unrecognized": 0,
      "fallback-unavailable": 0,
    },
  },
  mixedSources: ["week-meteogram-highcharts" as const],
};

const modelInventory = [
  {
    modelName: "IFS 0.25°",
    displayName: "IFS 0.25°",
    pageOrder: 0,
    pageLastUpdatedAt: "2026-03-27T15:00:00.000Z",
    pageLastUpdatedLabel: "2026-03-27 15:00 UTC",
    sourceDisplayName: "IFS 0.25°",
    modelCode: "IFS025",
  },
];

const distributionMember = {
  modelName: "IFS 0.25°",
  temperatureC: 20,
  peakTemperatureC: 21,
  peakTimestamp: "2026-03-28T05:00:00+08:00",
};

const distributionBucket = {
  bucketStartC: 20,
  bucketEndC: 21,
  label: "20.0 - 21.0 °C",
  count: 1,
  models: ["IFS 0.25°"],
};

const peakDistributionBucket = {
  bucketStartC: 21,
  bucketEndC: 22,
  label: "21.0 - 22.0 °C",
  count: 1,
  models: ["IFS 0.25°"],
};

const locationMap = {
  shanghai_pvg: {
    name: "Shanghai Pudong International Airport",
    timezone: "Asia/Shanghai",
  },
  miami_mia: {
    name: "Miami International Airport",
    timezone: "America/New_York",
  },
} as const;

const buildLocationInfo = (locationId: keyof typeof locationMap) => ({
  id: locationId,
  name: locationMap[locationId].name,
  timezone: locationMap[locationId].timezone,
});

const createService = (): WeatherService => {
  const getHourly = vi.fn().mockImplementation(async (locationId: keyof typeof locationMap, mode = "1h", limit?: number) => ({
    location: buildLocationInfo(locationId),
    fetchedAt: "2026-03-27T15:30:00.000Z",
    sourceObservedAt: "2026-03-27T15:30:00.000Z",
    mode,
    periodHours: mode === "3h" ? 3 : 1,
    sourceType: "week-meteogram-highcharts",
    stale: false,
    pageUrl: `https://example.com/week/${locationId}`,
    parserVersion: "test",
    items: [],
    fieldCoverage,
    partial: true,
    warnings: [],
    cacheHit: true,
    current: null,
  }));

  const getWeatherReport = vi.fn().mockImplementation(async (locationId: keyof typeof locationMap) => ({
    location: buildLocationInfo(locationId),
    fetchedAt: "2026-03-27T15:30:00.000Z",
    sourceObservedAt: "2026-03-27T15:30:00.000Z",
    stale: false,
    pageUrl: `https://example.com/week/${locationId}`,
    parserVersion: "test",
    available: true,
    titleEn: `Weather report for ${locationMap[locationId].name}`,
    sourceTextEn: "Temperatures peaking at 21 °C.",
    textZh: reportZh,
    metrics: {
      forecastDayLabel: "Saturday",
      maxTemperatureC: 21,
      uvIndex: 7,
      overnightWindKphMin: 7,
      overnightWindKphMax: 12,
      daytimeWindKphMin: 12,
      daytimeWindKphMax: 20,
      overnightWindDirection: "South",
      daytimeWindDirection: "Southeast",
      confidence: "high",
      predictability: "high",
      predictabilityScore: 3,
    },
    warnings: [],
    cacheHit: true,
  }));

  const getMultiModelImage = vi.fn().mockResolvedValue({
    contentType: "image/png",
    body: Buffer.from("png"),
    cacheHit: true,
    stale: false,
    headers: {
      "x-weather-stale": "false",
    },
  });

  const getMultiModelStatus = vi.fn().mockImplementation(async (locationId: keyof typeof locationMap) => ({
    location: buildLocationInfo(locationId),
    pageFetchedAt: null,
    imageFetchedAt: null,
    imageUrlFound: false,
    cacheHit: false,
    stale: false,
    lastError: null,
    lastSuccessAt: null,
    imageUrl: null,
    pageUrl: `https://example.com/multimodel/${locationId}`,
  }));

  const getMultiModelDistribution = vi.fn().mockImplementation(
    async (locationId: keyof typeof locationMap, timestamp?: string, bucketSizeC = 1) => ({
      location: buildLocationInfo(locationId),
      fetchedAt: "2026-03-27T15:30:00.000Z",
      selectedTimestamp: timestamp ?? "2026-03-28T03:00:00+08:00",
      requestedTimestamp: timestamp ?? "2026-03-28T03:00:00+08:00",
      availableTimestamps: ["2026-03-28T03:00:00+08:00"],
      bucketSizeC,
      sourceType: "meteoblue-page-highcharts",
      pageUrl: `https://example.com/multimodel/${locationId}`,
      cacheHit: true,
      stale: false,
      warnings: [],
      modelCount: 1,
      modelInventory,
      members: [distributionMember],
      distribution: [distributionBucket],
      peakDistribution: [peakDistributionBucket],
      sourceProof: {
        dataFromPage: true,
        usesOfficialApi: false,
        chartFormat: "highcharts",
        pageFetchedAt: "2026-03-27T15:30:00.000Z",
        chartEndpoint: "https://example.com/images/meteogram_multimodel?format=highcharts",
        parserVersion: "test",
        modelNames: ["IFS 0.25°"],
        timestampCount: 1,
        timestampSource: "point-name-local",
        xLabelOffsetMinutes: 480,
      },
      highlights: {
        spreadTemperatureC: 0,
        dominantBucket: distributionBucket,
        dominantPeakBucket: peakDistributionBucket,
        coolestMember: distributionMember,
        warmestMember: distributionMember,
        highestPeakMember: distributionMember,
      },
      stats: {
        minTemperatureC: 20,
        maxTemperatureC: 20,
        meanTemperatureC: 20,
      },
    }),
  );

  const getMultiModelInsight = vi.fn().mockImplementation(
    async (locationId: keyof typeof locationMap, timestamp?: string, actualTemperatureC = 20) => ({
      location: buildLocationInfo(locationId),
      fetchedAt: "2026-03-27T15:30:00.000Z",
      stale: false,
      cacheHit: true,
      pageUrl: `https://example.com/multimodel/${locationId}`,
      sourceType: "meteoblue-page-highcharts",
      selectedTimestamp: timestamp ?? "2026-03-28T03:00:00+08:00",
      selectedTimestampReason: "requested",
      availableTimestamps: ["2026-03-28T03:00:00+08:00"],
      modelCount: 1,
      modelInventory,
      referenceTemperature: {
        temperatureC: actualTemperatureC,
        source: "assumed-client-value",
      },
      closestModel: {
        modelName: "IFS 0.25°",
        currentTemperatureC: 20,
        deltaToActualTemperatureC: 0,
        dayPeakTemperatureC: 21,
        dayPeakTimestamp: "2026-03-28T05:00:00+08:00",
      },
      rankedModels: [
        {
          modelName: "IFS 0.25°",
          currentTemperatureC: 20,
          deltaToActualTemperatureC: 0,
          dayPeakTemperatureC: 21,
          dayPeakTimestamp: "2026-03-28T05:00:00+08:00",
        },
      ],
      peakTimeDistribution: [
        {
          timestamp: "2026-03-28T05:00:00+08:00",
          modelCount: 1,
          avgPeakTemperatureC: 21,
          minPeakTemperatureC: 21,
          maxPeakTemperatureC: 21,
          modelNames: ["IFS 0.25°"],
          peakModels: [
            {
              modelName: "IFS 0.25°",
              dayPeakTemperatureC: 21,
            },
          ],
        },
      ],
      sourceProof: {
        dataFromPage: true,
        usesOfficialApi: false,
        chartFormat: "highcharts",
        pageFetchedAt: "2026-03-27T15:30:00.000Z",
        chartEndpoint: "https://example.com/images/meteogram_multimodel?format=highcharts",
        parserVersion: "test",
        modelNames: ["IFS 0.25°"],
        timestampCount: 1,
        timestampSource: "point-name-local",
        xLabelOffsetMinutes: 480,
      },
      warnings: [],
    }),
  );

  const getKellyWorkbench = vi.fn().mockImplementation(
    async (locationId: keyof typeof locationMap, options?: { targetDate?: string; bankroll?: number; riskMode?: string; minEdge?: number }) => ({
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
        currentReferenceTemperatureC: 20,
        currentReferenceSource: "manual",
        currentWeatherTimestamp: "2026-03-28T03:00:00+08:00",
        currentModelTimestamp: "2026-03-28T03:00:00+08:00",
        targetModelTimestamp: "2026-03-28T05:00:00+08:00",
        observationFloorTemperatureC: 20,
        observationFloorSource: "manual",
        observationFloorObservedAt: "2026-03-28T03:00:00+08:00",
        metarObservation: null,
        sourceSummaryZh: reportZh,
        hourlyPageUrl: `https://example.com/week/${locationId}`,
        multimodelPageUrl: `https://example.com/multimodel/${locationId}`,
        fetchedAt: "2026-03-27T15:30:00.000Z",
        stale: false,
        participatingModelCount: 1,
        excludedModels: [],
      },
      distributionSummary: {
        meanTemperatureC: 21,
        medianTemperatureC: 21,
        modeTemperatureC: 21,
        mostLikelyRangeLabel: "21C - 22C",
        shrink: 0.81,
        usableModelCount: 1,
        totalModelCount: 1,
        peakSpreadC: 0,
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
          contractType: "range",
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
          contractType: "atLeast",
          unit: "C",
          bucketStartC: 21,
          bucketEndC: null,
          bucketLabel: ">= 21C",
          parseStatus: "matched",
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
          recommendedSide: "yes",
          suggestedStake: 100,
          updatedAt: "2026-03-27T15:30:00.000Z",
        },
      ],
      recommendations: [
        {
          slot: "primary",
          marketId: "market-1",
          title: "Will the high temperature be at least 21C?",
          marketUrl: "https://example.com/polymarket/market-1",
          side: "yes",
          edge: 0.13,
          fairPrice: 0.55,
          marketPrice: 0.42,
          kellyFraction: 0.1,
          suggestedStake: 100,
          reason: "test",
        },
      ],
      sourceLinks: {
        meteoblueWeekUrl: `https://example.com/week/${locationId}`,
        meteoblueMultimodelUrl: `https://example.com/multimodel/${locationId}`,
        polymarketSearchUrl: `https://example.com/polymarket/search/${locationId}`,
        marketUrls: ["https://example.com/polymarket/market-1"],
      },
      sourceStatus: [
        {
          kind: "weather",
          state: "fresh",
          label: "天气证据",
          detail: "ok",
          updatedAt: "2026-03-27T15:30:00.000Z",
        },
      ],
      warnings: [],
    }),
  );

  return {
    getHourly,
    getWeatherReport,
    getMultiModelImage,
    getMultiModelStatus,
    getMultiModelDistribution,
    getMultiModelInsight,
    getKellyWorkbench,
    getUserFavorites: vi.fn().mockResolvedValue({
      fetchedAt: "2026-03-27T15:30:00.000Z",
      locationIds: ["shanghai_pvg"],
    }),
    setUserFavorite: vi.fn().mockResolvedValue({
      fetchedAt: "2026-03-27T15:31:00.000Z",
      locationIds: ["shanghai_pvg"],
    }),
  } as unknown as WeatherService;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createApp", () => {
  test("reports health with build metadata", async () => {
    const app = createApp(createService(), { frontendDistDir });
    const response = await app.inject({ method: "GET", url: "/healthz" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.json()).toEqual(
      expect.objectContaining({
        ok: true,
        buildId: expect.any(String),
        startedAt: expect.any(String),
      }),
    );

    await app.close();
  });

  test("serves the built frontend html with utf-8 headers", async () => {
    const app = createApp(createService(), { frontendDistDir });
    const response = await app.inject({ method: "GET", url: "/" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.headers["content-type"]).toContain("charset=utf-8");
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.body).toContain(frontendTitle);

    await app.close();
  });

  test("serves built frontend assets", async () => {
    const app = createApp(createService(), { frontendDistDir });
    const response = await app.inject({ method: "GET", url: "/assets/main.js" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/javascript");
    expect(response.headers["cache-control"]).toContain("immutable");
    expect(response.body).toContain("frontend ok");

    await app.close();
  });

  test("defaults the hourly endpoint to shanghai_pvg", async () => {
    const service = createService();
    const app = createApp(service, { frontendDistDir });
    const response = await app.inject({ method: "GET", url: "/api/weather/hourly?mode=1h&limit=2" });

    expect(response.statusCode).toBe(200);
    expect(service.getHourly).toHaveBeenCalledWith("shanghai_pvg", "1h", 2);
    expect(response.json()).toMatchObject({
      location: {
        id: "shanghai_pvg",
      },
    });

    await app.close();
  });

  test("passes locationId through all dashboard service calls and returns locationDirectory", async () => {
    const service = createService();
    const app = createApp(service, { frontendDistDir });
    const response = await app.inject({
      method: "GET",
      url: "/api/weather/dashboard?mode=1h&limit=6&locationId=miami_mia",
    });

    expect(response.statusCode).toBe(200);
    expect(service.getHourly).toHaveBeenCalledWith("miami_mia", "1h", 6);
    expect(service.getMultiModelStatus).toHaveBeenCalledWith("miami_mia");
    expect(service.getWeatherReport).toHaveBeenCalledWith("miami_mia");
    expect(response.json()).toMatchObject({
      locationDirectory: expect.arrayContaining([
        expect.objectContaining({ id: "shanghai_pvg" }),
        expect.objectContaining({ id: "miami_mia" }),
      ]),
      hourly: {
        location: {
          id: "miami_mia",
        },
      },
      report: {
        location: {
          id: "miami_mia",
        },
        textZh: reportZh,
      },
      multimodel: {
        location: {
          id: "miami_mia",
        },
        imageProxyUrl: "/api/weather/multimodel/image?allowStale=true&locationId=miami_mia",
      },
    });

    await app.close();
  });

  test("wires multimodel distribution and insights with locationId", async () => {
    const service = createService();
    const app = createApp(service, { frontendDistDir });

    const distributionResponse = await app.inject({
      method: "GET",
      url: "/api/weather/multimodel/distribution?locationId=miami_mia&timestamp=2026-03-28T03:00:00%2B08:00&bucketSize=1.5",
    });
    const insightResponse = await app.inject({
      method: "GET",
      url: "/api/weather/multimodel/insights?locationId=miami_mia&timestamp=2026-03-28T03:00:00%2B08:00&actualTemperatureC=20",
    });

    expect(distributionResponse.statusCode).toBe(200);
    expect(insightResponse.statusCode).toBe(200);
    expect(service.getMultiModelDistribution).toHaveBeenCalledWith("miami_mia", "2026-03-28T03:00:00+08:00", 1.5);
    expect(service.getMultiModelInsight).toHaveBeenCalledWith("miami_mia", "2026-03-28T03:00:00+08:00", 20);

    await app.close();
  });

  test("streams multimodel image bytes for a locationId", async () => {
    const service = createService();
    const app = createApp(service, { frontendDistDir });
    const response = await app.inject({ method: "GET", url: "/api/weather/multimodel/image?locationId=miami_mia" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("image/png");
    expect(service.getMultiModelImage).toHaveBeenCalledWith("miami_mia", false);
    expect(response.body).toBe("png");

    await app.close();
  });

  test("returns a Kelly workbench snapshot for a locationId and targetDate", async () => {
    const service = createService();
    const app = createApp(service, { frontendDistDir });
    const response = await app.inject({
      method: "GET",
      url: "/api/weather/kelly?locationId=miami_mia&targetDate=2026-03-28&bankroll=2500&riskMode=aggressive&minEdge=0.03&actualTemperatureC=24.5",
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
      }),
    );
    expect(response.json()).toMatchObject({
      location: { id: "miami_mia" },
      targetDate: "2026-03-28",
      markets: [expect.objectContaining({ marketId: "market-1" })],
      recommendations: [expect.objectContaining({ marketId: "market-1" })],
    });

    await app.close();
  });

  test("keeps favorites endpoints unchanged", async () => {
    const service = createService();
    const app = createApp(service, { frontendDistDir });
    const readResponse = await app.inject({ method: "GET", url: "/api/user/favorites" });
    const writeResponse = await app.inject({
      method: "PUT",
      url: "/api/user/favorites/shanghai_pvg",
      payload: { favorite: true },
    });

    expect(readResponse.statusCode).toBe(200);
    expect(writeResponse.statusCode).toBe(200);
    expect(service.getUserFavorites).toHaveBeenCalled();
    expect(service.setUserFavorite).toHaveBeenCalledWith("shanghai_pvg", true);

    await app.close();
  });

  test("rejects an invalid locationId query", async () => {
    const app = createApp(createService(), { frontendDistDir });
    const response = await app.inject({ method: "GET", url: "/api/weather/hourly?locationId=unknown" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "BAD_REQUEST" });

    await app.close();
  });
});
