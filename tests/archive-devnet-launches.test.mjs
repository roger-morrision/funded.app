import test from 'node:test';
import assert from 'node:assert/strict';
import {archiveDevnetLaunches} from '../server/archive-devnet-launches.mjs';
test('Devnet archive preserves receipts and rejects mainnet or incomplete inventory',()=>{
  const state={launches:{old:{mint:'old',cluster:'devnet'},main:{mint:'main',cluster:'mainnet-beta'}},collections:{receipt:{mint:'old',signature:'finalized'}}};
  assert.throws(()=>archiveDevnetLaunches(state,['main']));assert.throws(()=>archiveDevnetLaunches(state,['missing']));
  archiveDevnetLaunches(state,['old'],'2026-10-31T00:00:00Z');
  assert.equal(state.launches.old.archivedAt,'2026-10-31T00:00:00Z');assert.equal(state.collections.receipt.signature,'finalized');
  assert.equal(state.launches.main.archivedAt,undefined);
});
