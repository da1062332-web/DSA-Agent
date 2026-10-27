import { defineConfig, devices } from '@playwright/test';

if (process.argv.includes('--headed') || process.env.HEADED === 'true') {
  process.env.HEADED = 'true';
}

const isHeaded = process.env.HEADED === 'true';

// Human-paced slowMo for headed demo:
// Default 650ms allows the user to clearly see and read each click, form fill, and UI state change.
// If the SLOWMO env var is provided, clamp between 150ms and 1000ms to stay human-paced without timing out.
function getSlowMo(): number {
  if (!isHeaded) return 0;
  if (process.env.SLOWMO) {
    const custom = parseInt(process.env.SLOWMO, 10);
    if (!isNaN(custom)) {
      return Math.min(Math.max(custom, 50), 1000);
    }
  }
  return 100; // Snappy, clear human demonstration pace (~0.1s per action)
}

const slowMoMs = getSlowMo();

export default defineConfig({
  testDir: './e2e',
  timeout: 600_000,
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
    viewport: isHeaded ? null : { width: 1536, height: 864 },
    launchOptions: {
      slowMo: slowMoMs,
      args: isHeaded ? ['--start-maximized'] : [],
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
      use: isHeaded
        ? {
            viewport: null,
          }
        : {
            viewport: { width: 1536, height: 864 },
          },
    },
  ],
});
