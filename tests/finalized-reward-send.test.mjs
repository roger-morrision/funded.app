import assert from 'node:assert/strict';
import test from 'node:test';
import bs58 from 'bs58';
import { Keypair, SystemProgram, Transaction } from '@solana/web3.js';
import { finalizedSend } from '../server/automatic-reward-chain.mjs';

const payer = Keypair.generate();
const blockhash = Keypair.generate().publicKey.toBase58();
const transfer = () => new Transaction().add(SystemProgram.transfer({
  fromPubkey: payer.publicKey,
  toPubkey: Keypair.generate().publicKey,
  lamports: 1,
}));

function connection({ submissionError, statuses = [{ confirmationStatus:'finalized', err:null }], height = 1 } = {}) {
  let submits = 0;
  let checks = 0;
  let signature;
  return {
    get submits() { return submits; },
    get signature() { return signature; },
    async getLatestBlockhash() { return { blockhash, lastValidBlockHeight:100 }; },
    async sendRawTransaction(raw) {
      submits += 1;
      signature = bs58.encode(Transaction.from(raw).signature);
      if (submissionError) throw submissionError;
      return signature;
    },
    async getSignatureStatuses() { return { value:[statuses[Math.min(checks++, statuses.length - 1)]] }; },
    async getBlockHeight() { return height; },
  };
}

test('polls a signed reward transaction until finalized', async () => {
  const rpc = connection({ statuses:[null, { confirmationStatus:'finalized', err:null }] });
  assert.equal(await finalizedSend(rpc, transfer(), [payer], { pollMs:1, timeoutMs:100 }), rpc.signature);
  assert.equal(rpc.submits, 1);
});

test('reconciles an ambiguous rate-limited submission without signing again', async () => {
  const rpc = connection({ submissionError:new Error('429 Too Many Requests') });
  assert.equal(await finalizedSend(rpc, transfer(), [payer], { pollMs:1, timeoutMs:100 }), rpc.signature);
  assert.equal(rpc.submits, 1);
});

test('reports a finalized transaction error', async () => {
  const rpc = connection({ statuses:[{ confirmationStatus:'finalized', err:{ InstructionError:[0, 'Custom'] } }] });
  await assert.rejects(finalizedSend(rpc, transfer(), [payer], { pollMs:1, timeoutMs:100 }), /Reward transaction failed/);
  assert.equal(rpc.submits, 1);
});

test('does not resubmit a transaction whose outcome is unknown after expiry', async () => {
  const rpc = connection({ submissionError:new Error('network timeout'), statuses:[null], height:101 });
  await assert.rejects(finalizedSend(rpc, transfer(), [payer], { pollMs:1, timeoutMs:100 }), /reconcile before retrying/);
  assert.equal(rpc.submits, 1);
});
