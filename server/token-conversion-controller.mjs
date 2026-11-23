import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createTokenConversionTransport} from './token-conversion-transport.mjs';
import {createTokenConversionRemoteSigner} from './token-conversion-remote-signers.mjs';
import {conversionAuthorization,conversionReply,conversionJson,conversionObject,conversionSummary} from './token-conversion-http.mjs';

// Passive private controller, not registered with the public API or worker.
// Holds service authentication references, never an operator/price private key.
export function createTokenConversionController({store,connection,config,release,priceService,operatorService,token,now=Date.now,recoveryOnly=false}){
  assert(typeof recoveryOnly==='boolean','Explicit recovery mode required.');
  config=structuredClone(config);release=structuredClone(release);
  const priceSigner=createTokenConversionRemoteSigner({...priceService,publicKey:config.priceSigner,programId:config.programId,role:'price-attestation'});
  const operator=createTokenConversionRemoteSigner({...operatorService,publicKey:config.authority,programId:config.programId,role:'operator'});
  const transport=createTokenConversionTransport({store,connection,config,release,priceSigner,operator,now});
  const authorized=conversionAuthorization(token);
  const server=createServer(async(req,res)=>{
    const reply=(code,value)=>conversionReply(res,code,value);
    if(!authorized(req))return reply(401,{error:'Unauthorized.'});
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
  return {server,initialize:()=>transport.initialize(),status:()=>transport.status()};
}
