import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export interface FavoritesRecord {
  locationIds: string[];
  updatedAt: string;
}

export interface FavoritesStoreLike {
  getFavorites(allowedLocationIds: Set<string>): Promise<FavoritesRecord>;
  setFavorite(locationId: string, favorite: boolean, allowedLocationIds: Set<string>): Promise<FavoritesRecord>;
}

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

export class FavoritesStore implements FavoritesStoreLike {
  private readonly filePath: string;

  constructor(filePath = resolve(process.cwd(), "data", "favorites.json")) {
    this.filePath = filePath;
  }

  private async readRecord(): Promise<FavoritesRecord> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<FavoritesRecord>;
      return {
        locationIds: Array.isArray(parsed.locationIds) ? parsed.locationIds.filter((item): item is string => typeof item === "string") : [],
        updatedAt: typeof parsed.updatedAt === "string" && parsed.updatedAt ? parsed.updatedAt : DEFAULT_RECORD.updatedAt,
      };
    } catch {
      return DEFAULT_RECORD;
    }
  }

  private async writeRecord(record: FavoritesRecord): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    await writeFile(tmpPath, JSON.stringify(record, null, 2), "utf8");
    await rename(tmpPath, this.filePath);
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
