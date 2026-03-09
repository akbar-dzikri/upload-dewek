import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  quotaBytes: integer('quota_bytes').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const project_usages = sqliteTable(
  'project_usages',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, {
        onDelete: 'cascade',
        onUpdate: 'cascade',
      })
      .primaryKey(),
    usedBytes: integer('used_bytes').notNull(),
    lastUpdated: integer('last_updated', { mode: 'timestamp_ms' }).notNull(),
  },
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

export type ProjectUsage = typeof project_usages.$inferSelect;
export type NewProjectUsage = typeof project_usages.$inferInsert;
