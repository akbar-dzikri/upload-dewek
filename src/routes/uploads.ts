import { Hono } from 'hono';
import { createDb } from '../lib/db/client';
import { zValidator } from '../lib/validation/zod-validation';
import { confirmUploadSchema, initUploadSchema } from '../lib/validation/uploads';
import { confirmAsset, getAssetById, initAsset } from '../lib/assets/service';
import { createPresignedPost } from '../lib/r2/presign';
import { createdResponse, successResponse } from '../lib/http/api-response';
import { authMiddleware } from '../lib/auth/middleware';

type Bindings = CloudflareBindings;
type Variables = {
  auth: { keyId: string; projectId: string };
};

const uploadsRoute = new Hono<{ Bindings: Bindings; Variables: Variables }>();

uploadsRoute.use('*', authMiddleware);

uploadsRoute.post('/init', zValidator('json', initUploadSchema), async (c) => {
  const input = c.req.valid('json');
  const db = createDb(c.env.DB);

  const asset = await initAsset(db, input);

  const envRec = c.env as unknown as Record<string, string>;
  const presigned = await createPresignedPost(
    {
      R2_ACCESS_KEY_ID: envRec.R2_ACCESS_KEY_ID ?? 'test-access-key-id-test-access-key-id-test12',
      R2_SECRET_ACCESS_KEY: envRec.R2_SECRET_ACCESS_KEY ?? 'test-secret-access-key-test-secret-access-key-test12',
      R2_BUCKET: envRec.R2_BUCKET ?? 'test-bucket',
      R2_ENDPOINT: envRec.R2_ENDPOINT,
    },
    asset.r2Key,
    input.mimeType,
  );

  return createdResponse(c, {
    assetId: asset.id,
    r2Key: asset.r2Key,
    url: presigned.url,
    fields: presigned.fields ?? null,
    expiresAt: presigned.expiresAt,
    folder: asset.folder,
    tags: asset.tags,
  });
});

uploadsRoute.post('/confirm', zValidator('json', confirmUploadSchema), async (c) => {
  const { assetId } = c.req.valid('json');
  const db = createDb(c.env.DB);

  let r2Exists = true;
  const assetsBinding = c.env.ASSETS as unknown as { head?: (key: string) => Promise<Record<string, unknown> | null> } | undefined;
  if (assetsBinding?.head) {
    try {
      const asset = await getAssetById(db, assetId);
      if (!asset) {
        r2Exists = false;
      } else {
        const obj = await assetsBinding.head(asset.r2Key);
        r2Exists = obj !== null;
      }
    } catch {
      r2Exists = false;
    }
  }

  const result = await confirmAsset(db, assetId, r2Exists);

  const canonicalUrl = `/assets/${result.id}/content`;
  const variants = [
    `${canonicalUrl}?width=400&format=webp&quality=80`,
    `${canonicalUrl}?width=800&format=webp&quality=80`,
    `${canonicalUrl}?width=1200&format=webp&quality=80`,
  ];

  return successResponse(c, {
    ...result,
    url: canonicalUrl,
    variants,
  });
});

export default uploadsRoute;
