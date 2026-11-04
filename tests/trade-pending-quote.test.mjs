import test from 'node:test';
import assert from 'node:assert/strict';
import { createTradeExecutionController } from '../src/app/controllers/trade-execution.js';

test('an unresolved signed trade stops both scheduled and direct quote work and explains the recovery action',async()=>{
  const previous=globalThis.document;
  globalThis.document={querySelector:()=>null};
  const mint='1'.repeat(32),wallet='2'.repeat(32),signature='3'.repeat(88),messages=[];
  const state={connectedWalletAddress:wallet,tradeInputs:()=>({mint,valid:true}),
    pendingTradeVerifications:new Map([[signature,{signature,mint,walletAddress:wallet}]]),
    setTradeStatus:text=>messages.push(text),setTradeReceiptStatus:text=>messages.push(text),
    captureWalletSession:()=>{throw Error('A blocked quote must not prepare signing');}};
  try {
    const controller=createTradeExecutionController(state);
    controller.queueTradeQuote();assert.equal(await controller.prepareTradeQuote(),null);
    assert.equal(state.tradeQuoteTimer,undefined);assert.ok(messages.some(text=>/Check recorded trade/.test(text)));
  } finally {globalThis.document=previous;}
});
