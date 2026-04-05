import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import {
  buildMultiModelDistributionResponse,
  buildMultiModelInsightResponse,
  parseMultiModelHighcharts,
  summarizeMultiModelTemperatureDataset,
} from "../src/providers/meteoblue/multimodel-distribution.js";

const fixture = (name: string): string =>
  readFileSync(join(process.cwd(), "tests", "fixtures", name), "utf8");

const location = {
  id: "shanghai_pvg" as const,
  name: "Shanghai Pudong International Airport",
  timezone: "Asia/Shanghai",
};

const modelInventory = [
  {
    modelName: "Model A",
    displayName: "Model A",
    pageOrder: 0,
    pageLastUpdatedAt: "2026-03-31T01:00:00.000Z",
    pageLastUpdatedLabel: "2026-03-31 01:00 UTC",
    sourceDisplayName: "Model A",
    modelCode: "A",
  },
  {
    modelName: "Model B",
    displayName: "Model B",
    pageOrder: 1,
    pageLastUpdatedAt: "2026-03-31T01:00:00.000Z",
    pageLastUpdatedLabel: "2026-03-31 01:00 UTC",
    sourceDisplayName: "Model B",
    modelCode: "B",
  },
  {
    modelName: "Model C",
    displayName: "Model C",
    pageOrder: 2,
    pageLastUpdatedAt: "2026-03-31T01:00:00.000Z",
    pageLastUpdatedLabel: "2026-03-31 01:00 UTC",
    sourceDisplayName: "Model C",
    modelCode: "C",
  },
];

describe("multimodel distribution parser", () => {
  test("parses a page highcharts export and summarizes one hour", () => {
    const dataset = parseMultiModelHighcharts(fixture("multimodel-highcharts.json"), "Asia/Shanghai");
    const summary = summarizeMultiModelTemperatureDataset(dataset, "2026-03-28T04:00:00+08:00", 1);

    expect(dataset.timestamps).toEqual([
      "2026-03-28T03:00:00+08:00",
      "2026-03-28T04:00:00+08:00",
      "2026-03-28T05:00:00+08:00",
    ]);
    expect(dataset.models.map((model) => model.displayName)).toEqual(["IFS 0.25°", "ICON", "GEM 15 km"]);
    expect(summary.selectedTimestamp).toBe("2026-03-28T04:00:00+08:00");
    expect(summary.members).toEqual([
      {
        modelName: "GEM 15 km",
        temperatureC: 18.8,
        peakTemperatureC: 19.9,
        peakTimestamp: "2026-03-28T05:00:00+08:00",
      },
      {
        modelName: "IFS 0.25°",
        temperatureC: 19.4,
        peakTemperatureC: 21,
        peakTimestamp: "2026-03-28T05:00:00+08:00",
      },
      {
        modelName: "ICON",
        temperatureC: 20.1,
        peakTemperatureC: 20.6,
        peakTimestamp: "2026-03-28T05:00:00+08:00",
      },
    ]);
  });

  test("prefers point.name local hour even when x matches the same instant", () => {
    const raw = JSON.stringify({
      series: [
        {
          name: "IFS025",
          type: "scatter",
          xAxis: 0,
          yAxis: 0,
          data: [
            { name: "2026-03-31 00:00", x: Date.parse("2026-03-30T16:00:00.000Z"), y: 18.2 },
            { name: "2026-03-31 01:00", x: Date.parse("2026-03-30T17:00:00.000Z"), y: 18.5 },
            { name: "2026-03-31 02:00", x: Date.parse("2026-03-30T18:00:00.000Z"), y: 18.7 },
          ],
        },
      ],
    });

    const dataset = parseMultiModelHighcharts(raw, "Asia/Shanghai");

    expect(dataset.timestamps).toEqual([
      "2026-03-31T00:00:00+08:00",
      "2026-03-31T01:00:00+08:00",
      "2026-03-31T02:00:00+08:00",
    ]);
    expect(dataset.timestampSource).toBe("point-name-local");
    expect(dataset.detectedXOffsetMinutes).toBe(0);
  });

  test("records a stable +8 hour offset when x carries a utc shell", () => {
    const raw = JSON.stringify({
      series: [
        {
          name: "IFS025",
          type: "scatter",
          xAxis: 0,
          yAxis: 0,
          data: [
            { name: "2026-03-31 00:00", x: Date.parse("2026-03-31T00:00:00.000Z"), y: 18.2 },
            { name: "2026-03-31 01:00", x: Date.parse("2026-03-31T01:00:00.000Z"), y: 18.5 },
            { name: "2026-03-31 02:00", x: Date.parse("2026-03-31T02:00:00.000Z"), y: 18.7 },
          ],
        },
      ],
    });

    const dataset = parseMultiModelHighcharts(raw, "Asia/Shanghai");

    expect(dataset.timestamps).toEqual([
      "2026-03-31T00:00:00+08:00",
      "2026-03-31T01:00:00+08:00",
      "2026-03-31T02:00:00+08:00",
    ]);
    expect(dataset.timestampSource).toBe("point-name-local");
    expect(dataset.detectedXOffsetMinutes).toBe(480);
  });

  test("builds insights by closest model and same-day peak distribution", () => {
    const response = buildMultiModelInsightResponse(
      {
        fetchedAt: "2026-03-31T01:30:00.000Z",
        pageFetchedAt: "2026-03-31T01:29:00.000Z",
        highchartsUrl: "https://example.com/images/meteogram_multimodel?format=highcharts&sig=abc",
        dataset: {
          timestamps: [
            "2026-03-31T09:00:00+08:00",
            "2026-03-31T12:00:00+08:00",
            "2026-03-31T15:00:00+08:00",
          ],
          models: [
            { modelName: "A", displayName: "Model A", values: [21, 27, 26] },
            { modelName: "B", displayName: "Model B", values: [20.2, 25, 24] },
            { modelName: "C", displayName: "Model C", values: [19.8, 26, 25.5] },
          ],
        timestampSource: "point-name-local" as const,
          detectedXOffsetMinutes: 480,
        },
        modelInventory,
        warnings: [],
      },
      location,
      "https://example.com/multimodel",
      {
        requestedTimestamp: "2026-03-31T09:00:00+08:00",
        actualTemperatureC: 20,
        nowIso: "2026-03-31T09:10:00+08:00",
      },
      {
        stale: false,
        cacheHit: true,
      },
    );

    expect(response.selectedTimestamp).toBe("2026-03-31T09:00:00+08:00");
    expect(response.modelInventory).toHaveLength(3);
    expect(response.rankedModels.map((model) => model.modelName)).toEqual(["Model C", "Model B", "Model A"]);
    expect(response.peakTimeDistribution).toEqual([
      {
        timestamp: "2026-03-31T12:00:00+08:00",
        modelCount: 3,
        avgPeakTemperatureC: 26,
        minPeakTemperatureC: 25,
        maxPeakTemperatureC: 27,
        modelNames: ["Model A", "Model C", "Model B"],
        peakModels: [
          { modelName: "Model A", dayPeakTemperatureC: 27 },
          { modelName: "Model C", dayPeakTemperatureC: 26 },
          { modelName: "Model B", dayPeakTemperatureC: 25 },
        ],
      },
    ]);
  });

  test("aligns default selected timestamp between insight and distribution when timestamp is omitted", () => {
    const cacheValue = {
      fetchedAt: "2026-03-31T01:30:00.000Z",
      pageFetchedAt: "2026-03-31T01:29:00.000Z",
      highchartsUrl: "https://example.com/images/meteogram_multimodel?format=highcharts&sig=abc",
      dataset: {
        timestamps: [
          "2026-03-31T09:00:00+08:00",
          "2026-03-31T12:00:00+08:00",
          "2026-03-31T15:00:00+08:00",
        ],
        models: [
          { modelName: "A", displayName: "Model A", values: [21, 27, 26] },
          { modelName: "B", displayName: "Model B", values: [20.2, 25, 24] },
          { modelName: "C", displayName: "Model C", values: [19.8, 26, 25.5] },
        ],
        timestampSource: "point-name-local" as const,
        detectedXOffsetMinutes: 480,
      },
      modelInventory,
      warnings: [],
    };
    const nowIso = "2026-03-31T12:10:00+08:00";

    const insight = buildMultiModelInsightResponse(
      cacheValue,
      location,
      "https://example.com/multimodel",
      {
        nowIso,
      },
      {
        stale: false,
        cacheHit: true,
      },
    );
    const distribution = buildMultiModelDistributionResponse(
      cacheValue,
      location,
      "https://example.com/multimodel",
      undefined,
      nowIso,
      1,
      {
        stale: false,
        cacheHit: true,
      },
    );

    expect(insight.selectedTimestamp).toBe("2026-03-31T12:00:00+08:00");
    expect(distribution.selectedTimestamp).toBe(insight.selectedTimestamp);
  });

  test("filters internal inventory alignment warnings from both insight and distribution responses", () => {
    const cacheValue = {
      fetchedAt: "2026-03-31T01:30:00.000Z",
      pageFetchedAt: "2026-03-31T01:29:00.000Z",
      highchartsUrl: "https://example.com/images/meteogram_multimodel?format=highcharts&sig=abc",
      dataset: {
        timestamps: [
          "2026-03-31T09:00:00+08:00",
          "2026-03-31T12:00:00+08:00",
        ],
        models: [
          { modelName: "A", displayName: "Model A", values: [21, 27] },
          { modelName: "B", displayName: "Model B", values: [20.2, 25] },
        ],
        timestampSource: "point-name-local" as const,
        detectedXOffsetMinutes: 480,
      },
      modelInventory: modelInventory.slice(0, 2),
      warnings: [
        "Selected model WRFGR is missing in parsed highcharts series.",
        "No model table row matched selected domain WRFGR.",
        "Serving stale page-derived multimodel statistics because the latest highcharts refresh failed.",
      ],
    };
    const nowIso = "2026-03-31T09:10:00+08:00";

    const insight = buildMultiModelInsightResponse(
      cacheValue,
      location,
      "https://example.com/multimodel",
      {
        nowIso,
      },
      {
        stale: false,
        cacheHit: true,
      },
    );
    const distribution = buildMultiModelDistributionResponse(
      cacheValue,
      location,
      "https://example.com/multimodel",
      undefined,
      nowIso,
      1,
      {
        stale: false,
        cacheHit: true,
      },
    );

    expect(insight.warnings).not.toContain("Selected model WRFGR is missing in parsed highcharts series.");
    expect(insight.warnings).not.toContain("No model table row matched selected domain WRFGR.");
    expect(distribution.warnings).not.toContain("Selected model WRFGR is missing in parsed highcharts series.");
    expect(distribution.warnings).not.toContain("No model table row matched selected domain WRFGR.");
    expect(insight.warnings).toContain(
      "Serving stale page-derived multimodel statistics because the latest highcharts refresh failed.",
    );
    expect(distribution.warnings).toContain(
      "Serving stale page-derived multimodel statistics because the latest highcharts refresh failed.",
    );
  });

  test("computes day peak within the selected timestamp local day only", () => {
    const response = buildMultiModelInsightResponse(
      {
        fetchedAt: "2026-03-31T12:30:00.000Z",
        pageFetchedAt: "2026-03-31T12:29:00.000Z",
        highchartsUrl: "https://example.com/images/meteogram_multimodel?format=highcharts&sig=abc",
        dataset: {
          timestamps: [
            "2026-03-31T20:00:00+08:00",
            "2026-03-31T23:00:00+08:00",
            "2026-04-01T01:00:00+08:00",
          ],
          models: [{ modelName: "A", displayName: "Model A", values: [20, 24, 30] }],
          timestampSource: "point-name-local" as const,
          detectedXOffsetMinutes: 480,
        },
        modelInventory: [modelInventory[0]!],
        warnings: [],
      },
      location,
      "https://example.com/multimodel",
      {
        requestedTimestamp: "2026-03-31T20:00:00+08:00",
        actualTemperatureC: 20,
      },
      {
        stale: false,
        cacheHit: true,
      },
    );

    expect(response.closestModel).toEqual({
      modelName: "Model A",
      currentTemperatureC: 20,
      deltaToActualTemperatureC: 0,
      dayPeakTemperatureC: 24,
      dayPeakTimestamp: "2026-03-31T23:00:00+08:00",
    });
  });

  test("keeps highest-temperature distribution peaks inside the selected local day", () => {
    const cacheValue = {
      fetchedAt: "2026-03-31T12:30:00.000Z",
      pageFetchedAt: "2026-03-31T12:29:00.000Z",
      highchartsUrl: "https://example.com/images/meteogram_multimodel?format=highcharts&sig=abc",
      dataset: {
        timestamps: [
          "2026-03-31T20:00:00+08:00",
          "2026-03-31T23:00:00+08:00",
          "2026-04-01T01:00:00+08:00",
        ],
        models: [{ modelName: "A", displayName: "Model A", values: [20, 24, 30] }],
        timestampSource: "point-name-local" as const,
        detectedXOffsetMinutes: 480,
      },
      modelInventory: [modelInventory[0]!],
      warnings: [],
    };

    const distribution = buildMultiModelDistributionResponse(
      cacheValue,
      location,
      "https://example.com/multimodel",
      "2026-03-31T20:00:00+08:00",
      "2026-03-31T20:10:00+08:00",
      1,
      {
        stale: false,
        cacheHit: true,
      },
    );

    expect(distribution.members[0]).toEqual({
      modelName: "Model A",
      temperatureC: 20,
      peakTemperatureC: 24,
      peakTimestamp: "2026-03-31T23:00:00+08:00",
    });
    expect(distribution.peakDistribution).toEqual([
      {
        bucketStartC: 24,
        bucketEndC: 25,
        label: "24.0 - 25.0 °C",
        count: 1,
        models: ["Model A"],
      },
    ]);
  });

  test("keeps peakDistribution within the selected local day window", () => {
    const distribution = buildMultiModelDistributionResponse(
      {
        fetchedAt: "2026-03-31T12:30:00.000Z",
        pageFetchedAt: "2026-03-31T12:29:00.000Z",
        highchartsUrl: "https://example.com/images/meteogram_multimodel?format=highcharts&sig=abc",
        dataset: {
          timestamps: [
            "2026-03-31T20:00:00+08:00",
            "2026-03-31T23:00:00+08:00",
            "2026-04-01T01:00:00+08:00",
          ],
          models: [
            { modelName: "A", displayName: "Model A", values: [20, 24, 30] },
            { modelName: "B", displayName: "Model B", values: [19, 22, 29] },
          ],
          timestampSource: "point-name-local",
          detectedXOffsetMinutes: 480,
        },
        modelInventory: modelInventory.slice(0, 2),
        warnings: [],
      },
      location,
      "https://example.com/multimodel",
      "2026-03-31T20:00:00+08:00",
      "2026-03-31T20:05:00+08:00",
      1,
      {
        stale: false,
        cacheHit: true,
      },
    );

    expect(distribution.highlights.highestPeakMember).toEqual({
      modelName: "Model A",
      temperatureC: 20,
      peakTemperatureC: 24,
      peakTimestamp: "2026-03-31T23:00:00+08:00",
    });
    expect(distribution.peakDistribution).toEqual([
      {
        bucketStartC: 22,
        bucketEndC: 23,
        label: "22.0 - 23.0 °C",
        count: 1,
        models: ["Model B"],
      },
      {
        bucketStartC: 24,
        bucketEndC: 25,
        label: "24.0 - 25.0 °C",
        count: 1,
        models: ["Model A"],
      },
    ]);
  });

  test("fails closed when timestamps are not strictly ascending", () => {
    expect(() =>
      summarizeMultiModelTemperatureDataset(
        {
          timestamps: ["2026-03-31T12:00:00+08:00", "2026-03-31T09:00:00+08:00"],
          models: [{ modelName: "A", displayName: "Model A", values: [21, 20] }],
          timestampSource: "point-name-local",
          detectedXOffsetMinutes: null,
        },
        "2026-03-31T12:00:00+08:00",
        1,
      ),
    ).toThrow(/strictly ascending/);
  });

  test("fails closed when model value length mismatches timestamps", () => {
    expect(() =>
      summarizeMultiModelTemperatureDataset(
        {
          timestamps: ["2026-03-31T09:00:00+08:00", "2026-03-31T12:00:00+08:00"],
          models: [{ modelName: "A", displayName: "Model A", values: [21] }],
          timestampSource: "point-name-local",
          detectedXOffsetMinutes: null,
        },
        "2026-03-31T09:00:00+08:00",
        1,
      ),
    ).toThrow(/same number of values/);
  });

  test("computes peakDistribution within selected local day only", () => {
    const summary = summarizeMultiModelTemperatureDataset(
      {
        timestamps: [
          "2026-04-04T20:00:00+03:00",
          "2026-04-04T23:00:00+03:00",
          "2026-04-05T01:00:00+03:00",
        ],
        models: [
          { modelName: "A", displayName: "Model A", values: [10, 14, 22] },
          { modelName: "B", displayName: "Model B", values: [11, 13, 21] },
        ],
        timestampSource: "point-name-local" as const,
        detectedXOffsetMinutes: 180,
      },
      "2026-04-04T20:00:00+03:00",
      1,
    );

    expect(summary.members).toEqual([
      {
        modelName: "Model A",
        temperatureC: 10,
        peakTemperatureC: 14,
        peakTimestamp: "2026-04-04T23:00:00+03:00",
      },
      {
        modelName: "Model B",
        temperatureC: 11,
        peakTemperatureC: 13,
        peakTimestamp: "2026-04-04T23:00:00+03:00",
      },
    ]);
    expect(summary.peakDistribution).toEqual([
      {
        bucketStartC: 13,
        bucketEndC: 14,
        label: "13.0 - 14.0 °C",
        count: 1,
        models: ["Model B"],
      },
      {
        bucketStartC: 14,
        bucketEndC: 15,
        label: "14.0 - 15.0 °C",
        count: 1,
        models: ["Model A"],
      },
    ]);
  });

  test("aligns default distribution timestamp with insight nearest-now selection", () => {
    const cacheValue = {
      fetchedAt: "2026-03-31T01:30:00.000Z",
      pageFetchedAt: "2026-03-31T01:29:00.000Z",
      highchartsUrl: "https://example.com/images/meteogram_multimodel?format=highcharts&sig=abc",
      dataset: {
        timestamps: [
          "2026-03-31T09:00:00+08:00",
          "2026-03-31T12:00:00+08:00",
          "2026-03-31T15:00:00+08:00",
        ],
        models: [
          { modelName: "A", displayName: "Model A", values: [21, 27, 26] },
          { modelName: "B", displayName: "Model B", values: [20.2, 25, 24] },
          { modelName: "C", displayName: "Model C", values: [19.8, 26, 25.5] },
        ],
        timestampSource: "point-name-local" as const,
        detectedXOffsetMinutes: 480,
      },
      modelInventory,
      warnings: [],
    };

    const nowIso = "2026-03-31T11:40:00+08:00";
    const distribution = buildMultiModelDistributionResponse(
      cacheValue,
      location,
      "https://example.com/multimodel",
      undefined,
      nowIso,
      1,
      {
        stale: false,
        cacheHit: true,
      },
    );
    const insight = buildMultiModelInsightResponse(
      cacheValue,
      location,
      "https://example.com/multimodel",
      {
        nowIso,
      },
      {
        stale: false,
        cacheHit: true,
      },
    );

    expect(distribution.selectedTimestamp).toBe("2026-03-31T12:00:00+08:00");
    expect(distribution.selectedTimestamp).toBe(insight.selectedTimestamp);
  });

  test("filters internal inventory alignment warnings from distribution responses", () => {
    const response = buildMultiModelDistributionResponse(
      {
        fetchedAt: "2026-03-31T01:30:00.000Z",
        pageFetchedAt: "2026-03-31T01:29:00.000Z",
        highchartsUrl: "https://example.com/images/meteogram_multimodel?format=highcharts&sig=abc",
        dataset: {
          timestamps: ["2026-03-31T09:00:00+08:00"],
          models: [{ modelName: "A", displayName: "Model A", values: [21] }],
          timestampSource: "point-name-local" as const,
          detectedXOffsetMinutes: 480,
        },
        modelInventory: [modelInventory[0]!],
        warnings: [
          "Selected model WRFGR is missing in parsed highcharts series.",
          "No model table row matched selected domain TESTDOMAIN.",
          "distribution bucket totals did not match modelCount.",
        ],
      },
      location,
      "https://example.com/multimodel",
      "2026-03-31T09:00:00+08:00",
      "2026-03-31T09:10:00+08:00",
      1,
      {
        stale: false,
        cacheHit: true,
      },
    );

    expect(response.warnings).toContain("distribution bucket totals did not match modelCount.");
    expect(response.warnings).not.toContain("Selected model WRFGR is missing in parsed highcharts series.");
    expect(response.warnings).not.toContain("No model table row matched selected domain TESTDOMAIN.");
  });
});
