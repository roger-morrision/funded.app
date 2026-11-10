import test from 'node:test';
import assert from 'node:assert/strict';
import {communityTradeMetrics,createCommunityTradeReader} from '../server/community-trade-metrics.mjs';
import {createTokenChatRoutes} from '../server/routes/token-chat.mjs';
import {burnHistoryTable,burnTimestamp} from '../src/features/funded/burn-history-table.js';
const wallet='ER7zhtSwfSu7B5Wb7uFwnWSZPLMmezmSXieY5JyLFzXC',mint='AqSK8Dpov641bGo2LWpkMjE1nf7dsZuHkqBBm5Pkeww8',now=Date.now();
const trade=(side,amount,sol,slot=1)=>({side,mint,trader:wallet,decimals:6,tokenAmountRaw:String(amount),solLamports:String(sol),slot,logIndex:1,signature:'s'+slot,finalized:true});
const history=(trades,extra={})=>({wallet,cluster:'devnet',source:'finalized-wallet-pump-trades',coverage:'complete',observedAt:new Date(now).toISOString(),trades,adjustedMints:[],...extra});
const metrics=(h,extra={})=>communityTradeMetrics({history:h,mint,heldRaw:'10000000',priceSol:.2,priceAt:new Date(now).toISOString(),now,...extra});
test('verified buys and remaining mark-to-market produce actual trade P&L',()=>{
  const r=metrics(history([trade('buy',10000000,1500000000)]));assert.equal(r.purchasedSol,1.5);assert.equal(r.pnlSol,.5);
});
test('sales plus remaining value count cost once, including complete exits',()=>{
  const h=history([trade('buy',10000000,1500000000),trade('sell',4000000,1000000000,2)]);
  assert.ok(Math.abs(metrics(h,{heldRaw:'6000000'}).pnlSol-.7)<1e-10);
  assert.equal(metrics(history([trade('buy',10000000,1500000000),trade('sell',10000000,1000000000,2)]),{heldRaw:'0',priceSol:null}).pnlSol,-.5);
});
test('partial history, transfers, opening holdings and missing price never invent profit',()=>{
  const rows=[trade('buy',10000000,1500000000)];
  for(const h of [history(rows,{coverage:'partial'}),history(rows,{adjustedMints:[mint]})]){const r=metrics(h);assert.equal(r.purchasedSol,1.5);assert.equal(r.pnlSol,null);}
  assert.equal(metrics(history(rows),{heldRaw:'20000000'}).pnlSol,null);
  assert.equal(metrics(history(rows),{priceAt:new Date(now-61000).toISOString()}).pnlSol,null);
  assert.equal(metrics(history([trade('sell',10000000,1500000000)])).pnlSol,null);
});
test('deduplicates event identity, rejects invalid proof and preserves unavailable vs zero',()=>{
  const t=trade('buy',10000000,1500000000);
  assert.equal(metrics(history([t,t])).purchasedSol,1.5);
  assert.equal(metrics(history([{...t,finalized:false}])).purchasedSol,null);
  assert.equal(metrics(history([])).purchasedSol,0);
  assert.equal(metrics(null).purchasedSol,null);
});
test('feed scans are cached, authors coalesced and concurrency bounded',async()=>{
  let calls=0,active=0,maximum=0;
  const reader=createCommunityTradeReader({cluster:'devnet',readHistory:async()=>{calls++;active++;maximum=Math.max(maximum,active);await new Promise(r=>setTimeout(r,10));active--;return history([trade('buy',10000000,1500000000)]);},
    makeConnection:()=>({getParsedTokenAccountsByOwner:async()=>({value:[{account:{data:{parsed:{info:{tokenAmount:{amount:'10000000'}}}}}}]})}),
    readMarketCaps:async()=>({[mint]:{priceSol:.2,observedAt:new Date(now).toISOString()}})});
  const rows=[1,2,3].map(id=>({id:String(id),author:wallet,mint,callout:{}}));
  const [first,second]=await Promise.all([reader(rows),reader(rows)]);assert.equal(calls,1);assert.equal(maximum,1);assert.equal(first['1'].pnlSol,.5);assert.equal(second['3'].pnlSol,.5);
  await reader(rows);assert.equal(calls,1);
});
test('public chat feed exposes verified metrics, with market movement kept separate',async()=>{
  let response;
  const route=createTokenChatRoutes({store:{readRecentCoinChats:async()=>[{id:'1',mint,author:wallet,callout:{marketCapSol:1}}]},respond:(_r,_s,data)=>{response=data;},
    readCalloutFeed:async()=>({callouts:[{id:'1',multiple:1.2}]}),readTradeMetrics:async()=>({'1':{purchasedSol:1.5,pnlSol:.5,windowHours:24}})});
  await route({method:'GET'},{},new URL('http://local/api/token-chat/feed'));
  assert.equal(response.messages[0].callout.purchasedSol,1.5);assert.equal(response.messages[0].callout.pnlSol,.5);assert.ok(response.messages[0].callout.marketChangePercent>19.9);
});
test('burn timestamps use transaction time, never indexing time; table deduplicates receipts',()=>{
  assert.equal(burnTimestamp({verifiedAt:new Date(now).toISOString()}),null);
  assert.equal(burnTimestamp({atomicWithPumpLaunch:true},{blockTime:1794038765}),'2026-11-07T08:06:05.000Z');
  const receipt={signature:'1'.repeat(88),blockTime:1794038765,amountTokens:137};
  const html=burnHistoryTable({feeReceipts:[],launchBurns:[],standaloneReceipts:[receipt,receipt],exploreExplorer:x=>'https://explorer.solana.com/'+x,fundedReceiptProject:()=>'<img>'});
  assert.equal((html.match(/View receipt/g)||[]).length,1);assert.match(html,/08:06:05 UTC/);assert.match(html,/&lt;img&gt;/);assert.equal((html.match(/scope="col"/g)||[]).length,7);
});

import {agencyTokenTable} from '../src/features/marketing/agency-token-table.js';
import {describeTradeQuote} from '../trade-quote-display.js';
test('agency queue shows registered tokens while withholding stale balances',()=>{
 const html=agencyTokenTable({status:'deployment-verified',publishingPaused:true,launches:[{mint,symbol:'FCAT',status:'awaiting-fresh-finalized-snapshot',paidLamports:'9999999999'}]});
 assert.match(html,/FCAT/);assert.match(html,/Awaiting fresh snapshot/);assert.doesNotMatch(html,/9.999999999/);assert.equal((html.match(/scope="col"/g)||[]).length,10);
});
test('buy quote uses the actual token symbol; sell output stays SOL',()=>{
 const trade={side:'buy',tokenDecimals:6,outputAmount:123804454967255n,minimumOutputAmount:122566410417582n,feeLamports:1000000,route:'curve'};
 const quote=describeTradeQuote(trade,1,'FCAT');assert.equal(quote.outputSymbol,'FCAT');assert.equal(quote.minimum,122566410.417582);
 assert.equal(describeTradeQuote({...trade,side:'sell'},1,'FCAT').outputSymbol,'SOL');
});

import {buildCoinSummary} from '../coin-summary-model.js';
test('fee summary separates verified allocation, unknown payments and estimated airdrops',()=>{
 const launch={mint,cluster:'devnet',onchainVerified:true,symbol:'FCAT',feeDistribution:{creatorDirected:{shares:{holderAirdropPercent:40}}},communityAirdrop:{reservedTokens:30},creatorLaunchBurn:{status:'verified',amountTokens:137,receipt:{signature:'receipt'}}};
 const input={mint,cluster:'devnet',launch,ledgerMint:mint,overview:{available:true,scope:'per-mint-v3',collections:[]},solUsd:100,tokenSpotSol:.001};
 const cards=buildCoinSummary(input).cards;
 assert.equal(cards.find(x=>x.id==='fees').amount,0);assert.equal(cards.find(x=>x.id==='referrals').amount,null);
 assert.equal(cards.find(x=>x.id==='airdrop').state,'partial');assert.equal(cards.find(x=>x.id==='airdrop').amount,3);
 assert.equal(cards.find(x=>x.id==='burn').amount,137);
 assert.equal(buildCoinSummary({...input,ledgerMint:'another-mint'}).cards.find(x=>x.id==='fees').amount,null);
 assert.equal(buildCoinSummary({...input,overview:{available:true,collectedLamports:''}}).cards.find(x=>x.id==='fees').amount,null);
});
