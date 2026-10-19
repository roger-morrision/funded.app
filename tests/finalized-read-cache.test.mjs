import test from 'node:test';
import assert from 'node:assert/strict';
import {createFinalizedReadCache} from '../server/finalized-read-cache.mjs';

test('finalized duplicate reads share an in-flight call while other commitments and arguments stay fresh',async()=>{
 let calls=0,release;
 const connection={marker:'bound',getTransaction:async function(signature){assert.equal(this.marker,'bound');calls++;if(signature==='wait')await new Promise(resolve=>{release=resolve;});return {signature};}};
 const scoped=createFinalizedReadCache(connection);
 const a=scoped.getTransaction('wait',{commitment:'finalized'}),b=scoped.getTransaction('wait',{commitment:'finalized'});
 await Promise.resolve();assert.equal(calls,1);release();assert.deepEqual(await a,await b);
 await scoped.getTransaction('other',{commitment:'finalized'});assert.equal(calls,2);
 await scoped.getTransaction('other',{commitment:'confirmed'});await scoped.getTransaction('other',{commitment:'confirmed'});
 await scoped.getTransaction('other');await scoped.getTransaction('other');assert.equal(calls,6);
});

test('failed reads fail closed and a new pass fetches fresh evidence',async()=>{
 let available=false,calls=0;
 const connection={getAccountInfo:async()=>{calls++;if(!available)throw new Error('RPC unavailable');return {current:true};}};
 const first=createFinalizedReadCache(connection);
 await assert.rejects(first.getAccountInfo('policy','finalized'),/RPC unavailable/);
 available=true;await assert.rejects(first.getAccountInfo('policy','finalized'),/RPC unavailable/);assert.equal(calls,1);
 assert.deepEqual(await createFinalizedReadCache(connection).getAccountInfo('policy','finalized'),{current:true});assert.equal(calls,2);
});
