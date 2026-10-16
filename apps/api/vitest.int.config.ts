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
  },
});
