export interface ErrorPayload {
  code: string;
  message: string;
  retryable: boolean;
  staleAvailable: boolean;
  lastSuccessAt: string | null;
}

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly staleAvailable: boolean;
  readonly lastSuccessAt: string | null;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    options?: {
      retryable?: boolean;
      staleAvailable?: boolean;
      lastSuccessAt?: string | null;
    },
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.retryable = options?.retryable ?? false;
    this.staleAvailable = options?.staleAvailable ?? false;
    this.lastSuccessAt = options?.lastSuccessAt ?? null;
  }

  toPayload(): ErrorPayload {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      staleAvailable: this.staleAvailable,
      lastSuccessAt: this.lastSuccessAt,
    };
  }
}

export const isAppError = (error: unknown): error is AppError => error instanceof AppError;
