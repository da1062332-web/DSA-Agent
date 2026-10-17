import { configDefaults, defineConfig } from 'vitest/config';

// Unit and API tests. Integration tests (*.int.spec.ts, need Docker) run with vitest.int.config.ts.
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    exclude: [...configDefaults.exclude, '**/*.int.spec.ts'],
    testTimeout: 30_000,
    // On a 12-CPU laptop that also runs Docker, one process per CPU ran the machine out of memory ("Worker exited unexpectedly" on 7 of 66 files,
    // 2026-10-17). Four processes pass 918/918 and cost little time.
    pool: 'forks',
    poolOptions: { forks: { minForks: 1, maxForks: 4 } },
  },
});
