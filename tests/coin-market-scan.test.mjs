import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import {PUMP_AMM_PROGRAM_ID,canonicalPumpPoolPda} from '@pump-fun/pump-swap-sdk';
import {NATIVE_MINT} from '@solana/spl-token';
import {readPumpMarketActivity} from '../server/coin-market.mjs';
import {successfulEventLogs} from '../server/product-trade-index.mjs';

const mint=Keypair.generate().publicKey,pool=canonicalPumpPoolPda(mint,NATIVE_MINT),now=200000;
const ref=(n,blockTime)=>({signature:'signature-'+n,slot:100+n,blockTime,err:null,confirmationStatus:'finalized'});
const receipt=r=>({slot:r.slot,blockTime:r.blockTime,transaction:{signatures:[r.signature]},meta:{err:null,logMessages:[]}});
function connection(refs,mutate=tx=>tx){
  const reads=[];return {reads,getAccountInfo:async()=>({owner:PUMP_AMM_PROGRAM_ID}),
    getSignaturesForAddress:async address=>address.equals(pool)?refs:[],
    getTransaction:async signature=>{reads.push(signature);return mutate(receipt(refs.find(r=>r.signature===signature)));}};
}
test('old transaction history cannot exhaust a current empty 24-hour scan',async()=>{
  const refs=Array.from({length:50},(_,i)=>ref(50-i,now-90000-i));const c=connection(refs);
  const result=await readPumpMarketActivity({connection:c,mint,nowSeconds:now});
  assert.equal(c.reads.length,1);assert.equal(result.coverage,'complete');assert.equal(result.poolHistoryCoverage,'complete');
  assert.equal(result.tradeCount24h,0);assert.equal(result.volume24hSol,0);assert.equal(result.observedCoverage,'partial');
});
test('every recent receipt is checked and incomplete or mismatched receipts prevent complete coverage',async()=>{
  const refs=[ref(2,now-10),ref(1,now-90000)];
  for(const mutate of [tx=>({...tx,slot:999}),tx=>({...tx,meta:{err:{InstructionError:[0,1]},logMessages:[]}}),
    tx=>({...tx,meta:{err:null,logMessages:['Log truncated']}})]){
    const c=connection(refs,mutate);const result=await readPumpMarketActivity({connection:c,mint,nowSeconds:now});
    assert.equal(c.reads.length,2);assert.equal(result.coverage,'partial');assert.equal(result.poolHistoryCoverage,'partial');
  }
});
test('a missing old baseline leaves price change unknown without invalidating the verified current window',async()=>{
  const refs=[ref(2,now-10),ref(1,now-90000)];const c=connection(refs,tx=>tx.blockTime<now-86400?null:tx);
  const result=await readPumpMarketActivity({connection:c,mint,nowSeconds:now});
  assert.equal(result.coverage,'complete');assert.equal(result.observedCoverage,'partial');assert.equal(result.priceChangePercent,null);
});
test('shared event parser excludes failed ancestors and preserves its public export',()=>{
  const p='11111111111111111111111111111111';
  assert.deepEqual(successfulEventLogs([`Program ${p} invoke [1]`,'Program data: AAAA',`Program ${p} failed: denied`]),[]);
  assert.throws(()=>successfulEventLogs([`Program ${p} invoke [1]`,'Log truncated']),error=>error.reason==='logs-incomplete');
});
