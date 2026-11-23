import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,PublicKey} from '@solana/web3.js';
import nacl from 'tweetnacl';
import {createAutomaticRewardStore} from '../../server/automatic-reward-store.mjs';
import {prepareTokenConversionRuntime} from '../../server/token-conversion-bootstrap.mjs';
import {tokenPricePolicyHash} from '../../server/token-conversion-sell-review.mjs';
import {conversionServiceFixture} from './token-conversion-service-fixture.mjs';

async function setup(t){
  const c=await conversionServiceFixture(t),roles=['controller','operator','price-attestation'],events=[];
  const counts={connection:0,store:0,authentication:0,custody:0,sign:0,remote:0};
  const options=(role,mode)=>{
    const f=c.all[role==='controller'?'worker':role],spec={schemaVersion:1,cluster:'mainnet-beta',role,mode,programId:f.config.programId,
      programDataSha256:f.config.programDataSha256,policyHash:tokenPricePolicyHash(f.config),
      journalReferences:Object.fromEntries(roles.map(r=>[r,'fixture-journal-'+r])),rpcReferences:Object.fromEntries(roles.map(r=>[r,'fixture-rpc-'+r])),
      authenticationReferences:Object.fromEntries(roles.map(r=>[r,'fixture-auth-'+r])),custodyReference:'fixture-custody-'+role,
      origins:{operator:'https://operator-custody.invalid/','price-attestation':'https://price-custody.invalid/'}};
    const connection={...f.connection};
    for(const method of ['getGenesisHash','getSlot','getAccountInfoAndContext','getMultipleAccountsInfoAndContext'])connection[method]=async(...args)=>{events.push(method);return f.connection[method](...args);};
    return {spec,policy:f.config,release:f.release,now:()=>f.now,
      connectionFactory:async ref=>{counts.connection++;events.push('connection');assert.equal(ref,spec.rpcReferences[role]);return connection;},
      storeFactory:async ref=>{counts.store++;events.push('store');assert(events.includes('getMultipleAccountsInfoAndContext'));assert.equal(ref,spec.journalReferences[role]);return createAutomaticRewardStore(c.paths[role==='controller'?'worker':role]);},
      loadAuthentication:async ref=>{counts.authentication++;events.push('authentication');assert(events.indexOf('store')<events.lastIndexOf('authentication'));
        const r=roles.find(r=>spec.authenticationReferences[r]===ref);assert(r);return c.tokens[r==='controller'?'worker':r];},
      loadCustody:async(ref,expected)=>{counts.custody++;events.push('custody');assert.equal(ref,spec.custodyReference);assert.equal(expected.role,role);
        const key=Keypair.fromSeed(new Uint8Array(32).fill(role==='operator'?33:34));assert.equal(expected.publicKey,String(key.publicKey));
        return {publicKey:key.publicKey,signMessage:args=>{counts.sign++;events.push('sign');return nacl.sign.detached(args.message,key.secretKey);}};},
      request:async(url,opts)=>{counts.remote++;const r=new URL(url).hostname==='price-custody.invalid'?'price-attestation':'operator';return fetch(c.origins[r]+new URL(url).pathname,opts);},
    };
  };
  const install=async role=>{const runtime=await prepareTokenConversionRuntime(options(role,'signing')),key=role==='controller'?'worker':role;
    const old=key==='worker'?c.controller.server:c.backends[key].server;old.closeAllConnections();await new Promise(r=>old.close(r));
    c.origins[key]=await c.bind(runtime.server);if(key==='worker')c.controller=runtime;else c.backends[key]=runtime;return runtime;};
  return {c,events,counts,options,install};
}

for(const role of ['controller','operator','price-attestation'])test('bootstrap defaults '+role+' to recovery without touching custody or listening',async t=>{
  const {c,counts,options}=await setup(t),o=options(role),runtime=await prepareTokenConversionRuntime(o);
  assert.equal(runtime.admission.mode,'recovery-only');assert.equal(runtime.server.listening,false);assert.equal(counts.custody,0);assert.equal(counts.sign,0);
  assert.equal(typeof runtime.recoveryWorker?.tick,role==='controller'?'function':'undefined');
  if(role==='controller')assert.deepEqual(runtime.recoveryWorker.status(),{running:false,faulted:false,lastResult:null});
  const origin=await c.bind(runtime.server),body=role==='controller'?{schemaVersion:1,request:c.all.worker.request,recoveryOnly:false}:c.signBody(role);
  const response=await fetch(origin+(role==='controller'?'/run':'/sign'),{method:'POST',headers:{authorization:'Bearer '+c.tokens[role==='controller'?'worker':role],'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal(response.status,role==='controller'?200:503);if(role==='controller')assert.equal((await response.json()).status,'unavailable');
  assert.equal(counts.custody,0);assert.equal(counts.remote,0);assert.equal(c.calls.send,0);
});

test('bootstrap prepares three real HTTP services and loads each approved role lazily after verified claims',async t=>{
  const {c,counts,events,install}=await setup(t);for(const role of ['operator','price-attestation','controller'])await install(role);
  assert.equal(counts.custody,0);const result=await c.run({request:c.all.worker.request});assert.equal(result.body.status,'settled');assert.equal(result.body.signerReconciliation,'settled');
  assert.equal(counts.custody,2);assert.equal(counts.sign,2);assert.equal(c.calls.send,1);assert(events.indexOf('getAccountInfoAndContext')<events.indexOf('custody'));
  await c.run({messageHash:c.hash,recoveryOnly:true});assert.equal(counts.custody,2);assert.equal(counts.sign,2);assert.equal(c.calls.send,1);
});

for(const fault of ['genesis','program-data','program-owner','pointer','stale-program','stale-accounts','global-owner','price-owner'])test('bootstrap '+fault+' fails before authentication or custody access',async t=>{
  const {c,counts,options}=await setup(t),o=options('operator','signing'),f=c.all.operator;
  if(fault==='genesis')f.connection.getGenesisHash=async()=> 'wrong-network';
  if(fault==='program-data')f.programData.data[50]^=1;
  if(['program-owner','pointer','stale-program'].includes(fault)){
    const read=f.connection.getAccountInfoAndContext;f.connection.getAccountInfoAndContext=async(address,...args)=>{
      const value=await read(address,...args);if(String(address)!==f.config.programId)return value;
      if(fault==='stale-program')return {...value,context:{slot:f.market.slot-1}};
      const account={...value.value,data:Buffer.from(value.value.data)};
      if(fault==='pointer')account.data[4]^=1;else account.owner=PublicKey.default;return {...value,value:account};
    };
  }
  if(fault==='stale-accounts'){
    const read=f.connection.getMultipleAccountsInfoAndContext;f.connection.getMultipleAccountsInfoAndContext=async(...args)=>{const v=await read(...args);return {...v,context:{slot:f.market.slot-1}};};
  }
  if(fault==='global-owner')f.beforeRows.get(f.addresses.router).owner=PublicKey.default;
  if(fault==='price-owner')f.beforeRows.get(f.addresses.price).owner=PublicKey.default;
  await assert.rejects(prepareTokenConversionRuntime(o),/Finalized conversion runtime context/);assert.equal(counts.authentication,0);assert.equal(counts.custody,0);assert.equal(counts.store,0);
});

test('bootstrap malformed public references or unadmitted policy cannot invoke any resolver',async t=>{
  const {counts,options}=await setup(t);
  for(const mutate of [o=>{o.release=null;},o=>{o.spec.policyHash='0'.repeat(64);},o=>{o.spec.mode='enabled';},
    o=>{o.spec.journalReferences.operator=o.spec.journalReferences.controller;},o=>{o.spec.rpcReferences['price-attestation']=o.spec.rpcReferences.operator;},
    o=>{o.spec.authenticationReferences.operator='/private/key';},o=>{o.spec.origins.operator='https://user:password@example.com/';},o=>{o.spec.custodyReference=null;}]){
    const o=options('operator','signing');mutate(o);await assert.rejects(prepareTokenConversionRuntime(o));
  }
  assert.equal(counts.connection,0);assert.equal(counts.store,0);assert.equal(counts.authentication,0);assert.equal(counts.custody,0);
});

test('bootstrap journal failure is sanitized before authentication access',async t=>{
  const {counts,options}=await setup(t),o=options('operator','signing');o.storeFactory=async()=>{throw Error('private namespace details');};
  await assert.rejects(prepareTokenConversionRuntime(o),e=>e.message==='Conversion journal reference unavailable or incompatible.');assert.equal(counts.authentication,0);assert.equal(counts.custody,0);
});

test('bootstrap authentication failure is sanitized without custody access',async t=>{
  const {counts,options}=await setup(t),o=options('operator','signing');o.loadAuthentication=async()=>{throw Error('private token details');};
  await assert.rejects(prepareTokenConversionRuntime(o),e=>e.message==='Conversion authentication reference unavailable.');assert.equal(counts.custody,0);
});

test('bootstrap signing mode refuses a paused or rotated current authority before secret access',async t=>{
  for(const fault of ['pause','operator','price']){
    const {c,counts,options}=await setup(t),f=c.all.operator;
    if(fault==='pause')f.beforeRows.get(f.addresses.router).data[106]=1;
    else PublicKey.default.toBuffer().copy(f.beforeRows.get(fault==='operator'?f.addresses.router:f.addresses.price).data,fault==='operator'?41:8);
    await assert.rejects(prepareTokenConversionRuntime(options('operator','signing')),/Finalized conversion runtime context/);assert.equal(counts.authentication,0);assert.equal(counts.custody,0);
  }
});

test('bootstrap recovery mode preserves saved proof through pause and operator rotation without custody',async t=>{
  const {c,counts,options}=await setup(t);assert.equal((await c.run({request:c.all.worker.request})).body.status,'settled');
  const f=c.all.worker;f.beforeRows.get(f.addresses.router).data[106]=1;PublicKey.default.toBuffer().copy(f.beforeRows.get(f.addresses.router).data,41);
  const runtime=await prepareTokenConversionRuntime(options('controller'));assert.equal(runtime.admission.freshSigningEligible,false);
  const old=c.controller.server;old.closeAllConnections();await new Promise(r=>old.close(r));c.origins.worker=await c.bind(runtime.server);c.controller=runtime;
  const result=await c.run({messageHash:c.hash,recoveryOnly:false});assert.equal(result.body.status,'settled');assert.equal(result.body.signerReconciliation,'settled');assert.equal(counts.custody,0);assert.equal(c.calls.send,1);
});

test('bootstrap program changed after durable signing claim cannot reach custody loader',async t=>{
  const {c,counts,options}=await setup(t),o=options('price-attestation','signing'),f=c.all['price-attestation'],base=createAutomaticRewardStore(c.paths['price-attestation']);let changed=false;
  o.storeFactory=async()=>({read:()=>base.read(),transaction:async mutate=>{const result=await base.transaction(mutate);const rows=Object.values((await base.read()).tokenConversionPriceJournalV1.attempts);
    if(!changed&&rows.some(r=>r.signingStartedAt)){changed=true;f.programData.data[50]^=1;}return result;}});
  const runtime=await prepareTokenConversionRuntime(o);c.origins['price-attestation']=await c.bind(runtime.server);
  assert.equal((await c.post('price-attestation','/sign',c.signBody('price-attestation'))).status,409);assert.equal(counts.custody,0);assert.equal(counts.sign,0);
});

test('bootstrap wrong loaded custody identity cannot produce a signature',async t=>{
  const {c,counts,options}=await setup(t),o=options('operator','signing');o.loadCustody=async()=>{counts.custody++;return {publicKey:PublicKey.default,signMessage:()=>{counts.sign++;}};};
  const runtime=await prepareTokenConversionRuntime(o);c.origins.operator=await c.bind(runtime.server);
  assert.equal((await c.post('operator','/sign',c.signBody('operator'))).status,409);assert.equal(counts.custody,1);assert.equal(counts.sign,0);
});

test('bootstrap context changed during custody resolution prevents use of the loaded handle',async t=>{
  const {c,counts,options}=await setup(t),o=options('operator','signing'),load=o.loadCustody;
  o.loadCustody=async(...args)=>{const handle=await load(...args);c.all.operator.beforeRows.get(c.all.operator.addresses.router).data[106]=1;return handle;};
  const runtime=await prepareTokenConversionRuntime(o);c.origins.operator=await c.bind(runtime.server);
  assert.equal((await c.post('operator','/sign',c.signBody('operator'))).status,409);assert.equal(counts.custody,1);assert.equal(counts.sign,0);
});
