import { AppError, isAppError } from "../../domain/errors.js";

type MultiModelErrorKind = "location-mismatch" | "timeout" | "source-unavailable" | "upstream-unavailable";

export interface MultiModelErrorPresentation {
  userMessage: string | null;
  diagnosticCode: string | null;
  diagnosticMessage: string | null;
}

const LOCATION_MISMATCH_CODES = new Set([
  "MULTIMODEL_HIGHCHARTS_LOCATION_MISMATCH",
  "MULTIMODEL_IMAGE_LOCATION_MISMATCH",
]);

const TIMEOUT_CODES = new Set([
  "MULTIMODEL_PAGE_TIMEOUT",
  "MULTIMODEL_IMAGE_TIMEOUT",
  "MULTIMODEL_HIGHCHARTS_TIMEOUT",
  "MULTIMODEL_CACHE_LOAD_BUSY",
  "MULTIMODEL_DISTRIBUTION_REFRESH_IN_PROGRESS",
  "MULTIMODEL_INSIGHT_REFRESH_IN_PROGRESS",
]);

const SOURCE_UNAVAILABLE_CODES = new Set([
  "MULTIMODEL_IMAGE_URL_INVALID",
  "MULTIMODEL_IMAGE_URL_NOT_FOUND",
  "MULTIMODEL_IMAGE_INVALID_CONTENT_TYPE",
  "MULTIMODEL_HIGHCHARTS_URL_INVALID",
  "MULTIMODEL_HIGHCHARTS_URL_NOT_FOUND",
  "MULTIMODEL_HIGHCHARTS_PARSE_FAILED",
  "MULTIMODEL_TEMPERATURE_SERIES_NOT_FOUND",
  "MULTIMODEL_TEMPERATURE_TIMESTAMPS_EMPTY",
  "MULTIMODEL_TEMPERATURE_TIMESTAMP_INVALID",
  "MULTIMODEL_TEMPERATURE_TIMESTAMPS_DUPLICATED",
  "MULTIMODEL_TEMPERATURE_TIMESTAMPS_NOT_ASCENDING",
  "MULTIMODEL_TEMPERATURE_SERIES_LENGTH_MISMATCH",
  "MULTIMODEL_DISTRIBUTION_EMPTY",
  "MULTIMODEL_INSIGHT_EMPTY",
]);

const isAbortLikeMessage = (message: string | null) =>
  Boolean(message && /\babort(ed|ing)?\b/i.test(message));

const isTimeoutLikeMessage = (message: string | null) =>
  Boolean(message && /timed?\s*out|timeout|exceeded\s+\d+ms/i.test(message));

const classifyMultiModelError = (code: string | null, message: string | null): MultiModelErrorKind => {
  if (code && LOCATION_MISMATCH_CODES.has(code)) {
    return "location-mismatch";
  }

  if ((code && TIMEOUT_CODES.has(code)) || isAbortLikeMessage(message) || isTimeoutLikeMessage(message)) {
    return "timeout";
  }

  if (code && SOURCE_UNAVAILABLE_CODES.has(code)) {
    return "source-unavailable";
  }

  return "upstream-unavailable";
};

const toDiagnostic = (error: unknown) => {
  if (isAppError(error)) {
    return {
      code: error.diagnosticCode ?? error.code,
      message: error.diagnosticMessage ?? error.message,
      statusCode: error.statusCode,
      retryable: error.retryable,
      staleAvailable: error.staleAvailable,
      lastSuccessAt: error.lastSuccessAt,
    };
  }

  if (typeof error === "object" && error !== null) {
    const record = error as {
      code?: unknown;
      message?: unknown;
      statusCode?: unknown;
      retryable?: unknown;
      staleAvailable?: unknown;
      lastSuccessAt?: unknown;
    };
    const code = typeof record.code === "string" ? record.code : null;
    const message = typeof record.message === "string" ? record.message : null;
    if (code || message) {
      return {
        code,
        message,
        statusCode: typeof record.statusCode === "number" ? record.statusCode : 503,
        retryable: typeof record.retryable === "boolean" ? record.retryable : true,
        staleAvailable: typeof record.staleAvailable === "boolean" ? record.staleAvailable : false,
        lastSuccessAt: typeof record.lastSuccessAt === "string" ? record.lastSuccessAt : null,
      };
    }
  }

  if (error instanceof Error) {
    return {
      code: null,
      message: error.message,
      statusCode: 503,
      retryable: true,
      staleAvailable: false,
      lastSuccessAt: null,
    };
  }

  return {
    code: null,
    message: typeof error === "string" ? error : null,
    statusCode: 503,
    retryable: true,
    staleAvailable: false,
    lastSuccessAt: null,
  };
};

const buildUnavailableMessage = (kind: MultiModelErrorKind) =>
  kind === "timeout" ? "多模型数据刷新较慢，请稍后再试。" : "该城市当前暂不可用，请稍后再试。";

export const buildMultiModelStatusPresentation = (
  error: unknown,
  options: {
    hasRenderableImage: boolean;
    hasRenderableAnalysis: boolean;
  },
): MultiModelErrorPresentation => {
  const diagnostic = toDiagnostic(error);
  if (!diagnostic.code && !diagnostic.message) {
    return {
      userMessage: null,
      diagnosticCode: null,
      diagnosticMessage: null,
    };
  }

  if (options.hasRenderableImage && !options.hasRenderableAnalysis) {
    return {
      userMessage: "多模型分析暂时不可用，当前先展示官方图。",
      diagnosticCode: diagnostic.code,
      diagnosticMessage: diagnostic.message,
    };
  }

  if (!options.hasRenderableImage && options.hasRenderableAnalysis) {
    return {
      userMessage: "多模型图片暂时不可用，当前先展示已解析的多模型数据。",
      diagnosticCode: diagnostic.code,
      diagnosticMessage: diagnostic.message,
    };
  }

  const kind = classifyMultiModelError(diagnostic.code, diagnostic.message);
  return {
    userMessage:
      options.hasRenderableImage || options.hasRenderableAnalysis
        ? kind === "timeout"
          ? "多模型数据刷新较慢，当前先展示最近一次可用结果。"
          : "多模型数据暂时不可用，当前先展示最近一次可用结果。"
        : buildUnavailableMessage(kind),
    diagnosticCode: diagnostic.code,
    diagnosticMessage: diagnostic.message,
  };
};

export const wrapMultiModelAppError = (
  error: unknown,
  options: {
    fallbackCode: string;
    surfaceCode?: "fallback" | "original";
    staleAvailable?: boolean;
    lastSuccessAt?: string | null;
  },
) => {
  const diagnostic = toDiagnostic(error);
  const kind = classifyMultiModelError(diagnostic.code, diagnostic.message);
  const appError = isAppError(error) ? error : null;
  const code = options.surfaceCode === "original" && diagnostic.code ? diagnostic.code : options.fallbackCode;

  return new AppError(appError?.statusCode ?? diagnostic.statusCode, code, buildUnavailableMessage(kind), {
    retryable: appError?.retryable ?? diagnostic.retryable,
    staleAvailable: (appError?.staleAvailable ?? diagnostic.staleAvailable) || options.staleAvailable || false,
    lastSuccessAt: appError?.lastSuccessAt ?? diagnostic.lastSuccessAt ?? options.lastSuccessAt ?? null,
    diagnosticCode: diagnostic.code,
    diagnosticMessage: diagnostic.message,
  });
};
