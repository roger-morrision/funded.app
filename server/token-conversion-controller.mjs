import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createTokenConversionTransport} from './token-conversion-transport.mjs';
import {createTokenConversionRemoteSigner} from './token-conversion-remote-signers.mjs';
import {conversionAuthorization,conversionReply,conversionJson,conversionObject,conversionSummary} from './token-conversion-http.mjs';
import {tokenPricePolicyHash} from './token-conversion-sell-review.mjs';

const recoveryProgressKey='tokenConversionRecoveryProgressV1';

export function selectSavedConversionPage({attempts,after=null,limit=32}){
  assert(after===null||typeof after==='string'&&/^[a-f0-9]{64}$/.test(after),'Canonical recovery cursor required.');
  assert(Number.isSafeInteger(limit)&&limit>=1&&limit<=32,'Bounded recovery page required.');
  assert(attempts&&typeof attempts==='object'&&!Array.isArray(attempts),'Validated saved attempts required.');
  const pending=Object.keys(attempts).filter(hash=>!['settled','released-no-conversion'].includes(attempts[hash].status)).sort();
  const start=after===null?0:Math.max(0,pending.findIndex(hash=>hash>after));
  const hashes=pending.slice(start,start+limit);
  return {hashes,nextAfter:hashes.at(-1)??after,remaining:pending.length};
}

// Passive private controller, not registered with the public API or worker.
// Holds service authentication references, never an operator/price private key.
export function createTokenConversionController({store,connection,config,release,priceService,operatorService,token,now=Date.now,recoveryOnly=false,inspectAdmission}){
  assert(typeof recoveryOnly==='boolean','Explicit recovery mode required.');
  config=structuredClone(config);release=structuredClone(release);
  const priceSigner=createTokenConversionRemoteSigner({...priceService,publicKey:config.priceSigner,programId:config.programId,role:'price-attestation'});
  const operator=createTokenConversionRemoteSigner({...operatorService,publicKey:config.authority,programId:config.programId,role:'operator'});
  const transport=createTokenConversionTransport({store,connection,config,release,priceSigner,operator,now});
  const authorized=conversionAuthorization(token);
  const server=createServer(async(req,res)=>{
    const reply=(code,value)=>conversionReply(res,code,value);
    if(!authorized(req))return reply(401,{error:'Unauthorized.'});
    if(req.method==='GET'&&req.url==='/admission'&&inspectAdmission){
      try{return reply(200,await inspectAdmission());}
      catch{return reply(503,{error:'Fresh conversion admission unavailable.'});}
    }
    if(req.method!=='POST'||req.url!=='/run')return reply(404,{error:'Not found.'});
    try{
      assert(req.headers['content-type']==='application/json','JSON required.');
      const body=conversionObject(await conversionJson(req),['schemaVersion','request','messageHash','recoveryOnly']);
      if(body.messageHash!==undefined)assert(typeof body.messageHash==='string'&&body.messageHash.length===64&&/^[a-f0-9]{64}$/.test(body.messageHash),'Exact saved hash required.');
      assert(body.recoveryOnly===undefined||typeof body.recoveryOnly==='boolean','Explicit recovery request required.');
      const result=await transport.run({request:body.request,messageHash:body.messageHash,recoveryOnly:recoveryOnly||(body.recoveryOnly??false)});
      let signerReconciliation='not-required';
      if(result.status==='settled'){
        // Payment proof is already durable locally. Backends independently
        // authenticate it; an unavailable backend cannot erase that proof.
        const checks=await Promise.allSettled([priceSigner,operator].map(s=>s.reconcile({messageHash:result.messageHash,signature:result.signature})));
        signerReconciliation=checks.every(c=>c.status==='fulfilled'&&c.value.status==='settled')?'settled':'pending';
      }
      return reply(200,{schemaVersion:1,...conversionSummary(result),signerReconciliation});
    }catch{return reply(409,{error:'Conversion request requires verified recovery or review.'});}
  });
  server.requestTimeout=120000;server.headersTimeout=5000;server.keepAliveTimeout=1000;
  // A private worker may reconcile only attempts already saved in its own
  // controller journal. The cursor is a work hint; it grants no new signing or
  // broadcast authority and is returned to the caller for bounded paging.
  async function recoverSaved({after=null,limit=32}={}){
    const {attempts}=await transport.status();
    const {hashes:page,nextAfter,remaining}=selectSavedConversionPage({attempts,after,limit});
    const results=[];
    for(const messageHash of page){
      try{const result=await transport.run({messageHash,recoveryOnly:true});results.push({messageHash,status:result.status});}
      catch{results.push({messageHash,status:'reconciliation-pending'});}
    }
    return {attempts:results,nextAfter,remaining};
  }
  async function recoverNext({limit=32}={}){
    const snapshot=await transport.status();
    const page=await store.transaction(state=>{
      const journal=state.tokenConversionPriceJournalV1;
      assert(journal&&tokenPricePolicyHash(journal.context)===snapshot.contextHash,'Saved recovery context changed before cursor claim.');
      const prior=state[recoveryProgressKey];
      assert(prior===undefined||prior?.contextHash===snapshot.contextHash
        &&(prior.after===null||typeof prior.after==='string'&&/^[a-f0-9]{64}$/.test(prior.after))
        &&Number.isSafeInteger(prior.sequence)&&prior.sequence>=0,'Incompatible recovery progress requires review.');
      const selected=selectSavedConversionPage({attempts:journal.attempts,after:prior?.after??null,limit});
      if(selected.hashes.length)state[recoveryProgressKey]={contextHash:snapshot.contextHash,after:selected.nextAfter,sequence:(prior?.sequence??0)+1};
      return selected;
    });
    const results=[];
    for(const messageHash of page.hashes){
      try{const result=await transport.run({messageHash,recoveryOnly:true});results.push({messageHash,status:result.status});}
      catch{results.push({messageHash,status:'reconciliation-pending'});}
    }
    return {attempts:results,nextAfter:page.nextAfter,remaining:page.remaining};
  }
  return {server,initialize:()=>transport.initialize(),status:()=>transport.status(),recoverSaved,recoverNext};
}
