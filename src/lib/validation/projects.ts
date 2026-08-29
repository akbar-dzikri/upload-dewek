import { z } from 'zod';

export const createProjectSchema = z.object({
  name: z.string().min(1, 'name is required').max(100, 'name must be <=100 chars'),
  quotaBytes: z
    .number()
    .int()
    .min(1, 'quotaBytes must be >=1')
    .max(1099511627776, 'quotaBytes too large (max 1TB)')
    .optional()
    .default(1073741824),
});

export type CreateProjectInput = z.input<typeof createProjectSchema>;

export const listProjectsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;
