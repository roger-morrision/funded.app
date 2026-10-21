import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderPublicQuoteRetry,bindPublicQuoteRetry} from '../src/features/launch/cost-view.js';

// Execute the complete production controller body. Only the two SDK read-module
// imports are injected; clock, read results and DOM are deterministic fixtures.
const source=readFileSync(new URL('../src/app/controllers/launch-preview.js',import.meta.url),'utf8');
const marker=/await Promise\.all\(\[\s*import\('\.\.\/\.\.\/\.\.\/launch-flow\.js'\), import\('\.\.\/\.\.\/\.\.\/launch-core\.js'\),\s*\]\)/;
assert(marker.test(source));
const body=source.replace(/^import[^\n]*\n/,'').replace('export function createLaunchPreviewController','function createLaunchPreviewController').replace(marker,'await loadReadModules()');
function fixture(){
 let now=100000,next=0;const timers=new Map(),document={hidden:false,activeElement:null},fields=new Map();
 for(const id of['launch-public-quote-retry','launch-public-quote-retry-button','launch-public-quote-retry-status','public-launch-cost-heading'])fields.set('#'+id,{dataset:{},hidden:false,attributes:{},setAttribute(k,v){this.attributes[k]=v},focus(){document.activeElement=this}});
 document.querySelector=s=>fields.get(s)||null;
 const clock={now:()=>now,setTimeout:(fn,delay)=>{const id=++next;timers.set(id,{fn,at:now+delay});return id},clearTimeout:id=>timers.delete(id),async advance(ms){const end=now+ms;for(let i=0;i<100;i++){const entry=[...timers].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!entry)break;now=entry[1].at;timers.delete(entry[0]);entry[1].fn();for(let j=0;j<20;j++)await Promise.resolve()}now=end;for(let j=0;j<20;j++)await Promise.resolve()}};
 let failure=true,hold=null,reads=0,view,route='launch',reserve=30000000,buy=0;
 const state={wallet:null,requestedPageRoute:()=>route,getCommunityAirdropTokens:()=>reserve,getCreatorBuySol:()=>buy,LAUNCH_TOKEN_SUPPLY:1000000000,updateCostSummaryView:s=>{view=structuredClone(s.publicQuote)},updateLaunchPreviewView(){},updateQuoteCountdowns(){},
 getSolana:async()=>{reads++;if(failure)throw Error('Controlled read unavailable')},quoteAtomicReserveBuy:async()=>hold?hold.promise:{solAmountLamports:'8715246',maxSolAmountLamports:'8802399'}};
 const factory=new Function('renderPublicQuoteRetry','setTimeout','clearTimeout','Date','document','loadReadModules',body+'\nreturn createLaunchPreviewController;');
 const controller=factory((s)=>renderPublicQuoteRetry(s,{document,now}),clock.setTimeout,clock.clearTimeout,{now:()=>now},document,async()=>[{getInitialBuyQuote:async()=>({amountBaseUnits:'0',amountTokens:0})},{normalizeLaunchInput:x=>x}])(state);Object.assign(state,controller);
 return{state,controller,clock,document,fields,get reads(){return reads},get quote(){return view},setFailure:x=>{failure=x},setRoute:x=>{route=x},setInputs:(r,b=0)=>{reserve=r;buy=b},defer(){let resolve;hold={promise:new Promise(r=>{resolve=r})};return resolve},button:fields.get('#launch-public-quote-retry-button'),status:fields.get('#launch-public-quote-retry-status'),group:fields.get('#launch-public-quote-retry')};
}
test('unavailable quote retries once after unchanged cooldown, debounce and loading admission',async()=>{
 const f=fixture();f.controller.updateCostSummary();await f.clock.advance(299);assert.equal(f.reads,0);await f.clock.advance(1);assert.equal(f.reads,1);assert.equal(f.quote.status,'unavailable');assert.equal(f.button.attributes['aria-disabled'],'true');assert.match(f.status.textContent,/15s/);
 for(let i=0;i<5;i++)f.controller.updateCostSummary();assert.equal(f.reads,1);await f.clock.advance(14999);f.controller.updateCostSummary();assert.equal(f.quote.status,'unavailable');await f.clock.advance(1);f.setFailure(false);f.button.focus();f.controller.refreshQuoteClocks();assert.equal(f.button.attributes['aria-disabled'],'false');assert.equal(f.reads,1);
 const done=f.defer();f.controller.updateCostSummary();for(let i=0;i<5;i++)f.controller.updateCostSummary();await f.clock.advance(300);assert.equal(f.reads,2);assert.equal(f.quote.status,'loading');assert.match(f.status.textContent,/Requesting/);assert.equal(f.document.activeElement,f.button);
 done({solAmountLamports:'8715246',maxSolAmountLamports:'8802399'});await f.clock.advance(0);assert.equal(f.quote.status,'ready');assert.equal(f.group.hidden,true);assert.equal(f.document.activeElement,f.fields.get('#public-launch-cost-heading'));
 for(let i=0;i<5;i++)f.controller.updateCostSummary();await f.clock.advance(59999);f.controller.updateCostSummary();assert.equal(f.reads,2);await f.clock.advance(1);f.controller.updateCostSummary();await f.clock.advance(300);assert.equal(f.reads,3);
});
test('failure retains focus and a second cooldown without automatically retrying',async()=>{
 const f=fixture();f.controller.updateCostSummary();await f.clock.advance(300);f.button.focus();await f.clock.advance(15000);f.controller.updateCostSummary();await f.clock.advance(300);assert.equal(f.reads,2);assert.equal(f.quote.status,'unavailable');assert.equal(f.document.activeElement,f.button);assert.equal(f.button.attributes['aria-disabled'],'true');await f.clock.advance(30000);f.controller.refreshQuoteClocks();assert.equal(f.reads,2);assert.equal(f.button.attributes['aria-disabled'],'false');
});
test('success does not steal focus moved to a draft field',async()=>{
 const f=fixture();f.controller.updateCostSummary();await f.clock.advance(300);await f.clock.advance(15000);f.setFailure(false);const done=f.defer();f.button.focus();f.controller.updateCostSummary();await f.clock.advance(300);const input={id:'token-name'};f.document.activeElement=input;done({solAmountLamports:'1',maxSolAmountLamports:'2'});await f.clock.advance(0);assert.equal(f.quote.status,'ready');assert.equal(f.document.activeElement,input);
});
test('public quote timeout remains exactly twelve seconds and failure remains honest',async()=>{
 const f=fixture();f.setFailure(false);f.defer();f.controller.updateCostSummary();await f.clock.advance(300);await f.clock.advance(11999);assert.equal(f.quote.status,'loading');await f.clock.advance(1);assert.equal(f.quote.status,'unavailable');assert.match(f.status.textContent,/Quote unavailable/);
});
test('route, wallet, input and request changes retain existing admission and stale guards',async()=>{
 const f=fixture();f.setRoute('overview');f.controller.updateCostSummary();await f.clock.advance(400);assert.equal(f.reads,0);f.setRoute('launch');f.setInputs(-1);f.controller.updateCostSummary();assert.equal(f.quote.status,'invalid');assert.equal(f.group.hidden,true);assert.equal(f.reads,0);
 f.setInputs(30000000);f.setFailure(false);const finish=f.defer();f.controller.updateCostSummary();await f.clock.advance(300);f.state.wallet={};f.controller.updateCostSummary();finish({solAmountLamports:'1',maxSolAmountLamports:'2'});await f.clock.advance(0);assert.notEqual(f.quote?.status,'ready');assert.equal(f.group.hidden,true);
 const g=fixture();g.setFailure(false);const old=g.defer();g.controller.updateCostSummary();await g.clock.advance(300);g.setInputs(40000000);g.setFailure(true);g.controller.updateCostSummary();await g.clock.advance(300);old({solAmountLamports:'1',maxSolAmountLamports:'2'});await g.clock.advance(0);assert.equal(g.quote.status,'unavailable');assert.equal(g.reads,2);
});
test('connected wallet has no public quote action or public read scheduling',async()=>{
 const f=fixture();f.state.wallet={};f.controller.updateCostSummary();await f.clock.advance(60000);f.controller.refreshQuoteClocks();assert.equal(f.reads,0);assert.equal(f.group.hidden,true);
});
test('native binding rejects cooldown, connected, inactive and invalid actions',()=>{
 let click,allowed=true,route='launch',valid=true,calls=0;
 const button={getAttribute:()=>String(!allowed),addEventListener:(_,fn)=>{click=fn}},state={wallet:null,requestedPageRoute:()=>route,getLaunchStepState:()=>({valid}),updateCostSummary:()=>{calls++}};
 bindPublicQuoteRetry(state,{querySelector:()=>button});const press=()=>click({currentTarget:button});allowed=false;press();allowed=true;state.wallet={};press();state.wallet=null;route='overview';press();route='launch';valid=false;press();assert.equal(calls,0);valid=true;press();assert.equal(calls,1);
});
