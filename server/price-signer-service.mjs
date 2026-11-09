import assert from 'node:assert/strict';
import {createHash,timingSafeEqual} from 'node:crypto';
import {createServer} from 'node:http';
import nacl from 'tweetnacl';
import {reviewBuyback} from './price-signer-review.mjs';

export function validatePriceSignerConfig(config,signer){
  assert(config?.cluster==='devnet'&&Array.isArray(config.programs)&&config.programs.length>0&&config.programs.length<=2,'Explicit Devnet signer allowlist required.');
  assert(/^[1-9]\d*$/.test(config.maxDailyLamports)&&BigInt(config.maxDailyLamports)<=5000000000n,'Daily limit must be at most 5 Devnet SOL.');
  const seen=new Set();
  for(const p of config.programs){
    assert(!seen.has(p.programId),'Duplicate program.');seen.add(p.programId);
    for(const name of ['programId','authority','upgradeAuthority','mint','pool'])assert(typeof p[name]==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(p[name]),'Explicit public identities required.');
    assert(p.authority!==String(signer)&&p.upgradeAuthority!==String(signer),'Price key must be separate from application authorities.');
    assert(/^[a-f0-9]{64}$/.test(p.programDataSha256),'Reviewed ProgramData hash required.');
    assert(/^[1-9]\d*$/.test(p.maxOrderLamports)&&BigInt(p.maxOrderLamports)<=1000000000n,'Order limit must be at most 1 Devnet SOL.');
    assert(typeof p.allowCurve==='boolean','Explicit curve activation required.');
  }
  return config;
}

export function createPriceSignerServer({connection,config,keypair,token,journal,review=reviewBuyback}){
  validatePriceSignerConfig(config,keypair.publicKey);
  assert(/^[a-f0-9]{64}$/.test(token),'A dedicated authentication token is required.');
  let busy=false;
  const digest=value=>createHash('sha256').update(value).digest();
  const expected=digest(`Bearer ${token}`);
  const server=createServer(async(req,res)=>{
    const reply=(code,body)=>{res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));};
    if(req.method==='GET'&&req.url==='/health')return reply(200,{status:'ready',cluster:'devnet',signer:String(keypair.publicKey)});
    if(req.method!=='POST'||req.url!=='/sign')return reply(404,{error:'Not found.'});
    if(!timingSafeEqual(digest(String(req.headers.authorization||'')),expected))return reply(401,{error:'Unauthorized.'});
    if(busy)return reply(429,{error:'A signing review is already running.'});
    busy=true;
    try{
      assert(req.headers['content-type']==='application/json','JSON required.');
      let body='';for await(const chunk of req){body+=chunk;assert(Buffer.byteLength(body)<=4096,'Request too large.');}
      const request=JSON.parse(body),approved=config.programs.find(p=>p.programId===request.programId);
      assert(approved,'Program is not allowlisted.');
      const result=await review({connection,config:approved,signer:keypair.publicKey,request});
      await journal.reserve(result,{connection,maxDailyLamports:config.maxDailyLamports});
      assert(!res.destroyed,'Client disconnected before signing.');
      const signature=nacl.sign.detached(result.transaction.message.serialize(),keypair.secretKey);
      reply(200,{signature:Buffer.from(signature).toString('base64')});
      console.log(JSON.stringify({event:'price_signature',hash:result.messageHash,receipt:result.receipt,slot:result.slot}));
    }catch(error){
      // Neither HTTP callers nor logs receive RPC endpoints, key parsing details,
      // raw transaction bytes, or an arbitrary upstream exception.
      reply(409,{error:'Transaction did not pass independent price and custody checks.'});
      console.log(JSON.stringify({event:'price_signature_rejected',code:error.code==='ERR_ASSERTION'?'policy':'review'}));
    }finally{busy=false;}
  });
  server.requestTimeout=45000;server.headersTimeout=5000;server.keepAliveTimeout=1000;
  return server;
}
