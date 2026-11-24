import assert from 'node:assert/strict';
import {open,realpath,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {isAbsolute,resolve} from 'node:path';
import {Connection} from '@solana/web3.js';
import {requireReviewedTokenSignerPolicy,tokenPricePolicyHash} from './token-conversion-sell-review.mjs';
import {prepareTokenConversionRuntime} from './token-conversion-bootstrap.mjs';
import {createAutomaticRewardStore} from './automatic-reward-store.mjs';

const roles=['controller','operator','price-attestation'];
const exact=(object,names)=>object&&typeof object==='object'&&!Array.isArray(object)
  &&Object.keys(object).length===names.length&&names.every(name=>Object.hasOwn(object,name));
const path=value=>typeof value==='string'&&isAbsolute(value)&&resolve(value)===value;
const supplied=value=>typeof value==='string'&&value.trim()===value&&value.length>0&&!/REPLACE|PLACEHOLDER/i.test(value);
export const productionConversionDigest=({spec,policy,release,bindings,listen})=>tokenPricePolicyHash({spec,policy,release,bindings,listen});

// Public configuration and role references are validated before any credential
// read. A private launcher cannot turn an unreviewed release into an approval.
export function validateProductionConversionConfig({deployment,bindings,sourceRevision}){
  assert(deployment?.schemaVersion===1&&bindings?.schemaVersion===1,'Versioned production deployment and bindings required.');
  const {spec,policy,release,listen,activation}=deployment;
  requireReviewedTokenSignerPolicy(policy,release);
  assert(sourceRevision===release.sourceRevision&&/^[a-f0-9]{40}$/.test(sourceRevision),'Runtime source must match the reviewed release.');
  assert(spec?.cluster==='mainnet-beta'&&roles.includes(spec.role)&&['recovery-only','signing'].includes(spec.mode),'Explicit production role and mode required.');
  assert(spec.programId===policy.programId&&spec.programDataSha256===policy.programDataSha256
    &&spec.policyHash===tokenPricePolicyHash(policy),'Runtime policy identity differs.');
  assert(exact(listen,['host','port'])&&listen.host==='127.0.0.1'&&Number.isSafeInteger(listen.port)
    &&listen.port>=1024&&listen.port<=65535,'Production custody binds only an explicit private loopback port.');
  const own=spec.role,authRoles=own==='controller'?roles:[own];
  const fields=['schemaVersion','rpcFiles','journalFiles','authenticationFiles',...(spec.mode==='signing'&&own!=='controller'?['custodyFile']:[])];
  assert(exact(bindings,fields),'Unexpected or missing production binding fields.');
  for(const [field,refs]of [['rpcFiles',[spec.rpcReferences?.[own]]],
    ['journalFiles',roles.map(role=>spec.journalReferences?.[role])],
    ['authenticationFiles',authRoles.map(role=>spec.authenticationReferences?.[role])]]){
    assert(refs.every(supplied)&&new Set(refs).size===refs.length&&exact(bindings[field],refs)
      &&Object.values(bindings[field]).every(path),'Explicit exact-role file references required.');
  }
  const files=[...Object.values(bindings.rpcFiles),...Object.values(bindings.journalFiles),
    ...Object.values(bindings.authenticationFiles),...(bindings.custodyFile?[bindings.custodyFile]:[])];
  assert(files.every(path)&&new Set(files).size===files.length,'Credential, custody and journal paths must differ.');
  if(spec.mode==='signing')assert(activation?.status==='approved'&&supplied(activation.reference)
    &&activation.sourceRevision===sourceRevision&&activation.digest===productionConversionDigest({spec,policy,release,bindings,listen}),
    'Signing requires exact operational approval of release, policy, role, paths and listener.');
  else assert(activation?.status==='disabled','Recovery runtime must keep signing activation disabled.');
  return deployment;
}

async function regularFile(file){
  const stat=await lstat(file);
  assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1&&await realpath(file)===file,'Canonical single-link runtime file required.');
  return stat;
}
export async function readProductionReference(file){
  let handle;
  try{
    const original=await regularFile(file);
    handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
    const stat=await handle.stat();
    assert(stat.dev===original.dev&&stat.ino===original.ino&&stat.size>0&&stat.size<=4096,'Bounded runtime reference required.');
    const buffer=Buffer.alloc(4097);
    try{
      const {bytesRead}=await handle.read(buffer,0,buffer.length,0);
      assert(bytesRead===stat.size,'Runtime reference changed during read.');
      const text=buffer.subarray(0,bytesRead).toString('utf8').trim();
      assert(text&&!/[\r\n]/.test(text),'Single-line runtime reference required.');return text;
    }finally{buffer.fill(0);}
  }catch{throw Error('Production runtime reference is unavailable or incompatible.');}
  finally{await handle?.close();}
}

const connectionFor=url=>new Connection(url,{commitment:'finalized',disableRetryOnRateLimit:true,
  fetch:(address,options)=>fetch(address,{...options,signal:AbortSignal.any([AbortSignal.timeout(15000),...(options?.signal?[options.signal]:[])])})});

export async function prepareProductionConversionService({deployment,bindings,sourceRevision,
  connectionFactory=connectionFor,readReference=readProductionReference,request=fetch,now=Date.now,loadCustody}={}){
  deployment=structuredClone(deployment);bindings=structuredClone(bindings);
  validateProductionConversionConfig({deployment,bindings,sourceRevision});
  const {spec,policy,release,listen}=deployment;
  // Existing journals only. No listener can bootstrap an empty financial ledger.
  const identities=[];
  try{for(const file of Object.values(bindings.journalFiles)){
    const stat=await regularFile(file);identities.push(`${stat.dev}:${stat.ino}`);
  }assert(new Set(identities).size===3);}catch{throw Error('Three distinct existing production journals are required.');}
  const authentication=new Map();
  const runtime=await prepareTokenConversionRuntime({spec,policy,release,now,request,
    connectionFactory:async reference=>{
      assert(Object.hasOwn(bindings.rpcFiles,reference),'Unbound production RPC reference.');
      const endpoint=await readReference(bindings.rpcFiles[reference]);
      let url;try{url=new URL(endpoint);}catch{throw Error('Production RPC reference is invalid.');}
      assert(url.protocol==='https:'&&!url.username&&!url.password&&!url.hash,'Production RPC must use HTTPS.');
      return connectionFactory(endpoint);
    },
    storeFactory:async reference=>{
      assert(Object.hasOwn(bindings.journalFiles,reference),'Unbound production journal reference.');
      return createAutomaticRewardStore(bindings.journalFiles[reference]);
    },
    loadAuthentication:async reference=>{
      assert(Object.hasOwn(bindings.authenticationFiles,reference),'Unbound own-role authentication reference.');
      const token=await readReference(bindings.authenticationFiles[reference]);
      assert(![...authentication].some(([other,value])=>other!==reference&&value===token),'Role authentication tokens must differ.');
      authentication.set(reference,token);return token;
    },
    ...(spec.mode==='signing'&&spec.role!=='controller'
      ?loadCustody?{loadCustody}:{fileCustody:{keyFile:bindings.custodyFile}}:{}),
  });
  let started=false,closed=false,starting,closing;
  // Preserve the bootstrap's private recovery capability identity.
  return Object.assign(runtime,{
    start(){
      assert(!started&&!closed,'Production runtime cannot be started twice or reopened.');
      started=true;
      starting=(async()=>{
      try{
        await runtime.initialize();
        assert(!closed,'Production runtime is closing.');
        await new Promise((accept,reject)=>{
          const failed=error=>{runtime.server.off('listening',ready);reject(error);};
          const ready=()=>{runtime.server.off('error',failed);accept();};
          runtime.server.once('error',failed);runtime.server.once('listening',ready);
          runtime.server.listen(listen.port,listen.host);
        });
        return {role:spec.role,mode:spec.mode,cluster:'mainnet-beta',sourceRevision,port:listen.port};
      }catch{closed=true;await runtime.disposeCustody();throw Error('Production conversion listener was not admitted.');}
      })();
      return starting;
    },
    close(){
      if(closing)return closing;closed=true;
      closing=(async()=>{
        await starting?.catch(()=>{});
        runtime.server.closeIdleConnections();
        if(runtime.server.listening)await new Promise((accept,reject)=>runtime.server.close(error=>error?reject(error):accept()));
        await runtime.disposeCustody();
      })();return closing;
    },
  });
}
