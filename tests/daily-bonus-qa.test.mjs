import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import {bonusSchedule,bonusWindow,bonusWindowKey,latestBonusDay,currentBonusStart} from '../server/daily-bonus-schedule.mjs';
import {buildDailyBonusSnapshot,dailyBonusManifest} from '../server/daily-bonus.mjs';
import {dailyBonusWork} from '../server/daily-bonus-queue.mjs';
import {createDailyBonusService} from '../server/daily-bonus-service.mjs';
import {rewardAddresses} from '../server/automatic-reward-chain.mjs';
const keys=Array.from({length:7},()=>Keypair.generate()), addresses=keys.map(row=>row.publicKey.toBase58());
const start=Date.parse('2026-10-18T10:15:00Z')/1000;
const env={FUNDED_DEVNET_QA_MINIMUMS_ENABLED:'true',FUNDED_DEVNET_QA_BONUS_PERIOD_SECONDS:'300',FUNDED_DEVNET_QA_BONUS_MINTS:addresses[2]};
const schedule=bonusSchedule({cluster:'devnet',env});
const day=bonusWindowKey(start,schedule);
const memory=data=>({read:async()=>structuredClone(data),transaction:async fn=>fn(data)});
const evidence=()=>({coverage:[{mint:addresses[2],complete:true}],collections:[{signature:'collection',settlementSignature:'settlement',
  mint:addresses[2],creator:addresses[3],referrer:addresses[4],blockTime:start+1,settlementBlockTime:start+1,finalized:true,
  amountLamports:'75000',communityLamports:'3000',dailyBonusVersion:1}],trades:[{signature:'trade',logIndex:0,
  mint:addresses[2],wallet:addresses[5],blockTime:start+2,finalized:true,amountLamports:'5000'}]});
test('five-minute periods require explicit Devnet configuration and an allowlist; daily remains the default',()=>{
  assert.equal(bonusSchedule({cluster:'devnet',env:{}}).periodSeconds,86400);
  assert.throws(()=>bonusSchedule({cluster:'mainnet-beta',env}),/Devnet QA/);
  assert.throws(()=>bonusSchedule({cluster:'devnet',env:{...env,FUNDED_DEVNET_QA_MINIMUMS_ENABLED:'false'}}),/Devnet QA/);
  assert.throws(()=>bonusSchedule({cluster:'devnet',env:{...env,FUNDED_DEVNET_QA_BONUS_MINTS:''}}),/one to eight/);
  assert.throws(()=>bonusSchedule({cluster:'devnet',env:{...env,FUNDED_DEVNET_QA_BONUS_PERIOD_SECONDS:'1'}}),/Devnet QA/);
  assert.deepEqual(bonusWindow(day,start+300),{day,start,end:start+300,periodSeconds:300,qa:true,cohort:schedule.cohort});
  assert.throws(()=>bonusWindow(day,start+299),/completed five-minute/);
  assert.throws(()=>bonusWindow('qa5m:2026-10-18T10:16:00Z',start+600),/completed five-minute/);
  assert.equal(latestBonusDay(start+300,schedule),day);
  assert.equal(currentBonusStart(start+299,schedule),start);
  const other=bonusSchedule({cluster:'devnet',env:{...env,FUNDED_DEVNET_QA_BONUS_MINTS:addresses[6]}});
  assert.notEqual(bonusWindowKey(start,other),day,'Changing test mints must not reuse a prior immutable window.');
});
test('QA windows preserve rank arithmetic and distinguish consumed sources from ordinary daily evidence',()=>{
  const snapshot=buildDailyBonusSnapshot({day,now:start+300,...evidence()});
  assert.equal(snapshot.policy.periodSeconds,300);assert.equal(snapshot.policy.qa,true);
  assert.equal(snapshot.sources[0].payableLamports,'1500');
  assert.equal(dailyBonusManifest(snapshot,snapshot.sources[0]).leaves.length,3);
  const daily=buildDailyBonusSnapshot({day:'2026-10-18',now:start+86400,...evidence(),excludedCollectionSignatures:['collection']});
  assert.equal(daily.sources.length,0);assert.equal(daily.rankings.creators.length,1);
  assert.equal(daily.policy.periodSeconds,86400);
  assert.deepEqual(buildDailyBonusSnapshot({day:daily.day,now:daily.end,...daily.evidence}),daily);
});
test('QA queue catches up allowlisted five-minute windows without changing historical daily records',()=>{
  const launch={cluster:'devnet',onchainVerified:true,createdTimestamp:start+1,feeDistribution:{fixedFunded:{communityRewards:{dailyBonus:{version:1}}}}};
  const app={launches:{[addresses[2]]:{...launch,mint:addresses[2]},other:{...launch,mint:addresses[6],createdTimestamp:start-86400}}};
  const ledger={dailyBonusSnapshots:{'2026-10-17':{status:'snapshotted',snapshot:{sources:[]}}}};
  assert.deepEqual(dailyBonusWork({app,ledger,now:start+901,schedule}).missing,[day,bonusWindowKey(start+300,schedule),bonusWindowKey(start+600,schedule)]);
  assert.equal(ledger.dailyBonusSnapshots['2026-10-17'].status,'snapshotted');
});
test('QA payouts replay safely, cannot reuse assigned collection funding, and default service rejects QA capture',async()=>{
  const programId=addresses[0],authority=keys[1],mint=addresses[2],vault=rewardAddresses({programId,authority:authority.publicKey,mint}).vault.toBase58();
  const ledger={},rewardStore=memory(ledger),store=memory({launches:{[mint]:{creatorWallet:addresses[3],pumpFeeRoute:{initialAuthority:addresses[1]},
    feeDistribution:{fixedFunded:{communityRewards:{dailyBonus:{version:1}}}}}},v3CommunityFunding:{collection:{status:'finalized',balanceDeltaVerified:true,mint,recipient:vault,amount:'3000',signature:'funding'}}});
  let payments=0;
  const options={store,rewardStore,connection:{},programId,authority,cluster:'devnet',payoutEnabled:true,now:()=>start+86400,
    readEvidence:async()=>evidence(),verifyPolicy:async()=>({verified:true}),loadFunding:async()=>({signature:'funding',mint,category:5,amount:'3000',recipient:vault,balanceDeltaVerified:true}),
    chainFactory:()=>({readiness:async()=>({constrainedPayouts:true}),ensureCycle:async()=>({address:addresses[6]}),
      submitLeaf:async()=>{payments++;return{finalized:true,balanceDeltaVerified:true};}})};
  const qa=createDailyBonusService({...options,schedule});
  await qa.execute(day);await qa.execute(day);assert.equal(payments,3);
  const daily=createDailyBonusService(options);
  await assert.rejects(daily.capture(day),/active bonus schedule/);
  const record=await daily.capture('2026-10-18');assert.equal(record.snapshot.sources.length,0);
  await daily.execute('2026-10-18');assert.equal(payments,3);
  const originalHash=ledger.dailyBonusSnapshots[day].snapshot.hash;
  await qa.capture(day);assert.equal(ledger.dailyBonusSnapshots[day].snapshot.hash,originalHash);
  const expanded=bonusSchedule({cluster:'devnet',env:{...env,FUNDED_DEVNET_QA_BONUS_MINTS:[mint,addresses[6]].join(',')}});
  const second=createDailyBonusService({...options,schedule:expanded});
  await assert.rejects(second.capture(day),/different QA mint cohort/);
  const newWindow=await second.capture(bonusWindowKey(start,expanded));
  assert.equal(newWindow.snapshot.sources.length,0);assert.equal(payments,3);
});
