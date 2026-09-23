import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';

const ledgerDirectory = resolve(process.argv[2] || '');
assert.notEqual(ledgerDirectory, resolve(''), 'Pass the isolated test-journey ledger directory.');
const storePath = join(ledgerDirectory, 'funded-store.json');
const before = await readFile(storePath);
const beforeHash = createHash('sha256').update(before).digest('hex');
const state = JSON.parse(before);
const claim = Object.values(state.referralClaims || {}).find(item => item.status === 'paid');
assert.ok(claim, 'The isolated ledger has no paid referral claim.');
const payout = state.payouts?.[claim.payoutId];
assert.equal(payout?.status, 'paid');
assert.equal(payout?.signature, claim.payoutSignature);
assert.equal(payout?.to, claim.recipientWallet);

const port = 18094;
const server = spawn(process.execPath, ['server/index.mjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: String(port),
    FUNDED_STORE_PATH: storePath.replaceAll('\\', '/'),
    DATABASE_URL: '',
    FUNDED_API_TOKEN: 'paid-replay-test-token',
    SOLANA_KEEPER_CONFIGURED: 'false',
    SOLANA_KEEPER_SECRET_KEY: '',
    SOLANA_KEEPER_KEYPAIR_PATH: '',
    FUNDED_ROUTER_AUTHORITY_SECRET_KEY: '',
    FUNDED_ROUTER_AUTHORITY_KEYPAIR_PATH: '',
    SOLANA_DEVNET_CREATOR_SECRET_KEY: '',
    SOLANA_ALLOW_KEEPER_TRANSFER: 'false',
    DEVNET_TEST_MODE: 'false',
  },
  stdio: 'ignore',
});
const base = `http://127.0.0.1:${port}`;

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {}
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  throw new Error('Referral replay API did not start.');
}

try {
  await waitForServer();
  const claimsResponse = await fetch(`${base}/api/referral-claims?wallet=${encodeURIComponent(claim.recipientWallet)}`);
  assert.equal(claimsResponse.ok, true);
  const walletClaims = await claimsResponse.json();
  const listed = walletClaims.claims.find(item => item.id === claim.id);
  assert.equal(listed?.status, 'paid');
  assert.equal(listed?.payoutSignature, payout.signature);

  const replayResponse = await fetch(`${base}/api/referral-claims/${encodeURIComponent(claim.id)}/execute`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(replayResponse.ok, true);
  const replay = await replayResponse.json();
  assert.equal(replay.signature, payout.signature, 'Paid replay must return the original payout receipt.');

  const after = await readFile(storePath);
  const afterHash = createHash('sha256').update(after).digest('hex');
  assert.equal(afterHash, beforeHash, 'Paid replay must not mutate the ledger or create another payout.');

  const connection = new Connection(process.env.SOLANA_DEVNET_RPC_URL || process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com', 'finalized');
  const status = (await connection.getSignatureStatuses([payout.signature], { searchTransactionHistory: true })).value[0];
  assert.equal(status?.err, null);
  assert.equal(status?.confirmationStatus, 'finalized');
  const transaction = await connection.getTransaction(payout.signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
  assert.ok(transaction?.meta, 'Finalized referral payout transaction is unavailable.');
  const message = transaction.transaction.message;
  const accountKeys = [
    ...(message.staticAccountKeys || message.accountKeys || []),
    ...(transaction.meta.loadedAddresses?.writable || []),
    ...(transaction.meta.loadedAddresses?.readonly || []),
  ].map(key => key.toBase58());
  const recipientIndex = accountKeys.indexOf(claim.recipientWallet);
  assert.ok(recipientIndex >= 0, 'Referral recipient is absent from the payout transaction.');
  const recipientDelta = transaction.meta.postBalances[recipientIndex] - transaction.meta.preBalances[recipientIndex];
  const expectedLamports = Math.round(Number(payout.amountSol) * LAMPORTS_PER_SOL);
  assert.equal(recipientDelta, expectedLamports, 'Referral recipient balance delta does not match the stored payout.');

  console.log(`Referral paid replay: original receipt reused, ledger unchanged, finalized recipient delta ${recipientDelta} lamports.`);
} finally {
  server.kill();
}
