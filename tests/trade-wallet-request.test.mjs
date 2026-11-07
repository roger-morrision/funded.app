import test from 'node:test';
import assert from 'node:assert/strict';
import { createTradeExecutionController } from '../src/app/controllers/trade-execution.js';

function setup(t, {side='buy', balance=true, prefs={}, fee=5000} = {}) {
  const previousDocument=globalThis.document, previousStorage=globalThis.localStorage;
  const wallet='11111111111111111111111111111111', mint='22222222222222222222222222222222';
  const inputs={mint,side,amount:0.1,slippagePercent:1,valid:true};
  const elements=Object.fromEntries(Object.entries({mint,side,amount:'0.1',slippage:'1'}).map(([key,value])=>['#trade-'+key,{value}]));
  globalThis.document={querySelector:selector=>elements[selector]||null};
  globalThis.localStorage={getItem:key=>key.includes('trade-preferences')?JSON.stringify(prefs):'[]'};
  t.after(()=>{globalThis.document=previousDocument;globalThis.localStorage=previousStorage;});
  const session={address:wallet,provider:{publicKey:wallet}}, requests=[], messages=[];
  const quote={inputKey:`${mint}:${side}:0.1:1:${wallet}`,preparedAt:Date.now(),trade:{user:wallet,instructions:[],feeLamports:1000}};
  const app={wallet:session.provider,connectedWalletAddress:wallet,tradeActionBusy:false,tradeQuoteVersion:0,
    tradePreview:quote,pendingTradeVerifications:new Map(),TRADE_FEE_OWNER:wallet,TRADE_FEE_BPS:100,
    tradeInputs:()=>inputs,captureWalletSession:()=>session,canSignTransactions:()=>true,
    updateTradeActionState(){},prepareTradeQuote:async()=>quote,
    getTradePreviewConnection:async()=>({getLatestBlockhash:async()=>({blockhash:'mock'}),getFeeForMessage:async()=>({value:fee})}),
    getSolana:async()=>({Transaction:class {add(){return this;}compileMessage(){return {};}}}),
    connection:{getBalance:async()=>1000000000},hasBuyBalance:()=>balance,
    assertWalletSessionCurrent(){},isWalletSessionCurrent:()=>true,currentTradePreview:()=>app.tradePreview,
    parseTradeAmountInput:Number,getCoinMintAddress:()=>null,renderRoundTripAction(){},queueTradeQuote(){},
    invalidateTradePreview(){app.tradeQuoteVersion++;app.tradePreview=null;},
    setTradeStatus:message=>messages.push(message),setTradeReceiptStatus:message=>messages.push(message),
    tradePreviewFailureMessage:error=>error.message,
    // Stop at the wallet boundary: no signatures, broadcast or real wallet interaction.
    submitTrade:async request=>{requests.push(request);throw Object.assign(new Error('User rejected'),{code:4001});},
  };
  return {app,inputs,quote,requests,messages,controller:createTradeExecutionController(app)};
}

for(const side of ['buy','sell']) test(`${side} requests wallet approval directly and handles cancellation`,async t=>{
  const {app,controller,requests,quote,messages}=setup(t,{side});
  await controller.requestTradeSignature();
  assert.equal(requests.length,1);assert.equal(requests[0].side,side);
  assert.equal(requests[0].preparedTrade,quote.trade);
  assert.match(messages.at(-1),/Wallet approval cancelled/);
  assert.equal(app.tradeActionBusy,false);assert.equal(app.pendingTradeVerifications.size,0);
});

test('double clicks request only one wallet approval',async t=>{
  const {app,controller,requests,quote}=setup(t);
  let release;app.prepareTradeQuote=()=>new Promise(resolve=>{release=()=>resolve(quote);});
  const first=controller.requestTradeSignature();await controller.requestTradeSignature();release();await first;
  assert.equal(requests.length,1);
});

test('quote changes during preparation prevent wallet signing',async t=>{
  const {app,controller,requests,quote}=setup(t);
  app.prepareTradeQuote=async()=>{app.tradeQuoteVersion++;return quote;};
  await controller.requestTradeSignature();assert.equal(requests.length,0);assert.equal(app.tradeActionBusy,false);
});

test('insufficient buy balance prevents wallet signing',async t=>{
  const {controller,requests,messages}=setup(t,{balance:false});
  await controller.requestTradeSignature();assert.equal(requests.length,0);assert.match(messages.at(-1),/Insufficient SOL/);
});

for(const [label,options] of [['slippage cap',{prefs:{slippageCap:0.5}}], ['network fee cap',{prefs:{maximumNetworkSol:'0.000001'}}], ['unknown network fee',{prefs:{maximumNetworkSol:'0.001'},fee:null}]])
test(`${label} prevents signing`,async t=>{
    const {controller,requests,messages}=setup(t,options);
    await controller.requestTradeSignature();assert.equal(requests.length,0);assert.match(messages.at(-1),/cap|fee is unavailable/);
});

test('unverified earlier trade blocks another wallet request',async t=>{
  const {app,inputs,controller,requests,messages}=setup(t);
  app.pendingTradeVerifications.set('pending',{signature:'pending',mint:inputs.mint,walletAddress:app.connectedWalletAddress,broadcastUncertain:true});
  await controller.requestTradeSignature();assert.equal(requests.length,0);assert.match(messages.at(-1),/saved trade/);
});
