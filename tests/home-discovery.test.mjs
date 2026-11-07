import test from 'node:test';
import assert from 'node:assert/strict';
import { isNearGraduation, homeTrendingSelection } from '../src/features/home/discovery-data.js';

test('near graduation includes 70% and excludes completed or unverified curves', () => {
  assert.equal(isNearGraduation({complete:false,curveProgressPercent:70}),true);
  for (const row of [{complete:false,curveProgressPercent:69.99},{complete:true,curveProgressPercent:100},
    {complete:false,migrated:true,curveProgressPercent:80},{curveProgressPercent:80},
    {complete:false,curveProgressPercent:null}]) assert.equal(isNearGraduation(row),false);
});

test('shared trending selection ranks participation and falls back to newest verified records', () => {
  const row=(address,score,createdTimestamp)=>({address,createdTimestamp,activityWindows:{'24h':{
    coverage:'partial',trending:{score,walletCount:2,basis:'observed-wallet-participation-v1'}}}});
  const records=[row('a',2,3),row('b',5,1),row('c',0,5)];
  assert.deepEqual(homeTrendingSelection(records,'24h').records.map(x=>x.address),['b','a']);
  const fallback=homeTrendingSelection(records,'5m');
  assert.equal(fallback.ranked,false);
  assert.deepEqual(fallback.records.map(x=>x.address),['c','a','b']);
  assert.deepEqual(records.map(x=>x.address),['a','b','c']);
});
