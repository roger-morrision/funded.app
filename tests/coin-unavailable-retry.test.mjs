import test from 'node:test';
import assert from 'node:assert/strict';
import {renderMarketStatus} from '../src/features/coin/market-status.js';
import {createCoinStateController} from '../src/app/controllers/coin-state.js';

function fixture(){
 const nodes=new Map(),button={hidden:false,disabled:false},message={textContent:''};
 const node={dataset:{},isConnected:false,querySelector:s=>s==='p'?message:button,
  remove(){this.isConnected=false;nodes.delete('#coin-market-status');}};
 const header={after(n){n.isConnected=true;nodes.set('#coin-market-status',n);}};
 const page={querySelector:s=>s==='.coin-header'?header:nodes.get(s),prepend(n){header.after(n);}};
 const document={querySelector:s=>s==='#coin-page'?page:nodes.get(s)||null,querySelectorAll:()=>[],createElement:()=>node};
 return {document,node,button,message,nodes};
}
test('unavailable and partial history have one retry that disables while its request runs',async()=>{
 const f=fixture();let resolve,calls=0;
 const retry=()=>{calls++;return new Promise(done=>{resolve=done;});};
 renderMarketStatus({mint:'mint-a',available:false,retry},f.document);
 assert.match(f.message.textContent,/does not mean zero/);assert.equal(f.button.hidden,false);
 const pending=f.button.onclick();assert.equal(f.button.disabled,true);assert.equal(calls,1);
 resolve();await pending;assert.equal(f.button.disabled,false);
 renderMarketStatus({mint:'mint-a',available:true,coverage:'partial',retry},f.document);
 assert.equal(f.nodes.size,1);assert.equal(f.button.hidden,false);assert.match(f.message.textContent,/Some history is missing/);
 renderMarketStatus({mint:'mint-a',available:true,coverage:'complete',retry},f.document);
 assert.equal(f.button.hidden,true);
});
test('changing token clears the old market status before resetting data',()=>{
 const f=fixture(),priorDocument=globalThis.document,priorWindow=globalThis.window;
 globalThis.document=f.document;globalThis.window={};
 renderMarketStatus({mint:'old',available:false,retry:async()=>{}},f.document);
 const state=new Proxy({EXPLORE_CLUSTER:'devnet'},{get:(o,k)=>k in o?o[k]:(()=>{})});
 try {createCoinStateController(state).resetCoinSurface('new');assert.equal(f.node.isConnected,false);assert.equal(f.nodes.size,0);}
 finally {globalThis.document=priorDocument;globalThis.window=priorWindow;}
});
