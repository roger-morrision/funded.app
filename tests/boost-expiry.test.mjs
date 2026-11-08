import test from 'node:test';
import assert from 'node:assert/strict';
import {PublicKey} from '@solana/web3.js';
import {activeBoostMultiplier,activeBoosts,currentBoostSnapshot} from '../boost-offer.js';
import {boostPackageBadgesMarkup} from '../boost-card-badges.js';
import {top100Records,rankTop100} from '../src/features/explore/top100-model.js';
import {createLaunchRegistryController} from '../src/app/controllers/launch-registry.js';

const now=Date.parse('2026-11-08T10:00:00Z'),mint='A'.repeat(32);
const pack=(packageId,multiplier,end)=>({packageId,multiplier,startsAt:new Date(now-1000).toISOString(),expiresAt:new Date(end).toISOString()});
const snapshot=()=>({[mint]:{multiplier:510,count:2,golden:true,packages:[pack('500x',500,now+1000),pack('10x',10,now+2000)]}});

test('expired packages lose their quantity, golden ticker, badges and API priority at the exact deadline',()=>{
 const original=snapshot();
 const partial=currentBoostSnapshot(original,now+1000)[mint];
 assert.equal(partial.multiplier,10);assert.equal(partial.count,1);assert.equal(partial.golden,false);
 assert.match(boostPackageBadgesMarkup(partial,now+1000),/10x/);
 assert.deepEqual(currentBoostSnapshot(original,now+2000),{});
 assert.equal(boostPackageBadgesMarkup(original[mint],now+2000),'');
 const receipt={...pack('10x',10,now+1000),mint,cluster:'devnet',status:'finalized'};
 assert.equal(activeBoosts({receipt},now)[mint].multiplier,10);
 assert.deepEqual(activeBoosts({receipt},now+1000),{});
 assert.equal(original[mint].packages.length,2); // Historical input remains intact.
});

test('expiry removes boost-only eligibility at the Top 100 cutoff and from Boosted ranking',()=>{
 const assets=Array.from({length:101},(_,i)=>({address:new PublicKey(Buffer.alloc(32,i+1)).toBase58()}));
 const last=assets.at(-1).address;
 const boosts={[last]:{packages:[pack('10x',10,now+1000)]}};
 const rows=at=>top100Records(assets,{boosts,now:at});
 const baseline=rankTop100(top100Records(assets,{now})).rows;
 // Pick a token outside the deterministic unboosted cutoff.
 const excluded=assets.find(a=>!baseline.some(row=>row.mint===a.address)).address;
 boosts[excluded]=boosts[last];if(excluded!==last)delete boosts[last];
 assert.equal(rankTop100(rows(now)).rows[0].mint,excluded);
 assert.deepEqual(rankTop100(rows(now+1000)).rows,rankTop100(top100Records(assets,{now:now+1000})).rows);
 assert.equal(rankTop100(rows(now+1000),{sort:'boosted'}).rows.length,0);
});

test('expiry refreshes all card surfaces, open dialog and rankings locally, including tab resume',t=>{
 const priorDocument=globalThis.document,priorWindow=globalThis.window;
 const doc=new EventTarget(),win=new EventTarget();
 doc.hidden=true;doc.querySelector=()=>({open:true});
 globalThis.document=doc;globalThis.window=win;
 t.mock.timers.enable({apis:['Date','setTimeout'],now});
 try {
   const views={},app={verifiedBoosts:snapshot(),assets:[{address:mint}],activeBoostMultiplier,
     setCardBoostSnapshot:boosts=>{views.supplemental=boostPackageBadgesMarkup(boosts[mint]);}};
   for(const name of ['renderExploreAssets','renderRegistry','renderHomeLaunchBoard','renderWatchlist','renderCreatorLaunches','renderAirdropDirectory','renderCoinPromotionBadge','renderExploreBoostDialog']) {
     app[name]=options=>{views[name]={badge:boostPackageBadgesMarkup(app.verifiedBoosts[mint]),options};};
   }
   doc.addEventListener('funded:rankings-updated',()=>{views.ranking=top100Records(app.assets,{boosts:app.verifiedBoosts})[0].boost;});
   Object.assign(app,createLaunchRegistryController(app));
   app.scheduleBoostExpiryRefresh();
   assert.equal(views.ranking,510);
   t.mock.timers.tick(1001);
   assert.equal(views.ranking,10);assert.equal(app.assets[0].postLaunchBoostMultiplier,10);
   assert.equal(app.verifiedBoosts[mint].count,1);assert.equal(app.verifiedBoosts[mint].golden,false);
   assert.equal(views.renderExploreAssets.options.force,true);
   assert.match(views.renderExploreBoostDialog.badge,/10x/);
   // Jump over expiry without firing timers, as a suspended/background tab can.
   t.mock.timers.setTime(now+3000);doc.hidden=false;doc.dispatchEvent(new Event('visibilitychange'));
   assert.deepEqual(app.verifiedBoosts,{});assert.equal(views.ranking,0);
   assert.equal(app.assets[0].postLaunchBoostMultiplier,0);assert.equal(views.supplemental,'');
   for(const [name,view] of Object.entries(views))if(name.startsWith('render'))assert.equal(view.badge,'',name);
   assert.equal(views.renderExploreAssets.options.force,true);
   app.verifiedBoosts=snapshot();win.dispatchEvent(Object.assign(new Event('pageshow'),{persisted:true}));
   assert.deepEqual(app.verifiedBoosts,{});
 } finally {
   if(priorDocument===undefined)delete globalThis.document;else globalThis.document=priorDocument;
   if(priorWindow===undefined)delete globalThis.window;else globalThis.window=priorWindow;
 }
});
