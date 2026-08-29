import { drizzle } from 'drizzle-orm/d1';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import * as schema from './schema';

export const createDb = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  database: D1Database | BetterSQLite3Database<any>,
) => {
  // Allow passing an already-instantiated drizzle client (for tests with better-sqlite3)
  if (database && typeof (database as unknown as { insert?: unknown }).insert === 'function') {
    return database as unknown as ReturnType<typeof drizzle>;
  }
  return drizzle(database as D1Database, { schema });
};

export type DbClient = ReturnType<typeof createDb>;
