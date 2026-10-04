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
test('CSV leaves unknown recorded time blank while preserving verified receipt rows and exact amounts',()=>{
  for(const paidAt of [undefined,null,false,true,0,1,'0','','not-a-date','2026-02-30T12:00:00Z','2026-10-04T05:00:00']){
    const value={...receipt('15'),paidAt,recipient:'recipient',sourceCollectionSignature:'source',obligationId:'obligation'};
    const lines=receiptPageCsv([value],'devnet',1).trimEnd().split('\r\n');
    assert.equal(lines.length,2);assert.equal(lines[0].split(',')[9],'"paid_at"');
    const cells=lines[1].split(',');assert.equal(cells.length,13);assert.equal(cells[9],'""');
    assert.equal(cells[4],'"15"');assert.equal(cells[5],'"0.000000015"');
    assert.deepEqual(cells.slice(10),['"recipient"','"source"','"obligation"']);
  }
});
test('CSV preserves valid recorded ISO strings including their original timezone and precision',()=>{
  for(const paidAt of ['2026-10-04T05:00:00Z','2026-10-04T05:00:00.123Z','2026-10-04T05:00:00.1+05:30']){
    const csv=receiptPageCsv([{...receipt('15'),paidAt}],'devnet',1);
    assert.equal(csv.split('\r\n')[1].split(',')[9],`"${paidAt}"`);
  }
});
