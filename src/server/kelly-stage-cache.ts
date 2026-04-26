import type { CacheEntry, CacheGetOptions, CacheGetResult, RefreshableCache } from "../lib/cache.js";

type KellyStageCacheLike<T> = Pick<RefreshableCache<T>, "get" | "peek">;

interface LoadKellyStageCacheOptions {
  allowStaleOnError?: boolean;
  forceRefresh?: boolean;
  softTimeoutMs?: number | null;
  createTimeoutError?: () => Error;
}

const raceWithTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<
  | { kind: "value"; value: T }
  | { kind: "error"; error: unknown }
  | { kind: "timeout" }
> => {
  let timerId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise.then(
        (value) =>
          ({
            kind: "value" as const,
            value,
          }),
        (error) =>
          ({
            kind: "error" as const,
            error,
          }),
      ),
      new Promise<{ kind: "timeout" }>((resolve) => {
        timerId = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
      }),
    ]);
  } finally {
    if (timerId) {
      clearTimeout(timerId);
    }
  }
};

const buildCacheGetOptions = (
  options: LoadKellyStageCacheOptions,
  overrides?: Partial<CacheGetOptions>,
): CacheGetOptions => ({
  allowStaleOnError: options.allowStaleOnError,
  forceRefresh: options.forceRefresh,
  ...(overrides ?? {}),
});

const hasCachedEntry = <T>(entry: CacheEntry<T> | null): entry is CacheEntry<T> => entry !== null;

export const loadKellyStageCache = async <T>(
  cache: KellyStageCacheLike<T>,
  options: LoadKellyStageCacheOptions,
): Promise<CacheGetResult<T>> => {
  if (options.forceRefresh || !options.softTimeoutMs || options.softTimeoutMs <= 0) {
    return await cache.get(buildCacheGetOptions(options));
  }

  const snapshot = cache.peek();
  if (hasCachedEntry(snapshot.entry) && (snapshot.inFlight || snapshot.lastError)) {
    return await cache.get(
      buildCacheGetOptions(options, {
        forceRefresh: false,
        staleWhileRevalidate: true,
      }),
    );
  }

  const pendingLoad = cache.get(buildCacheGetOptions(options));
  const raced = await raceWithTimeout(pendingLoad, options.softTimeoutMs);

  if (raced.kind === "value") {
    return raced.value;
  }

  if (raced.kind === "error") {
    throw raced.error;
  }

  if (!hasCachedEntry(snapshot.entry)) {
    throw options.createTimeoutError?.() ?? new Error(`Kelly stage cache load exceeded ${options.softTimeoutMs}ms.`);
  }

  return await cache.get(
    buildCacheGetOptions(options, {
      forceRefresh: false,
      staleWhileRevalidate: true,
    }),
  );
};
