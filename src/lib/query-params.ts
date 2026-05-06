import { AppError } from "../domain/errors.js";

const STRICT_INTEGER_PATTERN = /^\d+$/;
const STRICT_NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const STRICT_ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

const normalizeOptionalQueryString = (raw: unknown, message: string): string | undefined => {
  if (raw === undefined || raw === null || raw === "") {
    return undefined;
  }

  if (typeof raw !== "string") {
    throw new AppError(400, "BAD_REQUEST", message);
  }

  const trimmed = raw.trim();
  if (trimmed === "") {
    throw new AppError(400, "BAD_REQUEST", message);
  }

  return trimmed;
};

export const parsePositiveIntegerQuery = (raw: unknown, message: string): number | undefined => {
  const normalized = normalizeOptionalQueryString(raw, message);
  if (normalized === undefined) {
    return undefined;
  }

  if (!STRICT_INTEGER_PATTERN.test(normalized)) {
    throw new AppError(400, "BAD_REQUEST", message);
  }

  const value = Number.parseInt(normalized, 10);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new AppError(400, "BAD_REQUEST", message);
  }

  return value;
};

export const parseFiniteNumberQuery = (raw: unknown, message: string): number | undefined => {
  const normalized = normalizeOptionalQueryString(raw, message);
  if (normalized === undefined) {
    return undefined;
  }

  if (!STRICT_NUMBER_PATTERN.test(normalized)) {
    throw new AppError(400, "BAD_REQUEST", message);
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) {
    throw new AppError(400, "BAD_REQUEST", message);
  }

  return value;
};

export const parsePositiveNumberQuery = (raw: unknown, message: string): number | undefined => {
  const value = parseFiniteNumberQuery(raw, message);
  if (value === undefined) {
    return undefined;
  }

  if (value <= 0) {
    throw new AppError(400, "BAD_REQUEST", message);
  }

  return value;
};

export const parseIsoTimestampQuery = (raw: unknown, message: string): string | undefined => {
  const normalized = normalizeOptionalQueryString(raw, message);
  if (normalized === undefined) {
    return undefined;
  }

  if (!STRICT_ISO_TIMESTAMP_PATTERN.test(normalized)) {
    throw new AppError(400, "BAD_REQUEST", message);
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(400, "BAD_REQUEST", message);
  }

  return normalized;
};
