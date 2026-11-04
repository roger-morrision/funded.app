import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {resolve,join,relative} from 'node:path';
import {prepareRelease,loadRelease,literalCompose,composeReleaseArgs,assertImageFrontend,
  assessPublicRelease,applyRelease,verifyRelease} from '../scripts/funded-release.mjs';
import {releaseServices} from '../scripts/verify-deployment-readiness.mjs';

const revisions=['a'.repeat(40),'b'.repeat(40)],images=['sha256:'+'1'.repeat(64),'sha256:'+'2'.repeat(64)];
function fixture(t){
  const parent=resolve('.secrets');fs.mkdirSync(parent,{recursive:true,mode:0o700});
  const root=fs.mkdtempSync(join(parent,'release-test-'));
  t.after(()=>{assert(relative(parent,root).startsWith('release-test-'));fs.rmSync(root,{recursive:true,force:true});});
  const ui=join(root,'source-ui');fs.mkdirSync(ui);
  fs.writeFileSync(join(ui,'build-settings.json'),JSON.stringify({cluster:'devnet',mainnetEnabled:false,sourceDigest:'c'.repeat(64)}));
  fs.writeFileSync(join(ui,'index.html'),'<main>Fixture</main>');
  const secret=join(root,'api-token');fs.writeFileSync(secret,'synthetic secret');
  const config={name:'fixture',services:Object.fromEntries(releaseServices.map(name=>[name,{image:'mutable:old',
    environment:{SOLANA_CLUSTER:'devnet',FUNDED_BUILD_ID:'old',LITERAL:'synthetic$value'},labels:{},build:{context:'obsolete'},
    depends_on:{db:{condition:'service_healthy'}},volumes:name==='app'?[{type:'bind',source:ui,target:'/app/dist',read_only:true},{type:'volume',source:'data',target:'/app/data'}]:[]}])),
    volumes:{data:{name:'existing-data'}},networks:{default:{name:'existing-network'}},secrets:{api:{file:secret}}};
  config.services.db={image:'postgres:17-alpine',environment:{POSTGRES_PASSWORD_FILE:'/run/secrets/api'}};
  const stateDir=join(root,'state');
  const prepare=(n=0,changes={})=>prepareRelease({config,image:images[n],revision:revisions[n],origin:'https://fixture.example',stateDir,...changes});
  return{root,ui,secret,config,stateDir,prepare};
}
function fakeIO(){
  const io={active:null,fail:false,ups:[],waits:0,
    image:async id=>({Id:id,Config:{Labels:{'org.opencontainers.image.revision':revisions[images.indexOf(id)]},Env:['FUNDED_BUILD_ID='+revisions[images.indexOf(id)]]}}),
    preflight:async()=>{},up:async r=>{io.ups.push(composeReleaseArgs(r));io.active=r;},wait:async()=>{io.waits++;},
    containers:async project=>releaseServices.map(service=>({Image:io.active.image,Config:{
      Labels:{'com.docker.compose.project':project,'com.docker.compose.service':service,'org.opencontainers.image.revision':io.active.revision},
      Env:['SOLANA_CLUSTER=devnet','FUNDED_BUILD_ID='+io.active.revision]},State:{Status:'running'}})),
    publicChecks:async()=>({status:{cluster:'devnet',build:io.active.revision},frontend:{cluster:'devnet',mainnetEnabled:false,sourceDigest:io.active.frontendDigest},
      fees:{policy:{tradeBps:100}},launch:{developerTokenLock:{ready:!(io.fail&&io.active.revision===revisions[1]),lockSeconds:43200}}})};
  return io;
}

test('offline preparation freezes frontend and overlays, pins four services, and preserves named data and secret references',t=>{
  const f=fixture(t),overlay=join(f.root,'approved-config.js');fs.writeFileSync(overlay,'export const value = 1;');
  f.config.services.app.volumes.push({type:'bind',source:overlay,target:'/app/config/runtime.js',read_only:true});
  const manifest=f.prepare(),release=loadRelease(f.stateDir,manifest.id),config=JSON.parse(fs.readFileSync(release.composeFile));
  for(const name of releaseServices){assert.equal(config.services[name].image,images[0]);assert.equal(config.services[name].environment.FUNDED_BUILD_ID,revisions[0]);assert.equal(config.services[name].build,undefined);}
  assert.deepEqual(config.volumes.data,{name:'existing-data',external:true});assert.deepEqual(config.networks.default,{name:'existing-network',external:true});
  assert.equal(config.secrets.api.file,f.secret);assert.equal(config.services.app.environment.LITERAL,'synthetic$$value');
  fs.writeFileSync(join(f.ui,'index.html'),'changed original');fs.writeFileSync(overlay,'changed original');
  assert.equal(loadRelease(f.stateDir,manifest.id).composeHash,manifest.composeHash);
  assert.equal(fs.readFileSync(join(config.services.app.volumes[0].source,'index.html'),'utf8'),'<main>Fixture</main>');
  assert(config.services.app.volumes[2].source.startsWith(release.dir));assert.equal(config.services.db.image,'postgres:17-alpine');
});

test('preparation rejects missing workers, mainnet, mutable images, unresolved or writable mounts and unsafe origins',t=>{
  const f=fixture(t);
  for(const change of [c=>delete c.services['agency-buyback-worker'],c=>{c.services.app.environment.SOLANA_CLUSTER='mainnet-beta';},
    c=>{c.services.app.env_file=['.env'];},c=>{c.services.app.volumes[0].read_only=false;},c=>{c.services.app.volumes[0].source='relative';},
    c=>{c.volumes.data={};}]){const config=structuredClone(f.config);change(config);assert.throws(()=>f.prepare(0,{config}));}
  for(const changes of [{image:'funded:latest'},{revision:'main'},{origin:'https://name:secret@fixture.example'},{origin:'http://fixture.example'}])assert.throws(()=>f.prepare(0,changes));
});

test('checks detect modified, added and removed release inputs before any Docker operation',t=>{
  const f=fixture(t);
  for(const tamper of [p=>fs.appendFileSync(p,'changed'),p=>fs.unlinkSync(p),p=>fs.writeFileSync(join(resolve(p,'..'),'extra.js'),'extra')]){
    const r=loadRelease(f.stateDir,f.prepare().id),file=JSON.parse(fs.readFileSync(r.composeFile)).services.app.volumes[0].source;
    tamper(join(file,'index.html'));assert.throws(()=>loadRelease(f.stateDir,r.id));
  }
  const r=loadRelease(f.stateDir,f.prepare().id);fs.appendFileSync(r.composeFile,' ');assert.throws(()=>loadRelease(f.stateDir,r.id),/configuration changed/);
  assert.throws(()=>loadRelease(f.stateDir,'../../outside'),/Invalid release/);
});

test('literal Compose values retain dollar signs rather than resolving a second environment',()=>{
  assert.deepEqual(literalCompose({command:['sh','-c','echo "$VALUE"'],label:'$${literal}'}),{command:['sh','-c','echo "$$VALUE"'],label:'$$$${literal}'});
});

test('deploy and rollback each update all four services and accept only verified identities',async t=>{
  const f=fixture(t),a=f.prepare(),b=f.prepare(1),io=fakeIO();
  assert.equal((await applyRelease({stateDir:f.stateDir,id:a.id},io)).rollbackAvailable,false);
  assert.equal((await applyRelease({stateDir:f.stateDir,id:b.id},io)).rollbackAvailable,true);
  assert.equal((await applyRelease({stateDir:f.stateDir,rollback:true},io)).revision,revisions[0]);
  for(const args of io.ups){assert.deepEqual(args.slice(-4),releaseServices);assert(args.includes('--no-deps'));assert(args.includes('--no-build'));assert.equal(args[args.indexOf('--pull')+1],'never');assert(!args.includes('--volumes'));}
  assert.equal(JSON.parse(fs.readFileSync(join(f.stateDir,'state.json'))).current.id,a.id);
});

test('failed acceptance retains prior release and allows rollback even when the candidate is unhealthy',async t=>{
  const f=fixture(t),a=f.prepare(),b=f.prepare(1),io=fakeIO();
  await applyRelease({stateDir:f.stateDir,id:a.id},io);io.fail=true;
  await assert.rejects(()=>applyRelease({stateDir:f.stateDir,id:b.id},io),/acceptance failed/);
  assert.equal(JSON.parse(fs.readFileSync(join(f.stateDir,'state.json'))).current.id,a.id);
  assert.equal(io.waits,11);assert(fs.existsSync(join(f.stateDir,'pending.json')));
  assert.equal((await applyRelease({stateDir:f.stateDir,rollback:true},io)).revision,revisions[0]);
  assert(!fs.existsSync(join(f.stateDir,'pending.json')));
});

test('an unfinished operation rejects another candidate but can retry the same verified bundle',async t=>{
  const f=fixture(t),a=f.prepare(),b=f.prepare(1),io=fakeIO();
  io.up=async()=>{throw Error('simulated interrupted compose');};
  await assert.rejects(()=>applyRelease({stateDir:f.stateDir,id:a.id},io));
  await assert.rejects(()=>applyRelease({stateDir:f.stateDir,id:b.id},io),/unfinished release/);
  await assert.rejects(()=>applyRelease({stateDir:f.stateDir,rollback:true},io),/No verified prior release/);
  io.up=async r=>{io.active=r;};assert((await applyRelease({stateDir:f.stateDir,id:a.id},io)).ready);
});

test('wrong image revision or unavailable Docker fails before replacement and never starts Docker',async t=>{
  const f=fixture(t),a=f.prepare(),io=fakeIO();
  io.image=async()=>({Id:images[0],Config:{Env:['FUNDED_BUILD_ID='+revisions[1]],Labels:{'org.opencontainers.image.revision':revisions[1]}}});
  await assert.rejects(()=>applyRelease({stateDir:f.stateDir,id:a.id},io),/Image identity/);assert.equal(io.ups.length,0);
  io.image=async()=>{throw Error('Docker unavailable');};await assert.rejects(()=>applyRelease({stateDir:f.stateDir,id:a.id},io),/Docker unavailable/);
  assert.equal(io.ups.length,0);assert(!fs.existsSync(join(f.stateDir,'pending.json')));
});

test('a concurrent release lock prevents all Docker calls',async t=>{
  const f=fixture(t),a=f.prepare(),io=fakeIO();fs.writeFileSync(join(f.stateDir,'release.lock'),'held');
  io.image=async()=>{assert.fail('Docker must not be called');};
  await assert.rejects(()=>applyRelease({stateDir:f.stateDir,id:a.id},io),{code:'EEXIST'});
  assert.equal(fs.readFileSync(join(f.stateDir,'release.lock'),'utf8'),'held');
});

test('public verification rejects wrong fee, escrow duration, frontend or API build',async t=>{
  const f=fixture(t),release=loadRelease(f.stateDir,f.prepare().id),io=fakeIO();io.active=release;
  assert((await verifyRelease(release,io)).ready);
  for(const edit of [x=>{x.fees.policy.tradeBps=0;},x=>{x.launch.developerTokenLock.lockSeconds=1;},x=>{x.frontend.sourceDigest='wrong';},x=>{x.status.build='wrong';},x=>{x.frontend.mainnetEnabled=true;}]){
    const checks=await io.publicChecks();edit(checks);assert.equal(Boolean(assessPublicRelease(release,checks)),false);
  }
  const original=io.containers;io.containers=async project=>(await original(project)).map(c=>({...c,Image:images[1]}));
  assert.equal((await verifyRelease(release,io)).ready,false);
});

test('rollback rejects altered accepted metadata instead of trusting new manifest checksums',async t=>{
  const f=fixture(t),a=f.prepare(),b=f.prepare(1),io=fakeIO();await applyRelease({stateDir:f.stateDir,id:a.id},io);await applyRelease({stateDir:f.stateDir,id:b.id},io);
  const file=join(f.stateDir,'releases',a.id,'manifest.json'),manifest=JSON.parse(fs.readFileSync(file));manifest.origin='https://changed.example';fs.writeFileSync(file,JSON.stringify(manifest));
  await assert.rejects(()=>applyRelease({stateDir:f.stateDir,rollback:true},io),/Rollback manifest changed/);
  assert.equal(io.ups.length,2);
});

test('rollback remains available when an accepted current release later becomes unhealthy',async t=>{
  const f=fixture(t),a=f.prepare(),b=f.prepare(1),io=fakeIO();
  await applyRelease({stateDir:f.stateDir,id:a.id},io);await applyRelease({stateDir:f.stateDir,id:b.id},io);io.fail=true;
  await assert.rejects(()=>applyRelease({stateDir:f.stateDir,id:f.prepare(1).id},io),/Current release is not verified/);
  assert.equal((await applyRelease({stateDir:f.stateDir,rollback:true},io)).revision,revisions[0]);
});

test('image/frontend mismatch and failed infrastructure/capacity checks prevent replacement',async t=>{
  const f=fixture(t),a=f.prepare(),release=loadRelease(f.stateDir,a.id),io=fakeIO();
  assert.doesNotThrow(()=>assertImageFrontend({cluster:'devnet',mainnetEnabled:false,sourceDigest:release.frontendDigest},release));
  assert.throws(()=>assertImageFrontend({cluster:'devnet',mainnetEnabled:false,sourceDigest:'d'.repeat(64)},release),/image frontend differs/);
  io.preflight=async()=>{throw Error('Capacity unavailable');};
  await assert.rejects(()=>applyRelease({stateDir:f.stateDir,id:a.id},io),/Capacity unavailable/);
  assert.equal(io.ups.length,0);assert(!fs.existsSync(join(f.stateDir,'pending.json')));assert(!fs.existsSync(join(f.stateDir,'release.lock')));
});
