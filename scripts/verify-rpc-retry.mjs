import assert from 'node:assert/strict';
import { retryableRpcError, withRpcRetry } from '../rpc-retry.js';

assert.equal(retryableRpcError(new Error('429 Too Many Requests')), true);
assert.equal(retryableRpcError(new Error('networkerror')), true);
assert.equal(retryableRpcError(new Error('invalid pool owner')), false);
let calls = 0, retries = 0;
const result = await withRpcRetry(async () => { calls += 1; if (calls < 3) throw new Error('RPC rate limit'); return 'ready'; },
  { attempts:3, delaysMs:[0,0], wait:async()=>{}, onRetry:()=>{ retries += 1; } });
assert.equal(result, 'ready'); assert.equal(calls, 3); assert.equal(retries, 2);
await assert.rejects(withRpcRetry(async () => { throw new Error('invalid pool owner'); }, { wait:async()=>{} }), /invalid pool owner/);
console.log('RPC retry checks passed');
