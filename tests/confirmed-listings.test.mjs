import test from 'node:test';
import assert from 'node:assert/strict';
import {createConfirmedListings} from '../src/features/listing/confirmed-listings.js';
import {confirmedListings} from '../src/features/listing/confirmed-listings.js';
import {createHomeFeedController} from '../src/app/controllers/home-feed.js';
const mint='38M2z4UCfZEkUHFzD48vhKQhFhNyRGto8pZbLjNipump';
const row={mint,name:'Jimmy Rustles',symbol:'JIMMY',cluster:'mainnet-beta',status:'listed',onchainVerified:true,
  adminListing:true,adminSignature:'1'.repeat(88),signature:null,usd:0,listedAt:'2026-11-24T14:32:48.879Z'};
test('confirmed admin listing remains visible when the immediate public index is stale',()=>{
  const index=createConfirmedListings();index.remember(row,'mainnet-beta');
  assert.deepEqual(index.merge([],'mainnet-beta'),[row]);
  assert.deepEqual(index.merge([row,row],'mainnet-beta'),[row]);
  assert.deepEqual(index.merge([],'devnet'),[]);
});
test('listing visibility never trusts failed, unverified or wrong-network write responses',()=>{
  const index=createConfirmedListings();
  for(const invalid of [{...row,onchainVerified:false},{...row,cluster:'devnet'},{...row,adminSignature:null},{...row,status:'pending'}])
    assert.throws(()=>index.remember(invalid,'mainnet-beta'));
  assert.deepEqual(index.merge([],'mainnet-beta'),[]);
});
test('receipt overlay expires so later removals remain authoritative and paid receipts also survive stale reads',()=>{
  let now=0;const index=createConfirmedListings({now:()=>now,maxAgeMs:100});
  const paid={...row,adminListing:false,adminSignature:null,signature:'2'.repeat(88)};
  index.remember(paid,'mainnet-beta');assert.deepEqual(index.merge([],'mainnet-beta'),[paid]);
  now=100;assert.deepEqual(index.merge([],'mainnet-beta'),[]);
  assert.deepEqual(index.merge([paid],'mainnet-beta'),[paid]);
});

test('home publishes confirmed listing before a slow refresh and preserves it through stale and failed reads',async()=>{
  confirmedListings.remember(row,'mainnet-beta');
  let resolveRead,rendered,path;
  const state={EXPLORE_CLUSTER:'mainnet-beta',homeLaunchTab:'paid-listing',assets:[],
    apiRequest:async url=>{path=url;return new Promise(resolve=>{resolveRead=resolve;});},
    renderHomeLaunchBoardView:data=>{rendered=data;}};
  const controller=createHomeFeedController(state);
  state.renderHomeLaunchBoard=controller.renderHomeLaunchBoard;
  const pending=controller.loadHomePaidListings({fresh:true});
  assert.match(path,/^\/api\/listings\?confirmed=\d+$/);
  assert.equal(rendered.paidListings[0].mint,mint);
  assert.equal(rendered.paidListingsStatus,'ready');
  resolveRead({available:true,data:{cluster:'mainnet-beta',listings:[]}});await pending;
  assert.equal(rendered.paidListings[0].mint,mint);
  state.apiRequest=async()=>{throw new Error('offline');};
  await controller.loadHomePaidListings({fresh:true});
  assert.equal(rendered.paidListings[0].mint,mint);
  assert.equal(rendered.paidListingsStatus,'ready');
});
