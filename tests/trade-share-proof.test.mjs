import test from 'node:test';
import assert from 'node:assert/strict';
import { verifiedTradeReceipt } from '../trade-share-proof.js';

const input = { wallet:'wallet-address', mint:'mint-address', side:'buy', signature:'signature' };
const balance = amount => ({ owner:input.wallet, mint:input.mint, uiTokenAmount:{ amount } });
const tx = { meta:{ err:null, preTokenBalances:[balance('0')], postTokenBalances:[balance('100')] },
  transaction:{ message:{ accountKeys:[{ pubkey:input.wallet, signer:true }] }, signatures:[input.signature] } };

test('requires a finalized successful signed trade with a token balance delta', () => {
  assert.equal(verifiedTradeReceipt(tx, input), true);
  assert.equal(verifiedTradeReceipt(tx, { ...input, side:'sell' }), false);
  assert.equal(verifiedTradeReceipt({ ...tx, meta:{ ...tx.meta, err:{ code:1 } } }, input), false);
  assert.equal(verifiedTradeReceipt({ ...tx, transaction:{ ...tx.transaction, signatures:['other'] } }, input), false);
  assert.equal(verifiedTradeReceipt({ ...tx, meta:{ ...tx.meta, postTokenBalances:[balance('0')] } }, input), false);
  assert.equal(verifiedTradeReceipt(null, input), false);
});
