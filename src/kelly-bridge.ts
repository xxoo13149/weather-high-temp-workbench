import { config } from "./config.js";
import { createKellyBridgeApp } from "./kelly/bridge-app.js";

const app = createKellyBridgeApp();

const assertJsonResponse = async (url: string) => {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
    },
    signal: AbortSignal.timeout(Math.max(config.httpTimeoutMs, 20_000)),
  });

  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok) {
    throw new Error(`Bridge smoke check failed for ${url}: received status ${response.status}.`);
  }

  if (!contentType.includes("application/json")) {
    throw new Error(`Bridge smoke check failed for ${url}: expected JSON but received '${contentType || "unknown"}'.`);
  }

  return (await response.json()) as Record<string, unknown>;
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
    const health = await assertJsonResponse(`${resolveSmokeOrigin(address)}/healthz`);
    if (health.ok !== true || health.service !== "kelly-bridge") {
      throw new Error("Bridge smoke check failed for /healthz: missing ok flag or service marker.");
    }
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
