import type { Context, Next } from 'hono';
import { AppError } from './core/errors';
import { hashApiKey } from './auth/hash';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const rateLimit = async (c: Context<any>, next: Next, limit = 60, windowSec = 60): Promise<void> => {
  const kv = (c.env as unknown as { CACHE?: KVNamespace }).CACHE;
  if (kv === undefined || typeof kv.get !== 'function' || typeof kv.put !== 'function') {
    await next();
    return;
  }
  const rawKey = c.req.header('x-api-key') ?? c.req.header('CF-Connecting-IP') ?? 'anon';
  // Hash API keys to avoid leaking raw keys in KV keys
  const key = rawKey.startsWith('ud_') ? (await hashApiKey(rawKey)).slice(0, 16) : rawKey;
  const bucket = Math.floor(Date.now() / (windowSec * 1000));
  const kvKey = `rl:${key}:${bucket}`;
  const current = parseInt((await kv.get(kvKey)) ?? '0', 10);
  if (current >= limit) {
    throw new AppError({ statusCode: 429, code: 'ERR_RATE_LIMIT', message: 'Too many requests', expose: true });
  }
  await kv.put(kvKey, String(current + 1), { expirationTtl: windowSec });
  await next();
};
