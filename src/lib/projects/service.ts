import { desc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { DbClient } from '../db/client';
import { projects, project_usages } from '../db/schema';
import type { CreateProjectInput } from '../validation/projects';

// Allow both D1 and better-sqlite3 clients for tests
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = DbClient | BetterSQLite3Database<any>;

export const createProject = async (db: AnyDb, input: CreateProjectInput) => {
  const id = crypto.randomUUID();
  const now = Date.now();
  const quotaBytes = input.quotaBytes ?? 1073741824;

  const newProject = {
    id,
    name: input.name,
    quotaBytes,
    createdAt: new Date(now),
    updatedAt: new Date(now),
  };

  const newUsage = {
    projectId: id,
    usedBytes: 0,
    lastUpdated: new Date(now),
  };

  // Support both D1 batch and better-sqlite3 sequential inserts
  const anyDb = db as unknown as {
    batch?: (stmts: unknown[]) => Promise<unknown>;
    insert: (table: unknown) => { values: (v: unknown) => Promise<unknown> };
  };
  if (anyDb.batch) {
    await anyDb.batch([
      (db as DbClient).insert(projects).values(newProject),
      (db as DbClient).insert(project_usages).values(newUsage),
    ]);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as BetterSQLite3Database<any>).insert(projects).values(newProject);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as BetterSQLite3Database<any>).insert(project_usages).values(newUsage);
  }

  return {
    id,
    name: input.name,
    quotaBytes,
    usedBytes: 0,
    createdAt: now,
    updatedAt: now,
  };
};

export const listProjects = async (db: AnyDb, query: { page: number; limit: number }) => {
  const { page, limit } = query;
  const offset = (page - 1) * limit;

  const rows = await (db as unknown as DbClient)
    .select({
      id: projects.id,
      name: projects.name,
      quotaBytes: projects.quotaBytes,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      usedBytes: project_usages.usedBytes,
      lastUpdated: project_usages.lastUpdated,
    })
    .from(projects)
    .leftJoin(project_usages, eq(projects.id, project_usages.projectId))
    .orderBy(desc(projects.createdAt))
    .limit(limit)
    .offset(offset);

  // For pagination meta we need total count - cheap COUNT(*)
  const totalRows = await (db as unknown as DbClient).select().from(projects);
  const totalDocs = totalRows.length;
  const totalPages = Math.max(1, Math.ceil(totalDocs / limit));

  return {
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      quotaBytes: r.quotaBytes,
      usedBytes: r.usedBytes ?? 0,
      createdAt: r.createdAt instanceof Date ? r.createdAt.getTime() : (r.createdAt as unknown as number),
      updatedAt: r.updatedAt instanceof Date ? r.updatedAt.getTime() : (r.updatedAt as unknown as number),
    })),
    meta: {
      page,
      limit,
      totalDocs,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  };
};

export const getProjectById = async (db: AnyDb, projectId: string) => {
  const [row] = await (db as unknown as DbClient)
    .select({
      id: projects.id,
      name: projects.name,
      quotaBytes: projects.quotaBytes,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      usedBytes: project_usages.usedBytes,
    })
    .from(projects)
    .leftJoin(project_usages, eq(projects.id, project_usages.projectId))
    .where(eq(projects.id, projectId))
    .limit(1);

  return row ?? null;
};
