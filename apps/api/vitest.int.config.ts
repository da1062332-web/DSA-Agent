import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Integration tests: Testcontainers postgres:16 (Contracts §13). Requires a running Docker daemon.
// The guard refuses any connection to a non-local host, so no test can reach the hosted database by accident.
export default defineConfig({
  test: {
    setupFiles: [path.resolve(import.meta.dirname, '../../tests/guard/no-hosted-db.ts')],
    // One local container exported as DATABASE_URL / VERIFY_DATABASE_URL, for the specs written against the hosted database.
    globalSetup: [path.resolve(import.meta.dirname, '../../tests/guard/local-db.global-setup.ts')],
    include: ['src/**/*.int.spec.ts', 'test/**/*.int.spec.ts'],
    testTimeout: 120_000,
    hookTimeout: 180_000,
    // Every spec file starts its own PostgreSQL container. With one process per CPU (12 here) on a 7.6 GiB Docker VM, a file that takes
    // 6 s alone took 90 s and the host ran out of memory when six suites overlapped (measured 2026-10-17); four processes finish the
    // suite in the same wall time with about a third of that per-file slowdown.
    pool: 'forks',
    poolOptions: { forks: { minForks: 1, maxForks: 4 } },
  },
});
