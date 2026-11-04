import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createClient} from 'redis';
import {createRedisRpcCache} from '../server/redis-rpc-cache.mjs';
import {createRpcGateway,RPC_GATEWAY_DEVNET_GENESIS} from '../server/rpc-gateway.mjs';

// Use a disposable Redis instance, never the live cache. No provider or wallet.
test('real Redis preserves history across gateway clients and bounds a stalled cache',
  {skip:!process.env.FUNDED_TEST_REDIS_URL},async()=>{
    const url=process.env.FUNDED_TEST_REDIS_URL,genesis='integration-'+randomUUID();
    const admin=createClient({url,socket:{reconnectStrategy:false},disableOfflineQueue:true});
    admin.on('error',()=>{});await admin.connect();
    const caches=[];let timeOffset=0,historyCalls=0,genesisCalls=0;
    const make=async()=>{
      const cache=createRedisRpcCache({url,genesis,now:()=>Date.now()+timeOffset});caches.push(cache);await cache.start();
      const gateway=createRpcGateway({sharedCache:cache,minIntervalMs:0,now:()=>Date.now()+timeOffset,
        transport:async request=>({status:200,body:{jsonrpc:'2.0',id:request.id,result:
          request.method==='getGenesisHash'?(genesisCalls++,RPC_GATEWAY_DEVNET_GENESIS):(historyCalls++,{slot:123,meta:{err:null}})}})});
      assert(await gateway.initialize());return{cache,gateway};
    };
    try{
      const a=await make(),request={jsonrpc:'2.0',id:'first',method:'getTransaction',params:['immutable',{commitment:'finalized'}]};
      assert.equal((await a.gateway.request(request)).body.result.slot,123);a.gateway.close();
      const keys=await admin.keys(`funded:rpc:v1:${genesis}:*`);assert.equal(keys.length,1);
      const ttl=await admin.pTTL(keys[0]);assert(ttl>86000000&&ttl<=86400000);
      const b=await make();assert.equal((await b.gateway.request({...request,id:'second'})).body.id,'second');
      assert.equal(historyCalls,1);assert.equal(genesisCalls,2);assert.equal(b.gateway.stats().redisCacheHits,1);
      await admin.sendCommand(['CLIENT','PAUSE','600','ALL']);
      const start=performance.now();assert.equal(await b.cache.get('uncached'),null);
      const elapsed=performance.now()-start;assert(elapsed<550,`Redis fallback took ${elapsed}ms`);
      assert.equal(b.cache.stats().errors,1);timeOffset=5001;
      await new Promise(resolve=>setTimeout(resolve,650));
      assert(await b.cache.get(JSON.stringify(['getTransaction',request.params])));
      assert.equal(b.cache.stats().hits,2);b.gateway.close();
      await admin.del(keys);
    }finally{for(const cache of caches)cache.close();admin.destroy();}
  });

test('an unavailable Redis instance cannot block gateway startup indefinitely',async()=>{
  const cache=createRedisRpcCache({url:'redis://127.0.0.1:1',genesis:'offline-test'});
  const start=performance.now();
  try{await cache.start();assert.equal(await cache.get('key'),null);assert(performance.now()-start<1500);}
  finally{cache.close();}
});
