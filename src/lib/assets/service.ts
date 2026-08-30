import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { assets, projects, project_usages } from '../db/schema';
import type { DbClient } from '../db/client';
import type { InitUploadInput } from '../validation/uploads';
import { AppError } from '../core/errors';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = DbClient | BetterSQLite3Database<any>;

const sanitizeFilename = (filename: string): string => {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 255);
};

const buildR2Key = (projectId: string, folder: string | undefined, filename: string): string => {
  const safeFilename = sanitizeFilename(filename);
  const uuid = crypto.randomUUID();
  const folderPart = folder ? `${folder}/` : '';
  return `projects/${projectId}/${folderPart}${uuid}-${safeFilename}`;
};

export const initAsset = async (
  db: AnyDb,
  input: InitUploadInput,
): Promise<{ id: string; r2Key: string; folder: string | null; tags: string[] | null }> => {
  // Verify project exists
  const [project] = await (db as unknown as DbClient)
    .select()
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1);

  if (!project) {
    throw new AppError({
      statusCode: 404,
      code: 'ERR_NOT_FOUND',
      message: `Project ${input.projectId} not found`,
      expose: true,
    });
  }

  // Quota check
  const [usage] = await (db as unknown as DbClient)
    .select()
    .from(project_usages)
    .where(eq(project_usages.projectId, input.projectId))
    .limit(1);

  const usedBytes = usage?.usedBytes ?? 0;
  if (usedBytes + input.sizeBytes > project.quotaBytes) {
    throw new AppError({
      statusCode: 413,
      code: 'ERR_QUOTA_EXCEEDED',
      message: 'Quota exceeded',
      expose: true,
    });
  }

  const r2Key = buildR2Key(input.projectId, input.folder, input.filename);
  const id = crypto.randomUUID();
  const now = new Date();

  const folder = input.folder ?? null;
  const tags = input.tags && input.tags.length > 0 ? input.tags : null;

  const newAsset = {
    id,
    projectId: input.projectId,
    r2Key,
    filename: input.filename,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    status: 'pending' as const,
    folder,
    tags,
    createdAt: now,
    validatedAt: null,
  };

  await (db as unknown as DbClient).insert(assets).values(newAsset);

  return { id, r2Key, folder, tags };
};

export const getAssetById = async (db: AnyDb, assetId: string) => {
  const [row] = await (db as unknown as DbClient).select().from(assets).where(eq(assets.id, assetId)).limit(1);
  return row ?? null;
};

export const confirmAsset = async (
  db: AnyDb,
  assetId: string,
  r2Exists: boolean,
  actualSizeBytes?: number,
): Promise<{ id: string; r2Key: string; status: string }> => {
  const [asset] = await (db as unknown as DbClient).select().from(assets).where(eq(assets.id, assetId)).limit(1);
  if (!asset) {
    throw new AppError({ statusCode: 404, code: 'ERR_NOT_FOUND', message: `Asset ${assetId} not found`, expose: true });
  }
  if (asset.status !== 'pending') {
    throw new AppError({ statusCode: 409, code: 'ERR_CONFLICT', message: `Asset ${assetId} already ${asset.status}`, expose: true });
  }
  if (!r2Exists) {
    throw new AppError({ statusCode: 404, code: 'ERR_NOT_FOUND', message: `R2 object not found`, expose: true });
  }
  const now = new Date();
  const sizeBytes = actualSizeBytes ?? asset.sizeBytes;
  const updateResult = await (db as unknown as DbClient)
    .update(assets)
    .set({ status: 'validated', sizeBytes, validatedAt: now })
    .where(and(eq(assets.id, assetId), eq(assets.status, 'pending')));
  // Drizzle D1 returns { meta: { changes } }, better-sqlite3 returns { changes }
  const changes =
    (updateResult as unknown as { meta?: { changes: number }; changes?: number })?.meta?.changes ??
    (updateResult as unknown as { changes?: number })?.changes ??
    1;
  if (changes === 0) {
    throw new AppError({ statusCode: 409, code: 'ERR_CONFLICT', message: `Asset ${assetId} already ${asset.status}`, expose: true });
  }
  const [usage] = await (db as unknown as DbClient).select().from(project_usages).where(eq(project_usages.projectId, asset.projectId)).limit(1);
  if (usage) {
    await (db as unknown as DbClient)
      .update(project_usages)
      .set({ usedBytes: usage.usedBytes + sizeBytes, lastUpdated: now })
      .where(eq(project_usages.projectId, asset.projectId));
  } else {
    await (db as unknown as DbClient).insert(project_usages).values({ projectId: asset.projectId, usedBytes: sizeBytes, lastUpdated: now });
  }
  return { id: asset.id, r2Key: asset.r2Key, status: 'validated' };
};
