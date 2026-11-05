import test from 'node:test';
import assert from 'node:assert/strict';
import {createCoinMarketController} from '../src/app/controllers/coin-market.js';
test('SOL quote refresh displays token spot price rather than reserve balance',async()=>{
 const fields=new Map(),app={coinSolUsdValues:{spot:0.00002,marketCap:100,reserve:90},coinMarketActivity:{},assets:[],EXPLORE_CLUSTER:'devnet',
  apiRequest:async()=>({available:true,data:{priceUsd:100}}),formatUsd:n=>`$${n}`,setCoinField:(id,value)=>fields.set(id,value)};
 for(const name of ['publishTokenListMarkets','renderFundedTokenLanding','renderCoinSummary','renderCoinPricePath','renderCoinPulse','renderCoinActivityTab','renderExploreAssets','renderRegistry','renderHomeLaunchBoard','renderHomeKpiDashboard','renderOnchainReportState'])app[name]=()=>{};
 const controller=createCoinMarketController(app);for(const name of ['formatCoinUsd','formatCoinSnapshotUsd','formatExploreUsd'])app[name]=controller[name];const previous=globalThis.document;globalThis.document={querySelector:()=>null};
 try{await controller.loadSolUsdQuote();assert.equal(fields.get('#coin-liquidity'),'$0.002');assert.equal(fields.get('#coin-liquidity'),fields.get('#coin-price'));assert.notEqual(fields.get('#coin-liquidity'),'$9000');
  app.coinSolUsdValues.spot=null;await controller.loadSolUsdQuote();assert.equal(fields.get('#coin-liquidity'),'$—');
 }finally{globalThis.document=previous;}
});
