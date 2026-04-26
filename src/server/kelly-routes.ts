import type { FastifyInstance, preHandlerHookHandler } from "fastify";

import { DEFAULT_LOCATION, LOCATION_REGISTRY } from "../config.js";
import { AppError } from "../domain/errors.js";
import type { KellyRiskMode, KellyStreamHandle, KellyStreamMessage, LocationInfo, WeatherService } from "../domain/weather.js";

const parseTimestamp = (raw: unknown): string | undefined => {
  if (raw === undefined || raw === "") {
    return undefined;
  }

  if (typeof raw !== "string") {
    throw new AppError(400, "BAD_REQUEST", "Query parameter 'timestamp' must be a valid ISO timestamp.");
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(400, "BAD_REQUEST", "Query parameter 'timestamp' must be a valid ISO timestamp.");
  }

  return raw;
};

const parseActualTemperatureC = (raw: unknown): number | undefined => {
  if (raw === undefined || raw === "") {
    return undefined;
  }

  if (typeof raw !== "string") {
    throw new AppError(400, "BAD_REQUEST", "Query parameter 'actualTemperatureC' must be a finite number.");
  }

  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) {
    throw new AppError(400, "BAD_REQUEST", "Query parameter 'actualTemperatureC' must be a finite number.");
  }

  return value;
};

const parseKellyTargetDate = (raw: unknown): string | undefined => {
  if (raw === undefined || raw === "") {
    return undefined;
  }

  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new AppError(400, "BAD_REQUEST", "Query parameter 'targetDate' must use YYYY-MM-DD format.");
  }

  return raw;
};

const parseBankroll = (raw: unknown): number | undefined => {
  if (raw === undefined || raw === "") {
    return undefined;
  }

  if (typeof raw !== "string") {
    throw new AppError(400, "BAD_REQUEST", "Query parameter 'bankroll' must be a positive number.");
  }

  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new AppError(400, "BAD_REQUEST", "Query parameter 'bankroll' must be a positive number.");
  }

  return value;
};

const parseKellyRiskMode = (raw: unknown): KellyRiskMode | undefined => {
  if (raw === undefined || raw === "") {
    return undefined;
  }

  if (raw === "conservative" || raw === "balanced" || raw === "aggressive") {
    return raw;
  }

  throw new AppError(400, "BAD_REQUEST", "Query parameter 'riskMode' must be conservative, balanced, or aggressive.");
};

const parseKellyMinEdge = (raw: unknown): number | undefined => {
  if (raw === undefined || raw === "") {
    return undefined;
  }

  if (typeof raw !== "string") {
    throw new AppError(400, "BAD_REQUEST", "Query parameter 'minEdge' must be between 0 and 1.");
  }

  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new AppError(400, "BAD_REQUEST", "Query parameter 'minEdge' must be between 0 and 1.");
  }

  return value;
};

const parseForceRefresh = (raw: unknown): boolean | undefined => {
  if (raw === undefined || raw === "") {
    return undefined;
  }

  if (raw === "true" || raw === "1") {
    return true;
  }

  if (raw === "false" || raw === "0") {
    return false;
  }

  throw new AppError(400, "BAD_REQUEST", "Query parameter 'forceRefresh' must be boolean.");
};

const parseQueryLocationId = (raw: unknown): LocationInfo["id"] => {
  if (raw === undefined || raw === "") {
    return DEFAULT_LOCATION;
  }

  if (typeof raw !== "string" || raw.trim() === "") {
    throw new AppError(400, "BAD_REQUEST", "Query parameter 'locationId' must be a supported location id.");
  }

  const locationId = raw.trim() as LocationInfo["id"];
  if (!(locationId in LOCATION_REGISTRY)) {
    throw new AppError(400, "BAD_REQUEST", `Query parameter 'locationId' is not supported: '${raw}'.`);
  }

  return locationId;
};

const parseKellyQuery = (query: Record<string, unknown> | undefined) => {
  const normalizedQuery = query ?? {};
  return {
    locationId: parseQueryLocationId(normalizedQuery.locationId),
    options: {
      targetDate: parseKellyTargetDate(normalizedQuery.targetDate),
      bankroll: parseBankroll(normalizedQuery.bankroll),
      riskMode: parseKellyRiskMode(normalizedQuery.riskMode),
      minEdge: parseKellyMinEdge(normalizedQuery.minEdge),
      actualTemperatureC: parseActualTemperatureC(normalizedQuery.actualTemperatureC),
      selectedHourTimestamp: parseTimestamp(normalizedQuery.selectedHour),
      forceRefresh: parseForceRefresh(normalizedQuery.forceRefresh),
    },
  };
};

interface RegisterKellyRoutesOptions {
  enableWebSocketRoutes?: boolean;
  preHandler?: preHandlerHookHandler;
}

const sendSocketMessage = (socket: { readyState: number; OPEN: number; send(value: string): void }, message: KellyStreamMessage) => {
  if (socket.readyState !== socket.OPEN) {
    return;
  }

  socket.send(JSON.stringify(message));
};

const KELLY_STREAM_INIT_MAX_ATTEMPTS = 2;
const KELLY_STREAM_INIT_RETRY_DELAY_MS = 750;

const sleep = async (ms: number) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

export const registerKellyRoutes = (
  app: FastifyInstance,
  service: WeatherService,
  options: RegisterKellyRoutesOptions = {},
) => {
  const enableWebSocketRoutes = options.enableWebSocketRoutes ?? true;
  const routeOptions = options.preHandler ? { preHandler: options.preHandler } : {};

  app.get("/api/weather/kelly", routeOptions, async (request) => {
    if (!service.getKellyWorkbench) {
      throw new AppError(503, "KELLY_UNAVAILABLE", "Kelly workbench is not configured.", {
        retryable: false,
      });
    }

    const { locationId, options: kellyOptions } = parseKellyQuery(
      (request.query as Record<string, unknown> | undefined) ?? {},
    );
    return await service.getKellyWorkbench(locationId, kellyOptions);
  });

  if (!enableWebSocketRoutes) {
    return;
  }

  app.register(async (wsApp) => {
    wsApp.get(
      "/api/weather/kelly/stream",
      {
        websocket: true,
        ...(options.preHandler ? { preHandler: options.preHandler } : {}),
      },
      async (socket, request) => {
        if (!service.createKellyStream) {
          sendSocketMessage(socket, {
            type: "status",
            generatedAt: new Date().toISOString(),
            state: "unavailable",
            reasonCode: "upstream_error",
            message: "Kelly real-time stream is not configured.",
          });
          socket.close();
          return;
        }
        const createKellyStream = service.createKellyStream.bind(service);

        let streamHandle: KellyStreamHandle | null = null;
        let closeRequested = false;
        let resolveClosed: (() => void) | null = null;
        const socketClosed = new Promise<void>((resolve) => {
          resolveClosed = resolve;
        });

        socket.on("close", () => {
          closeRequested = true;
          if (streamHandle) {
            const streamToClose = streamHandle;
            streamHandle = null;
            void streamToClose.close();
          }
          resolveClosed?.();
        });

        try {
          const { locationId, options: kellyOptions } = parseKellyQuery(
            (request.query as Record<string, unknown> | undefined) ?? {},
          );

          sendSocketMessage(socket, {
            type: "status",
            generatedAt: new Date().toISOString(),
            state: "connected",
            reasonCode: "snapshot_loaded",
            message: "实时流握手成功，正在初始化首轮快照。",
            lastSignalAt: null,
            lastRepricedAt: null,
          });

          void (async () => {
            try {
              for (let attempt = 1; attempt <= KELLY_STREAM_INIT_MAX_ATTEMPTS; attempt += 1) {
                try {
                  const nextHandle = await createKellyStream(locationId, kellyOptions, (message) => {
                    sendSocketMessage(socket, message);
                  });

                  if (closeRequested || socket.readyState !== socket.OPEN) {
                    await nextHandle.close();
                    return;
                  }

                  streamHandle = nextHandle;
                  return;
                } catch (error) {
                  const appError =
                    error instanceof AppError
                      ? error
                      : new AppError(500, "KELLY_STREAM_ERROR", "Kelly stream initialization failed.");
                  if (attempt >= KELLY_STREAM_INIT_MAX_ATTEMPTS) {
                    throw appError;
                  }

                  sendSocketMessage(socket, {
                    type: "status",
                    generatedAt: new Date().toISOString(),
                    state: "degraded",
                    reasonCode: "upstream_error",
                    message: "Kelly stream bootstrap hit a transient error, retrying once.",
                  });

                  if (closeRequested || socket.readyState !== socket.OPEN) {
                    return;
                  }

                  await sleep(KELLY_STREAM_INIT_RETRY_DELAY_MS);
                }
              }
            } catch (error) {
              const appError =
                error instanceof AppError
                  ? error
                  : new AppError(500, "KELLY_STREAM_ERROR", "Kelly stream initialization failed.");
              if (socket.readyState === socket.OPEN) {
                sendSocketMessage(socket, {
                  type: "status",
                  generatedAt: new Date().toISOString(),
                  state: "degraded",
                  reasonCode: "upstream_error",
                  message: appError.message,
                });
                socket.close();
              }
            }
          })();

          await socketClosed;
        } catch (error) {
          const appError =
            error instanceof AppError ? error : new AppError(500, "KELLY_STREAM_ERROR", "Kelly stream initialization failed.");
          sendSocketMessage(socket, {
            type: "status",
            generatedAt: new Date().toISOString(),
            state: "degraded",
            reasonCode: "upstream_error",
            message: appError.message,
          });
          socket.close();
          await socketClosed;
        }
      },
    );
  });
};
