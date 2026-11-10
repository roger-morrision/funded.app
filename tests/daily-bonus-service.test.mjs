import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import {createDailyBonusService} from '../server/daily-bonus-service.mjs';
import {rewardAddresses} from '../server/automatic-reward-chain.mjs';
import {dailyBonusPayments} from '../src/features/fees/daily-bonus-payments.js';

const key=()=>Keypair.generate().publicKey.toBase58();
function fixture(){
  const authority=Keypair.generate(),programId=key(),mint=key(),creator=key(),referrer=key(),trader=key();
  const day='2026-11-09',now=Date.parse('2026-11-10T00:00:00Z')/1000,time=now-100;
  const vault=rewardAddresses({programId,authority:authority.publicKey,mint}).vault.toBase58();
  const funded={cluster:'devnet',status:'finalized',signature:'funding',balanceDeltaVerified:true,mint,
    recipient:vault,amount:'1000000',category:5};
  const app={launches:{[mint]:{cluster:'devnet',creatorWallet:creator,
    pumpFeeRoute:{initialAuthority:authority.publicKey.toBase58(),protocolSplit:{}},
    feeDistribution:{fixedFunded:{communityRewards:{dailyBonus:{version:1}}}}}},v3CommunityFunding:{source:funded}};
  const evidence={coverage:[{mint,complete:true}],collections:[{signature:'source',settlementSignature:'settlement',mint,
    blockTime:time,settlementBlockTime:time,creator,referrer,amountLamports:'1000000',communityLamports:'1000000',dailyBonusVersion:1,finalized:true}],
    trades:[{signature:'trade',logIndex:0,mint,wallet:trader,blockTime:time,amountLamports:'1000000',finalized:true}]};
  let state={},crash=false,unfunded=false;
  const receipts=new Map(),submissions=[];
  const rewardStore={read:async()=>structuredClone(state),transaction:async operation=>{
    const draft=structuredClone(state),result=operation(draft);
    if(crash&&Object.values(draft.dailyBonusSnapshots?.[day]?.payouts?.source?.payments||{}).some(p=>p.finalized)){
      crash=false;throw Error('Fixture persistence failure after chain confirmation');
    }
    state=draft;return result;
  }};
  const chain={readiness:async()=>({constrainedPayouts:true}),ensureCycle:async()=>({address:key()}),
    submitLeaf:async(plan,leaf)=>{
      assert.equal(plan.cluster,'devnet');
      if(unfunded)throw Object.assign(Error('Recipient needs funding'),{code:'RECIPIENT_RENT_REQUIRED',minimumFundingLamports:'890880'});
      if(!receipts.has(leaf.recipient)){
        submissions.push(leaf.recipient);receipts.set(leaf.recipient,{finalized:true,balanceDeltaVerified:true,
          amountReceived:leaf.amount,payment:key(),signature:'2'.repeat(88)});
      }
      return receipts.get(leaf.recipient);
    }};
  const create=()=>createDailyBonusService({cluster:'devnet',store:{read:async()=>structuredClone(app)},rewardStore,
    connection:{},programId,authority,payoutEnabled:true,chainFactory:()=>chain,
    readEvidence:async()=>structuredClone(evidence),verifyPolicy:async()=>({verified:true,protectedPolicy:true}),
    loadFunding:async()=>funded,now:()=>now});
  return {create,day,app,submissions,read:()=>state,crash:()=>{crash=true;},unfunded:value=>{unfunded=value;}};
}

test('bonus payout recovers after receipt persistence failure without creating duplicate transfers',async()=>{
  const f=fixture();f.crash();
  await assert.rejects(f.create().execute(f.day),/persistence failure/);
  assert.equal(f.submissions.length,1);
  await f.create().execute(f.day);
  const row=f.read().dailyBonusSnapshots[f.day],payout=row.payouts.source;
  assert.equal(payout.status,'paid');assert.equal(f.submissions.length,3);
  const receipts=structuredClone(payout.payments);
  await f.create().execute(f.day);
  assert.equal(f.submissions.length,3);assert.deepEqual(f.read().dailyBonusSnapshots[f.day].payouts.source.payments,receipts);
  assert.equal(BigInt(row.snapshot.sources[0].payableLamports)+BigInt(row.snapshot.sources[0].retainedLamports),1000000n);
});

test('unfunded bonus recipients retain their entitlement and resume with the same snapshot',async()=>{
  const f=fixture();f.unfunded(true);await f.create().execute(f.day);
  const snapshot=structuredClone(f.read().dailyBonusSnapshots[f.day].snapshot);
  assert.equal(f.read().dailyBonusSnapshots[f.day].payouts.source.status,'awaiting-recipient-funding');
  assert.equal(f.submissions.length,0);
  f.unfunded(false);await f.create().execute(f.day);
  assert.deepEqual(f.read().dailyBonusSnapshots[f.day].snapshot,snapshot);
  assert.equal(f.read().dailyBonusSnapshots[f.day].payouts.source.status,'paid');
});

test('foreign funding records cannot pay a Devnet bonus',async()=>{
  const f=fixture();f.app.v3CommunityFunding.source.cluster='mainnet-beta';
  await assert.rejects(f.create().execute(f.day),/conflicts/);assert.equal(f.submissions.length,0);
});

test('bonus receipt links use the selected network and never display foreign-network payments',()=>{
  const wallet=key(),payment={finalized:true,balanceDeltaVerified:true,payment:key(),signature:'2'.repeat(88),amount:'10',amountReceived:'10'};
  const snapshot={sources:[{payments:{[wallet]:payment}}]};
  assert.match(dailyBonusPayments(snapshot).get(wallet).receipts[0].href,/cluster=devnet$/);
  assert.equal(dailyBonusPayments({...snapshot,cluster:'mainnet-beta'}).size,0);
  payment.cluster='mainnet-beta';
  const receipt=dailyBonusPayments({...snapshot,cluster:'mainnet-beta'}).get(wallet).receipts[0];
  assert(!receipt.href.includes('cluster='));assert.equal(dailyBonusPayments(snapshot).size,0);
});
