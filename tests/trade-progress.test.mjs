import test from 'node:test';
import assert from 'node:assert/strict';
import {createTradeExecutionController} from '../src/app/controllers/trade-execution.js';
import {readTradeRecovery,recordTradeRecovery} from '../src/features/experience/trade-recovery-store.js';
import {recoveryItems} from '../src/features/experience/recovery-inbox.js';
const wallet='2'.repeat(32),mint='1'.repeat(32),signature='5'.repeat(64);
function fixture(){
  const oldDocument=globalThis.document,oldStorage=globalThis.localStorage,values=new Map(),messages=[];
  globalThis.localStorage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
  const button={hidden:true,disabled:false,dataset:{}},fields={'#trade-mint':{value:mint},'#trade-side':{value:'sell'},
    '#trade-amount':{value:'1'},'#trade-slippage':{value:'1'},'#trade-verify':button};
  globalThis.document={querySelector:selector=>fields[selector]||null};
  const session={address:wallet,provider:{publicKey:wallet}};
  const state={wallet:session.provider,connectedWalletAddress:wallet,connection:{},captureWalletSession:()=>session,
    canSignTransactions:()=>true,isWalletSessionCurrent:()=>true,assertWalletSessionCurrent(){},parseTradeAmountInput:Number,
    tradeInputs:()=>({mint,side:'sell',amount:1,slippagePercent:1,valid:true}),TRADE_FEE_OWNER:wallet,TRADE_FEE_BPS:100,
    tradePreview:{inputKey:`${mint}:sell:1:1:${wallet}`,preparedAt:Date.now(),trade:{feeLamports:100}},
    currentTradePreview:()=>state.tradePreview,pendingTradeVerifications:new Map(),getCoinMintAddress:()=>mint,
    setTradeStatus:message=>messages.push(message),setTradeReceiptStatus:(message,sig)=>messages.push({message,sig}),
    updateTradeActionState(){},renderRoundTripAction(){},invalidateTradePreview(){},queueTradeQuote(){}};
  return{state,button,messages,controller:createTradeExecutionController(state),restore(){globalThis.document=oldDocument;globalThis.localStorage=oldStorage;}};
}

test('overlapping approval calls submit at most once and preserve a prepared signature even without an error signature',async()=>{
  const f=fixture();let resolve,submissions=0;
  const wait=new Promise(done=>{resolve=done;});
  f.state.submitTrade=async({onPrepared})=>{submissions++;onPrepared({signature,lastValidBlockHeight:100});await wait;throw new Error('private transport URL');};
  try{
    const first=f.controller.executeTrade();await Promise.resolve();await f.controller.executeTrade();
    assert.equal(submissions,1);resolve();await first;
    const row=readTradeRecovery().find(row=>row.signature===signature);
    assert.equal(row.progress,'signed');assert.equal(row.lastValidBlockHeight,100);assert.equal(row.state,'pending');
    assert.equal(f.state.pendingTradeVerifications.size,1);assert.equal(f.state.tradeActionBusy,false);
    assert.match(f.messages.at(-1).message,/saved transaction is preserved/);
    assert.doesNotMatch(JSON.stringify(f.messages),/private transport|No trade was submitted/);
  }finally{resolve();f.restore();}
});

test('wallet rejection before a signed identity is recorded reports cancellation without a recovery record',async()=>{
  const f=fixture();f.state.submitTrade=async()=>{throw Object.assign(new Error('rejected'),{code:4001});};
  try{await f.controller.executeTrade();assert.match(f.messages.at(-1),/Wallet approval cancelled/);assert.equal(readTradeRecovery().length,0);}
  finally{f.restore();}
});

test('finalization timeout retains confirmed progress and does not expose provider diagnostics',async()=>{
  const f=fixture();f.state.submitTrade=async()=>({signature,lastValidBlockHeight:100,feeLamports:100});
  f.state.waitForSignatureConfirmation=async()=>{throw new Error('private RPC response');};
  try{
    await f.controller.executeTrade();const row=readTradeRecovery()[0];
    assert.equal(row.progress,'confirmed');assert.equal(row.broadcastUncertain,false);assert.equal(row.state,'pending');
    assert.match(recoveryItems(wallet,[],[row])[0].detail,/was confirmed/);assert.doesNotMatch(JSON.stringify(f.messages),/private RPC/);
  }finally{f.restore();}
});

test('duplicate verification clicks do not duplicate RPC reads and missing evidence never becomes success',async()=>{
  const f=fixture();let resolve,reads=0;const wait=new Promise(done=>{resolve=done;});
  f.state.pendingTradeVerifications.set(signature,{signature,mint,walletAddress:wallet,side:'sell'});
  f.state.connection.getParsedTransaction=async()=>{reads++;await wait;throw new Error('private provider URL');};
  f.state.apiRequest=async()=>({available:false});f.state.assessTradeCompletion=()=>({receiptVerified:false,complete:false});
  try{
    const first=f.controller.verifyPendingTrade(null,signature);await f.controller.verifyPendingTrade(null,signature);
    assert.equal(reads,1);assert.equal(f.button.disabled,true);assert.equal(f.button.textContent,'Checking…');
    resolve();await first;assert.equal(f.state.pendingTradeVerifications.size,1);assert.equal(f.button.disabled,false);
    assert.equal(f.button.textContent,'Check recorded trade');assert.match(f.messages.at(-1).message,/verification is unavailable/);
    assert.doesNotMatch(JSON.stringify(f.messages),/private provider/);
  }finally{resolve();f.restore();}
});

test('indexing progress survives reload, stays wallet-scoped and keeps only public allowlisted fields',()=>{
  const f=fixture();
  try{
    recordTradeRecovery({signature,mint,walletAddress:wallet,side:'buy',progress:'indexing',broadcastUncertain:false,secret:'excluded'});
    const rows=readTradeRecovery();assert.equal(rows[0].progress,'indexing');assert.equal(rows[0].secret,undefined);
    assert.match(recoveryItems(wallet,[],rows)[0].detail,/Trade history is still being updated/);
    assert.equal(recoveryItems('3'.repeat(32),[],rows).length,0);
    recordTradeRecovery({...rows[0],progress:'untrusted-success'});assert.equal(readTradeRecovery()[0].progress,'signed');
  }finally{f.restore();}
});

test('receipt recovery becomes complete only after both finalized balance proof and indexed history',async()=>{
  const f=fixture();let indexed=false,success=0,submits=0;
  f.state.pendingTradeVerifications.set(signature,{signature,mint,walletAddress:wallet,side:'buy',broadcastUncertain:true});
  f.state.connection.getParsedTransaction=async()=>({meta:{err:null}});f.state.apiRequest=async()=>({available:true,data:{}});
  f.state.assessTradeCompletion=()=>({receiptVerified:true,complete:indexed});
  f.state.submitTrade=()=>submits++;f.state.productEvent=()=>success++;
  for(const name of ['rememberRoundTripReceipt','showToast','refreshWalletInfo','refreshPortfolioHoldings','loadCoinOnChain'])f.state[name]=()=>{};
  try{
    await f.controller.verifyPendingTrade(null,signature);assert.equal(success,0);assert.equal(readTradeRecovery()[0].state,'pending');
    assert.equal(f.button.textContent,'Check trade history');indexed=true;
    await f.controller.verifyPendingTrade(null,signature);assert.equal(success,1);assert.equal(submits,0);
    assert.equal(readTradeRecovery()[0].state,'verified');assert.equal(f.state.pendingTradeVerifications.size,0);assert.equal(f.button.hidden,true);
  }finally{f.restore();}
});
