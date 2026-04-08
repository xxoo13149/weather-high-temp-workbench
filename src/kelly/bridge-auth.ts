import { timingSafeEqual } from "node:crypto";

import type { preHandlerHookHandler } from "fastify";

import { AppError } from "../domain/errors.js";
import { KELLY_BRIDGE_SHARED_SECRET_HEADER } from "./bridge-contract.js";

const readSecretHeader = (value: string | string[] | undefined): string | null => {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (Array.isArray(value) && value.length > 0 && typeof value[0] === "string" && value[0].length > 0) {
    return value[0];
  }

  return null;
};

export const createKellyBridgeAuthPreHandler = (sharedSecret: string | undefined): preHandlerHookHandler | undefined => {
  const expectedSecret = sharedSecret?.trim();
  if (!expectedSecret) {
    return undefined;
  }

  const expectedBuffer = Buffer.from(expectedSecret);
  return async (request) => {
    const providedSecret = readSecretHeader(request.headers[KELLY_BRIDGE_SHARED_SECRET_HEADER]);
    if (!providedSecret) {
      throw new AppError(401, "UNAUTHORIZED", "Missing Kelly bridge authorization header.");
    }

    const providedBuffer = Buffer.from(providedSecret);
    if (providedBuffer.length !== expectedBuffer.length || !timingSafeEqual(providedBuffer, expectedBuffer)) {
      throw new AppError(401, "UNAUTHORIZED", "Kelly bridge authorization failed.");
    }
  };
};
