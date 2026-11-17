// Review capture: every public page at desktop and phone width. Saves a
// full-page screenshot plus load timing, request counts, duplicate API reads,
// transfer size, console errors and long-task time to tmp/review/out.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const BASE = process.env.REVIEW_BASE_URL || 'https://richpad.fun';
const OUT = pathToFileURL(resolve('tmp/review/out') + '/');
const only = process.argv[2] ? new Set(process.argv[2].split(',')) : null;
const ROUTES = [
  ['home', '/'], ['explore', '/#explore'], ['top100', '/#top100'], ['portfolio', '/#portfolio'],
  ['rewards', '/#rewards'], ['callouts', '/#callouts'], ['creators', '/#creators'], ['referrals', '/#referrals'],
  ['bonuses', '/#bonuses'], ['airdrops', '/#airdrops'], ['leaderboard', '/#leaderboard'], ['list', '/#list'],
  ['buybacks', '/#buybacks'], ['docs', '/#docs'], ['analytics', '/#analytics-detail'], ['disclosures', '/#disclosures'],
  ['terms', '/#terms'], ['privacy', '/#privacy'],
  ['token-rich', '/token/Bv1a7cEj5aRnJQhMw4kRQqAFesMSd5LwcDnUzq52BMmr'],
  ['token-ext', '/token/77HqxiDCgYfXUsDXDD6YVefPhTTz1Z2n8jX4gTxipump'],
  ['wallet', '/wallet/ER7zhtSwfSu7B5Wb7uFwnWSZPLMmezmSXieY5JyLFzXC'],
];
const VIEWPORTS = { desktop: { width: 1280, height: 800 }, phone: { width: 390, height: 844, isMobile: true, hasTouch: true } };

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const results = [];
for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
  const { width, height, ...rest } = vp;
  const context = await browser.newContext({ viewport: { width, height }, ...rest });
  for (const [name, path] of ROUTES) {
    if (only && !only.has(name)) continue;
    const page = await context.newPage();
    const requests = [], errors = [];
    page.on('requestfinished', async request => {
      const sizes = await request.sizes().catch(() => null);
      const response = await request.response().catch(() => null);
      requests.push({ url: request.url(), type: request.resourceType(), status: response?.status() ?? 0, bytes: sizes ? sizes.responseBodySize + sizes.responseHeadersSize : 0 });
    });
    page.on('requestfailed', request => errors.push(`failed ${request.url()} ${request.failure()?.errorText}`));
    page.on('console', message => { if (message.type() === 'error') errors.push(`console ${message.text().slice(0, 200)}`); });
    page.on('pageerror', error => errors.push(`pageerror ${error.message.slice(0, 200)}`));
    await page.addInitScript(() => {
      window.__lt = 0; window.__lcp = 0; window.__cls = 0;
      new PerformanceObserver(list => { for (const e of list.getEntries()) window.__lt += Math.max(0, e.duration - 50); }).observe({ type: 'longtask', buffered: true });
      new PerformanceObserver(list => { for (const e of list.getEntries()) window.__lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver(list => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
    });
    const started = Date.now();
    await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(error => errors.push(`goto ${error.message}`));
    await page.waitForTimeout(7000);
    const metrics = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      return { dcl: Math.round(nav?.domContentLoadedEventEnd || 0), load: Math.round(nav?.loadEventEnd || 0), lcp: Math.round(window.__lcp), longTasks: Math.round(window.__lt), cls: +window.__cls.toFixed(3),
        domNodes: document.getElementsByTagName('*').length, hscroll: document.documentElement.scrollWidth - innerWidth, title: document.title };
    }).catch(() => ({}));
    await page.screenshot({ path: fileURLToPath(new URL(`${vpName}-${name}.jpg`, OUT)), fullPage: true, type: 'jpeg', quality: 55 }).catch(() => {});
    const api = requests.filter(r => new URL(r.url).pathname.startsWith('/api/'));
    const counts = {};
    for (const r of api) { const key = new URL(r.url).pathname + new URL(r.url).search; counts[key] = (counts[key] || 0) + 1; }
    results.push({ vp: vpName, name, ...metrics, ms: Date.now() - started, requests: requests.length, apiRequests: api.length,
      kb: Math.round(requests.reduce((s, r) => s + r.bytes, 0) / 1024), jsKb: Math.round(requests.filter(r => r.type === 'script').reduce((s, r) => s + r.bytes, 0) / 1024),
      imgKb: Math.round(requests.filter(r => r.type === 'image').reduce((s, r) => s + r.bytes, 0) / 1024),
      dupes: Object.entries(counts).filter(([, n]) => n > 1).map(([k, n]) => `${n}x ${k}`),
      bad: requests.filter(r => r.status >= 400).map(r => `${r.status} ${new URL(r.url).pathname}`), errors: errors.slice(0, 8) });
    await page.close();
  }
  await context.close();
}
await browser.close();
await writeFile(new URL('summary.json', OUT), JSON.stringify(results, null, 1));
for (const r of results) console.log(`${r.vp.padEnd(7)} ${r.name.padEnd(12)} lcp=${r.lcp} lt=${r.longTasks} cls=${r.cls} req=${r.requests} api=${r.apiRequests} kb=${r.kb} js=${r.jsKb} img=${r.imgKb} dom=${r.domNodes} hs=${r.hscroll} dupes=${r.dupes.length} bad=${r.bad.length} err=${r.errors.length}`);
