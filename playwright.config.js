import { defineConfig } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT || 4173);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/browser',
  globalSetup:'./scripts/browser-test-server.mjs',
  metadata: process.env.PLAYWRIGHT_AVAILABILITY_BASELINE_URL
    ? { availabilityBaselineURL: process.env.PLAYWRIGHT_AVAILABILITY_BASELINE_URL } : {},
  timeout: 30_000,
  expect: { timeout: 15_000 },
  workers: 1,
  use: { baseURL, headless: true,
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
    trace: 'retain-on-failure' },
});
