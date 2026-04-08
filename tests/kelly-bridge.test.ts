import { afterEach, describe, expect, test, vi } from "vitest";
import WebSocket from "ws";

import type { WeatherService } from "../src/domain/weather.js";
import { createKellyBridgeApp } from "../src/kelly/bridge-app.js";
import { KELLY_BRIDGE_SHARED_SECRET_HEADER } from "../src/kelly/bridge-contract.js";

const createKellyPayload = () =>
  ({
    location: {
      id: "miami_mia",
      name: "Miami International Airport",
      timezone: "America/New_York",
    },
    targetDate: "2026-04-08",
    displayUnit: "F",
    availableTargetDates: ["2026-04-08", "2026-04-09", "2026-04-10"],
    generatedAt: "2026-04-08T12:00:00.000Z",
    bankroll: 1000,
    riskMode: "balanced",
    riskMultiplier: 0.5,
    minEdge: 0.02,
    weatherEvidence: {
      location: {
        id: "miami_mia",
        name: "Miami International Airport",
        timezone: "America/New_York",
      },
      targetDate: "2026-04-08",
      availableTargetDates: ["2026-04-08", "2026-04-09", "2026-04-10"],
      currentReferenceTemperatureC: 28,
      currentReferenceSource: "metar",
      currentWeatherTimestamp: "2026-04-08T08:00:00-04:00",
      currentModelTimestamp: "2026-04-08T08:00:00-04:00",
      targetModelTimestamp: "2026-04-08T14:00:00-04:00",
      observationFloorTemperatureC: 28,
      observationFloorSource: "metar",
      observationFloorObservedAt: "2026-04-08T08:00:00-04:00",
      metarObservation: null,
      sourceSummaryZh: "test",
      hourlyPageUrl: "https://example.com/hourly",
      multimodelPageUrl: "https://example.com/multimodel",
      fetchedAt: "2026-04-08T12:00:00.000Z",
      stale: false,
      participatingModelCount: 2,
      excludedModels: [],
    },
    distributionSummary: {
      meanTemperatureC: 30,
      medianTemperatureC: 30,
      modeTemperatureC: 30,
      mostLikelyRangeLabel: "85F - 87F",
      shrink: 0.82,
      usableModelCount: 2,
      totalModelCount: 2,
      peakSpreadC: 1.1,
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
      generatedAt: "2026-04-08T12:00:00.000Z",
      formulaVersion: "test",
      referenceTemperatureC: 28,
      referenceSource: "metar",
      shrink: 0.82,
      shrinkMode: "heuristic",
      shrinkInputs: {
        disagreement: 0.1,
        biasDispersion: 0.2,
        missingRatio: 0,
        stalePenalty: 0,
        disagreementFactor: 0.1,
        biasDispersionFactor: 0.2,
        missingRatioFactor: 0,
        clampFloor: 0.58,
        clampCeiling: 0.92,
        rawShrink: 0.82,
      },
      weightBreakdown: {
        biasWeight: 0.4,
        consensusWeight: 0.3,
        rankWeight: 0.3,
        normalizedWeight: 1,
      },
      peakSpreadC: 1.1,
      usableModelCount: 2,
      totalModelCount: 2,
      summaries: {
        referenceRule: "test",
        adjustmentRule: "test",
        weightRule: "test",
        shrinkRule: "test",
        pricingRule: "test",
        observationRule: "test",
      },
      probabilitySteps: {
        gridStepC: 0.1,
        referencePriority: ["manual", "metar"],
        contractProbabilityRule: "test",
        shrinkRule: "test",
        fairPriceRule: "test",
        entryPriceRule: "test",
        edgeRule: "test",
        kellyRule: "test",
      },
      formulaNotes: ["test"],
      models: [],
    },
    frameSeries: [],
    sourceLinks: {
      meteoblueWeekUrl: "https://example.com/week",
      meteoblueMultimodelUrl: "https://example.com/multimodel",
      polymarketSearchUrl: "https://example.com/search",
      marketUrls: [],
    },
    freshness: {
      weatherGeneratedAt: "2026-04-08T12:00:00.000Z",
      marketDiscoveredAt: "2026-04-08T12:00:01.000Z",
      orderbookFetchedAt: "2026-04-08T12:00:02.000Z",
      repricedAt: "2026-04-08T12:00:02.000Z",
      lastStreamEventAt: null,
      marketMotionState: "still",
    },
    streamHealth: {
      state: "connected",
      reasonCode: "snapshot_loaded",
      message: "snapshot ready",
      lastSignalAt: null,
      lastRepricedAt: "2026-04-08T12:00:02.000Z",
    },
    sourceStatus: [],
    warnings: [],
  }) as any;

const createService = () => {
  const service = {
    getKellyWorkbench: vi.fn(async () => createKellyPayload()),
    createKellyStream: vi.fn(async (_locationId, _options, onMessage) => {
      onMessage({
        type: "status",
        generatedAt: "2026-04-08T12:00:03.000Z",
        state: "connected",
        reasonCode: "ws_connected",
        message: "bridge stream ok",
      });
      return {
        close: vi.fn(),
      };
    }),
  };

  return service as unknown as WeatherService;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("kelly bridge app", () => {
  test("keeps healthz public for platform health checks", async () => {
    const app = createKellyBridgeApp({
      service: createService(),
      sharedSecret: "bridge-secret",
    });

    const response = await app.inject({
      method: "GET",
      url: "/healthz",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      service: "kelly-bridge",
      sharedSecretProtected: true,
    });

    await app.close();
  });

  test("rejects kelly snapshot requests without the shared secret", async () => {
    const app = createKellyBridgeApp({
      service: createService(),
      sharedSecret: "bridge-secret",
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/weather/kelly?locationId=miami_mia",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      code: "UNAUTHORIZED",
      message: "Missing Kelly bridge authorization header.",
    });

    await app.close();
  });

  test("serves kelly snapshot and stream when the shared secret is present", async () => {
    const service = createService();
    const app = createKellyBridgeApp({
      service,
      sharedSecret: "bridge-secret",
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const response = await app.inject({
      method: "GET",
      url: "/api/weather/kelly?locationId=miami_mia",
      headers: {
        [KELLY_BRIDGE_SHARED_SECRET_HEADER]: "bridge-secret",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(service.getKellyWorkbench).toHaveBeenCalledTimes(1);

    const payload = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/api/weather/kelly/stream?locationId=miami_mia`, {
        headers: {
          [KELLY_BRIDGE_SHARED_SECRET_HEADER]: "bridge-secret",
        },
      });

      socket.once("message", (buffer) => {
        resolve(JSON.parse(buffer.toString()) as Record<string, unknown>);
        socket.close();
      });
      socket.once("error", reject);
    });

    expect(payload).toMatchObject({
      type: "status",
      state: "connected",
      reasonCode: "ws_connected",
    });
    expect(service.createKellyStream).toHaveBeenCalledTimes(1);

    await app.close();
  });
});
