import http from 'node:http';
import https from 'node:https';
import {PublicKey} from '@solana/web3.js';

export const RPC_GATEWAY_DEVNET_GENESIS='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const stable=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)
  ?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const failure=(httpStatus,message,code=-32005)=>({httpStatus,body:{jsonrpc:'2.0',error:{code,message}}});
const readMethod=method=>/^get[A-Z][A-Za-z0-9]*$/.test(method)||method==='isBlockhashValid';
const validRequest=request=>request?.jsonrpc==='2.0'&&typeof request.method==='string'
  &&(readMethod(request.method)||['sendTransaction','simulateTransaction','requestAirdrop'].includes(request.method))
  &&(Array.isArray(request.params)||request.params&&typeof request.params==='object')
  &&(request.id===null||typeof request.id==='string'&&request.id.length<=128||Number.isSafeInteger(request.id));

// One persistent provider socket. Neither transport errors nor writes retry.
export function createRpcUpstreamTransport(upstreamUrl,{timeoutMs=12000,maxResponseBytes=32*1024*1024,maxSockets=1}={}){
  const url=new URL(upstreamUrl);
  if(url.username||url.password||url.hash||!['https:','http:'].includes(url.protocol)
    ||url.protocol==='http:'&&!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('Invalid RPC upstream configuration');
  const client=url.protocol==='https:'?https:http,agent=new client.Agent({keepAlive:true,maxSockets,maxFreeSockets:maxSockets});
  const transport=payload=>new Promise((resolve,reject)=>{
    const bytes=Buffer.from(JSON.stringify(payload));
    const request=client.request(url,{method:'POST',agent,headers:{'content-type':'application/json','content-length':bytes.length}},response=>{
      const chunks=[];let size=0;
      response.on('data',chunk=>{size+=chunk.length;if(size>maxResponseBytes)response.destroy(Error('RPC response too large'));else chunks.push(chunk);});
      response.once('error',reject);response.once('end',()=>{
        let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{body=null;}
        resolve({status:response.statusCode,headers:response.headers,body});
      });
    });
    request.setTimeout(timeoutMs,()=>request.destroy(Error('RPC upstream timed out')));
    request.once('error',reject);request.end(bytes);
  });
  transport.close=()=>agent.destroy();return transport;
}

export function createRpcGateway({transport,minIntervalMs=500,blockIntervalMs=2500,sendIntervalMs=1000,maxConcurrent=1,batchWindowMs=15,
  maxQueue=48,maxQueueWaitMs=12000,cacheMaxEntries=1000,cacheMaxBytes=32*1024*1024,
  cooldownMs=30000,now=Date.now,wait=pause,sharedCache}={}){
  if(typeof transport!=='function')throw Error('RPC transport is required');
  const cache=new Map(),inflight=new Map(),accountGroups=new Map(),methodCooldowns=new Map(),waiters=[];
  const counters={requests:0,upstreamRequests:0,cacheHits:0,coalescedReads:0,accountBatchSavings:0,
    accountBatches:0,uncacheableRequests:0,upstreamFailures:0,rateLimited:0,queueRejected:0,redisCacheHits:0,redisCacheErrors:0};
  let tail=Promise.resolve(),queued=0,active=0,nextAt=0,nextBlockAt=0,nextSendAt=0,sequence=0,generation=0,cacheBytes=0,blockedUntil=0,verified=false,initializing;
  const stats=()=>({...counters,queueDepth:queued,cacheEntries:cache.size,cacheBytes,
    cooldownRemainingMs:Math.max(0,blockedUntil-now()),
    methodCooldowns:Object.fromEntries([...methodCooldowns].filter(([,until])=>until>now()).map(([method,until])=>[method,until-now()])),
    upstreamVerified:verified,cluster:'devnet',redis:sharedCache?.stats?.()||{enabled:false},
    pacing:{minIntervalMs,blockIntervalMs,sendIntervalMs,maxConcurrent}});
  const cooling=method=>Math.max(blockedUntil,methodCooldowns.get(method)||0)>now();
  const erase=key=>{const entry=cache.get(key);if(entry){cacheBytes-=entry.bytes;cache.delete(key);}};
  function cacheDuration(request,result){
    if(result===null||result===undefined)return 0;
    if(request.method==='getGenesisHash')return result===RPC_GATEWAY_DEVNET_GENESIS?3600000:0;
    if(['getTransaction','getBlock'].includes(request.method)&&request.params?.[1]?.commitment==='finalized')return 300000;
    return 0; // Mutable balances, blockhashes, indexes and status results stay fresh.
  }
  function remember(key,request,response,remainingMs=Infinity){
    const ttl=response.httpStatus===200&&!response.body.error?cacheDuration(request,response.body.result):0;
    if(!ttl)return;
    const bytes=Buffer.byteLength(JSON.stringify(response));if(bytes>cacheMaxBytes/2)return;
    erase(key);
    while(cache.size&&(cache.size>=cacheMaxEntries||cacheBytes+bytes>cacheMaxBytes))erase(cache.keys().next().value);
    cache.set(key,{response,expiresAt:now()+Math.min(ttl,remainingMs),bytes});cacheBytes+=bytes;
  }
  const persistentHistory=request=>['getTransaction','getBlock'].includes(request.method)
    &&request.params?.[1]?.commitment==='finalized';
  async function historyRead(input,key){
    let entry;
    try{entry=await sharedCache.get(key);}catch{counters.redisCacheErrors++;}
    const response=entry?.response,remaining=entry?.expiresAt-now();
    if(remaining>0&&remaining<=86400000&&response?.httpStatus===200&&response.body?.jsonrpc==='2.0'
      &&!response.body.error&&!Object.hasOwn(response.body,'id')&&cacheDuration(input,response.body.result)>0){
      counters.cacheHits++;counters.redisCacheHits++;remember(key,input,response,remaining);return response;
    }
    const fresh=await upstream(input);
    remember(key,input,fresh);
    if(fresh.httpStatus===200&&!fresh.body.error&&cacheDuration(input,fresh.body.result)>0){
      try{await sharedCache.set(key,fresh,86400000);}catch{counters.redisCacheErrors++;}
    }
    return fresh;
  }
  function upstream(request){
    if(cooling(request.method))return Promise.resolve(failure(429,'RPC provider is cooling down; retry later.'));
    if(queued>=maxQueue){counters.queueRejected++;return Promise.resolve(failure(429,'RPC gateway queue is full.'));}
    const enqueuedAt=now();queued++;
    // Starts stay paced and FIFO through one chain; up to maxConcurrent
    // requests may then wait on the provider at once.
    const slot=tail.then(async()=>{
      await acquire();
      if(cooling(request.method)){release();return failure(429,'RPC provider is cooling down; retry later.');}
      const delay=Math.max(0,nextAt-now(),request.method==='getBlock'?nextBlockAt-now():0,
        request.method==='sendTransaction'?nextSendAt-now():0);
      if(now()-enqueuedAt+delay>maxQueueWaitMs){release();counters.queueRejected++;return failure(503,'RPC gateway queue deadline reached.');}
      await wait(delay);
      nextAt=now()+minIntervalMs;if(request.method==='getBlock')nextBlockAt=now()+blockIntervalMs;
      if(request.method==='sendTransaction')nextSendAt=now()+sendIntervalMs;
      return null;
    });
    tail=slot.catch(()=>{});
    const operation=slot.then(async rejected=>{
      if(rejected)return rejected;
      try{return await forward(request);}finally{release();}
    }).finally(()=>{queued--;});
    return operation;
  }
  function acquire(){
    if(active<maxConcurrent){active++;return Promise.resolve();}
    return new Promise(resolve=>waiters.push(resolve));
  }
  function release(){const next=waiters.shift();if(next)next();else active--;}
  async function forward(request){
    if(cooling(request.method))return failure(429,'RPC provider is cooling down; retry later.');
    const payload={jsonrpc:'2.0',id:++sequence,method:request.method,params:request.params};
    counters.upstreamRequests++;
    let response;try{response=await transport(payload);}catch{counters.upstreamFailures++;return failure(503,'RPC upstream is unavailable.');}
    if(response.status===429||response.status===503||response.body?.error?.code===429){
      const retry=Number(response.headers?.['retry-after']);
      const until=now()+Math.max(5000,Math.min(300000,Number.isFinite(retry)&&retry>0?retry*1000:cooldownMs));
      if(/(?:specific RPC call|method rate limit)/i.test(response.body?.error?.message||''))methodCooldowns.set(request.method,until);
      else blockedUntil=until;
      counters.rateLimited++;return failure(429,'RPC provider is rate limited; retry later.');
    }
    if(response.status!==200||response.body?.jsonrpc!=='2.0'||response.body.id!==payload.id
      ||!Object.hasOwn(response.body,'result')&&!response.body.error){counters.upstreamFailures++;return failure(502,'RPC upstream returned an invalid response.');}
    if(response.body.error){const error=response.body.error;return{httpStatus:200,body:{jsonrpc:'2.0',error:{code:error.code,
      message:String(error.message||'RPC request failed').replace(/https?:\/\/[^\s"']+/g,'[provider]').slice(0,500),
      ...(error.data!==undefined?{data:error.data}:{})}}};}
    return{httpStatus:200,body:{jsonrpc:'2.0',result:response.body.result}};
  }
  function batchable(request){
    if(request.method!=='getAccountInfo'||!Array.isArray(request.params)||request.params.length!==2)return false;
    const [address,options]=request.params;
    if(options?.encoding!=='base64'||Object.keys(options).some(key=>!['commitment','encoding','dataSlice','minContextSlot'].includes(key)))return false;
    try{return typeof address==='string'&&new PublicKey(address).toBase58()===address;}catch{return false;}
  }
  function accountRead(request,epoch){
    const groupKey=stable([epoch,request.params[1]]);
    let group=accountGroups.get(groupKey);
    if(!group){group={rows:[],options:request.params[1]};accountGroups.set(groupKey,group);
      setTimeout(()=>flushAccounts(groupKey,group),batchWindowMs);}
    return new Promise(resolve=>{group.rows.push({request,resolve});if(group.rows.length===100){accountGroups.delete(groupKey);void flushAccounts(null,group);}});
  }
  async function flushAccounts(key,group){
    if(group.flushed)return;group.flushed=true;if(key&&accountGroups.get(key)===group)accountGroups.delete(key);
    if(group.rows.length===1){const row=group.rows[0];row.resolve(await upstream(row.request));return;}
    counters.accountBatches++;counters.accountBatchSavings+=group.rows.length-1;
    const response=await upstream({method:'getMultipleAccounts',params:[group.rows.map(row=>row.request.params[0]),group.options]});
    if(response.body.error){for(const row of group.rows)row.resolve(response);return;}
    const result=response.body.result;
    if(!Number.isSafeInteger(result?.context?.slot)||!Array.isArray(result.value)||result.value.length!==group.rows.length){
      for(const row of group.rows)row.resolve(failure(502,'RPC account batch is incomplete.'));return;
    }
    group.rows.forEach((row,index)=>row.resolve({httpStatus:200,body:{jsonrpc:'2.0',result:{context:result.context,value:result.value[index]}}}));
  }
  async function initialize(){
    if(verified)return true;if(initializing)return initializing;
    initializing=(async()=>{const response=await upstream({method:'getGenesisHash',params:[]});
      verified=response.httpStatus===200&&response.body.result===RPC_GATEWAY_DEVNET_GENESIS;
      if(verified)remember(stable(['getGenesisHash',[]]),{method:'getGenesisHash',params:[]},response);
      return verified;})().finally(()=>{initializing=null;});return initializing;
  }
  async function request(input){
    counters.requests++;
    const id=input?.id??null,finish=response=>({...response,body:{...response.body,id}});
    if(!validRequest(input))return finish(failure(400,'Unsupported JSON-RPC request.',-32600));
    if(!verified)return finish(failure(503,'RPC gateway has not verified Devnet.'));
    const readonly=readMethod(input.method),key=stable([input.method,input.params]);
    if(!readonly){
      counters.uncacheableRequests++;generation++;inflight.clear();
      try{return finish(await upstream(input));}finally{generation++;inflight.clear();}
    }
    const cached=cache.get(key);
    if(cached?.expiresAt>now()){counters.cacheHits++;return finish(cached.response);}if(cached)erase(key);
    const flightKey=stable([generation,key]);
    if(inflight.has(flightKey)){counters.coalescedReads++;return finish(await inflight.get(flightKey));}
    const operation=persistentHistory(input)&&sharedCache?historyRead(input,key):
      (batchable(input)?accountRead(input,generation):upstream(input)).then(response=>{remember(key,input,response);return response;});
    inflight.set(flightKey,operation);
    try{return finish(await operation);}finally{if(inflight.get(flightKey)===operation)inflight.delete(flightKey);}
  }
  return{request,initialize,stats,close:()=>{sharedCache?.close();transport.close?.();}};
}
