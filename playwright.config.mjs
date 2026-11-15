import { defineConfig } from '@playwright/test';

// Read-only smoke tests: open every public page without a wallet and check
// for script errors, failed API reads, cut-off figures and horizontal scroll.
// Target defaults to the live site; set SMOKE_BASE_URL for a local or staging build.
export default defineConfig({
  testDir: 'tests/smoke',
  testMatch: '*.spec.mjs',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  // Few workers keep the load on the public API low.
  workers: 2,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: process.env.SMOKE_BASE_URL || 'https://richpad.fun',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
});
