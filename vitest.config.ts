import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      thresholds: {
        statements: 85,
        branches: 70,
        functions: 75,
        lines: 80,
      },
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/worker-configuration.d.ts', 'tests/**'],
    },
  },
});
