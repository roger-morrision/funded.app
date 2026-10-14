import test from 'node:test';
import assert from 'node:assert/strict';
import { v3RewardExperience } from '../server/v3-reward-experience.mjs';

const mint = '11111111111111111111111111111111';
const wallet = '22222222222222222222222222222222';
const source = '3'.repeat(64);
const payment = '4'.repeat(64);

test('V3 reward discovery excludes old launches and distinguishes allocations from finalized payments', () => {
  const launch = { mint, creator:wallet, creatorWallet:wallet, cluster:'devnet',
    onchainVerified:true, pumpFeeRoute:{ scope:'per-mint-v3', router:wallet,
      programId:wallet }, feeDistribution:{ creatorDirected:{ shares:{ holderAirdropPercent:20 } } } };
  const state = { launches:{ [mint]:launch, old:{ ...launch, mint:'old', pumpFeeRoute:{ scope:'per-mint-v2' } } },
    collections:{ [source]:{ signature:source, mint, cluster:'devnet', scope:'per-mint-v3',
      status:'collected', onchainVerified:true, programId:wallet, router:wallet,
      collectedLamports:'100' } },
    v3Settlements:{ [source]:{ status:'finalized', mint, allocationPlan:{
      status:'allocated-not-funded', grossLamports:'100',
      creatorDirected:{ walletLamports:'60', holderLamports:'15', xLamports:'5' },
      protocol:{ communityLamports:'10', buybackLamports:'10' } } } },
    v3CreatorRewardFunding:{ [source]:{ status:'finalized', balanceDeltaVerified:true } },
    v3XClaims:{ [source]:{ mint, status:'paid', wallet, amountLamports:'5',
      payment:{ signature:payment, finalized:true, balanceDeltaVerified:true } } },
  };
  const before = v3RewardExperience(state, {}, 'devnet');
  assert.equal(before.tokens.length, 1);
  assert.equal(before.tokens[0].totals.holder, '15');
  assert.equal(before.tokens[0].holderPaidLamports, '0');
  assert.equal(before.tokens[0].xPaidLamports, '5');
  const rewards = { schedules:{ holder:{ mint, kind:'holder', asset:'SOL', poolIds:[`v3:${source}`],
    payments:{ [wallet]:{ status:'paid', signature:payment, amount:'15',
      finalized:true, balanceDeltaVerified:true } } } } };
  const paid = v3RewardExperience(state, rewards, 'devnet', wallet);
  assert.equal(paid.tokens[0].holderPaidLamports, '15');
  assert.equal(paid.wallet.rows[0].payouts.length, 2);
  state.v3CreatorWalletPayout = { [source]: { status:'finalized', balanceDeltaVerified:true,
    collectionSignature:source, mint, programId:wallet, category:0, recipient:wallet,
    amount:'60', signature:'5'.repeat(64), finalizedAt:'2026-10-14T00:00:00Z' } };
  const creatorPaid = v3RewardExperience(state, rewards, 'devnet', wallet);
  assert.equal(creatorPaid.wallet.rows[0].payouts.find(row => row.kind === 'creator').amountLamports, '60');
  assert.equal(creatorPaid.wallet.rows[0].creatorWithoutPayoutProofLamports, '0');
  state.v3CreatorWalletPayout[source].recipient = mint;
  assert.equal(v3RewardExperience(state, rewards, 'devnet', wallet).wallet.rows[0].payouts.length, 2);
});
