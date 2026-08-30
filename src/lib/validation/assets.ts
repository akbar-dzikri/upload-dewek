import { z } from 'zod';

export const listAssetsQuerySchema = z.object({
  projectId: z.string().uuid('projectId must be a valid UUID'),
  folder: z
    .string()
    .max(80)
    .regex(/^[a-z0-9/_-]*$/, 'folder may contain only a-z 0-9 / _ -')
    .optional(),
  tag: z
    .string()
    .min(1)
    .max(20)
    .regex(/^[a-z0-9_-]+$/, 'tag may contain only a-z 0-9 _ -')
    .optional(),
  q: z.string().max(100).optional(),
  status: z.enum(['pending', 'validated', 'rejected']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListAssetsQuery = z.infer<typeof listAssetsQuerySchema>;

export const serveAssetQuerySchema = z.object({
  width: z.coerce.number().int().min(16).max(4096).optional(),
  format: z.enum(['webp', 'jpeg', 'png', 'avif']).optional(),
  quality: z.coerce.number().int().min(1).max(100).optional(),
});

export type ServeAssetQuery = z.infer<typeof serveAssetQuerySchema>;
