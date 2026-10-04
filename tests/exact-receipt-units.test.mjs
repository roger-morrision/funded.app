import test from 'node:test';
import assert from 'node:assert/strict';
import { exactLamports } from '../exact-lamports.js';
import { formatReceiptSol, selectExactReceiptRows, receiptPageCsv } from '../receipt-export.js';
const receipt=(amountLamports,signature='1'.repeat(88))=>({amountLamports,signature,slot:12});
test('exact receipt units preserve lamports, safe numeric compatibility and u64 boundaries',()=>{
  for(const value of ['15',15,15n]){assert.equal(exactLamports(value),15n);assert.equal(formatReceiptSol(value),'0.000000015');}
  assert.equal(formatReceiptSol('0'),'0');
  assert.equal(formatReceiptSol('9007199254740993'),'9007199.254740993');
  assert.equal(formatReceiptSol('18446744073709551615'),'18446744073.709551615');
  assert.equal(exactLamports(Number.MAX_SAFE_INTEGER),9007199254740991n);
});
test('unsafe numbers and noncanonical or excessive units cannot be relabeled exact',()=>{
  const rounded=JSON.parse('{"amountLamports":9007199254740993}').amountLamports;
  for(const value of [rounded,NaN,Infinity,-1,0.1,true,false,null,undefined,{},[],'01',' 15','+15','15.0','1e3','', '18446744073709551616','9'.repeat(100000),18446744073709551616n]) assert.throws(()=>exactLamports(value),/Invalid SOL amount/);
});
test('history and CSV select the same positive exact subset and report all omissions',()=>{
  const input=[receipt('15'),receipt(9007199254740992,'2'.repeat(88)),receipt('0','3'.repeat(88)),receipt(true,'4'.repeat(88)),receipt('15'),{...receipt('1','5'.repeat(88)),slot:0}];
  const selected=selectExactReceiptRows(input);assert.equal(selected.receipts.length,1);assert.equal(selected.omittedCount,5);assert.equal(selected.receipts[0].amountLamports,'15');
  const csv=receiptPageCsv(input,'devnet',1);assert.equal(csv.split('\r\n').length,3);assert.match(csv,/verified subset/);assert.match(csv,/"15","0.000000015"/);assert.doesNotMatch(csv,/9007199254740992/);
});
