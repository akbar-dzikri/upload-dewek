import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ApiErrorResponse } from './api-response';
import {
  isAppError,
  getRegistryEntry,
  normalizeStatusCode,
  FALLBACK_ERROR_STATUS,
} from '../core/errors';

export const toApiError = (
  error: unknown,
): { statusCode: ContentfulStatusCode; body: ApiErrorResponse<unknown> } => {
  const statusCode = resolveStatusCode(error);
  const fallback = getRegistryEntry(statusCode);

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

const resolveStatusCode = (error: unknown): ContentfulStatusCode => {
  if (isAppError(error)) {
    return normalizeStatusCode(error.statusCode);
  }

  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status: unknown }).status;
    if (typeof status === 'number') {
      return normalizeStatusCode(status);
    }
  }

  return FALLBACK_ERROR_STATUS;
};
