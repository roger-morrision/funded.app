import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 30_000,
  expect: { timeout: 15_000 },
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4173', headless: true,
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
    trace: 'retain-on-failure' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort --configLoader runner', url: 'http://127.0.0.1:4173', reuseExistingServer: false,
    env: { VITE_API_BASE_URL: '/', VITE_SOLANA_CLUSTER: 'devnet', VITE_DEV_AUTOCONNECT: 'false', VITE_CACHE_DIR: 'tmp/playwright-vite-cache' } },
});
