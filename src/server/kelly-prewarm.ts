import { LOCATION_DIRECTORY, type LocationId } from "../config.js";
import type { WeatherService } from "../domain/weather.js";
import { getLocationSourceContract } from "../operational-metadata.js";

type KellyPrewarmLogger = Pick<Console, "info" | "warn" | "error">;

export interface KellyPrewarmConfig {
  enabled: boolean;
  delayMs: number;
  intervalMs: number;
  concurrency: number;
  locationIds: LocationId[];
  forceRefreshCount?: number;
  nextDayWarmCount?: number;
  nextDayWarmAfterLocalHour?: number;
}

const DEFAULT_KELLY_PREWARM_DELAY_MS = 2_000;
const DEFAULT_KELLY_PREWARM_INTERVAL_MS = 15 * 60_000;
const DEFAULT_KELLY_PREWARM_CONCURRENCY = 4;
const DEFAULT_KELLY_PREWARM_FORCE_REFRESH_COUNT = 6;
const DEFAULT_KELLY_PREWARM_NEXT_DAY_WARM_COUNT = 8;
const DEFAULT_KELLY_PREWARM_NEXT_DAY_AFTER_LOCAL_HOUR = 15;

const PREWARM_TIER_ORDER = {
  "tier-1": 0,
  "tier-2": 1,
  "tier-3": 2,
} as const;

const readNumber = (raw: string | undefined, fallback: number) => {
  if (!raw) {
    return fallback;
  }

  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
};

const readBoolean = (raw: string | undefined, fallback: boolean) => {
  if (!raw) {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
};

const enabledLocationIds = new Set<LocationId>(LOCATION_DIRECTORY.map((location) => location.id));
const locationDirectoryById = new Map<LocationId, (typeof LOCATION_DIRECTORY)[number]>(
  LOCATION_DIRECTORY.map((location) => [location.id, location]),
);
const localDateFormatterCache = new Map<string, Intl.DateTimeFormat>();
const localHourFormatterCache = new Map<string, Intl.DateTimeFormat>();

export const resolveDefaultKellyPrewarmLocationIds = (): LocationId[] =>
  [...LOCATION_DIRECTORY]
    .filter((location) => getLocationSourceContract(location.id).kellyMarketMapping.status === "production")
    .sort((left, right) => {
      const leftTier = PREWARM_TIER_ORDER[getLocationSourceContract(left.id).rolloutTier];
      const rightTier = PREWARM_TIER_ORDER[getLocationSourceContract(right.id).rolloutTier];
      return (
        leftTier - rightTier ||
        left.sortOrder - right.sortOrder ||
        left.displayName.localeCompare(right.displayName)
      );
    })
    .map((location) => location.id);

const resolveExplicitLocationIds = (raw: string | undefined): LocationId[] | null => {
  if (!raw) {
    return null;
  }

  const ids = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index)
    .filter((value): value is LocationId => enabledLocationIds.has(value as LocationId));

  return ids;
};

const getLocalDateFormatter = (timeZone: string) => {
  const cached = localDateFormatterCache.get(timeZone);
  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  localDateFormatterCache.set(timeZone, formatter);
  return formatter;
};

const getLocalHourFormatter = (timeZone: string) => {
  const cached = localHourFormatterCache.get(timeZone);
  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    hour12: false,
  });
  localHourFormatterCache.set(timeZone, formatter);
  return formatter;
};

const resolveLocalDateKey = (now: Date, timeZone: string) => getLocalDateFormatter(timeZone).format(now);

const resolveLocalHour = (now: Date, timeZone: string) => {
  const parts = getLocalHourFormatter(timeZone).formatToParts(now);
  const hourValue = parts.find((part) => part.type === "hour")?.value ?? "0";
  const parsed = Number.parseInt(hourValue, 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

const addDaysToDateKey = (dateKey: string, offsetDays: number) => {
  const [year, month, day] = dateKey.split("-").map((value) => Number.parseInt(value, 10));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return dateKey;
  }

  return new Date(Date.UTC(year, month - 1, day + offsetDays)).toISOString().slice(0, 10);
};

const selectRollingLocationIds = (locationIds: LocationId[], count: number, passIndex: number): LocationId[] => {
  if (locationIds.length === 0 || count <= 0) {
    return [];
  }

  const normalizedCount = Math.min(count, locationIds.length);
  const normalizedPassIndex = Math.max(0, passIndex);
  const startIndex = (normalizedPassIndex * normalizedCount) % locationIds.length;

  return Array.from({ length: normalizedCount }, (_, index) => locationIds[(startIndex + index) % locationIds.length]);
};

type KellyPrewarmJob = {
  locationId: LocationId;
  targetDate: string;
  forceRefresh: boolean;
  stage: "today" | "next-day";
};

const buildKellyPrewarmJobs = (
  config: KellyPrewarmConfig,
  passIndex: number,
  now: Date,
): {
  jobs: KellyPrewarmJob[];
  forceRefreshLocationIds: LocationId[];
  nextDayLocationIds: LocationId[];
} => {
  const forceRefreshCount = Math.max(0, config.forceRefreshCount ?? DEFAULT_KELLY_PREWARM_FORCE_REFRESH_COUNT);
  const nextDayWarmCount = Math.max(0, config.nextDayWarmCount ?? DEFAULT_KELLY_PREWARM_NEXT_DAY_WARM_COUNT);
  const nextDayWarmAfterLocalHour = Math.min(
    23,
    Math.max(0, config.nextDayWarmAfterLocalHour ?? DEFAULT_KELLY_PREWARM_NEXT_DAY_AFTER_LOCAL_HOUR),
  );
  const forceRefreshLocationIds = selectRollingLocationIds(
    config.locationIds,
    forceRefreshCount,
    passIndex,
  );
  const forceRefreshLocationIdSet = new Set(forceRefreshLocationIds);
  const eligibleNextDayLocationIds = config.locationIds.filter((locationId) => {
    const location = locationDirectoryById.get(locationId);
    if (!location) {
      return false;
    }

    return resolveLocalHour(now, location.timezone) >= nextDayWarmAfterLocalHour;
  });
  const nextDayLocationIds = selectRollingLocationIds(
    eligibleNextDayLocationIds,
    nextDayWarmCount,
    passIndex,
  );
  const nextDayLocationIdSet = new Set(nextDayLocationIds);
  const prioritizedTodayLocationIds = [
    ...config.locationIds.filter((locationId) => forceRefreshLocationIdSet.has(locationId)),
    ...config.locationIds.filter((locationId) => !forceRefreshLocationIdSet.has(locationId)),
  ];

  const todayJobs = prioritizedTodayLocationIds.map((locationId) => {
    const location = locationDirectoryById.get(locationId);
    const targetDate = resolveLocalDateKey(now, location?.timezone ?? "UTC");
    return {
      locationId,
      targetDate,
      forceRefresh: forceRefreshLocationIdSet.has(locationId),
      stage: "today" as const,
    };
  });

  const nextDayJobs = config.locationIds
    .filter((locationId) => nextDayLocationIdSet.has(locationId))
    .map((locationId) => {
      const location = locationDirectoryById.get(locationId);
      const todayTargetDate = resolveLocalDateKey(now, location?.timezone ?? "UTC");
      return {
        locationId,
        targetDate: addDaysToDateKey(todayTargetDate, 1),
        forceRefresh: false,
        stage: "next-day" as const,
      };
    });

  return {
    jobs: [...todayJobs, ...nextDayJobs],
    forceRefreshLocationIds,
    nextDayLocationIds,
  };
};

export const resolveKellyPrewarmConfig = (env: NodeJS.ProcessEnv = process.env): KellyPrewarmConfig => {
  const explicitLocationIds = resolveExplicitLocationIds(env.KELLY_PREWARM_LOCATION_IDS);
  return {
    enabled: readBoolean(env.KELLY_PREWARM_ENABLED, true),
    delayMs: Math.max(0, readNumber(env.KELLY_PREWARM_DELAY_MS, DEFAULT_KELLY_PREWARM_DELAY_MS)),
    intervalMs: Math.max(0, readNumber(env.KELLY_PREWARM_INTERVAL_MS, DEFAULT_KELLY_PREWARM_INTERVAL_MS)),
    concurrency: Math.max(1, readNumber(env.KELLY_PREWARM_CONCURRENCY, DEFAULT_KELLY_PREWARM_CONCURRENCY)),
    locationIds: explicitLocationIds ?? resolveDefaultKellyPrewarmLocationIds(),
    forceRefreshCount: Math.max(
      0,
      readNumber(env.KELLY_PREWARM_FORCE_REFRESH_COUNT, DEFAULT_KELLY_PREWARM_FORCE_REFRESH_COUNT),
    ),
    nextDayWarmCount: Math.max(
      0,
      readNumber(env.KELLY_PREWARM_NEXT_DAY_WARM_COUNT, DEFAULT_KELLY_PREWARM_NEXT_DAY_WARM_COUNT),
    ),
    nextDayWarmAfterLocalHour: Math.min(
      23,
      Math.max(
        0,
        readNumber(
          env.KELLY_PREWARM_NEXT_DAY_AFTER_LOCAL_HOUR,
          DEFAULT_KELLY_PREWARM_NEXT_DAY_AFTER_LOCAL_HOUR,
        ),
      ),
    ),
  };
};

const mapWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(runners);
  return results;
};

export const runKellyPrewarmPass = async (
  service: Pick<WeatherService, "getKellyWorkbench">,
  config: KellyPrewarmConfig,
  logger: KellyPrewarmLogger = console,
  options?: {
    now?: Date;
    passIndex?: number;
  },
) => {
  const getKellyWorkbench = service.getKellyWorkbench;
  if (!getKellyWorkbench || !config.enabled || config.locationIds.length === 0) {
    return {
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 0,
      total: 0,
      succeeded: 0,
      failed: 0,
      failures: [] as Array<{ locationId: LocationId; error: string }>,
    };
  }

  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const passIndex = Math.max(0, options?.passIndex ?? 0);
  const now = options?.now ?? new Date();
  const { jobs, forceRefreshLocationIds, nextDayLocationIds } = buildKellyPrewarmJobs(config, passIndex, now);
  logger.info("[kelly-prewarm] starting background pass", {
    total: config.locationIds.length,
    jobsTotal: jobs.length,
    concurrency: config.concurrency,
    passIndex,
    forceRefreshCount: forceRefreshLocationIds.length,
    nextDayWarmCount: nextDayLocationIds.length,
  });

  const results = await mapWithConcurrency(jobs, config.concurrency, async (job) => {
    const warmStartedMs = Date.now();
    try {
      const snapshot = await getKellyWorkbench.call(service, job.locationId, {
        targetDate: job.targetDate,
        forceRefresh: job.forceRefresh,
      });
      logger.info("[kelly-prewarm] warmed city", {
        locationId: job.locationId,
        stage: job.stage,
        forceRefresh: job.forceRefresh,
        requestedTargetDate: job.targetDate,
        targetDate: snapshot.targetDate,
        elapsedMs: Date.now() - warmStartedMs,
        marketCount: (snapshot.markets?.length ?? 0) + (snapshot.inactiveMarkets?.length ?? 0),
      });
      return {
        locationId: job.locationId,
        ok: true as const,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("[kelly-prewarm] city warmup failed", {
        locationId: job.locationId,
        stage: job.stage,
        forceRefresh: job.forceRefresh,
        requestedTargetDate: job.targetDate,
        elapsedMs: Date.now() - warmStartedMs,
        error: message,
      });
      return {
        locationId: job.locationId,
        ok: false as const,
        error: message,
      };
    }
  });

  const failures = results.filter((result): result is { locationId: LocationId; ok: false; error: string } => !result.ok);
  const failuresByLocation = new Map<LocationId, string>();
  for (const failure of failures) {
    if (!failuresByLocation.has(failure.locationId)) {
      failuresByLocation.set(failure.locationId, failure.error);
    }
  }
  const completedAt = new Date().toISOString();
  const summary = {
    startedAt,
    completedAt,
    durationMs: Date.now() - startedMs,
    total: config.locationIds.length,
    succeeded: config.locationIds.length - failuresByLocation.size,
    failed: failuresByLocation.size,
    failures: [...failuresByLocation.entries()].map(([locationId, error]) => ({ locationId, error })),
  };

  if (failures.length > 0) {
    logger.warn("[kelly-prewarm] background pass completed with failures", summary);
  } else {
    logger.info("[kelly-prewarm] background pass completed", summary);
  }

  return summary;
};

export const startKellyPrewarmLoop = (
  service: Pick<WeatherService, "getKellyWorkbench">,
  logger: KellyPrewarmLogger = console,
  env: NodeJS.ProcessEnv = process.env,
) => {
  const config = resolveKellyPrewarmConfig(env);
  if (!config.enabled) {
    logger.info("[kelly-prewarm] disabled by env");
    return {
      stop() {},
      config,
    };
  }

  if (!service.getKellyWorkbench || config.locationIds.length === 0) {
    logger.warn("[kelly-prewarm] skipped because no eligible locations are configured");
    return {
      stop() {},
      config,
    };
  }

  let stopped = false;
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let passIndex = 0;

  const schedule = (delayMs: number) => {
    if (stopped) {
      return;
    }

    timerId = setTimeout(async () => {
      timerId = null;
      if (stopped || inFlight) {
        if (!stopped && config.intervalMs > 0) {
          schedule(config.intervalMs);
        }
        return;
      }

      inFlight = true;
      try {
        await runKellyPrewarmPass(service, config, logger, {
          passIndex,
        });
        passIndex += 1;
      } catch (error) {
        logger.error("[kelly-prewarm] background pass crashed", {
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        inFlight = false;
        if (!stopped && config.intervalMs > 0) {
          schedule(config.intervalMs);
        }
      }
    }, delayMs);
  };

  schedule(config.delayMs);

  return {
    stop() {
      stopped = true;
      if (timerId) {
        clearTimeout(timerId);
        timerId = null;
      }
    },
    config,
  };
};
