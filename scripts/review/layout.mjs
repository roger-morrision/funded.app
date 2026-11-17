import { chromium } from '@playwright/test';
const base = process.env.REVIEW_BASE_URL || 'https://richpad.fun';
const routes = (process.argv[2] || '/#airdrops,/#buybacks,/#rewards,/#leaderboard,/#callouts,/#docs,/#analytics-detail,/,/#explore').split(',');
const browser = await chromium.launch();
for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  for (const route of routes) {
    const page = await browser.newPage({ viewport: vp });
    await page.addInitScript(() => { window.__cls = 0; window.__shifts = []; new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) { window.__cls += e.value; if (e.value > 0.05) window.__shifts.push([Math.round(e.startTime), +e.value.toFixed(2), e.sources.slice(0, 2).map(s => s.node ? (s.node.id ? '#' + s.node.id : s.node.tagName + '.' + String(s.node.className).split(' ')[0]) : '?').join(' ')]); } }).observe({ type: 'layout-shift', buffered: true }); });
    const t = Date.now();
    await page.goto(base + route, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.body.dataset.bootstrapState === 'ready', null, { timeout: 15000 }).catch(() => {});
    const ready = Date.now() - t;
    await page.waitForTimeout(5000);
    const r = await page.evaluate(() => ({ cls: +window.__cls.toFixed(3), shifts: window.__shifts.slice(0, 3), api: performance.getEntriesByType('resource').filter(e => e.name.includes('/api/')).length }));
    console.log(`${vp.width} ${route.padEnd(18)} ready=${ready}ms api=${r.api} cls=${r.cls} ${JSON.stringify(r.shifts)}`);
    await page.close();
  }
}
await browser.close();
