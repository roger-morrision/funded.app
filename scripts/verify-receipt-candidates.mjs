import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { selectReceiptCandidates, RECEIPT_WINDOW } from '../server/receipt-candidates.mjs';
import { scopedCreatorState } from '../server/creator-state.mjs';
import { createStore } from '../server/store.mjs';

export function receiptFixture() {
  const state = { collections: {}, payouts: {}, obligations: {}, claims: {} };
  for (let n = 0; n < 40; n++) {
    const key = `r${String(n).padStart(2, '0')}`;
    state.collections[key] = { cluster: 'devnet', signature: key, status: 'collected', recordedAt: `2026-09-${String(n % 28 + 1).padStart(2, '0')}T00:00:00Z` };
    state.payouts[key] = { cluster: 'devnet', signature: `p${key}`, status: 'paid', obligationId: key, paidAt: state.collections[key].recordedAt };
    state.obligations[key] = { id: key, xUserId: n < 2 ? '123' : '456', claimSignature: key };
  }
  // Recent payout linked to the creator's oldest source collection.
  state.payouts.r00.paidAt = '2026-10-01T00:00:00Z';
  state.collections.wrong = { ...state.collections.r00, cluster: 'mainnet-beta' };
  state.payouts.pending = { ...state.payouts.r00, status: 'submitted' };
  state.payouts.malformed = { ...state.payouts.r00, signature: 123 };
  return state;
}

const fixture = receiptFixture();
const global = selectReceiptCandidates(fixture, 'devnet');
assert.equal(global.collections.length, RECEIPT_WINDOW);
assert.equal(global.coverage.recordedCollections, 40);
assert.equal(global.coverage.recordedPayouts, 40);
assert.ok(!global.collections.some(row => row.signature === 'r00'));
const owned = scopedCreatorState(fixture, '123', 'devnet');
const scoped = selectReceiptCandidates(owned, 'devnet', { creatorScoped: true });
assert.equal(scoped.scope, 'creator-recent');
assert.ok(scoped.collections.some(row => row.signature === 'r00'), 'Old source collection must accompany a recent payout.');
assert.equal(scoped.coverage.recordedCollections, 2);
assert.equal(scoped.coverage.recordedPayouts, 2);
const prioritized = selectReceiptCandidates(fixture, 'devnet', { creatorScoped: true });
assert.ok(prioritized.collections.some(row => row.signature === 'r00'));
assert.equal(selectReceiptCandidates(fixture, 'testnet').payouts.length, 0);
scoped.collections[0].signature = 'mutated';
assert.equal(fixture.collections.r00.signature, 'r00');
const dir = await mkdtemp(join(tmpdir(), 'funded-receipt-window-'));
try {
  const store = createStore(join(dir, 'state.json'), '');
  await store.update(state => Object.assign(state, fixture));
  assert.deepEqual(await store.readReceiptCandidates('devnet'), global);
} finally { await rm(dir, { recursive: true, force: true }); }
const reader = await readFile(new URL('../server/receipt-service.mjs', import.meta.url), 'utf8');
assert.ok(!reader.includes('store.read()'));
assert.match(reader, /createHash\('sha256'\).*JSON.stringify\(candidates\)/);
console.log('Receipt selection: bounded windows, creator isolation, old collection linkage and file parity passed (local-only).');
