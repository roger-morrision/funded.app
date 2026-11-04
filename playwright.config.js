import { defineConfig } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT || 4173);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/browser',
  globalSetup:'./scripts/browser-test-warmup.mjs',
  metadata: process.env.PLAYWRIGHT_AVAILABILITY_BASELINE_URL
    ? { availabilityBaselineURL: process.env.PLAYWRIGHT_AVAILABILITY_BASELINE_URL } : {},
  timeout: 30_000,
  expect: { timeout: 15_000 },
  workers: 1,
  use: { baseURL, headless: true,
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
    trace: 'retain-on-failure' },
  webServer: { command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort --configLoader native`, url: baseURL,
    reuseExistingServer: false, timeout:180_000,
    env: { VITE_API_BASE_URL: '/', VITE_SOLANA_CLUSTER: 'devnet', VITE_DEV_AUTOCONNECT: 'false',
      VITE_FUNDED_TOKEN_MINT: process.env.VITE_FUNDED_TOKEN_MINT || '',
      VITE_FUNDED_SWAP_POOL: process.env.VITE_FUNDED_SWAP_POOL || '',
      VITE_CACHE_DIR: 'tmp/playwright-vite-cache' } },
});
