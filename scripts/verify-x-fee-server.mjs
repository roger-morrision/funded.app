import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { buildFeeDistributionPolicy } from '../distribution-policy.js';
import { launchPolicyStatement } from '../launch-policy-auth.js';
import { deriveXFeeObligation } from '../server/x-fee-guard.mjs';

const mint = 'XMYT6KrfdwFyW3Fcabjj9Z82yEoHYyQscYcTs7YWSr5';
const transaction = '4bz6vBafFbHSwwnJRTd5Ju9QB9mQvFTsqkhDVHjhXZcQZGfnyqh1UDEW2uWqzRYMeTqUdcJXmbLDUyn3fk5FFoKr';
const payer = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_DEVNET_CREATOR_SECRET_KEY || ''));
const router = 'C9ULKtSDWJQqniEKQSgQ5AJLKrmJo9n1FSmQaMtyR7fR';
const basePolicy = {
  chain: 'solana', cluster: 'devnet', mint, signature: transaction,
  creatorWallet: payer.publicKey.toBase58(), communityAllocation: 50,
  pumpFeeRoute: { router, transaction },
  feeDistribution: buildFeeDistributionPolicy({ creatorWalletPercent: 70, holderAirdropPercent: 10, solClaimPercent: 0, xRecipient: '', feeRouterAddress: router }),
};
function signed(policy) {
  return { ...policy, policySignature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(launchPolicyStatement(policy)), payer.secretKey)) };
}
const directory = await mkdtemp(join(tmpdir(), 'funded-x-fee-'));
const port = 18096;
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server/index.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), FUNDED_STORE_PATH: join(directory, 'store.json'), FUNDED_API_TOKEN: 'x-fee-test-token', FUNDED_MINT_FEE_ROUTER_ENABLED: 'false' },
  stdio: 'ignore',
});
async function request(path, body, authorized = false) {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(authorized ? { authorization: 'Bearer x-fee-test-token' } : {}) }, body: JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
}
async function ready() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('X fee test API did not start.');
}
try {
  await ready();
  const xStatus = await fetch(`${base}/api/x-fee/status`).then(response => response.json());
  assert.equal(xStatus.ready, false);
  assert.ok(xStatus.reasons.some(reason => reason.includes('mint router upgrade')));
  const anonymousClaims = await fetch(`${base}/api/x-fee/claims`);
  assert.equal(anonymousClaims.status, 401);
  const unsupportedXPolicy = { ...basePolicy, xUserId: '123456789', pumpFeeRoute:{ ...basePolicy.pumpFeeRoute, scope:'per-mint-v2' }, feeDistribution: buildFeeDistributionPolicy({ creatorWalletPercent: 60, holderAirdropPercent: 10, solClaimPercent: 10, xRecipient: '@fundedqa', feeRouterAddress: router }) };
  const unsupportedX = await request('/api/launches', signed(unsupportedXPolicy));
  assert.equal(unsupportedX.status, 503, 'An X share cannot be registered without the deployed mint-specific router and keeper.');
  const created = await request('/api/launches', signed(basePolicy));
  const liveProofAvailable = created.status === 201;
  if (liveProofAvailable) {
    assert.equal(created.data.creatorWallet, payer.publicKey.toBase58());
    assert.equal(created.data.pumpFeeRoute.scope, 'shared-legacy');
    assert.equal(created.data.solClaim.forwardingStatus, 'not-selected');
    const repeat = await request('/api/launches', signed(basePolicy));
    assert.equal(repeat.status, 201);
    assert.equal(repeat.data.id, created.data.id);
    const tampered = await request('/api/launches', { ...basePolicy, communityAllocation: 3, policySignature: created.data.policySignature });
    assert.equal(tampered.status, 401);
    const changed = await request('/api/launches', signed({ ...basePolicy, communityAllocation: 3 }));
    assert.equal(changed.status, 400);
  } else {
    assert.match(String(created.data.error || ''), /fetch failed|network|RPC|rate limit|unavailable|does not match the signed router policy|mint-specific fee router/i, 'Unexpected launch registration failure.');
  }
  const arbitrary = await request('/api/payout-obligations/sol', { claimSignature: transaction, amountSol: 1, recipient: '@fundedqa' }, true);
  assert.equal(arbitrary.status, 410);
  const unauthorized = await request('/api/x-fee/obligations', { mint, claimSignature: transaction });
  assert.equal(unauthorized.status, 401);
  const shared = await request('/api/x-fee/obligations', { mint, claimSignature: transaction }, true);
  assert.equal(shared.status, 400);
  const noObligation = await request('/api/sol-claims/no-obligation/prepare', { xHandle: '@fundedqa' });
  assert.equal(noObligation.status, 401);
  const noPublicExecute = await request('/api/sol-claims/no-obligation/execute', {});
  assert.equal(noPublicExecute.status, 404);

  const isolatedRouter = Keypair.generate().publicKey.toBase58();
  const verifiedFixture = {
    launches: { [mint]: { ...(liveProofAvailable ? created.data : { ...basePolicy, onchainVerified: true }), creator: isolatedRouter, xUserId: '123456789', feeDistribution: buildFeeDistributionPolicy({ creatorWalletPercent: 60, holderAirdropPercent: 10, solClaimPercent: 10, xRecipient: '@fundedqa', feeRouterAddress: isolatedRouter }), pumpFeeRoute: { router: isolatedRouter, scope: 'per-mint-v2', verified: true } } },
    collections: { [transaction]: { status: 'collected', mint, router: isolatedRouter, attribution: 'mint-verified', onchainVerified: true, collectedLamports: 123_456_789 } },
  };
  const obligation = deriveXFeeObligation(verifiedFixture, { mint, claimSignature: transaction });
  assert.equal(obligation.amountLamports, '12345678');
  assert.equal(obligation.recipient, '@fundedqa');
  assert.equal(obligation.xUserId, '123456789');
  assert.throws(() => deriveXFeeObligation({ ...verifiedFixture, launches: { [mint]: { ...verifiedFixture.launches[mint], xUserId: '' } } }, { mint, claimSignature: transaction }), /stable X user ID/);
  assert.throws(() => deriveXFeeObligation({ ...verifiedFixture, collections: {} }, { mint, claimSignature: transaction }), /collection/);
  console.log(JSON.stringify({ result: 'x-fee server checks passed', evidence: liveProofAvailable ? 'Devnet registration and local X guard' : 'local-only guard; per-mint router intentionally disabled in fixture', verifiedLaunchMint: liveProofAvailable ? mint : null, xShareBps: obligation.shareBps, sharedRouterPayoutBlocked: true }));
} finally {
  server.kill();
  await rm(directory, { recursive: true, force: true });
}
