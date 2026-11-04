import test from 'node:test';
import assert from 'node:assert/strict';
import {completeFinalizedEventReceipt} from '../server/finalized-event-receipt.mjs';
import {launchReceipt,signature} from './fixtures/developer-protection.mjs';
const genesis='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const connection={getGenesisHash:async()=>genesis};
const truncated=()=>{const tx=launchReceipt();tx.meta.logMessages=['Log truncated'];return tx;};
const input=(complete=launchReceipt())=>({connection,transaction:truncated(),signature,rpcUrl:'https://evidence.example',
  connectionFactory:()=>({getGenesisHash:async()=>genesis,getTransaction:async()=>complete})});

test('complete receipt uses the primary provider without another network request',async()=>{
  const transaction=launchReceipt();assert.equal(await completeFinalizedEventReceipt({...input(),transaction,
    connectionFactory:()=>{throw Error('Unexpected fallback');}}),transaction);
});
test('truncated finalized logs recover only when transaction and balances match',async()=>{
  const complete=launchReceipt();assert.equal(await completeFinalizedEventReceipt(input(complete)),complete);
  for(const alter of [tx=>tx.slot++,tx=>tx.transaction.signatures=['wrong'],tx=>tx.meta.postBalances[0]++,
    tx=>tx.meta.postTokenBalances[0].uiTokenAmount.amount='123',tx=>tx.meta.logMessages=['Log truncated']]){
    const changed=launchReceipt();alter(changed);await assert.rejects(completeFinalizedEventReceipt(input(changed)));
  }
});
test('fallback rejects wrong network, unavailable history, invalid endpoint and timeout',async()=>{
  await assert.rejects(completeFinalizedEventReceipt({...input(),connection:{getGenesisHash:async()=>'mainnet'}}),/Devnet/);
  await assert.rejects(completeFinalizedEventReceipt(input(null)),/disagree/);
  await assert.rejects(completeFinalizedEventReceipt({...input(),rpcUrl:'http://evidence.example'}),/configuration/);
  await assert.rejects(completeFinalizedEventReceipt({...input(),timeoutMs:5,
    connectionFactory:()=>({getGenesisHash:async()=>genesis,getTransaction:()=>new Promise(()=>{})})}),/timed out/);
  await assert.rejects(completeFinalizedEventReceipt({...input(),rpcUrl:''}),/logs-incomplete/);
});
test('malformed invocation logs never trigger fallback',async()=>{
  const transaction=launchReceipt();transaction.meta.logMessages=['Program 11111111111111111111111111111111 success'];
  await assert.rejects(completeFinalizedEventReceipt({...input(),transaction,
    connectionFactory:()=>{throw Error('Must not try fallback');}}),/Unbalanced/);
});
