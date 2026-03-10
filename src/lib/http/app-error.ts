import type { ApiErrorResponse } from './api-response';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

type AppErrorOptions<TErrors> = {
  message: string;
  code: string;
  statusCode: ContentfulStatusCode;
  errors?: TErrors | null;
  expose?: boolean;
};

const DEFAULT_ERROR_BY_STATUS = {
  400: { message: 'Bad request', code: 'ERR_BAD_REQUEST' },
  401: { message: 'Unauthorized', code: 'ERR_UNAUTHORIZED' },
  403: { message: 'Forbidden', code: 'ERR_FORBIDDEN' },
  404: { message: 'Not found', code: 'ERR_NOT_FOUND' },
  409: { message: 'Conflict', code: 'ERR_CONFLICT' },
  422: { message: 'Validation error', code: 'ERR_VALIDATION' },
  500: { message: 'Something went wrong', code: 'ERR_INTERNAL' },
} as const;

type DefaultErrorStatusCode = keyof typeof DEFAULT_ERROR_BY_STATUS;
const FALLBACK_ERROR_STATUS: DefaultErrorStatusCode = 500;

export class AppError<TErrors = null> extends Error {
  public readonly statusCode: ContentfulStatusCode;
  public readonly code: string;
  public readonly errors: TErrors | null;
  public readonly expose: boolean;

  constructor({ message, code, statusCode, errors = null, expose }: AppErrorOptions<TErrors>) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.errors = errors;
    this.expose = expose ?? statusCode < 500;
  }
}

export const isAppError = (error: unknown): error is AppError<unknown> => {
  return error instanceof AppError;
};

const normalizeStatusCode = (statusCode: number): ContentfulStatusCode => {
  if (statusCode >= 400 && statusCode <= 599) {
    return statusCode as ContentfulStatusCode;
  }

  return FALLBACK_ERROR_STATUS;
};

const isDefaultErrorStatusCode = (statusCode: number): statusCode is DefaultErrorStatusCode => {
  return statusCode in DEFAULT_ERROR_BY_STATUS;
};

const getDefaultError = (
  statusCode: number,
): (typeof DEFAULT_ERROR_BY_STATUS)[DefaultErrorStatusCode] => {
  const resolvedStatusCode = isDefaultErrorStatusCode(statusCode)
    ? statusCode
    : FALLBACK_ERROR_STATUS;

  return DEFAULT_ERROR_BY_STATUS[resolvedStatusCode];
};

const getErrorStatusCode = (error: unknown): ContentfulStatusCode => {
  if (isAppError(error)) {
    return normalizeStatusCode(error.statusCode);
  }

  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status: unknown }).status;
    if (typeof status === 'number') {
      return normalizeStatusCode(status);
    }
  }

  return 500;
};

export const toApiError = (
  error: unknown,
): { statusCode: ContentfulStatusCode; body: ApiErrorResponse<unknown> } => {
  const statusCode = getErrorStatusCode(error);
  const fallback = getDefaultError(statusCode);

  if (isAppError(error)) {
    return {
      statusCode,
      body: {
        status: 'error',
        message: error.expose ? error.message : fallback.message,
        code: error.code ?? fallback.code,
        errors: error.errors ?? null,
      },
    };
  }

  if (error instanceof Error) {
    return {
      statusCode,
      body: {
        status: 'error',
        message: statusCode >= 500 ? fallback.message : error.message,
        code: fallback.code,
        errors: null,
      },
    };
  }

  return {
    statusCode,
    body: {
      status: 'error',
      message: fallback.message,
      code: fallback.code,
      errors: null,
    },
  };
};
