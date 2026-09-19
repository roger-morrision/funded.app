import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const port = 18094;
const directory = await mkdtemp(join(tmpdir(), 'funded-stonk-features-'));
const file = join(directory, 'store.json');
await writeFile(file, JSON.stringify({ version: 3, launches: { 'feature-mint': { mint: 'feature-mint', chain: 'solana', cluster: 'devnet', onchainVerified: true, symbol: 'FTR', creatorWallet: 'creator-wallet', createdAt: new Date().toISOString(), graduated: true } }, settlements: {}, obligations: {}, claims: {}, referralClaims: {}, payouts: {}, collections: {}, launchReviews: {}, alerts: {}, xIntake: {}, referrals: { codes: {}, wallets: {}, attributions: {}, challenges: {} } }));
const server = spawn(process.execPath, ['server/index.mjs'], { cwd: process.cwd(), env: { ...process.env, NODE_ENV: 'test', PORT: String(port), FUNDED_STORE_PATH: file, FUNDED_API_TOKEN: 'stonk-test-token' }, stdio: 'ignore' });
const base = `http://127.0.0.1:${port}`;
async function waitForServer() { for (let attempt = 0; attempt < 40; attempt += 1) { try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error('Stonk feature API did not start.'); }
async function request(path, options = {}) { const response = await fetch(`${base}${path}`, { ...options, headers: { ...options.headers, authorization: 'Bearer stonk-test-token' } }); const data = await response.json(); assert.equal(response.ok, true, `${path}: ${data.error || response.status}`); return data; }
try {
  await waitForServer();
  const quotes = await request('/api/quote-assets'); assert.equal(quotes.assets.some(item => item.symbol === 'SOL' && item.status === 'verified'), true);
  const launches = await request('/api/launches'); assert.equal(launches[0].mint, 'feature-mint');
  const review = await request('/api/launch-reviews', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mint: 'feature-mint', creatorWallet: 'creator-wallet', symbol: 'FTR', quoteMint: quotes.assets[0].mint, quoteSymbol: 'SOL' }) }); assert.match(review.reviewHash, /^[a-f0-9]{64}$/);
  const profile = await request('/api/creators/creator-wallet'); assert.equal(profile.graduated, 1);
  const alert = await request('/api/alerts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet: 'viewer', mint: 'feature-mint', type: 'graduation' }) }); assert.equal(alert.status, 'active');
  const intake = await request('/api/x-intake', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle: '@funded', request: 'Launch a verified AI theme token' }) }); assert.equal(intake.status, 'queued-for-review');
  const signals = await request('/api/terminal/signals'); assert.equal(signals.items[0].riskLevel, 'watch');
  console.log('stonk feature checks passed');
} finally { server.kill(); await rm(directory, { recursive: true, force: true }); }
