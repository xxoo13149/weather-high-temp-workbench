import { createApp } from "../app.js";
import { CloudflareFavoritesStore, InMemoryFavoritesStore } from "./favorites-store.js";
import type { KellyRequestOptions, KellyStreamMessage, LocationInfo } from "../domain/weather.js";
import { MeteoblueWeatherService } from "../providers/meteoblue/service.js";

type AssetBinding = {
  fetch(request: Request): Promise<Response>;
};

type WorkerEnv = {
  ASSETS: AssetBinding;
  FAVORITES_KV?: {
    get(key: string): Promise<string | null>;
    put(key: string, value: string): Promise<void>;
  };
};

type WorkerContext = {
  waitUntil(promise: Promise<unknown>): void;
};

type InjectResponse = {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  rawPayload?: Uint8Array | Buffer;
  payload?: string;
};

type WebSocketPairCtor = new () => {
  0: CloudflareWebSocket;
  1: CloudflareWebSocket;
};

type CloudflareWebSocket = WebSocket & {
  accept(): void;
  close(code?: number, reason?: string): void;
};

type AppInstance = Awaited<ReturnType<typeof createApp>>;

let appPromise: Promise<AppInstance> | null = null;
let servicePromise: Promise<MeteoblueWeatherService> | null = null;

const getService = async (env: WorkerEnv) => {
  if (!servicePromise) {
    const favoritesStore = env.FAVORITES_KV
      ? new CloudflareFavoritesStore(env.FAVORITES_KV)
      : new InMemoryFavoritesStore();
    servicePromise = Promise.resolve(new MeteoblueWeatherService({ favoritesStore }));
  }

  return await servicePromise;
};

const getApp = async (env: WorkerEnv) => {
  if (!appPromise) {
    appPromise = (async () => {
      const app = createApp(await getService(env));
      await app.ready();
      return app;
    })();
  }

  return await appPromise;
};

const toHeadersObject = (request: Request): Record<string, string> => {
  const headers: Record<string, string> = {};
  for (const [key, value] of request.headers.entries()) {
    headers[key] = value;
  }
  return headers;
};

const toResponseHeaders = (headers: InjectResponse["headers"]): Headers => {
  const responseHeaders = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (!value) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        responseHeaders.append(key, entry);
      }
      continue;
    }

    responseHeaders.set(key, value);
  }

  return responseHeaders;
};

const injectRequest = async (request: Request, env: WorkerEnv): Promise<Response> => {
  const app = await getApp(env);
  const url = new URL(request.url);
  const payload =
    request.method === "GET" || request.method === "HEAD" ? undefined : Buffer.from(await request.arrayBuffer());
  const response = (await (app.inject({
    method: request.method as never,
    url: `${url.pathname}${url.search}`,
    headers: toHeadersObject(request),
    payload,
  }) as unknown as Promise<InjectResponse>)) as InjectResponse;

  const body =
    response.rawPayload !== undefined
      ? new Uint8Array(response.rawPayload)
      : response.payload ?? "";
  return new Response(body, {
    status: response.statusCode,
    headers: toResponseHeaders(response.headers),
  });
};

const parseNumber = (value: string | null): number | undefined => {
  if (!value?.trim()) {
    return undefined;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const parseKellyOptions = (url: URL): KellyRequestOptions => ({
  targetDate: url.searchParams.get("targetDate") ?? undefined,
  bankroll: parseNumber(url.searchParams.get("bankroll")),
  riskMode:
    url.searchParams.get("riskMode") === "conservative" ||
    url.searchParams.get("riskMode") === "balanced" ||
    url.searchParams.get("riskMode") === "aggressive"
      ? (url.searchParams.get("riskMode") as KellyRequestOptions["riskMode"])
      : undefined,
  minEdge: parseNumber(url.searchParams.get("minEdge")),
  actualTemperatureC: parseNumber(url.searchParams.get("actualTemperatureC")),
  selectedHourTimestamp: url.searchParams.get("selectedHour") ?? undefined,
});

const sendSocketMessage = (socket: CloudflareWebSocket, message: KellyStreamMessage) => {
  try {
    socket.send(JSON.stringify(message));
  } catch {
    socket.close();
  }
};

const handleKellyStream = async (request: Request, env: WorkerEnv, ctx: WorkerContext) => {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Expected Upgrade: websocket", { status: 426 });
  }

  const pair = new ((globalThis as unknown as { WebSocketPair: WebSocketPairCtor }).WebSocketPair)();
  const client = pair[0];
  const server = pair[1];
  server.accept();

  const service = await getService(env);
  const url = new URL(request.url);
  const locationId = (url.searchParams.get("locationId") ?? "") as LocationInfo["id"];

  ctx.waitUntil(
    (async () => {
      try {
        const stream = await service.createKellyStream(locationId, parseKellyOptions(url), (message) =>
          sendSocketMessage(server, message),
        );

        const closeStream = async () => {
          try {
            await stream.close();
          } catch {
            // ignore cleanup errors
          }
        };

        server.addEventListener("close", () => {
          ctx.waitUntil(closeStream());
        });
        server.addEventListener("error", () => {
          ctx.waitUntil(closeStream());
        });
      } catch (error) {
        sendSocketMessage(server, {
          type: "status",
          generatedAt: new Date().toISOString(),
          state: "degraded",
          reasonCode: "upstream_error",
          message: error instanceof Error ? error.message : "Kelly 实时流初始化失败。",
        });
        server.close(1011, "kelly-stream-error");
      }
    })(),
  );

  return new Response(null, {
    status: 101,
    // Cloudflare Workers extends ResponseInit with the `webSocket` property.
    ...( { webSocket: client } as ResponseInit ),
  });
};

const isApiRequest = (pathname: string) => pathname === "/healthz" || pathname.startsWith("/api/");

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: WorkerContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/weather/kelly/stream") {
      return await handleKellyStream(request, env, ctx);
    }

    if (isApiRequest(url.pathname)) {
      return await injectRequest(request, env);
    }

    return await env.ASSETS.fetch(request);
  },
};
