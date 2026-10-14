import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Connection, PublicKey } from '@solana/web3.js';
import { DEVNET_GENESIS_HASH } from '../server/automatic-reward-chain.mjs';

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

const [identity, privateClaims, readiness, resolved, activity, experience] = await Promise.all([
  get('/api/x/me'),
  get('/api/x-fee/claims'),
  get('/api/x-fee/status'),
  get(`/api/x/resolve?handle=${encodeURIComponent(handle)}`),
  get(`/api/tokens/${mint}/fee-activity`),
  get(`/api/rewards/experience?wallet=${encodeURIComponent(wallet)}&mint=${encodeURIComponent(mint)}`),
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
const allocations = (activity.data.overview?.collections || []).filter(row =>
  BigInt(row.allocationPlan?.creatorDirected?.xLamports || 0) > 0n);
assert(allocations.length > 0, 'No V3 X reward allocation exists for this mint.');
for (const row of allocations) {
  assert.equal(row.allocationPlan.creatorDirected.xHandle.toLowerCase(), handle.toLowerCase());
  assert.equal(row.allocationPlan.creatorDirected.xUserId, String(resolved.data.id));
  assert.equal(row.settlement, 'finalized');
  assert.equal(row.creatorRewardFunding, 'finalized');
}
const allocated = allocations.reduce((sum, row) =>
  sum + BigInt(row.allocationPlan.creatorDirected.xLamports), 0n);
assert(allocated > 0n, 'No X reward has been allocated.');
assert.equal(experience.status, 200);
assert.equal(experience.data.cluster, 'devnet');
const token = experience.data.tokens?.find(row => row.mint === mint);
assert(token, 'The V3 reward experience does not include the selected mint.');
assert.equal(BigInt(token.totals.x), allocated, 'The public V3 allocation views disagree.');
const payouts = (experience.data.wallet?.rows || []).filter(row => row.mint === mint)
  .flatMap(row => row.payouts || []).filter(row => row.kind === 'x');
const paid = BigInt(token.xPaidLamports);
assert(paid <= allocated, 'Paid amount exceeds the allocated X reward.');
assert.equal(payouts.reduce((sum, row) => sum + BigInt(row.amountLamports), 0n), paid,
  'The supplied wallet does not account for all recorded V3 X payouts.');
const signatures = payouts.map(row => row.signature);
assert.equal(new Set(signatures).size, signatures.length, 'A V3 X payout signature was repeated.');
const rpcUrl = (await readFile(rpcFile, 'utf8')).trim();
const connection = new Connection(rpcUrl, 'finalized');
assert.equal(await connection.getGenesisHash(), DEVNET_GENESIS_HASH, 'The payout RPC is not Devnet.');
let verifiedPaid = 0n;
for (const payout of payouts) {
  const { signature } = payout;
  assert.equal(payout.feeSourceVerified, true);
  assert.equal(payout.source, 'finalized-v3-x-claim');
  const transaction = await connection.getParsedTransaction(signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
  assert(transaction && transaction.meta?.err === null, `Payout ${signature} is not finalized and successful.`);
  const index = transaction.transaction.message.accountKeys.findIndex(key => key.pubkey.toBase58() === wallet);
  assert(index >= 0, `Payout ${signature} did not include the target wallet.`);
  const delta = BigInt(transaction.meta.postBalances[index]) - BigInt(transaction.meta.preBalances[index]);
  assert.equal(delta, BigInt(payout.amountLamports),
    `Payout ${signature} did not increase the target wallet by the exact recorded amount.`);
  verifiedPaid += delta;
}
assert.equal(verifiedPaid, paid, 'Finalized target-wallet deltas do not match the confirmed X payout.');
console.log(JSON.stringify({ handle: resolved.data.handle, xUserId: resolved.data.id, wallet, mint,
  allocatedLamports: allocated.toString(), verifiedPaidLamports: verifiedPaid.toString(),
  remainingLamports: (allocated - paid).toString(), payoutSignatures: signatures,
  oauthConfigured: true, privateClaimsRequireSignIn: true, claimReadiness: 'ready' }, null, 2));
