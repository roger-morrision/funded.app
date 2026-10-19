import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseWallet } from '../wallet-onboarding.js';

test('an immediate retry after cancelling the chooser opens a fresh dialog', async () => {
  const previousDocument = globalThis.document;
  const options = { replaceChildren() {} };
  const status = { textContent:'' };
  const network = { textContent:'' };
  const dialog = new EventTarget();
  let opens = 0;
  dialog.open = false;
  dialog.querySelector = selector => ({
    '#wallet-onboarding-options':options,
    '#wallet-onboarding-status':status,
    '#wallet-onboarding-network':network,
  })[selector];
  dialog.showModal = () => { dialog.open = true; opens++; };
  dialog.close = () => {
    dialog.open = false;
    setTimeout(() => dialog.dispatchEvent(new Event('close')), 0);
  };
  globalThis.document = { querySelector:() => dialog };
  try {
    const first = chooseWallet([]);
    assert.equal(opens, 1);
    assert.equal(chooseWallet([]), first, 'an open chooser still shares one choice');
    dialog.close();
    const retry = chooseWallet([]);
    assert.notEqual(retry, first, 'a closed chooser must not reuse the cancelled choice');
    assert.equal(await first, null);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(opens, 2);
    assert.equal(dialog.open, true);
    dialog.close();
    assert.equal(await retry, null);
  } finally { globalThis.document = previousDocument; }
});

test('a completed choice is not reopened by a click before the close event', async () => {
  const previousDocument = globalThis.document;
  const dialog = new EventTarget();
  let opens = 0, click;
  dialog.open = false;
  dialog.querySelector = selector => selector === '#wallet-onboarding-options'
    ? { replaceChildren() {} } : { textContent:'' };
  const add = dialog.addEventListener.bind(dialog);
  dialog.addEventListener = (type, listener, options) => {
    if (type === 'click') click = listener;
    add(type, listener, options);
  };
  dialog.showModal = () => { dialog.open = true; opens++; };
  dialog.close = () => { dialog.open = false; setTimeout(() => dialog.dispatchEvent(new Event('close')), 0); };
  globalThis.document = { querySelector:() => dialog };
  try {
    const first = chooseWallet([]);
    click({ target:{ closest:() => ({ dataset:{ walletChoice:'mobile' } }) } });
    const retry = chooseWallet([]);
    assert.deepEqual(await first, { mobile:true });
    assert.equal(await retry, null);
    assert.equal(opens, 1);
  } finally { globalThis.document = previousDocument; }
});
