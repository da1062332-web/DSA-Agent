import { defineConfig } from 'vitest/config';

// TEST-SEC-001 (owner: Dev 1). Testcontainers postgres:16 — needs Docker. Run: npm run test:isolation
export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ['inventory.spec.ts', 'cases/**/*.spec.ts'],
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
