import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,copyFile,open,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {SOLANA_GENESIS} from '../../solana-network.js';
import {tokenPricePolicyHash} from '../../server/token-conversion-sell-review.mjs';
import {conversionServiceFixture} from './token-conversion-service-fixture.mjs';

const roles=['controller','operator','price-attestation'];
const file=role=>role==='controller'?'worker':role;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const child=fileURLToPath(new URL('./token-conversion-restore-child.mjs',import.meta.url));
const bucket='tokenConversionPriceJournalV1';

async function closedFixture(t,mode){
  const c=await conversionServiceFixture(t,{send:mode==='unknown'?'unknown':'land'});
  if(mode!=='empty'){
    const result=await c.run({request:c.all.worker.request});
    assert.equal(result.status,200);
    assert.equal(result.body.status,mode==='unknown'?'reconciliation-pending':'settled');
  }
  for(const server of [c.controller.server,c.backends.operator.server,c.backends['price-attestation'].server]){
    server.closeAllConnections();if(server.listening)await new Promise(done=>server.close(done));
  }
  assert.equal(c.calls['price-attestation'],mode==='empty'?0:1);
  assert.equal(c.calls.operator,mode==='empty'?0:1);
  assert.equal(c.calls.send,mode==='empty'?0:1);
  return c;
}

async function snapshot(c,base,name){
  const dir=join(base,name);await mkdir(dir,{recursive:true});
  const journalSha256={};
  for(const role of roles){
    const bytes=await readFile(c.paths[file(role)]),target=join(dir,role+'.json');
    await writeFile(target,bytes);const descriptor=await open(target,'r+');
    try{await descriptor.sync();}finally{await descriptor.close();}
    assert.deepEqual(await readFile(target),bytes);journalSha256[role]=digest(bytes);
  }
  const state=JSON.parse(await readFile(c.paths.worker,'utf8'));
  const f=c.all.worker;
  const manifest={schemaVersion:1,kind:'closed synthetic role-journal copy',name,
    reviewedContext:{programId:f.config.programId,programDataSha256:f.config.programDataSha256,
      policyHash:tokenPricePolicyHash(f.config),genesisHash:SOLANA_GENESIS['mainnet-beta']},
    journalSha256,controllerAttemptsSha256:digest(JSON.stringify(state[bucket].attempts)),
    originalMessageHashes:Object.keys(state[bucket].attempts).sort(),
    statuses:Object.fromEntries(Object.entries(state[bucket].attempts).map(([hash,row])=>[hash,row.status]))};
  const manifestPath=join(dir,'manifest.json');await writeFile(manifestPath,JSON.stringify(manifest));
  const descriptor=await open(manifestPath,'r+');try{await descriptor.sync();}finally{await descriptor.close();}
  return {dir,manifest,manifestPath};
}

async function restore(base,name,bundle,expected=bundle){
  const dir=join(base,'restore-'+name);await mkdir(dir,{recursive:true});
  for(const role of roles){
    const target=join(dir,role+'.json');await copyFile(join(bundle.dir,role+'.json'),target);
    const descriptor=await open(target,'r+');try{await descriptor.sync();}finally{await descriptor.close();}
  }
  const inputPath=join(base,'input-'+name+'.json');
  await writeFile(inputPath,JSON.stringify({restoreDir:dir,manifestPath:expected.manifestPath}));
  return {dir,inputPath};
}

function freshProcess(inputPath){
  const run=spawnSync(process.execPath,[child,inputPath],{cwd:process.cwd(),env:process.env,encoding:'utf8',timeout:30000});
  assert.equal(run.status,0,run.stderr||run.stdout);
  assert.equal(run.stderr,'');
  return JSON.parse(run.stdout.trim());
}

test('closed three-journal unknown and verified copies survive fresh-process recovery without new signing',async t=>{
  const base=await realpath(tmpdir()),dir=await mkdtemp(join(base,'funded-conversion-restore-'));
  t.after(async()=>{const target=await realpath(dir);assert.equal(target,resolve(dir));assert(target.startsWith(base+sep));await rm(target,{recursive:true,force:true});});
  for(const mode of ['unknown','verified']){
    const c=await closedFixture(t,mode),bundle=await snapshot(c,dir,mode);
    const restored=await restore(dir,mode,bundle),result=freshProcess(restored.inputPath);
    assert.equal(result.accepted,true);assert.equal(result.hashesMatch,true);
    assert.equal(result.attemptsMatch,true);assert.equal(result.verifiedProofs,mode==='verified'?1:0);
    assert.deepEqual(result.events,{authentication:3,custody:0,request:0,send:0});
    assert.equal(result.page.attempts,mode==='unknown'?1:0);
    assert.deepEqual(Object.keys(bundle.manifest.statuses),[c.hash]);
    t.diagnostic(JSON.stringify({mode,accepted:result.accepted,hashesMatch:result.hashesMatch,
      attemptsMatch:result.attemptsMatch,verifiedProofs:result.verifiedProofs,events:result.events}));
  }
});

test('partial corrupt and wrong-context copies fail before authentication; coherent older copy needs an external witness',async t=>{
  const base=await realpath(tmpdir()),dir=await mkdtemp(join(base,'funded-conversion-restore-'));
  t.after(async()=>{const target=await realpath(dir);assert.equal(target,resolve(dir));assert(target.startsWith(base+sep));await rm(target,{recursive:true,force:true});});
  const empty=await snapshot(await closedFixture(t,'empty'),dir,'empty');
  const unknown=await snapshot(await closedFixture(t,'unknown'),dir,'unknown');
  for(const role of roles){
    const restored=await restore(dir,'partial-'+role,unknown);
    await copyFile(join(empty.dir,role+'.json'),join(restored.dir,role+'.json'));
    const result=freshProcess(restored.inputPath);
    assert.equal(result.hashesMatch,false);assert.equal(result.accepted,false);
    assert.deepEqual(result.events,{authentication:0,custody:0,request:0,send:0});
    t.diagnostic(JSON.stringify({mode:'partial-'+role,accepted:result.accepted,events:result.events}));
  }
  const corrupt=await restore(dir,'corrupt',unknown);
  await writeFile(join(corrupt.dir,'operator.json'),'{');
  const corruptResult=freshProcess(corrupt.inputPath);
  assert.equal(corruptResult.accepted,false);assert.equal(corruptResult.events.authentication,0);
  t.diagnostic(JSON.stringify({mode:'corrupt',accepted:corruptResult.accepted,events:corruptResult.events}));
  const wrong=await restore(dir,'wrong-context',unknown),controllerPath=join(wrong.dir,'controller.json');
  const state=JSON.parse(await readFile(controllerPath,'utf8'));
  state[bucket].context.programId='wrong';await writeFile(controllerPath,JSON.stringify(state));
  const wrongResult=freshProcess(wrong.inputPath);
  assert.equal(wrongResult.accepted,false);assert.equal(wrongResult.events.authentication,0);
  t.diagnostic(JSON.stringify({mode:'wrong-context',accepted:wrongResult.accepted,events:wrongResult.events}));
  // All three old files are mutually compatible, so bootstrap alone accepts
  // them. The separately retained later witness detects the missing attempt.
  const old=await restore(dir,'coherent-old',empty,unknown),oldResult=freshProcess(old.inputPath);
  assert.equal(oldResult.accepted,true);assert.equal(oldResult.hashesMatch,false);
  assert.equal(oldResult.attemptsMatch,false);assert.equal(oldResult.page.attempts,0);
  assert.deepEqual(oldResult.events,{authentication:3,custody:0,request:0,send:0});
  t.diagnostic(JSON.stringify({mode:'coherent-old',sourceAccepted:oldResult.accepted,
    retainedWitnessMatch:oldResult.hashesMatch,attemptsMatch:oldResult.attemptsMatch,
    operationallyQualified:false,events:oldResult.events}));
});
