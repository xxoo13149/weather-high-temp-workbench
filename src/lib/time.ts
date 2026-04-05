const dateFormatterCache = new Map<string, Intl.DateTimeFormat>();
const dateTimeFormatterCache = new Map<string, Intl.DateTimeFormat>();

const getDateFormatter = (timeZone: string): Intl.DateTimeFormat => {
  const cached = dateFormatterCache.get(timeZone);
  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  dateFormatterCache.set(timeZone, formatter);
  return formatter;
};

const getDateTimeFormatter = (timeZone: string): Intl.DateTimeFormat => {
  const cached = dateTimeFormatterCache.get(timeZone);
  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  dateTimeFormatterCache.set(timeZone, formatter);
  return formatter;
};

const makeUtcDate = (year: number, month: number, day: number, hour: number, minute: number): Date =>
  new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));

const partsFor = (date: Date, timeZone: string): Record<string, string> => {
  const formatter = getDateFormatter(timeZone);
  const parts = formatter.formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
};

const dateTimePartsFor = (date: Date, timeZone: string): Record<string, string> => {
  const formatter = getDateTimeFormatter(timeZone);
  const parts = formatter.formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
};

export const parseObservedTime = (timeText: string | null, referenceDate: Date, timeZone: string): Date | null => {
  if (!timeText) {
    return null;
  }

  const match = timeText.match(/(\d{2}):(\d{2})/);
  if (!match) {
    return null;
  }

  const parts = partsFor(referenceDate, timeZone);
  let observed = makeUtcDate(
    Number(parts.year),
    Number(parts.month),
    Number(parts.day),
    Number(match[1]),
    Number(match[2]),
  );

  if (observed.getTime() - referenceDate.getTime() > 12 * 60 * 60 * 1000) {
    observed = new Date(observed.getTime() - 24 * 60 * 60 * 1000);
  }

  return observed;
};

export const parseLocalDateTimeInTimeZone = (value: string, timeZone: string): Date | null => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? "0");

  const targetLocalMs = Date.UTC(year, month - 1, day, hour, minute, second, 0);
  let guess = new Date(targetLocalMs);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = dateTimePartsFor(guess, timeZone);
    const guessLocalMs = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
      0,
    );
    const diffMs = targetLocalMs - guessLocalMs;
    if (diffMs === 0) {
      return guess;
    }

    guess = new Date(guess.getTime() + diffMs);
  }

  const finalParts = dateTimePartsFor(guess, timeZone);
  if (
    Number(finalParts.year) === year &&
    Number(finalParts.month) === month &&
    Number(finalParts.day) === day &&
    Number(finalParts.hour) === hour &&
    Number(finalParts.minute) === minute &&
    Number(finalParts.second) === second
  ) {
    return guess;
  }

  return null;
};

export const toIsoInTimeZone = (value: Date | number, timeZone: string): string => {
  const date = typeof value === "number" ? new Date(value) : value;
  const parts = dateTimePartsFor(date, timeZone);

  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const second = Number(parts.second);

  const zonedUtcMs = Date.UTC(year, month - 1, day, hour, minute, second, 0);
  const offsetMinutes = Math.round((zonedUtcMs - date.getTime()) / 60_000);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteMinutes = Math.abs(offsetMinutes);
  const offsetHours = String(Math.floor(absoluteMinutes / 60)).padStart(2, "0");
  const offsetRemainder = String(absoluteMinutes % 60).padStart(2, "0");

  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${sign}${offsetHours}:${offsetRemainder}`;
};
