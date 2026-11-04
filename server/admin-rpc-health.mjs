const counts=['requests','upstreamRequests','cacheHits','redisCacheHits','coalescedReads','accountBatchSavings','upstreamFailures','rateLimited','queueRejected','queueDepth'];
export async function readAdminRpcHealth({env=process.env,fetch:request=globalThis.fetch}={}){
 if(env.FUNDED_RPC_GATEWAY_ENABLED!=='true')return{enabled:false,checkedAt:new Date().toISOString()};
 const base=new URL(env.FUNDED_RPC_GATEWAY_URL||'http://rpc-gateway:8899');
 if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.search)throw Error('Gateway health is unavailable.');
 const response=await request(new URL('/metrics',base),{cache:'no-store',signal:AbortSignal.timeout(2500)});
 if(!response.ok)throw Error('Gateway health is unavailable.');
 const data=await response.json();
 if(data.cluster!=='devnet'||counts.some(k=>!Number.isSafeInteger(data[k])||data[k]<0)||data.redisCacheHits>data.cacheHits)
  throw Error('Gateway metrics are unavailable or invalid.');
 return{enabled:true,checkedAt:new Date().toISOString(),cluster:data.cluster,verified:data.upstreamVerified===true,
  redis:{enabled:data.redis?.enabled===true,ready:data.redis?.ready===true},counts:Object.fromEntries(counts.map(k=>[k,data[k]])),
  memoryCacheHits:data.cacheHits-data.redisCacheHits,avoidedProviderAttempts:data.cacheHits+data.coalescedReads+data.accountBatchSavings,
  scope:'Gateway counters since its last restart; request attempts, not billed credits.'};
}
