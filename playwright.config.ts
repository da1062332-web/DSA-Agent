import { defineConfig, devices } from '@playwright/test';

const isHeaded = process.argv.includes('--headed') || process.env.HEADED === 'true';
const slowMoMs = process.env.SLOWMO ? parseInt(process.env.SLOWMO, 10) : 0;

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: {
    timeout: 20_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    headless: !isHeaded,
    launchOptions: {
      slowMo: slowMoMs,
    },
  },
  webServer: {
    command: 'npm run dev -w @dsa/web',
    port: 5173,
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
