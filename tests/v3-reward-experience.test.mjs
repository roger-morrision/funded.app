import test from 'node:test';
import assert from 'node:assert/strict';
import { v3RewardExperience } from '../server/v3-reward-experience.mjs';
import {allocationAuditHash as bonusHash} from '../server/allocation-audit-hash.mjs';
import {residualSourceKey} from '../server/v3-residual-source.mjs';

const mint = '11111111111111111111111111111111';
const wallet = '22222222222222222222222222222222';
const source = '3'.repeat(64);
const payment = '4'.repeat(64);

test('audited supplemental wallet, holder and X receipts remain visible under their original mint without counting funding as payment',()=>{
  const launch={mint,creator:wallet,creatorWallet:wallet,cluster:'devnet',onchainVerified:true,
    pumpFeeRoute:{scope:'per-mint-v3',router:wallet,programId:wallet}};
  const original={mint,programId:wallet,status:'allocated-not-funded',grossLamports:'100',
    creatorDirected:{walletLamports:'60',holderLamports:'15',xLamports:'5'},protocol:{communityLamports:'10',buybackLamports:'10'}};
  const target={...original,allocationVersion:2,creatorDirected:{walletLamports:'61',holderLamports:'14',xLamports:'5'}};
  const auditSource={collectionSignature:source,settlementSignature:'5'.repeat(64),originalPlanHash:bonusHash(original),target,
    releasedLamports:['60','0','0'],unreleasedLamports:['1','14','5']};
  const frozen={version:1,status:'reviewed-residual-not-paid',mint,programId:wallet,sources:[auditSource]},hash=bonusHash(frozen),key=residualSourceKey(source,hash);
  const state={launches:{[mint]:launch},collections:{[source]:{signature:source,mint,scope:'per-mint-v3',cluster:'devnet',
    status:'collected',onchainVerified:true,programId:wallet,router:wallet,collectedLamports:'100'}},
    v3Settlements:{[source]:{status:'finalized',mint,settlementSignature:auditSource.settlementSignature,allocationPlan:original}},
    v3AllocationResidualPlans:{[hash]:{plan:{...frozen,hash},actor:'qa-admin',approvedAt:'2026-10-19T00:00:00Z'}},
    v3CreatorWalletPayout:{[source]:{status:'finalized',balanceDeltaVerified:true,collectionSignature:source,mint,programId:wallet,
      category:0,recipient:wallet,amount:'60',signature:'6'.repeat(64)},[key]:{status:'finalized',balanceDeltaVerified:true,
      collectionSignature:source,residualPlanHash:hash,mint,programId:wallet,category:0,recipient:wallet,amount:'1',signature:'7'.repeat(64)}},
    v3CreatorRewardFunding:{[key]:{status:'finalized',balanceDeltaVerified:true,residualPlanHash:hash,amount:'19'}},v3XClaims:{}};
  let view=v3RewardExperience(state,{},'devnet',wallet);
  assert.equal(view.tokens[0].totals.creator,'61');assert.equal(view.tokens[0].totals.holder,'14');
  assert.equal(view.tokens[0].holderPaidLamports,'0');assert.equal(view.tokens[0].xPaidLamports,'0');
  assert.deepEqual(view.wallet.rows[0].payouts.filter(row=>row.kind==='creator').map(row=>row.amountLamports),['60','1']);
  state.v3XClaims[key]={mint,status:'paid',wallet,residualPlanHash:hash,amountLamports:'5',
    payment:{signature:payment,finalized:true,balanceDeltaVerified:true}};
  const rewards={schedules:{test:{mint,kind:'holder',asset:'SOL',poolIds:[`v3:${key}`],payments:{[wallet]:{
    status:'paid',signature:'8'.repeat(64),amount:'14',finalized:true,balanceDeltaVerified:true}}}}};
  view=v3RewardExperience(state,rewards,'devnet',wallet);
  assert.equal(view.tokens[0].holderPaidLamports,'14');assert.equal(view.tokens[0].xPaidLamports,'5');
  assert.equal(view.wallet.rows[0].payouts.length,4);
});

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
  assert.equal(v3RewardExperience(state, null, 'devnet').evidence.status, 'partial');
  assert.equal(before.tokens[0].totals.holder, '15');
  assert.equal(before.tokens[0].holderPaidLamports, '0');
  assert.equal(before.tokens[0].xPaidLamports, '5');
  const qaProgram = { periodSeconds:300, eligibilityPolicy:'usd-qa-hourly-v1',
    qaMinimums:{ minimumHolderUsd:1, minimumPoolUsd:0.5,
      minimumFundingLamports:1_000_000 } };
  const qaView = v3RewardExperience(state, { programs:{ [mint]:qaProgram } }, 'devnet');
  assert.equal(qaView.tokens[0].holderRewardPolicy.cadence, 'five-minutes');
  assert.equal(qaView.tokens[0].holderRewardPolicy.periodSeconds, 300);
  const rewards = { schedules:{ holder:{ mint, kind:'holder', asset:'SOL', poolIds:[`v3:${source}`],
    payments:{ [wallet]:{ status:'paid', signature:payment, amount:'15',
      finalized:true, balanceDeltaVerified:true } } } } };
  const paid = v3RewardExperience(state, rewards, 'devnet', wallet);
  assert.equal(paid.tokens[0].holderPaidLamports, '15');
  assert.deepEqual(paid.tokens[0].topHolderRecipients.map(row => row.wallet), [wallet]);
  assert.equal(paid.tokens[0].topHolderRecipients[0].latestSignature, payment);
  const secondWallet = '33333333333333333333333333333333';
  rewards.schedules.holder.payments[secondWallet] = { status:'paid',
    signature:'6'.repeat(64), amount:'30', finalized:true, balanceDeltaVerified:true };
  const ranked = v3RewardExperience(state, rewards, 'devnet');
  assert.deepEqual(ranked.tokens[0].topHolderRecipients.map(row => row.wallet),
    [secondWallet, wallet]);
  assert.equal(ranked.tokens[0].topHolderRecipients[0].amountLamports, '30');
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
