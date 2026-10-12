import { configDefaults, defineConfig } from 'vitest/config';

// Unit and API tests. Integration tests (*.int.spec.ts, need Docker) run with vitest.int.config.ts.
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    exclude: [...configDefaults.exclude, '**/*.int.spec.ts'],
    testTimeout: 30_000,
  },
});
