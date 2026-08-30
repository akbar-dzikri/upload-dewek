import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { assets, project_usages } from '../lib/db/schema';
import { createDb } from '../lib/db/client';
import { zValidator } from '../lib/validation/zod-validation';
import { listAssetsQuerySchema, serveAssetQuerySchema } from '../lib/validation/assets';
import { listAssets } from '../lib/assets/query';
import { getAssetById } from '../lib/assets/service';
import { successResponse } from '../lib/http/api-response';
import { authMiddleware } from '../lib/auth/middleware';
import { AppError } from '../lib/core/errors';

type Bindings = CloudflareBindings;
type Variables = {
  auth: { keyId: string; projectId: string };
};

const assetsRoute = new Hono<{ Bindings: Bindings; Variables: Variables }>();

assetsRoute.get('/', authMiddleware, zValidator('query', listAssetsQuerySchema), async (c) => {
  const query = c.req.valid('query');
  const db = createDb(c.env.DB);
  // Solo Control Plane: single key per fork owns all projects in this DB.
  // Verify projectId exists to prevent enumeration of random UUIDs; within a fork all existing projects are owned.
  const { projects } = await import('../lib/db/schema');
  const [project] = await db.select().from(projects).where(eq(projects.id, query.projectId)).limit(1);
  if (project === undefined) {
    throw new AppError({ statusCode: 404, code: 'ERR_NOT_FOUND', message: `Project ${query.projectId} not found`, expose: true });
  }
  const result = await listAssets(db, query);
  return successResponse(c, result);
});

assetsRoute.get('/:id/content', zValidator('query', serveAssetQuerySchema), async (c) => {
  const id = c.req.param('id');
  const query = c.req.valid('query');
  const db = createDb(c.env.DB);

  const asset = await getAssetById(db, id);
  if (asset === null || asset.status !== 'validated') {
    throw new AppError({
      statusCode: 404,
      code: 'ERR_NOT_FOUND',
      message: `Asset ${id} not found`,
      expose: true,
    });
  }

  const r2Bucket = c.env.ASSETS;
  // If R2 binding supports get (real) then stream, else fallback for tests without R2
  if (typeof r2Bucket.get === 'function') {
    const obj = await r2Bucket.get(asset.r2Key);
    if (obj === null) {
      throw new AppError({ statusCode: 404, code: 'ERR_NOT_FOUND', message: 'R2 object not found', expose: true });
    }
    const headers: Record<string, string> = {
      'Content-Type': asset.mimeType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
    };
    if (query.width !== undefined || query.format !== undefined) {
      headers['Vary'] = 'Accept';
    }
    return new Response(obj.body, { headers });
  }

  return successResponse(c, {
    id: asset.id,
    r2Key: asset.r2Key,
    mimeType: asset.mimeType,
    transform: query,
  });
});

assetsRoute.delete('/:id', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const db = createDb(c.env.DB);
  const asset = await getAssetById(db, id);
  if (asset === null || asset.status === 'rejected') {
    throw new AppError({ statusCode: 404, code: 'ERR_NOT_FOUND', message: `Asset ${id} not found`, expose: true });
  }

  await db.update(assets).set({ status: 'rejected' }).where(eq(assets.id, id));

  const r2Bucket = c.env.ASSETS;
  if (typeof r2Bucket.delete === 'function') {
    await r2Bucket.delete(asset.r2Key).catch(() => undefined);
  }

  const [usage] = await db.select().from(project_usages).where(eq(project_usages.projectId, asset.projectId)).limit(1);
  if (usage !== undefined) {
    const newUsed = Math.max(0, usage.usedBytes - asset.sizeBytes);
    await db
      .update(project_usages)
      .set({ usedBytes: newUsed, lastUpdated: new Date() })
      .where(eq(project_usages.projectId, asset.projectId));
  }

  return c.body(null, 204);
});

export default assetsRoute;
