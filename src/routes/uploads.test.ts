import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../lib/db/schema';
import { hashApiKey } from '../lib/auth/hash';
import app from '../index';

// Single typed helper for Response.json() in tests — avoids 7 scattered `as` casts
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

const getTestEnv = (overrides: Record<string, unknown> = {}) =>
  ({
    DB: testDb as unknown as D1Database,
    CACHE: {} as unknown as KVNamespace,
    ASSETS: {
      head: () => Promise.resolve({} as object),
    } as unknown as R2Bucket,
    IMAGES: {} as unknown as ImagesBinding,
    R2_ACCESS_KEY_ID: 'test-access-key-id-test-access-key-id-test12',
    R2_SECRET_ACCESS_KEY: 'test-secret-access-key-test-secret-access-key-test12',
    R2_BUCKET: 'test-bucket',
    ...overrides,
  }) as unknown as CloudflareBindings & Record<string, unknown>;

describe('uploads routes', () => {
  let projectId: string;

  beforeEach(async () => {
    const { db } = createTestDb();
    testDb = db;
    const now = Date.now();
    projectId = '550e8400-e29b-41d4-a716-446655440000';
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
  });

  it('POST /upload/init 401 without key', async () => {
    const res = await app.request(
      '/upload/init',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, filename: 'a.jpg', mimeType: 'image/jpeg', sizeBytes: 100 }),
      },
      getTestEnv(),
    );
    expect(res.status).toBe(401);
  });

  it('POST /upload/init 422 with invalid body', async () => {
    const res = await app.request(
      '/upload/init',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_API_KEY },
        body: JSON.stringify({ projectId, filename: '', mimeType: 'image/jpeg', sizeBytes: 100 }),
      },
      getTestEnv(),
    );
    expect(res.status).toBe(422);
    const body = await parseJson<{ code: string }>(res);
    expect(body.code).toBe('ERR_VALIDATION');
  });

  it('POST /upload/init 404 if project not found', async () => {
    const res = await app.request(
      '/upload/init',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_API_KEY },
        body: JSON.stringify({
          projectId: '00000000-0000-4000-a000-000000000000',
          filename: 'a.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 100,
        }),
      },
      getTestEnv(),
    );
    expect(res.status).toBe(404);
  });

  it('POST /upload/init 413 if quota exceeded', async () => {
    const res = await app.request(
      '/upload/init',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_API_KEY },
        body: JSON.stringify({ projectId, filename: 'big.jpg', mimeType: 'image/jpeg', sizeBytes: 20000 }),
      },
      getTestEnv(),
    );
    expect(res.status).toBe(413);
  });

  it('POST /upload/init 201 with folder/tags', async () => {
    const res = await app.request(
      '/upload/init',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_API_KEY },
        body: JSON.stringify({
          projectId,
          filename: 'photo.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 1024,
          folder: 'blog/hero',
          tags: ['hero', 'dark'],
        }),
      },
      getTestEnv(),
    );
    expect(res.status).toBe(201);
    const body = await parseJson<{
      status: string;
      data: { assetId: string; r2Key: string; url: string; expiresAt: number; folder: string; tags: string[] };
    }>(res);
    expect(body.status).toBe('success');
    expect(body.data.assetId).toBeDefined();
    expect(body.data.r2Key).toContain(`projects/${projectId}/blog/hero/`);
    expect(body.data.url).toContain('X-Amz-Signature');
    expect(body.data.folder).toBe('blog/hero');
    expect(body.data.tags).toEqual(['hero', 'dark']);
  });

  it('POST /upload/init sanitizes folder slashes', async () => {
    const res = await app.request(
      '/upload/init',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_API_KEY },
        body: JSON.stringify({
          projectId,
          filename: 'a.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 100,
          folder: '/blog/hero/',
        }),
      },
      getTestEnv(),
    );
    expect(res.status).toBe(201);
    const body = await parseJson<{ data: { r2Key: string; folder: string } }>(res);
    expect(body.data.folder).toBe('blog/hero');
    expect(body.data.r2Key).toContain('/blog/hero/');
  });

  it('POST /upload/confirm 404 if asset not found', async () => {
    const res = await app.request(
      '/upload/confirm',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_API_KEY },
        body: JSON.stringify({ assetId: '00000000-0000-4000-a000-000000000000' }),
      },
      getTestEnv(),
    );
    expect(res.status).toBe(404);
  });

  it('POST /upload/confirm 200 happy path', async () => {
    const initRes = await app.request(
      '/upload/init',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_API_KEY },
        body: JSON.stringify({ projectId, filename: 'c.jpg', mimeType: 'image/jpeg', sizeBytes: 500 }),
      },
      getTestEnv(),
    );
    const initBody = await parseJson<{ data: { assetId: string } }>(initRes);
    const assetId = initBody.data.assetId;

    const confirmRes = await app.request(
      '/upload/confirm',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_API_KEY },
        body: JSON.stringify({ assetId }),
      },
      getTestEnv(),
    );
    expect(confirmRes.status).toBe(200);
    const confirmBody = await parseJson<{ data: { status: string; url: string; variants: string[] } }>(confirmRes);
    expect(confirmBody.data.status).toBe('validated');
    expect(confirmBody.data.url).toContain('/assets/');
    expect(confirmBody.data.variants.length).toBeGreaterThan(0);
  });

  it('POST /upload/confirm 409 second confirm', async () => {
    const initRes = await app.request(
      '/upload/init',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_API_KEY },
        body: JSON.stringify({ projectId, filename: 'd.jpg', mimeType: 'image/jpeg', sizeBytes: 500 }),
      },
      getTestEnv(),
    );
    const initBody = await parseJson<{ data: { assetId: string } }>(initRes);
    const assetId = initBody.data.assetId;

    const first = await app.request(
      '/upload/confirm',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_API_KEY },
        body: JSON.stringify({ assetId }),
      },
      getTestEnv(),
    );
    expect(first.status).toBe(200);

    const second = await app.request(
      '/upload/confirm',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_API_KEY },
        body: JSON.stringify({ assetId }),
      },
      getTestEnv(),
    );
    expect(second.status).toBe(409);
  });

  it('POST /upload/confirm 404 if R2 missing', async () => {
    const initRes = await app.request(
      '/upload/init',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_API_KEY },
        body: JSON.stringify({ projectId, filename: 'e.jpg', mimeType: 'image/jpeg', sizeBytes: 500 }),
      },
      getTestEnv(),
    );
    const initBody = await parseJson<{ data: { assetId: string } }>(initRes);
    const assetId = initBody.data.assetId;

    const envWithMissingR2 = getTestEnv({
      ASSETS: {
        head: () => Promise.resolve(null),
      } as unknown as R2Bucket,
    });

    const res = await app.request(
      '/upload/confirm',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_API_KEY },
        body: JSON.stringify({ assetId }),
      },
      envWithMissingR2,
    );
    expect(res.status).toBe(404);
  });
});
