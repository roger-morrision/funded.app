const fields=['requests','upstreamRequests','cacheHits','redisCacheHits','coalescedReads','accountBatchSavings',
 'upstreamFailures','rateLimited','queueRejected'];

// Prevented provider attempts, not billing credits. Redis is incremental to
// the memory tier; its hits must never be counted twice as cache savings.
export function rpcSavingsBetween(before,after){
 if(!before?.instance||before.instance!==after?.instance)throw Error('Savings require the same gateway process instance');
 const delta={};
 for(const key of fields){
  const a=before.metrics?.[key],b=after.metrics?.[key];
  if(!Number.isSafeInteger(a)||a<0||!Number.isSafeInteger(b)||b<a)throw Error('Invalid or reset RPC counter: '+key);
  delta[key]=b-a;
 }
 if(delta.redisCacheHits>delta.cacheHits)throw Error('Redis hits must be a subset of total cache hits');
 const avoided={memoryCache:delta.cacheHits-delta.redisCacheHits,redisCache:delta.redisCacheHits,
  coalescing:delta.coalescedReads,accountBatching:delta.accountBatchSavings};
 const total=Object.values(avoided).reduce((n,value)=>n+value,0),equivalentUnoptimizedAttempts=delta.upstreamRequests+total;
 return{logicalRequests:delta.requests,providerRequests:delta.upstreamRequests,avoided,totalAvoidedProviderAttempts:total,
  incrementalRedisSavings:avoided.redisCache,equivalentUnoptimizedAttempts,
  avoidedAttemptPercent:equivalentUnoptimizedAttempts?100*total/equivalentUnoptimizedAttempts:0,
  errors:{upstreamFailures:delta.upstreamFailures,providerRateLimits:delta.rateLimited,localQueueRejections:delta.queueRejected},
  rejectedRequestsCountedAsSavings:false,billingCreditsMeasured:false,
  scope:'All gateway traffic between observations, including background automation. Savings events, not billed credits.'};
}
