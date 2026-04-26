import { readdirSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";

import { describe, expect, test } from "vitest";

import type { WeatherService } from "../src/domain/weather.js";
import { createApp } from "../src/app.js";

const frontendDistDir = join(process.cwd(), "tests", "fixtures", "frontend-dist");
const htmlTitleToken = "Shanghai Pudong International Airport 天气看板";
const reportZh = "最高气温约 21℃。";
const replacementChar = String.fromCharCode(0xfffd);
const textExtensions = new Set([".ts", ".tsx", ".js", ".css", ".html", ".md", ".json"]);
const scanRoots = ["src", "tests", "tools", "zip"];
const sourceRoots = ["src", "zip/src"];
const ignoredDirectories = new Set(["node_modules", "dist", ".git", ".npm-cache"]);
const suspiciousTokens = ["\u9225", "\u63b3", "Â°", "â€", "Ã"];
const shouldIgnoreDirectory = (name: string) =>
  ignoredDirectories.has(name) || name.startsWith("tmp-snapshot-");

const collectTextFiles = (root: string): string[] => {
  const files: string[] = [];
  const stack = [join(process.cwd(), root)];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!shouldIgnoreDirectory(basename(fullPath))) {
          stack.push(fullPath);
        }
        continue;
      }

      if (textExtensions.has(extname(entry.name))) {
        files.push(fullPath);
      }
    }
  }

  return files.sort();
};

const decodeUtf8Strict = (filePath: string): string => {
  const bytes = readFileSync(filePath);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
};

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

const createStaticService = (): WeatherService => ({
  getHourly: async () => ({
    location: {
      id: "shanghai_pvg",
      name: "Shanghai Pudong International Airport",
      timezone: "Asia/Shanghai",
    },
    fetchedAt: "2026-03-27T15:30:00.000Z",
    sourceObservedAt: "2026-03-27T15:30:00.000Z",
    mode: "1h",
    periodHours: 1,
    sourceType: "week-meteogram-highcharts",
    stale: false,
    freshness: "fresh",
    pageUrl: "https://example.com/week",
    parserVersion: "test",
    items: [],
    fieldCoverage,
    partial: true,
    warnings: [],
    cacheHit: true,
    current: null,
  }),
  getWeatherReport: async () => ({
    location: {
      id: "shanghai_pvg",
      name: "Shanghai Pudong International Airport",
      timezone: "Asia/Shanghai",
    },
    fetchedAt: "2026-03-27T15:30:00.000Z",
    sourceObservedAt: "2026-03-27T15:30:00.000Z",
    stale: false,
    freshness: "fresh",
    cacheHit: true,
    pageUrl: "https://example.com/week",
    parserVersion: "test",
    available: true,
    titleEn: "Weather report for Shanghai Pudong International Airport",
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
  }),
  getMultiModelImage: async () => ({
    contentType: "image/png",
    body: Buffer.from("png"),
    cacheHit: true,
    stale: false,
    freshness: "fresh",
    headers: {
      "x-weather-stale": "false",
    },
  }),
  getMultiModelStatus: async () => ({
    location: {
      id: "shanghai_pvg",
      name: "Shanghai Pudong International Airport",
      timezone: "Asia/Shanghai",
    },
    displayUnit: "C" as const,
    fallbackDisplayUnit: "C" as const,
    pageFetchedAt: null,
    imageFetchedAt: null,
    imageUrlFound: false,
    cacheHit: false,
    stale: false,
    freshness: "fresh",
    imageStatus: "unavailable",
    analysisStatus: "unavailable",
    lastError: null,
    lastSuccessAt: null,
    imageUrl: null,
    pageUrl: "https://example.com/multimodel",
  }),
  getMultiModelDistribution: async () => ({
    location: {
      id: "shanghai_pvg",
      name: "Shanghai Pudong International Airport",
      timezone: "Asia/Shanghai",
    },
    fetchedAt: "2026-03-27T15:30:00.000Z",
    stale: false,
    freshness: "fresh",
    cacheHit: true,
    pageUrl: "https://example.com/multimodel",
    sourceType: "meteoblue-page-highcharts",
    displayUnit: "C" as const,
    fallbackDisplayUnit: "C" as const,
    requestedTimestamp: null,
    requestedTimestampValid: false,
    resolvedTimestamp: "2026-03-28T03:00:00+08:00",
    resolvedTimestampReason: "first-available",
    selectedTimestamp: "2026-03-28T03:00:00+08:00",
    selectedTimestampReason: "first-available",
    availableTimestamps: ["2026-03-28T03:00:00+08:00"],
    bucketSizeC: 1,
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
    warnings: [],
  }),
  getMultiModelInsight: async () => ({
    location: {
      id: "shanghai_pvg",
      name: "Shanghai Pudong International Airport",
      timezone: "Asia/Shanghai",
    },
    fetchedAt: "2026-03-27T15:30:00.000Z",
    stale: false,
    freshness: "fresh",
    cacheHit: true,
    pageUrl: "https://example.com/multimodel",
    sourceType: "meteoblue-page-highcharts",
    displayUnit: "C" as const,
    fallbackDisplayUnit: "C" as const,
    requestedTimestamp: null,
    requestedTimestampValid: false,
    resolvedTimestamp: "2026-03-28T03:00:00+08:00",
    resolvedTimestampReason: "first-available",
    selectedTimestamp: "2026-03-28T03:00:00+08:00",
    selectedTimestampReason: "first-available",
    availableTimestamps: ["2026-03-28T03:00:00+08:00"],
    modelCount: 1,
    modelInventory,
    referenceTemperature: {
      temperatureC: 20,
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
});

describe("encoding guards", () => {
  test("all project text files decode strictly as utf-8", () => {
    const files = scanRoots.flatMap((root) => collectTextFiles(root));

    for (const file of files) {
      expect(() => decodeUtf8Strict(file)).not.toThrow();
      expect(decodeUtf8Strict(file)).not.toContain(replacementChar);
    }
  });

  test("application source files avoid mojibake tokens", () => {
    const files = sourceRoots.flatMap((root) => collectTextFiles(root));

    for (const file of files) {
      const text = decodeUtf8Strict(file);
      for (const token of suspiciousTokens) {
        expect(text).not.toContain(token);
      }
    }
  });

  test("frontend source files do not contain raw unicode escape placeholders", () => {
    const files = collectTextFiles("zip/src").filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"));

    for (const file of files) {
      const text = decodeUtf8Strict(file);
      expect(text).not.toMatch(/\\u[0-9a-fA-F]{4}/);
    }
  });

  test("browser resources advertise utf-8 and serve the new frontend bundle", async () => {
    const app = createApp(createStaticService(), { frontendDistDir });

    const html = await app.inject({ method: "GET", url: "/" });
    expect(html.statusCode).toBe(200);
    expect(html.headers["content-type"]).toContain("text/html");
    expect(html.headers["content-type"]).toContain("charset=utf-8");
    expect(html.headers["cache-control"]).toContain("no-store");
    expect(html.body).toContain(htmlTitleToken);
    expect(html.body).toContain("/assets/main.css");
    expect(html.body).toContain("/assets/main.js");
    expect(html.body).not.toContain(replacementChar);

    const script = await app.inject({ method: "GET", url: "/assets/main.js" });
    expect(script.statusCode).toBe(200);
    expect(script.headers["content-type"]).toContain("text/javascript");
    expect(script.headers["content-type"]).toContain("charset=utf-8");
    expect(script.headers["cache-control"]).toContain("immutable");
    expect(script.body).toContain("frontend ok");
    expect(script.body).not.toContain(replacementChar);

    const styles = await app.inject({ method: "GET", url: "/assets/main.css" });
    expect(styles.statusCode).toBe(200);
    expect(styles.headers["content-type"]).toContain("text/css");
    expect(styles.headers["content-type"]).toContain("charset=utf-8");

    await app.close();
  });

  test("report api returns utf-8 json without replacement characters", async () => {
    const app = createApp(createStaticService(), { frontendDistDir });
    const response = await app.inject({ method: "GET", url: "/api/weather/report" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.body).toContain(reportZh);
    expect(response.body).not.toContain(replacementChar);

    await app.close();
  });

  test("dashboard api returns utf-8 json without replacement characters", async () => {
    const app = createApp(createStaticService(), { frontendDistDir });
    const response = await app.inject({ method: "GET", url: "/api/weather/dashboard?mode=1h&limit=8" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.body).toContain(reportZh);
    expect(response.body).toContain("official-relayed-image");
    expect(response.body).toContain("week-meteogram-highcharts");
    expect(response.body).not.toContain(replacementChar);

    await app.close();
  });
});
