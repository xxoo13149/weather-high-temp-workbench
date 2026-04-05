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
    expect(first.body.toString()).toBe("png-old");

    vi.advanceTimersByTime(300_001);
    const stale = await service.getMultiModelImage("shanghai_pvg", true);
    expect(stale.stale).toBe(true);
    expect(stale.body.toString()).toBe("png-old");

    await Promise.resolve();
    await Promise.resolve();

    const refreshed = await service.getMultiModelImage("shanghai_pvg", true);
    expect(refreshed.stale).toBe(false);
    expect(refreshed.body.toString()).toBe("png-new");
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
    expect(stale.stale).toBe(true);
    expect(stale.body.toString()).toBe("png");

    await Promise.resolve();
    expect((await service.getMultiModelStatus("shanghai_pvg")).lastError).toContain("boom");
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
});



