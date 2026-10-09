import test from 'node:test';
import assert from 'node:assert/strict';
import { createJackpotAlerts } from '../src/features/jackpot/alerts-controller.js';
import { activeRound, solAmount } from '../src/features/jackpot/round-state.js';

function fixture({ enabled = true, storageFails = false } = {}) {
  const fields = new Map();
  const element = () => ({ children: [], events: {}, textContent: '', hidden: false,
    append(child) { this.children.push(child); }, prepend(child) { this.children.unshift(child); },
    replaceChildren() { this.children = []; }, addEventListener(event, fn) { this.events[event] = fn; } });
  const section = { querySelector(selector) { if (!fields.has(selector)) fields.set(selector, element()); return fields.get(selector); } };
  let loaded = false, saved;
  const controller = createJackpotAlerts({ section, isLoaded: () => loaded,
    document: { createElement: element }, localStorage: {
      getItem: () => JSON.stringify({ enabled, seen: [] }),
      setItem(key, value) { if (storageFails) throw new Error('Storage blocked'); saved = JSON.parse(value); },
    } });
  return { controller, fields, get saved() { return saved; }, set loaded(value) { loaded = value; } };
}
const receipt = signature => ({ status: 'paid', cluster: 'devnet', signature: signature.repeat(64),
  winner: '1'.repeat(32), amountLamports: '1000000000' });
const data = history => ({ creator: { history }, trader: { history: [] } });

test('alerts seed historical receipts and only announce newly finalized results once', () => {
  const f = fixture();
  f.controller.update(data([receipt('2')]), false);
  assert.equal(f.fields.get('[data-jackpot-alert-list]').children.length, 0);
  assert.deepEqual(f.saved.seen, ['2'.repeat(64)]);
  f.loaded = true;
  f.controller.update(data([receipt('2'), receipt('3'), { ...receipt('4'), status: 'pending' }]), true);
  const rows = f.fields.get('[data-jackpot-alert-list]').children;
  assert.equal(rows.length, 1);
  assert.match(rows[0].textContent, /Creator result.*1.0 SOL/);
  assert.match(rows[0].children[0].href, /^https:\/\/explorer.solana.com\/tx\//);
  f.controller.update(data([receipt('3')]), true);
  assert.equal(rows.length, 1);
});

test('blocked device storage leaves alert opt-in disabled', () => {
  const f = fixture({ enabled: false, storageFails: true });
  const toggle = f.fields.get('[data-jackpot-alert-toggle]');
  toggle.checked = true; toggle.events.change();
  assert.equal(toggle.checked, false);
  assert.match(f.fields.get('[data-jackpot-alert-status]').textContent, /could not be enabled/);
});

test('round eligibility retains all funding, publication and entry gates', () => {
  const ready = { payoutEnabled: true, fundingVerified: true, rulesPublished: true,
    eligibilityApproved: true, fundedLamports: '1', entries: 1 };
  assert.equal(activeRound(ready), true);
  for (const field of ['payoutEnabled', 'fundingVerified', 'rulesPublished', 'eligibilityApproved']) {
    assert.equal(activeRound({ ...ready, [field]: false }), false);
  }
  assert.equal(activeRound({ ...ready, fundedLamports: '0' }), false);
  assert.equal(activeRound({ ...ready, entries: 0 }), false);
  assert.equal(solAmount('1'), '0.000000001 SOL');
  assert.equal(solAmount('-1'), 'unavailable');
});
