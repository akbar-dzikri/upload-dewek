import { describe, expect, it, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema';
import { createProject, listProjects } from './service';

const createTestDb = () => {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  // Run migrations SQL directly (simplified)
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

describe('projects service', () => {
  let db: ReturnType<typeof createTestDb>['db'];

  beforeEach(() => {
    const { db: testDb } = createTestDb();
    db = testDb;
  });

  it('createProject inserts projects + project_usages', async () => {
    const project = await createProject(db, { name: 'My Project', quotaBytes: 12345 });
    expect(project.id).toBeDefined();
    expect(project.name).toBe('My Project');
    expect(project.quotaBytes).toBe(12345);
    expect(project.usedBytes).toBe(0);

    const listed = await listProjects(db, { page: 1, limit: 10 });
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]?.name).toBe('My Project');
    expect(listed.meta.totalDocs).toBe(1);
  });

  it('createProject defaults quotaBytes', async () => {
    // quotaBytes omitted -> default 1GB via schema default, but service also defaults
    const project = await createProject(db, { name: 'Default Quota' } as never);
    // service fallback is 1GB when undefined
    expect(project.quotaBytes).toBe(1073741824);
  });

  it('listProjects paginates', async () => {
    await createProject(db, { name: 'P1' });
    await createProject(db, { name: 'P2' });
    await createProject(db, { name: 'P3' });

    const page1 = await listProjects(db, { page: 1, limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.meta.hasNextPage).toBe(true);
    expect(page1.meta.totalDocs).toBe(3);

    const page2 = await listProjects(db, { page: 2, limit: 2 });
    expect(page2.items).toHaveLength(1);
    expect(page2.meta.hasNextPage).toBe(false);
    expect(page2.meta.hasPrevPage).toBe(true);
  });

  it('allows duplicate names', async () => {
    await createProject(db, { name: 'Dup' });
    await createProject(db, { name: 'Dup' });
    const listed = await listProjects(db, { page: 1, limit: 10 });
    expect(listed.items.filter((i) => i.name === 'Dup')).toHaveLength(2);
  });
});
