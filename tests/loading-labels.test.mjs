import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
function load(name,next,context){const start=source.indexOf(`function ${name}(`),end=source.indexOf(`function ${next}(`,start);assert(start>=0&&end>start);vm.runInNewContext(source.slice(start,end),context);return context[name];}
test('payout loading ends on success, missing fields, and completed failure',()=>{
 const container={innerHTML:''};const context={analyticsSummary:null,receiptEvidenceChecked:false,EXPLORE_CLUSTER:'devnet',document:{querySelector:()=>container},escapeHtml:String,shortAddress:String,formatPayoutSol:()=> '0'};
 const render=load('renderExplorePayoutStats','exploreSocialLinksMarkup',context);
 render();assert.match(container.innerHTML,/Checking finalized/);
 context.analyticsSummary={feePayoutStats:{cluster:'devnet',commitment:'finalized',creator:{status:'verified',paidLamports:'0',payoutCount:0}}};
 render();assert.doesNotMatch(container.innerHTML,/Checking|data-state="loading"/);assert.match(container.innerHTML,/0 finalized payments/);
 context.analyticsSummary=null;context.receiptEvidenceChecked=true;
 render();assert.doesNotMatch(container.innerHTML,/Checking|data-state="loading"/);assert.match(container.innerHTML,/unavailable/);
});
test('empty successful feeds leave the waiting state and outages remain visible',()=>{
 const count={},detail={};const lane={dataset:{exploreLane:'launch'},querySelector:s=>s==='strong'?count:detail,classList:{toggle(){}},setAttribute(){}};
 const context={exploreLastVerifiedAt:null,exploreUpdatedAt:null,exploreFeedAvailable:false,exploreProviderStatus:'On-chain only · loading',exploreTab:'new',exploreNewLane:'launch',filterMarketRecords:()=>[],document:{querySelector:()=>null,querySelectorAll:()=>[lane]}};
 const render=load('renderExplorePulse','exploreEmptyReason',context);
 render([]);assert.match(detail.textContent,/Waiting/);
 Object.assign(context,{exploreUpdatedAt:'2026-10-10',exploreFeedAvailable:true,exploreProviderStatus:'No indexed launches'});
 render([]);assert.equal(count.textContent,'00');assert.doesNotMatch(detail.textContent,/Waiting/);
 context.exploreProviderStatus='Solana RPC unavailable';render([]);assert.match(detail.textContent,/unavailable/);
});
