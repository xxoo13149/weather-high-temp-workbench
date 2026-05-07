import { describe, expect, it, vi } from "vitest";

import { RefreshableCache } from "../src/lib/cache.js";

describe("RefreshableCache", () => {
  it("returns stale cache when reload fails and allowStaleOnError is enabled", async () => {
    let attempts = 0;
    const cache = new RefreshableCache(1, async () => {
      attempts += 1;
      if (attempts === 1) {
        return { value: "fresh" };
      }

      throw new Error("boom");
    });

    const first = await cache.get();
    expect(first.stale).toBe(false);
    expect(first.freshness).toBe("fresh");

    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await cache.get({ allowStaleOnError: true });

    expect(second.value).toEqual({ value: "fresh" });
    expect(second.stale).toBe(true);
    expect(second.freshness).toBe("fallback_error");
    expect(cache.peek().lastError).toContain("boom");
    expect(cache.peek().freshness).toBe("fallback_error");
  });

  it("deduplicates concurrent refreshes", async () => {
    let calls = 0;
    const cache = new RefreshableCache(1, async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return calls;
    });

    await cache.get();
    await new Promise((resolve) => setTimeout(resolve, 5));

    const [first, second] = await Promise.all([cache.get(), cache.get()]);
    expect(first.value).toBe(2);
    expect(second.value).toBe(2);
    expect(calls).toBe(2);
  });

  it("reuses an in-flight load even when later callers request forceRefresh", async () => {
    let calls = 0;
    let release!: (value: number) => void;
    const cache = new RefreshableCache(1, async () => {
      calls += 1;
      return await new Promise<number>((resolve) => {
        release = resolve;
      });
    });

    const first = cache.get({ forceRefresh: true });
    const second = cache.get({ forceRefresh: true });

    expect(calls).toBe(1);

    release(7);
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult.value).toBe(7);
    expect(secondResult.value).toBe(7);
    expect(calls).toBe(1);
  });

  it("lets a cold foreground read overtake a background load", async () => {
    const releases: Array<(value: string) => void> = [];
    const modes: string[] = [];
    const cache = new RefreshableCache(60_000, async ({ mode }) => {
      modes.push(mode);
      return await new Promise<string>((resolve) => {
        releases.push(resolve);
      });
    });

    const background = cache.get({ background: true });
    expect(cache.peek().inFlightMode).toBe("background");

    const foreground = cache.get();
    expect(cache.peek().inFlightMode).toBe("foreground");
    expect(modes).toEqual(["background", "foreground"]);

    releases[1]?.("foreground-value");
    await expect(foreground).resolves.toMatchObject({
      value: "foreground-value",
      freshness: "fresh",
    });
    expect(cache.peek().entry?.value).toBe("foreground-value");

    releases[0]?.("background-value");
    await expect(background).resolves.toMatchObject({
      value: "background-value",
      freshness: "fresh",
    });
    expect(cache.peek().entry?.value).toBe("foreground-value");
  });

  it("returns stale value immediately and refreshes in background when staleWhileRevalidate is enabled", async () => {
    vi.useFakeTimers();

    try {
      let calls = 0;
      let release!: (value: number) => void;
      const cache = new RefreshableCache(1, async () => {
        calls += 1;
        if (calls === 1) {
          return 1;
        }

        return await new Promise<number>((resolve) => {
          release = resolve;
        });
      });

      await cache.get();
      await vi.advanceTimersByTimeAsync(5);

      const stale = await cache.get({ staleWhileRevalidate: true });
      expect(stale.value).toBe(1);
      expect(stale.cacheHit).toBe(true);
      expect(stale.stale).toBe(true);
      expect(stale.freshness).toBe("revalidating");
      expect(cache.peek().inFlight).toBe(true);
      expect(cache.peek().freshness).toBe("revalidating");
      expect(calls).toBe(2);

      release(2);
      await Promise.resolve();
      await Promise.resolve();

      const refreshed = await cache.get();
      expect(refreshed.value).toBe(2);
      expect(refreshed.stale).toBe(false);
      expect(refreshed.freshness).toBe("fresh");
    } finally {
      vi.useRealTimers();
    }
  });

  it("escalates background revalidation failure to fallback_error on the next stale read", async () => {
    vi.useFakeTimers();

    try {
      let calls = 0;
      const cache = new RefreshableCache(1, async () => {
        calls += 1;
        if (calls === 1) {
          return 1;
        }

        throw new Error("background boom");
      });

      await cache.get();
      await vi.advanceTimersByTimeAsync(5);

      const revalidating = await cache.get({ staleWhileRevalidate: true });
      expect(revalidating.freshness).toBe("revalidating");

      await Promise.resolve();
      await Promise.resolve();

      const fallback = await cache.get({ staleWhileRevalidate: true });
      expect(fallback.stale).toBe(true);
      expect(fallback.freshness).toBe("fallback_error");
      expect(cache.peek().freshness).toBe("fallback_error");
    } finally {
      vi.useRealTimers();
    }
  });
});
