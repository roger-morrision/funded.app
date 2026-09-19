import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { submitLaunch } from '../launch-flow.js';

const payer = Keypair.generate();
const states = [];
const connection = {
  getMinimumBalanceForRentExemption: async () => 1_461_600,
  getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 99 }),
  sendRawTransaction: async raw => { assert.ok(raw.length > 0); return 'local-signature'; },
  confirmTransaction: async ({ signature }) => { assert.equal(signature, 'local-signature'); return { value: { err: null } }; },
};
const provider = {
  signTransaction: async transaction => { transaction.partialSign(payer); return transaction; },
};

const result = await submitLaunch({
  connection,
  provider,
  payer: payer.publicKey,
  input: { name: 'Local Flow Coin', symbol: 'LOCAL', supply: 1234, decimals: 6 },
  onStatus: status => states.push(status),
});

assert.equal(result.signature, 'local-signature');
assert.equal(result.amount, 1_234_000_000n);
assert.ok(result.mint.publicKey);
assert.ok(result.ata);
assert.deepEqual(states, [
  'Preparing mint account and token account…',
  'Waiting for wallet approval…',
  'Confirming on Solana Devnet…',
]);
console.log('local launch flow verification passed');
