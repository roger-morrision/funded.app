import test from 'node:test';
import assert from 'node:assert/strict';
import {renderPortfolio} from '../src/features/portfolio/holdings-view.js';
import {createPortfolioController} from '../src/app/controllers/portfolio.js';

function fixture(){
  const fields=new Map(),document={activeElement:{id:'user-owned-focus'},querySelector:s=>fields.get(s)||null};
  document.createElement=()=>({dataset:{},children:[],hidden:false,textContent:'',innerHTML:'',classList:{add(){}},append(...children){this.children.push(...children)},setAttribute(){},addEventListener(){},after(){},closest(){return null},querySelectorAll(){return[]}});
  for(const key of['holdings-status','holding-rows','total-value','observed-pnl','trade-rows','trade-note','holdings-content','trades-content','holdings-disconnected','trades-disconnected'])fields.set('#portfolio-'+key,document.createElement('div'));
  const state={connectedWalletAddress:null,portfolioHoldings:{wallet:'',status:'idle',accounts:[],coverage:''},assets:[{address:'mint-a',symbol:'ALPHA',priceUsd:3},{address:'mint-b',symbol:'BETA',priceUsd:null}],portfolioTradeHistory:null};
  const options={document,portfolioUnitPriceUsd:a=>a?.priceUsd??null,walletDetailTrades:()=>[],formatOnchainAge:String,exploreExplorer:x=>x};
  return{fields,document,state,render:()=>renderPortfolio(state,options),hidden:key=>fields.get('#portfolio-'+key).hidden,text:key=>fields.get('#portfolio-'+key).textContent,html:key=>fields.get('#portfolio-'+key).innerHTML};
}

test('disconnected portfolio hides retained connected content and restores it without moving focus',()=>{
  const f=fixture(),focus=f.document.activeElement;
  for(const address of[null,'wallet-a',null,'wallet-b']){
    f.state.connectedWalletAddress=address;f.render();
    for(const panel of['holdings','trades']){assert.equal(f.hidden(panel+'-content'),!address);assert.equal(f.hidden(panel+'-disconnected'),Boolean(address))}
    assert.equal(f.document.activeElement,focus);
  }
});

test('connected balances retain loading, ready-empty, partial-price and unavailable semantics',()=>{
  const f=fixture();f.state.connectedWalletAddress='wallet-a';
  for(const status of['loading','ready','unavailable']){
    f.state.portfolioHoldings={wallet:'wallet-a',status,accounts:[],coverage:'SPL Token and Token-2022'};f.render();
    assert.equal(f.hidden('holdings-content'),false);assert.equal(f.hidden('holdings-disconnected'),true);
    assert.match(f.html('holding-rows'),status==='loading'?/Checking live Solana/:status==='ready'?/No SPL token holdings/:/unavailable from Solana/);
    assert.equal(f.text('total-value'),status==='ready'?'$0.00':'—');
  }
  f.state.portfolioHoldings={wallet:'wallet-a',status:'ready',accounts:[{mint:'mint-a',quantity:2,decimals:6},{mint:'mint-b',quantity:7,decimals:6}],coverage:'Partial token-program coverage'};f.render();
  assert.equal(f.text('total-value'),'≥$6.00');assert.match(f.html('holding-rows'),/ALPHA/);assert.match(f.html('holding-rows'),/BETA/);assert.match(f.text('holdings-status'),/some values unavailable/);assert.equal(f.text('observed-pnl'),'—');
});

test('connected activity retains unavailable, loading, complete-empty and partial-empty coverage',()=>{
  const f=fixture();f.state.connectedWalletAddress='wallet-a';
  for(const[status,coverage,expected]of[['loading','unavailable',/Checking finalized/],['unavailable','unavailable',/history is unavailable/],['ready','complete',/No finalized Pump/],['ready','partial',/Some transactions could not be checked/]]){
    f.state.portfolioTradeHistory={wallet:'wallet-a',status,coverage,scannedSignatures:7,signatureLimit:50,rowLimit:100};f.render();assert.match(f.html('trade-rows'),expected);assert.equal(f.hidden('trades-content'),false);
  }
  f.state.connectedWalletAddress=null;f.render();assert.equal(f.hidden('trades-content'),true);assert.doesNotMatch(f.html('trade-rows'),/No finalized Pump/);
});

test('real holdings controller rejects old address and disconnected responses without adding disconnected reads',async()=>{
  const f=fixture(),pending=[],reads=[],focus=f.document.activeElement;
  Object.assign(f.state,{connectedWalletAddress:'wallet-a',portfolioRequest:0,EXPLORE_CLUSTER:'devnet',verifiedLaunchPolicies:[],validateSolanaMint:()=>({valid:true}),collectRecentTrades:()=>[],
    getSolana:async()=>({PublicKey:class{constructor(address){this.address=address}},TOKEN_PROGRAM_ID:'classic',TOKEN_2022_PROGRAM_ID:'2022'}),
    getExploreConnection:async()=>({getParsedTokenAccountsByOwner:(owner)=>new Promise(resolve=>pending.push({address:owner.address,resolve}))}),aggregateTokenAccounts:rows=>rows,
    apiRequest:async path=>{reads.push(path);return{available:true,data:{wallet:decodeURIComponent(path.split('/')[3]),cluster:'devnet',source:'finalized-wallet-pump-trades',coverage:'complete',scannedSignatures:0,signatureLimit:50,rowLimit:100,trades:[]}}},
    renderPortfolioView:data=>renderPortfolio(data,{document:f.document,portfolioUnitPriceUsd:a=>a?.priceUsd??null,walletDetailTrades:()=>[]})});
  const controller=createPortfolioController(f.state);Object.assign(f.state,controller);f.state.renderWalletDetail=()=>{};
  const settle=()=>new Promise(resolve=>setImmediate(resolve));
  const old=controller.refreshPortfolioHoldings();await settle();assert.equal(pending.length,2);
  f.state.connectedWalletAddress='wallet-b';const fresh=controller.refreshPortfolioHoldings();await settle();assert.equal(pending.length,4);
  pending[2].resolve({value:[{mint:'mint-b',quantity:7,decimals:6}]});pending[3].resolve({value:[]});await fresh;
  pending[0].resolve({value:[{mint:'mint-a',quantity:99,decimals:6}]});pending[1].resolve({value:[]});await old;assert.equal(f.state.portfolioHoldings.wallet,'wallet-b');assert.doesNotMatch(f.html('holding-rows'),/ALPHA/);assert.match(f.html('holding-rows'),/BETA/);
  const last=controller.refreshPortfolioHoldings();await settle();f.state.connectedWalletAddress=null;const before=reads.length;await controller.refreshPortfolioHoldings();assert.equal(reads.length,before);pending[4].resolve({value:[{mint:'mint-b',quantity:9,decimals:6}]});pending[5].resolve({value:[]});await last;
  assert.equal(f.hidden('holdings-content'),true);assert.equal(f.hidden('holdings-disconnected'),false);assert.doesNotMatch(f.html('holding-rows'),/BETA|ALPHA/);assert.equal(f.document.activeElement,focus);
});
