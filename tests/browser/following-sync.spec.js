import { test, expect } from '@playwright/test';

const KEY = 'funded.creator.following';
const errors = new WeakMap();
test.beforeEach(async ({ page }) => {
  const found = []; errors.set(page, found); page.on('pageerror', error => found.push(error.message));
  await page.route('https://**/*', route => route.abort());
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: {} }));
});
test.afterEach(async ({ page }) => expect(errors.get(page), 'No uncaught browser errors').toEqual([]));

async function setup(page, local) {
  const state = { account: ['777', '888'], posts: [], holdAuth: false, authRoute: null, failAfterApply: false };
  await page.route('**/api/creator-support/me', route => {
    if (state.holdAuth) { state.authRoute = route; return; }
    return route.fulfill({ json: { csrf: 'offline-account-csrf', profile: { following: state.account } } });
  });
  await page.route('**/api/creator-support/preferences', async route => {
    const body = route.request().postDataJSON(); state.posts.push(body);
    state.account = body.following;
    if (state.failAfterApply) return route.fulfill({ status: 503, json: { error: 'Fixture response unavailable after account update' } });
    await route.fulfill({ json: { profile: { following: state.account } } });
  });
  if (local !== null) await page.addInitScript(({ key, local }) => localStorage.setItem(key, local), { key: KEY, local });
  await page.goto('/#community'); await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await expect(page.locator('#save-following')).toBeVisible(); return state;
}
const status = page => page.locator('#following-status');
const stored = page => page.evaluate(key => localStorage.getItem(key), KEY);
async function denyRead(page) {
  await page.evaluate(key => {
    const get = Storage.prototype.getItem;
    Storage.prototype.getItem = function (name) {
      if (this === localStorage && name === key) throw new DOMException('Fixture following read denied', 'SecurityError');
      return get.call(this, name);
    };
    window.qaRestoreFollowingStorage = () => { Storage.prototype.getItem = get; };
  }, KEY);
}

const invalid = [
  ['denied read', '["100","200"]'],
  ['malformed JSON', '{'],
  ['wrong shape', '{"following":["100"]}'],
  ['mixed invalid members', '["100","not-an-account"]'],
  ['more than 200 accounts', JSON.stringify(Array.from({ length: 201 }, (_, i) => String(i + 1)))],
  ['numeric account ID', '[100]'],
  ['missing local record', null],
];
for (const [label, local] of invalid) test(`account Following Save rejects ${label} without replacing remote or local data`, async ({ page }) => {
  const state = await setup(page, local); if (label === 'denied read') await denyRead(page);
  await page.locator('#save-following').click();
  await expect(status(page)).toContainText(label === 'missing local record' ? /Restore saved following or follow a creator/ : /Nothing was sent/i);
  await expect(status(page)).not.toContainText('Following saved to your X account');
  expect(state.posts).toEqual([]); expect(state.account).toEqual(['777', '888']);
  if (label === 'denied read') await page.evaluate(() => qaRestoreFollowingStorage());
  expect(await stored(page)).toBe(local);
  await page.locator('#community-preferences').screenshot({ path: test.info().outputPath(`following-${label.replaceAll(' ', '-')}.png`) });
});

test('an explicitly saved empty following list can intentionally clear the account list', async ({ page }) => {
  const state = await setup(page, '[]'); await page.locator('#save-following').focus(); await page.keyboard.press('Enter');
  await expect(status(page)).toContainText('Following saved to your X account');
  expect(state.posts).toEqual([{ following: [] }]); expect(state.account).toEqual([]); expect(await stored(page)).toBe('[]');
});

test('Following Save succeeds after explicit retry when local storage becomes readable', async ({ page }) => {
  const local = '["100","000200"]', state = await setup(page, local); await denyRead(page);
  await page.locator('#save-following').click(); await expect(status(page)).toContainText(/could not|cannot|unavailable/i);
  expect(state.posts).toEqual([]); expect(state.account).toEqual(['777', '888']);
  await page.evaluate(() => qaRestoreFollowingStorage()); await page.locator('#save-following').click();
  await expect(status(page)).toContainText('Following saved to your X account');
  expect(state.posts).toEqual([{ following: ['100', '000200'] }]); expect(state.account).toEqual(['100', '000200']);
  expect(await stored(page)).toBe(local);
});

test('Following Save uses the valid list captured by the initiating action while authentication is pending', async ({ page }) => {
  const state = await setup(page, '["100"]'); state.holdAuth = true;
  await page.locator('#save-following').click(); await expect.poll(() => Boolean(state.authRoute)).toBe(true);
  // A storage change while account lookup is unresolved must not replace the
  // specific list the user's already-started Save action captured.
  await page.evaluate(key => localStorage.setItem(key, '["200"]'), KEY);
  await state.authRoute.fulfill({ json: { csrf: 'offline-account-csrf', profile: { following: state.account } } });
  await expect(status(page)).toContainText('Following saved to your X account');
  expect(state.posts).toEqual([{ following: ['100'] }]); expect(state.account).toEqual(['100']);
  expect(await stored(page)).toBe('["200"]');
});


test('an account update followed by a failed response stays uncertain until an explicit retry', async ({ page }) => {
  const local = '["100","200"]', state = await setup(page, local); state.failAfterApply = true;
  await page.locator('#save-following').click();
  await expect(status(page)).toContainText('account save could not be confirmed');
  await expect(status(page)).toContainText('saved list may have changed');
  await expect(status(page)).not.toContainText(/not saved|Nothing was sent|Following saved to your X account/);
  expect(state.posts).toEqual([{ following: ['100', '200'] }]); expect(state.account).toEqual(['100', '200']);
  expect(await stored(page)).toBe(local); await expect(page.locator('#save-following')).toBeEnabled();
  await page.locator('#community-preferences').screenshot({ path: test.info().outputPath('following-save-uncertain.png') });
  // No automatic retry or rollback: another request requires a native action.
  expect(state.posts).toHaveLength(1); state.failAfterApply = false; await page.locator('#save-following').click();
  await expect(status(page)).toContainText('Following saved to your X account');
  expect(state.posts).toEqual([{ following: ['100', '200'] }, { following: ['100', '200'] }]);
  expect(await stored(page)).toBe(local);
});
