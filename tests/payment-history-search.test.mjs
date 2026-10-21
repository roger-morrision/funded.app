import test from 'node:test';
import assert from 'node:assert/strict';
import { filterPaymentHistory } from '../src/features/payments/receipt-view.js';

const day = Date.parse('2026-10-20T00:00:00Z') / 1000;
const rows = Object.freeze([
  { source:'automatic-holder', to:'AbCReceiver', signature:'Shared.Tx[1]', blockTime:day },
  { source:'v3-creator-wallet', to:'DefReceiver', signature:'Shared.Tx[1]', blockTime:day + 86399 },
  { source:'automatic-holder', to:'AbCReceiver', signature:'OtherSignature', blockTime:day + 86400 },
  { source:'automatic-holder', to:null, signature:42, blockTime:null },
  { source:'automatic-holder', blockTime:day - 1 },
].map(Object.freeze));
const select = options => filterPaymentHistory(rows, options);
test('History search blank and surrounding whitespace preserve exact identities and order', () => {
  assert.deepEqual(select(), rows);
  assert.deepEqual(select({query:' \n\t '}), rows);
  assert.deepEqual(select({query:'  AbCReceiver \n'}), [rows[0],rows[2]]);
});
test('History search matches literal case-sensitive receiver or signature substrings', () => {
  assert.deepEqual(select({query:'bCRec'}), [rows[0],rows[2]]);
  assert.deepEqual(select({query:'abcReceiver'}), []);
  assert.deepEqual(select({query:'.Tx[1]'}), [rows[0],rows[1]]);
  assert.deepEqual(select({query:'.*'}), []);
  assert.deepEqual(select({query:'shared'}), []);
});
test('History shared signature keeps each distinct receiver and source row in source order', () => {
  assert.deepEqual(select({query:'Shared.Tx[1]'}), [rows[0],rows[1]]);
  assert.notEqual(select({query:'Shared'})[0], select({query:'Shared'})[1]);
});
test('History missing or nonstring identifiers are safe and never coerced into a match', () => {
  for (const query of ['null','undefined','42','[object Object]']) assert.deepEqual(select({query}), []);
  assert.equal(select({query:''}).length, 5);
});
test('History search composes payout type and inclusive UTC dates', () => {
  assert.deepEqual(select({query:'Shared',type:'holder',from:'2026-10-20',to:'2026-10-20'}), [rows[0]]);
  assert.deepEqual(select({query:'Shared',type:'creator',from:'2026-10-20',to:'2026-10-20'}), [rows[1]]);
  assert.deepEqual(select({query:'AbC',from:'2026-10-21'}), [rows[2]]);
  assert.deepEqual(select({query:'AbC',to:'2026-10-19'}), []);
});
test('History search never admits a missing payout time through an active date filter', () => {
  const missing = [{to:'Known',signature:'Known',blockTime:0},{to:'Known',signature:'Known',blockTime:NaN}];
  assert.deepEqual(filterPaymentHistory(missing,{query:'Known'}),missing);
  assert.deepEqual(filterPaymentHistory(missing,{query:'Known',from:'2026-10-20'}),[]);
});
test('History query examines the complete loaded set without sorting, deduplication or mutation', () => {
  const many = Array.from({length:32},(_,i)=>Object.freeze({to:`Receiver${i}`,signature:i===15||i===29?'Shared':'Tx'+i,source:'automatic-holder'}));
  const before = JSON.stringify(many);
  assert.deepEqual(filterPaymentHistory(many,{query:'Shared'}),[many[15],many[29]]);
  assert.equal(JSON.stringify(many),before);
  assert.deepEqual(select({query:'Shared'}),[rows[0],rows[1]]);
});
test('History clearing search/type/dates recovers original source without changing filter options', () => {
  const options = Object.freeze({query:'Shared',type:'creator',from:'2026-10-20',to:'2026-10-20'});
  assert.deepEqual(select(options),[rows[1]]);
  assert.deepEqual(select({query:'',type:'all',from:'',to:''}),rows);
  assert.equal(options.query,'Shared');
});
