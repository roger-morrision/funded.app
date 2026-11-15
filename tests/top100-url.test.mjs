import test from 'node:test';
import assert from 'node:assert/strict';
import {readTop100Url, top100Search} from '../src/features/explore/top100-url.js';

const allowed = {sort:['featured','volume'], stage:['all','migrated'], tier:['all','pro'], minCap:['0','10000'], maxAge:['0','24']};

test('Top 100 filters round-trip through the query string', () => {
  const search = top100Search('?ref=abc', {sort:'volume', query:' dog ', stage:'migrated', tier:'all', minCap:10000, maxAge:0});
  assert.equal(search, '?ref=abc&top.sort=volume&top.q=dog&top.stage=migrated&top.cap=10000');
  assert.deepEqual(readTop100Url(search, allowed), {sort:'volume', query:'dog', stage:'migrated', minCap:10000});
});

test('unknown Top 100 values are ignored and defaults clear the query', () => {
  assert.deepEqual(readTop100Url('?top.sort=evil&top.cap=5', allowed), {});
  assert.equal(top100Search('?top.sort=volume', {sort:'featured', query:'', stage:'all', tier:'all', minCap:0, maxAge:0}), '');
});
