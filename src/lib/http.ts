import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { config } from "../config.js";
import { AppError } from "../domain/errors.js";

const execFileAsync = promisify(execFile);

const defaultHeaders = {
  "accept-language": "en-US,en;q=0.9",
  "user-agent": config.userAgent,
};

const isPolymarketUrl = (url: string) => {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname.includes("polymarket.com");
  } catch {
    return false;
  }
};

const buildCurlCommand = (url: string, init?: RequestInit) => {
  const headers = {
    ...defaultHeaders,
    ...(init?.headers ?? {}),
  };

  const headerArgs = Object.entries(headers).flatMap(([key, value]) =>
    value === undefined ? [] : ["-H", `${key}: ${String(value)}`],
  );

  const method = (init?.method ?? "GET").toUpperCase();
  const command = process.platform === "win32" ? "curl.exe" : "curl";
  const args = [
    "-fsSL",
    "--compressed",
    "--connect-timeout",
    String(Math.max(1, Math.ceil(config.httpTimeoutMs / 1_000))),
    "--max-time",
    String(Math.max(2, Math.ceil(config.httpTimeoutMs / 1_000))),
    "-X",
    method,
    ...headerArgs,
    url,
  ];

  return {
    command,
    args,
  };
};

const buildWindowsWebRequestCommand = (url: string, init?: RequestInit) => {
  const headers = {
    ...defaultHeaders,
    ...(init?.headers ?? {}),
  };
  const method = (init?.method ?? "GET").toUpperCase();
  const escapedUrl = url.replace(/'/g, "''");
  const headerLiteral =
    "@{" +
    Object.entries(headers)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `'${key.replace(/'/g, "''")}'='${String(value).replace(/'/g, "''")}'`)
      .join(";") +
    "}";
  const timeoutSeconds = Math.max(2, Math.ceil(config.httpTimeoutMs / 1_000));
  const script = [
    "$ProgressPreference='SilentlyContinue'",
    `$headers=${headerLiteral}`,
    `$response=Invoke-WebRequest -Uri '${escapedUrl}' -Method ${method} -Headers $headers -UseBasicParsing -TimeoutSec ${timeoutSeconds}`,
    "$bytes=[Text.Encoding]::UTF8.GetBytes($response.Content)",
    "[Console]::OpenStandardOutput().Write($bytes,0,$bytes.Length)",
  ].join("; ");

  return {
    command: "powershell.exe",
    args: ["-NoLogo", "-NoProfile", "-Command", script],
  };
};

const fetchWithShellFallback = async (url: string, init?: RequestInit): Promise<Buffer> => {
  const { command, args } =
    process.platform === "win32" ? buildWindowsWebRequestCommand(url, init) : buildCurlCommand(url, init);

  try {
    const { stdout } = await execFileAsync(command, args, {
      encoding: "buffer",
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    throw new AppError(502, "UPSTREAM_FETCH_FAILED", `Failed to fetch via curl ${url}: ${String(error)}`, {
      retryable: true,
    });
  }
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
  if (isPolymarketUrl(url)) {
    const body = await fetchWithShellFallback(url);
    return body.toString("utf-8");
  }

  try {
    const response = await fetchWithHandling(url, "UPSTREAM_FETCH_FAILED", "Failed to fetch");
    return await response.text();
  } catch (error) {
    if (!isPolymarketUrl(url)) {
      throw error;
    }

    const body = await fetchWithShellFallback(url);
    return body.toString("utf-8");
  }
};

export const fetchJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  if (isPolymarketUrl(url)) {
    try {
      const body = await fetchWithShellFallback(url, init);
      return JSON.parse(body.toString("utf-8")) as T;
    } catch (fallbackError) {
      throw new AppError(
        502,
        "UPSTREAM_JSON_PARSE_FAILED",
        `Failed to parse JSON from ${url}: ${String(fallbackError)}`,
        {
          retryable: true,
        },
      );
    }
  }

  try {
    const response = await fetchWithHandling(url, "UPSTREAM_JSON_FETCH_FAILED", "Failed to fetch JSON", init);
    return (await response.json()) as T;
  } catch (error) {
    if (!isPolymarketUrl(url)) {
      throw new AppError(502, "UPSTREAM_JSON_PARSE_FAILED", `Failed to parse JSON from ${url}: ${String(error)}`, {
        retryable: true,
      });
    }

    try {
      const body = await fetchWithShellFallback(url, init);
      return JSON.parse(body.toString("utf-8")) as T;
    } catch (fallbackError) {
      throw new AppError(
        502,
        "UPSTREAM_JSON_PARSE_FAILED",
        `Failed to parse JSON from ${url}: ${String(fallbackError)}`,
        {
          retryable: true,
        },
      );
    }
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
