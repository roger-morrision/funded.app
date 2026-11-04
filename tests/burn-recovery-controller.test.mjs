import test from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import { Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { createBurnCheckedInstruction, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { createFundedTradingController } from '../src/app/controllers/funded-trading.js';
import { readPendingBurn } from '../src/features/funded/burn-recovery.js';

function setup(t, { lostBroadcast = false, storageDenied = false } = {}) {
  const wallet = Keypair.generate(), mint = Keypair.generate().publicKey, account = Keypair.generate().publicKey;
  const values = new Map(), input = { value:'0.1' }, button = {};
  const previous = { document:globalThis.document, localStorage:globalThis.localStorage };
  globalThis.localStorage = { getItem:key => values.get(key) || null, setItem:(key,value) => {
    if (storageDenied) throw Error('Storage denied'); values.set(key,value);
  }, removeItem:key => values.delete(key) };
  globalThis.document = { querySelector:selector => selector === '#funded-burn-amount' ? input : selector === '#funded-burn-project' ? {value:''} : button };
  t.after(() => Object.assign(globalThis, previous));
  let signed = 0, sent = 0, indexed = 0;
  const state = { wallet:{publicKey:wallet.publicKey, signTransaction:async tx => { signed++; tx.sign(wallet); return tx; }},
    connectedWalletAddress:wallet.publicKey.toBase58(), PROTOCOL_FUNDED_MINT:mint.toBase58(), bs58,
    fundedBurnState:{status:'ready',decimals:6,balanceBaseUnits:200000n,supplyBaseUnits:9000000n,tokenProgram:TOKEN_PROGRAM_ID,tokenAccounts:[{address:account,amount:200000n}]},
    captureWalletSession(){return {provider:this.wallet,address:this.connectedWalletAddress};}, canSignTransactions:()=>true,
    assertWalletSessionCurrent(){}, parseTokenAmount:()=>100000n, planTokenAccountBurns:()=>[{address:account,amount:100000n}],
    getSolana:async()=>({PublicKey,Transaction,TransactionInstruction,createBurnCheckedInstruction}),
    renderBuybackDashboard(){}, updateFundedBurnButton(){}, showToast(){}, loadFundedBurnState:async()=>{},
    waitForSignatureConfirmation:async(_rpc,options)=>{assert.equal(options.commitment,'finalized');
      // A background balance refresh / unrelated burn must not invalidate this receipt.
      state.fundedBurnState.tokenAccounts=[{address:account,amount:100000n}];state.fundedBurnState.supplyBaseUnits=8800000n;
      return {value:{err:null}};
    },
    apiRequest:async(_url,{body})=>{indexed++;return {available:true,data:{...body,status:'verified',onchainVerified:true}};},
    connection:{getLatestBlockhash:async()=>({blockhash:Keypair.generate().publicKey.toBase58(),lastValidBlockHeight:123}),
      sendRawTransaction:async()=>{sent++;assert.ok(readPendingBurn(),'receipt persisted before broadcast');if(lostBroadcast)throw Error('Gateway timeout');return readPendingBurn().signature;},
      getParsedTransaction:async()=>({meta:{err:null}})},
  };
  return {state,controller:createFundedTradingController(state),counts:()=>({signed,sent,indexed}),input};
}
test('burn uses a finalized transaction receipt despite refreshed wallet/global supply state', async t => {
  const qa=setup(t);await qa.controller.submitFundedBurn();
  assert.deepEqual(qa.counts(),{signed:1,sent:1,indexed:1});assert.equal(readPendingBurn(),null);
  assert.match(qa.state.fundedBurnState.message,/finalized and recorded/);assert.equal(qa.input.value,'');
});
test('lost broadcast is recovered by original signature without signing or burning twice', async t => {
  const qa=setup(t,{lostBroadcast:true});await qa.controller.submitFundedBurn();
  const saved=readPendingBurn();assert.ok(saved);assert.match(qa.state.fundedBurnState.message,/pending/);
  await qa.controller.submitFundedBurn();
  assert.deepEqual(qa.counts(),{signed:1,sent:1,indexed:1});assert.equal(readPendingBurn(),null);
});
test('storage denial stops burn before broadcast', async t => {
  const qa=setup(t,{storageDenied:true});await qa.controller.submitFundedBurn();
  assert.equal(qa.counts().sent,0);assert.equal(qa.counts().indexed,0);
});
test('an unavailable receipt retains recovery and blocks another signed burn', async t => {
  const qa=setup(t);qa.state.apiRequest=async()=>({available:false});
  await qa.controller.submitFundedBurn();const signature=readPendingBurn().signature;
  await qa.controller.submitFundedBurn();assert.equal(readPendingBurn().signature,signature);
  assert.deepEqual(qa.counts(),{signed:1,sent:1,indexed:0});
});
