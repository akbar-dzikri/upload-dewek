import type * as z from 'zod';
import type { ValidationTargets } from 'hono';
import { zValidator as zv } from '@hono/zod-validator';
import { AppError } from '../http/app-error';

export const zValidator = <T extends z.ZodSchema, Target extends keyof ValidationTargets>(
  target: Target,
  schema: T,
) =>
  zv(target, schema, (result) => {
    if (!result.success) {
      const formattedissues = result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }));

      throw new AppError({
        statusCode: 422,
        message: 'Validation error',
        code: 'ERR_VALIDATION',
        errors: formattedissues,
      });
    }
  });
