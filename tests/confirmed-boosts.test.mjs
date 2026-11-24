import test from 'node:test';
import assert from 'node:assert/strict';
import {createConfirmedBoosts} from '../src/features/boost/confirmed-boosts.js';
import {activeBoosts} from '../boost-offer.js';
const mint='38M2z4UCfZEkUHFzD48vhKQhFhNyRGto8pZbLjNipump';
const now=Date.now();
const receipt={mint,cluster:'mainnet-beta',adminBoost:true,status:'finalized',signature:'1'.repeat(88),
  packageId:'10x',multiplier:10,startsAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+3600000).toISOString()};
receipt.active=activeBoosts([receipt],now,'mainnet-beta')[mint];
test('server-confirmed boost total survives stale empty reads without doubling and respects expiry',()=>{
  let time=now;const cache=createConfirmedBoosts({now:()=>time,maxAgeMs:100});
  cache.remember(receipt,'mainnet-beta');
  assert.equal(cache.merge({},'mainnet-beta')[mint].multiplier,10);
  assert.equal(cache.merge({[mint]:receipt.active},'mainnet-beta')[mint].multiplier,10);
  assert.deepEqual(cache.merge({},'devnet'),{});
  const newer=activeBoosts([receipt,{...receipt,signature:'2'.repeat(88)}],now,'mainnet-beta');
  assert.equal(cache.merge(newer,'mainnet-beta')[mint].multiplier,20);
  time+=100;assert.deepEqual(cache.merge({},'mainnet-beta'),{});
});
test('unconfirmed or wrong-network admin boost responses cannot add badges',()=>{
  const cache=createConfirmedBoosts();
  for(const invalid of [{...receipt,status:'pending'},{...receipt,cluster:'devnet'},{...receipt,active:null},{...receipt,signature:null}])
    assert.throws(()=>cache.remember(invalid,'mainnet-beta'));
  assert.deepEqual(cache.merge({},'mainnet-beta'),{});
});
