import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5173';
const routes = ['overview', 'explore', 'launch', 'list', 'payments', 'analytics-detail', 'my-launches', 'community', 'referrals', 'leaderboard', 'airdrops', 'buybacks', 'capital-flow', 'docs', 'profile', 'privacy', 'paid', 'funded-holder-token-rewards'];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
await context.addInitScript(() => sessionStorage.setItem('funded.app.wallet.manual-disconnect', '1'));
await context.route('**/api/**', route => route.request().method() === 'GET' ? route.continue() : route.fulfill({ status: 403, body: 'Read-only audit' }));
const page = await context.newPage();
const report = [];
for (const route of routes) {
  await page.goto(`${base}/#${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('body.workspace-ready');
  const pageReport = await page.evaluate(() => {
    const visible = element => {
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
    };
    const sections = [...document.querySelectorAll('main section')].filter(visible);
    return sections.map(element => {
      const headings = [...element.querySelectorAll('h1,h2,h3')].filter(visible).map(heading => heading.textContent.trim()).slice(0, 4);
      const paragraphs = [...element.querySelectorAll('p,small,li')].filter(visible);
      const text = element.innerText.replace(/\s+/g, ' ').trim();
      return { selector: element.id ? `#${element.id}` : `.${[...element.classList].slice(0, 2).join('.')}`, headings, chars: text.length, paragraphs: paragraphs.length, text: text.slice(0, 160) };
    });
  });
  report.push({ route, sections: pageReport });
}
await writeFile(process.env.UI_DENSITY_OUTPUT || '.tmp-ui-evidence/content-density.json', JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report.map(({ route, sections }) => ({ route, sections: sections.length, largest: sections.sort((a, b) => b.chars - a.chars).slice(0, 8).map(({ selector, chars, headings }) => ({ selector, chars, headings })) })), null, 2));
