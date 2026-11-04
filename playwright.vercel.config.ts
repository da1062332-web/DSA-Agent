import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.config';

const VERCEL_URL = 'https://dsa-agent-sand.vercel.app';

export default defineConfig({
  ...baseConfig,
  use: {
    ...baseConfig.use,
    baseURL: VERCEL_URL,
  },
  webServer: undefined,
});
