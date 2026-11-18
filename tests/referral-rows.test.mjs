import test from 'node:test';
import assert from 'node:assert/strict';
import { referralRows } from '../server/referral-rows.mjs';

const ME = 'ER7zhtSwfSu7B5Wb7uFwnWSZPLMmezmSXieY5JyLFzXC';
const A = '2actLkQ1pTqv9YSm7Lw2m3sx7ZxW6QUaZ4hPJ8exKZrP';
const B = 'M1HfA8vPXwGGn8uv5p9BZSYjsh4jhxhoMfDx2sGsj4M';

const state = {
  referrals: { attributions: {
    [A]: { wallet: A, inviterWallet: ME, capturedAt: '2026-11-10T00:00:00Z', source: 'x' },
    [B]: { wallet: B, inviterWallet: A, capturedAt: '2026-11-12T00:00:00Z' } } },
  launches: { mintA: { creatorWallet: A }, mintA2: { creatorWallet: A } },
  v3Settlements: {
    sig1: { status: 'finalized', mint: 'mintA', grossCreatorFees: '2000000000', paid: true },
    sig2: { status: 'finalized', mint: 'mintA2', grossCreatorFees: '1000000000' },
    sig3: { status: 'pending', mint: 'mintA', grossCreatorFees: '9000000000' } },
  v3ReferralPayouts: { 'sig1:1': { recipient: ME, status: 'finalized', signature: 'pay', collectionSignature: 'sig1', level: 1, amount: '20000000' } },
};
const entitlement = ({ settlement, level }) => level === 1 ? { recipient: ME, amount: settlement.mint === 'mintA' ? '20000000' : '10000000' } : null;

test('referral rows carry join time, coins, fees and paid versus claimable bonus', () => {
  const rows = referralRows({ state, wallet: ME, network: [A, B], qualified: new Set([A]), entitlement });
  const a = rows.find(row => row.wallet === A), b = rows.find(row => row.wallet === B);
  assert.equal(a.level, 1); assert.equal(b.level, 2);
  assert.equal(a.joinedAt, '2026-11-10T00:00:00Z'); assert.equal(a.source, 'x');
  assert.equal(a.coinsCreated, 2);
  assert.equal(a.feesCollectedLamports, '3000000000');
  assert.equal(a.bonusPaidLamports, '20000000');
  assert.equal(a.bonusClaimableLamports, '10000000');
  assert.equal(b.coinsCreated, 0); assert.equal(b.bonusClaimableLamports, '0');
});
