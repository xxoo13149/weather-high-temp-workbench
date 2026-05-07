import { describe, expect, test } from "vitest";

import { buildDashboardEnhancements, getLocationSourceContract } from "../src/operational-metadata.js";

describe("buildDashboardEnhancements", () => {
  test("does not overstate multimodel availability when the current city has no usable multimodel payload", () => {
    const enhancements = buildDashboardEnhancements({
      locationId: "shanghai_pvg",
      hourly: {
        items: [
          {
            timestamp: "2026-04-22T18:00:00+08:00",
          },
        ],
        current: {
          index: 0,
        },
        freshness: "fresh",
      } as never,
      report: {
        metrics: {
          maxTemperatureC: 18,
          confidence: "high",
          predictability: "high",
        },
      } as never,
      multimodel: {
        freshness: "fresh",
        analysisStatus: "unavailable",
        imageStatus: "unavailable",
      } as never,
    });

    expect(enhancements.intradaySignals.evidence).toContain("多模型参考当前可能暂不可用，先看小时轨道和天气摘要。");
    expect(enhancements.intradaySignals.evidence).not.toContain(
      "多模型参考可以在分析页继续确认升温时间和温度区间是否稳定。",
    );
    expect(enhancements.sourceMetadata.freshness.multimodel).toBe("fallback_error");
  });

  test("formats intraday temperature guidance in the location display unit", () => {
    const enhancements = buildDashboardEnhancements({
      locationId: "miami_mia",
      hourly: {
        items: [
          {
            timestamp: "2026-04-22T09:00:00-04:00",
          },
        ],
        current: {
          index: 0,
        },
        freshness: "fresh",
      } as never,
      report: {
        metrics: {
          maxTemperatureC: 19,
          confidence: "medium",
          predictability: "medium",
        },
      } as never,
      multimodel: {
        freshness: "fresh",
        analysisStatus: "available",
        imageStatus: "available",
      } as never,
    });

    expect(enhancements.intradaySignals.headline).toContain("°F");
    expect(enhancements.intradaySignals.headline).not.toContain("°C");
    expect(enhancements.intradaySignals.baseCase).toContain("°F");
    expect(enhancements.intradaySignals.upsideCase).toContain("°F");
    expect(enhancements.intradaySignals.downsideCase).toContain("°F");
  });

  test("marks cities without stable Kelly mapping as non-production", () => {
    expect(getLocationSourceContract("laufau_shan_lfs").kellyMarketMapping).toMatchObject({
      status: "planned",
    });
    expect(getLocationSourceContract("masroor_opmr").kellyMarketMapping).toMatchObject({
      status: "candidate",
    });
    expect(getLocationSourceContract("guangzhou_can").kellyMarketMapping).toMatchObject({
      status: "production",
    });
  });
});
