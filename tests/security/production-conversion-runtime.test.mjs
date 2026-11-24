import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,symlink} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {Keypair} from '@solana/web3.js';
import nacl from 'tweetnacl';
import {conversionServiceFixture} from '../readiness/token-conversion-service-fixture.mjs';
import {selectMainnetTokenConversionRecovery} from '../../server/api-financial-workers.mjs';
import {prepareProductionConversionService,productionConversionDigest,readProductionReference} from '../../server/production-conversion-runtime.mjs';

async function fixture(t,options={}){
  const runtimes=[];t.after(async()=>{for(const runtime of runtimes)await runtime.close();});
  const c=await conversionServiceFixture(t,options),roles=['controller','operator','price-attestation'];
  const counts={references:0,custody:0,signatures:0},configs={};
  for(const role of roles){
    const key=role==='controller'?'worker':role,f=c.all[key],spec={schemaVersion:1,cluster:'mainnet-beta',role,mode:'signing',
      programId:f.config.programId,programDataSha256:f.config.programDataSha256,policyHash:tokenPricePolicyHash(f.config),
      journalReferences:Object.fromEntries(roles.map(r=>[r,'journal-'+r])),
      rpcReferences:Object.fromEntries(roles.map(r=>[r,'rpc-'+r])),
      authenticationReferences:Object.fromEntries(roles.map(r=>[r,'auth-'+r])),custodyReference:'custody-'+role,
      origins:{operator:'https://operator.invalid/', 'price-attestation':'https://price.invalid/'}};
    const rpc=join(c.dir,'rpc-'+role),authenticationFiles={};await writeFile(rpc,'https://rpc.invalid/'+role);
    for(const r of role==='controller'?roles:[role]){
      const file=join(c.dir,'auth-'+r);await writeFile(file,c.tokens[r==='controller'?'worker':r]);authenticationFiles['auth-'+r]=file;
    }
    const bindings={schemaVersion:1,rpcFiles:{['rpc-'+role]:rpc},
      journalFiles:Object.fromEntries(roles.map(r=>['journal-'+r,c.paths[r==='controller'?'worker':r]])),authenticationFiles,
      ...(role!=='controller'?{custodyFile:join(c.dir,'never-loaded-'+role+'.json')}:{})};
    const deployment={schemaVersion:1,spec,policy:f.config,release:f.release,
      listen:{host:'127.0.0.1',port:Number(new URL(c.origins[key]).port)},
      activation:{status:'approved',reference:'Synthetic test approval only',sourceRevision:f.release.sourceRevision}};
    deployment.activation.digest=productionConversionDigest({...deployment,bindings});
    configs[role]={deployment,bindings,sourceRevision:f.release.sourceRevision,
      connectionFactory:()=>f.connection,now:()=>f.now,
      readReference:async file=>{counts.references++;return readProductionReference(file);},
      loadCustody:async()=>{counts.custody++;const secret=Keypair.fromSeed(new Uint8Array(32).fill(role==='operator'?33:34));
        return {publicKey:secret.publicKey,signMessage:args=>{counts.signatures++;return nacl.sign.detached(args.message,secret.secretKey);}};},
      request:(url,args)=>fetch(c.origins[new URL(url).hostname==='operator.invalid'?'operator':'price-attestation']+new URL(url).pathname,args)};
  }
  const install=async role=>{
    const key=role==='controller'?'worker':role,old=role==='controller'?c.controller:c.backends[role];
    old.server.closeAllConnections();if(old.server.listening)await new Promise(r=>old.server.close(r));
    const runtime=await prepareProductionConversionService(configs[role]);runtimes.push(runtime);
    await runtime.start();if(role==='controller')c.controller=runtime;else c.backends[role]=runtime;return runtime;
  };
  return {c,configs,counts,install};
}
import {tokenPricePolicyHash} from '../../server/token-conversion-sell-review.mjs';

test('authenticated admission probes recheck every role without custody and reject changed chain context',async t=>{
  const {c,configs,counts,install}=await fixture(t);
  for(const role of ['operator','price-attestation','controller']){
    const runtime=await install(role),key=role==='controller'?'worker':role;
    const endpoint=c.origins[key]+'/admission',headers={authorization:'Bearer '+c.tokens[key]};
    assert.equal((await fetch(endpoint)).status,401);
    const good=await fetch(endpoint,{headers});assert.equal(good.status,200);
    assert.equal(good.headers.get('cache-control'),'no-store');
    const body=await good.json();assert.equal(body.status,'admitted');assert.equal(body.role,role);
    assert.equal(body.mode,'signing');assert.equal(body.sourceRevision,configs[role].sourceRevision);
    assert.equal(body.freshSigningEligible,true);
    const connection=configs[role].connectionFactory(),prior=connection.getGenesisHash;
    connection.getGenesisHash=async()=> 'wrong-chain';
    assert.equal((await fetch(endpoint,{headers})).status,503);
    await assert.rejects(runtime.inspectAdmission());connection.getGenesisHash=prior;
    assert.equal((await fetch(endpoint,{headers})).status,200);
  }
  assert.equal(counts.custody,0);assert.equal(counts.signatures,0);assert.equal(c.calls.send,0);
});

test('production launcher integrates three actual HTTP roles with lazy custody and exact-once settlement',async t=>{
  const {c,counts,install}=await fixture(t);
  for(const role of ['operator','price-attestation','controller'])await install(role);
  assert.equal(counts.custody,0);assert.equal(counts.signatures,0);
  const result=await c.run({request:c.all.worker.request});
  assert.equal(result.status,200);assert.equal(result.body.status,'settled');
  assert.equal(result.body.signerReconciliation,'settled');assert.equal(c.calls.send,1);
  assert.equal(counts.custody,2);assert.equal(counts.signatures,2);
  assert.equal((await c.run({request:c.all.worker.request})).body.status,'settled');
  assert.equal(c.calls.send,1);assert.equal(counts.signatures,2);
});

test('production launcher recovers unknown sends after restart without new custody or broadcast',async t=>{
  const {c,configs,counts,install}=await fixture(t,{send:'unknown'});
  for(const role of ['operator','price-attestation','controller'])await install(role);
  assert.equal((await c.run({request:c.all.worker.request})).body.status,'reconciliation-pending');
  c.land();const before={...counts};
  configs.controller.deployment.spec.mode='recovery-only';configs.controller.deployment.activation={status:'disabled'};
  const recovered=await install('controller');
  assert.equal(typeof selectMainnetTokenConversionRecovery({solanaCluster:'mainnet-beta',preparedTokenConversionRuntime:recovered}).tick,'function');
  assert.equal((await c.run({messageHash:c.hash})).body.status,'settled');
  assert.equal(c.calls.send,1);assert.equal(counts.custody,before.custody);assert.equal(counts.signatures,before.signatures);
});

test('production launcher rejects unreviewed release, drift and signing approval before secret access',async t=>{
  const {configs,counts}=await fixture(t),original=configs.operator;
  for(const mutate of [o=>{o.deployment.release.status='awaiting-review';},o=>{o.sourceRevision='f'.repeat(40);},
    o=>{o.deployment.activation.status='disabled';},o=>{o.deployment.listen.host='0.0.0.0';},
    o=>{o.bindings.custodyFile=join(dirname(o.bindings.custodyFile),'other-key.json');},
    o=>{o.bindings.journalFiles['journal-controller']=o.bindings.journalFiles['journal-operator'];}]){
    const o={...original,deployment:structuredClone(original.deployment),bindings:structuredClone(original.bindings)};mutate(o);
    await assert.rejects(prepareProductionConversionService(o));
  }
  assert.equal(counts.references,0);assert.equal(counts.custody,0);
});

test('production launcher rejects reused authentication and drains close during admission',async t=>{
  const {configs,c}=await fixture(t),o=configs.controller;
  const operator=o.bindings.authenticationFiles['auth-operator'];
  await writeFile(operator,c.tokens.worker);
  await assert.rejects(prepareProductionConversionService(o),/authentication reference unavailable/);
  await writeFile(operator,c.tokens.operator);
  const runtime=await prepareProductionConversionService(o),connection=o.connectionFactory();
  const prior=connection.getGenesisHash;let resume;
  connection.getGenesisHash=()=>new Promise(resolve=>{resume=resolve;});
  const starting=runtime.start(),closing=runtime.close();
  resume(await prior());
  await assert.rejects(starting,/not admitted/);await closing;
  assert.equal(runtime.server.listening,false);assert.throws(()=>runtime.start(),/reopened/);
});

test('production launcher refuses missing journals and cannot reopen after close',async t=>{
  const {configs,counts,c}=await fixture(t),o=configs.controller;
  o.deployment.spec.mode='recovery-only';o.deployment.activation={status:'disabled'};
  const prior=o.bindings.journalFiles['journal-controller'];o.bindings.journalFiles['journal-controller']=join(c.dir,'absent.json');
  await assert.rejects(prepareProductionConversionService(o),/existing production journals/);assert.equal(counts.references,0);
  o.bindings.journalFiles['journal-controller']=prior;
  const runtime=await prepareProductionConversionService(o);await runtime.close();
  assert.throws(()=>runtime.start(),/reopened/);assert.equal(runtime.server.listening,false);
});

test('production references reject multiline, oversized and symbolic-link credentials',async t=>{
  const {c}=await fixture(t),file=join(c.dir,'bad-reference');
  for(const content of ['first\nsecond','x'.repeat(4097),'']){await writeFile(file,content);await assert.rejects(readProductionReference(file));}
  await writeFile(file,'a'.repeat(64));assert.equal(await readProductionReference(file),'a'.repeat(64));
  if(process.platform!=='win32'){const alias=join(c.dir,'alias-reference');await symlink(file,alias);await assert.rejects(readProductionReference(alias));}
});
