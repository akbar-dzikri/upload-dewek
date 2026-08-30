import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema';
import { confirmAsset, initAsset } from './service';

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

describe('assets service', () => {
  let db: ReturnType<typeof createTestDb>['db'];
  const projectId = '550e8400-e29b-41d4-a716-446655440000';

  beforeEach(async () => {
    const { db: testDb } = createTestDb();
    db = testDb;
    const now = Date.now();
    await testDb.insert(schema.projects).values({
      id: projectId,
      name: 'Test Project',
      quotaBytes: 10000,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    });
    await testDb.insert(schema.project_usages).values({
      projectId,
      usedBytes: 0,
      lastUpdated: new Date(now),
    });
  });

  it('initAsset creates pending asset with folder/tags and r2Key', async () => {
    const result = await initAsset(db, {
      projectId,
      filename: 'photo.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1024,
      folder: 'blog/hero',
      tags: ['hero', 'dark'],
    });
    expect(result.id).toBeDefined();
    expect(result.r2Key).toContain(`projects/${projectId}/blog/hero/`);
    expect(result.r2Key).toContain('photo.jpg');
    expect(result.folder).toBe('blog/hero');
    expect(result.tags).toEqual(['hero', 'dark']);
  });

  it('initAsset without folder/tags', async () => {
    const result = await initAsset(db, {
      projectId,
      filename: 'a.png',
      mimeType: 'image/png',
      sizeBytes: 500,
    });
    expect(result.folder).toBeNull();
    expect(result.tags).toBeNull();
    expect(result.r2Key).toContain(`projects/${projectId}/`);
    expect(result.r2Key).not.toContain('//');
  });

  it('initAsset throws 404 if project not found', async () => {
    await expect(
      initAsset(db, {
        projectId: '00000000-0000-4000-a000-000000000000',
        filename: 'x.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 100,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('initAsset throws 413 if quota exceeded', async () => {
    // used 0 + 20000 > quota 10000
    await expect(
      initAsset(db, {
        projectId,
        filename: 'big.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 20000,
      }),
    ).rejects.toMatchObject({ statusCode: 413 });
  });

  it('confirmAsset flips pending -> validated and increments usage', async () => {
    const init = await initAsset(db, {
      projectId,
      filename: 'c.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1000,
    });
    const confirmed = await confirmAsset(db, init.id, true);
    expect(confirmed.status).toBe('validated');
  });

  it('confirmAsset throws 404 if not found', async () => {
    await expect(confirmAsset(db, '00000000-0000-4000-a000-000000000000', true)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('confirmAsset throws 409 if already validated', async () => {
    const init = await initAsset(db, { projectId, filename: 'd.jpg', mimeType: 'image/jpeg', sizeBytes: 100 });
    await confirmAsset(db, init.id, true);
    await expect(confirmAsset(db, init.id, true)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('confirmAsset throws 404 if R2 missing', async () => {
    const init = await initAsset(db, { projectId, filename: 'e.jpg', mimeType: 'image/jpeg', sizeBytes: 100 });
    await expect(confirmAsset(db, init.id, false)).rejects.toMatchObject({ statusCode: 404 });
  });
});
