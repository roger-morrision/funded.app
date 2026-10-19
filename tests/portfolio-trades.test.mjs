import test from 'node:test';
import assert from 'node:assert/strict';
import { createPortfolioController } from '../src/app/controllers/portfolio.js';
import { PublicKey } from '@solana/web3.js';

const wallet='ER7zhtSwfSu7B5Wb7uFwnWSZPLMmezmSXieY5JyLFzXC';
const mint='HdGmAbwR1ng3VTQkQ6Gw3QYhJGebWNFf5voktjCKwhvL';
function payload(owner=wallet){return {wallet:owner,cluster:'devnet',source:'finalized-wallet-pump-trades',
  coverage:'complete',scannedSignatures:7,signatureLimit:50,rowLimit:100,trades:[{
    trader:owner,mint,side:'buy',signature:'3'.repeat(64),slot:100,blockTime:Math.floor(Date.now()/1000)-10,
    finalized:true,solLamports:'247365234',tokenAmountRaw:'76701475546672',decimals:6}]};}
function fixture(request){
  let latest;
  const state={connectedWalletAddress:wallet,EXPLORE_CLUSTER:'devnet',assets:[],verifiedLaunchPolicies:[{mint,symbol:'FPQA'}],
    exploreScannedCount:0,portfolioHoldings:{wallet,status:'ready',accounts:[]},apiRequest:request,
    validateSolanaMint:value=>{try{new PublicKey(value);return{valid:true};}catch{return{valid:false};}},
    collectRecentTrades:()=>{throw new Error('Connected history must not depend on the Explore preview.');},
    renderPortfolioView:data=>{latest=data;},renderWalletDetail:()=>{}};
  const controller=createPortfolioController(state);Object.assign(state,controller);
  // The controller's real wallet-detail renderer is unrelated to this fixture.
  state.renderWalletDetail=()=>{};
  return {state,controller,view:()=>latest};
}

test('connected portfolio loads wallet receipts with zero scanned Explore coins and no holdings',async()=>{
  let finish,calls=0;const f=fixture(async()=>{calls++;return new Promise(resolve=>{finish=resolve;});});
  const pending=f.controller.refreshPortfolioTrades();
  assert.equal(f.view().portfolioTradeHistory.status,'loading');
  assert.equal(f.controller.refreshPortfolioTrades(),pending);
  finish({available:true,data:payload()});await pending;
  assert.equal(calls,1);assert.equal(f.view().exploreScannedCount,0);
  assert.equal(f.view().portfolioTradeHistory.status,'ready');
  const rows=f.controller.walletDetailTrades(wallet);
  assert.equal(rows.length,1);assert.equal(rows[0].symbol,'FPQA');assert.equal(rows[0].solAmount,0.247365234);
});

test('wallet history errors remain unavailable and reject wrong wallet, network or unfinalized data',async()=>{
  const bad=[null,{...payload(),wallet:mint},{...payload(),cluster:'mainnet-beta'},
    {...payload(),trades:[{...payload().trades[0],finalized:false}]}];
  for (const data of bad) {
    const f=fixture(async()=>({available:Boolean(data),data}));await f.controller.refreshPortfolioTrades();
    assert.equal(f.view().portfolioTradeHistory.status,'unavailable');
    assert.deepEqual(f.controller.walletDetailTrades(wallet),[]);
  }
});

test('disconnect and reconnect cannot adopt an old in-flight wallet response',async()=>{
  const finishes=[];const f=fixture(async()=>new Promise(resolve=>finishes.push(resolve)));
  const old=f.controller.refreshPortfolioTrades();
  f.state.connectedWalletAddress=null;await f.controller.refreshPortfolioTrades();
  f.state.connectedWalletAddress=wallet;const fresh=f.controller.refreshPortfolioTrades();
  assert.equal(finishes.length,2);
  finishes[0]({available:true,data:payload()});await old;
  assert.equal(f.view().portfolioTradeHistory.status,'loading');
  finishes[1]({available:true,data:payload()});await fresh;
  assert.equal(f.view().portfolioTradeHistory.status,'ready');
});
