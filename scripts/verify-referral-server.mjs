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
const server = spawn(process.execPath, ['server/index.mjs'], { cwd: process.cwd(), env: { ...process.env, FUNDED_SKIP_LOCAL_ENV:'true', NODE_ENV: 'test', PORT: String(port), HOST:'127.0.0.1', FUNDED_STORE_PATH: fixturePath, DATABASE_URL:'', FUNDED_API_TOKEN: 'referral-test-token', DEV_MODE:'false', SOLANA_KEEPER_CONFIGURED: 'false', SOLANA_KEEPER_SECRET_KEY:'', SOLANA_KEEPER_KEYPAIR_PATH:'', FUNDED_ROUTER_AUTHORITY_SECRET_KEY:'', FUNDED_ROUTER_AUTHORITY_KEYPAIR_PATH:'', SOLANA_DEVNET_CREATOR_SECRET_KEY:'', SOLANA_DEVNET_REFERRER_SECRET_KEY:'', SOLANA_DEVNET_CLAIMANT_SECRET_KEY:'', SOLANA_ALLOW_KEEPER_TRANSFER:'false', DEVNET_TEST_MODE:'false' }, stdio: 'ignore' });
const base = `http://127.0.0.1:${port}`;
async function waitForServer() { for (let attempt = 0; attempt < 30; attempt += 1) { try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error('Referral API did not start.'); }
async function post(path, body) { const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer referral-test-token' }, body: JSON.stringify(body) }); const data = await response.json(); assert.equal(response.ok, true, `${path}: ${data.error || response.status}`); return data; }
try {
  await waitForServer();
  const initialState = await (await fetch(`${base}/api/state`)).json();
  assert.equal(initialState.collections.some(item => item.id === 'server-referral-test'), true, 'Keeper fixture collection was not loaded.');
  assert.equal(Object.hasOwn(initialState,'referralClaims'),false,'Public state must not expose referral claim metadata.');
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
  const signedClaim=bs58.encode(nacl.sign.detached(new TextEncoder().encode(claim.statement),inviter.secretKey));
  const verified=await post(`/api/referral-claims/${claim.id}/verify`,{publicKey:inviter.publicKey.toBase58(),signature:signedClaim});
  assert.equal(verified.status,'wallet-verified');
  assert.equal((await fetch(`${base}/api/referral-claims?wallet=${inviter.publicKey.toBase58()}`)).status,401);
  assert.equal((await fetch(`${base}/api/referral-claims/${claim.id}/execute`,{method:'POST',headers:{origin:base,'content-type':'application/json'},body:'{}'})).status,403);
  const sessionPrepareResponse=await fetch(`${base}/api/referrals/session/prepare`,{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({wallet:inviter.publicKey.toBase58()})});
  assert.equal(sessionPrepareResponse.status,200);const sessionPrepare=await sessionPrepareResponse.json();
  const sessionSignature=bs58.encode(nacl.sign.detached(new TextEncoder().encode(sessionPrepare.statement),inviter.secretKey));
  const sessionResponse=await fetch(`${base}/api/referrals/session/verify`,{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({challengeId:sessionPrepare.challengeId,wallet:inviter.publicKey.toBase58(),signature:sessionSignature})});
  assert.equal(sessionResponse.status,200);const cookie=sessionResponse.headers.getSetCookie().find(row=>row.startsWith('funded_referral_session=')).split(';')[0];
  const disabled=await fetch(`${base}/api/referral-claims/${claim.id}/execute`,{method:'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:'{}'});
  assert.equal(disabled.status,503);
  const after=await (await fetch(`${base}/api/referral-claims?wallet=${inviter.publicKey.toBase58()}`,{headers:{cookie}})).json();
  assert.equal(after.claims.find(row=>row.id===claim.id).status,'wallet-verified','Disabled keeper must not strand a verified claim.');
  console.log('Referral HTTP: scoped signature verification and disabled-execution preservation passed with ephemeral keys, no transfer.');
} finally {
  server.kill();
  await rm(directory, { recursive: true, force: true });
}
