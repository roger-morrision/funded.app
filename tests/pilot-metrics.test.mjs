import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { summarizePilot,normalizePilotRecord,createPilotRecord,appendPilotEvent,createPilotRecorder,PILOT_STORAGE_KEY,PILOT_CONSENT_KEY,PILOT_MAX_EVENTS } from '../pilot-metrics-model.js';
const DAY=86400000,start=Date.parse('2026-09-01T00:00:00Z'),at=(day,hour=0)=>new Date(start+day*DAY+hour*3600000).toISOString();
const id='00000000-0000-4000-8000-000000000001',id2='00000000-0000-4000-8000-000000000002';
const event=(name,day,extra={})=>({name,at:at(day),incentive:'unknown',prompt:'unknown',...extra});
const fixture=(events=[],extra={})=>({...createPilotRecord({participantId:id,role:'creator',source:'creator-invite',now:start}),observedThrough:at(40),updatedAt:at(40),events:[event('draft-reviewed',0,{at:at(0,12)}),...events],...extra});
const summarize=(records,day=40)=>summarizePilot(records,start+day*DAY);
function memory(){const map=new Map();return{map,getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)};}

test('exact D1/D7/D30 windows require full UTC maturity and use half-open return intervals',()=>{
  for(const day of [1,7,30]){
    const record=fixture([event('watched-coin-view',day),event('watched-coin-view',day+1)]);
    const immature=summarizePilot([record],start+(day+1)*DAY-1).retention[`d${day}`];
    assert.equal(immature.eligible,0);assert.equal(immature.rate,null);
    const mature=summarize([record],day+1).retention[`d${day}`];assert.equal(mature.eligible,1);assert.equal(mature.returned,1);
    assert.equal(summarize([fixture([event('watched-coin-view',day+1)])],day+1).retention[`d${day}`].returned,0);
  }
});
test('missing follow-up remains unknown; old exports cannot become non-return evidence just as time passes',()=>{
  const old=fixture([],{observedThrough:at(2),updatedAt:at(2)}),fresh=fixture([],{participantId:id2});
  const result=summarize([old,fresh]).retention.d7;
  assert.deepEqual({matured:result.matured,eligible:result.eligible,missing:result.missingFollowup,returned:result.returned},{matured:2,eligible:1,missing:1,returned:0});
  assert.equal(summarize([old]).retention.d7.rate,null);assert.equal(result.lowerBoundReturnRate,0);
});
test('future and pre-enrollment events do not activate or inflate measured funnels',()=>{
  const before=fixture([event('launch-confirmed',-1),event('claim-verified',50)],{startedAt:at(1),events:[event('draft-reviewed',0),event('launch-confirmed',50)]});
  const result=summarize([before],40);assert.equal(result.activated,0);assert.equal(result.launchConfirmed,0);
  assert.equal(summarize([fixture([],{startedAt:at(50)})],40).participants,0);
});
test('incentive and prompt classifications stay distinct, explicit and unknown by default',()=>{
  const record=fixture([event('watched-coin-view',7,{incentive:'none',prompt:'reminder'}),event('verified-reward-view',7,{incentive:'offered',prompt:'voluntary'}),event('followed-creator-view',7)]);
  const cohort=summarize([record]).retention.d7;
  assert.equal(cohort.returned,1);assert.equal(cohort.noneReturned,1);assert.equal(cohort.offeredReturned,1);assert.equal(cohort.unknownReturned,1);assert.equal(cohort.reminderReturned,1);assert.equal(cohort.voluntaryNoneReturned,0);
  assert.equal(summarize([fixture([event('watched-coin-view',7,{incentive:'none',prompt:'voluntary'})])]).retention.d7.voluntaryNoneReturned,1);
});
test('weekly cohorts and sustained four-week retention require the same device in every window',()=>{
  const complete=fixture([1,8,15,22].map(day=>event('watched-coin-view',day,{incentive:'none',prompt:'voluntary'})));
  const result=summarize([complete]);assert.equal(result.sustainedFourWeek.returnedAllWeeks,1);assert.equal(result.sustainedFourWeek.voluntaryNoneAllWeeks,1);
  for(let week=1;week<=4;week++)assert.equal(result.retention[`week${week}`].returned,1);
  const a=fixture([event('watched-coin-view',1),event('watched-coin-view',8)]),b=fixture([event('watched-coin-view',15),event('watched-coin-view',22)],{participantId:id2});
  assert.equal(summarize([a,b]).sustainedFourWeek.returnedAllWeeks,0);
  assert.equal(summarize([complete],28).sustainedFourWeek.eligible,0);
  assert.equal(summarize([{...complete,observedThrough:at(28)}]).sustainedFourWeek.missingFollowup,1);
});
test('duplicate exports deduplicate and conflicting immutable profiles are excluded',()=>{
  const record=fixture([event('watched-coin-view',7)]);
  assert.equal(summarize([record,record]).participants,1);
  for(const change of [{role:'community'},{source:'organic'},{cluster:'mainnet-beta'},{startedAt:at(1)}])assert.equal(summarize([record,{...record,...change}]).participants,0);
  assert.equal(summarize([record,{...record,source:'test'}]).participants,0);
  assert.equal(summarize([fixture([],{source:'bot'})]).participants,0);
});
test('legacy records preserve unknown role/network/context and full-cap histories have unknown baselines',()=>{
  const legacy={participantId:id,consented:true,source:'creator-invite',events:[{name:'draft-reviewed',at:at(0)}]};
  const migrated=normalizePilotRecord(legacy);assert.equal(migrated.cluster,'unknown');assert.equal(migrated.role,'unknown');assert.equal(migrated.events[0].incentive,'unknown');
  assert.equal(summarize([legacy]).d7Eligible,0);assert.equal(summarize([legacy]).byCluster.devnet.participants,0);
  const capped={...legacy,observedThrough:at(40),events:Array.from({length:300},(_,i)=>({name:i?'watched-coin-view':'draft-reviewed',at:new Date(start+i*1000).toISOString()}))};
  assert.equal(summarize([capped]).baselineUnknown,1);assert.equal(summarize([capped]).d7Eligible,0);
});
test('creator follow-through requires distinct publication times and observed 14-day follow-up',()=>{
  const duplicate=event('creator-update-published',1);
  assert.equal(summarize([fixture([duplicate,{...duplicate,incentive:'none'}])]).creatorSecondUpdate,0);
  assert.equal(summarize([fixture([duplicate,event('creator-update-published',9)])]).creatorSecondUpdate,1);
  assert.equal(summarize([fixture([duplicate,event('creator-update-published',9)],{observedThrough:at(10)})]).creatorFollowThroughEligible,0);
});
test('record schema strips extra fields and unknown event names; capacity stops coverage instead of evicting baseline',()=>{
  const clean=normalizePilotRecord(fixture([event('save-coin',1,{wallet:'secret-wallet',url:'https://private.invalid'})],{wallet:'secret-wallet',url:'https://private.invalid'}));
  assert.equal(JSON.stringify(clean).includes('secret-wallet'),false);assert.equal(JSON.stringify(clean).includes('private.invalid'),false);
  assert.equal(appendPilotEvent(clean,'not-an-event',{now:start+2*DAY}).events.length,clean.events.length);
  const full=fixture([],{events:Array.from({length:PILOT_MAX_EVENTS},(_,i)=>event('creator-update-published',0,{at:new Date(start+i).toISOString()})),observedThrough:at(1)});
  const stopped=appendPilotEvent(full,'save-coin',{now:start+2*DAY});assert.equal(stopped.events.length,PILOT_MAX_EVENTS);assert.equal(stopped.coverageEndedAt,at(1));assert.equal(stopped.observedThrough,at(1));
  assert.equal(normalizePilotRecord({...full,events:[...full.events,event('save-coin',2)]}),null);
});
test('recorder starts off, retains immutable enrollment on a second tab enable, and requires explicit profile replacement',()=>{
  const storage=memory(),a=createPilotRecorder({storage,now:()=>start,randomUUID:()=>id}),b=createPilotRecorder({storage,now:()=>start+1000,randomUUID:()=>id2});
  assert.equal(a.current(),null);assert.equal(a.record('save-coin'),null);assert.equal(storage.map.size,0);
  a.enable({role:'creator',source:'creator-invite'});a.record('save-coin');
  assert.equal(b.enable({role:'creator',source:'creator-invite'}).participantId,id);assert.equal(b.current().events.length,1);
  assert.throws(()=>b.enable({role:'community',source:'creator-invite'}),/Delete it/);assert.equal(a.current().role,'creator');
});
test('revocation stops stale tabs, prevents legacy regrant and survives storage deletion failure in memory',()=>{
  const storage=memory(),a=createPilotRecorder({storage,now:()=>start,randomUUID:()=>id}),b=createPilotRecorder({storage,now:()=>start,randomUUID:()=>id2});
  a.enable({role:'creator'});assert.ok(b.current());a.revoke();assert.equal(b.record('save-coin'),null);assert.equal(storage.getItem(PILOT_STORAGE_KEY),null);
  storage.setItem(PILOT_STORAGE_KEY,JSON.stringify({participantId:id,consented:true,startedAt:at(0),events:[]}));assert.equal(createPilotRecorder({storage}).current(),null);
  const c=createPilotRecorder({storage,now:()=>start,randomUUID:()=>id});c.enable({role:'community'});storage.removeItem=()=>{throw new Error('denied');};
  assert.throws(()=>c.revoke(),/could not be cleared/);assert.equal(c.export(),null);assert.equal(c.record('save-coin'),null);
});
test('read and write failures stop recording and export; fresh exports advance only complete coverage',()=>{
  const storage=memory();let now=start;const recorder=createPilotRecorder({storage,now:()=>now,randomUUID:()=>id});recorder.enable({role:'creator'});
  now+=DAY;assert.equal(recorder.export().observedThrough,at(1));now+=DAY;assert.equal(recorder.export({observe:false}).observedThrough,at(1));
  storage.setItem=()=>{throw new Error('quota');};assert.throws(()=>recorder.record('save-coin'),/stopped/);assert.equal(recorder.export(),null);
  const reader=createPilotRecorder({storage});storage.getItem=()=>{throw new Error('denied');};assert.throws(()=>reader.current(),/stopped/);assert.equal(reader.export(),null);
});
test('aggregate CLI reports honest Devnet denominators without emitting identifiers or private fields',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'funded-pilot-cli-'));
  try{
    const file=join(directory,'record.json');await writeFile(file,JSON.stringify(fixture([event('watched-coin-view',7)],{wallet:'private-wallet',url:'https://private.invalid'})));
    const result=spawnSync(process.execPath,['scripts/summarize-pilot-metrics.mjs','--as-of',at(40),file],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
    const report=JSON.parse(result.stdout);assert.equal(report.devnetPilot.d7Returned,1);assert.equal(report.devnetPilot.d7Eligible,1);assert.ok(report.nextActions.length);
    for(const secret of [id,'private-wallet','private.invalid'])assert.equal(result.stdout.includes(secret),false);
    await writeFile(file,'x'.repeat(1_048_577));const large=spawnSync(process.execPath,['scripts/summarize-pilot-metrics.mjs',file],{encoding:'utf8'});assert.equal(large.status,2);assert.match(large.stderr,/limits/);
  }finally{await rm(directory,{recursive:true,force:true});}
});
