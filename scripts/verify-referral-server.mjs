import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { buildFeeDistributionPolicy } from '../distribution-policy.js';

const port = 18093;
const directory = await mkdtemp(join(tmpdir(), 'funded-referral-'));
const mint = Keypair.generate().publicKey.toBase58();
const inviter = Keypair.generate(); const creator = Keypair.generate();
await writeFile(join(directory, 'store.json'), JSON.stringify({
  version: 3,
  launches: { [mint]: { mint, creatorWallet: creator.publicKey.toBase58(), cluster: 'devnet', onchainVerified: true, feeDistribution: buildFeeDistributionPolicy({ creatorWalletPercent: 80, holderAirdropPercent: 0, solClaimPercent: 0 }) } },
  settlements: {}, obligations: {}, claims: {}, referralClaims: {}, payouts: {},
  collections: {
    'server-referral-test': { id: 'server-referral-test', signature: 'server-referral-test', mint, cluster: 'devnet', attribution: 'mint-verified', collectedLamports: 100_000_000_000, status: 'collected', recordedAt: new Date().toISOString() },
    'zero-fees': { id: 'zero-fees', signature: 'zero-fees', mint, cluster: 'devnet', attribution: 'mint-verified', collectedLamports: 0, status: 'no-fees', recordedAt: new Date().toISOString() },
  },
  referrals: { codes: {}, wallets: {}, attributions: {}, challenges: {} },
}));
const fixturePath = join(directory, 'store.json').replaceAll('\\', '/');
const server = spawn(process.execPath, ['server/index.mjs'], { cwd: process.cwd(), env: { ...process.env, NODE_ENV: 'test', PORT: String(port), FUNDED_STORE_PATH: fixturePath, FUNDED_API_TOKEN: 'referral-test-token', SOLANA_KEEPER_CONFIGURED: 'false' }, stdio: 'ignore' });
const base = `http://127.0.0.1:${port}`;
async function waitForServer() { for (let attempt = 0; attempt < 30; attempt += 1) { try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error('Referral API did not start.'); }
async function post(path, body) { const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer referral-test-token' }, body: JSON.stringify(body) }); const data = await response.json(); assert.equal(response.ok, true, `${path}: ${data.error || response.status}`); return data; }
try {
  await waitForServer();
  const initialState = await (await fetch(`${base}/api/state`)).json();
  assert.equal(initialState.collections.some(item => item.id === 'server-referral-test'), true, 'Keeper fixture collection was not loaded.');
  const keeperResponse = await fetch(`${base}/api/keeper/collect`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mint: '11111111111111111111111111111111' }) });
  assert.equal(keeperResponse.status, 401);
  const rejectedSettlement = await fetch(`${base}/api/settlements/claims`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer referral-test-token' }, body: JSON.stringify({ claimSignature: 'zero-fees', grossCreatorFees: 1_000_000 }) });
  assert.equal(rejectedSettlement.status, 400, 'No-fee collections must not create obligations.');
  const registration = await post('/api/referrals/registration/prepare', { wallet: inviter.publicKey.toBase58() });
  // web3 Keypair does not expose signMessage; use nacl-compatible signing through the secret key.
  const nacl = (await import('tweetnacl')).default;
  const signedRegistration = bs58.encode(nacl.sign.detached(new TextEncoder().encode(registration.statement), inviter.secretKey));
  const registered = await post('/api/referrals/registration/verify', { challengeId: registration.challengeId, wallet: inviter.publicKey.toBase58(), signature: signedRegistration });
  assert.match(registered.code, /^FND-[A-Z0-9]{12}$/);

  const attribution = await post('/api/referrals/attribution/prepare', { wallet: creator.publicKey.toBase58(), code: registered.code });
  const signedAttribution = bs58.encode(nacl.sign.detached(new TextEncoder().encode(attribution.statement), creator.secretKey));
  await post('/api/referrals/attribution/verify', { challengeId: attribution.challengeId, wallet: creator.publicKey.toBase58(), signature: signedAttribution });

  const settlement = await post('/api/settlements/claims', {
    claimSignature: 'server-referral-test', creatorWallet: inviter.publicKey.toBase58(), grossCreatorFees: 1_000_000,
    policy: { creatorWalletPercent: 0, holderAirdropPercent: 80, xPercent: 0 },
  });
  assert.equal(settlement.grossCreatorFees, 100);
  assert.equal(settlement.creatorWallet, creator.publicKey.toBase58());
  assert.equal(settlement.creatorDestinations.creatorWallet, 80);
  assert.equal(settlement.fundedApp.referralLevels[0].recipient, inviter.publicKey.toBase58());
  assert.equal(settlement.fundedApp.referralLevels[0].status, 'claimable');

  const claim = await post('/api/referral-claims/prepare', { settlementSignature: 'server-referral-test', recipientWallet: inviter.publicKey.toBase58(), level: 1 });
  assert.equal(claim.status, 'awaiting-wallet-signature');
  assert.equal(claim.recipientWallet, inviter.publicKey.toBase58());
  console.log('referral server checks passed');
} finally {
  server.kill();
  await rm(directory, { recursive: true, force: true });
}
