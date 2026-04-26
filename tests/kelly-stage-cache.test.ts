import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { loadKellyStageCache } from "../src/server/kelly-stage-cache.js";

describe("loadKellyStageCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("returns fresh data when the refresh completes inside the soft budget", async () => {
    const freshResult = {
      value: { payload: "fresh" },
      cacheHit: false,
      stale: false,
      freshness: "fresh" as const,
    };
    const get = vi.fn().mockResolvedValue(freshResult);
    const cache = {
      peek: vi.fn(() => ({
        entry: {
          value: { payload: "stale" },
        },
      })),
      get,
    };

    const result = await loadKellyStageCache(cache as never, {
      allowStaleOnError: true,
      softTimeoutMs: 1_000,
      createTimeoutError: () => new Error("timeout"),
    });

    expect(result).toBe(freshResult);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith({
      allowStaleOnError: true,
      forceRefresh: undefined,
    });
  });

  test("returns stale cache immediately when a refresh is already in flight", async () => {
    const staleResult = {
      value: { payload: "stale" },
      cacheHit: true,
      stale: true,
      freshness: "revalidating" as const,
    };
    const get = vi.fn().mockResolvedValue(staleResult);
    const cache = {
      peek: vi.fn(() => ({
        entry: {
          value: { payload: "stale" },
        },
        inFlight: true,
        lastError: null,
      })),
      get,
    };

    const result = await loadKellyStageCache(cache as never, {
      allowStaleOnError: true,
      softTimeoutMs: 1_000,
      createTimeoutError: () => new Error("timeout"),
    });

    expect(result).toBe(staleResult);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith({
      allowStaleOnError: true,
      forceRefresh: false,
      staleWhileRevalidate: true,
    });
  });

  test("returns stale cache immediately when the previous refresh already failed", async () => {
    const staleResult = {
      value: { payload: "stale" },
      cacheHit: true,
      stale: true,
      freshness: "fallback_error" as const,
    };
    const get = vi.fn().mockResolvedValue(staleResult);
    const cache = {
      peek: vi.fn(() => ({
        entry: {
          value: { payload: "stale" },
        },
        inFlight: false,
        lastError: "boom",
      })),
      get,
    };

    const result = await loadKellyStageCache(cache as never, {
      allowStaleOnError: true,
      softTimeoutMs: 1_000,
      createTimeoutError: () => new Error("timeout"),
    });

    expect(result).toBe(staleResult);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith({
      allowStaleOnError: true,
      forceRefresh: false,
      staleWhileRevalidate: true,
    });
  });

  test("falls back to stale cache when the refresh misses the soft budget", async () => {
    let releaseFresh!: (value: unknown) => void;
    const pendingFresh = new Promise((resolve) => {
      releaseFresh = resolve;
    });
    const staleResult = {
      value: { payload: "stale" },
      cacheHit: true,
      stale: true,
      freshness: "revalidating" as const,
    };
    const get = vi
      .fn()
      .mockImplementationOnce(() => pendingFresh)
      .mockResolvedValueOnce(staleResult);
    const cache = {
      peek: vi.fn(() => ({
        entry: {
          value: { payload: "stale" },
        },
      })),
      get,
    };

    const loading = loadKellyStageCache(cache as never, {
      allowStaleOnError: true,
      softTimeoutMs: 1_000,
      createTimeoutError: () => new Error("timeout"),
    });

    await vi.advanceTimersByTimeAsync(1_001);

    await expect(loading).resolves.toBe(staleResult);
    expect(get).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenNthCalledWith(1, {
      allowStaleOnError: true,
      forceRefresh: undefined,
    });
    expect(get).toHaveBeenNthCalledWith(2, {
      allowStaleOnError: true,
      forceRefresh: false,
      staleWhileRevalidate: true,
    });

    releaseFresh({
      value: { payload: "fresh" },
      cacheHit: false,
      stale: false,
      freshness: "fresh",
    });
  });

  test("returns stale cache immediately while a refresh is already in flight", async () => {
    const staleResult = {
      value: { payload: "stale" },
      cacheHit: true,
      stale: true,
      freshness: "revalidating" as const,
    };
    const get = vi.fn().mockResolvedValue(staleResult);
    const cache = {
      peek: vi.fn(() => ({
        entry: {
          value: { payload: "stale" },
        },
        inFlight: true,
        lastError: null,
      })),
      get,
    };

    const result = await loadKellyStageCache(cache as never, {
      allowStaleOnError: true,
      softTimeoutMs: 1_000,
      createTimeoutError: () => new Error("timeout"),
    });

    expect(result).toBe(staleResult);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith({
      allowStaleOnError: true,
      forceRefresh: false,
      staleWhileRevalidate: true,
    });
  });

  test("returns stale cache immediately after a failed refresh when a cached entry exists", async () => {
    const staleResult = {
      value: { payload: "stale" },
      cacheHit: true,
      stale: true,
      freshness: "fallback_error" as const,
    };
    const get = vi.fn().mockResolvedValue(staleResult);
    const cache = {
      peek: vi.fn(() => ({
        entry: {
          value: { payload: "stale" },
        },
        inFlight: false,
        lastError: "refresh boom",
      })),
      get,
    };

    const result = await loadKellyStageCache(cache as never, {
      allowStaleOnError: true,
      softTimeoutMs: 1_000,
      createTimeoutError: () => new Error("timeout"),
    });

    expect(result).toBe(staleResult);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith({
      allowStaleOnError: true,
      forceRefresh: false,
      staleWhileRevalidate: true,
    });
  });

  test("throws a timeout when there is no cached entry to fall back to", async () => {
    const get = vi.fn().mockImplementation(() => new Promise(() => undefined));
    const cache = {
      peek: vi.fn(() => ({
        entry: null,
      })),
      get,
    };

    const loading = loadKellyStageCache(cache as never, {
      allowStaleOnError: true,
      softTimeoutMs: 1_000,
      createTimeoutError: () => new Error("soft-timeout"),
    });
    const observed = expect(loading).rejects.toThrow("soft-timeout");

    await vi.advanceTimersByTimeAsync(1_001);

    await observed;
    expect(get).toHaveBeenCalledTimes(1);
  });
});
