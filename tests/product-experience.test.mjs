import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boostHistoryRows } from '../boost-history-view.js';
import { productCounterExport } from '../product-events.js';

test('unconfirmed boost remains visible without implying payment success', () => {
  const pending = { pendingSignature:'pending', packageId:'10x', quote:{mint:'token'} };
  assert.deepEqual(boostHistoryRows([], pending, 'token').map(row => row.state), ['Awaiting confirmation']);
  const history = [{mint:'token',signature:'pending',status:'finalized',expiresAt:'2030-01-01'}, {mint:'another',signature:'other',status:'finalized'}];
  assert.equal(boostHistoryRows(history,pending,'token').length,1);
  assert.equal(boostHistoryRows(history,pending,'token')[0].state,'Active');
  assert.equal(boostHistoryRows([], {...pending,failureProof:{}}, 'token')[0].state,'Failed');
});
test('boost history distinguishes expired and unconfirmed server records', () => {
  const rows=boostHistoryRows([{mint:'a',signature:'old',status:'finalized',expiresAt:'2020-01-01'}, {mint:'a',signature:'new',status:'pending'}], null, 'a');
  assert.deepEqual(rows.map(row=>row.state),['Expired','Awaiting confirmation']);
  assert.equal(boostHistoryRows([{mint:'a',signature:'receipt',status:'finalized'}], null, 'a')[0].state, 'Confirmed');
});
test('counter export excludes identifiers and non-counter values', () => {
  const result=productCounterExport({'2026-10-07':{launch_completed:3,wallet:'private',trade_confirmed:-1,share_open:2},'wallet-id':{navigation:3}});
  assert.deepEqual(result,{scope:'this-device-only',days:{'2026-10-07':{launch_completed:3,share_open:2}}});
});
