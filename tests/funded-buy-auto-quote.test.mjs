import test from 'node:test';
import assert from 'node:assert/strict';
import {PublicKey} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID} from '@solana/spl-token';
import {DEFAULT_SERVICE_FEES} from '../service-fees.js';
import {createFundedBuyQuotes,currentFundedBuyQuote} from '../src/features/funded/buy-quotes.js';
import {createFundedTradingController} from '../src/app/controllers/funded-trading.js';
const mint='So11111111111111111111111111111111111111112';
function fixture(t,{connected=true}={}) {
  let now=100_000,visible=true,builds=0,submits=0,finalizations=0;
  t.mock.method(Date,'now',()=>now);
  const previous=globalThis.document,input={value:'0.1',getClientRects:()=>visible?[{}]:[]};
  globalThis.document={hidden:false,querySelector:s=>s==='#funded-buy-amount'?input:null};
  t.after(()=>{globalThis.document=previous;});
  const provider={publicKey:new PublicKey(mint)},messages=[];
  const trade={instructions:[],feePolicy:{feeOwner:mint,feeBps:100},outputAmount:100n,minimumOutputAmount:100n,tokenDecimals:6};
  const rpc={getAccountInfo:async key=>String(key)===mint?{owner:TOKEN_PROGRAM_ID}:null,getTokenAccountBalance:async()=>({value:{amount:'100'}})};
  const app={APP_CLUSTER:'devnet',APP_MAINNET_READ_ONLY:false,PROTOCOL_FUNDED_MINT:mint,PROTOCOL_FUNDED_SWAP_POOL:mint,
    wallet:connected?provider:null,connectedWalletAddress:connected?mint:null,fundedBuyBusy:false,fundedBuyPreview:null,fundedBuyRoute:{status:'ready'},
    getTradePreviewConnection:async()=>rpc,canSignTransactions:()=>true,
    captureWalletSession:()=>({provider:app.wallet,address:app.connectedWalletAddress}),
    assertWalletSessionCurrent:s=>{assert.equal(s.provider,app.wallet);assert.equal(s.address,app.connectedWalletAddress);},
    apiRequest:async()=>({available:true,data:{cluster:'devnet',hash:'a'.repeat(64),revision:1,recipient:mint,tradeRecipient:mint,policy:DEFAULT_SERVICE_FEES}}),
    buildVerifiedPoolTradeTransaction:async()=>{builds++;return trade;},fetchVerifiedPoolBuyQuote:async()=>{builds++;return {...trade,instructions:undefined};},
    describeTradeQuote:()=>({expected:100,minimum:100,maximumSpendSol:.101,appFeeSol:.001}),
    renderFundedBuyControl:m=>{if(m)messages.push(m);},
    getSolana:async()=>({PublicKey,TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,getAssociatedTokenAddressSync:()=>new PublicKey('11111111111111111111111111111111')}),
    submitTrade:async args=>{submits++;assert.equal(args.preparedTrade,trade);return {...trade,signature:'mocked-receipt'};},
    waitForSignatureConfirmation:async()=>{finalizations++;},showToast(){},loadFundedBurnState:async()=>{},connectWallet:async()=>{},
  };
  const quotes=createFundedBuyQuotes(app);t.after(()=>quotes.pause());
  return {app,input,quotes,messages,trade,rpc,advance:n=>now+=n,hide:()=>visible=false,counts:()=>({builds,submits,finalizations})};
}
test('automatic public estimates need no wallet or signing and refresh on a bounded cadence',async t=>{
  const f=fixture(t,{connected:false});await f.quotes.refresh();assert.equal(f.app.fundedBuyPreview.quote.expected,100);
  assert.equal(f.app.fundedBuyPreview.trade.instructions,undefined);await f.quotes.refresh();assert.equal(f.counts().builds,1);
  f.advance(10_000);await f.quotes.refresh();assert.equal(f.counts().builds,2);
  f.hide();f.advance(20_000);await f.quotes.refresh();assert.equal(f.counts().builds,2);assert.equal(f.counts().submits,0);
});
test('an edited amount discards a late response and replaces it with the latest quote',async t=>{
  const f=fixture(t);let finish;f.app.buildVerifiedPoolTradeTransaction=()=>new Promise(resolve=>finish=resolve);
  const first=f.quotes.refresh();await new Promise(resolve=>setImmediate(resolve));
  f.input.value='0.5';f.quotes.invalidate();finish(f.trade);await first;assert.equal(f.app.fundedBuyPreview,null);
  f.app.buildVerifiedPoolTradeTransaction=async()=>f.trade;await f.quotes.refresh();assert.equal(f.app.fundedBuyPreview,null);
  f.advance(500);await f.quotes.refresh();assert.equal(f.app.fundedBuyPreview.amount,.5);
});
test('wallet changes and expired quotes cannot be used to buy',async t=>{
  const f=fixture(t);await f.quotes.refresh();assert.ok(currentFundedBuyQuote(f.app,.1));
  f.advance(15_000);assert.equal(currentFundedBuyQuote(f.app,.1),null);
  f.app.wallet={publicKey:new PublicKey(mint)};assert.equal(currentFundedBuyQuote(f.app,.1),null);
  const controller=createFundedTradingController(f.app);await controller.handleFundedBuy();assert.equal(f.counts().submits,0);
  // Cancel the controller's debounce without allowing a background test read.
  f.hide();
});
test('one Buy activation submits the displayed quote and verifies finalized balance growth',async t=>{
  const f=fixture(t);await f.quotes.refresh();const controller=createFundedTradingController(f.app);
  await controller.handleFundedBuy();assert.deepEqual(f.counts(),{builds:1,submits:1,finalizations:1});
  assert.equal(f.input.value,'');assert.match(f.messages.at(-1),/Buy finalized.*Received/);
});
test('quote expiry during preflight does not sign or submit',async t=>{
  const f=fixture(t);await f.quotes.refresh();f.rpc.getAccountInfo=async()=>{f.advance(16_000);return {owner:TOKEN_PROGRAM_ID};};
  await createFundedTradingController(f.app).handleFundedBuy();assert.equal(f.counts().submits,0);f.hide();
});
test('a missing balance increase is not reported as success and cannot trigger a background buy',async t=>{
  const f=fixture(t);await f.quotes.refresh();f.rpc.getTokenAccountBalance=async()=>({value:{amount:'0'}});
  await createFundedTradingController(f.app).handleFundedBuy();assert.equal(f.counts().submits,1);
  assert.match(f.messages.at(-1),/Confirmation is uncertain.*mocked-receipt/);assert.equal(f.input.value,'0.1');
});
