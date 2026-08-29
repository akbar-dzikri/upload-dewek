import type { Context, Next } from 'hono';
import { eq } from 'drizzle-orm';
import { createDb } from '../db/client';
import { api_keys } from '../db/schema';
import { AppError } from '../core/errors';
import { hashApiKey } from './hash';

export type AuthVariables = {
  auth: {
    keyId: string;
    projectId: string;
  };
};

export const authMiddleware = async (
  c: Context<{ Bindings: CloudflareBindings; Variables: AuthVariables }>,
  next: Next,
) => {
  const apiKey = c.req.header('x-api-key');
  if (!apiKey) {
    throw new AppError({
      statusCode: 401,
      code: 'ERR_UNAUTHORIZED',
      message: 'Missing x-api-key header',
      expose: true,
    });
  }

  const keyHash = await hashApiKey(apiKey);
  const db = createDb(c.env.DB);

  const [row] = await db.select().from(api_keys).where(eq(api_keys.keyHash, keyHash)).limit(1);

  if (!row) {
    throw new AppError({
      statusCode: 401,
      code: 'ERR_UNAUTHORIZED',
      message: 'Invalid API key',
      expose: true,
    });
  }

  c.set('auth', { keyId: row.id, projectId: row.projectId });
  await next();
};
