import { describe, expect, test, vi } from "vitest";

import {
  resolveDefaultKellyPrewarmLocationIds,
  resolveKellyPrewarmConfig,
  runKellyPrewarmPass,
} from "../src/server/kelly-prewarm.js";

describe("kelly prewarm", () => {
  test("defaults to production Kelly cities only", () => {
    const locationIds = resolveDefaultKellyPrewarmLocationIds();

    expect(locationIds).toContain("guangzhou_can");
    expect(locationIds).not.toContain("laufau_shan_lfs");
    expect(locationIds).not.toContain("masroor_opmr");
    expect(locationIds.indexOf("miami_mia")).toBeLessThan(locationIds.indexOf("shenzhen_szx"));
  });

  test("supports explicit env overrides for the prewarm loop", () => {
    const config = resolveKellyPrewarmConfig({
      KELLY_PREWARM_ENABLED: "true",
      KELLY_PREWARM_DELAY_MS: "5000",
      KELLY_PREWARM_INTERVAL_MS: "600000",
      KELLY_PREWARM_CONCURRENCY: "2",
      KELLY_PREWARM_FORCE_REFRESH_COUNT: "3",
      KELLY_PREWARM_NEXT_DAY_WARM_COUNT: "4",
      KELLY_PREWARM_NEXT_DAY_AFTER_LOCAL_HOUR: "18",
      KELLY_PREWARM_LOCATION_IDS: "shenzhen_szx,unknown,masroor_opmr",
    });

    expect(config).toMatchObject({
      enabled: true,
      delayMs: 5_000,
      intervalMs: 600_000,
      concurrency: 2,
      locationIds: ["shenzhen_szx", "masroor_opmr"],
      forceRefreshCount: 3,
      nextDayWarmCount: 4,
      nextDayWarmAfterLocalHour: 18,
    });
  });

  test("summarizes pass successes and failures", async () => {
    const service = {
      getKellyWorkbench: vi.fn(async (locationId: string) => {
        if (locationId === "shenzhen_szx") {
          throw new Error("origin still cold");
        }

        return {
          targetDate: "2026-04-24",
          markets: [],
          inactiveMarkets: [],
        };
      }),
    };
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const summary = await runKellyPrewarmPass(
      service as never,
      {
        enabled: true,
        delayMs: 0,
        intervalMs: 0,
        concurrency: 2,
        locationIds: ["miami_mia", "shenzhen_szx"],
        forceRefreshCount: 0,
        nextDayWarmCount: 0,
        nextDayWarmAfterLocalHour: 15,
      },
      logger,
    );

    expect(service.getKellyWorkbench).toHaveBeenCalledTimes(2);
    expect(summary).toMatchObject({
      total: 2,
      succeeded: 1,
      failed: 1,
      failures: [{ locationId: "shenzhen_szx", error: "origin still cold" }],
    });
    expect(logger.warn).toHaveBeenCalled();
  });

  test("warms today for all cities, force-refreshes a rolling head chunk, and prewarms next day after the local cutoff", async () => {
    const calls: Array<{ locationId: string; options: Record<string, unknown> | undefined }> = [];
    const service = {
      getKellyWorkbench: vi.fn(async (locationId: string, options?: Record<string, unknown>) => {
        calls.push({ locationId, options });
        return {
          targetDate: options?.targetDate ?? "2026-04-24",
          markets: [],
          inactiveMarkets: [],
        };
      }),
    };

    await runKellyPrewarmPass(
      service as never,
      {
        enabled: true,
        delayMs: 0,
        intervalMs: 0,
        concurrency: 1,
        locationIds: ["miami_mia", "shenzhen_szx", "toronto_yyz"],
        forceRefreshCount: 1,
        nextDayWarmCount: 2,
        nextDayWarmAfterLocalHour: 0,
      },
      {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      {
        now: new Date("2026-04-24T12:00:00.000Z"),
        passIndex: 0,
      },
    );

    expect(calls).toEqual([
      {
        locationId: "miami_mia",
        options: {
          targetDate: "2026-04-24",
          forceRefresh: true,
        },
      },
      {
        locationId: "shenzhen_szx",
        options: {
          targetDate: "2026-04-24",
          forceRefresh: false,
        },
      },
      {
        locationId: "toronto_yyz",
        options: {
          targetDate: "2026-04-24",
          forceRefresh: false,
        },
      },
      {
        locationId: "miami_mia",
        options: {
          targetDate: "2026-04-25",
          forceRefresh: false,
        },
      },
      {
        locationId: "shenzhen_szx",
        options: {
          targetDate: "2026-04-25",
          forceRefresh: false,
        },
      },
    ]);
  });

  test("rotates the force-refresh chunk across passes while keeping summary totals by unique city", async () => {
    const calls: Array<{ locationId: string; options: Record<string, unknown> | undefined }> = [];
    const service = {
      getKellyWorkbench: vi.fn(async (locationId: string, options?: Record<string, unknown>) => {
        calls.push({ locationId, options });
        if (locationId === "toronto_yyz") {
          throw new Error("toronto cold");
        }

        return {
          targetDate: options?.targetDate ?? "2026-04-24",
          markets: [],
          inactiveMarkets: [],
        };
      }),
    };

    const summary = await runKellyPrewarmPass(
      service as never,
      {
        enabled: true,
        delayMs: 0,
        intervalMs: 0,
        concurrency: 1,
        locationIds: ["miami_mia", "shenzhen_szx", "toronto_yyz"],
        forceRefreshCount: 1,
        nextDayWarmCount: 0,
        nextDayWarmAfterLocalHour: 15,
      },
      {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      {
        now: new Date("2026-04-24T12:00:00.000Z"),
        passIndex: 1,
      },
    );

    expect(calls[0]).toEqual({
      locationId: "shenzhen_szx",
      options: {
        targetDate: "2026-04-24",
        forceRefresh: true,
      },
    });
    expect(summary).toMatchObject({
      total: 3,
      succeeded: 2,
      failed: 1,
      failures: [{ locationId: "toronto_yyz", error: "toronto cold" }],
    });
  });
});
