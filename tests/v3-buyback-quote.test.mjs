import assert from 'node:assert/strict';
import test from 'node:test';
import { protectedV3BuybackClip, quoteV3Buyback } from '../server/v3-buyback-quote.mjs';

test('V3 quotes divide a large pending budget into policy-bounded pool clips',()=>{
  assert.equal(protectedV3BuybackClip('5000000000','826575321'),2066438n);
  assert.equal(protectedV3BuybackClip('1000000','826575321'),1000000n);
});

test('V3 buyback rejects only dust below its bounded Devnet floor before RPC', async () => {
  for (const budgetLamports of ['0', '9999', String(Number.MAX_SAFE_INTEGER + 1)]) {
    await assert.rejects(quoteV3Buyback({ budgetLamports,
      connection:{ getAccountInfo:() => assert.fail('Dust must not reach RPC') } }),
    error => error.statusCode === 409 && /10,000 lamports/.test(error.message));
  }
});
