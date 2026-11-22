import test from 'node:test';
import assert from 'node:assert/strict';
import {buybackVaultSpend} from '../../server/buyback-balance-proof.mjs';

test('donated WSOL can raise vault balance without hiding the actual purchase expense',()=>{
  const base={before:2_000_000,after:1_000_000,curve:false,quoteBefore:0,quoteAfter:0,quoteClosed:true};
  assert.equal(buybackVaultSpend(base),1_000_000n);
  // Donation exceeds the order, so a naive before-after calculation is negative.
  assert.equal(buybackVaultSpend({...base,quoteBefore:4_488_440,after:5_488_440}),1_000_000n);
  assert.equal(buybackVaultSpend({...base,quoteBefore:700_000,after:1_700_000}),1_000_000n);
  assert.equal(buybackVaultSpend({...base,quoteClosed:false}),null);
  assert.equal(buybackVaultSpend({...base,quoteAfter:1}),null);
  assert.equal(buybackVaultSpend({...base,quoteBefore:-1}),null);
  assert.equal(buybackVaultSpend({...base,before:Number.MAX_SAFE_INTEGER+1}),null);
  assert.equal(buybackVaultSpend({...base,after:base.before}),null);
  assert.equal(buybackVaultSpend({...base,curve:true,quoteBefore:99_000_000}),1_000_000n);
});
