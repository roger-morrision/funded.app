import test from 'node:test';
import assert from 'node:assert/strict';
import { createPilotStorage, pilotStorageSnapshot, pilotLegacySnapshot, PILOT_DB_KEY, PILOT_DB_NAME, PILOT_DB_STORE } from '../pilot-storage.js';
import { PILOT_STORAGE_KEY, PILOT_CONSENT_KEY, createPilotRecord } from '../pilot-metrics-model.js';

// A manually committed transaction isolates the adapter's commit/abort contract;
// cross-renderer serialization is separately exercised with real browser IDB.
function fixture(initial, legacyValues = {}) {
  let saved = initial, waiter;
  const legacy = new Map(Object.entries(legacyValues)), cleanups = [];
  const legacyStorage = { getItem:key => legacy.get(key) ?? null,
    setItem:(key,value) => { cleanups.push(['set',key,value]); legacy.set(key,value); },
    removeItem:key => { cleanups.push(['remove',key]); legacy.delete(key); } };
  const db = { close() {}, transaction(store,mode) {
    assert.equal(store,PILOT_DB_STORE); assert.equal(mode,'readwrite');
    let draft = saved, aborted = false;
    const tx = { objectStore:() => ({
      get(key) {
        assert.equal(key,PILOT_DB_KEY); const req = {result:structuredClone(saved)};
        queueMicrotask(() => { req.onsuccess(); waiter(tx); }); return req;
      },
      put(value,key) { assert.equal(key,PILOT_DB_KEY); draft=structuredClone(value); },
    }),
    abort() { aborted=true; queueMicrotask(() => tx.onabort()); },
    commit() { assert.equal(aborted,false); saved=draft; tx.oncomplete(); },
    };
    return tx;
  } };
  const indexedDB = { open(name,version) {
    assert.equal(name,PILOT_DB_NAME); assert.equal(version,1);
    const req = {result:db}; queueMicrotask(() => req.onsuccess()); return req;
  } };
  return { adapter:createPilotStorage({indexedDB,legacyStorage}), legacyStorage,legacy,cleanups,
    ready:() => new Promise(resolve => { waiter=resolve; }), saved:() => saved };
}

test('pilot record and grant are published only after the transaction commits',async()=>{
  const f=fixture({version:1,record:null,grant:'off'}), ready=f.ready(); let resolved=false;
  const pending=f.adapter.run(()=>{
    f.adapter.storage.setItem(PILOT_STORAGE_KEY,'{"participantId":"fixture"}');
    f.adapter.storage.setItem(PILOT_CONSENT_KEY,'fixture'); return 'result';
  }).then(result=>{resolved=true;return result;});
  const tx=await ready;
  assert.equal(resolved,false);assert.equal(f.saved().grant,'off');assert.deepEqual(f.cleanups,[]);
  tx.commit();
  assert.deepEqual(await pending,{value:'result',changed:true,consentEpoch:0,legacyCleanupFailed:false});
  assert.equal(f.saved().grant,'fixture');assert.equal(f.legacy.get(PILOT_CONSENT_KEY),'off');
  assert.throws(()=>f.adapter.storage.getItem(PILOT_STORAGE_KEY),/only inside/);
});

test('aborted writes retain the original record and never clean legacy before commit',async()=>{
  const initial={version:1,record:'retained',grant:'original'},f=fixture(initial),ready=f.ready();
  const pending=f.adapter.run(()=>f.adapter.storage.setItem(PILOT_STORAGE_KEY,'replacement'));
  const rejected=assert.rejects(pending,/storage is unavailable/);
  const tx=await ready;tx.abort();await rejected;
  assert.deepEqual(f.saved(),initial);assert.deepEqual(f.cleanups,[]);
});

test('legacy migration imports once, preserves off, and retained tombstones ignore stale legacy records',async()=>{
  const f=fixture(undefined,{[PILOT_STORAGE_KEY]:'legacy-record',[PILOT_CONSENT_KEY]:'off'});
  let ready=f.ready();let pending=f.adapter.run(()=>({record:f.adapter.storage.getItem(PILOT_STORAGE_KEY),grant:f.adapter.storage.getItem(PILOT_CONSENT_KEY)}));
  (await ready).commit();assert.deepEqual((await pending).value,{record:null,grant:'off'});
  assert.equal(f.legacy.has(PILOT_STORAGE_KEY),false);
  ready=f.ready();pending=f.adapter.run(()=>{f.adapter.storage.removeItem(PILOT_STORAGE_KEY);f.adapter.storage.setItem(PILOT_CONSENT_KEY,'off');},{clearLegacy:true});
  (await ready).commit();await pending;
  f.legacy.set(PILOT_STORAGE_KEY,'stale resurrected data');f.legacy.set(PILOT_CONSENT_KEY,'old-consent');
  f.legacyStorage.getItem=()=>assert.fail('initialized IDB must never read legacy again');
  ready=f.ready();pending=f.adapter.run(()=>f.adapter.storage.getItem(PILOT_STORAGE_KEY));
  (await ready).commit();assert.equal((await pending).value,null);
  assert.deepEqual(f.saved(),{version:1,record:null,grant:'off',consentEpoch:0});
});

test('legacy cleanup failure is reported after a successful durable deletion',async()=>{
  const f=fixture({version:1,record:'retained',grant:'original'}),ready=f.ready();
  f.legacyStorage.setItem=()=>{throw new Error('denied');};
  f.legacyStorage.removeItem=()=>{throw new Error('denied');};
  const pending=f.adapter.run(()=>{f.adapter.storage.removeItem(PILOT_STORAGE_KEY);f.adapter.storage.setItem(PILOT_CONSENT_KEY,'off');},{clearLegacy:true});
  (await ready).commit();assert.equal((await pending).legacyCleanupFailed,true);
  assert.deepEqual(f.saved(),{version:1,record:null,grant:'off',consentEpoch:0});
});

test('async callbacks abort rather than committing a partially mutated snapshot',async()=>{
  const f=fixture({version:1,record:null,grant:'off'}),ready=f.ready();
  const pending=f.adapter.run(()=>{f.adapter.storage.setItem(PILOT_CONSENT_KEY,'new');return Promise.resolve();});
  const rejected=assert.rejects(pending,/must be synchronous/);await ready;await rejected;
  assert.equal(f.saved().grant,'off');assert.deepEqual(f.cleanups,[]);
});

test('unavailable IDB fails closed without accessing legacy and malformed authoritative snapshots reject',async()=>{
  const adapter=createPilotStorage({indexedDB:null,legacyStorage:{getItem:()=>assert.fail('no fallback')}});
  await assert.rejects(adapter.run(()=>assert.fail('no callback')),/storage is unavailable/);
  for(const invalid of [null,{}, {version:1,record:undefined,grant:null}, {version:2,record:null,grant:null}, {version:1,record:{},grant:'off'}])assert.throws(()=>pilotStorageSnapshot(invalid),/storage is unavailable/);
  const f=fixture({version:1,record:null,grant:'off'});f.adapter.close();
  await assert.rejects(f.adapter.run(()=>assert.fail('closed callback')),/storage is unavailable/);
});

test('migration preserves consented identity and allowed fields but never imports revoked or mismatched data',()=>{
  const record=createPilotRecord({participantId:'12345678-1234-1234-1234-123456789abc',role:'creator',source:'organic'});
  const encoded=JSON.stringify({...record,wallet:'private-wallet',url:'https://private.invalid'});
  const imported=pilotLegacySnapshot(encoded,record.participantId);
  assert.deepEqual(JSON.parse(imported.record),record);
  assert.equal(imported.grant,record.participantId);
  for(const grant of ['off','different-id',null])assert.deepEqual(pilotLegacySnapshot(encoded,grant),{version:1,record:null,grant:'off',consentEpoch:0});
  const legacy=pilotLegacySnapshot(JSON.stringify({...record,version:1}),null);
  assert.equal(JSON.parse(legacy.record).participantId,record.participantId);
  assert.equal(legacy.grant,record.participantId);
});

test('durable revocation epoch rejects stale opt-in even without any cross-tab notification',async()=>{
  const f=fixture({version:1,record:null,grant:'off',consentEpoch:0});
  for(let epoch=1;epoch<=2;epoch++){
    const ready=f.ready(),pending=f.adapter.run(()=>{f.adapter.storage.removeItem(PILOT_STORAGE_KEY);f.adapter.storage.setItem(PILOT_CONSENT_KEY,'off');},{clearLegacy:true,revoke:true});
    (await ready).commit();assert.equal((await pending).consentEpoch,epoch);
  }
  const ready=f.ready(),pending=f.adapter.run(()=>assert.fail('stale opt-in must not execute'),{expectedConsentEpoch:0});
  const rejected=assert.rejects(pending,error=>error.code==='PILOT_CONSENT_CHANGED');await ready;await rejected;
  assert.deepEqual(f.saved(),{version:1,record:null,grant:'off',consentEpoch:2});
  const freshReady=f.ready(),fresh=f.adapter.run(()=>f.adapter.storage.setItem(PILOT_CONSENT_KEY,'explicit-new-consent'),{expectedConsentEpoch:2});
  (await freshReady).commit();assert.equal((await fresh).consentEpoch,2);
  assert.equal(f.saved().grant,'explicit-new-consent');
});
