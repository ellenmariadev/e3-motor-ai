import { defineConfig } from 'vitest/config';

process.env.NODE_ENV = 'test';
process.env.LLM_PROVIDER = 'mock';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`. Requires Vite 8, which ships this option.
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
    pool: 'forks',
    maxWorkers: 1,
    isolate: false,
    sequence: { concurrent: false },
  },
});
