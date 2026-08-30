import { z } from 'zod';

export const ALLOWED_MIMES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
  'video/mp4',
] as const;

export const initUploadSchema = z.object({
  projectId: z.string().uuid('projectId must be a valid UUID'),
  filename: z
    .string()
    .min(1, 'filename is required')
    .max(255, 'filename must be <=255 chars')
    .refine((v) => !v.includes('/') && !v.includes('\\'), 'filename must not contain path separators'),
  mimeType: z.enum(ALLOWED_MIMES, { message: `mimeType must be one of ${ALLOWED_MIMES.join(', ')}` }),
  sizeBytes: z.number().int().min(1, 'sizeBytes must be >=1').max(104857600, 'sizeBytes too large (max 100MB)'),
  folder: z
    .string()
    .max(80, 'folder must be <=80 chars')
    .regex(/^[a-z0-9/_-]*$/, 'folder may contain only a-z 0-9 / _ -')
    .optional()
    .transform((v) => (v ? v.replace(/^\/+|\/+$/g, '') : v))
    .refine((v) => !v || !v.includes('//'), 'folder must not contain //')
    .optional(),
  tags: z
    .array(z.string().min(1).max(20).regex(/^[a-z0-9_-]+$/, 'tag may contain only a-z 0-9 _ -'))
    .max(5, 'tags must have <=5 items')
    .optional()
    .default([]),
});

export type InitUploadInput = z.input<typeof initUploadSchema>;

export const confirmUploadSchema = z.object({
  assetId: z.string().uuid('assetId must be a valid UUID'),
});

export type ConfirmUploadInput = z.infer<typeof confirmUploadSchema>;
