import test from 'node:test';
import assert from 'node:assert/strict';
import {newestFirst} from '../src/features/experience/financial-model.js';
test('rewards activity keeps open items first, then newest records first',()=>{
  const rows=[{id:'old',at:'2026-10-16T09:09:02Z'},{id:'open'},{id:'mid',at:'2026-11-01T01:08:26Z'},{id:'new',at:'2026-11-01T03:21:33Z'},{id:'bad',at:'not a date'}];
  assert.deepEqual(newestFirst(rows).map(row=>row.id),['open','bad','new','mid','old']);
  assert.deepEqual(rows.map(row=>row.id),['old','open','mid','new','bad']);
});
test('rewards activity order is stable for equal timestamps',()=>{
  const at='2026-10-13T11:06:01.383Z';
  assert.deepEqual(newestFirst([{id:'a',at},{id:'b',at},{id:'c',at}]).map(row=>row.id),['a','b','c']);
});
