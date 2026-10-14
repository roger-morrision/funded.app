import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { v3ReferralEntitlement, v3ReferralUpline } from '../server/v3-referral-entitlement.mjs';

const wallets = Array.from({ length:4 }, () => Keypair.generate().publicKey.toBase58());
const creatorWallet = wallets[0], qualifiedAt = 1_700_000_000;
const attributions = Object.fromEntries(wallets.slice(0, 3).map((wallet, index) =>
  [wallet, { wallet, inviterWallet:wallets[index + 1], lock:'first-touch',
    capturedAt:new Date(1_699_999_999_000).toISOString() }]));
const plan = { protocol:{ referralLamports:['300', '200', '100'] } };

test('three V3 referral levels follow the first-touch chain at the qualified fee event', () => {
  const referralUpline = v3ReferralUpline({ creatorWallet, attributions, qualifiedAt });
  assert.deepEqual(referralUpline, wallets.slice(1));
  for (let level = 1; level <= 3; level++) assert.deepEqual(
    v3ReferralEntitlement({ settlement:{ referralUpline }, plan, level }),
    { level, recipient:wallets[level], amount:plan.protocol.referralLamports[level - 1] });
});

test('late attribution, missing parent, self-link and invalid amount cannot create V3 entitlement', () => {
  assert.deepEqual(v3ReferralUpline({ creatorWallet, attributions:{}, qualifiedAt }), []);
  assert.deepEqual(v3ReferralUpline({ creatorWallet, attributions:{ [wallets[0]]:{
    ...attributions[wallets[0]], capturedAt:new Date(1_700_000_001_000).toISOString() } }, qualifiedAt }), []);
  assert.throws(() => v3ReferralUpline({ creatorWallet,
    attributions:{ [wallets[0]]:{ ...attributions[wallets[0]], inviterWallet:wallets[0] } }, qualifiedAt }), /self-link/);
  assert.equal(v3ReferralEntitlement({ settlement:{}, plan, level:1 }), null);
  assert.throws(() => v3ReferralEntitlement({ settlement:{ referralUpline:wallets.slice(1) },
    plan:{ protocol:{ referralLamports:['-1'] } }, level:1 }), /invalid/);
});
