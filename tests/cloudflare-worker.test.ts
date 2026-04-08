import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

type WorkerModule = typeof import("../src/cloudflare/worker.js");

const createEnv = () => ({
  ASSETS: {
    fetch: vi.fn(async () => new Response("asset", { status: 200 })),
  },
  KELLY_BRIDGE_BASE_URL: "https://kelly-bridge.example.com",
  KELLY_BRIDGE_SHARED_SECRET: "bridge-secret",
});

const createContext = () => ({
  waitUntil: vi.fn(),
});

const loadWorker = async (): Promise<WorkerModule["default"]> => {
  vi.resetModules();
  const module = (await import("../src/cloudflare/worker.js")) as WorkerModule;
  return module.default;
};

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cloudflare worker kelly bridge proxy", () => {
  test("reports worker and bridge health metadata on /healthz", async () => {
    const worker = await loadWorker();
    const env = createEnv();

    const response = await worker.fetch(new Request("https://lukaluka.fun/healthz"), env, createContext());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      service: "weather-worker",
      kellyBridge: {
        configured: true,
        baseUrl: "https://kelly-bridge.example.com",
        cooldownActive: false,
      },
    });
  });

  test("converts bad HTML bridge responses into structured JSON errors", async () => {
    const worker = await loadWorker();
    const env = createEnv();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response("<html><body>520 upstream</body></html>", {
          status: 520,
          headers: {
            "content-type": "text/html; charset=utf-8",
          },
        }),
      );

    const response = await worker.fetch(
      new Request("https://lukaluka.fun/api/weather/kelly?locationId=wuhan_wuh"),
      env,
      createContext(),
    );
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload).toMatchObject({
      code: "KELLY_BRIDGE_UNAVAILABLE",
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("enters cooldown after a bridge failure and short-circuits the next request", async () => {
    const worker = await loadWorker();
    const env = createEnv();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response("<html><body>upstream down</body></html>", {
          status: 520,
          headers: {
            "content-type": "text/html; charset=utf-8",
          },
        }),
      );

    const firstResponse = await worker.fetch(
      new Request("https://lukaluka.fun/api/weather/kelly?locationId=wuhan_wuh"),
      env,
      createContext(),
    );
    const secondResponse = await worker.fetch(
      new Request("https://lukaluka.fun/api/weather/kelly?locationId=wuhan_wuh"),
      env,
      createContext(),
    );

    expect(firstResponse.status).toBe(502);
    expect(secondResponse.status).toBe(503);
    await expect(secondResponse.json()).resolves.toMatchObject({
      code: "KELLY_BRIDGE_COOLDOWN",
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("maps abort errors to a bridge timeout payload", async () => {
    const worker = await loadWorker();
    const env = createEnv();
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));

    const response = await worker.fetch(
      new Request("https://lukaluka.fun/api/weather/kelly?locationId=wuhan_wuh"),
      env,
      createContext(),
    );

    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toMatchObject({
      code: "KELLY_BRIDGE_TIMEOUT",
      retryable: true,
    });
  });
});
