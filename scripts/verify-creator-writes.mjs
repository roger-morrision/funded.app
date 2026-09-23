import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createStore } from '../server/store.mjs';

export async function verifyCreatorWrites(store, other=store, concurrentIdentities=false) {
  await store.updateCreatorProfile('901',s=>{s.creatorProfiles['901']={id:'901',handle:'@writer_fixture',listed:true,identityVerified:true,counter:0};});
  await other.updateCreatorProfile('902',s=>{s.creatorProfiles['902']={id:'902',counter:0};});
  await Promise.all([...Array.from({length:20},(_,n)=>(n%2?store:other).updateCreatorProfile('901',s=>{s.creatorProfiles['901'].counter++;})),
    store.update(s=>{s.creatorProfiles['901'].counter++;})]);
  assert.equal((await store.readCreatorState('901','devnet')).creatorProfiles['901'].counter,21,'Same-identity and legacy writers must not lose updates.');
  for(const mutate of [s=>{s.creatorProfiles['999']={};},s=>{s.launches.fake={};},s=>{s.payouts={};},s=>{s.creatorProfiles['901'].id='902';}]) {
    await assert.rejects(store.updateCreatorProfile('901',s=>{s.creatorProfiles['901'].counter=999;mutate(s);}));
    assert.equal((await store.readCreatorState('901','devnet')).creatorProfiles['901'].counter,21,'Rejected scoped writes must roll back.');
  }
  await assert.rejects(store.updateCreatorProfile('not-an-id',()=>{}));
  assert.equal((await store.readCreatorDirectory({cluster:'devnet',follows:['901']})).creators[0].id,'901');
  await store.updateCreatorProfile('901',s=>{s.creatorProfiles['901'].optedOut=true;});
  assert.equal((await store.readCreatorDirectory({cluster:'devnet',follows:['901']})).creators.length,0,'Scoped write updates discovery atomically.');
  if(concurrentIdentities) {
    let release,entered;
    const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
    const first=store.updateCreatorProfile('901',async s=>{entered();await gate;s.creatorProfiles['901'].counter++;});
    let timer;
    try {
      await started;
      await Promise.race([other.updateCreatorProfile('902',s=>{s.creatorProfiles['902'].counter++;}),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Unrelated creator write blocked behind first identity.')),5000);})]);
    } finally {clearTimeout(timer);release();await first;}
    assert.equal((await other.readCreatorState('902','devnet')).creatorProfiles['902'].counter,1);
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const dir=await mkdtemp(join(tmpdir(),'funded-creator-writes-'));
  try{await verifyCreatorWrites(createStore(join(dir,'state.json'),''));console.log('Scoped creator writes: serialization, legacy coexistence, scope guards, rollback and immediate discovery opt-out passed (local-only).');}
  finally{await rm(dir,{recursive:true,force:true});}
}
