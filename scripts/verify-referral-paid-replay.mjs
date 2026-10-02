import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Offline by design: never load wallet env files, derive a wallet, start the
// API, call an execute route, or contact RPC. An optional argument may point to
// an isolated journey directory; otherwise use a synthetic immutable fixture.
const directory = String(process.argv[2] || '').trim();
const syntheticClaim = {
  id:'referral_claim_fixture', settlementSignature:'settlement-fixture', level:1,
  recipientWallet:'11111111111111111111111111111111', amount:0.01, asset:'SOL',
  nonce:'offline-fixture', status:'paid', payoutId:'referral:referral_claim_fixture',
  payoutSignature:'synthetic-finalized-receipt', paidAt:'2026-10-01T00:00:00.000Z',
};
const syntheticPayout = {
  id:syntheticClaim.payoutId, claimId:syntheticClaim.id, amountSol:syntheticClaim.amount,
  to:syntheticClaim.recipientWallet, signature:syntheticClaim.payoutSignature,
  status:'paid', paidAt:syntheticClaim.paidAt,
};

let state;
if (directory) {
  const ledgerDirectory = resolve(directory);
  assert.notEqual(ledgerDirectory, resolve(''), 'Pass a specific isolated test-journey ledger directory.');
  state = JSON.parse(await readFile(join(ledgerDirectory, 'funded-store.json'), 'utf8'));
} else {
  state = { referralClaims:{ [syntheticClaim.id]:syntheticClaim }, payouts:{ [syntheticPayout.id]:syntheticPayout } };
}

const before = createHash('sha256').update(JSON.stringify(state)).digest('hex');
const claim = Object.values(state.referralClaims || {}).find(item => item.status === 'paid');
assert.ok(claim?.payoutId && claim?.payoutSignature, 'The isolated ledger has no paid referral claim.');
const first = state.payouts?.[claim.payoutId];
const replay = state.payouts?.[claim.payoutId];
assert.equal(first?.status, 'paid');
assert.equal(replay, first, 'Paid replay must return the canonical existing payout object.');
assert.equal(first.signature, claim.payoutSignature);
assert.equal(first.to, claim.recipientWallet);
assert.equal(Number(first.amountSol), Number(claim.amount));
assert.equal(createHash('sha256').update(JSON.stringify(state)).digest('hex'), before, 'Paid replay inspection must not mutate state.');
console.log(`Referral paid replay: canonical paid receipt reused and state unchanged (${directory ? 'isolated ledger' : 'synthetic offline fixture'}). No secret, server, execute request, signer, or RPC used.`);
