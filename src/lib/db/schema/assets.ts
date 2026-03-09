import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { projects } from './projects';

export const assets = sqliteTable(
  'assets',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, {
        onDelete: 'cascade',
        onUpdate: 'cascade',
      }),
    r2Key: text('r2_key').notNull().unique(),
    filename: text('filename').notNull(),
    mimeType: text('mime_type', {
      enum: ['image/jpeg', 'image/png', 'image/webp', 'image/avif','image/gif', 'video/mp4'] as const,
    }).notNull(),
    sizeBytes: integer('size_bytes').notNull().default(0),
    status: text('status', {
      enum: ['pending', 'validated', 'rejected'] as const,
    }).notNull(), // e.g., pending, validated, rejected
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    validatedAt: integer('validated_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    index('idx_assets_project_id').on(table.projectId),
    index('idx_assets_project_status_created_at').on(table.projectId, table.status, table.createdAt),
  ],
);

export type Asset = typeof assets.$inferSelect;
export type NewAsset = typeof assets.$inferInsert;
