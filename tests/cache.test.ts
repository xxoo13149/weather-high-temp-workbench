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

    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await cache.get({ allowStaleOnError: true });

    expect(second.value).toEqual({ value: "fresh" });
    expect(second.stale).toBe(true);
    expect(cache.peek().lastError).toContain("boom");
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
      expect(cache.peek().inFlight).toBe(true);
      expect(calls).toBe(2);

      release(2);
      await Promise.resolve();
      await Promise.resolve();

      const refreshed = await cache.get();
      expect(refreshed.value).toBe(2);
      expect(refreshed.stale).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
