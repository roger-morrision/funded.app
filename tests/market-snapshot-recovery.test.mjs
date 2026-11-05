import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverMarketSnapshots} from '../src/features/coin/market-recovery.js';
test('curve failure retries once and still discovers a verified canonical pool',async()=>{
 let curves=0,pools=0;const pool={pool:'verified-pool',spotPriceSol:1};
 const r=await recoverMarketSnapshots({curveResult:{status:'rejected'},fetchCurve:async()=>{curves++;throw new Error('RPC');},fetchPool:async()=>{pools++;return pool;}});
 assert.deepEqual(r,{curve:null,pool});assert.equal(curves,1);assert.equal(pools,1);
});
test('active curve skips pool work and navigation invalidates a pending recovery',async()=>{
 const curve={complete:false};assert.deepEqual(await recoverMarketSnapshots({curveResult:{status:'fulfilled',value:curve},fetchPool:()=>assert.fail('active curve')}),{curve,pool:null});
 let current=true;const r=await recoverMarketSnapshots({curveResult:{status:'rejected'},isCurrent:()=>current,fetchCurve:async()=>{current=false;return curve;},fetchPool:()=>assert.fail('stale navigation')});assert.deepEqual(r,{curve:null,pool:null});
});
