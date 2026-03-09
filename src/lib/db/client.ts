import { drizzle } from 'drizzle-orm/d1';

import * as schema from './schema';

export const createDb = (database: D1Database) => {
  return drizzle(database, { schema });
};

export type DbClient = ReturnType<typeof createDb>;
