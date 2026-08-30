import type { ContentfulStatusCode } from 'hono/utils/http-status';

export const ERROR_REGISTRY = {
  400: { message: 'Bad request', code: 'ERR_BAD_REQUEST' },
  401: { message: 'Unauthorized', code: 'ERR_UNAUTHORIZED' },
  403: { message: 'Forbidden', code: 'ERR_FORBIDDEN' },
  404: { message: 'Not found', code: 'ERR_NOT_FOUND' },
  409: { message: 'Conflict', code: 'ERR_CONFLICT' },
  413: { message: 'Payload too large', code: 'ERR_QUOTA_EXCEEDED' },
  422: { message: 'Validation error', code: 'ERR_VALIDATION' },
  429: { message: 'Too many requests', code: 'ERR_RATE_LIMIT' },
  500: { message: 'Something went wrong', code: 'ERR_INTERNAL' },
} as const;

export type ErrorRegistryStatusCode = keyof typeof ERROR_REGISTRY;

export type ErrorCode = (typeof ERROR_REGISTRY)[ErrorRegistryStatusCode]['code'];

export const FALLBACK_ERROR_STATUS: ErrorRegistryStatusCode = 500;

type AppErrorOptions<TErrors> = {
  message: string;
  code: ErrorCode;
  statusCode: ContentfulStatusCode;
  errors?: TErrors | null;
  expose?: boolean;
};

export class AppError<TErrors = null> extends Error {
  public readonly statusCode: ContentfulStatusCode;
  public readonly code: ErrorCode;
  public readonly errors: TErrors | null;
  public readonly expose: boolean;

  constructor({
    message,
    code,
    statusCode,
    errors = null,
    expose = false,
  }: AppErrorOptions<TErrors>) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.errors = errors;
    this.expose = expose;
  }
}

export const isAppError = (error: unknown): error is AppError<unknown> => {
  return error instanceof AppError;
};

export const isRegisteredStatusCode = (
  statusCode: number,
): statusCode is ErrorRegistryStatusCode => {
  return statusCode in ERROR_REGISTRY;
};

export const getRegistryEntry = (
  statusCode: number,
): (typeof ERROR_REGISTRY)[ErrorRegistryStatusCode] => {
  const resolved = isRegisteredStatusCode(statusCode) ? statusCode : FALLBACK_ERROR_STATUS;
  return ERROR_REGISTRY[resolved];
};

export const normalizeStatusCode = (statusCode: number): ContentfulStatusCode => {
  if (statusCode >= 400 && statusCode <= 599) {
    return statusCode as ContentfulStatusCode;
  }
  return FALLBACK_ERROR_STATUS;
};
