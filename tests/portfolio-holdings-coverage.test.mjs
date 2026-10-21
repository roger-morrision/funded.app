import test from 'node:test';
import assert from 'node:assert/strict';
import {createPortfolioController} from '../src/app/controllers/portfolio.js';
import {renderPortfolio} from '../src/features/portfolio/holdings-view.js';
import {aggregateTokenAccounts} from '../portfolio-model.js';

const account=(mint='priced')=>({account:{data:{parsed:{info:{mint,tokenAmount:{amount:'2000000',decimals:6}}}}}});
function fixture(outcomes=[[],[]]){
  const fields=new Map(),focus={id:'existing-refresh'},element=()=>({dataset:{},children:[],hidden:false,textContent:'',innerHTML:'',classList:{add(){}},append(...x){this.children.push(...x)},setAttribute(){},addEventListener(){},after(){},closest(){return null},querySelectorAll(){return[]}});
  const document={activeElement:focus,querySelector:s=>fields.get(s)||null,createElement:element};
  for(const k of['holdings-status','holding-rows','total-value','observed-pnl','trade-rows','trade-note','holdings-content','trades-content','holdings-disconnected','trades-disconnected'])fields.set('#portfolio-'+k,element());
  const reads=[],state={connectedWalletAddress:'memory-wallet-a',portfolioRequest:0,portfolioHoldings:{wallet:'',status:'idle',accounts:[],coverage:''},assets:[{address:'priced',symbol:'PRICED',curvePriceSol:3}],coinSolUsdPrice:1,verifiedLaunchPolicies:[],EXPLORE_CLUSTER:'devnet',validateSolanaMint:()=>({valid:true}),collectRecentTrades:()=>[],
    getSolana:async()=>({PublicKey:class{constructor(address){this.address=address}},TOKEN_PROGRAM_ID:'classic',TOKEN_2022_PROGRAM_ID:'token2022'}),
    getExploreConnection:async()=>({getParsedTokenAccountsByOwner:async(owner,{programId},commitment)=>{reads.push({address:owner.address,programId,commitment});const result=outcomes[programId==='classic'?0:1];if(result instanceof Error)throw result;return typeof result==='function'?result():{value:result}}}),aggregateTokenAccounts,
    apiRequest:async()=>({available:true,data:{wallet:state.connectedWalletAddress,cluster:'devnet',source:'finalized-wallet-pump-trades',coverage:'complete',scannedSignatures:0,signatureLimit:50,rowLimit:100,trades:[]}}),
    renderPortfolioView:(data,options)=>renderPortfolio(data,{...options,document})};
  const controller=createPortfolioController(state);Object.assign(state,controller);state.renderWalletDetail=()=>{};
  return{state,document,focus,reads,controller,set:x=>{outcomes=x},text:k=>fields.get('#portfolio-'+k).textContent,html:k=>fields.get('#portfolio-'+k).innerHTML};
}
const unavailable=()=>new Error('Controlled token-program failure');
for(const[name,outcomes,value,empty]of[
  ['complete empty',[[],[]],'$0.00',/No SPL token holdings/],
  ['classic unavailable',[unavailable(),[]],'—',/Some token balances could not be checked.*Refresh/],
  ['Token-2022 unavailable',[[],unavailable()],'—',/Some token balances could not be checked.*Refresh/],
  ['both unavailable',[unavailable(),unavailable()],'—',/unavailable from Solana RPC.*Refresh/],
  ['complete priced',[[account()],[]],'$6.00',/portfolio-holding-row/],
  ['partial priced classic',[[account()],unavailable()],'≥$6.00',/portfolio-holding-row/],
  ['partial priced Token-2022',[unavailable(),[account()]],'≥$6.00',/portfolio-holding-row/],
  ['complete unpriced subset',[[account(),account('unpriced')],[]],'≥$6.00',/unpriced/],
  ['partial unpriced subset',[[account(),account('unpriced')],unavailable()],'≥$6.00',/unpriced/],
  ['partial all unpriced',[[account('unpriced')],unavailable()],'—',/unpriced/],
])test(`holdings coverage: ${name}`,async()=>{
  const f=fixture(outcomes);await f.controller.refreshPortfolioHoldings();
  assert.equal(f.text('total-value'),value);assert.match(f.html('holding-rows'),empty);assert.equal(f.reads.length,2);
  assert.deepEqual(f.reads.map(x=>[x.programId,x.commitment]),[['classic','confirmed'],['token2022','confirmed']]);
  if(f.state.portfolioHoldings.coverage==='Partial token-program coverage'){
    assert.match(f.text('holdings-status'),/observed tokens?.*Partial token-program coverage.*Refresh/);
    assert.doesNotMatch(f.html('holding-rows'),/No SPL token holdings/);
  }
  assert.equal(f.text('observed-pnl'),'—');assert.equal(f.document.activeElement,f.focus);
});

test('same controller Refresh recovers partial to complete and back without changing admission',async()=>{
  const f=fixture([[],unavailable()]);
  for(const[outcomes,value]of[[[[],unavailable()],'—'],[[[],[]],'$0.00'],[[[account()],[]],'$6.00'],[[[account()],unavailable()],'≥$6.00']]){
    f.set(outcomes);await f.controller.refreshPortfolioHoldings();assert.equal(f.text('total-value'),value);assert.equal(f.document.activeElement,f.focus);
  }
  assert.equal(f.reads.length,8);f.state.connectedWalletAddress=null;await f.controller.refreshPortfolioHoldings();assert.equal(f.reads.length,8);assert.equal(f.text('total-value'),'—');assert.doesNotMatch(f.html('holding-rows'),/PRICED/);
});

test('loading and late old-address partial responses never restore stale rows or value',async()=>{
  let resolveClassic,resolve2022;const f=fixture([()=>new Promise(r=>{resolveClassic=r}),()=>new Promise(r=>{resolve2022=r})]);
  const pending=f.controller.refreshPortfolioHoldings();await new Promise(r=>setImmediate(r));
  assert.equal(f.text('total-value'),'—');assert.match(f.html('holding-rows'),/Checking live Solana/);
  f.state.connectedWalletAddress='memory-wallet-b';f.set([[],[]]);await f.controller.refreshPortfolioHoldings();assert.equal(f.text('total-value'),'$0.00');
  resolveClassic({value:[account()]});resolve2022({value:[]});await pending;
  assert.equal(f.state.portfolioHoldings.wallet,'memory-wallet-b');assert.equal(f.text('total-value'),'$0.00');assert.doesNotMatch(f.html('holding-rows'),/PRICED/);assert.equal(f.document.activeElement,f.focus);
});
