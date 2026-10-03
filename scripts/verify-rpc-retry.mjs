import assert from 'node:assert/strict';
import { retryableRpcError, rpcQuotaExhausted, rpcWorkerWaitMs, withRpcRetry } from '../rpc-retry.js';

assert.equal(retryableRpcError(new Error('429 Too Many Requests')), true);
assert.equal(retryableRpcError(new Error('429 Too Many Requests: max usage reached')), false);
assert.equal(rpcQuotaExhausted(new Error('failed to get info: Error: 429 Too Many Requests: max usage reached')), true);
assert.equal(rpcQuotaExhausted(new Error('429 Too Many Requests: retry shortly')), false);
assert.equal(rpcQuotaExhausted(new Error('invalid program owner')), false);
assert.equal(rpcWorkerWaitMs(new Error('429 Too Many Requests: max usage reached'), 20_000), 900_000);
assert.equal(rpcWorkerWaitMs(new Error('429 Too Many Requests: retry shortly'), 20_000), 20_000);
assert.equal(rpcWorkerWaitMs(new Error('429 Too Many Requests: max usage reached'), 1_000_000), 1_000_000);
assert.equal(retryableRpcError(new Error('networkerror')), true);
assert.equal(retryableRpcError(new Error('invalid pool owner')), false);
let calls = 0, retries = 0;
const result = await withRpcRetry(async () => { calls += 1; if (calls < 3) throw new Error('RPC rate limit'); return 'ready'; },
  { attempts:3, delaysMs:[0,0], wait:async()=>{}, onRetry:()=>{ retries += 1; } });
assert.equal(result, 'ready'); assert.equal(calls, 3); assert.equal(retries, 2);
let exhaustedCalls = 0;
await assert.rejects(withRpcRetry(async () => {
  exhaustedCalls += 1;
  throw new Error('429 Too Many Requests: max usage reached');
}, { wait:async()=>{} }), /max usage reached/);
assert.equal(exhaustedCalls, 1);
await assert.rejects(withRpcRetry(async () => { throw new Error('invalid pool owner'); }, { wait:async()=>{} }), /invalid pool owner/);
console.log('RPC retry checks passed');
