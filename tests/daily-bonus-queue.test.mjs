import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyBonusWork } from '../server/daily-bonus-queue.mjs';
const start=Date.parse('2026-09-01')/1000, now=Date.parse('2026-10-18')/1000;
const app={launches:{mint:{cluster:'devnet',onchainVerified:true,createdTimestamp:start,feeDistribution:{fixedFunded:{communityRewards:{dailyBonus:{version:1}}}}}}};
test('missing completed days are discovered from policy activation rather than only yesterday',()=>{
 assert.deepEqual(dailyBonusWork({app,ledger:{},now}).missing,['2026-09-01','2026-09-02','2026-09-03']);
});
test('blocked or unfunded days cannot starve later captures or pending payouts beyond the public 30-day view',()=>{
 const snapshots=Object.fromEntries(Array.from({length:40},(_,i)=>{const day=new Date((start+i*86400)*1000).toISOString().slice(0,10);return[day,{status:'snapshotted',snapshot:{sources:[{collectionSignature:day,allocations:[{}]}]},payouts:{}}];}));
 const ledger={dailyBonusSnapshots:snapshots,dailyBonusWorkCursor:'2026-09-03'};
 assert.deepEqual(dailyBonusWork({app,ledger,now}).pending,['2026-09-04','2026-09-05','2026-09-06']);
 ledger.dailyBonusWorkCursor='2026-10-10';
 assert.equal(dailyBonusWork({app,ledger,now}).pending[0],'2026-09-01');
 assert.equal(dailyBonusWork({app,ledger:{dailyBonusCaptureCursor:'2026-09-03'},now}).missing[0],'2026-09-04');
});
test('a launch created today cannot allocate a future or pre-activation daily bonus',()=>{
 const current=structuredClone(app);current.launches.mint.createdTimestamp=now+1;
 assert.deepEqual(dailyBonusWork({app:current,ledger:{},now:now+10}).missing,[]);
});
