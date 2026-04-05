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
});
