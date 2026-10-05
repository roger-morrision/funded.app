import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenCardData, tokenCardEvidenceLabel, formatPolicyTokenCount } from '../token-card-data.js';

const mint = '9Dp8MYwvFTAwoMtxaXvAZjZyjsWUbuXGp15z8EkZzu1B';
test('recorded policy stays distinct from a current market check', () => {
  const card = tokenCardData({ mint, policy: { mint, onchainVerified: true, symbol: 'FCQA', creatorWallet: mint } });
  assert.equal(card.policyState, 'recorded');
  assert.equal(card.marketState, 'unavailable');
  assert.match(tokenCardEvidenceLabel(card), /market check unavailable/);
  assert.equal(card.launchWallet, mint);
});
test('market and reserve checks require the same mint; receipt state stays explicit', () => {
  const other = '9SUJzZRCJXTuh8hyxA8Az9J2Ph7zXbf52mJuZ9tMFPm4';
  const card = tokenCardData({ mint, market: { address: other }, reserve: { mint: other, verified: true }, receipts: { status: 'partial' } });
  assert.equal(card.marketState, 'unavailable');
  assert.equal(card.reserveState, 'unverified');
  assert.equal(card.receiptState, 'partial');
  const verified = tokenCardData({ mint, market: { address: mint, verifiedAt: '2026-10-05T06:52:29Z' } });
  assert.equal(tokenCardEvidenceLabel(verified), 'Market data verified');
});
test('policy token counts fail closed outside safe integer precision', () => {
  assert.equal(formatPolicyTokenCount('30000000'), '30,000,000');
  assert.equal(formatPolicyTokenCount('9007199254740992'), '—');
  assert.equal(formatPolicyTokenCount('1.5'), '—');
});
