import { test, expect } from '@playwright/test';

const standard = 'CkRQTeLGEz2DMxRj3todCD1qtLb77vYBjAkCBMt814ky';
const premier = 'BHFsQA2xqgGXVuHeTngQY8t6mNaaHwVZdXcYuzigNAHK';
const pro = '4Xv96okULrtDtmoUYJfj3zkMv1da27hjvvoy9tAiBzZZ';
const row = (mint, name, marketCap = '1') => ({ mint, name, symbol: 'FEEQA', marketCap, stage: 'New' });

async function prepare(page, width) {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await page.route('https://**/*', route => route.abort());
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'Controlled offline fixture' } }));
  await page.goto('/#explore');
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await page.evaluate(rows => {
    window.__searchRows = rows;
    window.fundedVerifiedSearchCandidates = () => window.__searchRows;
  }, [row(standard, 'Fee standard QA'), row(premier, 'Fee premier QA'), row(pro, 'Fee pro QA')]);
  await page.locator('#header-search-trigger').click();
  const input = page.locator('#header-search-input');
  await input.fill('FEEQA');
  await expect(page.locator('#header-search-results [role=option]')).toHaveCount(3);
  return input;
}

async function updateIndex(page, rows) {
  await page.evaluate(next => {
    window.__searchRows = next;
    document.dispatchEvent(new Event('funded:verified-search-index'));
  }, rows);
}

async function expectSelection(page, input, mint, index) {
  await expect(input).toHaveAttribute('aria-activedescendant', `header-search-result-${index}`);
  const option = page.locator(`#header-search-result-${index}`);
  await expect(option).toHaveAttribute('href', `/token/${mint}`);
  await expect(option).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#header-search-results [aria-selected=true]')).toHaveCount(1);
  await expect(input).toBeFocused();
  expect(await option.evaluate(node => {
    const box = node.getBoundingClientRect();
    const list = node.closest('.header-search-results').getBoundingClientRect();
    return box.top >= list.top && box.bottom <= list.bottom && box.left >= 0 && box.right <= innerWidth;
  })).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const width of [390, 1440]) {
  test(`UX-011 passive reorder keeps selected mint, updates labels/ARIA and Enter URL at ${width}px (controlled index)`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const input = await prepare(page, width);
    await input.press('ArrowDown');
    await expectSelection(page, input, premier, 1);
    await updateIndex(page, [row(premier, 'Fee premier updated', '9'), row(standard, 'Fee standard QA'), row(pro, 'Fee pro QA')]);
    await expectSelection(page, input, premier, 0);
    await expect(page.locator('#header-search-result-0')).toContainText('Fee premier updated');
    await expect(page.locator('#header-search-result-0')).toContainText('9');
    await input.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/token/${premier}$`));
    expect(errors).toEqual([]);
  });

  test(`UX-011 removed choice clears selection, announces change and never opens replacement at ${width}px (controlled index)`, async ({ page }) => {
    const input = await prepare(page, width);
    await input.press('ArrowDown');
    await updateIndex(page, [row(standard, 'Fee standard QA'), row(pro, 'Fee pro QA')]);
    await expect(input).not.toHaveAttribute('aria-activedescendant');
    await expect(page.locator('#header-search-results [aria-selected=true]')).toHaveCount(0);
    await expect(page.locator('#header-search-help')).toContainText('selected result is no longer in the current list');
    await expect(input).toBeFocused();
    await input.press('Enter');
    await expect(page).toHaveURL(/#explore$/);
    await expect(page.locator('#explore-search')).toHaveValue('FEEQA');
    await expect(page.locator('#header-search-trigger')).toBeFocused();
  });

  test(`UX-011 empty update keeps no stale result; ArrowUp selects last returned option at ${width}px (controlled index)`, async ({ page }) => {
    const input = await prepare(page, width);
    await input.press('ArrowDown');
    await updateIndex(page, []);
    await expect(input).not.toHaveAttribute('aria-activedescendant');
    await expect(page.locator('#header-search-results [role=option]')).toHaveCount(0);
    await expect(page.locator('.header-search-empty')).toContainText('No matching tokens');
    await updateIndex(page, [row(standard, 'Fee standard QA'), row(pro, 'Fee pro QA')]);
    await expect(input).not.toHaveAttribute('aria-activedescendant');
    await expect(page.locator('#header-search-results [aria-selected=true]')).toHaveCount(0);
    await input.press('ArrowUp');
    await expectSelection(page, input, pro, 1);
    await input.press('ArrowDown');
    await expectSelection(page, input, standard, 0);
  });

  test(`UX-011 preserved option stays visible in a scrolling result list at ${width}px (controlled index)`, async ({ page }) => {
    const input = await prepare(page, width);
    const many = Array.from({ length: 8 }, (_, index) => row(String(index + 1).repeat(32), `Fee result ${index}`));
    await updateIndex(page, many);
    await input.fill('FEEQA');
    await input.press('ArrowUp');
    await expectSelection(page, input, many[7].mint, 7);
    await updateIndex(page, [many[7], ...many.slice(0, 7)]);
    await expectSelection(page, input, many[7].mint, 0);
    await updateIndex(page, [...many.slice(0, 7), many[7]]);
    await expectSelection(page, input, many[7].mint, 7);
  });

  test(`UX-011 query edits and reopening reset selection; pointer and Escape remain at ${width}px (controlled index)`, async ({ page }) => {
    const input = await prepare(page, width);
    await input.press('ArrowDown');
    await expectSelection(page, input, premier, 1);
    await input.fill('FEE');
    await expectSelection(page, input, standard, 0);
    await input.press('Escape');
    await expect(page.locator('#header-search-dialog')).toHaveJSProperty('open', false);
    await expect(page.locator('#header-search-trigger')).toBeFocused();
    await page.locator('#header-search-trigger').click();
    await expectSelection(page, input, standard, 0);
    await page.locator('#header-search-result-1').click();
    await expect(page).toHaveURL(new RegExp(`/token/${premier}$`));
  });

  test(`UX-011 no-match Enter keeps Explore fallback at ${width}px (controlled index)`, async ({ page }) => {
    const input = await prepare(page, width);
    await page.evaluate(() => { window.fundedVerifiedSearchCandidates = () => []; });
    await input.fill('NOMATCH');
    await expect(input).not.toHaveAttribute('aria-activedescendant');
    await input.press('Enter');
    await expect(page).toHaveURL(/#explore$/);
    await expect(page.locator('#explore-search')).toHaveValue('NOMATCH');
  });
}
