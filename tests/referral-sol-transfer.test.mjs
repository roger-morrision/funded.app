import test from 'node:test';
import assert from 'node:assert/strict';
import { Connection, Keypair } from '@solana/web3.js';
import { sendFinalizedSolPayout, reconcileFinalizedSolPayout, solToLamports } from '../server/referral-sol-transfer.mjs';

test('SOL amounts convert to exact lamports', () => {
  assert.equal(solToLamports(0.000000015), 15);
  assert.equal(solToLamports(0.000170011), 170011);
  for (const amount of [0, -1, NaN, Infinity, 0.0000000005]) {
    assert.throws(() => solToLamports(amount), /positive SOL/);
  }
});

test('signed payout is journaled before one broadcast, including an ambiguous send', async () => {
  const payer = Keypair.generate(), recipient = Keypair.generate().publicKey, events = [];
  const connection = {
    getAccountInfo: async () => ({ lamports: 1 }),
    getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 }),
    sendRawTransaction: async () => { events.push('send'); throw Error('RPC response timed out'); },
    getSignatureStatuses: async () => ({ value: [{ confirmationStatus: 'finalized', err: null }] }),
    getTransaction: async () => ({ transaction: { message: { accountKeys: [payer.publicKey, recipient] } },
      meta: { err: null, preBalances: [1_000_000, 100], postBalances: [999_000, 115] } }),
  };
  const result = await sendFinalizedSolPayout({ connection, payer, recipient, lamports: 15,
    onSigned: async ({ signature }) => { assert(signature); events.push('journal'); } });
  assert.deepEqual(events, ['journal', 'send']);
  assert.equal(result.recipientDeltaLamports, 15);
  assert.equal(result.finalized, true);
});

test('uncertain finality keeps its signed signature and never retries broadcast', async () => {
  const payer = Keypair.generate(), recipient = Keypair.generate().publicKey;
  let sends = 0, journaled;
  const connection = {
    getAccountInfo: async () => ({ lamports: 1 }),
    getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 }),
    sendRawTransaction: async () => { sends++; return journaled; },
    getSignatureStatuses: async () => ({ value: [null] }),
    getBlockHeight: async () => 1,
  };
  await assert.rejects(sendFinalizedSolPayout({ connection, payer, recipient, lamports: 15, maxPolls: 1,
    onSigned: async ({ signature }) => { journaled = signature; } }), error => error.pendingSignature === journaled);
  assert.equal(sends, 1);
});

test('new wallet below rent minimum fails before signing or broadcast', async () => {
  const payer = Keypair.generate(), recipient = Keypair.generate().publicKey;
  let signed = 0, sent = 0;
  const connection = {
    getAccountInfo: async () => null,
    getMinimumBalanceForRentExemption: async () => 890_880,
    getLatestBlockhash: async () => { signed++; throw Error('Must not sign'); },
    sendRawTransaction: async () => { sent++; throw Error('Must not broadcast'); },
  };
  await assert.rejects(sendFinalizedSolPayout({ connection, payer, recipient, lamports: 170_011 }),
    error => error.safeToRetry === true && /Fund the recipient wallet/.test(error.message));
  assert.equal(signed, 0);
  assert.equal(sent, 0);
});

test('local validator pays a disposable referral wallet exactly once', { skip: !process.env.LOCAL_SOLANA_RPC_URL },
  async () => {
    const connection = new Connection(process.env.LOCAL_SOLANA_RPC_URL, 'confirmed');
    const payer = Keypair.generate(), recipient = Keypair.generate().publicKey;
    const funding = await connection.requestAirdrop(payer.publicKey, 1_000_000_000);
    for (let attempt = 0; attempt < 80 && await connection.getBalance(payer.publicKey, 'finalized') === 0; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.equal(await connection.getBalance(payer.publicKey, 'finalized'), 1_000_000_000, funding);
    let journaled;
    const result = await sendFinalizedSolPayout({ connection, payer, recipient, lamports: 10_000_000,
      onSigned: async proof => { journaled = proof.signature; } });
    assert.equal(result.signature, journaled);
    assert.equal(result.recipientDeltaLamports, 10_000_000);
    assert.equal(await connection.getBalance(recipient, 'finalized'), 10_000_000);
    const reconciled = await reconcileFinalizedSolPayout({ connection, payer, recipient,
      lamports: 10_000_000, signature: journaled });
    assert.equal(reconciled.signature, journaled);
    assert.equal(reconciled.recipientDeltaLamports, 10_000_000);
  });

