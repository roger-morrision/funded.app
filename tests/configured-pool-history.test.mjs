import test from 'node:test';
import assert from 'node:assert/strict';
import {PublicKey} from '@solana/web3.js';
import {PUMP_AMM_PROGRAM_ID,canonicalPumpPoolPda} from '@pump-fun/pump-swap-sdk';
import {bondingCurvePda} from '@pump-fun/pump-sdk';
import {NATIVE_MINT} from '@solana/spl-token';
import {readPumpMarketActivity} from '../server/coin-market.mjs';
const mint=new PublicKey('C5JFX2W3YtLDmiZeUTcYjfLqXPWmW2GZZC5fbxv7ut64');
const pool='EKKUWqwbZKeq4hdth8kdYuHZBtvxDCu3kZahHATbba32';
test('configured RICH history scans its verified pool instead of the nonexistent canonical pool',async()=>{
  const scans=[];let validated=false;
  const connection={getAccountInfo:async key=>{assert.equal(key.toBase58(),pool);return {owner:PUMP_AMM_PROGRAM_ID};},
    getSignaturesForAddress:async key=>{assert(validated);scans.push(key.toBase58());return [];}};
  await readPumpMarketActivity({connection,mint,poolAddress:pool,readPool:async args=>{
    assert.equal(args.poolAddress,pool);assert(args.mint.equals(mint));validated=true;
  }});
  assert.deepEqual(scans,[bondingCurvePda(mint).toBase58(),pool]);
  assert(!scans.includes(canonicalPumpPoolPda(mint,NATIVE_MINT).toBase58()));
});
test('an unverified configured pool cannot supply trade events',async()=>{
  let scanned=false;
  await assert.rejects(()=>readPumpMarketActivity({connection:{getAccountInfo:async()=>({owner:PUMP_AMM_PROGRAM_ID}),
    getSignaturesForAddress:async()=>{scanned=true;return [];}},mint,poolAddress:pool,
    readPool:async()=>{throw Error('Wrong mint or vault custody');}}),/custody/);
  assert.equal(scanned,false);
});
test('a future pool does not block the token curve history before migration',async()=>{
  const scans=[];
  await readPumpMarketActivity({connection:{getAccountInfo:async()=>null,getSignaturesForAddress:async key=>{scans.push(key.toBase58());return [];}},
    mint,poolAddress:pool,readPool:async()=>{assert.fail('Absent pool must not be used');}});
  assert.deepEqual(scans,[bondingCurvePda(mint).toBase58()]);
});
