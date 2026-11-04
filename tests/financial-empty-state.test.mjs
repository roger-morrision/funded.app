import test from 'node:test';
import assert from 'node:assert/strict';
import {missingFinancialSources,financialEmptyMessage} from '../src/features/experience/financial-empty-state.js';

const rewards=()=>({available:true,data:{cluster:'devnet',evidence:{status:'no-records'}}});
const burns=()=>({available:true,data:{cluster:'devnet',pending:[],receipts:[]}});
test('successful empty sources are distinct from unavailable records',()=>{
  assert.deepEqual(missingFinancialSources(rewards(),burns()),[]);
  assert.equal(financialEmptyMessage(false).kind,'empty');
  assert.match(financialEmptyMessage(false).note,/checked sources/);
  assert.equal(financialEmptyMessage(false,['rewards']).kind,'unavailable');
  assert.match(financialEmptyMessage(false,['rewards']).note,/not a zero balance/);
});
test('HTTP availability cannot substitute for the expected cluster, evidence and record lists',()=>{
  assert.deepEqual(missingFinancialSources({available:false},burns()),['rewards']);
  assert.deepEqual(missingFinancialSources({...rewards(),data:{cluster:'mainnet-beta',evidence:{status:'no-records'}}},burns()),['rewards']);
  assert.deepEqual(missingFinancialSources({...rewards(),data:{cluster:'devnet',evidence:{status:'unavailable'}}},burns()),['rewards']);
  assert.deepEqual(missingFinancialSources(rewards(),{available:true,data:{cluster:'devnet'}}),['buybacks']);
  assert.deepEqual(missingFinancialSources(rewards(),{...burns(),data:{cluster:'mainnet-beta',pending:[],receipts:[]}}),['buybacks']);
});
test('private reward coverage must belong to the connected wallet',()=>{
  assert.deepEqual(missingFinancialSources(rewards(),burns(),[],'wallet-a'),['rewards']);
  const response=rewards();response.data.wallet={address:'wallet-b'};
  assert.deepEqual(missingFinancialSources(response,burns(),[],'wallet-a'),['rewards']);
  response.data.wallet.address='wallet-a';assert.deepEqual(missingFinancialSources(response,burns(),[],'wallet-a'),[]);
});
test('a status filter refers only to loaded records, including when another source is unavailable',()=>{
  assert.equal(financialEmptyMessage(true,['rewards']).kind,'filtered');
  assert.match(financialEmptyMessage(true).note,/loaded activity/);
});
test('creator action coverage needs a usable per-mint V3 overview',()=>{
  const row={available:true,data:{cluster:'devnet',overview:{available:true,scope:'per-mint-v3'}}};
  assert.deepEqual(missingFinancialSources(rewards(),burns(),[row]),[]);
  row.data.overview.available=false;assert.deepEqual(missingFinancialSources(rewards(),burns(),[row]),['creator approvals']);
});
