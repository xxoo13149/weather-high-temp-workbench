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
  background?: boolean;
}

export type CacheLoadMode = "foreground" | "background";

export interface CacheLoadContext {
  mode: CacheLoadMode;
}

export interface CacheSnapshot<T> {
  entry: CacheEntry<T> | null;
  inFlight: boolean;
  inFlightMode: CacheLoadMode | null;
  lastError: string | null;
  lastErrorCode: string | null;
  lastSuccessAt: string | null;
  freshness: CacheGetResult<T>["freshness"] | null;
}

export class RefreshableCache<T> {
  private entry: CacheEntry<T> | null = null;
  private inFlight: Promise<CacheEntry<T>> | null = null;
  private inFlightMode: CacheLoadMode | null = null;
  private lastError: string | null = null;
  private lastErrorCode: string | null = null;
  private activeLoadId = 0;

  constructor(
    private readonly ttlMs: number,
    private readonly loader: (context: CacheLoadContext) => Promise<T>,
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
      void this.startLoad({
        mode: "background",
      }).catch(() => undefined);
      return {
        value: this.entry.value,
        cacheHit: true,
        stale: true,
        freshness,
      };
    }

    try {
      const entry = await this.startLoad({
        forceRefresh: options?.forceRefresh,
        mode: options?.background ? "background" : "foreground",
      });
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
      inFlightMode: this.inFlightMode,
      lastError: this.lastError,
      lastErrorCode: this.lastErrorCode,
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
    this.lastErrorCode = null;
    return this.entry;
  }

  private startLoad(options?: {
    forceRefresh?: boolean;
    mode?: CacheLoadMode;
  }): Promise<CacheEntry<T>> {
    const forceRefresh = options?.forceRefresh ?? false;
    const requestedMode = options?.mode ?? "foreground";
    if (this.inFlight) {
      if (!forceRefresh && this.inFlightMode === "background" && requestedMode === "foreground" && !this.entry) {
        const loadId = this.activeLoadId + 1;
        this.activeLoadId = loadId;
        this.inFlightMode = "foreground";
        this.inFlight = this.load(loadId, this.inFlightMode);
        return this.inFlight;
      }

      return this.inFlight;
    }

    if (!this.inFlight || forceRefresh) {
      const loadId = this.activeLoadId + 1;
      this.activeLoadId = loadId;
      this.inFlightMode = requestedMode;
      this.inFlight = this.load(loadId, this.inFlightMode);
    }

    return this.inFlight;
  }

  private async load(loadId: number, mode: CacheLoadMode): Promise<CacheEntry<T>> {
    try {
      const value = await this.loader({ mode });
      const entry = {
        value,
        storedAt: new Date(),
        expiresAt: Date.now() + this.ttlMs,
      };

      if (this.activeLoadId === loadId) {
        this.entry = entry;
        this.lastError = null;
        this.lastErrorCode = null;
      }
      return entry;
    } catch (error) {
      if (this.activeLoadId === loadId) {
        this.lastError = error instanceof Error ? error.message : String(error);
        this.lastErrorCode =
          typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : null;
      }
      throw error;
    } finally {
      if (this.activeLoadId === loadId) {
        this.inFlight = null;
        this.inFlightMode = null;
      }
    }
  }
}
