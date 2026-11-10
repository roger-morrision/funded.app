import test from 'node:test';
import assert from 'node:assert/strict';
import {SOLANA_GENESIS} from '../solana-network.js';
import {completeFinalizedEventReceipt} from '../server/finalized-event-receipt.mjs';
const program='11111111111111111111111111111111';
const signature='2'.repeat(88);
const tx={slot:123,blockTime:100,transaction:{signatures:[signature],message:{accountKeys:[program]}},
  meta:{err:null,preBalances:[100],postBalances:[90],logMessages:[`Program ${program} invoke [1]`,'Log truncated']}};
const complete={...tx,meta:{...tx.meta,logMessages:[`Program ${program} invoke [1]`,`Program ${program} success`]}};
function args(cluster='devnet',alternate=cluster,receipt=complete){return {cluster,transaction:tx,signature,rpcUrl:'https://rpc.example.invalid',
  connection:{getGenesisHash:async()=>SOLANA_GENESIS[cluster]},connectionFactory:()=>({
    getGenesisHash:async()=>SOLANA_GENESIS[alternate],getTransaction:async()=>receipt})};}
test('truncated finalized logs recover on the explicitly selected network',async()=>{
  for(const cluster of ['devnet','mainnet-beta'])assert.deepEqual(await completeFinalizedEventReceipt(args(cluster)),complete);
});
test('receipt fallback rejects another network and altered balance evidence',async()=>{
  await assert.rejects(completeFinalizedEventReceipt(args('mainnet-beta','devnet')),/selected network/);
  await assert.rejects(completeFinalizedEventReceipt(args('devnet','devnet',{...complete,meta:{...complete.meta,postBalances:[91]}})),/disagree/);
  const wrongPrimary=args('devnet');wrongPrimary.cluster='mainnet-beta';
  await assert.rejects(completeFinalizedEventReceipt(wrongPrimary),/selected network/);
});
