import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { rateLimit } from './rate-limit';

type MockKV = {
  store: Map<string, string>;
  get: (k: string) => Promise<string | null>;
  put: (k: string, v: string, opts?: { expirationTtl: number }) => Promise<void>;
};

const createMockKV = (): MockKV => {
  const store = new Map<string, string>();
  return {
    store,
    get: (k: string) => Promise.resolve(store.get(k) ?? null),
    put: (k: string, v: string) => {
      store.set(k, v);
      return Promise.resolve();
    },
  };
};

const createApp = (kv?: MockKV) => {
  const app = new Hono<{ Bindings: { CACHE: KVNamespace } }>();
  app.onError((err, c) => {
    const status = (err as unknown as { statusCode?: number }).statusCode ?? 500;
    const code = (err as unknown as { code?: string }).code ?? 'ERR_INTERNAL';
    return c.json({ code, message: (err as Error).message }, status as never);
  });
  app.get('/test', async (c, next) => rateLimit(c, next, 2, 60), (c) => c.text('ok'));
  return { app, kv };
};

describe('rateLimit', () => {
  it('passes through when KV missing', async () => {
    const app = new Hono();
    app.onError((err, c) => c.json({ code: (err as unknown as { code?: string }).code ?? 'ERR' }, 500 as never));
    app.get('/test', async (c, next) => rateLimit(c as unknown as never, next, 2, 60), (c) => c.text('ok'));
    const res = await app.request('/test', {}, { CACHE: {} } as unknown as never);
    // CACHE is {} without get/put => bypass
    expect(res.status).toBe(200);
  });

  it('allows up to limit then 429', async () => {
    const kv = createMockKV();
    const { app } = createApp(kv);
    const env = { CACHE: kv as unknown as KVNamespace };
    for (let i = 0; i < 2; i++) {
      const res = await app.request('/test', { headers: { 'CF-Connecting-IP': '1.2.3.4' } }, env);
      expect(res.status).toBe(200);
    }
    const res = await app.request('/test', { headers: { 'CF-Connecting-IP': '1.2.3.4' } }, env);
    expect(res.status).toBe(429);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('ERR_RATE_LIMIT');
  });

  it('hashes x-api-key to avoid leaking raw key in KV', async () => {
    const kv = createMockKV();
    const { app } = createApp(kv);
    const env = { CACHE: kv as unknown as KVNamespace };
    const key = 'ud_local_test_key_12345';
    await app.request('/test', { headers: { 'x-api-key': key } }, env);
    // KV key should not contain raw api key
    const keys = Array.from(kv.store.keys());
    expect(keys.length).toBe(1);
    expect(keys[0]).not.toContain(key);
    expect(keys[0]).toContain('rl:');
    // Should be hashed slice (16 hex chars)
    expect(keys[0]).toMatch(/^rl:[a-f0-9]{16}:\d+$/);
  });

  it('uses x-api-key over IP when both present', async () => {
    const kv = createMockKV();
    const { app } = createApp(kv);
    const env = { CACHE: kv as unknown as KVNamespace };
    await app.request('/test', { headers: { 'x-api-key': 'ud_key', 'CF-Connecting-IP': '1.2.3.4' } }, env);
    const keys = Array.from(kv.store.keys());
    // Should be hashed api key, not IP
    expect(keys[0]).not.toContain('1.2.3.4');
  });

  it('isolates buckets per window', async () => {
    const kv = createMockKV();
    const { app } = createApp(kv);
    const env = { CACHE: kv as unknown as KVNamespace };
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);
    await app.request('/test', { headers: { 'CF-Connecting-IP': '5.6.7.8' } }, env);
    // Advance to next bucket
    vi.setSystemTime(now + 61 * 1000);
    // Should be allowed again (new bucket)
    const res = await app.request('/test', { headers: { 'CF-Connecting-IP': '5.6.7.8' } }, env);
    expect(res.status).toBe(200);
    vi.useRealTimers();
  });
});
