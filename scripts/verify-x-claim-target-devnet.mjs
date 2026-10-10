import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Connection, PublicKey } from '@solana/web3.js';

// Read-only check for a real X claim target. OAuth and wallet signing remain user controlled.
const handle = String(process.env.X_TEST_HANDLE || '').trim();
const wallet = new PublicKey(String(process.env.X_TEST_WALLET || '')).toBase58();
const mint = new PublicKey(String(process.env.X_TEST_MINT || '')).toBase58();
const rpcFile = String(process.env.X_TEST_RPC_URL_FILE || '').trim();
const origin = String(process.env.X_TEST_APP_ORIGIN || 'https://funded.vip').replace(/\/$/, '');
assert.match(handle, /^@[A-Za-z0-9_]{1,15}$/, 'Set X_TEST_HANDLE to a valid X handle.');
assert(rpcFile, 'Set X_TEST_RPC_URL_FILE to a local Devnet RPC URL file.');
assert.equal(new URL(origin).protocol, 'https:', 'Use the HTTPS Devnet app.');

async function get(path) {
  const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(15000), cache: 'no-store' });
  return { status: response.status, data: await response.json() };
}

const [identity, privateClaims, readiness, resolved, activity] = await Promise.all([
  get('/api/x/me'),
  get('/api/x-fee/claims'),
  get('/api/x-fee/status'),
  get(`/api/x/resolve?handle=${encodeURIComponent(handle)}`),
  get(`/api/tokens/${mint}/fee-activity`),
]);
assert.equal(identity.status, 200);
assert.equal(identity.data.configured, true, 'X OAuth must be configured.');
assert.equal(identity.data.authenticated, false, 'This probe must not use a user X session.');
assert.equal(privateClaims.status, 401, 'Private claims must require X sign-in.');
assert.equal(readiness.status, 200);
assert.equal(readiness.data.ready, true, `X claim readiness failed: ${JSON.stringify(readiness.data.reasons)}`);
assert.equal(resolved.status, 200);
assert.equal(resolved.data.handle.toLowerCase(), handle.toLowerCase());
assert.match(String(resolved.data.id), /^\d+$/);
assert.equal(activity.status, 200);
assert.equal(activity.data.cluster, 'devnet', 'Only Devnet rewards may be checked here.');
const xReward = activity.data.overview?.receivers?.find(row => row.id === 'x');
assert(xReward, 'No X reward allocation exists for this mint.');
assert.equal(xReward.recipient.toLowerCase(), handle.toLowerCase());
const allocated = BigInt(xReward.allocatedLamports);
const paid = BigInt(xReward.confirmedPaidLamports);
assert(allocated > 0n, 'No X reward has been allocated.');
assert(paid <= allocated, 'Paid amount exceeds the allocated X reward.');
const signatures = xReward.payoutSignatures || [];
const rpcUrl = (await readFile(rpcFile, 'utf8')).trim();
const connection = new Connection(rpcUrl, 'finalized');
let verifiedPaid = 0n;
for (const signature of signatures) {
  const transaction = await connection.getParsedTransaction(signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
  assert(transaction && transaction.meta?.err === null, `Payout ${signature} is not finalized and successful.`);
  const index = transaction.transaction.message.accountKeys.findIndex(key => key.pubkey.toBase58() === wallet);
  assert(index >= 0, `Payout ${signature} did not include the target wallet.`);
  const delta = BigInt(transaction.meta.postBalances[index]) - BigInt(transaction.meta.preBalances[index]);
  assert(delta > 0n, `Payout ${signature} did not increase the target wallet balance.`);
  verifiedPaid += delta;
}
assert.equal(verifiedPaid, paid, 'Finalized target-wallet deltas do not match the confirmed X payout.');
console.log(JSON.stringify({ handle: resolved.data.handle, xUserId: resolved.data.id, wallet, mint,
  allocatedLamports: allocated.toString(), verifiedPaidLamports: verifiedPaid.toString(),
  remainingLamports: (allocated - paid).toString(), payoutSignatures: signatures,
  oauthConfigured: true, privateClaimsRequireSignIn: true, claimReadiness: 'ready' }, null, 2));
