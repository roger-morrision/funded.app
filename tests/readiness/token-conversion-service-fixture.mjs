import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {Keypair} from '@solana/web3.js';
import nacl from 'tweetnacl';
import {createHash} from 'node:crypto';
import {createAutomaticRewardStore} from '../../server/automatic-reward-store.mjs';
import {createTokenConversionSigningService} from '../../server/token-conversion-signing-service.mjs';
import {createTokenConversionController} from '../../server/token-conversion-controller.mjs';
import {createTokenConversionJournal} from '../../server/token-conversion-journal.mjs';
import {sellReviewFixture} from './token-sell-review-fixture.mjs';

export const conversionBucket='tokenConversionPriceJournalV1';
export async function conversionServiceFixture(t,{category=5,send='land',signTimeoutMs=30000}={}){
  const base=await realpath(tmpdir()),dir=await mkdtemp(join(base,'funded-conversion-http-')),servers=[];
  t.after(async()=>{for(const server of servers){server.closeAllConnections();if(server.listening)await new Promise(r=>server.close(r));}
    const target=await realpath(dir);assert.equal(target,resolve(dir));assert(target.startsWith(base+sep));await rm(target,{recursive:true,force:true});});
  const roles=['price-attestation','operator'],all={worker:sellReviewFixture({category})};for(const role of roles)all[role]=sellReviewFixture({category});
  const paths=Object.fromEntries(['worker',...roles].map(role=>[role,join(dir,role+'.json')]));
  const keys={'price-attestation':Keypair.fromSeed(new Uint8Array(32).fill(34)),operator:Keypair.fromSeed(new Uint8Array(32).fill(33))};
  const tokens={'price-attestation':'a'.repeat(64),operator:'b'.repeat(64),worker:'c'.repeat(64)},calls={'price-attestation':0,operator:0,send:0};
  const origins={},backends={},hooks={},responses={},requests=[];
  const bind=async server=>{servers.push(server);await new Promise(r=>server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+server.address().port;};
  const c={dir,all,paths,tokens,calls,origins,backends,hooks,responses,requests,wire:null,bind};
  c.makeBackend=async(role,override={})=>{
    const f=all[role],store=createAutomaticRewardStore(paths[role]);
    const service=createTokenConversionSigningService({store,connection:f.connection,config:f.config,release:f.release,role,token:tokens[role],now:()=>f.now,signTimeoutMs,
      signer:{publicKey:keys[role].publicKey,signMessage:async args=>{calls[role]++;const row=Object.values((await store.read())[conversionBucket].attempts)[0];assert(row.signingStartedAt);
        return hooks[role]?hooks[role](args):nacl.sign.detached(args.message,keys[role].secretKey);}},...override});
    if(!await store.hasPublishedFile())await createTokenConversionJournal({store,connection:f.connection,config:f.config,release:f.release,now:()=>f.now})
      .initialize({firstProvisioningRole:role});
    await service.initialize();const origin=await bind(service.server);origins[role]=origin;backends[role]=service;return service;
  };
  for(const role of roles)await c.makeBackend(role);
  c.restartBackend=async(role,override={})=>{const old=backends[role].server;old.closeAllConnections();await new Promise(r=>old.close(r));return c.makeBackend(role,override);};
  const fetchFor=role=>async(url,options)=>{
    const path=new URL(url).pathname;requests.push({role,path});
    const response=await fetch(origins[role]+path,options);return responses[role]?responses[role](path,response):response;
  };
  const f=all.worker,hash=createHash('sha256').update(f.unsigned.message.serialize()).digest('hex');c.hash=hash;
  f.connection.sendRawTransaction=async(raw,options)=>{
    calls.send++;c.wire=Buffer.from(raw).toString('base64');const saved=Object.values(JSON.parse(await readFile(paths.worker,'utf8'))[conversionBucket].attempts)[0];
    assert(saved.broadcastAttemptedAt);assert.equal(saved.signedTransaction,c.wire);assert.equal(options.maxRetries,0);
    if(send==='unknown')throw Error('Synthetic send result unknown');
    let signature;for(const bank of Object.values(all)){bank.advance();signature=bank.land(c.wire);bank.advance();}return signature;
  };
  c.land=()=>{for(const bank of Object.values(all)){bank.advance();bank.land(c.wire);bank.advance();}};
  c.makeController=async()=>{
    const store=createAutomaticRewardStore(paths.worker);
    const controller=createTokenConversionController({store,connection:f.connection,config:f.config,release:f.release,
      token:tokens.worker,now:()=>f.now,priceService:{endpoint:'https://price-custody.invalid/',token:tokens['price-attestation'],request:fetchFor('price-attestation')},
      operatorService:{endpoint:'https://operator-custody.invalid/',token:tokens.operator,request:fetchFor('operator')}});
    if(!await store.hasPublishedFile())await createTokenConversionJournal({store,connection:f.connection,config:f.config,release:f.release,now:()=>f.now})
      .initialize({firstProvisioningRole:'controller'});
    await controller.initialize();origins.worker=await bind(controller.server);c.controller=controller;return controller;
  };
  await c.makeController();
  c.restartController=async()=>{c.controller.server.closeAllConnections();await new Promise(r=>c.controller.server.close(r));return c.makeController();};
  c.post=async(role,path,body,{token=tokens[role],raw=null,headers={}}={})=>{
    const response=await fetch(origins[role]+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json',...headers},
      body:raw===null?JSON.stringify(body):raw,signal:AbortSignal.timeout(15000)});
    return {status:response.status,body:await response.json()};
  };
  c.run=body=>c.post('worker','/run',{schemaVersion:1,...body});
  c.signBody=role=>({schemaVersion:1,messageHash:hash,request:all[role].request});
  c.row=async(role='worker')=>Object.values(JSON.parse(await readFile(paths[role],'utf8'))[conversionBucket].attempts)[0];
  c.stores=()=>Object.fromEntries(Object.entries(paths).map(([k,p])=>[k,createAutomaticRewardStore(p)]));
  return c;
}
