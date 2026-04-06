import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

describe("weatherApi", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("window", {
      location: {
        origin: "http://localhost:3000",
      },
    });
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("throws a protocol error when a JSON endpoint returns html", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      new Response("<!doctype html><html><body>fallback</body></html>", {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
        },
      }),
    );

    const apiModulePath = new URL("../zip/src/api.ts", import.meta.url).href;
    const { weatherApi } = (await import(apiModulePath)) as { weatherApi: { fetchFavorites: () => Promise<unknown> } };

    await expect(weatherApi.fetchFavorites()).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining("Expected JSON"),
    });
  });

  test("includes locationId in weather endpoint requests", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          generatedAt: "2026-04-04T00:00:00.000Z",
          sync: { state: "fresh", label: "synced", updatedAt: "2026-04-04T00:00:00.000Z" },
          locationDirectory: [],
          hourly: {},
          report: {},
          multimodel: {},
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
        },
      ),
    );

    const apiModulePath = new URL("../zip/src/api.ts", import.meta.url).href;
    const { weatherApi } = (await import(apiModulePath)) as {
      weatherApi: { fetchDashboard: (mode?: "1h" | "3h", limit?: number, locationId?: string) => Promise<unknown> };
    };

    await weatherApi.fetchDashboard("1h", 24, "miami_mia");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/weather/dashboard?mode=1h&limit=24&locationId=miami_mia"),
      expect.any(Object),
    );
  });

  test("builds Kelly endpoint requests with route controls", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          location: { id: "miami_mia", name: "Miami International Airport", timezone: "America/New_York" },
          targetDate: "2026-03-28",
          availableTargetDates: ["2026-03-28"],
          generatedAt: "2026-03-28T00:00:00.000Z",
          bankroll: 1000,
          riskMode: "balanced",
          riskMultiplier: 0.5,
          minEdge: 0.02,
          weatherEvidence: {},
          distributionSummary: {},
          probabilityCurve: [],
          bucketProbabilities: [],
          markets: [],
          recommendations: [],
          sourceLinks: {},
          sourceStatus: [],
          warnings: [],
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
        },
      ),
    );

    const apiModulePath = new URL("../zip/src/api.ts", import.meta.url).href;
    const { weatherApi } = (await import(apiModulePath)) as {
      weatherApi: {
        fetchKellyWorkbench: (
          locationId?: string,
          targetDate?: string,
          bankroll?: number,
          riskMode?: "conservative" | "balanced" | "aggressive",
          minEdge?: number,
          actualTemperatureC?: number,
          selectedHour?: string,
        ) => Promise<unknown>;
        buildKellyStreamUrl: (
          locationId?: string,
          targetDate?: string,
          bankroll?: number,
          riskMode?: "conservative" | "balanced" | "aggressive",
          minEdge?: number,
          actualTemperatureC?: number,
          selectedHour?: string,
        ) => string;
      };
    };

    await weatherApi.fetchKellyWorkbench("miami_mia", "2026-03-28", 2500, "aggressive", 0.03, 24.5, "2026-03-28T16:00:00-04:00");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "/api/weather/kelly?locationId=miami_mia&targetDate=2026-03-28&bankroll=2500&riskMode=aggressive&minEdge=0.03&actualTemperatureC=24.5&selectedHour=2026-03-28T16%3A00%3A00-04%3A00",
      ),
      expect.any(Object),
    );

    expect(
      weatherApi.buildKellyStreamUrl("miami_mia", "2026-03-28", 2500, "aggressive", 0.03, 24.5, "2026-03-28T16:00:00-04:00"),
    ).toContain("ws://localhost:3000/api/weather/kelly/stream");
  });
});
