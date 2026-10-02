import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { refundEphemeralDevnetBalances } from '../server/jackpot-test-refund.mjs';

const vault = Keypair.generate();
const creator = Keypair.generate();
const trader = Keypair.generate();
const refundAddress = Keypair.generate().publicKey.toBase58();
const balances = new Map([[vault.publicKey.toBase58(), 5_000_000_000],
  [creator.publicKey.toBase58(), 1_000_000],
  [trader.publicKey.toBase58(), 2_000_000]]);
const transfers = new Map();
const receipts = [];
let waits = 0;
let reads = 0;
const connection = {
  getBalance:async key => balances.get(key.toBase58()),
  getBlockHeight:async () => 50,
  getLatestBlockhash:async () => ({ blockhash:Keypair.generate().publicKey.toBase58(),
    lastValidBlockHeight:100 }),
  getFeeForMessage:async () => ({ value:5_000 }),
  getParsedTransaction:async signature => {
    reads += 1;
    if (reads === 1) return null; // transient indexing lag: never send twice.
    const transfer = transfers.get(signature);
    return transfer && { meta:{ err:null }, transaction:{ message:{ instructions:[{
      program:'system', parsed:{ type:'transfer', info:{ source:transfer.source,
        destination:refundAddress, lamports:transfer.amountLamports } },
    }] } } };
  },
};
let sends = 0;
await refundEphemeralDevnetBalances({ connection,
  signers:[creator, trader, vault], refundAddress,
  send:async (signer, amountLamports) => {
    sends += 1;
    const source = signer.publicKey.toBase58();
    balances.set(source, balances.get(source) - amountLamports - 5_000);
    const signature = `mock-refund-${sends}`;
    transfers.set(signature, { source, amountLamports });
    return { signature, lastValidBlockHeight:100 };
  },
  waitForRetry:async ({ error }) => {
    assert.match(error.message, /pending finalization/);
    waits += 1;
  },
  onReceipt:row => receipts.push(row),
});
assert.equal(sends, 3);
assert.equal(waits, 1);
assert.equal(receipts.filter(row => row.status === 'finalized').length, 3);
assert.equal(balances.get(vault.publicKey.toBase58()), 0);
assert.equal(balances.get(creator.publicKey.toBase58()), 0);
assert.equal(balances.get(trader.publicKey.toBase58()), 0);
console.log('Jackpot Devnet refund fixture passed: three wallets swept, pending signature reconciled, no duplicate send.');
