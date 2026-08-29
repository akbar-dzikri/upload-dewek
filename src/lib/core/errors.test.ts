import { describe, expect, it } from 'vitest';
import { AppError, ERROR_REGISTRY } from './errors';
import { toApiError } from '../http/error-mapper';

describe('errors', () => {
  it('maps AppError to ApiError correctly', () => {
    const err = new AppError({
      statusCode: 404,
      message: 'Not found',
      code: 'ERR_NOT_FOUND',
      expose: true,
    });
    const result = toApiError(err);
    expect(result.statusCode).toBe(404);
    expect(result.body.code).toBe('ERR_NOT_FOUND');
  });

  it('uses fallback for unknown error', () => {
    const result = toApiError(new Error('boom'));
    expect(result.statusCode).toBe(500);
    expect(result.body.code).toBe(ERROR_REGISTRY[500].code);
  });
});
