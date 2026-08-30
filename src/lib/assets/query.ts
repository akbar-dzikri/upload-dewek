import { and, desc, eq, lt, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { assets } from '../db/schema';
import type { DbClient } from '../db/client';
import type { ListAssetsQuery } from '../validation/assets';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = DbClient | BetterSQLite3Database<any>;

const escapeLike = (s: string): string => s.replace(/[%_\\]/g, '\\$&');

export const listAssets = async (db: AnyDb, query: ListAssetsQuery) => {
  const { projectId, folder, tag, q, status, cursor, limit } = query;

  const conditions = [eq(assets.projectId, projectId)];

  if (folder !== undefined) {
    conditions.push(eq(assets.folder, folder));
  }
  if (tag !== undefined) {
    conditions.push(sql`${assets.tags} LIKE ${`%"${escapeLike(tag)}"%`} ESCAPE '\\'`);
  }
  if (q !== undefined) {
    conditions.push(sql`${assets.filename} LIKE ${`%${escapeLike(q)}%`} ESCAPE '\\'`);
  }
  if (status !== undefined) {
    conditions.push(eq(assets.status, status));
  }
  if (cursor !== undefined) {
    const cursorTime = Number(cursor);
    if (!Number.isNaN(cursorTime)) {
      conditions.push(lt(assets.createdAt, new Date(cursorTime)));
    }
  }

  const whereClause = and(...conditions);

  // Fetch limit+1 to detect hasNextPage
  const rows = await (db as unknown as DbClient)
    .select()
    .from(assets)
    .where(whereClause)
    .orderBy(desc(assets.createdAt))
    .limit(limit + 1);

  const hasNextPage = rows.length > limit;
  const items = hasNextPage ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  const nextCursor = hasNextPage && last !== undefined ? String(last.createdAt instanceof Date ? last.createdAt.getTime() : Number(last.createdAt)) : null;

  return {
    items: items.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      r2Key: r.r2Key,
      filename: r.filename,
      mimeType: r.mimeType,
      sizeBytes: r.sizeBytes,
      status: r.status,
      folder: r.folder,
      tags: r.tags,
      createdAt: r.createdAt instanceof Date ? r.createdAt.getTime() : (r.createdAt as unknown as number),
      validatedAt: r.validatedAt instanceof Date ? r.validatedAt.getTime() : (r.validatedAt as unknown as number | null),
    })),
    meta: {
      hasNextPage,
      nextCursor,
      limit,
    },
  };
};
