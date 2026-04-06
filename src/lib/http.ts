import { config } from "../config.js";
import { AppError } from "../domain/errors.js";

const defaultHeaders = {
  "accept-language": "en-US,en;q=0.9",
  "user-agent": config.userAgent,
};

const fetchWithHandling = async (
  url: string,
  errorCode: string,
  messagePrefix: string,
  init?: RequestInit,
): Promise<Response> => {
  let response: Response;

  try {
    response = await fetch(url, {
      ...init,
      headers: {
        ...defaultHeaders,
        ...(init?.headers ?? {}),
      },
      signal: init?.signal ?? AbortSignal.timeout(config.httpTimeoutMs),
    });
  } catch (error) {
    throw new AppError(502, errorCode, `${messagePrefix} ${url}: ${String(error)}`, {
      retryable: true,
    });
  }

  if (!response.ok) {
    throw new AppError(502, "UPSTREAM_BAD_STATUS", `Upstream returned ${response.status} for ${url}`, {
      retryable: response.status >= 500,
    });
  }

  return response;
};

export const fetchText = async (url: string): Promise<string> => {
  const response = await fetchWithHandling(url, "UPSTREAM_FETCH_FAILED", "Failed to fetch");
  return await response.text();
};

export const fetchJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetchWithHandling(url, "UPSTREAM_JSON_FETCH_FAILED", "Failed to fetch JSON", init);

  try {
    return (await response.json()) as T;
  } catch (error) {
    throw new AppError(502, "UPSTREAM_JSON_PARSE_FAILED", `Failed to parse JSON from ${url}: ${String(error)}`, {
      retryable: true,
    });
  }
};

export const fetchBinary = async (
  url: string,
): Promise<{ body: Buffer; contentType: string; headers: Headers }> => {
  let response: Response;

  try {
    response = await fetch(url, {
      headers: defaultHeaders,
      signal: AbortSignal.timeout(config.httpTimeoutMs),
    });
  } catch (error) {
    throw new AppError(502, "UPSTREAM_IMAGE_FETCH_FAILED", `Failed to fetch image ${url}: ${String(error)}`, {
      retryable: true,
    });
  }

  if (!response.ok) {
    throw new AppError(502, "UPSTREAM_IMAGE_BAD_STATUS", `Image upstream returned ${response.status}`, {
      retryable: response.status >= 500,
    });
  }

  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  const arrayBuffer = await response.arrayBuffer();

  return {
    body: Buffer.from(arrayBuffer),
    contentType,
    headers: response.headers,
  };
};
