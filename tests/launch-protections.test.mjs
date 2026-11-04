import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from '../server/store.mjs';
import {LAUNCH_PROTECTION_MS as duration, SYMBOL_RESERVATION_MS as lease,
  assertSymbolAvailable, reserveLaunchSymbol, registerLaunchProtection, newLaunchProtection, creatorFeeLock} from '../server/launch-protections.mjs';
import {automaticV3Actions} from '../server/automatic-v3-actions.mjs';
import {financialRows} from '../src/features/experience/financial-model.js';

const start = 1_700_000_000_000;
const record = (mint='first', symbol='COIN') => ({mint,symbol,creatorWallet:'wallet'});
const launch = (mint='first', symbol='COIN', percent=80) => {
  const proof={...record(mint,symbol),onchainVerified:true,cluster:'devnet',blockTime:start/1000};
  return {...proof,launchProtection:newLaunchProtection(proof,percent)};
};
async function ledger(t) {
  const dir=await mkdtemp(join(tmpdir(),'launch-protection-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  return createStore(join(dir,'ledger.json'),null);
}

test('ticker matching is case-insensitive, includes archived coins, and expires exactly at 12h',()=>{
  const state={launches:{first:{...launch(),archivedAt:'hidden'}}};
  assert.throws(()=>assertSymbolAvailable(state,record('second','coin'),start+duration-1),/protected until/);
  assert.equal(assertSymbolAvailable(state,record('second','coin'),start+duration),'COIN');
  assert.equal(assertSymbolAvailable(state,record('first'),start),'COIN');
  assert.throws(()=>assertSymbolAvailable(state,record('second','CОIN'),start),/letters or numbers/);
});

test('concurrent signed metadata reservations admit only one mint and survive a store reload',async t=>{
  const store=await ledger(t), mintExists=async()=>false;
  const results=await Promise.allSettled(['a','b'].map(mint=>reserveLaunchSymbol({store,record:record(mint),mintExists,now:start})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const winner=results.find(r=>r.status==='fulfilled').value;
  const retry=await reserveLaunchSymbol({store,record:record(winner.mint),mintExists,now:start+1000});
  assert.deepEqual(retry,winner);
  assert.equal((await store.read()).launchSymbolReservations.COIN.mint,winner.mint);
  assert.equal((await createStore(store.filePath,null).read()).launchSymbolReservations.COIN.mint,winner.mint);
  await assert.rejects(reserveLaunchSymbol({store,record:{...record(winner.mint),creatorWallet:'other'},mintExists,now:start+1000}),/another launch/);
});

test('abandoned reservation is reusable after lease only when the old mint is absent',async t=>{
  const store=await ledger(t);
  await reserveLaunchSymbol({store,record:record(),mintExists:async()=>false,now:start});
  const seen=[];
  const next=await reserveLaunchSymbol({store,record:record('second'),mintExists:async mint=>{seen.push(mint);return false;},now:start+lease});
  assert.equal(next.mint,'second');assert.deepEqual(seen,['second','first']);
});

test('missing registration does not release an on-chain coin, and RPC failures fail closed',async t=>{
  const store=await ledger(t);
  await reserveLaunchSymbol({store,record:record(),mintExists:async()=>false,now:start});
  await assert.rejects(reserveLaunchSymbol({store,record:record('second'),mintExists:async mint=>mint==='first',now:start+lease}),/on-chain launch awaiting registration/);
  await assert.rejects(reserveLaunchSymbol({store,record:record('second'),mintExists:async()=>{throw Error('RPC offline');},now:start+lease}),/RPC offline/);
  assert.equal((await store.read()).launchSymbolReservations.COIN.mint,'first');
  const next=await reserveLaunchSymbol({store,record:record('second'),mintExists:async mint=>mint==='first',now:start+lease+duration});
  assert.equal(next.mint,'second');
});

test('existing on-chain accounts cannot be used to reserve a new ticker',async t=>{
  const store=await ledger(t);
  await assert.rejects(reserveLaunchSymbol({store,record:record(),mintExists:async()=>true,now:start}),/new mint/);
  assert.deepEqual((await store.read()).launchSymbolReservations,{});
});

test('registration atomically claims the symbol and finalizes its verified 12h deadline',async t=>{
  const store=await ledger(t), first=launch();
  await reserveLaunchSymbol({store,record:first,mintExists:async()=>false,now:start});
  await store.update(state=>{registerLaunchProtection(state,first,start);state.launches[first.mint]=first;});
  await assert.rejects(store.update(state=>registerLaunchProtection(state,launch('second'),start+1000)),/protected until/);
  const next=await reserveLaunchSymbol({store,record:record('second'),mintExists:async()=>false,now:start+duration});
  assert.equal(next.mint,'second');
});

test('creator-only fees lock until the exact boundary; zero and legacy shares remain eligible',()=>{
  assert.equal(creatorFeeLock(launch(),start+duration-1).locked,true);
  assert.equal(creatorFeeLock(launch(),start+duration).locked,false);
  assert.equal(creatorFeeLock(launch('first','COIN',0),start).applies,false);
  assert.equal(creatorFeeLock({createdTimestamp:start/1000},start).locked,false);
  assert.equal(creatorFeeLock({launchProtection:{version:1,creatorFeeUnlockAt:'invalid'}},start).locked,true);
  assert.equal(creatorFeeLock({launchProtection:{version:2,creatorFeeUnlockAt:new Date(start).toISOString()}},start).locked,true);
  assert.throws(()=>newLaunchProtection({blockTime:null},80),/verified launch timestamp/);
});

test('keeper skips only locked creator payouts and automatically becomes eligible at unlock',()=>{
  const state={launches:{first:launch()},v3Settlements:{source:{mint:'first',status:'finalized',allocationPlan:{status:'allocated-not-funded',
    creatorDirected:{walletLamports:'80',holderLamports:'10',xLamports:'0'},protocol:{communityLamports:'5',operationsLamports:'5'}}}}};
  assert.deepEqual(automaticV3Actions(state,start).map(row=>row.action),['creator-reward-funding','community-funding','operations-payout']);
  assert.equal(automaticV3Actions(state,start+duration)[0].action,'creator-wallet-payout');
});

test('payments distinguish the fee lock from processing and retain pending signature recovery',()=>{
  const wallet='2'.repeat(32),mint='1'.repeat(32);
  const overview={available:true,scope:'per-mint-v3',creatorWallet:wallet,mint,automaticDisbursementEnabled:true,
    creatorFeeLock:{locked:true,unlockAt:new Date(start+duration).toISOString()},
    collections:[{signature:'3'.repeat(64),settlement:'finalized',creatorWalletPayout:'pending',
      allocationPlan:{status:'allocated-not-funded',creatorDirected:{walletLamports:'80'}}}]};
  const rows=financialRows({overviews:[overview],wallet});
  assert.equal(rows[0].stage,'Locked');assert.equal(rows[0].ready,false);assert.match(rows[0].detail,/12 hours/);
  overview.collections[0].creatorWalletPayout='verification-pending';
  assert.equal(financialRows({overviews:[overview],wallet})[0].stage,'Processing');
});
