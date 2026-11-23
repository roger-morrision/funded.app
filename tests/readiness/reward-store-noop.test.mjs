import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,readFile,writeFile,stat,mkdir,rename,readdir} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createAutomaticRewardStore,REWARD_LEDGER_UNCHANGED} from '../../server/automatic-reward-store.mjs';
async function fixture(t){
  const base=await realpath(tmpdir()),dir=await mkdtemp(join(base,'funded-store-noop-'));
  t.after(async()=>{const target=await realpath(dir);assert.equal(target,resolve(dir));assert(target.startsWith(base+sep));await rm(target,{recursive:true,force:true});});
  const path=join(dir,'ledger.json');return{dir,path,store:createAutomaticRewardStore(path),reopen:()=>createAutomaticRewardStore(path)};
}
const identity=path=>stat(path,{bigint:true});
const seed=store=>store.transaction(s=>{s.schedules.unit={amount:'1',proof:'public-unit-proof',paidAt:'fixed-unit-time',note:'unit café 💠'};});

test('byte-identical transaction preserves the actual ledger inode bytes and return value',async t=>{
  const f=await fixture(t);await seed(f.store);const before=await identity(f.path),bytes=await readFile(f.path);assert(before.ino>0n);
  const result=await f.store.transaction(s=>({amount:s.schedules.unit.amount}));assert.deepEqual(result,{amount:'1'});
  assert.equal((await identity(f.path)).ino,before.ino);assert.deepEqual(await readFile(f.path),bytes);
});

test('explicit unchanged hint skips full JSON encoding while retaining the locked inode and fence',async t=>{
  const f=await fixture(t);await seed(f.store);const before=await identity(f.path),bytes=await readFile(f.path);
  const stringify=JSON.stringify;let calls=0;
  try{JSON.stringify=()=>{calls++;throw Error('Unexpected full-ledger encoding');};
    assert.equal(await f.store.transaction(s=>{assert.equal(s.schedules.unit.amount,'1');return REWARD_LEDGER_UNCHANGED;}),REWARD_LEDGER_UNCHANGED);
  }finally{JSON.stringify=stringify;}
  assert.equal(calls,0);assert.equal((await identity(f.path)).ino,before.ino);assert.deepEqual(await readFile(f.path),bytes);
});

test('unchanged hint still publishes bootstrap and version-1 migration',async t=>{
  const f=await fixture(t);assert.equal(await f.store.transaction(()=>REWARD_LEDGER_UNCHANGED),REWARD_LEDGER_UNCHANGED);
  assert.equal((await f.reopen().read()).version,2);
  await writeFile(f.path,JSON.stringify({version:1,schedules:{unit:{amount:'7'}}}));const old=await identity(f.path);
  await f.reopen().transaction(()=>REWARD_LEDGER_UNCHANGED);
  assert.equal((await f.reopen().read()).version,2);assert.notEqual((await identity(f.path)).ino,old.ino);
});

test('explicit unchanged hint interleaved with competing changed writers never loses a publication',async t=>{
  const f=await fixture(t);await f.store.transaction(s=>{s.unitCounter=0;});const jobs=[];
  for(let i=0;i<24;i++){jobs.push(f.reopen().transaction(s=>{s.unitCounter++;}));
    jobs.push(f.store.transaction(s=>{assert(Number.isSafeInteger(s.unitCounter));return REWARD_LEDGER_UNCHANGED;}));}
  await Promise.all(jobs);assert.equal((await f.reopen().read()).unitCounter,24);
});

test('missing-file read-only transaction still bootstraps a durable version2 ledger',async t=>{
  const f=await fixture(t);assert.equal(await f.store.transaction(s=>s.version),2);
  assert.equal(JSON.parse(await readFile(f.path,'utf8')).version,2);assert.equal((await f.reopen().read()).version,2);
});

test('version1 migration persists even when the caller changes no financial field',async t=>{
  const f=await fixture(t);await writeFile(f.path,JSON.stringify({version:1,schedules:{unit:{amount:'7'}}}));const old=await identity(f.path);
  assert.equal(await f.store.transaction(s=>s.version),2);const saved=JSON.parse(await readFile(f.path,'utf8'));
  assert.equal(saved.version,2);assert.equal(saved.schedules.unit.amount,'7');assert.notEqual((await identity(f.path)).ino,old.ino);
});

test('changed proof bytes persist before transaction return and a simulated broadcast callback',async t=>{
  const f=await fixture(t);await seed(f.store);const before=await identity(f.path);let broadcasts=0;
  await f.store.transaction(s=>{s.schedules.unit.proof='new-public-unit-proof';});
  assert.equal((await f.reopen().read()).schedules.unit.proof,'new-public-unit-proof');broadcasts++;
  assert.equal(broadcasts,1);assert.notEqual((await identity(f.path)).ino,before.ino);
});

test('a falsey mutator result cannot suppress a changed financial record',async t=>{
  const f=await fixture(t);await seed(f.store);
  assert.equal(await f.store.transaction(s=>{s.schedules.unit.amount='2';return false;}),false);
  assert.equal((await f.reopen().read()).schedules.unit.amount,'2');
});

test('serialization failures preserve prior bytes release locks and prevent subsequent action',async t=>{
  for(const mode of ['bigint','circular']){
    const f=await fixture(t);await seed(f.store);const before=await readFile(f.path);let broadcasts=0;
    await assert.rejects(async()=>{await f.store.transaction(s=>{if(mode==='bigint')s.invalid=1n;else s.invalid=s;});broadcasts++;});
    assert.equal(broadcasts,0);assert.deepEqual(await readFile(f.path),before);await f.store.transaction(s=>{s.recovered=true;});assert.equal((await f.reopen().read()).recovered,true);
    assert.deepEqual((await readdir(f.dir)).filter(n=>n.endsWith('.lock')||n.endsWith('.tmp')),[]);
  }
});

test('mutator failure cannot publish partial state or leave a stale writer lock',async t=>{
  const f=await fixture(t);await seed(f.store);const before=await readFile(f.path);
  await assert.rejects(f.store.transaction(s=>{s.schedules.unit.amount='99';throw Error('mutator refused');}),/mutator refused/);
  assert.deepEqual(await readFile(f.path),before);await f.reopen().transaction(s=>{s.schedules.unit.amount='2';});assert.equal((await f.store.read()).schedules.unit.amount,'2');
});

test('actual changed-state rename failure prevents publication and releases temporary files',async t=>{
  const f=await fixture(t);await seed(f.store);const before=await readFile(f.path);let broadcasts=0;
  await assert.rejects(async()=>{await f.store.transaction(async s=>{
    s.schedules.unit.proof='unpublished-new-proof';await rename(f.path,f.path+'.backup');await mkdir(f.path);await writeFile(join(f.path,'blocker'),'unit-only');
  });broadcasts++;});
  assert.equal(broadcasts,0);assert.deepEqual(await readFile(f.path+'.backup'),before);
  assert.deepEqual((await readdir(f.dir)).filter(n=>n.endsWith('.lock')||n.endsWith('.tmp')),[]);
});

test('competing stores retain all changed increments when byte-identical calls interleave',async t=>{
  const f=await fixture(t);await f.store.transaction(s=>{s.unitCounter=0;});const jobs=[];
  for(let i=0;i<40;i++){const store=i%2?f.store:f.reopen();jobs.push(store.transaction(s=>{s.unitCounter++;return s.unitCounter;}));if(i%4===0)jobs.push(store.transaction(s=>s.version));}
  await Promise.all(jobs);assert.equal((await f.reopen().read()).unitCounter,40);
});

test('public read cache remains correct across no-op changed-state and caller mutations',async t=>{
  const f=await fixture(t);await seed(f.store);const first=await f.store.readStatusSnapshot();first.schedules.unit.amount='caller-only';
  await f.store.transaction(s=>s.version);assert.equal((await f.store.readStatusSnapshot()).schedules.unit.amount,'1');
  await f.reopen().transaction(s=>{s.schedules.unit.amount='2';});assert.equal((await f.store.readStatusSnapshot()).schedules.unit.amount,'2');
  assert.equal((await f.reopen().read()).schedules.unit.amount,'2');
});

test('targeted schedule read excludes unrelated signed rows and refreshes after another writer',async t=>{
  const f=await fixture(t);await f.store.transaction(s=>{
    s.schedules.a={amount:'1',payoutAttempts:{one:{signature:'original'}}};
    s.schedules.b={amount:'9',payoutAttempts:{other:{signature:'unrelated'}}};
  });
  const first=await f.store.readSchedule('a');assert.equal(first.payoutAttempts.one.signature,'original');
  assert.equal(first.payoutAttempts.other,undefined);first.amount='caller-only';
  assert.equal((await f.store.readSchedule('a')).amount,'1');
  await f.reopen().transaction(s=>{s.schedules.a.amount='2';s.schedules.b.amount='10';});
  assert.equal((await f.store.readSchedule('a')).amount,'2');
  assert.equal((await f.store.readSchedule('missing')),undefined);
});

test('noncanonical persisted JSON is normalized once then exact-byte no-op stays unchanged',async t=>{
  const f=await fixture(t);await writeFile(f.path,JSON.stringify({version:2,schedules:{unit:{amount:'1'}}},null,2)+'\n');
  await f.store.transaction(s=>s.version);const bytes=await readFile(f.path),before=await identity(f.path);assert.equal(bytes.toString(),JSON.stringify(JSON.parse(bytes)));
  await f.store.transaction(s=>s.version);assert.equal((await identity(f.path)).ino,before.ino);assert.deepEqual(await readFile(f.path),bytes);
});

test('malformed or unsupported persisted state is not overwritten as a no-op or bootstrap',async t=>{
  for(const text of ['not JSON','{"version":99}']){
    const f=await fixture(t);await writeFile(f.path,text);await assert.rejects(f.store.transaction(s=>s.version));assert.equal(await readFile(f.path,'utf8'),text);
    assert.deepEqual((await readdir(f.dir)).filter(n=>n.endsWith('.lock')||n.endsWith('.tmp')),[]);
  }
});

test('offline byte-copy reopen retains the saved record without authorizing financial recovery',async t=>{
  const f=await fixture(t);await seed(f.store);const backup=await readFile(f.path);await f.store.transaction(s=>{s.schedules.unit.amount='2';});
  // Isolated serialization fixture only. Real financial restores require exact
  // chain reconciliation and cannot roll back final payments or permit retries.
  await writeFile(f.path,backup);const reopened=f.reopen();assert.equal((await reopened.read()).schedules.unit.amount,'1');
  const before=await identity(f.path);await reopened.transaction(s=>s.version);assert.equal((await identity(f.path)).ino,before.ino);assert.deepEqual(await readFile(f.path),backup);
});

test('drain waits for active changed publication and continues rejecting new transactions',async t=>{
  const f=await fixture(t),url=new URL('../../server/automatic-reward-store.mjs',import.meta.url).href;
  const code=`import assert from 'node:assert/strict';import {createAutomaticRewardStore,drainAutomaticRewardTransactions} from ${JSON.stringify(url)};
    const store=createAutomaticRewardStore(process.argv[1]);let release;const gate=new Promise(r=>{release=r;});
    const active=store.transaction(async s=>{await gate;s.unitProof='persisted-before-drain';});const drained=drainAutomaticRewardTransactions();
    await assert.rejects(store.transaction(s=>s.version),e=>e.statusCode===503);release();await Promise.all([active,drained]);
    assert.equal((await store.read()).unitProof,'persisted-before-drain');console.log('drain-and-publication-passed');`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',code,f.path],{encoding:'utf8',timeout:10000});
  assert.equal(child.status,0,child.stderr);assert.match(child.stdout,/drain-and-publication-passed/);
});


test('invalid UTF8 is normalized rather than mistaken for identical persisted bytes',async t=>{
  const f=await fixture(t),raw=Buffer.concat([Buffer.from('{"version":2,"label":"'),Buffer.from([255]),Buffer.from('"}')]);await writeFile(f.path,raw);
  const before=await identity(f.path);assert.equal(await f.store.transaction(s=>s.version),2);
  const current=await readFile(f.path);assert.notDeepEqual(current,raw);assert.equal(JSON.parse(current).label,'\ufffd');assert.notEqual((await identity(f.path)).ino,before.ino);
  const normalized=await identity(f.path);await f.store.transaction(s=>s.version);assert.equal((await identity(f.path)).ino,normalized.ino);
});
