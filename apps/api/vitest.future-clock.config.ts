import path from 'node:path';
import { configDefaults, defineConfig } from 'vitest/config';

// The unit suite under a shifted clock (see test/support/future-clock.setup.ts). Same includes as vitest.config.ts.
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    exclude: [...configDefaults.exclude, '**/*.int.spec.ts'],
    setupFiles: [path.resolve(import.meta.dirname, 'test/support/future-clock.setup.ts')],
    testTimeout: 30_000,
  },
});
