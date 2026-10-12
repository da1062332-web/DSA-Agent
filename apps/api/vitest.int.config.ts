import { defineConfig } from 'vitest/config';

// Integration tests: Testcontainers postgres:16 (Contracts §13). Requires a running Docker daemon.
export default defineConfig({
  test: {
    include: ['src/**/*.int.spec.ts', 'test/**/*.int.spec.ts'],
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
