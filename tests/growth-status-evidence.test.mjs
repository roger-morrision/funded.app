import test from 'node:test';
import assert from 'node:assert/strict';
import {readStatus} from '../src/features/growth/status-page.js';

test('answering status endpoints do not establish financial service readiness', async () => {
  const rows = await readStatus(async () => ({serverTime:new Date().toISOString()}));
  for (const label of ['Buyback data','Daily bonus data','Analytics data'])
    assert.notEqual(rows.find(row => row[0] === label)[1], 'ok');
});

test('verified public data is distinguished from transaction execution', async () => {
  const rows = await readStatus(async path => {
    if (path.includes('buyback')) return {dashboard:{status:'verified'},refreshing:false,executionReady:false};
    if (path.includes('daily-bonus')) return {pool:{status:'verified'},unavailableReceipts:0,unavailableSnapshots:0,serverTime:'2026-11-10T00:00:00Z',snapshots:1};
    return null;
  });
  assert.equal(rows.find(row => row[0] === 'Buyback data')[1], 'ok');
  assert.match(rows.find(row => row[0] === 'Buyback data')[2], /execution still depends/);
  assert.equal(rows.find(row => row[0] === 'Daily bonus data')[1], 'ok');
});

test('pending buyback reads and incomplete bonus receipts stay degraded', async () => {
  const rows = await readStatus(async path => path.includes('buyback')
    ? {dashboard:{status:'verified'},refreshing:true}
    : {pool:{status:'verified'},unavailableReceipts:1,unavailableSnapshots:0});
  assert.equal(rows.find(row => row[0] === 'Buyback data')[1], 'degraded');
  assert.equal(rows.find(row => row[0] === 'Daily bonus data')[1], 'degraded');
});
