import test from 'node:test';
import assert from 'node:assert/strict';
import { candidateRoundTripWallet, formatLamportsAsSol, readRoundTripHistory, verifiedClosedRoundTrip, verifyRoundTripFromSignatures } from '../trade-roundtrip.js';
import { Keypair } from '@solana/web3.js';

const wallet = 'wallet', mint = 'mint', tokenAccount = Keypair.generate().publicKey.toBase58();
function tx(signature, slot, beforeTokens, afterTokens, beforeSol, afterSol) {
  const balance = amount => ({ accountIndex:1, owner:wallet, mint, uiTokenAmount:{ amount:String(amount) } });
  return { slot, meta:{ err:null, preBalances:[beforeSol, 0], postBalances:[afterSol, 0],
    preTokenBalances:beforeTokens == null ? [] : [balance(beforeTokens)], postTokenBalances:afterTokens == null ? [] : [balance(afterTokens)] },
    transaction:{ message:{ accountKeys:[{ pubkey:wallet, signer:true }, { pubkey:tokenAccount, signer:false }] }, signatures:[signature] } };
}
const buy = tx('buy', 10, null, 100, 10_000_000_000, 8_000_000_000);
const sell = tx('sell', 20, 100, null, 8_000_000_000, 11_000_000_000);
const proof = { buy, sell, wallet, mint, buySignature:'buy', sellSignature:'sell', accountHistory:['sell','buy'] };

test('reports only the exact wallet SOL change for an uninterrupted closed position', () => {
  const result = verifiedClosedRoundTrip(proof);
  assert.equal(result.netLamports, '1000000000');
  assert.equal(result.positive, true);
  assert.equal(result.tokenAccount, tokenAccount);
  assert.equal(formatLamportsAsSol(result.netLamports), '1');
  assert.equal(formatLamportsAsSol(1), '0.000000001');
  assert.throws(() => verifiedClosedRoundTrip({ ...proof, accountHistory:['sell','transfer','buy'] }), /Intervening/);
  assert.throws(() => verifiedClosedRoundTrip({ ...proof, sell:tx('sell', 20, 99, null, 8_000_000_000, 11_000_000_000) }), /exact token-account/);
  assert.throws(() => verifiedClosedRoundTrip({ ...proof, buy:tx('buy', 10, 5, 105, 10_000_000_000, 8_000_000_000) }), /exact token-account/);
  assert.throws(() => verifiedClosedRoundTrip({ ...proof, sell:tx('sell', 5, 100, null, 8_000_000_000, 11_000_000_000) }), /precede/);
});

test('reads the complete token-account signature interval and fails closed on gaps', async () => {
  const address = Keypair.generate().publicKey.toBase58();
  const calls = [];
  const connection = { async getSignaturesForAddress(_key, options, commitment) {
    calls.push({ options, commitment });
    return ['newer', 'sell', 'buy', 'older'].map(signature => ({ signature }));
  } };
  assert.deepEqual(await readRoundTripHistory(connection, address, 'buy', 'sell'), ['sell', 'buy']);
  assert.equal(calls[0].options.limit, 100);
  assert.equal(calls[0].commitment, 'finalized');
  const gap = { async getSignaturesForAddress() { return ['sell', 'transfer', 'buy'].map(signature => ({ signature })); } };
  assert.deepEqual(await readRoundTripHistory(gap, address, 'buy', 'sell'), ['sell', 'transfer', 'buy']);
  await assert.rejects(readRoundTripHistory(connection, address, 'missing', 'sell', { maxPages:1 }), /unavailable/);
});

test('a shared recipient can reproduce the closed result without a wallet connection', async () => {
  assert.equal(candidateRoundTripWallet(buy, sell, mint), wallet);
  const connection = {
    async getParsedTransaction(signature, options) {
      assert.equal(options.commitment, 'finalized');
      return signature === 'buy' ? buy : signature === 'sell' ? sell : null;
    },
    async getSignaturesForAddress() { return [{ signature:'sell' }, { signature:'buy' }]; },
  };
  const result = await verifyRoundTripFromSignatures(connection, { buySignature:'buy', sellSignature:'sell', mint });
  assert.equal(result.netLamports, '1000000000');
  assert.equal(result.wallet, wallet);
});
