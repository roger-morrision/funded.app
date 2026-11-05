import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeTrending,rankTrending} from '../market-trending.js';
import {summarizePumpTrades} from '../server/coin-market.mjs';
import {pilotSchedule} from '../src/features/experience/community-pilot.js';
const now=100000, wallet=i=>String(i+1).repeat(32);
const trade=(i,amount=100000000n,time=now-10)=>({signature:'sig'+i,trader:wallet(i),solLamports:amount,tokenAmountRaw:1n,isBuy:true,blockTime:time,priceRatio:1,order:i});
test('single-wallet volume and duplicate events cannot create broad participation',()=>{
 const one=Array.from({length:100},(_,i)=>({...trade(0,100000000000n),signature:'s'+i}));
 assert.equal(summarizeTrending(one,now-3600,now).score,0);
 const rows=[trade(0),trade(1)];assert.deepEqual(summarizeTrending([...rows,...rows],now-3600,now),summarizeTrending(rows,now-3600,now));
 assert(summarizeTrending(rows,now-3600,now).score>0);
});
test('distributed activity outranks concentrated volume; future and old rows are excluded',()=>{
 const broad=Array.from({length:5},(_,i)=>trade(i,100000000n,now-i*300));
 const narrow=[trade(0,100000000000n),trade(1),{...trade(0),signature:'another'},{...trade(0),signature:'last'}];
 const a=summarizeTrending(broad,now-3600,now),b=summarizeTrending(narrow,now-3600,now);
 assert(a.score>b.score);assert.equal(b.concentrated,true);assert.equal(a.activeIntervals,5);
 assert.equal(summarizeTrending([trade(0,1n,now+1),trade(1,1n,now-4000)],now-3600,now).walletCount,0);
});
test('server windows use their actual end time and paid boosts cannot change ranking',()=>{
 const data=summarizePumpTrades([trade(0),trade(1)],{cutoffSeconds:now-86400,complete:true});
 assert(data.activityWindows['5m'].trending.score>0);
 assert.equal(data.activityWindows['5m'].trending.latestTradeAt,now-10);
 const a={address:'a',activityWindows:data.activityWindows},b={address:'b',activityWindows:null,postLaunchBoostMultiplier:1000000};
 assert.deepEqual(rankTrending([b,a]).map(x=>x.address),['a','b']);
});
test('pilot dates and exact token link remain local planning data',()=>{
 assert.equal(pilotSchedule({mint:'invalid',start:'today'},'https://funded.vip'),null);
 const plan=pilotSchedule({mint:wallet(0),start:'2026-11-05T10:00:00Z'},'https://funded.vip');
 assert.equal(plan.url,'https://funded.vip/token/'+wallet(0));
 assert.equal(plan.events[2].at,'2026-11-12T10:00:00.000Z');
});
