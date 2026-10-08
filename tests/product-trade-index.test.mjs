import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Connection,PublicKey } from '@solana/web3.js';
import { getPumpAmmProgram,PUMP_AMM_PROGRAM_ID } from '@pump-fun/pump-swap-sdk';
import { successfulEventLogs,finalizedTradeRows,scanTradePage,indexProductTrades } from '../server/product-trade-index.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/postmigration-pumpswap-events.json',import.meta.url)));
const mint=new PublicKey(fixture.mint),pool=new PublicKey(fixture.pool);
const coder=getPumpAmmProgram(new Connection('http://localhost:8899')).coder.events;
const decodePoolEvent=coder.decode.bind(coder);
const reference=item=>({signature:item.signature,slot:item.slot,err:null,confirmationStatus:'finalized'});
const transaction=item=>({slot:item.slot,blockTime:item.blockTime,meta:{err:null,logMessages:item.logs},transaction:{signatures:[item.signature]}});

test('finalized receipts decode exact amounts and reject failed or mismatched transaction proofs',()=>{
  const item=fixture.cases[0], tx=transaction(item);
  const rows=finalizedTradeRows(tx,reference(item),mint,pool,decodePoolEvent);
  assert.equal(rows.length,1);assert.equal(rows[0].solLamports,'9499999');assert(Number.isInteger(rows[0].logIndex));assert.equal(Object.hasOwn(rows[0],'trader'),false);
  for(const altered of [null,{...tx,slot:1},{...tx,transaction:{signatures:['wrong']}},{...tx,meta:{...tx.meta,err:{InstructionError:[0,'Failed']}}}]) assert.throws(()=>finalizedTradeRows(altered,reference(item),mint,pool,decodePoolEvent));
  const spoof=transaction(item);spoof.meta.logMessages=item.logs.map(log=>log.replaceAll(PUMP_AMM_PROGRAM_ID.toBase58(),mint.toBase58()));
  assert.deepEqual(finalizedTradeRows(spoof,reference(item),mint,pool,decodePoolEvent),[]);
});

test('events from rolled-back ancestors, failed inner calls, or incomplete logs do not become volume',()=>{
  const program=PUMP_AMM_PROGRAM_ID.toBase58(),outer=mint.toBase58();
  const data='Program data: AAAA';
  assert.deepEqual(successfulEventLogs([`Program ${outer} invoke [1]`,`Program ${program} invoke [2]`,data,`Program ${program} success`,`Program ${outer} failed: error`]),[]);
  assert.deepEqual(successfulEventLogs([`Program ${outer} invoke [1]`,`Program ${program} invoke [2]`,data,`Program ${program} failed: error`,`Program ${outer} success`]),[]);
  assert.throws(()=>successfulEventLogs([`Program ${program} invoke [1]`,data]));
  assert.throws(()=>successfulEventLogs(['Log truncated']));
});

test('backfill pages resume then stop at the prior head; unavailable transactions never advance a cursor',async()=>{
  const items=[...fixture.cases].reverse();
  const calls=[];
  const connection={getSignaturesForAddress:async(_,options,commitment)=>{assert.equal(commitment,'finalized');calls.push(options);return options.before?[]:items.map(reference);},getTransaction:async(sig,options)=>{assert.equal(options.commitment,'finalized');return transaction(items.find(row=>row.signature===sig));}};
  const first=await scanTradePage({connection,mint:fixture.mint,route:'pool',pageSize:2,decodePoolEvent});
  assert.equal(first.status,'backfilling');assert.equal(first.records.length,2);
  const last=await scanTradePage({connection,mint:fixture.mint,route:'pool',cursor:first.cursor,pageSize:2,decodePoolEvent});
  assert.equal(last.status,'provider-history-scanned');assert.equal(last.cursor.head,items[0].signature);
  const refresh=await scanTradePage({connection,mint:fixture.mint,route:'pool',cursor:last.cursor,pageSize:2,decodePoolEvent});
  assert.equal(refresh.examined,0);assert.equal(refresh.status,'provider-history-scanned');
  connection.getTransaction=async()=>null;
  await assert.rejects(()=>scanTradePage({connection,mint:fixture.mint,route:'pool',pageSize:2,decodePoolEvent}),/proof/);
  assert.equal(calls[1].before,items[1].signature);
});

test('wrong-network runs stop before acquiring a database connection',async()=>{
  await assert.rejects(()=>indexProductTrades({connection:{getGenesisHash:async()=>'mainnet'},pool:{connect(){assert.fail('Must not access database');}},launches:[]}),/Devnet/);
});
