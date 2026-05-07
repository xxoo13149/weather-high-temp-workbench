export interface ErrorPayload {
  code: string;
  message: string;
  retryable: boolean;
  staleAvailable: boolean;
  lastSuccessAt: string | null;
  diagnosticCode?: string;
}

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly staleAvailable: boolean;
  readonly lastSuccessAt: string | null;
  readonly diagnosticCode: string | null;
  readonly diagnosticMessage: string | null;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    options?: {
      retryable?: boolean;
      staleAvailable?: boolean;
      lastSuccessAt?: string | null;
      diagnosticCode?: string | null;
      diagnosticMessage?: string | null;
    },
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.retryable = options?.retryable ?? false;
    this.staleAvailable = options?.staleAvailable ?? false;
    this.lastSuccessAt = options?.lastSuccessAt ?? null;
    this.diagnosticCode = options?.diagnosticCode ?? null;
    this.diagnosticMessage = options?.diagnosticMessage ?? null;
  }

  toPayload(): ErrorPayload {
    const payload: ErrorPayload = {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      staleAvailable: this.staleAvailable,
      lastSuccessAt: this.lastSuccessAt,
    };

    if (this.diagnosticCode) {
      payload.diagnosticCode = this.diagnosticCode;
    }

    return payload;
  }
}

export const isAppError = (error: unknown): error is AppError => error instanceof AppError;
