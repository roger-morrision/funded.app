import test from 'node:test';
import assert from 'node:assert/strict';
import { assessTradeCompletion } from '../trade-completion.js';

const wallet = 'wallet-address', mint = 'mint-address', signature = 'trade-signature';
const balance = amount => ({ owner:wallet, mint, uiTokenAmount:{ amount:String(amount) } });
const transaction = (before, after) => ({ meta:{ err:null, preTokenBalances:[balance(before)], postTokenBalances:[balance(after)] },
  transaction:{ message:{ accountKeys:[{ pubkey:wallet, signer:true }] }, signatures:[signature] } });
const marketActivity = side => ({ cluster:'devnet', mint, source:'confirmed-pump-trade-events',
  recentTrades:[{ signature, trader:wallet, side }] });
const evidence = (side, tx, market) => assessTradeCompletion({ transaction:tx, marketActivity:market,
  wallet, mint, side, signature });

test('Buy completion requires finalized token gain and matching indexed Buy row', () => {
  assert.deepEqual(evidence('buy', transaction(0, 100), marketActivity('buy')),
    { receiptVerified:true, indexed:true, complete:true });
  assert.equal(evidence('buy', transaction(0, 100), { ...marketActivity('buy'), recentTrades:[] }).complete, false);
  assert.equal(evidence('buy', transaction(0, 0), marketActivity('buy')).complete, false);
  assert.equal(evidence('buy', transaction(0, 100), marketActivity('sell')).complete, false);
});

test('Sell completion requires finalized token decrease and matching indexed Sell row', () => {
  assert.deepEqual(evidence('sell', transaction(100, 0), marketActivity('sell')),
    { receiptVerified:true, indexed:true, complete:true });
  assert.equal(evidence('sell', transaction(100, 0), null).complete, false);
  assert.equal(evidence('sell', transaction(100, 100), marketActivity('sell')).complete, false);
  assert.equal(evidence('sell', transaction(100, 0), { ...marketActivity('sell'), recentTrades:[{ signature, trader:'other', side:'sell' }] }).complete, false);
});
