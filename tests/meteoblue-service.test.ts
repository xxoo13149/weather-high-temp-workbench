import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { fetchTextMock, fetchBinaryMock } = vi.hoisted(() => ({
  fetchTextMock: vi.fn(),
  fetchBinaryMock: vi.fn(),
}));

vi.mock("../src/lib/http.js", () => ({
  fetchText: fetchTextMock,
  fetchBinary: fetchBinaryMock,
}));

import { FavoritesStore } from "../src/lib/favorites-store.js";
import { MeteoblueWeatherService } from "../src/providers/meteoblue/service.js";

const fixture = (name: string): string => readFileSync(join(process.cwd(), "tests", "fixtures", name), "utf8");

describe("MeteoblueWeatherService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-27T15:30:00.000Z"));
    fetchTextMock.mockReset();
    fetchBinaryMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test("returns structured 3h hourly data", async () => {
    fetchTextMock.mockResolvedValueOnce(fixture("week-complete.html")).mockResolvedValueOnce(fixture("week-meteogram-highcharts.json"));
    const service = new MeteoblueWeatherService();

    const response = await service.getHourly("shanghai_pvg", "3h", 1);

    expect(response.mode).toBe("3h");
    expect(response.sourceType).toBe("week-table-3h");
    expect(response.items).toHaveLength(1);
    expect(response.items[0]).toMatchObject({
      timestamp: "2026-03-28T03:00:00+08:00",
      temperatureC: 10,
    });
    expect(response.items[0]?.summaryZh ?? "").toMatch(/[\u4e00-\u9fff]/);
    expect(response.items[0]?.summaryZh ?? "").not.toMatch(/[A-Za-z]{2,}/);
    expect(response.stale).toBe(false);
  });

  test("returns true 1h data from the embedded meteogram", async () => {
    fetchTextMock.mockResolvedValueOnce(fixture("week-complete.html")).mockResolvedValueOnce(fixture("week-meteogram-highcharts.json"));
    const service = new MeteoblueWeatherService();

    const response = await service.getHourly("shanghai_pvg", "1h", 3);

    expect(response.mode).toBe("1h");
    expect(response.periodHours).toBe(1);
    expect(response.sourceType).toBe("week-table-1h");
    expect(response.items).toHaveLength(3);
    expect(response.items[0]).toMatchObject({
      timestamp: "2026-03-28T00:00:00+08:00",
      temperatureC: 10,
      windSpeedKphMin: 7.5,
      windSpeedKphMax: 14.5,
      precipitationMm: 0,
    });
  });

  test("keeps dashboard week data available when meteogram enrichment refresh fails", async () => {
    fetchTextMock.mockResolvedValueOnce(fixture("week-complete.html")).mockRejectedValueOnce(new Error("meteogram timeout"));
    const service = new MeteoblueWeatherService();

    const hourly = await service.getHourly("shanghai_pvg", "1h", 3);
    const report = await service.getWeatherReport("shanghai_pvg");

    expect(hourly.sourceType).toBe("week-table-1h");
    expect(hourly.items.length).toBeGreaterThan(0);
    expect(hourly.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("Embedded meteogram enrichment unavailable")]),
    );
    expect(report.available).toBe(true);
    expect(fetchTextMock).toHaveBeenCalledTimes(2);
  });

  test("isolates week caches by locationId", async () => {
    fetchTextMock
      .mockResolvedValueOnce(fixture("week-complete.html"))
      .mockResolvedValueOnce(fixture("week-meteogram-highcharts.json"))
      .mockResolvedValueOnce(fixture("week-complete.html"))
      .mockResolvedValueOnce(fixture("week-meteogram-highcharts.json"));
    const service = new MeteoblueWeatherService();

    await service.getHourly("shanghai_pvg", "1h", 1);
    await service.getHourly("miami_mia", "1h", 1);

    expect(fetchTextMock.mock.calls[0]?.[0]).toContain("shanghai-pudong-international-airport");
    expect(fetchTextMock.mock.calls[2]?.[0]).toContain("miami-international-airport");
  });

  test("reports field coverage and mixed-source semantics for 1h responses", async () => {
    fetchTextMock.mockResolvedValueOnce(fixture("week-complete.html")).mockResolvedValueOnce(fixture("week-meteogram-highcharts.json"));
    const service = new MeteoblueWeatherService();

    const response = await service.getHourly("shanghai_pvg", "1h", 24);

    expect(response.fieldCoverage.precipitationProbabilityPct.totalHours).toBe(response.items.length);
    expect(response.fieldCoverage.precipitationProbabilityPct.completeness).toBe("partial");
    expect(response.fieldCoverage.precipitationProbabilityPct.missingReasons["fallback-unavailable"]).toBeGreaterThan(0);
    expect(response.fieldCoverage.windDirection.totalHours).toBe(response.items.length);
    expect(response.fieldCoverage.mixedSources).toEqual(
      expect.arrayContaining(["week-table-1h", "week-meteogram-highcharts"]),
    );
  });

  test("keeps the dashboard 24h timeline on a single local day without stitching the next day", async () => {
    fetchTextMock.mockResolvedValueOnce(fixture("week-complete.html")).mockResolvedValueOnce(fixture("week-meteogram-highcharts.json"));
    const service = new MeteoblueWeatherService();

    const response = await service.getHourly("shanghai_pvg", "1h", 24);

    expect(response.items.length).toBeGreaterThan(0);
    expect(response.items.every((item) => item.timestamp.startsWith("2026-03-28T"))).toBe(true);
    expect(response.items.some((item) => item.timestamp.startsWith("2026-03-29T"))).toBe(false);
  });

  test("returns a translated weather report from the week page cache", async () => {
    fetchTextMock.mockResolvedValueOnce(fixture("week-complete.html")).mockResolvedValueOnce(fixture("week-meteogram-highcharts.json"));
    const service = new MeteoblueWeatherService();

    const report = await service.getWeatherReport("shanghai_pvg");

    expect(report.available).toBe(true);
    expect(report.sourceObservedAt).toBe("2026-03-27T23:30:00.000Z");
    expect(report.sourceTextEn).toContain("Weather report for Shanghai Pudong International Airport");
    expect(report.textZh).toContain("最高气温");
    expect(report.textZh).not.toContain("紫外线指数");
    expect(report.textZh).not.toContain("天气预报可信度");
    expect(report.textZh).not.toContain("UV-Index");
    expect(report.warnings).not.toContain("Weather report translation fallback applied.");
    expect(report.metrics).toMatchObject({
      maxTemperatureC: 21,
      uvIndex: 7,
      forecastDayLabel: "Saturday",
    });
  });

  test("keeps week cache usable when optional meteogram enrichment fails", async () => {
    fetchTextMock.mockResolvedValueOnce(fixture("week-complete.html")).mockRejectedValueOnce(new Error("meteogram boom"));
    const service = new MeteoblueWeatherService();

    const [hourly, report] = await Promise.all([
      service.getHourly("shanghai_pvg", "1h", 2),
      service.getWeatherReport("shanghai_pvg"),
    ]);

    expect(fetchTextMock).toHaveBeenCalledTimes(2);
    expect(hourly.sourceType).toBe("week-table-1h");
    expect(hourly.items).toHaveLength(2);
    expect(hourly.items[0]).toMatchObject({
      timestamp: "2026-03-28T03:00:00+08:00",
      temperatureC: 10,
    });
    expect(hourly.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("Embedded meteogram enrichment unavailable")]),
    );
    expect(report.available).toBe(true);
    expect(report.textZh).toContain("最高气温");
  });

  test("fails closed when the multimodel image cannot be refreshed and stale is not allowed", async () => {
    fetchTextMock.mockResolvedValue(fixture("multimodel.html"));
    fetchBinaryMock.mockResolvedValueOnce({
      body: Buffer.from("png"),
      contentType: "image/png",
      headers: new Headers(),
    });

    const service = new MeteoblueWeatherService();
    await service.getMultiModelImage("shanghai_pvg", false);

    vi.advanceTimersByTime(300_001);
    fetchBinaryMock.mockRejectedValueOnce(new Error("boom"));

    await expect(service.getMultiModelImage("shanghai_pvg", false)).rejects.toMatchObject({
      code: "MULTIMODEL_IMAGE_UNAVAILABLE",
      staleAvailable: true,
    });
  });

  test("returns stale multimodel image immediately and refreshes in background", async () => {
    fetchTextMock.mockResolvedValue(fixture("multimodel.html"));
    fetchBinaryMock
      .mockResolvedValueOnce({
        body: Buffer.from("png-old"),
        contentType: "image/png",
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        body: Buffer.from("png-new"),
        contentType: "image/png",
        headers: new Headers(),
      });

    const service = new MeteoblueWeatherService();
    const first = await service.getMultiModelImage("shanghai_pvg", true);
    expect(first.stale).toBe(false);
    expect(first.freshness).toBe("fresh");
    expect(first.body.toString()).toBe("png-old");

    vi.advanceTimersByTime(300_001);
    const stale = await service.getMultiModelImage("shanghai_pvg", true);
    expect(stale.stale).toBe(false);
    expect(stale.freshness).toBe("revalidating");
    expect(stale.body.toString()).toBe("png-old");

    await Promise.resolve();
    await Promise.resolve();

    await vi.waitFor(async () => {
      const refreshed = await service.getMultiModelImage("shanghai_pvg", true);
      expect(refreshed.stale).toBe(false);
      expect(refreshed.freshness).toBe("fresh");
      expect(refreshed.body.toString()).toBe("png-new");
    });
  });

  test("returns stale multimodel image when background refresh fails", async () => {
    fetchTextMock.mockResolvedValue(fixture("multimodel.html"));
    fetchBinaryMock.mockResolvedValueOnce({
      body: Buffer.from("png"),
      contentType: "image/png",
      headers: new Headers(),
    });

    const service = new MeteoblueWeatherService();
    await service.getMultiModelImage("shanghai_pvg", true);

    vi.advanceTimersByTime(300_001);
    fetchBinaryMock.mockRejectedValueOnce(new Error("boom"));

    const stale = await service.getMultiModelImage("shanghai_pvg", true);
    expect(stale.stale).toBe(false);
    expect(stale.freshness).toBe("revalidating");
    expect(stale.body.toString()).toBe("png");

    await vi.waitFor(async () => {
      const status = await service.getMultiModelStatus("shanghai_pvg");
      expect(status.lastError).toContain("boom");
      expect(status.imageStatus).toBe("ready");
      expect(status.analysisStatus).toBe("unavailable");
    });
  });

  test("reports multimodel cache status", async () => {
    fetchTextMock.mockResolvedValue(fixture("multimodel.html"));
    fetchBinaryMock.mockResolvedValueOnce({
      body: Buffer.from("png"),
      contentType: "image/png",
      headers: new Headers(),
    });

    const service = new MeteoblueWeatherService();
    await service.getMultiModelImage("shanghai_pvg", false);

    const status = await service.getMultiModelStatus("shanghai_pvg");
    expect(status).toMatchObject({
      imageUrlFound: true,
      stale: false,
      imageUrl: "https://my.meteoblue.com/images/meteogram_multimodel?format=png&download=1&sig=abc123",
    });
  });

  test("reports multimodel analysis as unavailable after a cold refresh failure without stale cache", async () => {
    fetchTextMock.mockRejectedValueOnce(new Error("multimodel boom"));

    const service = new MeteoblueWeatherService();

    await expect(service.getMultiModelDistribution("shanghai_pvg")).rejects.toMatchObject({
      code: "MULTIMODEL_DISTRIBUTION_UNAVAILABLE",
    });

    const status = await service.getMultiModelStatus("shanghai_pvg");
    expect(status.analysisStatus).toBe("unavailable");
    expect(status.lastError).toContain("multimodel boom");
    expect(status.freshness).not.toBe("fallback_error");
  });

  test("builds multimodel distribution from page highcharts data", async () => {
    fetchTextMock
      .mockResolvedValueOnce(fixture("multimodel.html"))
      .mockResolvedValueOnce(fixture("multimodel-highcharts.json"));

    const service = new MeteoblueWeatherService();
    const distribution = await service.getMultiModelDistribution("shanghai_pvg", "2026-03-28T04:00:00+08:00", 1);

    expect(distribution.sourceType).toBe("meteoblue-page-highcharts");
    expect(distribution.selectedTimestamp).toBe("2026-03-28T04:00:00+08:00");
    expect(distribution.bucketSizeC).toBe(1);
    expect(distribution.modelCount).toBe(3);
    expect(distribution.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          modelName: "IFS 0.25°",
          temperatureC: 19.4,
          peakTemperatureC: 21,
          peakTimestamp: "2026-03-28T05:00:00+08:00",
        }),
      ]),
    );
  });


  test("persists favorites through local store", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "weather-favorites-"));
    const store = new FavoritesStore(join(tempDir, "favorites.json"));
    const service = new MeteoblueWeatherService({ favoritesStore: store });

    try {
      const initial = await service.getUserFavorites();
      expect(initial.locationIds).toEqual([]);

      const updated = await service.setUserFavorite("shanghai_pvg", true);
      expect(updated.locationIds).toEqual(["shanghai_pvg"]);

      const expanded = await service.setUserFavorite("miami_mia", true);
      expect(expanded.locationIds).toEqual(["miami_mia", "shanghai_pvg"]);

      const restored = await service.getUserFavorites();
      expect(restored.locationIds).toEqual(["miami_mia", "shanghai_pvg"]);

      await expect(service.setUserFavorite("unknown" as never, true)).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("adds model inventory with page last update from multimodel page", async () => {
    fetchTextMock
      .mockResolvedValueOnce(fixture("multimodel-inventory.html"))
      .mockResolvedValueOnce(fixture("multimodel-highcharts.json"));

    const service = new MeteoblueWeatherService();
    const distribution = await service.getMultiModelDistribution("shanghai_pvg", "2026-03-28T04:00:00+08:00", 1);

    expect(distribution.modelInventory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          displayName: "IFS 0.25°",
          pageOrder: 0,
          pageLastUpdatedAt: "2026-04-04T00:00:00.000Z",
          pageLastUpdatedLabel: "00:00 UTC",
          sourceDisplayName: "IFS 0.25°",
        }),
      ]),
    );
  });
  test("fails closed when the multimodel page does not expose a highcharts url", async () => {
    fetchTextMock.mockResolvedValue(fixture("multimodel-missing.html"));
    const service = new MeteoblueWeatherService();

    await expect(service.getMultiModelDistribution("shanghai_pvg")).rejects.toMatchObject({
      code: "MULTIMODEL_HIGHCHARTS_URL_NOT_FOUND",
      retryable: true,
    });
  });

  test("does not block foreground multimodel requests behind other location loads", async () => {
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    let gatedPageLoads = 0;

    fetchTextMock.mockImplementation(async (url: string) => {
      const isHighchartsRequest = /format=highcharts|highcharts\.json|download=1/i.test(url);
      if (!isHighchartsRequest && gatedPageLoads < 2) {
        gatedPageLoads += 1;
        await gate;
        return fixture("multimodel.html");
      }

      return isHighchartsRequest ? fixture("multimodel-highcharts.json") : fixture("multimodel.html");
    });

    const service = new MeteoblueWeatherService();
    const first = service.getMultiModelDistribution("shanghai_pvg");
    const second = service.getMultiModelDistribution("wuhan_wuh");

    await Promise.resolve();
    await Promise.resolve();

    const third = service.getMultiModelInsight("toronto_yyz").catch((error) => error);

    await expect(third).resolves.toMatchObject({
      location: {
        id: "toronto_yyz",
      },
      modelCount: expect.any(Number),
    });

    releaseGate();
    await Promise.allSettled([first, second]);
  });

  test("reuses a recent Kelly snapshot during the stream bootstrap window", async () => {
    const service = new MeteoblueWeatherService();
    const buildKellyWorkbenchSnapshot = vi.spyOn(service as any, "buildKellyWorkbenchSnapshot").mockResolvedValue({
      location: {
        id: "miami_mia",
        name: "Miami International Airport",
        timezone: "America/New_York",
      },
      targetDate: "2026-03-28",
      generatedAt: "2026-03-28T00:00:00.000Z",
      probabilityCurve: [],
      distributionSummary: {
        shrink: 0.86,
      },
    } as any);
    const request = {
      targetDate: "2026-03-28",
      bankroll: 1_000,
      riskMode: "balanced",
      minEdge: 0.02,
    } as const;

    const first = await service.getKellyWorkbench("miami_mia", request);
    const second = await service.getKellyWorkbench("miami_mia", request);

    expect(second).toBe(first);
    expect(buildKellyWorkbenchSnapshot).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5_001);

    await service.getKellyWorkbench("miami_mia", request);

    expect(buildKellyWorkbenchSnapshot).toHaveBeenCalledTimes(2);
  });

  test("preserves the previous Kelly market snapshot when a force refresh comes back empty", async () => {
    const service = new MeteoblueWeatherService();
    const discoverMarkets = vi.spyOn((service as any).polymarketClient, "discoverMarkets");
    const sourceLinks = {
      meteoblueWeekUrl: "https://example.com/week/miami",
      meteoblueMultimodelUrl: "https://example.com/multimodel/miami",
      polymarketSearchUrl: "https://example.com/search/miami",
      marketUrls: ["https://example.com/market/miami-83f"],
    };
    discoverMarkets
      .mockResolvedValueOnce({
        fetchedAt: "2026-04-12T19:00:00.000Z",
        candidates: [
          {
            marketId: "miami-83f",
            slug: "miami-83f",
            title: "Will the highest temperature in Miami be 83F on April 12?",
            marketUrl: "https://example.com/market/miami-83f",
            conditionId: "condition-miami-83f",
            contractType: "exact",
            unit: "F",
            bucketStartC: 28.3,
            bucketEndC: 28.3,
            bucketLabel: "83.0F",
            lifecycle: "tradable",
            inactiveReason: null,
            parseStatus: "matched",
            exclusionReason: null,
            yesTokenId: "yes-miami-83f",
            noTokenId: "no-miami-83f",
            updatedAt: "2026-04-12T19:00:00.000Z",
            eventTitle: "Highest temperature in Miami on April 12?",
            eventUrl: "https://example.com/event/miami",
            liquidity: 1000,
            volume24h: 100,
            description: null,
            resolutionSource: null,
            active: true,
            closed: false,
            acceptingOrders: true,
            archived: false,
            enableOrderBook: true,
            endsAt: "2026-04-12T23:59:00-04:00",
          },
        ],
        inactiveCandidates: [],
        sourceLinks,
      })
      .mockResolvedValueOnce({
        fetchedAt: "2026-04-12T19:01:00.000Z",
        candidates: [],
        inactiveCandidates: [],
        sourceLinks: {
          ...sourceLinks,
          marketUrls: [],
        },
      });

    const cache = (service as any).getKellyMarketCache("miami_mia", "2026-04-12");

    const first = await cache.get();
    expect(first.stale).toBe(false);
    expect(first.value.candidates).toHaveLength(1);

    const refreshed = await cache.get({
      allowStaleOnError: true,
      forceRefresh: true,
    });
    expect(refreshed.stale).toBe(true);
    expect(refreshed.freshness).toBe("fallback_error");
    expect(refreshed.value.candidates).toHaveLength(1);
    expect(refreshed.value.candidates[0]).toMatchObject({
      marketId: "miami-83f",
    });
  });

  test("returns empty dashboard snapshots when cold METAR or TAF fetches fail", async () => {
    const service = new MeteoblueWeatherService();

    (service as any).getMetarCache = vi.fn(() => ({
      get: vi.fn().mockRejectedValue(new Error("metar boom")),
    }));
    (service as any).getTafCache = vi.fn(() => ({
      get: vi.fn().mockRejectedValue(new Error("taf boom")),
    }));

    await expect(service.getMetarSnapshot("shanghai_pvg")).resolves.toEqual({
      observation: null,
      recentTemperatures: [],
    });
    await expect(service.getTafSnapshot("shanghai_pvg")).resolves.toEqual({
      forecast: null,
      forecasts: [],
    });
  });

  test("falls back to the last Kelly snapshot when a later refresh fails", async () => {
    const service = new MeteoblueWeatherService();
    const buildKellyWorkbenchSnapshot = vi.spyOn(service as any, "buildKellyWorkbenchSnapshot");
    const baseSnapshot = {
      location: {
        id: "shanghai_pvg",
        name: "Shanghai Pudong International Airport",
        timezone: "Asia/Shanghai",
      },
      targetDate: "2026-04-24",
      availableTargetDates: ["2026-04-24"],
      generatedAt: "2026-04-23T23:59:00.000Z",
      bankroll: 1000,
      riskMode: "balanced",
      riskMultiplier: 0.5,
      minEdge: 0.02,
      displayUnit: "C",
      weatherEvidence: {
        location: {
          id: "shanghai_pvg",
          name: "Shanghai Pudong International Airport",
          timezone: "Asia/Shanghai",
        },
        targetDate: "2026-04-24",
        availableTargetDates: ["2026-04-24"],
        currentReferenceTemperatureC: 22,
        currentReferenceSource: "metar",
        currentWeatherTimestamp: "2026-04-24T00:00:00+08:00",
        currentModelTimestamp: "2026-04-24T00:00:00+08:00",
        targetModelTimestamp: "2026-04-24T12:00:00+08:00",
        observationFloorTemperatureC: 22,
        observationFloorSource: "metar",
        observationFloorObservedAt: "2026-04-24T00:00:00+08:00",
        metarObservation: null,
        tafForecast: null,
        sourceSummaryZh: "test",
        hourlyPageUrl: "https://example.com/week/shanghai_pvg",
        multimodelPageUrl: "https://example.com/multimodel/shanghai_pvg",
        fetchedAt: "2026-04-23T23:59:00.000Z",
        stale: false,
        participatingModelCount: 1,
        excludedModels: [],
      },
      distributionSummary: {
        meanTemperatureC: 22,
        medianTemperatureC: 22,
        modeTemperatureC: 22,
        mostLikelyRangeLabel: "22C - 23C",
        shrink: 0.8,
        usableModelCount: 1,
        totalModelCount: 1,
        peakSpreadC: 0.4,
      },
      probabilityCurve: [],
      bucketProbabilities: [],
      markets: [],
      inactiveMarkets: [],
      recommendations: [],
      bestObservation: null,
      unresolvedMarkets: [],
      marketEvidence: [],
      methodology: {
        generatedAt: "2026-04-23T23:59:00.000Z",
        formulaVersion: "test",
        referenceTemperatureC: 22,
        referenceSource: "metar",
        shrink: 0.8,
        shrinkMode: "heuristic",
        shrinkInputs: {
          disagreement: 0.1,
          biasDispersion: 0.1,
          missingRatio: 0,
          stalePenalty: 0,
        },
        peakSpreadC: 0.4,
        usableModelCount: 1,
        totalModelCount: 1,
        summaries: {
          referenceRule: "test",
          adjustmentRule: "test",
          weightRule: "test",
          shrinkRule: "test",
          pricingRule: "test",
          observationRule: "test",
        },
        formulaNotes: [],
        probabilitySteps: [],
        models: [],
      },
      frameSeries: [],
      sourceLinks: {
        meteoblueWeekUrl: "https://example.com/week/shanghai_pvg",
        meteoblueMultimodelUrl: "https://example.com/multimodel/shanghai_pvg",
        polymarketSearchUrl: "https://example.com/polymarket/search",
        marketUrls: [],
      },
      freshness: {
        weatherGeneratedAt: "2026-04-23T23:59:00.000Z",
        marketDiscoveredAt: "2026-04-23T23:59:00.000Z",
        orderbookFetchedAt: "2026-04-23T23:59:00.000Z",
        repricedAt: "2026-04-23T23:59:00.000Z",
        lastStreamEventAt: "2026-04-23T23:59:00.000Z",
        marketMotionState: "live",
      },
      streamHealth: {
        state: "unavailable",
        reasonCode: "awaiting_client_subscription",
        message: "waiting",
        lastSignalAt: null,
        lastRepricedAt: null,
      },
      sourceStatus: [],
      warnings: [],
    } as any;

    buildKellyWorkbenchSnapshot.mockResolvedValueOnce(baseSnapshot).mockRejectedValueOnce(new Error("refresh boom"));

    const first = await service.getKellyWorkbench("shanghai_pvg", { targetDate: "2026-04-24" });
    expect(first.generatedAt).toBe("2026-04-23T23:59:00.000Z");

    vi.advanceTimersByTime(5_001);

    const second = await service.getKellyWorkbench("shanghai_pvg", { targetDate: "2026-04-24" });
    expect(second.generatedAt).toBe("2026-04-23T23:59:00.000Z");
    expect(second.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("当前继续沿用上一轮可用快照")]),
    );
  });
});



