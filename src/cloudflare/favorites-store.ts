import type { FavoritesRecord, FavoritesStoreLike } from "../lib/favorites-store.js";

type KvLike = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
};

const FAVORITES_KEY = "weather-high-temp-workbench:favorites";

const DEFAULT_RECORD: FavoritesRecord = {
  locationIds: [],
  updatedAt: new Date(0).toISOString(),
};

const normalizeLocationIds = (values: string[], allowedLocationIds: Set<string>): string[] => {
  const unique = new Set<string>();
  for (const value of values) {
    const id = value.trim();
    if (!id || !allowedLocationIds.has(id)) {
      continue;
    }
    unique.add(id);
  }

  return [...unique].sort((left, right) => left.localeCompare(right));
};

export class CloudflareFavoritesStore implements FavoritesStoreLike {
  constructor(private readonly kv: KvLike) {}

  private async readRecord(): Promise<FavoritesRecord> {
    try {
      const raw = await this.kv.get(FAVORITES_KEY);
      if (!raw) {
        return DEFAULT_RECORD;
      }

      const parsed = JSON.parse(raw) as Partial<FavoritesRecord>;
      return {
        locationIds: Array.isArray(parsed.locationIds)
          ? parsed.locationIds.filter((item): item is string => typeof item === "string")
          : [],
        updatedAt:
          typeof parsed.updatedAt === "string" && parsed.updatedAt.length > 0
            ? parsed.updatedAt
            : DEFAULT_RECORD.updatedAt,
      };
    } catch {
      return DEFAULT_RECORD;
    }
  }

  private async writeRecord(record: FavoritesRecord): Promise<void> {
    await this.kv.put(FAVORITES_KEY, JSON.stringify(record));
  }

  async getFavorites(allowedLocationIds: Set<string>): Promise<FavoritesRecord> {
    const record = await this.readRecord();
    const normalized = normalizeLocationIds(record.locationIds, allowedLocationIds);

    if (normalized.length !== record.locationIds.length) {
      const next = {
        locationIds: normalized,
        updatedAt: new Date().toISOString(),
      } satisfies FavoritesRecord;
      await this.writeRecord(next);
      return next;
    }

    return {
      locationIds: normalized,
      updatedAt: record.updatedAt,
    };
  }

  async setFavorite(locationId: string, favorite: boolean, allowedLocationIds: Set<string>): Promise<FavoritesRecord> {
    const current = await this.getFavorites(allowedLocationIds);
    const nextSet = new Set(current.locationIds);

    if (favorite) {
      nextSet.add(locationId);
    } else {
      nextSet.delete(locationId);
    }

    const next = {
      locationIds: normalizeLocationIds([...nextSet], allowedLocationIds),
      updatedAt: new Date().toISOString(),
    } satisfies FavoritesRecord;

    await this.writeRecord(next);
    return next;
  }
}

export class InMemoryFavoritesStore implements FavoritesStoreLike {
  private record: FavoritesRecord = DEFAULT_RECORD;

  async getFavorites(allowedLocationIds: Set<string>): Promise<FavoritesRecord> {
    const normalized = normalizeLocationIds(this.record.locationIds, allowedLocationIds);
    if (normalized.length !== this.record.locationIds.length) {
      this.record = {
        locationIds: normalized,
        updatedAt: new Date().toISOString(),
      };
    }

    return this.record;
  }

  async setFavorite(locationId: string, favorite: boolean, allowedLocationIds: Set<string>): Promise<FavoritesRecord> {
    const current = await this.getFavorites(allowedLocationIds);
    const nextSet = new Set(current.locationIds);

    if (favorite) {
      nextSet.add(locationId);
    } else {
      nextSet.delete(locationId);
    }

    this.record = {
      locationIds: normalizeLocationIds([...nextSet], allowedLocationIds),
      updatedAt: new Date().toISOString(),
    };

    return this.record;
  }
}
