import websocket from "@fastify/websocket";
import Fastify from "fastify";

import { config } from "../config.js";
import { AppError, isAppError } from "../domain/errors.js";
import type { WeatherService } from "../domain/weather.js";
import { MeteoblueWeatherService } from "../providers/meteoblue/service.js";
import { registerKellyRoutes } from "../server/kelly-routes.js";
import { createKellyBridgeAuthPreHandler } from "./bridge-auth.js";

interface CreateKellyBridgeAppOptions {
  buildId?: string;
  service?: WeatherService;
  sharedSecret?: string;
}

export const createKellyBridgeApp = (options: CreateKellyBridgeAppOptions = {}) => {
  const app = Fastify({
    logger: false,
  });
  const service = options.service ?? new MeteoblueWeatherService();
  const buildId = options.buildId ?? process.env.BUILD_ID ?? `kelly-bridge-${Date.now().toString(36)}`;
  const startedAt = new Date().toISOString();
  const preHandler = createKellyBridgeAuthPreHandler(options.sharedSecret ?? config.kellyBridgeSharedSecret);

  app.register(websocket);

  app.setErrorHandler((error, _request, reply) => {
    if (isAppError(error)) {
      reply.code(error.statusCode).type("application/json; charset=utf-8").send(error.toPayload());
      return;
    }

    const fallback = new AppError(500, "INTERNAL_SERVER_ERROR", "Unexpected bridge server error.");
    reply.code(500).type("application/json; charset=utf-8").send(fallback.toPayload());
  });

  app.get("/healthz", async () => ({
    ok: true,
    service: "kelly-bridge",
    buildId,
    startedAt,
    sharedSecretProtected: Boolean(preHandler),
    runtime: service.getKellyBridgeHealth?.() ?? null,
  }));

  registerKellyRoutes(app, service, {
    enableWebSocketRoutes: true,
    preHandler,
  });

  return app;
};
