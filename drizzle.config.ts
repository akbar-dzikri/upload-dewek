import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/lib/db/schema',
  out: './migrations',
  dialect: 'sqlite',
  strict: true,
  verbose: true,
});
