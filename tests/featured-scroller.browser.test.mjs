import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const fixture = `<link rel="stylesheet" href="/styles/pages/workspace-polish.css">
  <main id="main-content"><section class="home-featured">
    <div class="home-featured-heading"><h2>Featured tokens</h2>
      <button data-featured-pause>Pause</button></div>
    <div class="home-featured-viewport" tabindex="0"><div class="home-featured-track"></div></div>
  </section></main>`;

for (const mobile of [false, true]) {
  test(`featured scrolling resumes with the play button focused (${mobile ? 'touch' : 'desktop'})`, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: mobile ? 390 : 1280, height: 800 },
        isMobile: mobile, hasTouch: mobile, reducedMotion: 'no-preference',
      });
      page.setDefaultTimeout(5000);
      await page.route('**/*', async route => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/') return route.fulfill({ contentType: 'text/html', body: fixture });
        const body = await readFile(new URL(`..${path}`, import.meta.url));
        await route.fulfill({ contentType: path.endsWith('.css') ? 'text/css' : 'text/javascript', body });
      });
      await page.goto('http://featured.test/');
      const render = () => page.evaluate(async () => {
        const { createFeaturedScroller } = await import('/src/features/home/featured-view.js');
        createFeaturedScroller(document.querySelector('.home-featured')).render([
          { mint: '11111111111111111111111111111111', name: 'Fixture', symbol: 'TEST', label: 'Paid listing' },
        ], 'devnet');
      });
      await render();
      const viewport = page.locator('.home-featured-viewport');
      const button = page.locator('[data-featured-pause]');
      const position = () => viewport.evaluate(node => node.scrollLeft);
      const advances = async () => {
        const before = await position();
        await page.waitForFunction(before => document.querySelector('.home-featured-viewport').scrollLeft > before + 8, before, { timeout: 2500 });
      };
      const stays = async () => {
        await page.waitForTimeout(100);
        const before = await position();
        await page.waitForTimeout(250);
        assert.equal(await position(), before);
      };
      await advances();
      const activate = () => mobile ? button.tap() : button.click();
      await activate();
      assert.equal(await button.textContent(), 'Play');
      await stays();
      await activate();
      await button.focus();
      assert.equal(await button.textContent(), 'Pause');
      // Keep focus (and the desktop pointer) on Play/Pause, as in the reported bug.
      await advances();
      await page.mouse.move(0, 0);
      await page.locator('.home-featured-token').first().focus();
      await stays();
      await button.focus();
      await advances();
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.reload();
      await render();
      assert.equal(await button.isDisabled(), true);
      await stays();
    } finally {
      await browser.close();
    }
  });
}
