import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createTokenConversionSigningService} from '../../server/token-conversion-signing-service.mjs';
import {selectSavedConversionPage} from '../../server/token-conversion-controller.mjs';
import {createTokenConversionRemoteSigner} from '../../server/token-conversion-remote-signers.mjs';
import {conversionSignature} from '../../server/token-conversion-http.mjs';
import {conversionServiceFixture,conversionBucket} from './token-conversion-service-fixture.mjs';

for(const category of [5,6,7])test('HTTP conversion independently reviews signs and reconciles category '+category+' across three journals',async t=>{
  const c=await conversionServiceFixture(t,{category}),result=await c.run({request:c.all.worker.request});
  assert.equal(result.status,200);assert.equal(result.body.status,'settled');assert.equal(result.body.signerReconciliation,'settled');
  assert.equal(result.body.proof.spentQuoteRaw,'1000000');assert.equal(result.body.proof.receivedLamports,'14211301');
  for(const role of ['worker','price-attestation','operator'])assert.equal((await c.row(role)).status,'settled');
  assert(c.all['price-attestation'].simulationCalls>0&&c.all.operator.simulationCalls>0);assert.deepEqual(c.calls,{'price-attestation':1,operator:1,send:1});
});

test('HTTP controller missing recovery attempt cannot contact signers',async t=>{
  const c=await conversionServiceFixture(t),result=await c.run({messageHash:c.hash,recoveryOnly:true});assert.equal(result.body.status,'unavailable');
  assert.equal(c.requests.length,0);assert.deepEqual(c.calls,{'price-attestation':0,operator:0,send:0});
});

test('Private controller pages only saved attempts after restart without signing or broadcast',async t=>{
  const c=await conversionServiceFixture(t,{send:'unknown'});
  assert.deepEqual(await c.controller.recoverSaved(),{attempts:[],nextAfter:null,remaining:0});
  assert.equal((await c.run({request:c.all.worker.request})).body.status,'reconciliation-pending');
  assert.deepEqual(c.calls,{'price-attestation':1,operator:1,send:1});
  await c.restartController();
  const page=await c.controller.recoverSaved({limit:1});
  assert.deepEqual(page,{attempts:[{messageHash:c.hash,status:'reconciliation-pending'}],nextAfter:c.hash,remaining:1});
  const again=await c.controller.recoverSaved({after:c.hash,limit:1});
  assert.deepEqual(again,page);
  assert.deepEqual(c.calls,{'price-attestation':1,operator:1,send:1});
  for(const invalid of [{limit:0},{limit:33},{after:'not-a-hash'}])await assert.rejects(()=>c.controller.recoverSaved(invalid));
});

test('Private recovery cursor visits 65 saved attempts without repeating within a page',()=>{
  const hashes=Array.from({length:65},(_,i)=>i.toString(16).padStart(64,'0'));
  const attempts=Object.fromEntries(hashes.map(hash=>[hash,{status:'submitted'}]));
  const first=selectSavedConversionPage({attempts});
  const second=selectSavedConversionPage({attempts,after:first.nextAfter});
  const third=selectSavedConversionPage({attempts,after:second.nextAfter});
  assert.deepEqual([first.hashes.length,second.hashes.length,third.hashes.length],[32,32,1]);
  assert.deepEqual([...first.hashes,...second.hashes,...third.hashes],hashes);
  assert.deepEqual(selectSavedConversionPage({attempts,after:third.nextAfter}).hashes,hashes.slice(0,32));
  attempts[hashes[0]].status='settled';
  assert.deepEqual(selectSavedConversionPage({attempts}).hashes,hashes.slice(1,33));
});

test('HTTP authentication rejects controller and both custody requests before review',async t=>{
  const c=await conversionServiceFixture(t);
  for(const role of ['worker','price-attestation','operator']){
    const result=await c.post(role,role==='worker'?'/run':'/sign',role==='worker'?{schemaVersion:1,request:c.all.worker.request}:c.signBody(role),{token:'d'.repeat(64)});
    assert.equal(result.status,401);assert.equal(c.all[role].simulationCalls,0);assert.equal(await c.row(role),undefined);
  }
});

test('HTTP schema and changed message hash refuse without a reservation',async t=>{
  const c=await conversionServiceFixture(t);
  for(const body of [{...c.signBody('price-attestation'),schemaVersion:2},{...c.signBody('price-attestation'),messageHash:'0'.repeat(64)},
    {...c.signBody('price-attestation'),endpoint:'https://untrusted.invalid/'},[],null]){
    const result=await c.post('price-attestation','/sign',body);assert.equal(result.status,409);assert.equal(await c.row('price-attestation'),undefined);
  }
  const malformed=await c.post('operator','/sign',null,{raw:'{broken'});assert.equal(malformed.status,409);
  for(const messageHash of [[c.hash],c.hash+'\n',null]){
    assert.equal((await c.run({messageHash,recoveryOnly:true})).status,409);
    assert.equal((await c.post('price-attestation','/reconcile',{schemaVersion:1,messageHash})).status,409);
  }
  assert.equal(conversionSignature('1'.repeat(64)),'1'.repeat(64)); // Canonical encoding, not payment proof.
  for(const value of ['1'.repeat(63),'1'.repeat(65),['1'.repeat(64)],'0'.repeat(88)])assert.throws(()=>conversionSignature(value));
  assert.deepEqual(c.calls,{'price-attestation':0,operator:0,send:0});
});

for(const role of ['price-attestation','operator'])test('HTTP '+role+' own wrong-genesis reader refuses a worker-approved request',async t=>{
  const c=await conversionServiceFixture(t);c.all[role].connection.getGenesisHash=async()=> 'wrong-network';
  const result=await c.run({request:c.all.worker.request});assert.equal(result.status,200);assert.equal(result.body.status,'reconciliation-pending');
  assert.equal(c.calls[role],0);assert.equal(c.calls.send,0);assert.equal((await c.row()).status,'reserved');
});

test('HTTP cached role signature survives backend restart with actual fresh review and no new custody call',async t=>{
  const c=await conversionServiceFixture(t),first=await c.post('price-attestation','/sign',c.signBody('price-attestation'));assert.equal(first.status,200);
  const raw=await readFile(c.paths['price-attestation'],'utf8');assert.equal((await c.row('price-attestation')).roleSignatures['price-attestation'],first.body.signature);
  await c.restartBackend('price-attestation');const repeated=await c.post('price-attestation','/sign',c.signBody('price-attestation'));
  assert.equal(repeated.status,200);assert.equal(repeated.body.signature,first.body.signature);assert.equal(c.calls['price-attestation'],1);
  assert.equal(await readFile(c.paths['price-attestation'],'utf8'),raw);
  c.all['price-attestation'].connection.getGenesisHash=async()=> 'wrong-network';
  assert.equal((await c.post('price-attestation','/sign',c.signBody('price-attestation'))).status,409);assert.equal(c.calls['price-attestation'],1);
});

test('HTTP unknown custody result cannot sign again after backend restart',async t=>{
  const c=await conversionServiceFixture(t,{signTimeoutMs:10});c.hooks['price-attestation']=()=>new Promise(()=>{});
  assert.equal((await c.post('price-attestation','/sign',c.signBody('price-attestation'))).status,409);
  await c.restartBackend('price-attestation');assert.equal((await c.post('price-attestation','/sign',c.signBody('price-attestation'))).status,503);
  assert.equal(c.calls['price-attestation'],1);assert((await c.row('price-attestation')).signingStartedAt);
});

test('HTTP role signature disk failure cannot expose a usable response or invoke the operator',async t=>{
  const c=await conversionServiceFixture(t),base=c.stores()['price-attestation'];
  await c.restartBackend('price-attestation',{store:{read:()=>base.read(),transaction:mutate=>base.transaction(s=>{
    const result=mutate(s);if(Object.values(s[conversionBucket].attempts).some(a=>a.roleSignatures))throw Error('Injected role-cache write failure');return result;
  })}});
  const result=await c.run({request:c.all.worker.request});assert.equal(result.body.status,'reconciliation-pending');
  assert.equal(c.calls.operator,0);assert.equal(c.calls.send,0);assert.equal((await c.row('price-attestation')).roleSignatures,undefined);
});

test('HTTP postpublication role signature failure is cache-recoverable without another custody signature',async t=>{
  const c=await conversionServiceFixture(t),base=c.stores()['price-attestation'];let fail=true;
  await c.restartBackend('price-attestation',{store:{read:()=>base.read(),transaction:async mutate=>{
    const result=await base.transaction(mutate);if(fail&&Object.values((await base.read())[conversionBucket].attempts).some(a=>a.roleSignatures)){fail=false;throw Error('Published unacknowledged');}return result;
  }}});
  assert.equal((await c.post('price-attestation','/sign',c.signBody('price-attestation'))).status,409);
  const cached=(await c.row('price-attestation')).roleSignatures['price-attestation'];await c.restartBackend('price-attestation');
  const recovered=await c.post('price-attestation','/sign',c.signBody('price-attestation'));assert.equal(recovered.status,200);assert.equal(recovered.body.signature,cached);assert.equal(c.calls['price-attestation'],1);
});

test('HTTP two backend instances share durable one-time custody admission',async t=>{
  const c=await conversionServiceFixture(t),first=c.origins['price-attestation'];await c.makeBackend('price-attestation');const second=c.origins['price-attestation'];
  const request=origin=>fetch(origin+'/sign',{method:'POST',headers:{authorization:'Bearer '+c.tokens['price-attestation'],'content-type':'application/json'},body:JSON.stringify(c.signBody('price-attestation'))});
  const results=await Promise.all([request(first),request(second)]);assert(results.some(r=>r.status===200));assert(results.every(r=>[200,503].includes(r.status)));
  assert.equal(c.calls['price-attestation'],1);
});

test('HTTP controller unknown send restarts read-only then attributes the exact original transaction',async t=>{
  const c=await conversionServiceFixture(t,{send:'unknown'});assert.equal((await c.run({request:c.all.worker.request})).body.status,'reconciliation-pending');
  await c.restartController();const before=c.requests.length;assert.equal((await c.run({request:c.all.worker.request})).body.status,'reconciliation-pending');assert.equal(c.requests.length,before);
  c.land();const recovered=await c.run({messageHash:c.hash,recoveryOnly:true});assert.equal(recovered.body.status,'settled');assert.equal(recovered.body.signerReconciliation,'settled');
  assert.deepEqual(c.calls,{'price-attestation':1,operator:1,send:1});
});

test('HTTP unavailable backend reconciliation cannot erase durable worker proof',async t=>{
  const c=await conversionServiceFixture(t);c.responses['price-attestation']=(path,r)=>path==='/reconcile'?new Response('{}',{status:503}):r;
  const first=await c.run({request:c.all.worker.request});assert.equal(first.body.status,'settled');assert.equal(first.body.signerReconciliation,'pending');
  const proof=(await c.row()).proof;delete c.responses['price-attestation'];const again=await c.run({messageHash:c.hash,recoveryOnly:true});
  assert.equal(again.body.signerReconciliation,'settled');assert.deepEqual((await c.row()).proof,proof);assert.deepEqual(c.calls,{'price-attestation':1,operator:1,send:1});
});

test('HTTP forged custody signature or identity cannot reach broadcast',async t=>{
  for(const field of ['signature','publicKey']){
    const c=await conversionServiceFixture(t);c.responses['price-attestation']=async(path,r)=>{
      if(path!=='/sign')return r;const v=await r.json();v[field]=field==='signature'?Buffer.alloc(64).toString('base64'):String(c.all.worker.expected.authority);
      return new Response(JSON.stringify(v),{headers:{'content-type':'application/json'}});
    };
    assert.equal((await c.run({request:c.all.worker.request})).status,409);assert.equal(c.calls.operator,0);assert.equal(c.calls.send,0);
  }
});

test('HTTP corrupted cached role signature prevents backend restart without rewriting it',async t=>{
  const c=await conversionServiceFixture(t);await c.post('price-attestation','/sign',c.signBody('price-attestation'));
  const state=JSON.parse(await readFile(c.paths['price-attestation'],'utf8'));state[conversionBucket].attempts[c.hash].roleSignatures['price-attestation']=Buffer.alloc(64).toString('base64');
  await writeFile(c.paths['price-attestation'],JSON.stringify(state));const before=await readFile(c.paths['price-attestation'],'utf8');
  await assert.rejects(c.restartBackend('price-attestation'),/Role signature differs/);assert.equal(await readFile(c.paths['price-attestation'],'utf8'),before);assert.equal(c.calls['price-attestation'],1);
});

test('HTTP service refuses missing production admission or wrong custody identity before review',async t=>{
  const c=await conversionServiceFixture(t),f=c.all.operator,options={store:c.stores().operator,connection:f.connection,config:f.config,release:f.release,
    role:'operator',token:c.tokens.operator,signer:{publicKey:f.expected.authority,signMessage:()=>{throw Error('Must not sign');}}};
  assert.throws(()=>createTokenConversionSigningService({...options,release:null}),/production/);
  assert.throws(()=>createTokenConversionSigningService({...options,signer:{...options.signer,publicKey:f.expected.priceSigner}}),/Exact role/);
  assert.equal(c.calls.operator,0);
});

test('HTTP remote custody origin rejects public HTTP and credential-bearing endpoints',()=>{
  const args={token:'a'.repeat(64),publicKey:'11111111111111111111111111111111',programId:'11111111111111111111111111111111',role:'operator'};
  for(const endpoint of ['http://public.example/','http://127.0.0.1/','https://user:secret@example.com/','https://example.com/?token=bad','https://example.com/path'])
    assert.throws(()=>createTokenConversionRemoteSigner({...args,endpoint}));
});

test('HTTP native redirect refusal does not forward custody authentication',async t=>{
  const c=await conversionServiceFixture(t);let destinationCalls=0;
  const destination=createServer((req,res)=>{destinationCalls++;res.end('{}');});await new Promise(r=>destination.listen(0,'127.0.0.1',r));
  const redirect=createServer((req,res)=>{res.writeHead(302,{location:'http://127.0.0.1:'+destination.address().port+'/sign'});res.end();});await new Promise(r=>redirect.listen(0,'127.0.0.1',r));
  t.after(async()=>{for(const s of [redirect,destination]){s.closeAllConnections();await new Promise(r=>s.close(r));}});
  const f=c.all.worker,adapter=createTokenConversionRemoteSigner({endpoint:'https://review-custody.invalid/',token:c.tokens['price-attestation'],
    publicKey:f.expected.priceSigner,programId:f.config.programId,role:'price-attestation',request:(_url,options)=>fetch('http://127.0.0.1:'+redirect.address().port+'/sign',options)});
  await assert.rejects(adapter.signMessage({message:f.unsigned.message.serialize(),version:0,messageHash:c.hash,transactionBase64:f.request.transaction,role:'price-attestation'}),
    error=>error.message==='Conversion custody service result is unconfirmed.');
  assert.equal(destinationCalls,0);assert.equal(c.calls['price-attestation'],0);
});

test('HTTP oversized request and response remain fail-closed without custody or broadcast',async t=>{
  const c=await conversionServiceFixture(t);let rejected=false;
  try{const result=await c.post('price-attestation','/sign',null,{raw:JSON.stringify({schemaVersion:1,padding:'x'.repeat(5000)})});rejected=result.status!==200;}
  catch{rejected=true;}assert(rejected);assert.equal(c.calls['price-attestation'],0);assert.equal(await c.row('price-attestation'),undefined);
  c.responses['price-attestation']=()=>new Response(JSON.stringify({signature:'x'.repeat(5000)}),{headers:{'content-type':'application/json'}});
  assert.equal((await c.run({request:c.all.worker.request})).body.status,'reconciliation-pending');assert.equal(c.calls.operator,0);assert.equal(c.calls.send,0);
});

test('HTTP custody completion after review expiry persists but does not expose its signature',async t=>{
  const c=await conversionServiceFixture(t),role='price-attestation';
  const {Keypair}=await import('@solana/web3.js'),{default:nacl}=await import('tweetnacl');
  const key=Keypair.fromSeed(new Uint8Array(32).fill(34));
  c.hooks[role]=args=>{const sig=nacl.sign.detached(args.message,key.secretKey);c.all[role].advance(35000,90);return sig;};
  const result=await c.post(role,'/sign',c.signBody(role));assert.equal(result.status,409);assert.equal(result.body.signature,undefined);
  assert((await c.row(role)).roleSignatures[role]);assert.equal(c.calls[role],1);
});

test('HTTP accidentally shared role journal cannot admit both custody signatures',async t=>{
  const c=await conversionServiceFixture(t);await c.restartBackend('operator',{store:c.stores()['price-attestation']});
  const result=await c.run({request:c.all.worker.request});assert.equal(result.body.status,'reconciliation-pending');
  assert.equal(c.calls['price-attestation'],1);assert.equal(c.calls.operator,0);assert.equal(c.calls.send,0);
});
