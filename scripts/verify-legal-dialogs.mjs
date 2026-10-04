import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const dialogMarkup = html.split('\n').find(line => line.includes('id="info-dialog"'));
const dialogStart = app.indexOf('const infoDialogRoutes = new Set(');
const dialogEnd = app.indexOf('function openFilterDialog(', dialogStart);
const handlerStart = app.indexOf("document.querySelector('#info-close').addEventListener('click', closeInfoDialog);");
const handlerEnd = app.indexOf("document.querySelectorAll('[data-close-dialog]')", handlerStart);
assert(dialogMarkup && dialogStart >= 0 && dialogEnd > dialogStart && handlerStart >= 0 && handlerEnd > handlerStart,
  'Legal dialog markup and handlers must be present.');

// Exercise the production dialog markup and handlers without loading an API, wallet, or app server.
const fixture = `<!doctype html><html><body>${dialogMarkup}<script>
function syncPageRoute() {}
${app.slice(dialogStart, dialogEnd)}
${app.slice(handlerStart, handlerEnd)}
openInfoDialog(location.hash.slice(1), { routeDriven: true });
</script></body></html>`;
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chrome' }), headless: true });
try {
  const context = await browser.newContext();
  await context.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    return url.hostname === '127.0.0.1' && request.method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'text/html', body: fixture })
      : route.abort();
  });
  const page = await context.newPage();
  for (const [route, title] of [['terms', 'Terms of Use'], ['disclosures', 'Disclosures'], ['opt-out', 'Opt out']]) {
    await page.goto(`http://127.0.0.1:5189/${route}#${route}`);
    const modal = page.getByRole('dialog', { name: title });
    await modal.waitFor({ state: 'visible', timeout: 5000 });
    await page.keyboard.press('Escape');
    await modal.waitFor({ state: 'hidden', timeout: 5000 });
    assert.equal(new URL(page.url()).hash, '#overview', `${route} must leave the closed dialog route`);
  }
  console.log('Legal dialog names and Escape routes passed (mocked source-backed browser).');
} finally {
  await browser.close();
}
