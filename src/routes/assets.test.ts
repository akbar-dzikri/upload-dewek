import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../lib/db/schema';
import { hashApiKey } from '../lib/auth/hash';
import app from '../index';

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
const parseJson = async <T>(res: Response): Promise<T> => res.json() as Promise<T>;

const createTestDb = () => {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  sqlite.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      quota_bytes INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE project_usages (
      project_id TEXT PRIMARY KEY NOT NULL,
      used_bytes INTEGER NOT NULL,
      last_updated INTEGER NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE ON UPDATE CASCADE
    );
    CREATE TABLE api_keys (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE ON UPDATE CASCADE
    );
    CREATE UNIQUE INDEX api_keys_key_hash_unique ON api_keys(key_hash);
    CREATE TABLE assets (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      r2_key TEXT NOT NULL UNIQUE,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      validated_at INTEGER,
      folder TEXT,
      tags TEXT,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE ON UPDATE CASCADE
    );
    CREATE UNIQUE INDEX assets_r2_key_unique ON assets(r2_key);
    CREATE INDEX idx_assets_project_id ON assets(project_id);
    CREATE INDEX idx_assets_project_status_created_at ON assets(project_id, status, created_at);
    CREATE INDEX idx_assets_folder ON assets(folder);
  `);
  return { sqlite, db };
};

const TEST_API_KEY = 'ud_local_test_key_12345';
let testDb: ReturnType<typeof createTestDb>['db'];
const projectId = '550e8400-e29b-41d4-a716-446655440000';

const getTestEnv = (overrides: Record<string, unknown> = {}) =>
  ({
    DB: testDb as unknown as D1Database,
    CACHE: {} as unknown as KVNamespace,
    ASSETS: {
      head: () => Promise.resolve({} as object),
      get: () =>
        Promise.resolve({
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('fake-image-bytes'));
              controller.close();
            },
          }),
          httpMetadata: { contentType: 'image/jpeg' },
        } as unknown as R2Object),
      delete: () => Promise.resolve(),
    } as unknown as R2Bucket,
    IMAGES: {} as unknown as ImagesBinding,
    R2_ACCESS_KEY_ID: 'test-access-key-id-test-access-key-id-test12',
    R2_SECRET_ACCESS_KEY: 'test-secret-access-key-test-secret-access-key-test12',
    R2_BUCKET: 'test-bucket',
    ...overrides,
  }) as unknown as CloudflareBindings & Record<string, unknown>;

const seedAssets = async () => {
  const now = Date.now();
  const assetsToInsert = [
    {
      id: '00000000-0000-4000-a000-000000000001',
      projectId,
      r2Key: `projects/${projectId}/blog/hero/1-a.jpg`,
      filename: 'a.jpg',
      mimeType: 'image/jpeg' as const,
      sizeBytes: 100,
      status: 'validated' as const,
      folder: 'blog/hero',
      tags: JSON.stringify(['hero', 'dark']),
      createdAt: new Date(now - 3000),
      validatedAt: new Date(now - 3000),
    },
    {
      id: '00000000-0000-4000-a000-000000000002',
      projectId,
      r2Key: `projects/${projectId}/blog/hero/2-b.jpg`,
      filename: 'b.jpg',
      mimeType: 'image/jpeg' as const,
      sizeBytes: 100,
      status: 'validated' as const,
      folder: 'blog/hero',
      tags: JSON.stringify(['hero']),
      createdAt: new Date(now - 2000),
      validatedAt: new Date(now - 2000),
    },
    {
      id: '00000000-0000-4000-a000-000000000003',
      projectId,
      r2Key: `projects/${projectId}/products/3-c.jpg`,
      filename: 'cover.jpg',
      mimeType: 'image/jpeg' as const,
      sizeBytes: 100,
      status: 'validated' as const,
      folder: 'products',
      tags: JSON.stringify(['promo']),
      createdAt: new Date(now - 1000),
      validatedAt: new Date(now - 1000),
    },
    {
      id: '00000000-0000-4000-a000-000000000004',
      projectId,
      r2Key: `projects/${projectId}/blog/hero/4-pending.jpg`,
      filename: 'pending.jpg',
      mimeType: 'image/jpeg' as const,
      sizeBytes: 100,
      status: 'pending' as const,
      folder: 'blog/hero',
      tags: JSON.stringify(['hero']),
      createdAt: new Date(now),
      validatedAt: null,
    },
  ];
  for (const a of assetsToInsert) {
    const parsedTags = JSON.parse(a.tags) as string[];
    await testDb.insert(schema.assets).values({
      id: a.id,
      projectId: a.projectId,
      r2Key: a.r2Key,
      filename: a.filename,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      status: a.status,
      folder: a.folder,
      tags: parsedTags,
      createdAt: a.createdAt,
      validatedAt: a.validatedAt,
    });
  }
};

describe('assets routes - list', () => {
  beforeEach(async () => {
    const { db } = createTestDb();
    testDb = db;
    const now = Date.now();
    await testDb.insert(schema.projects).values({
      id: projectId,
      name: 'Portfolio',
      quotaBytes: 10000,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    });
    await testDb.insert(schema.project_usages).values({
      projectId,
      usedBytes: 0,
      lastUpdated: new Date(now),
    });
    const keyHash = await hashApiKey(TEST_API_KEY);
    await testDb.insert(schema.api_keys).values({
      id: 'seed-key-1',
      projectId,
      keyHash,
      createdAt: new Date(now),
    });
    await seedAssets();
  });

  it('GET /assets 401 without key', async () => {
    const res = await app.request(`/assets?projectId=${projectId}`, {}, getTestEnv());
    expect(res.status).toBe(401);
  });

  it('GET /assets 422 without projectId', async () => {
    const res = await app.request('/assets', { headers: { 'x-api-key': TEST_API_KEY } }, getTestEnv());
    expect(res.status).toBe(422);
  });

  it('GET /assets filters by folder', async () => {
    const res = await app.request(
      `/assets?projectId=${projectId}&folder=blog/hero`,
      { headers: { 'x-api-key': TEST_API_KEY } },
      getTestEnv(),
    );
    expect(res.status).toBe(200);
    const body = await parseJson<{ data: { items: { folder: string }[] } }>(res);
    expect(body.data.items.every((i) => i.folder === 'blog/hero')).toBe(true);
    expect(body.data.items.length).toBe(3);
  });

  it('GET /assets filters by tag', async () => {
    const res = await app.request(
      `/assets?projectId=${projectId}&tag=dark`,
      { headers: { 'x-api-key': TEST_API_KEY } },
      getTestEnv(),
    );
    expect(res.status).toBe(200);
    const body = await parseJson<{ data: { items: { tags: string[] | null }[] } }>(res);
    expect(body.data.items.length).toBe(1);
    expect(body.data.items[0]?.tags).toContain('dark');
  });

  it('GET /assets filters by q', async () => {
    const res = await app.request(
      `/assets?projectId=${projectId}&q=cover`,
      { headers: { 'x-api-key': TEST_API_KEY } },
      getTestEnv(),
    );
    expect(res.status).toBe(200);
    const body = await parseJson<{ data: { items: { filename: string }[] } }>(res);
    expect(body.data.items.length).toBe(1);
    expect(body.data.items[0]?.filename).toBe('cover.jpg');
  });

  it('GET /assets filters by status', async () => {
    const res = await app.request(
      `/assets?projectId=${projectId}&status=pending`,
      { headers: { 'x-api-key': TEST_API_KEY } },
      getTestEnv(),
    );
    expect(res.status).toBe(200);
    const body = await parseJson<{ data: { items: unknown[] } }>(res);
    expect(body.data.items.length).toBe(1);
  });

  it('GET /assets paginates with limit+cursor', async () => {
    const res1 = await app.request(
      `/assets?projectId=${projectId}&limit=2`,
      { headers: { 'x-api-key': TEST_API_KEY } },
      getTestEnv(),
    );
    expect(res1.status).toBe(200);
    const body1 = await parseJson<{ data: { items: { id: string }[]; meta: { hasNextPage: boolean; nextCursor: string | null } } }>(res1);
    expect(body1.data.items.length).toBe(2);
    expect(body1.data.meta.hasNextPage).toBe(true);
    const cursor = body1.data.meta.nextCursor;
    expect(cursor).toBeDefined();

    const res2 = await app.request(
      `/assets?projectId=${projectId}&limit=2&cursor=${cursor}`,
      { headers: { 'x-api-key': TEST_API_KEY } },
      getTestEnv(),
    );
    const body2 = await parseJson<{ data: { items: unknown[] } }>(res2);
    expect(body2.data.items.length).toBe(2);
  });

  it('GET /assets/:id/content 404 if pending', async () => {
    const pendingId = '00000000-0000-4000-a000-000000000004';
    const res = await app.request(
      `/assets/${pendingId}/content`,
      { headers: { 'x-api-key': TEST_API_KEY } },
      getTestEnv(),
    );
    expect(res.status).toBe(404);
  });

  it('GET /assets/:id/content 200 with transform', async () => {
    const validatedId = '00000000-0000-4000-a000-000000000001';
    const res = await app.request(
      `/assets/${validatedId}/content?width=800&format=webp&quality=80`,
      { headers: { 'x-api-key': TEST_API_KEY } },
      getTestEnv(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toContain('max-age=31536000');
  });

  it('DELETE /assets/:id 204 and then 404 on content', async () => {
    const validatedId = '00000000-0000-4000-a000-000000000001';
    const delRes = await app.request(
      `/assets/${validatedId}`,
      { method: 'DELETE', headers: { 'x-api-key': TEST_API_KEY } },
      getTestEnv(),
    );
    expect(delRes.status).toBe(204);

    const getRes = await app.request(
      `/assets/${validatedId}/content`,
      { headers: { 'x-api-key': TEST_API_KEY } },
      getTestEnv(),
    );
    expect(getRes.status).toBe(404);
  });

  it('DELETE /assets/:id 404 if already rejected', async () => {
    const validatedId = '00000000-0000-4000-a000-000000000002';
    const first = await app.request(`/assets/${validatedId}`, { method: 'DELETE', headers: { 'x-api-key': TEST_API_KEY } }, getTestEnv());
    expect(first.status).toBe(204);
    const second = await app.request(`/assets/${validatedId}`, { method: 'DELETE', headers: { 'x-api-key': TEST_API_KEY } }, getTestEnv());
    expect(second.status).toBe(404);
  });
});
