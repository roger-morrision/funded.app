import test from 'node:test';
import assert from 'node:assert/strict';
import {createWatchlistSync} from '../watchlist-sync.js';
const mint='11111111111111111111111111111111';
test('favorites require an account and never read or write browser storage',async()=>{
  const sync=createWatchlistSync({storage:{getItem(){throw new Error('Browser storage must not be used');},setItem(){throw new Error('Browser storage must not be used');}},request:async()=>({available:true,data:{accountId:'123',csrf:'token',mints:[mint]}})});
  await sync.setIdentity(null);assert.equal(await sync.save(mint,false),false);assert.deepEqual(sync.get(),[]);
  assert.equal(await sync.setIdentity('123'),true);assert.deepEqual(sync.get(),[mint]);
  await sync.setIdentity(null);assert.deepEqual(sync.get(),[]);
});
test('a delayed account response cannot leak favorites into the next account',async()=>{
  let resolve;
  const sync=createWatchlistSync({request:async()=>new Promise(done=>{resolve=done;})});
  const pending=sync.setIdentity('123');await new Promise(done=>setImmediate(done));
  await sync.setIdentity(null);resolve({available:true,data:{accountId:'123',csrf:'old',mints:[mint]}});
  assert.equal(await pending,false);assert.deepEqual(sync.get(),[]);
});
