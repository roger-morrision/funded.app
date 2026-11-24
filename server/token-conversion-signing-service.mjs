import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import nacl from 'tweetnacl';
import {createTokenConversionJournal} from './token-conversion-journal.mjs';
import {conversionAuthorization,conversionReply,conversionJson,conversionObject,conversionSignature,unsignedConversionHash,conversionSummary} from './token-conversion-http.mjs';

// Passive service factory: no key/env loader, listener, allowlist update or
// activation. A separately approved custody adapter supplies ONLY its own role.
export function createTokenConversionSigningService({store,connection,config,release,role,signer,token,now=Date.now,signTimeoutMs=30000,recoveryOnly=false,inspectAdmission}){
  assert(typeof recoveryOnly==='boolean','Explicit recovery mode required.');
  assert(['operator','price-attestation'].includes(role),'Exact conversion custody role required.');
  const publicKey=String(role==='operator'?config.authority:config.priceSigner);
  assert(String(signer?.publicKey)===publicKey&&typeof signer.signMessage==='function','Exact role custody adapter required.');
  assert(Number.isSafeInteger(signTimeoutMs)&&signTimeoutMs>0&&signTimeoutMs<=30000,'Bounded custody timeout required.');
  const journal=createTokenConversionJournal({store,connection,config,release,now}),authorized=conversionAuthorization(token);
  let busy=false;
  const fresh=review=>{const at=now();return Number.isSafeInteger(at)&&at>=review.reviewedAt&&at-review.reviewedAt<35000;};
  const server=createServer(async(req,res)=>{
    const reply=(code,value)=>conversionReply(res,code,value);
    if(!authorized(req))return reply(401,{error:'Unauthorized.'});
    if(req.method==='GET'&&req.url==='/admission'&&inspectAdmission){
      try{return reply(200,await inspectAdmission());}
      catch{return reply(503,{error:'Fresh conversion admission unavailable.'});}
    }
    if(req.method!=='POST'||!['/sign','/reconcile'].includes(req.url))return reply(404,{error:'Not found.'});
    if(recoveryOnly&&req.url==='/sign')return reply(503,{error:'Custody service is recovery-only.'});
    if(busy)return reply(429,{error:'Conversion custody review busy.'});busy=true;
    try{
      assert(req.headers['content-type']==='application/json','JSON required.');
      const body=await conversionJson(req);
      if(req.url==='/reconcile'){
        conversionObject(body,['schemaVersion','messageHash','signature']);assert(typeof body.messageHash==='string'&&body.messageHash.length===64&&/^[a-f0-9]{64}$/.test(body.messageHash),'Exact saved hash required.');
        if(body.signature!=null)conversionSignature(body.signature);
        return reply(200,{schemaVersion:1,...conversionSummary(await journal.reconcile(body))});
      }
      conversionObject(body,['schemaVersion','messageHash','request']);const parsed=unsignedConversionHash(body.request);
      assert(parsed.messageHash===body.messageHash,'Requested message hash differs.');
      const {reservation:row,review,created}=await journal.reserve(body.request);
      if(row.roleSignatures?.[role]){assert(fresh(review),'Cached review expired.');return reply(200,{schemaVersion:1,role,publicKey,messageHash:row.messageHash,signature:row.roleSignatures[role]});}
      // A previous process could have exposed an unknown signer operation.
      if(!created)return reply(503,{error:'Saved signing attempt requires reconciliation.'});
      const claimed=await journal.claimSigning({messageHash:row.messageHash});assert(claimed.claimed&&fresh(review)&&!res.destroyed,'Signing admission expired.');
      assert(String(signer.publicKey)===publicKey,'Custody identity changed.');
      const message=Buffer.from(review.transaction.message.serialize()),controller=new AbortController();let timer,signature;
      try{
        const value=await Promise.race([Promise.resolve().then(()=>signer.signMessage({message:Buffer.from(message),version:0,role,
          messageHash:row.messageHash,transactionBase64:row.unsignedTransaction,intentDigest:row.intentDigest,signal:controller.signal})),
          new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Custody operation unconfirmed')),signTimeoutMs);})]);
        signature=Uint8Array.from(value||[]);assert(signature.length===64&&nacl.sign.detached.verify(message,signature,parsed.tx.message.staticAccountKeys[role==='operator'?0:1].toBytes()),'Custody signature differs.');
      }finally{clearTimeout(timer);controller.abort();}
      const encoded=Buffer.from(signature).toString('base64');
      await journal.recordRoleSignature({messageHash:row.messageHash,role,signatureBase64:encoded});
      assert(fresh(review)&&!res.destroyed,'Response review expired.');
      return reply(200,{schemaVersion:1,role,publicKey,messageHash:row.messageHash,signature:encoded});
    }catch{return reply(409,{error:'Conversion did not pass independent custody review.'});}
    finally{busy=false;}
  });
  server.requestTimeout=40000;server.headersTimeout=5000;server.keepAliveTimeout=1000;
  return {server,initialize:()=>journal.initialize(),status:()=>journal.status()};
}
