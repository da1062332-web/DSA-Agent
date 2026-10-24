// Playwright config for the LIVE walkthrough (no mocks). Runs against the LOCAL Supabase stack only.
//
//   npm run test:e2e:live                       # headless, all live tests
//   npm run test:e2e:live -- -g TC-SE-LIVE-01   # one test, by its test ID
//   npm run test:e2e:live -- --headed           # watch the browser
//
// Setup (once): see e2e/LIVE-SETUP.md.
//
// This config starts its OWN API (port 3100) and web app (port 5180). It never reuses a server already running,
// so the hosted dev servers you may have open on 3000 and 5173 are not touched, and no test can reach them.
import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This file is an ES module, so use import.meta.url to find the repo root (there is no __dirname here).
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const API_ENV_FILE = 'apps/api/.env.e2e';
const WEB_PORT = 5180;
const API_PORT = 3100;

// Read the sales demo password from the local env file so it does not have to be typed each time.
// It is set only when SALES_PASSWORD is not already set in the shell.
function readLocalValue(key: string): string | undefined {
  const file = path.resolve(ROOT, API_ENV_FILE);
  if (!fs.existsSync(file)) return undefined;
  const line = fs.readFileSync(file, 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
  return line?.slice(key.length + 1);
}
if (!process.env.SALES_PASSWORD) process.env.SALES_PASSWORD = readLocalValue('DEMO_USER_PASSWORD') ?? '';
// Turns on the live specs. The normal config (playwright.config.ts) does not set this, so they stay skipped there.
process.env.E2E_LIVE = '1';

const headed = process.argv.includes('--headed') || process.env.HEADED === 'true';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'sales-executive-live.spec.ts',
  timeout: 240_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    headless: !headed,
    viewport: { width: 1536, height: 864 },
    // A short pause after each action in headed mode, so the walkthrough can be followed on screen.
    launchOptions: { slowMo: headed ? 400 : 0 },
  },
  webServer: [
    {
      // Local API on the local database. --env-file reads apps/api/.env.e2e, never apps/api/.env.
      // The command runs inside apps/api, so the file is named relative to that folder.
      command: 'npx tsx --env-file=.env.e2e src/server.ts',
      cwd: 'apps/api',
      url: `http://localhost:${API_PORT}/health`,
      reuseExistingServer: false,
      timeout: 90_000,
    },
    {
      // Local web app in Vite mode "e2e", which loads apps/web/.env.e2e (local Supabase + local API).
      command: `npx vite --mode e2e --port ${WEB_PORT} --strictPort`,
      cwd: 'apps/web',
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 90_000,
    },
  ],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1536, height: 864 } } }],
});
