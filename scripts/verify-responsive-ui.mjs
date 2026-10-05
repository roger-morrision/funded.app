import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5173';
const channel = process.env.UI_BROWSER_CHANNEL || 'chrome';
const evidenceDir = process.env.UI_EVIDENCE_DIR ? resolve(process.env.UI_EVIDENCE_DIR) : '';
const mint = '9Dp8MYwvFTAwoMtxaXvAZjZyjsWUbuXGp15z8EkZzu1B';
const routes = [
  '/#overview', '/#explore', '/#launch', '/#my-launches', '/#payments',
  '/#analytics-detail', '/#referrals', '/#community', '/#leaderboard',
  '/#airdrops', '/#buybacks', '/#capital-flow', '/#docs', '/#profile',
  '/#privacy', '/#paid', '/#list', '/#pilot', `/token/${mint}`,
];
const widths = [320, 390, 768, 1280];
if (evidenceDir) await mkdir(evidenceDir, { recursive: true });
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel }), headless: true });
const failures = [];
const observations = [];

try {
  for (const width of widths) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      reducedMotion: 'reduce',
      isMobile: width < 768,
      hasTouch: width < 1024,
    });
    await context.addInitScript(() => sessionStorage.setItem('funded.app.wallet.manual-disconnect', '1'));
    await context.route('**/api/**', route => route.request().method() === 'GET'
      ? route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
      : route.fulfill({ status: 403, body: 'Read-only responsive verification' }));
    await context.route('https://**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.fallback() : route.abort());
    for (const route of routes) {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('body.workspace-ready', { timeout: 20000 });
        const state = await page.evaluate(() => {
          const visible = element => {
            const css = getComputedStyle(element);
            return css.display !== 'none' && css.visibility !== 'hidden' && element.getBoundingClientRect().width > 0;
          };
          const overflow = [...document.querySelectorAll('body *')]
            .filter(visible)
            .map(element => ({ element, box: element.getBoundingClientRect() }))
            .filter(({ box }) => box.right > innerWidth + 2 || box.left < -2)
            .slice(0, 5)
            .map(({ element, box }) => ({ tag: element.tagName, id: element.id, className: String(element.className).slice(0, 80), left: Math.round(box.left), right: Math.round(box.right) }));
          return {
            viewport: innerWidth,
            document: document.documentElement.scrollWidth,
            mainWidth: document.querySelector('#main-content')?.getBoundingClientRect().width,
            overflow,
          };
        });
        observations.push({ route, width, ...state, errors });
        if (state.document > state.viewport + 1 || !state.mainWidth || errors.length) {
          failures.push({ route, width, ...state, errors });
        }
        if (route === '/#payments') {
          assert.equal(await page.locator('#rewards-overview .reward-entry-grid').isVisible(), false);
          assert.equal(await page.locator('#reward-portfolio .reward-portfolio-links > a:visible').count(), 3);
        }
        if (route === '/#community') {
          assert(await page.locator('#community-title').isVisible());
          assert.equal(await page.locator('#my-launches > .portfolio-dashboard').isVisible(), false);
          assert(await page.locator('#community-preferences').evaluate(element => element.parentElement?.id === 'community'));
        }
        if (route === '/#capital-flow') {
          assert.equal(await page.locator('#route-guide').isVisible(), false);
          assert(await page.locator('#capital-flow-title').isVisible());
        }
        if (width === 320 && route.startsWith('/token/')) {
          const tokenLayout = await page.evaluate(() => {
            const heading = document.querySelector('#coin-chart-heading').getBoundingClientRect();
            const badge = document.querySelector('.coin-chart-panel .data-badge').getBoundingClientRect();
            const actions = [...document.querySelectorAll('.coin-socials.is-compact :is(a,button)')]
              .filter(element => getComputedStyle(element).display !== 'none')
              .map(element => element.getBoundingClientRect());
            const tradeButton = document.querySelector('.mobile-trade-open');
            const tradeBox = tradeButton.getBoundingClientRect();
            const chartBox = document.querySelector('.coin-chart-panel').getBoundingClientRect();
            return { headingBottom: heading.bottom, badgeTop: badge.top, actionWidths: actions.map(box => box.width), actionHeights: actions.map(box => box.height), tradePosition: getComputedStyle(tradeButton).position, tradeBottom: tradeBox.bottom, chartTop: chartBox.top };
          });
          assert(tokenLayout.badgeTop >= tokenLayout.headingBottom, 'Narrow token chart heading and badge should stack');
          assert(tokenLayout.actionWidths.every(size => size >= 40), 'Token action touch targets should be at least 40px wide');
          assert(tokenLayout.actionHeights.every(size => size >= 40), 'Token action touch targets should be at least 40px tall');
          assert.equal(tokenLayout.tradePosition, 'static', 'Mobile trade action should participate in page layout');
          assert(tokenLayout.tradeBottom <= tokenLayout.chartTop, 'Mobile trade action should not cover the chart');
          assert.equal(await page.locator('.mobile-trade-open').innerText(), 'View trade status', 'Unavailable token data must not invite a trade');
          await page.locator('.mobile-trade-open').click();
          assert(await page.locator('#coin-page').evaluate(element => element.classList.contains('trade-sheet-open')), 'Mobile trade sheet should open');
          await page.locator('.mobile-trade-close').click();
          assert.equal(await page.locator('.mobile-trade-open').getAttribute('aria-expanded'), 'false', 'Mobile trade sheet should close');
        }
        if (evidenceDir && [320, 768, 1280].includes(width) && ['/#overview', '/#explore', `/token/${mint}`].includes(route)) {
          const key = route.startsWith('/token/') ? 'token' : route.slice(2);
          await page.screenshot({ path: resolve(evidenceDir, `${key}-${width}.png`), fullPage: false });
        }
        if (width === 390 && route === '/#overview') {
          const menu = page.locator('#open-menu');
          assert(await menu.isVisible(), 'Mobile menu trigger should be visible');
          await menu.click();
          assert(await page.locator('#sidebar').isVisible(), 'Mobile navigation should open');
          await page.locator('#menu-backdrop').click({ position: { x: 380, y: 100 } });
          assert.equal(await menu.getAttribute('aria-expanded'), 'false', 'Mobile navigation should close');
        }
      } catch (error) {
        failures.push({ route, width, error: error.message });
      } finally {
        await page.close();
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify({ mode: 'mocked API; read-only', target: base, browser: channel, checked: observations.length, failures }, null, 2));
assert.equal(failures.length, 0, 'Responsive UI failures');
