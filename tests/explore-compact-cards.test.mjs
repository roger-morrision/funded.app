import test from 'node:test';import assert from 'node:assert/strict';
import {homeLaunchCardMarkup,homeLaunchFeeRouteMarkup,launchCardProgressState,syncLaunchCardProgressFreshness} from '../src/features/home/launch-card-view.js';import {escapeHtml} from '../src/features/shared/display.js';
const cases=[{"item":{"address":"4r3yqXhj7v4fVSFNTvEKUmn1WovnL8aHdk8hUGLbpXGq","name":"Funded Milestone QA","symbol":"FMQA","icon":"F","createdTimestamp":1792553539},"volume":"$—"},{"item":{"address":"H8AKZYEfaTyFsdppSvDZtkfkRzb5TFuPf3q9GY9xY81z","name":"Funded Buyback Agency QA","symbol":"FBAQA","icon":"F","createdTimestamp":1792493433},"volume":"$—"},{"item":{"address":"BHFsQA2xqgGXVuHeTngQY8t6mNaaHwVZdXcYuzigNAHK","name":"Fee premier QA","symbol":"FEEQA","icon":"F","createdTimestamp":1792390512},"volume":"$—"},{"item":{"address":"4r3yqXhj7v4fVSFNTvEKUmn1WovnL8aHdk8hUGLbpXGq","name":"Funded Milestone QA","symbol":"FMQA","icon":"F","createdTimestamp":1792553539,"complete":false,"curveCapSol":3.5,"curveProgressPercent":35,"windowCoverage":"complete","windowTradeCount":0},"volume":"No trades"},{"item":{"address":"4r3yqXhj7v4fVSFNTvEKUmn1WovnL8aHdk8hUGLbpXGq","name":"A long <img src=x onerror=bad()> token name & disclosure","symbol":"A&B","icon":"F","createdTimestamp":1792553539,"website":"https://example.test"},"volume":"0 SOL"}],policies=[{"mint":"4r3yqXhj7v4fVSFNTvEKUmn1WovnL8aHdk8hUGLbpXGq","onchainVerified":true,"creatorWallet":"8ZCtLWxvBGwniEgybr1k89wS9NSaKrgxF4kPDvGvn1Wk","feeDistribution":{"creatorDirected":{"shares":{"solClaimPercent":0,"creatorWalletPercent":80,"holderAirdropPercent":0},"recipients":{"xAccount":""}}}},{"mint":"H8AKZYEfaTyFsdppSvDZtkfkRzb5TFuPf3q9GY9xY81z","onchainVerified":true,"creatorWallet":"8ZCtLWxvBGwniEgybr1k89wS9NSaKrgxF4kPDvGvn1Wk","feeDistribution":{"creatorDirected":{"shares":{"solClaimPercent":0,"creatorWalletPercent":80,"holderAirdropPercent":0},"recipients":{"xAccount":""}}}},{"mint":"BHFsQA2xqgGXVuHeTngQY8t6mNaaHwVZdXcYuzigNAHK","onchainVerified":true,"creatorWallet":"8ZCtLWxvBGwniEgybr1k89wS9NSaKrgxF4kPDvGvn1Wk","feeDistribution":{"creatorDirected":{"shares":{"solClaimPercent":0,"creatorWalletPercent":80,"holderAirdropPercent":0},"recipients":{"xAccount":""}}}}];
const state={verifiedBoosts:{},EXPLORE_CLUSTER:'devnet'};
const deps={exploreStageLabel:item=>item.complete===false?'On curve':'Market stage unavailable',formatOnchainAge:()=> '6h ago',formatCoinUsd:value=>value==null?'$—':value+' SOL',verifiedLaunchPolicyForMint:mint=>policies.find(p=>p.mint===mint),homeLaunchFeeRouteMarkup:policy=>homeLaunchFeeRouteMarkup(policy,{}, {verifiedPolicyPercent:Number,formatVerifiedPercent:n=>n+'%'}),exploreSocialLinksMarkup:item=>item.website?'<a class="explore-social-link" href="'+escapeHtml(item.website)+'">Website</a>':'',tokenCardWatchMarkup:mint=>'<button class="token-card-action-watch" data-mint="'+escapeHtml(mint)+'" aria-label="Favorite">Favorite</button>',exploreBoostAmountMarkup:()=>'',tokenCardShareMarkup:mint=>'<button class="token-card-action-share" data-share-mint="'+escapeHtml(mint)+'">Share</button>'};
const options=row=>({volumeLabel:'24h',volumeValue:row.volume,extraClass:'',extraActions:'',footerNote:''});
test('omitted and legacy compact options share canonical Home hierarchy and honest progress',()=>{
 for(const row of cases)for(const flag of[undefined,false,true]){
  const opt=options(row);if(flag!==undefined)opt.compact=flag;const html=homeLaunchCardMarkup(row.item,opt,state,deps);
  assert.match(html,/home-launch-card-media/);assert.doesNotMatch(html,/explore-compact-(?:card|heading|details)/);
  assert.equal((html.match(/class="home-launch-progress-row"/g)||[]).length,1);
  const order=['home-launch-card-stats','home-launch-progress-row','home-launch-meta','home-launch-card-actions'].map(k=>html.indexOf('class="'+k+'"'));
  assert(order.every(n=>n>=0));assert.deepEqual([...order].sort((a,b)=>a-b),order);
  assert.match(html,/Progress unavailable/);assert.doesNotMatch(html,/aria-valuenow|% filled|Market stage unavailable/);
  assert.match(html,new RegExp('data-copy-address="'+row.item.address+'"'));assert.match(html,/Creator 80%/);
 }
});
test('shared presentation preserves all text and action/proof/address attributes across route classes',()=>{
 // project-token-card is the incidental My launches shared-renderer contract; model only, no connected-wallet/browser claim.
 for(const row of cases)for(const extraClass of[' explore-launch-card',' project-token-card']){const base=homeLaunchCardMarkup(row.item,options(row),state,deps),shared=homeLaunchCardMarkup(row.item,{...options(row),compact:true,extraClass},state,deps);
  const words=s=>s.replace(/<[^>]*>/g,' ').split(/\s+/).filter(Boolean).sort(),attrs=s=>[...s.matchAll(/(?:href|data-[\w-]+|aria-[\w-]+|title)="[^"]*"/g)].map(m=>m[0]).sort();
  assert.deepEqual(words(shared),words(base));assert.deepEqual(attrs(shared),attrs(base));assert.doesNotMatch(shared,/explore-compact-/);
  for(const control of['data-copy-address','data-share-mint','data-boost-mint','home-launch-media-package','token-card-action-watch'])assert(shared.includes(control));
 }
});
test('compact unknown and zero-trade states retain exact metric meanings and never evaluate escaped names',()=>{
 const unknown=homeLaunchCardMarkup(cases[0].item,{...options(cases[0]),compact:true},state,deps),zero=homeLaunchCardMarkup(cases[3].item,{...options(cases[3]),compact:true},state,deps),escaped=homeLaunchCardMarkup(cases[4].item,{...options(cases[4]),compact:true},state,deps);
 assert.match(unknown,/\$—/);assert.match(zero,/No trades/);assert.match(escaped,/&lt;img src=x onerror=bad\(\)&gt;/);assert.doesNotMatch(escaped,/<img src=x/);
 assert.match(unknown,/Progress unavailable/);assert.doesNotMatch(unknown,/aria-valuenow/);
});
test('rendering compact and default cards leaves records and policy context unchanged',()=>{
 const before=JSON.stringify({cases,policies,state});for(const row of cases)for(const compact of[false,true])homeLaunchCardMarkup(row.item,{...options(row),compact},state,deps);assert.equal(JSON.stringify({cases,policies,state}),before);
});
test('raw intermediate inputs never become migration percentages without a per-mint producer',()=>{
 for(const raw of[undefined,null,NaN,Infinity,-1,0,50,100,'0','50','100','',true]){
  const item={...cases[0].item,complete:false,curveProgressPercent:raw},model=launchCardProgressState(item),html=homeLaunchCardMarkup(item,options(cases[0]),state,deps);
  assert.equal(model.value,null);assert.equal(model.kind,'unavailable');assert.match(model.text,/On curve.*Progress unavailable/);
  assert.match(html,/home-launch-progress-row/);assert.match(html,/class="home-launch-progress" aria-hidden="true"><\/div>/);
  assert.doesNotMatch(html,/aria-valuenow|--launch-progress:|% filled/);
 }
});
test('strict existing stage endpoints and retained snapshots have explicit progress precedence',()=>{
 // Model fixtures represent the existing normalized bool contract, not new chain proof.
 const loading='On-chain only · loading',stale='RPC unavailable · last verified snapshot · stale';
 const rows=[
  [{},'',null,'unavailable','Progress unavailable'],[{complete:false},'',null,'unavailable','On curve · Progress unavailable'],
  [{complete:true},'',100,'complete','Curve complete · Migration not yet verified'],[{complete:true,migrated:true},'',100,'migrated','Migrated'],
  [{complete:false,migrated:true},'',100,'migrated','Migrated'],[{complete:1,migrated:'true'},'',null,'unavailable','Progress unavailable'],
  [{},loading,null,'loading','Checking progress…'],[{complete:false},loading,null,'loading','Last verified · On curve · Checking progress…'],
  [{complete:true},loading,100,'stale','Last verified · Curve complete · Migration not yet verified'],
  [{migrated:true},loading,100,'stale','Last verified · Migrated'],[{},stale,null,'stale','Last verified · Progress unavailable'],
  [{complete:false},stale,null,'stale','Last verified · On curve · Progress unavailable'],
  [{complete:true},stale,100,'stale','Last verified · Curve complete · Migration not yet verified'],[{migrated:true},stale,100,'stale','Last verified · Migrated'],
 ];
 for(const [flags,status,value,kind,text]of rows){const item={...cases[0].item,...flags,curveProgressPercent:50},actual=launchCardProgressState(item,status);
  assert.equal(actual.value,value);assert.equal(actual.kind,kind);assert.equal(actual.text,text);
  const html=homeLaunchCardMarkup(item,options(cases[0]),{...state,exploreProviderStatus:status},deps);
  if(value===100){assert.match(html,/role="progressbar"/);assert.match(html,/aria-valuenow="100"/);assert(html.includes('aria-valuetext="'+escapeHtml(text)+'"'));}
  else assert.doesNotMatch(html,/role="progressbar"|aria-valuenow|--launch-progress:/);
  if(flags.complete===true&&!flags.migrated)assert.doesNotMatch(html,/>Migrated</);
 }
});
test('progress accessibility labels escape token identity and keep unavailable tracks noninteractive',()=>{
 const item={...cases[0].item,symbol:'A"<unsafe>&',complete:true},html=homeLaunchCardMarkup(item,options(cases[0]),state,deps);
 assert.match(html,/aria-label="Migration progress for A&quot;&lt;unsafe&gt;&amp;"/);assert.match(html,/Migration not yet verified/);
 const plain=html.replace(/<[^>]*>/g,' ');assert.equal((plain.match(/6h ago/g)||[]).length,1);
 const unknown=homeLaunchCardMarkup({...item,complete:null},options(cases[0]),state,deps);
 const row=unknown.slice(unknown.indexOf('<div class="home-launch-progress-row"'),unknown.indexOf('<div class="home-launch-meta"'));
 assert.doesNotMatch(row,/tabindex|<button|<a\s|aria-valuenow/);assert.match(row,/Progress unavailable/);
});
// Explicit fake DOM/RAF: lifecycle and identity logic only, not browser paint proof.
function freshnessFixture(){
 const de=new Map(),we=new Map(),q=new Map();let id=0;
 const events=(map)=>({addEventListener:(n,fn)=>{if(!map.has(n))map.set(n,new Set());map.get(n).add(fn);},removeEventListener:(n,fn)=>map.get(n)?.delete(fn)});
 const rows=[0,1].map(()=>{const value={textContent:'Curve complete · Migration not yet verified'},badge={hidden:false},attrs=new Map([['aria-valuenow','100']]),track={fill:'100%',setAttribute:(k,v)=>attrs.set(k,v)};
  const row={isConnected:true,dataset:{progressState:'complete'},querySelector:s=>s.includes('heading')?value:s.includes('progressbar')?track:null};
  const card={querySelector:s=>s.includes('progress-row')?row:s.includes('media-stage')?badge:null};
  Object.defineProperty(card,'innerHTML',{set(){throw Error('Card replacement is outside the qualifier scope');}});row.parentElement=card;
  return{row,card,value,badge,track,attrs};});
 const owner={isConnected:true,visible:true,closest:()=>rows[0].card,matches:()=>true,getClientRects(){return this.visible?[{}]:[];},focus(){throw Error('Qualifier cannot focus controls');}},foreign={isConnected:true,closest:()=>null};
 const window={...events(we),getComputedStyle:e=>({visibility:e.visible?'visible':'hidden'}),requestAnimationFrame:fn=>{const k=++id;q.set(k,()=>{q.delete(k);fn();});return k;},cancelAnimationFrame:k=>q.delete(k),scrollBy(){throw Error('Qualifier cannot scroll');}};
 const document={...events(de),defaultView:window,activeElement:foreign,querySelectorAll:()=>rows.map(x=>x.row)};
 const ownerB={...owner,closest:()=>rows[1].card};
 return{rows,owner,ownerB,foreign,document,q,de,we,emit:(map,n)=>[...(map.get(n)||[])].forEach(fn=>fn()),run:()=>{const a=[...q.values()];q.clear();a.forEach(fn=>fn());}};
}
const staleStatus='Solana RPC unavailable · last verified snapshot · stale';
function pendingClean(f){assert.equal(f.q.size,0);assert.equal(f.de.get('focusout')?.size||0,0);assert.equal(f.we.get('funded:route-change').size,1);assert.equal(f.we.get('pagehide').size,1);}
test('retained progress qualification preserves every card, control and known endpoint',()=>{
 const f=freshnessFixture(),original=f.rows.map(x=>({card:x.card,track:x.track,fill:x.track.fill}));
 syncLaunchCardProgressFreshness(f.document,staleStatus);syncLaunchCardProgressFreshness(f.document,staleStatus);
 for(let i=0;i<f.rows.length;i++){const x=f.rows[i];assert.equal(x.value.textContent,'Last verified · Curve complete · Migration not yet verified');assert.equal(x.attrs.get('aria-valuenow'),'100');assert.equal(x.attrs.get('aria-valuetext'),x.value.textContent);assert.equal(x.track.fill,original[i].fill);assert.equal(x.card,original[i].card);assert.equal(x.track,original[i].track);assert.equal(x.badge.hidden,true);}
 const retained=f.rows[0].value.textContent;syncLaunchCardProgressFreshness(f.document,'RPC verified');assert.equal(f.rows[0].value.textContent,retained,'Fresh producer status alone must not freshen retained old data');pendingClean(f);
 const loading=freshnessFixture();loading.rows[0].value.textContent='Checking progress…';loading.rows[0].row.dataset.progressState='loading';loading.rows[0].row.querySelector=s=>s.includes('heading')?loading.rows[0].value:null;loading.rows[0].attrs.delete('aria-valuenow');loading.rows[0].track.fill='';
 syncLaunchCardProgressFreshness(loading.document,staleStatus);assert.equal(loading.rows[0].value.textContent,'Last verified · Progress unavailable');assert.equal(loading.rows[0].attrs.has('aria-valuenow'),false);pendingClean(loading);
});
test('retained progress defers all reflow while a card control owns focus and rejects old fresh-cancelled frames',()=>{
 const f=freshnessFixture();f.document.activeElement=f.owner;
 for(let i=0;i<20;i++)syncLaunchCardProgressFreshness(f.document,staleStatus);
 assert.equal(f.de.get('focusout').size,1);assert.equal(f.q.size,0);assert(f.rows.every(x=>!x.value.textContent.startsWith('Last verified')));
 f.emit(f.de,'focusout');assert.equal(f.q.size,1);const old=[...f.q.values()][0];syncLaunchCardProgressFreshness(f.document,'RPC verified');old();pendingClean(f);
 assert(f.rows.every(x=>!x.value.textContent.startsWith('Last verified')));
 syncLaunchCardProgressFreshness(f.document,staleStatus);f.emit(f.de,'focusout');assert.equal(f.q.size,1);old();assert.equal(f.q.size,1,'Older delivered callback must not clear newer episode');
 f.document.activeElement=f.ownerB;f.run();assert.equal(f.de.get('focusout').size,1,'A next card owner still defers the update');assert(f.rows.every(x=>!x.value.textContent.startsWith('Last verified')));
 f.document.activeElement=f.foreign;f.emit(f.de,'focusout');f.run();assert(f.rows.every(x=>x.value.textContent.startsWith('Last verified')));pendingClean(f);assert.equal(f.document.activeElement,f.foreign);
});
test('retained progress coalesces route reentry and cleans pending work on disconnection or pagehide',()=>{
 const f=freshnessFixture();f.document.activeElement=f.owner;syncLaunchCardProgressFreshness(f.document,staleStatus);f.emit(f.de,'focusout');
 f.rows.forEach(x=>x.row.isConnected=false);f.owner.isConnected=false;f.run();pendingClean(f);assert(f.rows.every(x=>!x.value.textContent.startsWith('Last verified')));
 f.rows.forEach(x=>x.row.isConnected=true);f.owner.isConnected=true;f.document.activeElement=f.foreign;f.emit(f.we,'funded:route-change');assert(f.rows.every(x=>x.value.textContent.startsWith('Last verified')));
 f.document.activeElement=f.owner;syncLaunchCardProgressFreshness(f.document,staleStatus);f.emit(f.de,'focusout');const old=[...f.q.values()][0];f.emit(f.we,'pagehide');old();pendingClean(f);
 for(let i=0;i<10;i++)syncLaunchCardProgressFreshness(f.document,'RPC verified');assert.equal(f.we.get('funded:route-change').size,1);pendingClean(f);
});
