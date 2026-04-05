import { config } from "./config.js";
import { createApp } from "./app.js";

const app = createApp();

const assertJsonResponse = async (url: string) => {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
    },
    signal: AbortSignal.timeout(Math.max(config.httpTimeoutMs, 20_000)),
  });

  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok) {
    throw new Error(`Smoke check failed for ${url}: received status ${response.status}.`);
  }

  if (!contentType.includes("application/json")) {
    throw new Error(`Smoke check failed for ${url}: expected JSON but received '${contentType || "unknown"}'.`);
  }

  return (await response.json()) as Record<string, unknown>;
};

const runStartupSmokeChecks = async (origin: string) => {
  const health = await assertJsonResponse(`${origin}/healthz`);
  if (health.ok !== true || typeof health.buildId !== "string" || health.buildId.length === 0) {
    throw new Error("Smoke check failed for /healthz: missing buildId or ok flag.");
  }

  await assertJsonResponse(`${origin}/api/weather/dashboard?mode=1h&limit=1`);
  await assertJsonResponse(`${origin}/api/user/favorites`);
};

const resolveSmokeOrigin = (address: string): string => {
  const url = new URL(address);
  if (url.hostname === "0.0.0.0" || url.hostname === "[::]") {
    url.hostname = "127.0.0.1";
  }

  return url.origin;
};

const start = async (): Promise<void> => {
  const address = await app.listen({
    host: config.host,
    port: config.port,
  });

  try {
    await runStartupSmokeChecks(resolveSmokeOrigin(address));
  } catch (error) {
    app.log.error(error);
    await app.close();
    throw error;
  }
};

start().catch((error) => {
  app.log.error(error);
  console.error(error);
  process.exitCode = 1;
});
