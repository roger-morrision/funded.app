import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRedisRpcCache} from '../server/redis-rpc-cache.mjs';

function fixture(options={}){
  const values=options.values||new Map(),writes=[];
  let time=1000,config;
  const client=Object.assign(new EventEmitter(),{isReady:true,isOpen:true,
    connect:async()=>{},get:async key=>values.get(key)??null,
    set:async(key,value,opts)=>{values.set(key,value);writes.push({key,value,opts});},
    destroy:()=>{client.isReady=false;client.isOpen=false;}});
  const cache=createRedisRpcCache({url:'redis://cache:6379',genesis:'devnet',now:()=>time,
    createClientImpl:input=>{config=input;return client;},...options});
  return{cache,values,writes,client,config,advance:ms=>{time+=ms;}};
}
const response={httpStatus:200,body:{jsonrpc:'2.0',result:{slot:123,meta:{err:null}}}};

test('Redis keys are hashed and cluster-scoped; values expire at an absolute deadline',async()=>{
  const f=fixture();await f.cache.start();await f.cache.set('full-rpc-options',response,5000);
  const [write]=f.writes;assert.match(write.key,/^funded:rpc:v1:devnet:[a-f0-9]{64}$/);
  assert(!write.key.includes('full-rpc-options'));assert.deepEqual(write.opts,{expiration:{type:'PXAT',value:6000}});
  assert.deepEqual((await f.cache.get('full-rpc-options')).response,response);
  f.advance(5001);assert.equal(await f.cache.get('full-rpc-options'),null);
  assert.equal(f.config.disableOfflineQueue,true);assert.equal(f.config.commandsQueueMaxLength,64);
  assert.equal(f.config.commandOptions.timeout,200);f.cache.close();assert.equal(f.client.isOpen,false);
});

test('cache survives client replacement and cannot cross cluster namespaces',async()=>{
  const f=fixture();await f.cache.set('key',response,10000);f.cache.close();
  const next=fixture({values:f.values});assert.deepEqual((await next.cache.get('key')).response,response);
  const other=fixture({values:f.values,genesis:'other-network'});assert.equal(await other.cache.get('key'),null);
});

test('malformed, mismatched, immortal and oversized Redis entries are ignored',async()=>{
  const f=fixture({maxEntryBytes:512});await f.cache.set('key',response,10000);
  const [key]=f.values.keys(),valid=JSON.parse(f.values.get(key));
  for(const value of ['bad-json','null',JSON.stringify({...valid,hash:'wrong'}),
    JSON.stringify({...valid,expiresAt:86401001}),JSON.stringify({...valid,version:2}),'x'.repeat(513)]){
    f.values.set(key,value);assert.equal(await f.cache.get('key'),null);
  }
  assert.equal(f.cache.stats().invalidEntries,6);
  await f.cache.set('big',{result:'x'.repeat(512)},1000);assert.equal(f.cache.stats().oversizedEntries,1);
  await f.cache.set('forever',response,86400001);assert.equal(f.writes.length,1);
});

test('Redis outages fall back immediately, back off and recover without replaying queued commands',async()=>{
  const f=fixture();let reads=0;
  f.client.get=async()=>{reads++;throw Error('redis://credential-must-not-be-logged');};
  assert.equal(await f.cache.get('key'),null);assert.equal(await f.cache.get('other'),null);assert.equal(reads,1);
  assert.equal(f.cache.stats().errors,1);f.advance(5001);
  f.client.get=async()=>null;assert.equal(await f.cache.get('key'),null);
  f.client.isReady=false;await f.cache.set('key',response,1000);assert.equal(f.writes.length,0);
  f.client.emit('error',Error('private'));assert.equal(f.cache.stats().errors,2);
  assert(!JSON.stringify(f.cache.stats()).includes('credential'));
});

test('write failures cannot escape into an RPC request',async()=>{
  const f=fixture();f.client.set=async()=>{throw Error('offline');};
  await f.cache.set('key',response,1000);assert.equal(f.cache.stats().errors,1);
});
