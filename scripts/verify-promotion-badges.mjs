import assert from 'node:assert/strict';
import { Keypair, Transaction } from '@solana/web3.js';
import { createBurnCheckedInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { createLaunchBurnTiers, tokensToBaseUnits } from '../launch-burn-policy.js';
import { verifyAtomicLaunchPromotion } from '../server/launch-verification.mjs';
import { verifiedPromotionBadge } from '../promotion-badge.js';
import { canonicalLaunchPolicy, launchPolicyStatement } from '../launch-policy-auth.js';

const payer = Keypair.generate().publicKey;
const fundedMint = Keypair.generate().publicKey;
const signature = 'test-creation-transaction';
const tiers = createLaunchBurnTiers();
const transactionFor = (owner, mint, amount, decimals = 6) => {
  const instruction = createBurnCheckedInstruction(getAssociatedTokenAddressSync(mint, owner), mint, owner, amount, decimals);
  const transaction = new Transaction().add(instruction);
  transaction.recentBlockhash = Keypair.generate().publicKey.toBase58();
  transaction.feePayer = payer;
  return { transaction: { message: transaction.compileMessage() } };
};
for (const tier of tiers.slice(1)) {
  const transaction = transactionFor(payer, fundedMint, tokensToBaseUnits(tier.amountTokens, 6));
  const claim = { tier: tier.id, amountTokens: tier.amountTokens, fundedMint: fundedMint.toBase58() };
  const promotion = verifyAtomicLaunchPromotion({ transaction, payer: payer.toBase58(), signature, claim, fundedMint: fundedMint.toBase58(), tiers });
  assert.equal(promotion.tier, tier.id);
  assert.equal(verifiedPromotionBadge({ onchainVerified: true, creatorLaunchBurn: promotion, signature }).tier, tier.id);
  assert.equal(verifiedPromotionBadge({ onchainVerified: false, creatorLaunchBurn: promotion, signature }), null);
  assert.equal(verifiedPromotionBadge({ onchainVerified: true, creatorLaunchBurn: promotion, signature: 'other' }), null);
  assert.throws(() => verifyAtomicLaunchPromotion({ transaction, payer: payer.toBase58(), signature, claim: { ...claim, tier: tier.id === 'premier' ? 'boost' : 'premier' }, fundedMint: fundedMint.toBase58(), tiers }), /matching|policy/);
  assert.throws(() => verifyAtomicLaunchPromotion({ transaction: transactionFor(Keypair.generate().publicKey, fundedMint, tokensToBaseUnits(tier.amountTokens, 6)), payer: payer.toBase58(), signature, claim, fundedMint: fundedMint.toBase58(), tiers }), /matching atomic/);
  assert.throws(() => verifyAtomicLaunchPromotion({ transaction: transactionFor(payer, Keypair.generate().publicKey, tokensToBaseUnits(tier.amountTokens, 6)), payer: payer.toBase58(), signature, claim, fundedMint: fundedMint.toBase58(), tiers }), /matching atomic/);
  assert.throws(() => verifyAtomicLaunchPromotion({ transaction: transactionFor(payer, fundedMint, 1n), payer: payer.toBase58(), signature, claim, fundedMint: fundedMint.toBase58(), tiers }), /matching atomic/);
}
assert.equal(verifiedPromotionBadge({ onchainVerified: true, signature, creatorLaunchBurn: { tier: 'standard', status: 'verified' } }), null);
assert.equal(verifyAtomicLaunchPromotion({ claim: { tier: 'standard' } }), null);

const policy = {
  mint: Keypair.generate().publicKey.toBase58(), creatorWallet: payer.toBase58(), cluster: 'devnet', signature,
  pumpFeeRoute: { router: Keypair.generate().publicKey.toBase58() }, communityAllocation: 5,
  feeDistribution: { creatorDirected: { shares: { creatorWalletPercent: 80, holderAirdropPercent: 0, solClaimPercent: 0 } } },
};
const standard = canonicalLaunchPolicy(policy);
assert.equal(standard.promotion, undefined);
const promoted = canonicalLaunchPolicy({ ...policy, creatorLaunchBurn: { tier: 'boost', amountTokens: 25_000, fundedMint: fundedMint.toBase58() } });
assert.deepEqual(promoted.promotion, { tier: 'boost', amountTokens: 25_000, fundedMint: fundedMint.toBase58() });
assert.notEqual(launchPolicyStatement(policy), launchPolicyStatement({ ...policy, creatorLaunchBurn: { tier: 'boost', amountTokens: 25_000, fundedMint: fundedMint.toBase58() } }));
assert.notEqual(launchPolicyStatement({ ...policy, creatorLaunchBurn: { tier: 'boost', amountTokens: 25_000, fundedMint: fundedMint.toBase58() } }), launchPolicyStatement({ ...policy, creatorLaunchBurn: { tier: 'pro', amountTokens: 100_000, fundedMint: fundedMint.toBase58() } }));
console.log('Promotion badges: signed package, atomic burn proof, badge gating, and spoof cases passed');
