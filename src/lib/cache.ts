export interface CacheEntry<T> {
  value: T;
  storedAt: Date;
  expiresAt: number;
}

export interface CacheGetResult<T> {
  value: T;
  cacheHit: boolean;
  stale: boolean;
  freshness: "fresh" | "revalidating" | "fallback_error";
}

export interface CacheGetOptions {
  allowStaleOnError?: boolean;
  staleWhileRevalidate?: boolean;
  forceRefresh?: boolean;
}

export interface CacheSnapshot<T> {
  entry: CacheEntry<T> | null;
  inFlight: boolean;
  lastError: string | null;
  lastSuccessAt: string | null;
  freshness: CacheGetResult<T>["freshness"] | null;
}

export class RefreshableCache<T> {
  private entry: CacheEntry<T> | null = null;
  private inFlight: Promise<CacheEntry<T>> | null = null;
  private lastError: string | null = null;
  private activeLoadId = 0;

  constructor(
    private readonly ttlMs: number,
    private readonly loader: () => Promise<T>,
  ) {}

  async get(options?: CacheGetOptions): Promise<CacheGetResult<T>> {
    const now = Date.now();
    if (!options?.forceRefresh && this.entry && this.entry.expiresAt > now) {
      return {
        value: this.entry.value,
        cacheHit: true,
        stale: false,
        freshness: "fresh",
      };
    }

    if (this.entry && options?.staleWhileRevalidate) {
      const freshness = this.lastError ? "fallback_error" : "revalidating";
      void this.startLoad().catch(() => undefined);
      return {
        value: this.entry.value,
        cacheHit: true,
        stale: true,
        freshness,
      };
    }

    try {
      const entry = await this.startLoad(options?.forceRefresh);
      return {
        value: entry.value,
        cacheHit: false,
        stale: false,
        freshness: "fresh",
      };
    } catch (error) {
      if (this.entry && options?.allowStaleOnError) {
        return {
          value: this.entry.value,
          cacheHit: true,
          stale: true,
          freshness: "fallback_error",
        };
      }

      throw error;
    }
  }

  peek(): CacheSnapshot<T> {
    const now = Date.now();
    const freshness = this.entry
      ? this.entry.expiresAt > now
        ? "fresh"
        : this.lastError
          ? "fallback_error"
          : this.inFlight
            ? "revalidating"
            : "fresh"
      : null;
    return {
      entry: this.entry,
      inFlight: this.inFlight !== null,
      lastError: this.lastError,
      lastSuccessAt: this.entry?.storedAt.toISOString() ?? null,
      freshness,
    };
  }

  invalidate() {
    this.entry = null;
  }

  set(value: T, storedAt = new Date()) {
    this.entry = {
      value,
      storedAt,
      expiresAt: storedAt.getTime() + this.ttlMs,
    };
    this.lastError = null;
    return this.entry;
  }

  private startLoad(forceRefresh = false): Promise<CacheEntry<T>> {
    if (this.inFlight) {
      return this.inFlight;
    }

    if (!this.inFlight || forceRefresh) {
      const loadId = this.activeLoadId + 1;
      this.activeLoadId = loadId;
      this.inFlight = this.load(loadId);
    }

    return this.inFlight;
  }

  private async load(loadId: number): Promise<CacheEntry<T>> {
    try {
      const value = await this.loader();
      const entry = {
        value,
        storedAt: new Date(),
        expiresAt: Date.now() + this.ttlMs,
      };

      if (this.activeLoadId === loadId) {
        this.entry = entry;
        this.lastError = null;
      }
      return entry;
    } catch (error) {
      if (this.activeLoadId === loadId) {
        this.lastError = error instanceof Error ? error.message : String(error);
      }
      throw error;
    } finally {
      if (this.activeLoadId === loadId) {
        this.inFlight = null;
      }
    }
  }
}
