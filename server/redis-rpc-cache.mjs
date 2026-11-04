import {createHash} from 'node:crypto';
import {createClient} from 'redis';

const MAX_TTL_MS=86400000;

// Optional L2 for immutable RPC results only. The gateway owns cache policy;
// Redis is never consulted for network verification or transaction execution.
export function createRedisRpcCache({url,genesis,now=Date.now,createClientImpl=createClient,
  timeoutMs=200,maxEntryBytes=16*1024*1024}={}){
  if(!url||!genesis)throw Error('Redis RPC cache requires a URL and cluster identity');
  let parsed;
  try{parsed=new URL(url);}catch{throw Error('Invalid Redis cache configuration');}
  if(!['redis:','rediss:'].includes(parsed.protocol))throw Error('Invalid Redis cache configuration');
  const prefix=`funded:rpc:v1:${genesis}:`;
  const client=createClientImpl({url,disableOfflineQueue:true,commandsQueueMaxLength:64,
    commandOptions:{timeout:timeoutMs},socket:{connectTimeout:750,
      reconnectStrategy:retries=>Math.min(30000,1000*2**Math.min(retries,5))}});
  const counters={reads:0,hits:0,misses:0,writes:0,errors:0,invalidEntries:0,oversizedEntries:0};
  let cooldownUntil=0,started=false,closed=false;
  const failed=()=>{counters.errors++;cooldownUntil=now()+5000;};
  client.on('error',failed); // Never log connection errors containing credentials.
  const usable=()=>!closed&&client.isReady&&now()>=cooldownUntil;
  const digest=key=>createHash('sha256').update(key).digest('hex');
  async function bounded(operation){
    let timer;
    // The client queue timeout ends when a command reaches the socket. Bound
    // the response too; its late result is ignored and never authorizes a flow.
    try{return await Promise.race([operation,new Promise((_resolve,reject)=>{
      timer=setTimeout(()=>reject(Error('Redis cache deadline exceeded')),timeoutMs);
    })]);}finally{clearTimeout(timer);}
  }
  async function start(){
    if(started||closed)return;started=true;
    const connecting=client.connect().catch(failed);
    let timer;
    try{await Promise.race([connecting,new Promise(resolve=>{timer=setTimeout(resolve,750);})]);}
    finally{clearTimeout(timer);}
  }
  async function get(key){
    counters.reads++;
    if(!usable()){counters.misses++;return null;}
    try{
      const hash=digest(key),text=await bounded(client.get(prefix+hash));
      if(text===null){counters.misses++;return null;}
      if(typeof text!=='string'||Buffer.byteLength(text)>maxEntryBytes){counters.invalidEntries++;return null;}
      let entry;
      try{entry=JSON.parse(text);}catch{counters.invalidEntries++;return null;}
      const remaining=entry?.expiresAt-now();
      if(entry?.version!==1||entry.hash!==hash||!Number.isSafeInteger(entry.expiresAt)
        ||remaining<=0||remaining>MAX_TTL_MS||!entry.response){counters.invalidEntries++;return null;}
      counters.hits++;return entry;
    }catch{failed();return null;}
  }
  async function set(key,response,ttlMs){
    if(!usable()||!Number.isSafeInteger(ttlMs)||ttlMs<=0||ttlMs>MAX_TTL_MS)return;
    try{
      const hash=digest(key),expiresAt=now()+ttlMs;
      const text=JSON.stringify({version:1,hash,expiresAt,response});
      if(Buffer.byteLength(text)>maxEntryBytes){counters.oversizedEntries++;return;}
      await bounded(client.set(prefix+hash,text,{expiration:{type:'PXAT',value:expiresAt}}));counters.writes++;
    }catch{failed();}
  }
  return{start,get,set,stats:()=>({enabled:true,ready:!closed&&client.isReady,
    ...counters,cooldownRemainingMs:Math.max(0,cooldownUntil-now())}),
    close:()=>{closed=true;if(client.isOpen)client.destroy();}};
}
