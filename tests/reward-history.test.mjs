import test from 'node:test';
import assert from 'node:assert/strict';
import { receivedTotal, rewardHistoryRows, readCreatorHistory } from '../src/features/experience/reward-history-model.js';
import { rewardNextAction } from '../src/features/experience/reward-next-action.js';
import { transactionProgress } from '../src/features/experience/transaction-progress-view.js';
import { filterPaymentHistory } from '../src/features/payments/receipt-view.js';
const wallet='1'.repeat(32),mint='2'.repeat(32);
const paid=(id,amount,at='2026-11-07T00:00:00Z')=>({id:`paid:${id}`,wallet,mint,title:'Holder SOL',stage:'Verified',amountLamports:amount,at});
test('totals use exact lamports, deduplicate records and exclude other wallets, allocations and burns',()=>{
  const receipt=paid('one','9007199254740993');
  const result=receivedTotal([receipt,receipt,paid('two','1'),{...paid('other','100'),wallet:mint},{...paid('burn','100'),wallet:null},{id:'funded',wallet,stage:'Funded',amountLamports:'500'}],wallet);
  assert.equal(result.amount,'9007199.254740994 SOL');assert.equal(result.count,2);
  assert.equal(receivedTotal([receipt],'').count,0);
});
test('date bounds are UTC inclusive; missing dates and inverted ranges do not imply receipts in range',()=>{
  const rows=[paid('one','1','2026-11-07T23:59:59Z'),paid('two','2','2026-11-08T00:00:00Z'),paid('unknown','3',null)];
  assert.equal(receivedTotal(rows,wallet,{from:'2026-11-07',to:'2026-11-07'}).amount,'0.000000001 SOL');
  assert.equal(rewardHistoryRows(rows,wallet,{from:'2026-11-08',to:'2026-11-07'}).length,0);
});
test('search, status and ordering reach all loaded records beyond sixty',()=>{
  const rows=Array.from({length:75},(_,index)=>paid(String(index),String(index),new Date(1804464000000+index*1000).toISOString()));
  assert.equal(rewardHistoryRows(rows,wallet).length,75);
  assert.equal(rewardHistoryRows(rows,wallet,{sort:'oldest'})[0].id,'paid:0');
  assert.equal(rewardHistoryRows(rows,wallet,{query:'no match'}).length,0);
  assert.equal(rewardHistoryRows(rows,wallet,{status:'dashboard-action'}).length,0);
});
test('creator lookup checks beyond eight launches with at most four simultaneous requests',async()=>{
  let running=0,max=0;const calls=[];
  const owned=Array.from({length:13},(_,index)=>({mint:'123456789ABCDE'[index].repeat(32)}));
  const result=await readCreatorHistory(owned,async path=>{calls.push(path);running++;max=Math.max(max,running);await new Promise(resolve=>setTimeout(resolve,1));running--;return path;});
  assert.equal(result.length,13);assert.equal(calls.length,13);assert.equal(max,4);
});
test('wallet change prevents further creator batches and discards obsolete results',async()=>{
  let current=true,calls=0;
  const result=await readCreatorHistory(Array.from({length:12},(_,i)=>({mint:'123456789ABC'[i].repeat(32)})),async()=>{calls++;current=false;return {};},()=>current);
  assert.equal(result,null);assert.equal(calls,4);
});
test('action copy distinguishes blocked approval, automatic processing, funded and uncertain outcomes',()=>{
  assert.equal(rewardNextAction({stage:'Awaiting approval',ready:false}).action,'View blocker');
  assert.equal(rewardNextAction({stage:'Processing',automatic:true}).label,'Automatic processing');
  assert.equal(rewardNextAction({stage:'Processing'}).action,'Check existing outcome');
  assert.equal(rewardNextAction({stage:'Funded'}).label,'Waiting for eligibility and payout');
});
test('claim progress requires receipt proof; reported paid without proof stays verifying',()=>{
  assert.equal(transactionProgress('claim',{status:'paid'}).stage,'Verifying');
  assert.equal(transactionProgress('claim',{receiptVerified:true}).stage,'Verified');
  assert.equal(transactionProgress('trade',{progress:'indexing'}).stage,'Indexing');
});
test('payment history supports both date orders without mutating source records',()=>{
  const rows=[{blockTime:3},{blockTime:1},{blockTime:2}];
  assert.deepEqual(filterPaymentHistory(rows,{sort:'oldest'}).map(row=>row.blockTime),[1,2,3]);
  assert.deepEqual(filterPaymentHistory(rows).map(row=>row.blockTime),[3,2,1]);
  assert.deepEqual(rows.map(row=>row.blockTime),[3,1,2]);
});
