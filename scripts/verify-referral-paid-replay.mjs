import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import bs58 from 'bs58';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';

const argument = String(process.argv[2] || '').trim();
const configuredReferrer = String(process.env.SOLANA_DEVNET_REFERRER_SECRET_KEY || '').trim();
const liveMode = /^https?:\/\//i.test(argument) || (!argument && configuredReferrer);
let claim, payout, server = null, storePath = null, beforeHash = null;

async function readLiveClaims(base, wallet) {
  const response = await fetch(new URL(`/api/referral-claims?wallet=${encodeURIComponent(wallet)}`, base), { signal:AbortSignal.timeout(10_000) });
  assert.equal(response.ok, true, 'Live referral claims could not be read.');
  return response.json();
}

if (liveMode) {
  const base = new URL(argument || process.env.FUNDED_REFERRAL_REPLAY_BASE || 'http://127.0.0.1:8788');
  assert.ok(['http:', 'https:'].includes(base.protocol) && !base.username && !base.password, 'Use an HTTP origin without credentials.');
  const wallet = String(process.argv[3] || process.env.FUNDED_REFERRAL_REPLAY_WALLET || (configuredReferrer ? Keypair.fromSecretKey(bs58.decode(configuredReferrer)).publicKey.toBase58() : '')).trim();
  assert.doesNotThrow(() => new PublicKey(wallet), 'A valid paid-referral wallet is required for live replay verification.');
  const before = await readLiveClaims(base, wallet);
  claim = before.claims.find(item => item.status === 'paid');
  assert.ok(claim?.payoutSignature, 'The live wallet has no paid referral claim to replay.');
  const response = await fetch(new URL(`/api/referral-claims/${encodeURIComponent(claim.id)}/execute`, base), { method:'POST', headers:{ 'content-type':'application/json' }, body:'{}', signal:AbortSignal.timeout(10_000) });
  assert.equal(response.ok, true, 'Paid replay endpoint did not return the existing receipt.');
  payout = await response.json();
  assert.equal(payout.signature, claim.payoutSignature, 'Paid replay must return the original payout receipt.');
  assert.equal(payout.to, wallet);
  const after = await readLiveClaims(base, wallet);
  assert.deepEqual(after.claims.find(item => item.id === claim.id), claim, 'Paid replay must not mutate the claim.');
} else {
  const ledgerDirectory = resolve(argument);
  assert.notEqual(ledgerDirectory, resolve(''), 'Pass the isolated test-journey ledger directory, or configure a Devnet referrer wallet for live paid replay.');
  storePath = join(ledgerDirectory, 'funded-store.json');
  const before = await readFile(storePath);
  beforeHash = createHash('sha256').update(before).digest('hex');
  const state = JSON.parse(before);
  claim = Object.values(state.referralClaims || {}).find(item => item.status === 'paid');
  assert.ok(claim, 'The isolated ledger has no paid referral claim.');
  payout = state.payouts?.[claim.payoutId];
  assert.equal(payout?.status, 'paid');
  assert.equal(payout?.signature, claim.payoutSignature);
  assert.equal(payout?.to, claim.recipientWallet);

  const port = 18094;
  server = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV:'test', HOST:'127.0.0.1', PORT:String(port), FUNDED_STORE_PATH:storePath.replaceAll('\\','/'), DATABASE_URL:'', FUNDED_API_TOKEN:'paid-replay-test-token', SOLANA_KEEPER_CONFIGURED:'false', SOLANA_KEEPER_SECRET_KEY:'', SOLANA_KEEPER_KEYPAIR_PATH:'', FUNDED_ROUTER_AUTHORITY_SECRET_KEY:'', FUNDED_ROUTER_AUTHORITY_KEYPAIR_PATH:'', SOLANA_DEVNET_CREATOR_SECRET_KEY:'', SOLANA_ALLOW_KEEPER_TRANSFER:'false', DEVNET_TEST_MODE:'false' },
    stdio:'ignore',
  });
  const base = new URL(`http://127.0.0.1:${port}`);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { if ((await fetch(new URL('/api/health', base))).ok) break; } catch {}
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
    if (attempt === 39) throw new Error('Referral replay API did not start.');
  }
  const claimsResponse = await fetch(new URL(`/api/referral-claims?wallet=${encodeURIComponent(claim.recipientWallet)}`, base));
  assert.equal(claimsResponse.ok, true);
  const walletClaims = await claimsResponse.json();
  const listed = walletClaims.claims.find(item => item.id === claim.id);
  assert.equal(listed?.status, 'paid');
  assert.equal(listed?.payoutSignature, payout.signature);
  const replayResponse = await fetch(new URL(`/api/referral-claims/${encodeURIComponent(claim.id)}/execute`, base), { method:'POST', headers:{ 'content-type':'application/json' }, body:'{}' });
  assert.equal(replayResponse.ok, true);
  assert.equal((await replayResponse.json()).signature, payout.signature, 'Paid replay must return the original payout receipt.');
  const after = await readFile(storePath);
  assert.equal(createHash('sha256').update(after).digest('hex'), beforeHash, 'Paid replay must not mutate the ledger or create another payout.');
}

try {
  const connection = new Connection(process.env.SOLANA_DEVNET_RPC_URL || process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com', 'finalized');
  const status = (await connection.getSignatureStatuses([payout.signature], { searchTransactionHistory:true })).value[0];
  assert.equal(status?.err, null);
  assert.equal(status?.confirmationStatus, 'finalized');
  const transaction = await connection.getTransaction(payout.signature, { commitment:'finalized', maxSupportedTransactionVersion:0 });
  assert.ok(transaction?.meta, 'Finalized referral payout transaction is unavailable.');
  const message = transaction.transaction.message;
  const accountKeys = [...(message.staticAccountKeys || message.accountKeys || []), ...(transaction.meta.loadedAddresses?.writable || []), ...(transaction.meta.loadedAddresses?.readonly || [])].map(key => key.toBase58());
  const recipient = claim.recipientWallet || payout.to;
  const recipientIndex = accountKeys.indexOf(recipient);
  assert.ok(recipientIndex >= 0, 'Referral recipient is absent from the payout transaction.');
  const recipientDelta = transaction.meta.postBalances[recipientIndex] - transaction.meta.preBalances[recipientIndex];
  assert.equal(recipientDelta, Math.round(Number(payout.amountSol) * LAMPORTS_PER_SOL), 'Referral recipient balance delta does not match the stored payout.');
  console.log(`Referral paid replay: original receipt reused, state unchanged, finalized recipient delta ${recipientDelta} lamports (${liveMode ? 'live PostgreSQL API' : 'isolated file ledger'}).`);
} finally {
  server?.kill();
}
