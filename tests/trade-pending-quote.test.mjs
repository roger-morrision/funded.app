import test from 'node:test';
import assert from 'node:assert/strict';
import { createTradeExecutionController } from '../src/app/controllers/trade-execution.js';

test('an unresolved signed trade stops both scheduled and direct quote work and explains the recovery action',async()=>{
  const previous=globalThis.document;
  const button={hidden:true,dataset:{}};
  globalThis.document={querySelector:selector=>selector==='#trade-verify'?button:null};
  const mint='1'.repeat(32),wallet='2'.repeat(32),signature='3'.repeat(88),messages=[];
  const state={connectedWalletAddress:wallet,tradeInputs:()=>({mint,valid:true}),
    pendingTradeVerifications:new Map([[signature,{signature,mint,walletAddress:wallet}]]),
    setTradeStatus:text=>messages.push(text),setTradeReceiptStatus:text=>messages.push(text),
    captureWalletSession:()=>{throw Error('A blocked quote must not prepare signing');}};
  try {
    const controller=createTradeExecutionController(state);
    controller.queueTradeQuote();assert.equal(await controller.prepareTradeQuote(),null);
    assert.equal(state.tradeQuoteTimer,undefined);assert.ok(messages.some(text=>/Check recorded trade/.test(text)));
    assert.equal(button.hidden,false);assert.equal(button.dataset.pendingSignature,signature);
  } finally {globalThis.document=previous;}
});

test('verified balance clears the blocking message and resumes quotes even while history indexing is pending',async()=>{
  const previous=globalThis.document,button={hidden:false,dataset:{}};
  globalThis.document={querySelector:selector=>selector==='#trade-verify'?button:null};
  const wallet='2'.repeat(32),mint='1'.repeat(32),signature='4'.repeat(88),messages=[];
  const pending={signature,mint,walletAddress:wallet,side:'buy',state:'pending'};
  let queued=0;
  const state={connectedWalletAddress:wallet,tradeInputs:()=>({mint}),captureWalletSession:()=>({address:wallet}),
    isWalletSessionCurrent:()=>true,pendingTradeVerifications:new Map([[signature,pending]]),
    connection:{getParsedTransaction:async()=>({meta:{err:null}})},apiRequest:async()=>({available:false}),
    assessTradeCompletion:()=>({receiptVerified:true,indexed:false,complete:false}),
    setTradeStatus:text=>messages.push(text),setTradeReceiptStatus(){},invalidateTradePreview(){},
    queueTradeQuote:()=>queued++,updateTradeActionState(){}};
  try{
    await createTradeExecutionController(state).verifyPendingTrade(null,signature);
    assert.equal(queued,1);assert.equal(pending.broadcastUncertain,false);
    assert.equal(pending.progress,'indexing');assert.equal(button.textContent,'Check trade history');
    assert.match(messages.at(-1),/balance change verified/);
    assert.equal(button.hidden,false);assert.equal(button.dataset.pendingSignature,signature);
  }finally{globalThis.document=previous;}
});
