import { describe, expect, it, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../lib/db/schema';
import { hashApiKey } from '../lib/auth/hash';
import app from '../index';

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
    CREATE INDEX idx_api_keys_project_created_at ON api_keys(project_id, created_at);
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

const getTestEnv = () => ({
  DB: testDb as unknown as D1Database,
  CACHE: {} as unknown as KVNamespace,
  ASSETS: {} as unknown as R2Bucket,
  IMAGES: {} as unknown as ImagesBinding,
});

describe('projects routes', () => {
  beforeEach(async () => {
    const { db } = createTestDb();
    testDb = db;
    const now = Date.now();
    const portfolioProject = {
      id: 'portfolio',
      name: 'Portfolio',
      quotaBytes: 1073741824,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    };
    const usage = { projectId: 'portfolio', usedBytes: 0, lastUpdated: new Date(now) };
    const keyHash = await hashApiKey(TEST_API_KEY);
    await testDb.insert(schema.projects).values(portfolioProject);
    await testDb.insert(schema.project_usages).values(usage);
    await testDb.insert(schema.api_keys).values({
      id: 'seed-key-1',
      projectId: 'portfolio',
      keyHash,
      createdAt: new Date(now),
    });
  });

  it('POST /projects 401 without x-api-key', async () => {
    const res = await app.request(
      '/projects',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Project' }),
      },
      getTestEnv(),
    );
    expect(res.status).toBe(401);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const body = (await res.json()) as unknown as { code: string };
    expect(body.code).toBe('ERR_UNAUTHORIZED');
  });

  it('POST /projects 401 with invalid key', async () => {
    const res = await app.request(
      '/projects',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': 'invalid' },
        body: JSON.stringify({ name: 'New Project' }),
      },
      getTestEnv(),
    );
    expect(res.status).toBe(401);
  });

  it('POST /projects 422 with invalid body', async () => {
    const res = await app.request(
      '/projects',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_API_KEY },
        body: JSON.stringify({ name: '' }),
      },
      getTestEnv(),
    );
    expect(res.status).toBe(422);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const body = (await res.json()) as unknown as { code: string; errors: unknown[] };
    expect(body.code).toBe('ERR_VALIDATION');
    expect(body.errors).toBeDefined();
  });

  it('POST /projects 201 with valid key', async () => {
    const res = await app.request(
      '/projects',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_API_KEY },
        body: JSON.stringify({ name: 'My New Project', quotaBytes: 5000 }),
      },
      getTestEnv(),
    );
    expect(res.status).toBe(201);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const body = (await res.json()) as unknown as { status: string; data: { id: string; name: string; quotaBytes: number } };
    expect(body.status).toBe('success');
    expect(body.data.name).toBe('My New Project');
    expect(body.data.quotaBytes).toBe(5000);
    expect(body.data.id).toBeDefined();
  });

  it('GET /projects 200 paginated with valid key', async () => {
    await app.request(
      '/projects',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_API_KEY },
        body: JSON.stringify({ name: 'P1' }),
      },
      getTestEnv(),
    );
    await app.request(
      '/projects',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_API_KEY },
        body: JSON.stringify({ name: 'P2' }),
      },
      getTestEnv(),
    );

    const res = await app.request('/projects?page=1&limit=2', { headers: { 'x-api-key': TEST_API_KEY } }, getTestEnv());
    expect(res.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const body = (await res.json()) as unknown as {
      status: string;
      data: { items: { name: string }[]; meta: { totalDocs: number; hasNextPage: boolean } };
    };
    expect(body.data.items.length).toBe(2);
    expect(body.data.meta.totalDocs).toBeGreaterThanOrEqual(3);
    expect(body.data.meta.hasNextPage).toBe(true);
  });

  it('GET /projects 401 without key', async () => {
    const res = await app.request('/projects?page=1&limit=10', {}, getTestEnv());
    expect(res.status).toBe(401);
  });

  it('duplicate name allowed', async () => {
    const res1 = await app.request(
      '/projects',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_API_KEY },
        body: JSON.stringify({ name: 'Dup' }),
      },
      getTestEnv(),
    );
    expect(res1.status).toBe(201);
    const res2 = await app.request(
      '/projects',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_API_KEY },
        body: JSON.stringify({ name: 'Dup' }),
      },
      getTestEnv(),
    );
    expect(res2.status).toBe(201);
  });
});
