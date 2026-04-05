export interface CacheEntry<T> {
  value: T;
  storedAt: Date;
  expiresAt: number;
}

export interface CacheGetResult<T> {
  value: T;
  cacheHit: boolean;
  stale: boolean;
}

export interface CacheGetOptions {
  allowStaleOnError?: boolean;
  staleWhileRevalidate?: boolean;
}

export interface CacheSnapshot<T> {
  entry: CacheEntry<T> | null;
  inFlight: boolean;
  lastError: string | null;
  lastSuccessAt: string | null;
}

export class RefreshableCache<T> {
  private entry: CacheEntry<T> | null = null;
  private inFlight: Promise<CacheEntry<T>> | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly ttlMs: number,
    private readonly loader: () => Promise<T>,
  ) {}

  async get(options?: CacheGetOptions): Promise<CacheGetResult<T>> {
    const now = Date.now();
    if (this.entry && this.entry.expiresAt > now) {
      return {
        value: this.entry.value,
        cacheHit: true,
        stale: false,
      };
    }

    if (this.entry && options?.staleWhileRevalidate) {
      void this.startLoad().catch(() => undefined);
      return {
        value: this.entry.value,
        cacheHit: true,
        stale: true,
      };
    }

    try {
      const entry = await this.startLoad();
      return {
        value: entry.value,
        cacheHit: false,
        stale: false,
      };
    } catch (error) {
      if (this.entry && options?.allowStaleOnError) {
        return {
          value: this.entry.value,
          cacheHit: true,
          stale: true,
        };
      }

      throw error;
    }
  }

  peek(): CacheSnapshot<T> {
    return {
      entry: this.entry,
      inFlight: this.inFlight !== null,
      lastError: this.lastError,
      lastSuccessAt: this.entry?.storedAt.toISOString() ?? null,
    };
  }

  private startLoad(): Promise<CacheEntry<T>> {
    if (!this.inFlight) {
      this.inFlight = this.load();
    }

    return this.inFlight;
  }

  private async load(): Promise<CacheEntry<T>> {
    try {
      const value = await this.loader();
      const entry = {
        value,
        storedAt: new Date(),
        expiresAt: Date.now() + this.ttlMs,
      };

      this.entry = entry;
      this.lastError = null;
      return entry;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      this.inFlight = null;
    }
  }
}
