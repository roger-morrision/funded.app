import test from 'node:test';import assert from 'node:assert/strict';import {createHomeTradeTracker} from '../src/features/home/live-cards.js';
const trade=(id,time)=>({signature:id.repeat(88),blockTime:time,side:'buy'});
test('new confirmed trade brings an older coin to the front exactly once',()=>{
 let now=1000000;const track=createHomeTradeTracker(()=>now);const records=[{address:'old',createdTimestamp:1,recentTrades:[trade('2',900)]},{address:'new',createdTimestamp:2}];
 assert.deepEqual(track(records).records.map(x=>x.address),['new','old']);assert.equal(track(records).fresh.size,0);
 now+=1000;records[0].recentTrades=[trade('3',1001),trade('2',900)];const next=track(records);assert.deepEqual(next.records.map(x=>x.address),['old','new']);assert.equal(next.fresh.get('old'),'3'.repeat(88));assert.equal(track(records).fresh.size,0);
 records[0].recentTrades=[trade('2',900)];assert.equal(track(records).fresh.size,0);
});
test('historical backfill, invalid signatures, counts and future timestamps never create live pulses',()=>{
 const track=createHomeTradeTracker(()=>1000000);const rows=[{address:'old',createdTimestamp:1,tradeCount24h:500,recentTrades:[trade('2',900)]},{address:'future',createdTimestamp:2,recentTrades:[trade('3',2000)]},{address:'bad',createdTimestamp:3,recentTrades:[{signature:'bad',blockTime:1000,side:'buy'}]}];assert.equal(track(rows).fresh.size,0);assert.deepEqual(track(rows).records.map(x=>x.address),['bad','future','old']);
});
