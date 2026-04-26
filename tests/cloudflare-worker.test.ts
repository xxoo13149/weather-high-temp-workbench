import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

type WorkerModule = typeof import("../src/cloudflare/worker.js");

type TestWorkerEnv = {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  FAVORITES_KV?: {
    get(key: string): Promise<string | null>;
    put(key: string, value: string): Promise<void>;
  };
  KELLY_SERVER_BASE_URL?: string;
  KELLY_STREAM_PROXY_MODE?: string;
};

const createEnv = (overrides: Partial<TestWorkerEnv> = {}) => ({
  ASSETS: {
    fetch: vi.fn(async () => new Response("asset", { status: 200 })),
  },
  ...overrides,
});

const createContext = () => ({
  waitUntil: vi.fn(),
});

const createEdgeCache = () => ({
  match: vi.fn(async () => null),
  put: vi.fn(async () => undefined),
});

const createTrackedContext = () => {
  const pending: Promise<unknown>[] = [];
  return {
    waitUntil: vi.fn((promise: Promise<unknown>) => {
      pending.push(Promise.resolve(promise));
    }),
    flush: async () => {
      while (pending.length > 0) {
        const batch = pending.splice(0, pending.length);
        await Promise.allSettled(batch);
      }
    },
  };
};

class MockCloudflareWebSocket extends EventTarget {
  accepted = false;
  closed = false;
  sent: unknown[] = [];

  accept() {
    this.accepted = true;
  }

  send(payload: string) {
    this.sent.push(JSON.parse(payload));
  }

  close() {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.dispatchEvent(new Event("close"));
  }
}

class MockWebSocketPair {
  static lastPair: MockWebSocketPair | null = null;

  0: MockCloudflareWebSocket;
  1: MockCloudflareWebSocket;

  constructor() {
    this[0] = new MockCloudflareWebSocket();
    this[1] = new MockCloudflareWebSocket();
    MockWebSocketPair.lastPair = this;
  }
}

const getLastServerSocket = (): MockCloudflareWebSocket => {
  const pair = MockWebSocketPair.lastPair;
  expect(pair).toBeTruthy();
  if (!pair) {
    throw new Error("Expected worker stream server socket to exist.");
  }

  return pair[1];
};

const createProxiedWebSocketResponse = (webSocket: Record<string, unknown> = {}) => {
  const response = new Response(null, { status: 200 });
  Object.defineProperty(response, "status", {
    configurable: true,
    value: 101,
  });
  Object.defineProperty(response, "webSocket", {
    configurable: true,
    value: webSocket,
  });
  return response as Response & { webSocket: Record<string, unknown> };
};

const loadWorker = async (): Promise<WorkerModule["default"]> => {
  vi.resetModules();
  const module = (await import("../src/cloudflare/worker.js")) as WorkerModule;
  return module.default;
};

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.doUnmock("../src/providers/meteoblue/service.js");
});

describe("cloudflare worker kelly routing", () => {
  test("reports worker runtime metadata on /healthz", async () => {
    const worker = await loadWorker();
    const env = createEnv();

    const response = await worker.fetch(new Request("https://lukaluka.fun/healthz"), env, createContext());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      service: "weather-worker",
      buildId: expect.any(String),
      startedAt: expect.any(String),
      kellyProxy: expect.objectContaining({
        configured: false,
        circuitState: "closed",
        localFallbackActive: false,
        streamMode: "canary",
        streamLocalFallbackActive: false,
      }),
    });
  }, 15_000);

  test("reports source contracts and Kelly proxy state on /api/system/status", async () => {
    const worker = await loadWorker();
    const env = createEnv({ KELLY_SERVER_BASE_URL: "https://kelly-proxy.example" });

    const response = await worker.fetch(new Request("https://lukaluka.fun/api/system/status"), env, createContext());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      service: "weather-worker",
      roadmap: {
        profile: "polyweather-absorption-v1",
        cleanRoom: true,
        probabilityLayerEnabled: false,
        marketNarrative: "qualitative-only",
      },
      sourceContractsVersion: "2026-04-22",
      locationCoverage: {
        totalEnabled: expect.any(Number),
        byRolloutTier: expect.objectContaining({
          "tier-1": expect.any(Number),
        }),
      },
      sourceCoverage: expect.arrayContaining([
        expect.objectContaining({
          scope: "current",
          key: "meteoblue-week-page",
          productionCount: expect.any(Number),
        }),
        expect.objectContaining({
          scope: "target",
          key: "open-meteo-multi-model",
          plannedCount: expect.any(Number),
        }),
      ]),
      runtime: null,
      kellyProxy: expect.objectContaining({
        configured: true,
        originBaseUrl: "https://kelly-proxy.example",
        streamMode: "canary",
      }),
    });
  });

  test("serves prometheus-style system metrics from the worker", async () => {
    const worker = await loadWorker();
    const env = createEnv();

    const response = await worker.fetch(new Request("https://lukaluka.fun/metrics"), env, createContext());
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(body).toContain("weather_runtime_info");
    expect(body).toContain("weather_location_total");
    expect(body).toContain('weather_source_contract_total{scope="target",source="open-meteo-multi-model"');
  });

  test("serves legacy Kelly GET requests through the worker-local service", async () => {
    const env = createEnv();
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const getKellyWorkbench = vi.fn(async (locationId: string) => ({
      location: {
        id: locationId,
        name: "Miami International Airport",
        timezone: "America/New_York",
      },
      displayUnit: "F",
      generatedAt: "2026-04-10T00:00:00.000Z",
      targetDate: "2026-04-10",
      availableTargetDates: ["2026-04-10"],
      bankroll: 1000,
      riskMode: "balanced",
      riskMultiplier: 0.5,
      minEdge: 0.02,
      summaryMetrics: [],
      opportunities: [],
      markets: [],
      inactiveMarkets: [],
      sourceLinks: {
        polymarketSearchUrl: "https://polymarket.com",
        marketUrls: [],
      },
    }));

    vi.doMock("../src/providers/meteoblue/service.js", () => {
      class MockMeteoblueWeatherService {
        getKellyWorkbench = getKellyWorkbench;
      }

      return { MeteoblueWeatherService: MockMeteoblueWeatherService };
    });

    const worker = await loadWorker();
    const response = await worker.fetch(
      new Request("https://lukaluka.fun/api/weather/kelly?locationId=miami_mia"),
      env,
      createContext(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      location: {
        id: "miami_mia",
      },
      displayUnit: "F",
    });
    expect(getKellyWorkbench).toHaveBeenCalledWith("miami_mia", expect.any(Object));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("serves newly added Kelly GET requests through the worker-local service", async () => {
    const env = createEnv();
    const fetchMock = vi.spyOn(globalThis, "fetch");

    vi.doMock("../src/providers/meteoblue/service.js", () => {
      class MockMeteoblueWeatherService {
        async getKellyWorkbench(locationId: string) {
          return {
            location: {
              id: locationId,
              name: "Amsterdam Airport Schiphol",
              timezone: "Europe/Amsterdam",
            },
            displayUnit: "C",
            generatedAt: "2026-04-10T00:00:00.000Z",
            targetDate: "2026-04-10",
            availableTargetDates: ["2026-04-10"],
            bankroll: 1000,
            riskMode: "balanced",
            riskMultiplier: 0.5,
            minEdge: 0.02,
            summaryMetrics: [],
            opportunities: [],
            markets: [],
            inactiveMarkets: [],
            sourceLinks: {
              polymarketSearchUrl: "https://polymarket.com",
              marketUrls: [],
            },
          };
        }
      }

      return { MeteoblueWeatherService: MockMeteoblueWeatherService };
    });

    const worker = await loadWorker();
    const response = await worker.fetch(
      new Request("https://lukaluka.fun/api/weather/kelly?locationId=amsterdam_ams"),
      env,
      createContext(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      location: {
        id: "amsterdam_ams",
      },
      displayUnit: "C",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("streams Kelly locations through the worker-local realtime service", async () => {
    const env = createEnv();
    const context = createTrackedContext();
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const createKellyStream = vi.fn(async (locationId: string, _options: unknown, onMessage: (payload: unknown) => void) => {
      onMessage({
        type: "status",
        generatedAt: "2026-04-11T01:02:03.000Z",
        state: "connected",
        reasonCode: "ws_connected",
        message: "stream connected",
      });
      onMessage({
        type: "markets",
        generatedAt: "2026-04-11T01:02:04.000Z",
        markets: [{ marketId: `${locationId}-market-1` }],
        frames: [],
      });
      return {
        close: vi.fn(),
      };
    });

    MockWebSocketPair.lastPair = null;
    vi.stubGlobal("WebSocketPair", MockWebSocketPair);

    vi.doMock("../src/providers/meteoblue/service.js", () => {
      class MockMeteoblueWeatherService {
        createKellyStream = createKellyStream;
      }

      return { MeteoblueWeatherService: MockMeteoblueWeatherService };
    });

    const worker = await loadWorker();
    const response = await worker.fetch(
      new Request("https://lukaluka.fun/api/weather/kelly/stream?locationId=amsterdam_ams", {
        headers: {
          Upgrade: "websocket",
        },
      }),
      env,
      context,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.headers.get("x-worker-websocket-upgrade")).toBe("101");
    expect(createKellyStream).toHaveBeenCalledWith("amsterdam_ams", expect.any(Object), expect.any(Function));

    await context.flush();

    const server = getLastServerSocket();

    expect(server.accepted).toBe(true);
    expect(server.sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "status",
          state: "connected",
          reasonCode: "ws_connected",
        }),
        expect.objectContaining({
          type: "markets",
          generatedAt: "2026-04-11T01:02:04.000Z",
        }),
      ]),
    );

    server.close();
    await context.flush();
  });

  test("proxies Kelly GET requests when Kelly server is configured", async () => {
    const proxyUrl = "https://kelly-proxy.example";
    const env = createEnv({ KELLY_SERVER_BASE_URL: proxyUrl });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          proxied: true,
          weatherEvidence: {
            metarObservation: {
              stationId: "KMIA",
              temperatureC: 26,
            },
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const worker = await loadWorker();
    const response = await worker.fetch(
      new Request("https://lukaluka.fun/api/weather/kelly?locationId=miami_mia"),
      env,
      createContext(),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requested] = fetchMock.mock.calls[0];
    expect(requested).toBeInstanceOf(Request);
    expect((requested as Request).url).toBe(`${proxyUrl}/api/weather/kelly?locationId=miami_mia`);
    expect((requested as Request).headers.get("x-weather-kelly-proxy")).toBe("cloudflare-worker");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      proxied: true,
      weatherEvidence: {
        metarObservation: {
          stationId: "KMIA",
          temperatureC: 26,
        },
      },
    });
  });

  test("proxies Kelly stream requests when remote-first mode receives a websocket upgrade", async () => {
    const proxyUrl = "https://kelly-proxy.example";
    const upstreamSocket = { id: "origin-socket" };
    const env = createEnv({ KELLY_SERVER_BASE_URL: proxyUrl, KELLY_STREAM_PROXY_MODE: "remote-first" });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(createProxiedWebSocketResponse(upstreamSocket));

    const worker = await loadWorker();
    const response = await worker.fetch(
      new Request("https://lukaluka.fun/api/weather/kelly/stream?locationId=toronto_yyz", {
        headers: { Upgrade: "websocket" },
      }),
      env,
      createContext(),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requested] = fetchMock.mock.calls[0];
    expect(requested).toBeInstanceOf(Request);
    expect((requested as Request).url).toBe(`${proxyUrl}/api/weather/kelly/stream?locationId=toronto_yyz`);
    expect((requested as Request).headers.get("x-weather-kelly-proxy")).toBe("cloudflare-worker");
    expect(response.status).toBe(101);
    expect((response as Response & { webSocket?: unknown }).webSocket).toBe(upstreamSocket);
  });

  test("keeps the stable local Kelly stream path for non-canary requests", async () => {
    const env = createEnv({
      KELLY_SERVER_BASE_URL: "https://kelly-proxy.example",
      KELLY_STREAM_PROXY_MODE: "canary",
    });
    const context = createTrackedContext();
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const createKellyStream = vi.fn(async (locationId: string, _options: unknown, onMessage: (payload: unknown) => void) => {
      onMessage({
        type: "status",
        generatedAt: "2026-04-11T01:02:05.000Z",
        state: "connected",
        reasonCode: "ws_connected",
        message: "legacy stream connected locally",
      });
      return {
        close: vi.fn(),
      };
    });
    MockWebSocketPair.lastPair = null;
    vi.stubGlobal("WebSocketPair", MockWebSocketPair);

    vi.doMock("../src/providers/meteoblue/service.js", () => {
      class MockMeteoblueWeatherService {
        createKellyStream = createKellyStream;
      }

      return { MeteoblueWeatherService: MockMeteoblueWeatherService };
    });

    const worker = await loadWorker();
    const response = await worker.fetch(
      new Request("https://lukaluka.fun/api/weather/kelly/stream?locationId=miami_mia", {
        headers: {
          Upgrade: "websocket",
        },
      }),
      env,
      context,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.headers.get("x-worker-websocket-upgrade")).toBe("101");
    expect(createKellyStream).toHaveBeenCalledWith("miami_mia", expect.any(Object), expect.any(Function));

    await context.flush();

    const server = getLastServerSocket();

    expect(server.sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "status",
          state: "connected",
          reasonCode: "ws_connected",
        }),
      ]),
    );
  });

  test("attempts the remote Kelly stream only for canary requests", async () => {
    const proxyUrl = "https://kelly-proxy.example";
    const upstreamSocket = { id: "canary-socket" };
    const env = createEnv({ KELLY_SERVER_BASE_URL: proxyUrl, KELLY_STREAM_PROXY_MODE: "canary" });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(createProxiedWebSocketResponse(upstreamSocket));
    const createKellyStream = vi.fn();

    vi.doMock("../src/providers/meteoblue/service.js", () => {
      class MockMeteoblueWeatherService {
        createKellyStream = createKellyStream;
      }

      return { MeteoblueWeatherService: MockMeteoblueWeatherService };
    });

    const worker = await loadWorker();
    const response = await worker.fetch(
      new Request("https://lukaluka.fun/api/weather/kelly/stream?locationId=miami_mia", {
        headers: {
          Upgrade: "websocket",
          "x-kelly-origin-canary": "1",
        },
      }),
      env,
      createContext(),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(createKellyStream).not.toHaveBeenCalled();
    expect(response.status).toBe(101);
    expect((response as Response & { webSocket?: unknown }).webSocket).toBe(upstreamSocket);
  });

  test("falls back to the worker-local Kelly GET when the origin fetch fails", async () => {
    const proxyUrl = "https://kelly-proxy.example";
    const env = createEnv({ KELLY_SERVER_BASE_URL: proxyUrl });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("connect failed"));
    const getKellyWorkbench = vi.fn(async (locationId: string) => ({
      location: {
        id: locationId,
        name: "Miami International Airport",
        timezone: "America/New_York",
      },
      displayUnit: "F",
      generatedAt: "2026-04-10T00:00:00.000Z",
      targetDate: "2026-04-10",
      availableTargetDates: ["2026-04-10"],
      bankroll: 1000,
      riskMode: "balanced",
      riskMultiplier: 0.5,
      minEdge: 0.02,
      summaryMetrics: [],
      opportunities: [],
      markets: [],
      inactiveMarkets: [],
      sourceLinks: {
        polymarketSearchUrl: "https://polymarket.com",
        marketUrls: [],
      },
    }));

    vi.doMock("../src/providers/meteoblue/service.js", () => {
      class MockMeteoblueWeatherService {
        getKellyWorkbench = getKellyWorkbench;
      }

      return { MeteoblueWeatherService: MockMeteoblueWeatherService };
    });

    const worker = await loadWorker();
    const response = await worker.fetch(
      new Request("https://lukaluka.fun/api/weather/kelly?locationId=miami_mia"),
      env,
      createContext(),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getKellyWorkbench).toHaveBeenCalledWith("miami_mia", expect.any(Object));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      location: { id: "miami_mia" },
    });

    const health = await worker.fetch(new Request("https://lukaluka.fun/healthz"), env, createContext());
    await expect(health.json()).resolves.toMatchObject({
      kellyProxy: expect.objectContaining({
        configured: true,
        circuitState: "closed",
        lastOriginFailureCode: "origin_fetch_failed",
        localFallbackActive: true,
      }),
    });
  });

  test("passes through JSON 4xx origin responses without falling back locally", async () => {
    const proxyUrl = "https://kelly-proxy.example";
    const env = createEnv({ KELLY_SERVER_BASE_URL: proxyUrl });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "BAD_REQUEST", message: "bad params" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );
    const getKellyWorkbench = vi.fn();

    vi.doMock("../src/providers/meteoblue/service.js", () => {
      class MockMeteoblueWeatherService {
        getKellyWorkbench = getKellyWorkbench;
      }

      return { MeteoblueWeatherService: MockMeteoblueWeatherService };
    });

    const worker = await loadWorker();
    const response = await worker.fetch(
      new Request("https://lukaluka.fun/api/weather/kelly?locationId=miami_mia"),
      env,
      createContext(),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getKellyWorkbench).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "BAD_REQUEST",
      message: "bad params",
    });
  });

  test("falls back locally when the origin is behind the worker location registry", async () => {
    const proxyUrl = "https://kelly-proxy.example";
    const env = createEnv({ KELLY_SERVER_BASE_URL: proxyUrl });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "BAD_REQUEST",
          message: "Query parameter 'locationId' is not supported: 'guangzhou_can'.",
        }),
        {
          status: 400,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const getKellyWorkbench = vi.fn(async (locationId: string) => ({
      location: {
        id: locationId,
        name: "Guangzhou Baiyun International Airport",
        timezone: "Asia/Shanghai",
      },
      displayUnit: "C",
      generatedAt: "2026-04-22T00:00:00.000Z",
      targetDate: "2026-04-22",
      availableTargetDates: ["2026-04-22"],
      bankroll: 1000,
      riskMode: "balanced",
      riskMultiplier: 0.5,
      minEdge: 0.02,
      summaryMetrics: [],
      opportunities: [],
      markets: [],
      inactiveMarkets: [],
      sourceLinks: {
        polymarketSearchUrl: "https://polymarket.com",
        marketUrls: [],
      },
    }));

    vi.doMock("../src/providers/meteoblue/service.js", () => {
      class MockMeteoblueWeatherService {
        getKellyWorkbench = getKellyWorkbench;
      }

      return { MeteoblueWeatherService: MockMeteoblueWeatherService };
    });

    const worker = await loadWorker();
    const response = await worker.fetch(
      new Request("https://lukaluka.fun/api/weather/kelly?locationId=guangzhou_can"),
      env,
      createContext(),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getKellyWorkbench).toHaveBeenCalledWith("guangzhou_can", expect.any(Object));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      location: { id: "guangzhou_can" },
    });

    const health = await worker.fetch(new Request("https://lukaluka.fun/healthz"), env, createContext());
    await expect(health.json()).resolves.toMatchObject({
      kellyProxy: expect.objectContaining({
        lastOriginFailureCode: "origin_location_version_skew",
        localFallbackActive: true,
      }),
    });
  });

  test("passes through origin Kelly responses when a METAR-backed city temporarily has no METAR observation", async () => {
    const proxyUrl = "https://kelly-proxy.example";
    const env = createEnv({ KELLY_SERVER_BASE_URL: proxyUrl });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          location: {
            id: "newyork_lga",
            name: "LaGuardia Airport",
            timezone: "America/New_York",
          },
          displayUnit: "F",
          generatedAt: "2026-04-22T00:00:00.000Z",
          targetDate: "2026-04-22",
          availableTargetDates: ["2026-04-22"],
          recommendations: [],
          weatherEvidence: {
            metarObservation: null,
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const worker = await loadWorker();
    const response = await worker.fetch(
      new Request("https://lukaluka.fun/api/weather/kelly?locationId=newyork_lga"),
      env,
      createContext(),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      location: { id: "newyork_lga" },
      weatherEvidence: {
        metarObservation: null,
      },
    });

    const health = await worker.fetch(new Request("https://lukaluka.fun/healthz"), env, createContext());
    await expect(health.json()).resolves.toMatchObject({
      kellyProxy: expect.objectContaining({
        circuitState: "closed",
        lastOriginSuccessAt: expect.any(String),
        localFallbackActive: false,
      }),
    });
  });

  test("falls back locally when the origin returns a mismatched Kelly METAR station", async () => {
    const proxyUrl = "https://kelly-proxy.example";
    const env = createEnv({ KELLY_SERVER_BASE_URL: proxyUrl });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          location: {
            id: "newyork_lga",
            name: "LaGuardia Airport",
            timezone: "America/New_York",
          },
          displayUnit: "F",
          generatedAt: "2026-04-22T00:00:00.000Z",
          targetDate: "2026-04-22",
          availableTargetDates: ["2026-04-22"],
          recommendations: [],
          weatherEvidence: {
            metarObservation: {
              stationId: "KJFK",
              temperatureC: 12,
            },
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const getKellyWorkbench = vi.fn(async (locationId: string) => ({
      location: {
        id: locationId,
        name: "LaGuardia Airport",
        timezone: "America/New_York",
      },
      displayUnit: "F",
      generatedAt: "2026-04-23T00:00:00.000Z",
      targetDate: "2026-04-23",
      availableTargetDates: ["2026-04-23"],
      bankroll: 1000,
      riskMode: "balanced",
      riskMultiplier: 0.5,
      minEdge: 0.02,
      summaryMetrics: [],
      opportunities: [],
      markets: [],
      inactiveMarkets: [],
      weatherEvidence: {
        metarObservation: {
          stationId: "KLGA",
          stationName: "LaGuardia Airport",
          observedAt: "2026-04-23T08:00:00.000Z",
          temperatureC: 11,
        },
      },
      sourceLinks: {
        polymarketSearchUrl: "https://polymarket.com",
        marketUrls: [],
      },
    }));

    vi.doMock("../src/providers/meteoblue/service.js", () => {
      class MockMeteoblueWeatherService {
        getKellyWorkbench = getKellyWorkbench;
      }

      return { MeteoblueWeatherService: MockMeteoblueWeatherService };
    });

    const worker = await loadWorker();
    const response = await worker.fetch(
      new Request("https://lukaluka.fun/api/weather/kelly?locationId=newyork_lga"),
      env,
      createContext(),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getKellyWorkbench).toHaveBeenCalledWith("newyork_lga", expect.any(Object));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      location: { id: "newyork_lga" },
      weatherEvidence: {
        metarObservation: {
          stationId: "KLGA",
        },
      },
    });

    const health = await worker.fetch(new Request("https://lukaluka.fun/healthz"), env, createContext());
    await expect(health.json()).resolves.toMatchObject({
      kellyProxy: expect.objectContaining({
        lastOriginFailureCode: "origin_metar_contract_skew",
        localFallbackActive: true,
      }),
    });
  });

  test("falls back to the worker-local Kelly stream when the origin handshake fails", async () => {
    const proxyUrl = "https://kelly-proxy.example";
    const env = createEnv({ KELLY_SERVER_BASE_URL: proxyUrl, KELLY_STREAM_PROXY_MODE: "remote-first" });
    const context = createTrackedContext();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("origin down"));
    const createKellyStream = vi.fn(async (locationId: string, _options: unknown, onMessage: (payload: unknown) => void) => {
      onMessage({
        type: "status",
        generatedAt: "2026-04-11T01:02:03.000Z",
        state: "connected",
        reasonCode: "ws_connected",
        message: "stream connected",
      });
      onMessage({
        type: "markets",
        generatedAt: "2026-04-11T01:02:04.000Z",
        markets: [{ marketId: `${locationId}-market-1` }],
        frames: [],
      });
      return {
        close: vi.fn(),
      };
    });

    MockWebSocketPair.lastPair = null;
    vi.stubGlobal("WebSocketPair", MockWebSocketPair);
    vi.doMock("../src/providers/meteoblue/service.js", () => {
      class MockMeteoblueWeatherService {
        createKellyStream = createKellyStream;
      }

      return { MeteoblueWeatherService: MockMeteoblueWeatherService };
    });

    const worker = await loadWorker();
    const response = await worker.fetch(
      new Request("https://lukaluka.fun/api/weather/kelly/stream?locationId=toronto_yyz", {
        headers: { Upgrade: "websocket" },
      }),
      env,
      context,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.headers.get("x-worker-websocket-upgrade")).toBe("101");
    await context.flush();

    const server = getLastServerSocket();
    expect(server.sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "status",
          originMode: "local-fallback",
          circuitState: "closed",
        }),
        expect.objectContaining({
          type: "markets",
          originMode: "local-fallback",
          circuitState: "closed",
        }),
      ]),
    );

    const health = await worker.fetch(new Request("https://lukaluka.fun/healthz"), env, createContext());
    await expect(health.json()).resolves.toMatchObject({
      kellyProxy: expect.objectContaining({
        streamMode: "remote-first",
        streamLastOriginFailureCode: "origin_fetch_failed",
        streamLastOriginFailureAt: expect.any(String),
        streamLocalFallbackActive: true,
      }),
    });
  });

  test("falls back to the worker-local Kelly stream when the remote websocket fetch hangs past timeout", async () => {
    vi.useFakeTimers();
    const proxyUrl = "https://kelly-proxy.example";
    const env = createEnv({ KELLY_SERVER_BASE_URL: proxyUrl, KELLY_STREAM_PROXY_MODE: "remote-first" });
    const context = createTrackedContext();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        await new Promise<Response>(() => {
          // Intentionally never resolves.
        }),
    );
    const createKellyStream = vi.fn(async (locationId: string, _options: unknown, onMessage: (payload: unknown) => void) => {
      onMessage({
        type: "status",
        generatedAt: "2026-04-11T01:02:03.000Z",
        state: "connected",
        reasonCode: "ws_connected",
        message: "stream connected",
      });
      return {
        close: vi.fn(),
      };
    });

    MockWebSocketPair.lastPair = null;
    vi.stubGlobal("WebSocketPair", MockWebSocketPair);
    vi.doMock("../src/providers/meteoblue/service.js", () => {
      class MockMeteoblueWeatherService {
        createKellyStream = createKellyStream;
      }

      return { MeteoblueWeatherService: MockMeteoblueWeatherService };
    });

    const worker = await loadWorker();
    const pendingResponse = worker.fetch(
      new Request("https://lukaluka.fun/api/weather/kelly/stream?locationId=toronto_yyz", {
        headers: { Upgrade: "websocket" },
      }),
      env,
      context,
    );

    await vi.advanceTimersByTimeAsync(6_100);
    const response = await pendingResponse;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.headers.get("x-worker-websocket-upgrade")).toBe("101");
    expect(createKellyStream).toHaveBeenCalledWith("toronto_yyz", expect.any(Object), expect.any(Function));

    await context.flush();

    const health = await worker.fetch(new Request("https://lukaluka.fun/healthz"), env, createContext());
    await expect(health.json()).resolves.toMatchObject({
      kellyProxy: expect.objectContaining({
        streamMode: "remote-first",
        streamLastOriginFailureCode: "origin_timeout",
        streamLocalFallbackActive: true,
      }),
    });
    vi.useRealTimers();
  });

  test("opens the circuit after repeated origin failures and closes it after a successful half-open probe", async () => {
    vi.useFakeTimers();
    const proxyUrl = "https://kelly-proxy.example";
    const env = createEnv({ KELLY_SERVER_BASE_URL: proxyUrl });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("origin down"));
    const getKellyWorkbench = vi.fn(async (locationId: string) => ({
      location: {
        id: locationId,
        name: "Miami International Airport",
        timezone: "America/New_York",
      },
      displayUnit: "F",
      generatedAt: "2026-04-10T00:00:00.000Z",
      targetDate: "2026-04-10",
      availableTargetDates: ["2026-04-10"],
      bankroll: 1000,
      riskMode: "balanced",
      riskMultiplier: 0.5,
      minEdge: 0.02,
      summaryMetrics: [],
      opportunities: [],
      markets: [],
      inactiveMarkets: [],
      sourceLinks: {
        polymarketSearchUrl: "https://polymarket.com",
        marketUrls: [],
      },
    }));

    vi.doMock("../src/providers/meteoblue/service.js", () => {
      class MockMeteoblueWeatherService {
        getKellyWorkbench = getKellyWorkbench;
      }

      return { MeteoblueWeatherService: MockMeteoblueWeatherService };
    });

    const worker = await loadWorker();
    const request = new Request("https://lukaluka.fun/api/weather/kelly?locationId=miami_mia");

    await worker.fetch(request, env, createContext());
    await worker.fetch(request, env, createContext());
    await worker.fetch(request, env, createContext());

    let health = await worker.fetch(new Request("https://lukaluka.fun/healthz"), env, createContext());
    await expect(health.json()).resolves.toMatchObject({
      kellyProxy: expect.objectContaining({
        circuitState: "open",
        consecutiveFailures: 3,
      }),
    });

    await worker.fetch(request, env, createContext());
    expect(fetchMock).toHaveBeenCalledTimes(3);

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          proxied: true,
          weatherEvidence: {
            metarObservation: {
              stationId: "KMIA",
              temperatureC: 26,
            },
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1);
    const recovered = await worker.fetch(request, env, createContext());
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(recovered.status).toBe(200);
    await expect(recovered.json()).resolves.toEqual({
      proxied: true,
      weatherEvidence: {
        metarObservation: {
          stationId: "KMIA",
          temperatureC: 26,
        },
      },
    });

    health = await worker.fetch(new Request("https://lukaluka.fun/healthz"), env, createContext());
    await expect(health.json()).resolves.toMatchObject({
      kellyProxy: expect.objectContaining({
        circuitState: "closed",
        localFallbackActive: false,
      }),
    });
    vi.useRealTimers();
  });

  test("proxies dashboard requests through the origin when the Kelly server is configured", async () => {
    const proxyUrl = "https://kelly-proxy.example";
    const env = createEnv({ KELLY_SERVER_BASE_URL: proxyUrl });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          generatedAt: "2026-04-23T00:00:00.000Z",
          sync: {
            state: "fresh",
            freshness: "fresh",
          },
          metar: {
            observation: {
              stationId: "KMIA",
              temperatureC: 27,
            },
            recentReports: [
              {
                stationId: "KMIA",
                temperatureC: 27,
              },
            ],
          },
          taf: {
            forecast: {
              stationId: "KMIA",
            },
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const worker = await loadWorker();
    const response = await worker.fetch(
      new Request("https://lukaluka.fun/api/weather/dashboard?locationId=miami_mia"),
      env,
      createContext(),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requested] = fetchMock.mock.calls[0];
    expect(requested).toBeInstanceOf(Request);
    expect((requested as Request).url).toBe(`${proxyUrl}/api/weather/dashboard?locationId=miami_mia`);
    expect((requested as Request).headers.get("x-weather-kelly-proxy")).toBe("cloudflare-worker");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      metar: {
        observation: {
          stationId: "KMIA",
          temperatureC: 27,
        },
      },
      taf: {
        forecast: {
          stationId: "KMIA",
        },
      },
    });

    const health = await worker.fetch(new Request("https://lukaluka.fun/healthz"), env, createContext());
    await expect(health.json()).resolves.toMatchObject({
      kellyProxy: expect.objectContaining({
        dashboardCircuitState: "closed",
        dashboardLastOriginSuccessAt: expect.any(String),
        dashboardLocalFallbackActive: false,
      }),
    });
  });

  test("passes through dashboard responses when METAR is temporarily unavailable upstream", async () => {
    const proxyUrl = "https://kelly-proxy.example";
    const env = createEnv({ KELLY_SERVER_BASE_URL: proxyUrl });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          generatedAt: "2026-04-23T00:00:00.000Z",
          sync: {
            state: "fresh",
            freshness: "fresh",
          },
          metar: {
            observation: null,
          },
          taf: {
            forecast: null,
          },
          sourceMetadata: {
            contract: {
              currentSources: {
                primaryObservation: {
                  key: "aviationweather-metar",
                  stationCode: "DNMM",
                },
              },
            },
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const worker = await loadWorker();
    const response = await worker.fetch(
      new Request("https://lukaluka.fun/api/weather/dashboard?locationId=lagos_los"),
      env,
      createContext(),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      metar: {
        observation: null,
      },
      taf: {
        forecast: null,
      },
    });

    const health = await worker.fetch(new Request("https://lukaluka.fun/healthz"), env, createContext());
    await expect(health.json()).resolves.toMatchObject({
      kellyProxy: expect.objectContaining({
        dashboardCircuitState: "closed",
        dashboardLastOriginSuccessAt: expect.any(String),
        dashboardLocalFallbackActive: false,
      }),
    });
  });

  test("falls back to the worker-local dashboard when the origin fetch fails", async () => {
    const proxyUrl = "https://kelly-proxy.example";
    const env = createEnv({ KELLY_SERVER_BASE_URL: proxyUrl });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("dashboard origin down"));
    const getHourly = vi.fn(async () => ({
      location: { id: "miami_mia", name: "Miami International Airport", timezone: "America/New_York" },
      fetchedAt: "2026-04-23T00:00:00.000Z",
      sourceObservedAt: null,
      mode: "1h",
      periodHours: 1,
      sourceType: "week-table-1h",
      stale: false,
      freshness: "fresh",
      pageUrl: "https://example.com/week",
      parserVersion: "test",
      items: [],
      fieldCoverage: {},
      partial: false,
      warnings: [],
      cacheHit: true,
      current: null,
    }));
    const getWeatherReport = vi.fn(async () => ({
      location: { id: "miami_mia", name: "Miami International Airport", timezone: "America/New_York" },
      pageUrl: "https://example.com/week",
      parserVersion: "test",
      available: true,
      titleEn: "Report",
      sourceTextEn: "Report",
      textZh: "Report",
      metrics: {},
      warnings: [],
      fetchedAt: "2026-04-23T00:00:00.000Z",
      sourceObservedAt: null,
      stale: false,
      freshness: "fresh",
      cacheHit: true,
    }));
    const getMultiModelStatus = vi.fn(async () => ({
      location: { id: "miami_mia", name: "Miami International Airport", timezone: "America/New_York" },
      displayUnit: "F",
      fallbackDisplayUnit: "F",
      pageFetchedAt: "2026-04-23T00:00:00.000Z",
      imageFetchedAt: "2026-04-23T00:00:00.000Z",
      imageUrlFound: true,
      cacheHit: true,
      stale: false,
      freshness: "fresh",
      imageStatus: "ready",
      analysisStatus: "ready",
      lastError: null,
      lastSuccessAt: "2026-04-23T00:00:00.000Z",
      imageUrl: "https://example.com/multimodel.png",
      pageUrl: "https://example.com/multimodel",
    }));
    const getMetarSnapshot = vi.fn(async () => ({
      observation: {
        stationId: "KMIA",
        stationName: "Miami International Airport",
        observedAt: "2026-04-23T00:00:00.000Z",
        temperatureC: 27,
        dewpointC: 21,
        windDirectionDegrees: 120,
        windSpeedKts: 9,
        rawReport: "METAR KMIA 230000Z 12009KT 10SM FEW030 27/21 A2998",
      },
      recentTemperatures: [],
    }));
    const getTafSnapshot = vi.fn(async () => ({
      forecast: {
        stationId: "KMIA",
      },
      forecasts: [],
    }));

    vi.doMock("../src/providers/meteoblue/service.js", () => {
      class MockMeteoblueWeatherService {
        getHourly = getHourly;
        getWeatherReport = getWeatherReport;
        getMultiModelStatus = getMultiModelStatus;
        getMetarSnapshot = getMetarSnapshot;
        getTafSnapshot = getTafSnapshot;
      }

      return { MeteoblueWeatherService: MockMeteoblueWeatherService };
    });

    const worker = await loadWorker();
    const response = await worker.fetch(
      new Request("https://lukaluka.fun/api/weather/dashboard?locationId=miami_mia"),
      env,
      createContext(),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getHourly).toHaveBeenCalledWith("miami_mia", "1h", undefined);
    expect(getMultiModelStatus).toHaveBeenCalledWith("miami_mia");
    expect(getWeatherReport).toHaveBeenCalledWith("miami_mia");
    expect(getMetarSnapshot).toHaveBeenCalledWith("miami_mia");
    expect(getTafSnapshot).toHaveBeenCalledWith("miami_mia");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      metar: {
        observation: {
          stationId: "KMIA",
        },
        recentReports: [
          expect.objectContaining({
            stationId: "KMIA",
          }),
        ],
      },
      taf: {
        forecast: {
          stationId: "KMIA",
        },
      },
    });

    const health = await worker.fetch(new Request("https://lukaluka.fun/healthz"), env, createContext());
    await expect(health.json()).resolves.toMatchObject({
      kellyProxy: expect.objectContaining({
        dashboardCircuitState: "closed",
        dashboardLastOriginFailureCode: "origin_fetch_failed",
        dashboardLocalFallbackActive: true,
      }),
    });
  });

  test("keeps the worker-local dashboard available when TAF fetch fails", async () => {
    const getHourly = vi.fn(async () => ({
      location: { id: "lagos_los", name: "Lagos", timezone: "Africa/Lagos" },
      fetchedAt: "2026-04-23T00:00:00.000Z",
      sourceObservedAt: null,
      mode: "1h",
      periodHours: 1,
      sourceType: "week-table-1h",
      stale: false,
      freshness: "fresh",
      pageUrl: "https://example.com/week",
      parserVersion: "test",
      items: [],
      fieldCoverage: {},
      partial: false,
      warnings: [],
      cacheHit: true,
      current: null,
    }));
    const getWeatherReport = vi.fn(async () => ({
      location: { id: "lagos_los", name: "Lagos", timezone: "Africa/Lagos" },
      pageUrl: "https://example.com/week",
      parserVersion: "test",
      available: true,
      titleEn: "Report",
      sourceTextEn: "Report",
      textZh: "Report",
      metrics: {},
      warnings: [],
      fetchedAt: "2026-04-23T00:00:00.000Z",
      sourceObservedAt: null,
      stale: false,
      freshness: "fresh",
      cacheHit: true,
    }));
    const getMultiModelStatus = vi.fn(async () => ({
      location: { id: "lagos_los", name: "Lagos", timezone: "Africa/Lagos" },
      displayUnit: "C",
      fallbackDisplayUnit: "C",
      pageFetchedAt: "2026-04-23T00:00:00.000Z",
      imageFetchedAt: "2026-04-23T00:00:00.000Z",
      imageUrlFound: true,
      cacheHit: true,
      stale: false,
      freshness: "fresh",
      imageStatus: "ready",
      analysisStatus: "ready",
      lastError: null,
      lastSuccessAt: "2026-04-23T00:00:00.000Z",
      imageUrl: "https://example.com/multimodel.png",
      pageUrl: "https://example.com/multimodel",
    }));
    const getMetarSnapshot = vi.fn(async () => ({
      observation: {
        stationId: "DNMM",
        stationName: "Lagos Airport",
        observedAt: "2026-04-23T00:00:00.000Z",
        temperatureC: 28,
        dewpointC: 24,
        windDirectionDegrees: 210,
        windSpeedKts: 7,
        rawReport: "METAR DNMM 230000Z 21007KT 9999 SCT020 28/24 Q1010",
      },
      recentTemperatures: [],
    }));
    const getTafSnapshot = vi.fn(async () => {
      throw new Error("taf parse failed");
    });

    vi.doMock("../src/providers/meteoblue/service.js", () => {
      class MockMeteoblueWeatherService {
        getHourly = getHourly;
        getWeatherReport = getWeatherReport;
        getMultiModelStatus = getMultiModelStatus;
        getMetarSnapshot = getMetarSnapshot;
        getTafSnapshot = getTafSnapshot;
      }

      return { MeteoblueWeatherService: MockMeteoblueWeatherService };
    });

    const worker = await loadWorker();
    const response = await worker.fetch(
      new Request("https://lukaluka.fun/api/weather/dashboard?locationId=lagos_los"),
      createEnv(),
      createContext(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      metar: {
        observation: {
          stationId: "DNMM",
        },
        recentReports: [
          expect.objectContaining({
            stationId: "DNMM",
          }),
        ],
      },
      taf: {
        forecast: null,
        forecasts: [],
      },
    });
  });

  test("edge-caches stable dashboard responses while upstream data is revalidating in background", async () => {
    const edgeCache = createEdgeCache();
    vi.stubGlobal("caches", { default: edgeCache });
    vi.doMock("../src/providers/meteoblue/service.js", () => {
      class MockMeteoblueWeatherService {
        async getHourly() {
          return {
            location: { id: "toronto_yyz", name: "Toronto Pearson International Airport", timezone: "America/Toronto" },
            fetchedAt: "2026-04-09T00:00:00.000Z",
            sourceObservedAt: null,
            mode: "1h",
            periodHours: 1,
            sourceType: "week-table-1h",
            stale: false,
            freshness: "revalidating",
            pageUrl: "https://example.com/week",
            parserVersion: "test",
            items: [],
            fieldCoverage: {},
            partial: false,
            warnings: [],
            cacheHit: true,
            current: null,
          };
        }

        async getWeatherReport() {
          return {
            location: { id: "toronto_yyz", name: "Toronto Pearson International Airport", timezone: "America/Toronto" },
            pageUrl: "https://example.com/week",
            parserVersion: "test",
            available: true,
            titleEn: "Report",
            sourceTextEn: "Report",
            textZh: "Report",
            metrics: {},
            warnings: [],
            fetchedAt: "2026-04-09T00:00:00.000Z",
            sourceObservedAt: null,
            stale: false,
            freshness: "fresh",
            cacheHit: true,
          };
        }

        async getMultiModelStatus() {
          return {
            location: { id: "toronto_yyz", name: "Toronto Pearson International Airport", timezone: "America/Toronto" },
            pageFetchedAt: null,
            imageFetchedAt: null,
            imageUrlFound: false,
            cacheHit: false,
            stale: false,
            lastError: null,
            lastSuccessAt: null,
            imageUrl: null,
            pageUrl: "https://example.com/multimodel",
          };
        }

        async getMultiModelDistribution() {
          return {
            warnings: [],
            freshness: "fresh",
          };
        }
      }

      return { MeteoblueWeatherService: MockMeteoblueWeatherService };
    });

    const worker = await loadWorker();
    const response = await worker.fetch(
      new Request("https://lukaluka.fun/api/weather/dashboard?locationId=toronto_yyz"),
      createEnv(),
      createContext(),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("s-maxage=30");
    expect(payload).toMatchObject({
      sync: {
        state: "fresh",
        freshness: "fresh",
      },
      hourly: {
        freshness: "revalidating",
      },
    });
    expect(edgeCache.put).toHaveBeenCalled();
  });

  test("does not edge-cache fallback_error insight responses", async () => {
    const edgeCache = createEdgeCache();
    vi.stubGlobal("caches", { default: edgeCache });
    vi.doMock("../src/providers/meteoblue/service.js", () => {
      class MockMeteoblueWeatherService {
        async getMultiModelInsight() {
          return {
            location: { id: "toronto_yyz", name: "Toronto Pearson International Airport", timezone: "America/Toronto" },
            fetchedAt: "2026-04-09T00:00:00.000Z",
            pageUrl: "https://example.com/multimodel",
            selectedTimestamp: "2026-04-09T09:00:00-04:00",
            availableTimestamps: ["2026-04-09T09:00:00-04:00"],
            referenceTemperature: {
              mode: "selected-model-mean",
              temperatureC: 10,
              label: "10C",
            },
            closestModel: null,
            rankedModels: [],
            peakTimeDistribution: [],
            matchedModels: { toleranceC: 0.5, models: [] },
            dayPeakCandidates: { top: [] },
            modelInventory: [],
            chart: {
              chartFormat: "highcharts",
              chartEndpoint: "https://example.com/chart",
              pageFetchedAt: "2026-04-09T00:00:00.000Z",
              parserVersion: "test",
            },
            sourceType: "meteoblue-page-highcharts",
            stale: true,
            freshness: "fallback_error",
            cacheHit: true,
            warnings: ["Serving stale page-derived multimodel insights because the latest highcharts refresh failed."],
          };
        }
      }

      return { MeteoblueWeatherService: MockMeteoblueWeatherService };
    });

    const worker = await loadWorker();
    const response = await worker.fetch(
      new Request("https://lukaluka.fun/api/weather/multimodel/insights?locationId=toronto_yyz"),
      createEnv(),
      createContext(),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(payload).toMatchObject({
      stale: true,
      freshness: "fallback_error",
    });
    expect(edgeCache.put).not.toHaveBeenCalled();
  });

  test("does not edge-cache revalidating multimodel status responses", async () => {
    const edgeCache = createEdgeCache();
    vi.stubGlobal("caches", { default: edgeCache });
    vi.doMock("../src/providers/meteoblue/service.js", () => {
      class MockMeteoblueWeatherService {
        async getMultiModelStatus() {
          return {
            location: { id: "toronto_yyz", name: "Toronto Pearson International Airport", timezone: "America/Toronto" },
            displayUnit: "C",
            fallbackDisplayUnit: "C",
            pageFetchedAt: "2026-04-09T00:00:00.000Z",
            imageFetchedAt: "2026-04-09T00:00:00.000Z",
            imageUrlFound: true,
            cacheHit: true,
            stale: false,
            freshness: "revalidating",
            imageStatus: "ready",
            analysisStatus: "revalidating",
            lastError: null,
            lastSuccessAt: "2026-04-09T00:00:00.000Z",
            imageUrl: "https://example.com/multimodel.png",
            pageUrl: "https://example.com/multimodel",
          };
        }
      }

      return { MeteoblueWeatherService: MockMeteoblueWeatherService };
    });

    const worker = await loadWorker();
    const response = await worker.fetch(
      new Request("https://lukaluka.fun/api/weather/multimodel/status?locationId=toronto_yyz"),
      createEnv(),
      createContext(),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(payload).toMatchObject({
      freshness: "revalidating",
      analysisStatus: "revalidating",
    });
    expect(edgeCache.put).not.toHaveBeenCalled();
  });

  test("dashboard does not trigger multimodel distribution warmup", async () => {
    const getMultiModelDistribution = vi.fn().mockResolvedValue({
      warnings: [],
      freshness: "fresh",
    });

    vi.doMock("../src/providers/meteoblue/service.js", () => {
      class MockMeteoblueWeatherService {
        getMultiModelDistribution = getMultiModelDistribution;

        async getHourly() {
          return {
            location: { id: "toronto_yyz", name: "Toronto Pearson International Airport", timezone: "America/Toronto" },
            fetchedAt: "2026-04-09T00:00:00.000Z",
            sourceObservedAt: null,
            mode: "1h",
            periodHours: 1,
            sourceType: "week-table-1h",
            stale: false,
            freshness: "fresh",
            pageUrl: "https://example.com/week",
            parserVersion: "test",
            items: [],
            fieldCoverage: {},
            partial: false,
            warnings: [],
            cacheHit: true,
            current: null,
          };
        }

        async getWeatherReport() {
          return {
            location: { id: "toronto_yyz", name: "Toronto Pearson International Airport", timezone: "America/Toronto" },
            pageUrl: "https://example.com/week",
            parserVersion: "test",
            available: true,
            titleEn: "Report",
            sourceTextEn: "Report",
            textZh: "Report",
            metrics: {},
            warnings: [],
            fetchedAt: "2026-04-09T00:00:00.000Z",
            sourceObservedAt: null,
            stale: false,
            freshness: "fresh",
            cacheHit: true,
          };
        }

        async getMultiModelStatus() {
          return {
            location: { id: "toronto_yyz", name: "Toronto Pearson International Airport", timezone: "America/Toronto" },
            displayUnit: "C",
            fallbackDisplayUnit: "C",
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
          };
        }
      }

      return { MeteoblueWeatherService: MockMeteoblueWeatherService };
    });

    const worker = await loadWorker();
    const response = await worker.fetch(
      new Request("https://lukaluka.fun/api/weather/dashboard?locationId=toronto_yyz"),
      createEnv(),
      createContext(),
    );

    expect(response.status).toBe(200);
    expect(getMultiModelDistribution).not.toHaveBeenCalled();
  });

  test("edge-caches fresh dashboard responses", async () => {
    const edgeCache = createEdgeCache();
    vi.stubGlobal("caches", { default: edgeCache });
    vi.doMock("../src/providers/meteoblue/service.js", () => {
      class MockMeteoblueWeatherService {
        async getHourly() {
          return {
            location: { id: "toronto_yyz", name: "Toronto Pearson International Airport", timezone: "America/Toronto" },
            fetchedAt: "2026-04-09T00:00:00.000Z",
            sourceObservedAt: null,
            mode: "1h",
            periodHours: 1,
            sourceType: "week-table-1h",
            stale: false,
            freshness: "fresh",
            pageUrl: "https://example.com/week",
            parserVersion: "test",
            items: [],
            fieldCoverage: {},
            partial: false,
            warnings: [],
            cacheHit: true,
            current: null,
          };
        }

        async getWeatherReport() {
          return {
            location: { id: "toronto_yyz", name: "Toronto Pearson International Airport", timezone: "America/Toronto" },
            pageUrl: "https://example.com/week",
            parserVersion: "test",
            available: true,
            titleEn: "Report",
            sourceTextEn: "Report",
            textZh: "Report",
            metrics: {},
            warnings: [],
            fetchedAt: "2026-04-09T00:00:00.000Z",
            sourceObservedAt: null,
            stale: false,
            freshness: "fresh",
            cacheHit: true,
          };
        }

        async getMultiModelStatus() {
          return {
            location: { id: "toronto_yyz", name: "Toronto Pearson International Airport", timezone: "America/Toronto" },
            displayUnit: "C",
            fallbackDisplayUnit: "C",
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
          };
        }

        async getMultiModelDistribution() {
          return {
            warnings: [],
            freshness: "fresh",
          };
        }
      }

      return { MeteoblueWeatherService: MockMeteoblueWeatherService };
    });

    const worker = await loadWorker();
    const response = await worker.fetch(
      new Request("https://lukaluka.fun/api/weather/dashboard?locationId=toronto_yyz"),
      createEnv(),
      createContext(),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("s-maxage=30");
    expect(payload).toMatchObject({
      sync: {
        state: "fresh",
        freshness: "fresh",
      },
    });
    expect(edgeCache.put).toHaveBeenCalledTimes(1);
  });
});
