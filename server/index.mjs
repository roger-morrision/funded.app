import { createServer } from 'node:http';
import { randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { isIP } from 'node:net';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, clusterApiUrl, sendAndConfirmTransaction } from '@solana/web3.js';
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { buildSolClaimPolicy } from '../sol-claim-policy.js';
import { buildFeeDistributionPolicy, settleCreatorFeeClaim } from '../distribution-policy.js';
import { buildCommunityAirdropPolicy } from '../airdrop-policy.js';
import { canonicalLaunchPolicy, launchPolicyStatement } from '../launch-policy-auth.js';
import { createReferralCode, normalizeReferralCode, resolveReferralUpline } from '../referral-program.js';
import { deriveFeeRouter, deriveMintFeeRouter, verifyFeeRouterAccount, verifyMintFeeRouterAccount } from '../fee-router.js';
import { OnlinePumpSdk } from '@pump-fun/pump-sdk';
import { createStore } from './store.mjs';
import { readPumpMarketActivity } from './coin-market.mjs';
import { sortDevnetLaunches } from './explore-registry.mjs';
import { isAppPagePath } from './page-routes.mjs';
import { verifyCollectionReceipt, verifyPayoutReceipt } from './receipt-evidence.mjs';
import { buildRewardCycle, validateRewardConfig } from '../reward-policy.js';
import { analyzeLaunchActivity } from '../anti-sniper-policy.js';
import { buildProductionReadiness } from '../production-readiness.js';
import { buildTerminalSignal, creatorReputation, immutableLaunchReview, normalizeXIntake, quoteAssetCatalog } from '../stonk-features.js';
import { verifyPumpLaunch } from './launch-verification.mjs';
import { createLaunchBurnTiers } from '../launch-burn-policy.js';
import { deriveXFeeObligation } from './x-fee-guard.mjs';
import { buildMintRouterSettlementInstruction, readMintClaimRecord } from './mint-router-payout.mjs';
import { parseSignedMetadata, publicMetadata } from './devnet-metadata.mjs';
import { devnetMetadataUri, devnetImageUri } from '../devnet-metadata.js';

function loadLocalEnv() {
  try {
    const contents = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || match[1].startsWith('#')) continue;
      const value = match[2].replace(/^['"]|['"]$/g, '');
      if (process.env[match[1]] == null) process.env[match[1]] = value;
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
loadLocalEnv();

const port = Number(process.env.PORT || 8787);
const host = String(process.env.HOST || '127.0.0.1');
const staticRoot = resolve(process.cwd(), 'dist');
const storePath = process.env.FUNDED_STORE_PATH || resolve(process.cwd(), 'data', 'funded-store.json');
// Explicit test/worker store paths must take precedence over the local database
// profile so isolated fixtures cannot accidentally write to the shared database.
const databaseUrl = process.env.FUNDED_STORE_PATH ? '' : process.env.DATABASE_URL;
if (process.env.NODE_ENV === 'production' && !databaseUrl) throw new Error('DATABASE_URL is required in production.');
if (process.env.NODE_ENV === 'production' && !String(process.env.FUNDED_API_TOKEN || '').trim()) throw new Error('FUNDED_API_TOKEN is required in production.');
const store = createStore(storePath, databaseUrl);
const maxBodyBytes = 1_000_000;
const birdeyeApiKey = String(process.env.BIRDEYE_API_KEY || '').trim();
const birdeyeBaseUrl = String(process.env.BIRDEYE_API_URL || 'https://public-api.birdeye.so').replace(/\/$/, '');
const birdeyeChain = String(process.env.BIRDEYE_CHAIN || 'solana').trim();
const birdeyeTimeoutMs = 10_000;
const pumpApiUrl = String(process.env.PUMP_API_URL || 'https://frontend-api-v3.pump.fun').replace(/\/$/, '');
const solanaRpcUrl = String(process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com').trim();
const rpcMethods = new Set(['getAccountInfo', 'getMultipleAccounts', 'getBalance', 'getSlot', 'getTokenSupply', 'getTokenLargestAccounts', 'getTokenAccountsByOwner', 'getTokenAccountBalance', 'getSignaturesForAddress', 'getTransaction', 'getLatestBlockhash', 'getBlockHeight', 'getSignatureStatuses', 'getFeeForMessage', 'getMinimumBalanceForRentExemption', 'getRecentPrioritizationFees', 'simulateTransaction', 'sendTransaction']);
const rpcCache = new Map();
let receiptEvidenceCache = { expiresAt: 0, value: null };
let receiptEvidencePending = null;
let rpcInflight = 0;
const publicPostPaths = new Set(['/api/rewards/preview', '/api/anti-sniper/analyze', '/api/referrals/registration/prepare', '/api/referrals/registration/verify', '/api/referrals/attribution/prepare', '/api/referrals/attribution/verify', '/api/launches', '/api/devnet-metadata']);
let verifiedQuoteAssetsCache = null;
const solanaCluster = String(process.env.VITE_SOLANA_CLUSTER || process.env.SOLANA_CLUSTER || 'devnet').trim();
const devnetTestMode = solanaCluster === 'devnet' && process.env.DEVNET_TEST_MODE === 'true';
const devMode = process.env.NODE_ENV !== 'production' && solanaCluster === 'devnet' && String(process.env.DEV_MODE || '').toLowerCase() === 'true';
const devWalletRoles = { creator: 'SOLANA_DEVNET_CREATOR_SECRET_KEY', referrer: 'SOLANA_DEVNET_REFERRER_SECRET_KEY', claimant: 'SOLANA_DEVNET_CLAIMANT_SECRET_KEY' };
function devWalletKeypair() {
  if (!devMode) return null;
  const role = String(process.env.DEV_WALLET_ROLE || 'creator').trim().toLowerCase();
  const encoded = String(process.env[devWalletRoles[role]] || '').trim();
  if (!encoded) return null;
  try { return { role, keypair: Keypair.fromSecretKey(bs58.decode(encoded)) }; } catch { return null; }
}
if (process.env.RPC_ALLOW_EXPENSIVE_METHODS === 'true') rpcMethods.add('getProgramAccounts');
if (devnetTestMode && process.env.RPC_ALLOW_AIRDROP === 'true') rpcMethods.add('requestAirdrop');
const xAttestationSecret = String(process.env.X_ATTESTATION_SECRET || '').trim();
const xAuthRequests = new Map();
const xSessions = new Map();
const referralClaimExpiryMs = 14 * 24 * 60 * 60 * 1000;
const maxReferralPayoutSol = Number(process.env.MAX_REFERRAL_PAYOUT_SOL || 10);
const coinMarketCache = new Map();
const coinMarketInflight = new Map();
let coinMarketActive = 0;
let devnetVerificationActive = 0;
let solUsdQuoteCache = { priceUsd: null, fetchedAt: null, expiresAt: 0 };
let configuredQuoteAssets = [];
try { configuredQuoteAssets = JSON.parse(process.env.FUNDED_QUOTE_ASSETS_JSON || '[]'); } catch { configuredQuoteAssets = []; }

function json(res, status, body) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': process.env.CORS_ORIGIN || '*' }); res.end(JSON.stringify(body)); }
async function readSolUsdQuote() {
  const configured = Number(process.env.SOL_USD_PRICE || process.env.SOLANA_USD_PRICE);
  if (Number.isFinite(configured) && configured > 0) return { priceUsd: configured, source: 'server-config', fetchedAt: new Date().toISOString() };
  if (solUsdQuoteCache.expiresAt > Date.now() && Number.isFinite(solUsdQuoteCache.priceUsd)) return { priceUsd: solUsdQuoteCache.priceUsd, source: 'coingecko', fetchedAt: solUsdQuoteCache.fetchedAt };
  try {
    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
    const data = await response.json().catch(() => ({}));
    const priceUsd = Number(data?.solana?.usd);
    if (!response.ok || !Number.isFinite(priceUsd) || priceUsd <= 0) return null;
    solUsdQuoteCache = { priceUsd, fetchedAt: new Date().toISOString(), expiresAt: Date.now() + 60_000 };
    return { priceUsd, source: 'coingecko', fetchedAt: solUsdQuoteCache.fetchedAt };
  } catch { return null; }
}
async function serveStatic(pathname, res) {
  const fileName = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filePath = resolve(staticRoot, fileName);
  if (!filePath.startsWith(`${staticRoot}${sep}`)) return json(res, 404, { error: 'Not found.' });
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
  try {
    const content = await readFile(filePath);
    res.writeHead(200, { 'content-type': mime[extname(filePath)] || 'application/octet-stream', 'cache-control': fileName === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' });
    return res.end(content);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') return json(res, 404, { error: 'Not found.' });
    throw error;
  }
}
function id(prefix) { return `${prefix}_${Date.now()}_${randomBytes(8).toString('hex')}`; }
function clientKey(req) {
  const remote = req.socket.remoteAddress || 'local';
  // Enable only when a trusted edge overwrites this header and direct public
  // access to the API is blocked (as in the bundled tunnel deployment).
  if (process.env.TRUST_PROXY === 'true') {
    const forwarded = String(req.headers['cf-connecting-ip'] || '').trim();
    if (isIP(forwarded)) return forwarded;
  }
  return remote;
}
async function body(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBodyBytes) throw Object.assign(new Error('Request body too large.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  return bytes ? JSON.parse(Buffer.concat(chunks, bytes).toString('utf8')) : {};
}
function route(path, method, pattern) { const match = path.match(pattern); return match && match[1] && method ? match[1] : null; }
async function proxySolanaRpc(req, res) {
  const origin = String(req.headers.origin || '');
  if (origin) {
    let allowed = false;
    try { allowed = ['localhost', '127.0.0.1'].includes(new URL(origin).hostname) || origin === process.env.CORS_ORIGIN; } catch {}
    if (!allowed) return json(res, 403, { error: 'RPC origin is not allowed.' });
  }
  const request = await body(req);
  if (!request || request.jsonrpc !== '2.0' || !rpcMethods.has(request.method) || !Array.isArray(request.params)) return json(res, 400, { jsonrpc: '2.0', id: request?.id ?? null, error: { code: -32600, message: 'Unsupported Solana RPC request.' } });
  if (request.method === 'getProgramAccounts' && !authorized(req)) return json(res, 401, { error: 'Privileged Solana RPC authorization is required.' });
  const now = Date.now();
  if (['sendTransaction', 'simulateTransaction'].includes(request.method) && (typeof request.params[0] !== 'string' || request.params[0].length > 3_000)) return json(res, 400, { error: 'Invalid serialized transaction.' });
  if (request.method === 'getSignaturesForAddress' && Number(request.params[1]?.limit || 100) > 100) return json(res, 400, { error: 'Signature lookup limit exceeds 100.' });
  const cacheable = !['sendTransaction', 'simulateTransaction', 'requestAirdrop'].includes(request.method);
  const cacheKey = cacheable ? JSON.stringify([request.method, request.params]) : null;
  const cached = cacheKey && rpcCache.get(cacheKey);
  const client = clientKey(req);
  const windowStart = Math.floor(now / 60_000) * 60_000;
  const cost = cached?.expiresAt > now ? 1 : ({ getProgramAccounts: 20, sendTransaction: 10, simulateTransaction: 8, getTransaction: 3, getSignaturesForAddress: 3, requestAirdrop: 20 }[request.method] || 1);
  // Keep a small, bounded read budget for an explicit user quote preview so
  // background discovery cannot starve its on-chain account checks.
  const previewRead = new URL(req.url, 'http://localhost').searchParams.get('purpose') === 'trade-preview'
    && ['getAccountInfo', 'getMultipleAccounts', 'getBalance', 'getTokenAccountsByOwner', 'getTokenAccountBalance', 'getMinimumBalanceForRentExemption'].includes(request.method);
  const rateKey = previewRead ? `rpc-preview:${client}` : `rpc:${client}`;
  const rateLimit = previewRead ? 40 : 120;
  if (!await store.chargeRpcRate(rateKey, cost, rateLimit, windowStart)
    || (['sendTransaction', 'requestAirdrop'].includes(request.method) && !await store.chargeRpcRate(`rpc-write:${client}`, 1, 10, windowStart))) return json(res, 429, { jsonrpc: '2.0', id: request.id, error: { code: 429, message: 'Solana RPC limit reached; retry shortly.' } });
  if (cached?.expiresAt > now) return json(res, 200, { ...cached.data, id: request.id });
  if (rpcInflight >= 12) return json(res, 429, { jsonrpc: '2.0', id: request.id, error: { code: 429, message: 'Solana RPC is busy; retry shortly.' } });
  rpcInflight += 1;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const upstream = await fetch(solanaRpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request), signal: controller.signal });
    const result = await upstream.json().catch(() => null);
    if (!result || typeof result !== 'object') return json(res, 502, { jsonrpc: '2.0', id: request.id, error: { code: -32000, message: 'Solana RPC returned an invalid response.' } });
    if (cacheKey && upstream.ok && !result.error) {
      if (rpcCache.size > 500) rpcCache.clear();
      rpcCache.set(cacheKey, { data: result, expiresAt: Date.now() + (request.method === 'getTransaction' ? 30_000 : request.method === 'getLatestBlockhash' ? 1_000 : 5_000) });
    }
    return json(res, upstream.status, result);
  } catch { return json(res, 502, { jsonrpc: '2.0', id: request.id, error: { code: -32000, message: 'Solana RPC is unavailable.' } }); }
  finally { clearTimeout(timeout); rpcInflight -= 1; }
}
function publicState(state) {
  return {
    version: state.version,
    launches: Object.values(state.launches),
    settlements: Object.values(state.settlements).map(item => ({ claimSignature: item.claimSignature, claimedAt: item.claimedAt, asset: item.asset, grossCreatorFees: item.grossCreatorFees, totalAllocated: item.totalAllocated, status: item.status, fundedApp: { total: item.fundedApp?.total, referralPayout: item.fundedApp?.referralPayout, community: item.fundedApp?.community, buyback: item.fundedApp?.buyback, referralLevels: (item.fundedApp?.referralLevels || []).map(level => ({ level: level.level, amount: level.amount, status: level.status })) } })),
    collections: Object.values(state.collections || {}).map(item => ({ id: item.id, mint: item.mint, signature: item.signature, status: item.status, collectedLamports: item.collectedLamports, recordedAt: item.recordedAt })),
    referralClaims: Object.values(state.referralClaims || {}).map(item => ({ id: item.id, level: item.level, amount: item.amount, asset: item.asset, status: item.status, createdAt: item.createdAt, verifiedAt: item.verifiedAt, paidAt: item.paidAt, payoutSignature: item.payoutSignature })),
  };
}
function authorized(req) {
  const token = String(process.env.FUNDED_API_TOKEN || '').trim();
  if (!token) return false;
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(String(req.headers.authorization || ''));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function requireAuthorized(req, res) { if (authorized(req)) return true; json(res, 401, { error: 'Keeper/indexer API authorization is required.' }); return false; }
function publicPost(path) { return publicPostPaths.has(path) || /^\/api\/sol-claims\/[^/]+\/(?:prepare|verify|attest|execute)$/.test(path) || /^\/api\/referral-claims\/[^/]+\/(?:verify|execute)$/.test(path); }
function walletKey(value) { return new PublicKey(String(value || '').trim()).toBase58(); }
function referralCodeFromBytes() { return createReferralCode(Uint8Array.from(randomBytes(6))); }
function referralUplineForWallet(state, wallet) {
  const direct = state.referrals.attributions[wallet]?.inviterWallet || null;
  if (!direct) return [];
  const graph = Object.fromEntries(Object.values(state.referrals.attributions).map(item => [item.wallet, item.inviterWallet]).filter(([key]) => key));
  return resolveReferralUpline(direct, graph, 3);
}
function referralNetworkForWallet(state, wallet) {
  const graph = Object.fromEntries(Object.values(state.referrals.attributions).map(item => [item.wallet, item.inviterWallet]).filter(([key]) => key));
  return Object.values(state.referrals.attributions).filter(item => {
    const visited = new Set(); let current = item.inviterWallet;
    while (current && !visited.has(current)) { if (current === wallet) return true; visited.add(current); current = graph[current] || null; }
    return false;
  }).map(item => item.wallet);
}
function referralChallengeStatement(challenge) { return `funded.app referral ${challenge.action} ${challenge.wallet} nonce ${challenge.nonce}`; }
async function fetchBirdeye(path, params = {}) {
  if (!birdeyeApiKey) return { configured: false, data: null };
  const query = new URLSearchParams(params);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), birdeyeTimeoutMs);
  try {
    const response = await fetch(`${birdeyeBaseUrl}${path}?${query}`, { headers: { accept: 'application/json', 'X-API-KEY': birdeyeApiKey, 'x-chain': birdeyeChain }, signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) throw new Error(payload.message || `Birdeye request failed (${response.status}).`);
    return { configured: true, data: payload.data || null };
  } finally { clearTimeout(timeout); }
}
async function fetchPump(path, params = {}) {
  const query = new URLSearchParams(params);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), birdeyeTimeoutMs);
  try {
    const response = await fetch(`${pumpApiUrl}${path}?${query}`, { headers: { accept: 'application/json' }, signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Pump.fun request failed (${response.status}).`);
    return Array.isArray(payload) ? payload : Array.isArray(payload.coins) ? payload.coins : Array.isArray(payload.data) ? payload.data : [];
  } finally { clearTimeout(timeout); }
}
function normalizePumpToken(item) {
  const mint = String(item?.mint || item?.address || '').trim();
  if (!mint) return null;
  const marketCap = item.usd_market_cap ?? item.marketCapUsd;
  return {
    mint,
    name: String(item.name || 'Unnamed Pump coin').slice(0, 80),
    symbol: String(item.symbol || 'TOKEN').slice(0, 20),
    creator: String(item.creator || '').trim() || null,
    description: item.description || null,
    imageUri: item.imageUri || item.image_uri || item.image || null,
    metadataUri: item.metadataUri || item.metadata_uri || item.uri || null,
    website: item.website || null,
    twitter: item.twitter || null,
    telegram: item.telegram || null,
    marketCapUsd: marketCap != null && Number.isFinite(Number(marketCap)) ? Number(marketCap) : null,
    complete: Boolean(item.complete),
    bondingCurve: item.bonding_curve || null,
    raydiumPool: item.raydium_pool || null,
    virtualSolReserves: item.virtual_sol_reserves ?? null,
    virtualTokenReserves: item.virtual_token_reserves ?? null,
    realSolReserves: item.real_sol_reserves ?? null,
    realTokenReserves: item.real_token_reserves ?? null,
    createdTimestamp: item.created_timestamp ?? item.createdTimestamp ?? null,
    lastTradeTimestamp: item.last_trade_timestamp ?? item.lastTradeTimestamp ?? null,
    replyCount: item.reply_count ?? null,
  };
}
function normalizeBirdeyeToken(item) {
  const address = String(item?.address || '').trim();
  if (!address) return null;
  return {
    address,
    name: String(item.name || 'Unnamed token').slice(0, 80),
    symbol: String(item.symbol || 'TOKEN').slice(0, 20),
    logoUri: item.logo_uri || item.logoURI || null,
    decimals: Number.isInteger(item.decimals) ? item.decimals : null,
    priceUsd: Number.isFinite(Number(item.price)) ? Number(item.price) : null,
    marketCapUsd: Number.isFinite(Number(item.market_cap)) ? Number(item.market_cap) : null,
    liquidityUsd: Number.isFinite(Number(item.liquidity)) ? Number(item.liquidity) : null,
    volume24hUsd: Number.isFinite(Number(item.volume_24h_usd)) ? Number(item.volume_24h_usd) : null,
    priceChange24hPercent: Number.isFinite(Number(item.price_change_24h_percent)) ? Number(item.price_change_24h_percent) : null,
    holders: Number.isFinite(Number(item.holder)) ? Number(item.holder) : null,
    lastTradeUnixTime: Number.isFinite(Number(item.last_trade_unix_time)) ? Number(item.last_trade_unix_time) : null,
  };
}
function verifyHmacAttestation({ handle, subject, issuedAt, signature }) {
  if (!xAttestationSecret) return false;
  const payload = `${handle}|${subject}|${issuedAt}`;
  const expected = createHmac('sha256', xAttestationSecret).update(payload).digest('hex');
  const actual = String(signature || '').trim();
  return actual.length === expected.length && timingSafeEqual(Buffer.from(actual), Buffer.from(expected)) && Math.abs(Date.now() - Number(issuedAt)) < 10 * 60 * 1000;
}
function xConfig() { return { clientId: String(process.env.X_CLIENT_ID || '').trim(), clientSecret: String(process.env.X_CLIENT_SECRET || '').trim(), callbackUrl: String(process.env.X_CALLBACK_URL || '').trim() }; }
async function resolveXUser(handle) {
  const username = String(handle || '').trim().replace(/^@/, '');
  if (!/^[A-Za-z0-9_]{1,15}$/.test(username)) throw new Error('A valid X handle is required.');
  const bearer = String(process.env.X_BEARER_TOKEN || '').trim();
  if (!bearer) throw new Error('X user lookup is not configured.');
  const response = await fetch(`https://api.x.com/2/users/by/username/${encodeURIComponent(username)}`, { headers: { authorization: `Bearer ${bearer}` }, signal: AbortSignal.timeout(8000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !/^\d{1,24}$/.test(String(payload.data?.id || '')) || String(payload.data?.username || '').toLowerCase() !== username.toLowerCase()) throw new Error('The X handle could not be resolved to a stable user ID.');
  return { handle: `@${payload.data.username}`, id: String(payload.data.id) };
}
function base64Url(buffer) { return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
function cookieValue(req, name) { const match = String(req.headers.cookie || '').match(new RegExp(`(?:^|; )${name}=([^;]+)`)); return match ? decodeURIComponent(match[1]) : ''; }
function xSession(req) {
  const key = cookieValue(req, 'funded_x_session');
  const session = xSessions.get(key);
  if (!session) return null;
  if (Date.now() - session.createdAt > 86_400_000) { xSessions.delete(key); return null; }
  return session;
}
function xCallbackUrl(req) { return xConfig().callbackUrl || `http://${req.headers.host || '127.0.0.1:8787'}/api/x/oauth/callback`; }
function html(res, status, title, message) { res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' }); res.end(`<!doctype html><title>${title}</title><p>${message}</p>`); }
function keeperKeypair() {
  const filePath = String(process.env.SOLANA_KEEPER_KEYPAIR_PATH || '').trim();
  if (filePath) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(resolve(filePath), 'utf8'))));
  const encoded = String(process.env.SOLANA_KEEPER_SECRET_KEY || '').trim();
  if (!encoded) return null;
  return Keypair.fromSecretKey(bs58.decode(encoded));
}
function routerAuthorityKeypair() {
  const filePath = String(process.env.FUNDED_ROUTER_AUTHORITY_KEYPAIR_PATH || '').trim();
  if (filePath) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(resolve(filePath), 'utf8'))));
  const encoded = String(process.env.FUNDED_ROUTER_AUTHORITY_SECRET_KEY || '').trim();
  if (!encoded) return null;
  return Keypair.fromSecretKey(bs58.decode(encoded));
}
async function xFeeReadiness() {
  const reasons = [];
  if (solanaCluster !== 'devnet') reasons.push('Devnet is required');
  if (process.env.FUNDED_MINT_FEE_ROUTER_ENABLED !== 'true') reasons.push('mint router upgrade is not activated');
  if (!feeRouterConfig()) reasons.push('fee router is not configured');
  let keeper = null;
  try { keeper = keeperKeypair(); } catch { reasons.push('fee collector key is invalid'); }
  if (!keeper || process.env.SOLANA_KEEPER_CONFIGURED !== 'true') reasons.push('fee collector is not configured');
  let authority = null;
  try { authority = routerAuthorityKeypair(); } catch { reasons.push('router settlement authority key is invalid'); }
  if (!authority) reasons.push('router settlement authority is not configured');
  if (!xConfig().clientId || !xConfig().clientSecret) reasons.push('X OAuth is not configured');
  if (!String(process.env.X_BEARER_TOKEN || '').trim()) reasons.push('X user lookup is not configured');
  if (reasons.length === 0) {
    try {
      const router = feeRouterConfig();
      const connection = new Connection(solanaRpcUrl, 'confirmed');
      const [program, verified, legacy] = await Promise.all([
        connection.getAccountInfo(router.programId, 'confirmed'),
        verifyFeeRouterAccount({ connection, programId: router.programId.toBase58() }),
        connection.getAccountInfo(router.address, 'confirmed'),
      ]);
      if (!program?.executable || !verified.verified) reasons.push('fee router program or legacy header is not verified');
      if (legacy?.data?.length !== 74 || !new PublicKey(legacy.data.subarray(41, 73)).equals(authority.publicKey)) reasons.push('settlement authority does not match the on-chain router');
    } catch { reasons.push('Devnet fee router could not be verified'); }
  }
  return { ready: reasons.length === 0, reasons };
}
function feeRouterConfig() {
  const programId = String(process.env.FUNDED_FEE_ROUTER_PROGRAM_ID || process.env.VITE_FUNDED_FEE_ROUTER_PROGRAM_ID || '').trim();
  return programId ? deriveFeeRouter(programId) : null;
}
async function executeSolPayout({ recipientWallet, amountSol }) {
  const keeper = keeperKeypair();
  if (!keeper || (!process.env.SOLANA_KEEPER_CONFIGURED && !devnetTestMode)) throw new Error('Solana keeper is not configured.');
  const recipient = new PublicKey(recipientWallet);
  const lamports = Math.floor(Number(amountSol) * 1_000_000_000);
  if (!Number.isSafeInteger(lamports) || lamports <= 0) throw new Error('Payout amount must be a positive SOL value.');
  const connection = new Connection(solanaRpcUrl, 'confirmed');
  const transaction = new Transaction().add(SystemProgram.transfer({ fromPubkey: keeper.publicKey, toPubkey: recipient, lamports }));
  const signature = await sendAndConfirmTransaction(connection, transaction, [keeper], { commitment: 'confirmed' });
  return { signature, from: keeper.publicKey.toBase58(), to: recipient.toBase58(), amountSol: Number(amountSol), cluster: solanaCluster };
}
async function collectPumpCreatorFees({ requestedMint }) {
  const keeper = keeperKeypair();
  const config = feeRouterConfig();
  if (!keeper || !config || (process.env.SOLANA_KEEPER_CONFIGURED !== 'true' && !devnetTestMode)) throw new Error('Keeper and fee-router configuration are required.');
  const connection = new Connection(solanaRpcUrl, 'confirmed');
  const verification = await verifyFeeRouterAccount({ connection, programId: config.programId.toBase58() });
  if (!verification.verified) throw new Error(`Fee router is not deployable: ${verification.reason}.`);
  const mintKey = new PublicKey(String(requestedMint || ''));
  const launch = await store.readLaunch(mintKey.toBase58());
  if (!launch?.onchainVerified || launch.cluster !== solanaCluster) throw new Error('A verified launch for this mint is required before collection.');
  const perMint = launch.pumpFeeRoute?.scope === 'per-mint-v2';
  const router = perMint ? deriveMintFeeRouter(config.programId, mintKey) : config;
  if (perMint) {
    if (!(await xFeeReadiness()).ready) throw new Error('Mint-specific collection is not activated.');
    const legacy = await connection.getAccountInfo(config.address, 'confirmed');
    const checked = await verifyMintFeeRouterAccount({ connection, programId: config.programId, mint: mintKey, expectedAuthority: new PublicKey(legacy.data.subarray(41, 73)) });
    if (!checked.verified) throw new Error(`Mint router verification failed: ${checked.reason}.`);
  }
  const online = new OnlinePumpSdk(connection);
  const curve = await online.fetchBondingCurve(mintKey);
  if (!curve?.creator?.equals(router.address) || launch.creator !== router.address.toBase58()) throw new Error('The on-chain Pump fee owner does not match this launch router.');
  const beforeLamports = await connection.getBalance(router.address, 'confirmed');
  const instructions = perMint
    ? await online.collectCoinCreatorFeeV2Instructions(router.address, NATIVE_MINT, TOKEN_PROGRAM_ID, keeper.publicKey)
    : await online.collectCoinCreatorFeeInstructions(router.address, keeper.publicKey);
  if (!instructions.length) return { requestedMint: mintKey.toBase58(), mint: perMint ? mintKey.toBase58() : null, attribution: perMint ? 'mint-verified' : 'router', router: router.address.toBase58(), status: 'nothing-to-collect', beforeLamports, afterLamports: beforeLamports };
  const latest = await connection.getLatestBlockhash('confirmed');
  const transaction = new Transaction().add(...instructions);
  transaction.recentBlockhash = latest.blockhash; transaction.feePayer = keeper.publicKey;
  const signature = await sendAndConfirmTransaction(connection, transaction, [keeper], { commitment: 'confirmed' });
  const afterLamports = await connection.getBalance(router.address, 'confirmed').catch(() => null);
  let confirmed = null;
  try { confirmed = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }); } catch {}
  const accountKeys = confirmed?.transaction?.message?.accountKeys || [];
  const routerIndex = accountKeys.findIndex(key => (key?.toBase58?.() || String(key)) === router.address.toBase58());
  if (perMint && (routerIndex < 0 || !Number.isSafeInteger(confirmed?.meta?.preBalances?.[routerIndex]) || !Number.isSafeInteger(confirmed?.meta?.postBalances?.[routerIndex]))) return { requestedMint: mintKey.toBase58(), mint: mintKey.toBase58(), attribution: 'unverified', onchainVerified: false, router: router.address.toBase58(), signature, beforeLamports, afterLamports, cluster: solanaCluster, status: 'verification-pending', reason: 'Confirmed collection has no safe, mint-router balance proof. Reconcile the signature before creating obligations.' };
  const collectedLamports = routerIndex >= 0 && !confirmed?.meta?.err
    ? Math.max(0, confirmed.meta.postBalances[routerIndex] - confirmed.meta.preBalances[routerIndex])
    : 0;
  return { requestedMint: mintKey.toBase58(), mint: perMint ? mintKey.toBase58() : null, attribution: perMint ? 'mint-verified' : 'router', onchainVerified: perMint && collectedLamports > 0, router: router.address.toBase58(), signature, beforeLamports, afterLamports, collectedLamports, cluster: solanaCluster, status: collectedLamports > 0 ? 'collected' : 'no-fees' };
}

async function buildReceiptEvidence() {
  const state = await store.read();
  const collections = Object.values(state.collections || {}).filter(item => item?.status === 'collected' && item.signature);
  const payouts = Object.values(state.payouts || {}).filter(item => item?.status === 'paid' && item.signature);
  const ordered = items => [...items].sort((a, b) => String(b.recordedAt || b.paidAt || '').localeCompare(String(a.recordedAt || a.paidAt || ''))).slice(0, 12);
  const selectedCollections = ordered(collections);
  const selectedPayouts = ordered(payouts);
  const base = { cluster: solanaCluster, generatedAt: new Date().toISOString(), verifiedCollections: [], verifiedPayouts: [],
    coverage: { recordedCollections: collections.length, recordedPayouts: payouts.length,
      checkedCollections: selectedCollections.length, checkedPayouts: selectedPayouts.length } };
  if (solanaCluster !== 'devnet') return { ...base, status: 'unavailable', reason: 'Devnet evidence is disabled on this cluster.' };
  if (!collections.length && !payouts.length) return { ...base, status: 'no-records', reason: 'No collection or payout signatures are recorded.' };
  const connection = new Connection(solanaRpcUrl, 'confirmed');
  try {
    const [configuredGenesis, officialGenesis] = await Promise.all([
      connection.getGenesisHash(),
      new Connection(clusterApiUrl('devnet'), 'confirmed').getGenesisHash(),
    ]);
    if (configuredGenesis !== officialGenesis) return { ...base, status: 'unavailable', reason: 'Configured RPC is not Solana Devnet.' };
  } catch { return { ...base, status: 'unavailable', reason: 'Devnet genesis could not be verified.' }; }
  let unavailable = 0;
  const work = [
    ...selectedCollections.map(record => ({ record, verify: verifyCollectionReceipt, target: base.verifiedCollections })),
    ...selectedPayouts.map(record => ({ record, verify: verifyPayoutReceipt, target: base.verifiedPayouts })),
  ];
  // Keep evidence reads bounded even if the store grows or several clients request the page.
  for (let index = 0; index < work.length; index += 4) {
    await Promise.all(work.slice(index, index + 4).map(async ({ record, verify, target }) => {
      try {
        const transaction = await connection.getTransaction(record.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
        if (!transaction) { unavailable += 1; return; }
        const proof = verify(record, transaction);
        if (proof) target.push(proof);
      } catch { unavailable += 1; }
    }));
  }
  const checked = selectedCollections.length + selectedPayouts.length;
  const verified = base.verifiedCollections.length + base.verifiedPayouts.length;
  const incomplete = unavailable > 0 || checked < collections.length + payouts.length || verified < checked;
  return { ...base, status: verified ? incomplete ? 'partial' : 'onchain-indexed' : unavailable ? 'unavailable' : 'unverified-records',
    reason: incomplete ? 'Only matching confirmed transaction deltas are displayed; totals may be incomplete.' : 'All checked receipts have confirmed matching balance deltas.',
    unavailableRecords: unavailable };
}

async function readReceiptEvidence() {
  if (receiptEvidenceCache.value && receiptEvidenceCache.expiresAt > Date.now()) return receiptEvidenceCache.value;
  receiptEvidencePending ||= buildReceiptEvidence().then(value => {
    receiptEvidenceCache = { value, expiresAt: Date.now() + 30_000 };
    return value;
  }).finally(() => { receiptEvidencePending = null; });
  return receiptEvidencePending;
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const metadataHost = String(req.headers.host || '').split(':')[0].toLowerCase() === 'metadata.funded.vip';
  if (metadataHost && (req.method !== 'GET' || !/^\/(?:devnet-metadata|devnet-images)\/[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(url.pathname) && url.pathname !== '/default.svg')) return json(res, 404, { error: 'Not found.' });
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': process.env.CORS_ORIGIN || '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type, solana-client' }); return res.end(); }
  try {
    if (req.method === 'GET' && url.pathname === '/default.svg') {
      res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'" });
      return res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" rx="48" fill="#111827"/><circle cx="128" cy="128" r="68" fill="#d7b65d"/><text x="128" y="148" text-anchor="middle" font-family="sans-serif" font-weight="bold" font-size="70" fill="#111827">F</text></svg>');
    }
    const publicMint = req.method === 'GET' ? url.pathname.match(/^\/devnet-(?:metadata|images)\/([1-9A-HJ-NP-Za-km-z]{32,44})$/)?.[1] : null;
    if (publicMint && url.pathname.startsWith('/devnet-images/')) {
      const image = await store.readMetadataImage(publicMint);
      if (!image) return json(res, 404, { error: 'Image not found.' });
      res.writeHead(200, { 'content-type': image.mime, 'content-length': image.bytes.length, 'cache-control': 'public, max-age=86400, immutable', 'x-content-type-options': 'nosniff', 'access-control-allow-origin': '*' });
      return res.end(image.bytes);
    }
    if (publicMint && url.pathname.startsWith('/devnet-metadata/')) {
      const prepared = await store.readMetadata(publicMint);
      if (prepared) return json(res, 200, publicMetadata(prepared));
      if (metadataHost) return json(res, 404, { error: 'Devnet metadata not found.' });
    }
    if (req.method === 'POST' && url.pathname !== '/api/solana/rpc') {
      const cost = ['/api/launches', '/api/devnet-metadata'].includes(url.pathname) ? 10 : url.pathname.startsWith('/api/referrals/') ? 5 : 1;
      const windowStart = Math.floor(Date.now() / 60_000) * 60_000;
      if (!await store.chargeRpcRate(`api:${clientKey(req)}`, cost, 120, windowStart)) return json(res, 429, { error: 'API request limit reached; retry shortly.' });
      const chatPost = req.method === 'POST' && /^\/api\/tokens\/[^/]+\/chat$/.test(url.pathname);
      if (!publicPost(url.pathname) && !chatPost && !authorized(req)) return json(res, 401, { error: 'API authorization required.' });
    }
    if (req.method === 'POST' && url.pathname === '/api/solana/rpc') return await proxySolanaRpc(req, res);
    if (req.method === 'POST' && url.pathname === '/api/devnet-metadata') {
      if (solanaCluster !== 'devnet') return json(res, 403, { error: 'Metadata publishing is Devnet-only.' });
      const { record, image, imageType } = parseSignedMetadata(await body(req));
      await store.writeMetadata(record, image, imageType);
      return json(res, 201, { uri: devnetMetadataUri(record.mint), image: record.imageSha256 ? devnetImageUri(record.mint) : 'https://metadata.funded.vip/default.svg', mint: record.mint });
    }
    if (req.method === 'GET' && url.pathname === '/api/dev-wallet') {
      const wallet = devWalletKeypair();
      if (!wallet) return json(res, 404, { error: 'Development wallet mode is not enabled or configured.' });
      return json(res, 200, { role: wallet.role, publicKey: wallet.keypair.publicKey.toBase58(), cluster: 'devnet' });
    }
    if (req.method === 'POST' && url.pathname === '/api/dev-wallet/sign-transaction') {
      const wallet = devWalletKeypair();
      if (!wallet) return json(res, 404, { error: 'Development wallet mode is not enabled or configured.' });
      const input = await body(req);
      try {
        const transaction = Transaction.from(Buffer.from(String(input.transaction || ''), 'base64'));
        transaction.partialSign(wallet.keypair);
        return json(res, 200, { transaction: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64') });
      } catch { return json(res, 400, { error: 'Invalid development transaction.' }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/dev-wallet/sign-message') {
      const wallet = devWalletKeypair();
      if (!wallet) return json(res, 404, { error: 'Development wallet mode is not enabled or configured.' });
      const input = await body(req);
      try { return json(res, 200, { signature: Buffer.from(nacl.sign.detached(Buffer.from(String(input.message || ''), 'base64'), wallet.keypair.secretKey)).toString('base64') }); }
      catch { return json(res, 400, { error: 'Invalid development message.' }); }
    }
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, service: 'funded-api', external: { solanaKeeper: Boolean(process.env.SOLANA_KEEPER_CONFIGURED), feeRouter: Boolean(feeRouterConfig()), birdeye: Boolean(birdeyeApiKey), pumpFun: Boolean(pumpApiUrl), xOAuth: Boolean(process.env.X_CLIENT_ID && process.env.X_CLIENT_SECRET) } });
    if (req.method === 'GET' && url.pathname === '/api/market/sol-usd') {
      const quote = await readSolUsdQuote();
      if (!quote) return json(res, 503, { error: 'SOL/USD quote is currently unavailable.', provider: 'coingecko' });
      return json(res, 200, quote);
    }
    if (req.method === 'GET' && url.pathname === '/api/x/oauth/start') {
      const config = xConfig();
      if (!config.clientId || !config.clientSecret) return json(res, 503, { error: 'X OAuth is not configured on the server.' });
      const state = base64Url(randomBytes(32));
      const verifier = base64Url(randomBytes(48));
      const challenge = base64Url(createHash('sha256').update(verifier).digest());
      xAuthRequests.set(state, { verifier, createdAt: Date.now() });
      const params = new URLSearchParams({ response_type: 'code', client_id: config.clientId, redirect_uri: xCallbackUrl(req), scope: 'users.read offline.access', state, code_challenge: challenge, code_challenge_method: 'S256' });
      res.writeHead(302, { location: `https://x.com/i/oauth2/authorize?${params.toString()}` });
      return res.end();
    }
    if (req.method === 'GET' && url.pathname === '/api/x/oauth/callback') {
      if (url.searchParams.get('error')) return html(res, 400, 'X sign-in cancelled', 'X sign-in was cancelled. Close this window and try again.');
      const state = String(url.searchParams.get('state') || '');
      const code = String(url.searchParams.get('code') || '');
      const request = xAuthRequests.get(state); xAuthRequests.delete(state);
      if (!request || !code || Date.now() - request.createdAt > 10 * 60 * 1000) return html(res, 400, 'X sign-in expired', 'The X sign-in request expired. Start again.');
      const config = xConfig();
      const form = new URLSearchParams({ code, grant_type: 'authorization_code', redirect_uri: xCallbackUrl(req), code_verifier: request.verifier });
      const tokenResponse = await fetch('https://api.x.com/2/oauth2/token', { method: 'POST', headers: { authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' }, body: form });
      const token = await tokenResponse.json().catch(() => ({}));
      if (!tokenResponse.ok || !token.access_token) return html(res, 502, 'X sign-in failed', 'X did not issue an access token. Check the exact callback URL and OAuth settings.');
      const userResponse = await fetch('https://api.x.com/2/users/me?user.fields=id,name,username,profile_image_url', { headers: { authorization: `Bearer ${token.access_token}` } });
      const profile = await userResponse.json().catch(() => ({}));
      if (!userResponse.ok || !profile.data?.id) return html(res, 502, 'X profile lookup failed', 'X sign-in succeeded but the account profile could not be loaded.');
      const sessionId = base64Url(randomBytes(32));
      xSessions.set(sessionId, { user: profile.data, accessToken: token.access_token, refreshToken: token.refresh_token || null, createdAt: Date.now() });
      res.writeHead(302, { location: '/?x=connected', 'set-cookie': `funded_x_session=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400${xCallbackUrl(req).startsWith('https:') ? '; Secure' : ''}` });
      return res.end();
    }
    if (req.method === 'GET' && url.pathname === '/api/x/me') {
      const session = xSession(req);
      return json(res, 200, { authenticated: Boolean(session), user: session?.user || null });
    }
    if (req.method === 'GET' && url.pathname === '/api/x/resolve') {
      const readiness = await xFeeReadiness();
      if (!readiness.ready) return json(res, 503, { error: 'X fee claims are not operational on Devnet yet.', reasons: readiness.reasons });
      if (!await store.chargeRpcRate(`x-resolve:${clientKey(req)}`, 1, 10, Math.floor(Date.now() / 60_000) * 60_000)) return json(res, 429, { error: 'X account lookup limit reached; retry shortly.' });
      return json(res, 200, await resolveXUser(url.searchParams.get('handle')));
    }
    if (req.method === 'GET' && url.pathname === '/api/x-fee/status') return json(res, 200, await xFeeReadiness());
    if (req.method === 'GET' && url.pathname === '/api/x-fee/claims') {
      const session = xSession(req);
      if (!session?.user?.username) return json(res, 401, { error: 'Sign in with X to view claims.' });
      const handle = `@${session.user.username}`.toLowerCase();
      const state = await store.read();
      const claims = Object.values(state.obligations || {}).filter(item => item.source === 'verified-per-mint-router-collection' && item.xUserId === String(session.user.id)).map(item => ({ id: item.id, mint: item.mint, amountSol: item.amountSol, status: state.claims?.[item.id]?.status || item.status, payoutSignature: state.claims?.[item.id]?.payoutSignature || null }));
      return json(res, 200, { handle, claims });
    }
    if (req.method === 'POST' && url.pathname === '/api/x/logout') {
      xSessions.delete(cookieValue(req, 'funded_x_session'));
      res.writeHead(204, { 'set-cookie': 'funded_x_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
      return res.end();
    }
    if (req.method === 'GET' && url.pathname === '/api/readiness') return json(res, 200, buildProductionReadiness(process.env));
    if (req.method === 'POST' && url.pathname === '/api/rewards/preview') {
      const input = await body(req);
      const config = validateRewardConfig(input);
      if (!config.valid) return json(res, 400, { error: 'Unsupported reward configuration.', config });
      return json(res, 200, buildRewardCycle(input));
    }
    if (req.method === 'POST' && url.pathname === '/api/anti-sniper/analyze') {
      const input = await body(req);
      return json(res, 200, analyzeLaunchActivity(input));
    }
    if (req.method === 'GET' && url.pathname === '/api/keeper/status') {
      const router = feeRouterConfig();
      return json(res, 200, { cluster: solanaCluster, keeperConfigured: Boolean(keeperKeypair()), routerConfigured: Boolean(router), routerAddress: router?.address?.toBase58() || null, status: router && keeperKeypair() ? 'ready-to-verify-router' : 'waiting-for-deployment-config' });
    }
    if (req.method === 'GET' && url.pathname === '/api/birdeye/explore') {
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 40)));
      const offset = Math.min(10_000, Math.max(0, Number(url.searchParams.get('offset') || 0)));
      const sortBy = ['volume_24h_usd', 'market_cap', 'recent_listing_time', 'price_change_24h_percent'].includes(url.searchParams.get('sort_by')) ? url.searchParams.get('sort_by') : 'volume_24h_usd';
      if (solanaCluster === 'devnet') return json(res, 503, { error: 'Birdeye market discovery is disabled for Devnet. Use the verified Devnet launch registry.', provider: 'birdeye', chain: 'solana', cluster: 'devnet', configured: false });
      const result = await fetchBirdeye('/defi/v3/token/list', { sort_by: sortBy, sort_type: 'desc', offset: String(offset), limit: String(limit), min_liquidity: '100' });
      if (!result.configured) return json(res, 503, { error: 'Birdeye is not configured.', provider: 'birdeye', configured: false });
      return json(res, 200, { provider: 'birdeye', chain: birdeyeChain, fetchedAt: new Date().toISOString(), items: Array.isArray(result.data?.items) ? result.data.items.map(normalizeBirdeyeToken).filter(Boolean) : [] });
    }
    if (req.method === 'GET' && url.pathname === '/api/pump/explore') {
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 40)));
      const offset = Math.min(10_000, Math.max(0, Number(url.searchParams.get('offset') || 0)));
      const sort = ['market_cap', 'created_timestamp', 'last_trade_timestamp'].includes(url.searchParams.get('sort')) ? url.searchParams.get('sort') : 'market_cap';
      if (solanaCluster === 'devnet') {
        const connection = new Connection(solanaRpcUrl, 'confirmed');
        const candidates = (await store.readLaunches()).filter(item => item?.mint && item?.chain === 'solana' && (item.cluster || 'devnet') === 'devnet');
        const alreadyVerified = candidates.filter(item => item.onchainVerified);
        const windowStart = Math.floor(Date.now() / 60_000) * 60_000;
        const mayVerify = candidates.some(item => !item.onchainVerified) && await store.chargeRpcRate(`explore:${clientKey(req)}`, 1, 10, windowStart);
        const pending = mayVerify ? candidates.filter(item => !item.onchainVerified).slice(0, Math.max(0, 4 - devnetVerificationActive)) : [];
        const newlyVerified = await Promise.all(pending.map(async item => {
          devnetVerificationActive += 1;
          try {
            const proof = await verifyPumpLaunch({ connection, mint: item.mint, signature: item.signature || item.pumpFeeRoute?.transaction });
            const updated = { ...item, ...proof, cluster: 'devnet' };
            await store.update(state => { state.launches[item.mint] = updated; return updated; });
            return updated;
          } catch { return null; }
          finally { devnetVerificationActive -= 1; }
        }));
        const localItems = [...alreadyVerified, ...newlyVerified.filter(Boolean)].map(normalizePumpToken).filter(Boolean);
        const sorted = sortDevnetLaunches(localItems, sort);
        return json(res, 200, { provider: 'funded.app-devnet-registry', chain: 'solana', cluster: 'devnet', fetchedAt: new Date().toISOString(), items: sorted.slice(offset, offset + limit) });
      }
      const items = await fetchPump('/coins', { offset: String(offset), limit: String(limit), sort, order: 'DESC', includeNsfw: 'false' });
      return json(res, 200, { provider: 'pump.fun', chain: 'solana', fetchedAt: new Date().toISOString(), items: items.map(normalizePumpToken).filter(Boolean) });
    }
    const tokenChatMint = url.pathname.match(/^\/api\/tokens\/([^/]+)\/chat$/)?.[1] || null;
    if (tokenChatMint && (req.method === 'GET' || req.method === 'POST')) {
      let mint;
      try { mint = new PublicKey(decodeURIComponent(tokenChatMint)).toBase58(); }
      catch { return json(res, 400, { error: 'A valid Solana mint is required.' }); }
      if (req.method === 'GET') return json(res, 200, { mint, messages: await store.readCoinChat(mint, 50) });
      const input = await body(req);
      const text = String(input.text || '').trim();
      const author = String(input.author || '').trim();
      if (!text || text.length > 280) return json(res, 400, { error: 'Chat messages must be between 1 and 280 characters.' });
      if (author.length > 64) return json(res, 400, { error: 'Chat author is too long.' });
      const message = { id: id('chat'), author: author || 'Guest', text, createdAt: new Date().toISOString() };
      await store.appendCoinChat(mint, message);
      return json(res, 201, { mint, message });
    }
    const tokenActivityMint = req.method === 'GET' ? route(url.pathname, req.method, /^\/api\/tokens\/([^/]+)\/fee-activity$/) : null;
    if (tokenActivityMint) {
      let mint;
      try { mint = new PublicKey(decodeURIComponent(tokenActivityMint)).toBase58(); }
      catch { return json(res, 400, { error: 'A valid Solana mint is required.' }); }
      const activity = await store.readCoinFeeActivity(mint, solanaCluster);
      const router = feeRouterConfig()?.address?.toBase58();
      const sharedRouter = router ? { address: router, scope: 'shared-creator-account', collections: await store.readRouterFeeActivity(router, solanaCluster) } : null;
      return json(res, 200, { mint, cluster: solanaCluster, source: databaseUrl ? 'funded.app-postgresql' : 'funded.app-file-ledger', coverage: 'mint-verified-fee-claims-only', ...activity, sharedRouter });
    }
    const tokenMarketMint = req.method === 'GET' ? route(url.pathname, req.method, /^\/api\/tokens\/([^/]+)\/market-activity$/) : null;
    if (tokenMarketMint) {
      if (solanaCluster !== 'devnet') return json(res, 503, { error: 'Pump trade scanning is currently available for Devnet only.' });
      let mint;
      try { mint = new PublicKey(decodeURIComponent(tokenMarketMint)); }
      catch { return json(res, 400, { error: 'A valid Solana mint is required.' }); }
      const address = mint.toBase58();
      const hasTradeBreakdown = data => data?.tradeCount24h == null || (data.activityWindows?.['1h']
        && data.activityWindows?.['6h'] && data.activityWindows?.['24h']
        && Number.isInteger(data.buyCount24h) && Number.isInteger(data.sellCount24h));
      const cached = coinMarketCache.get(address);
      if (cached && Date.now() - cached.at < 60_000 && hasTradeBreakdown(cached.data)) return json(res, 200, cached.data);
      const persisted = await store.readMarketActivity(address, solanaCluster);
      if (persisted && Date.now() - Date.parse(persisted.observedAt) < 60_000 && hasTradeBreakdown(persisted)) {
        coinMarketCache.set(address, { at: Date.parse(persisted.observedAt), data: persisted });
        return json(res, 200, persisted);
      }
      const windowStart = Math.floor(Date.now() / 60_000) * 60_000;
      if (!await store.chargeRpcRate(`market:${clientKey(req)}`, 10, 60, windowStart)) return json(res, 429, { error: 'Market activity refresh limit reached; retry shortly.' });
      let pending = coinMarketInflight.get(address);
      if (!pending) {
        if (coinMarketActive >= 4) return json(res, 429, { error: 'Market activity refresh is busy; retry shortly.' });
        coinMarketActive += 1;
        pending = (async () => {
          try {
            const metrics = await readPumpMarketActivity({ connection: new Connection(solanaRpcUrl, 'confirmed'), mint });
            const data = { mint: address, cluster: solanaCluster, source: 'confirmed-pump-trade-events', observedAt: new Date().toISOString(), ...metrics };
            await store.writeMarketActivity(address, solanaCluster, data);
            if (coinMarketCache.size >= 500) coinMarketCache.delete(coinMarketCache.keys().next().value);
            coinMarketCache.set(address, { at: Date.now(), data });
            return data;
          } finally { coinMarketActive -= 1; coinMarketInflight.delete(address); }
        })();
        coinMarketInflight.set(address, pending);
      }
      try { return json(res, 200, await pending); }
      catch { return json(res, 502, { error: 'Market activity provider is unavailable.' }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/indexer/sync') {
      if (!requireAuthorized(req, res)) return;
      const input = await body(req); const mint = String(input.mint || '').trim();
      if (!mint) return json(res, 400, { error: 'mint is required.' });
      const items = await fetchPump('/coins', { offset: '0', limit: '100', sort: 'created_timestamp', order: 'DESC', includeNsfw: 'false' });
      const token = items.map(normalizePumpToken).find(item => item?.mint === mint);
      if (!token) return json(res, 404, { error: 'Mint was not returned by the Pump indexer provider.' });
      const record = { ...token, chain: 'solana', source: 'pump.fun', indexedAt: new Date().toISOString() };
      await store.update(state => { state.launches[mint] = { ...(state.launches[mint] || {}), ...record }; state.lastIndexedAt = record.indexedAt; return record; });
      return json(res, 200, record);
    }
    if (req.method === 'POST' && url.pathname === '/api/keeper/collect') {
      if (!requireAuthorized(req, res)) return;
      const input = await body(req); const mint = String(input.mint || '').trim();
      if (!mint) return json(res, 400, { error: 'mint is required.' });
      const result = await collectPumpCreatorFees({ requestedMint: mint });
      if (result.signature) await store.update(state => {
        const recordedAt = new Date().toISOString();
        state.collections[result.signature] = { id: result.signature, ...result, recordedAt };
        if (result.onchainVerified && result.status === 'collected') {
          try {
            const obligation = deriveXFeeObligation(state, { mint: result.mint, claimSignature: result.signature });
            state.obligations[obligation.id] ||= { ...obligation, createdAt: recordedAt };
            result.obligationId = obligation.id;
          } catch (error) {
            result.obligationStatus = 'reconciliation-required';
            result.obligationError = String(error.message || error);
            state.collections[result.signature] = { ...state.collections[result.signature], obligationStatus: result.obligationStatus, obligationError: result.obligationError };
          }
        }
        return result;
      });
      return json(res, 200, result);
    }
    if (req.method === 'POST' && url.pathname === '/api/referrals/registration/prepare') {
      const input = await body(req); const wallet = walletKey(input.wallet);
      const challenge = await store.update(state => {
        const item = { id: id('referral_registration'), action: 'registration', wallet, nonce: randomBytes(24).toString('hex'), expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(), status: 'awaiting-signature' };
        state.referrals.challenges[item.id] = item; return item;
      });
      return json(res, 200, { challengeId: challenge.id, statement: referralChallengeStatement(challenge), expiresAt: challenge.expiresAt });
    }
    if (req.method === 'POST' && url.pathname === '/api/referrals/registration/verify') {
      const input = await body(req); const state = await store.read(); const challenge = state.referrals.challenges[String(input.challengeId || '')];
      if (!challenge || challenge.action !== 'registration' || challenge.status !== 'awaiting-signature' || Date.parse(challenge.expiresAt) < Date.now()) return json(res, 409, { error: 'Referral registration challenge is invalid or expired.' });
      const publicKey = new PublicKey(String(input.wallet || '')); if (publicKey.toBase58() !== challenge.wallet) return json(res, 401, { error: 'Wallet does not match the registration challenge.' });
      const signature = bs58.decode(String(input.signature || '')); const message = new TextEncoder().encode(referralChallengeStatement(challenge));
      if (!nacl.sign.detached.verify(message, signature, publicKey.toBytes())) return json(res, 401, { error: 'Wallet signature is invalid.' });
      const result = await store.update(current => {
        const existing = current.referrals.wallets[challenge.wallet]; if (existing) return existing;
        let code = referralCodeFromBytes(); while (current.referrals.codes[code]) code = referralCodeFromBytes();
        const record = { wallet: challenge.wallet, code, createdAt: new Date().toISOString() };
        current.referrals.codes[code] = record; current.referrals.wallets[challenge.wallet] = record; current.referrals.challenges[challenge.id] = { ...challenge, status: 'verified', verifiedAt: record.createdAt }; return record;
      });
      return json(res, 200, result);
    }
    if (req.method === 'POST' && url.pathname === '/api/referrals/attribution/prepare') {
      const input = await body(req); const wallet = walletKey(input.wallet); const code = normalizeReferralCode(input.code);
      const state = await store.read(); const inviter = state.referrals.codes[code];
      if (!inviter) return json(res, 404, { error: 'Referral code is not registered.' });
      if (inviter.wallet === wallet) return json(res, 400, { error: 'Self-referral is not allowed.' });
      const challenge = await store.update(current => {
        const item = { id: id('referral_attribution'), action: 'attribution', wallet, code, inviterWallet: inviter.wallet, nonce: randomBytes(24).toString('hex'), expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(), status: 'awaiting-signature' };
        current.referrals.challenges[item.id] = item; return item;
      });
      return json(res, 200, { challengeId: challenge.id, statement: referralChallengeStatement(challenge), expiresAt: challenge.expiresAt });
    }
    if (req.method === 'POST' && url.pathname === '/api/referrals/attribution/verify') {
      const input = await body(req); const state = await store.read(); const challenge = state.referrals.challenges[String(input.challengeId || '')];
      if (!challenge || challenge.action !== 'attribution' || challenge.status !== 'awaiting-signature' || Date.parse(challenge.expiresAt) < Date.now()) return json(res, 409, { error: 'Referral attribution challenge is invalid or expired.' });
      const publicKey = new PublicKey(String(input.wallet || '')); if (publicKey.toBase58() !== challenge.wallet) return json(res, 401, { error: 'Wallet does not match the attribution challenge.' });
      const signature = bs58.decode(String(input.signature || '')); const message = new TextEncoder().encode(referralChallengeStatement(challenge));
      if (!nacl.sign.detached.verify(message, signature, publicKey.toBytes())) return json(res, 401, { error: 'Wallet signature is invalid.' });
      const attribution = await store.update(current => {
        const existing = current.referrals.attributions[challenge.wallet];
        if (existing) return existing;
        const record = { wallet: challenge.wallet, inviterWallet: challenge.inviterWallet, inviterCode: challenge.code, capturedAt: new Date().toISOString(), lock: 'first-touch', status: 'active' };
        current.referrals.attributions[challenge.wallet] = record; current.referrals.challenges[challenge.id] = { ...challenge, status: 'verified', verifiedAt: record.capturedAt }; return record;
      });
      return json(res, 200, attribution);
    }
    if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, publicState(await store.readPublicBuckets()));
    if (req.method === 'GET' && url.pathname === '/api/evidence/receipts') return json(res, 200, await readReceiptEvidence());
    if (req.method === 'GET' && url.pathname === '/api/analytics/summary') {
      const state = await store.read();
      const launches = Object.values(state.launches || {});
      const settlements = Object.values(state.settlements || {});
      const collections = Object.values(state.collections || {}).filter(item => item.status === 'collected' && Number(item.collectedLamports) > 0);
      const totalGross = settlements.reduce((sum, item) => sum + Number(item.grossCreatorFees || 0), 0);
      const totalCollected = collections.reduce((sum, item) => sum + Number(item.collectedLamports || 0), 0);
      const totalBuyback = settlements.reduce((sum, item) => sum + Number(item.fundedApp?.buyback || 0), 0);
      return json(res, 200, {
        source: databaseUrl ? 'funded.app-postgresql' : 'funded.app-file-ledger',
        generatedAt: new Date().toISOString(),
        freshness: state.lastIndexedAt || null,
        launches: launches.length,
        collections: collections.length,
        settlements: settlements.length,
        grossCreatorFees: totalGross,
        collectedLamports: totalCollected,
        buybackAccrued: totalBuyback,
        status: state.lastIndexedAt ? 'indexed' : 'recorded-claims-only',
        creatorProfiles: creatorReputation(launches, settlements).length,
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/quote-assets') {
      if (verifiedQuoteAssetsCache?.expiresAt > Date.now()) return json(res, 200, verifiedQuoteAssetsCache.data);
      const catalog = quoteAssetCatalog(configuredQuoteAssets);
      const rpc = new Connection(solanaRpcUrl, 'confirmed');
      const checked = await Promise.all(catalog.map(async item => {
        if (item.id === 'sol' && item.category === 'native') return { ...item, source: 'Solana native asset', cluster: solanaCluster };
        try {
          const mint = await rpc.getParsedAccountInfo(new PublicKey(item.mint), 'confirmed');
          const validOwner = mint.value?.owner?.equals(TOKEN_PROGRAM_ID) || mint.value?.owner?.equals(TOKEN_2022_PROGRAM_ID);
          return validOwner && mint.value?.data?.parsed?.type === 'mint' ? { ...item, source: 'Solana RPC mint', cluster: solanaCluster } : null;
        } catch { return null; }
      }));
      const data = { chain: 'solana', cluster: solanaCluster, assets: checked.filter(Boolean), status: 'onchain-verified-catalog' };
      verifiedQuoteAssetsCache = { data, expiresAt: Date.now() + 60_000 };
      return json(res, 200, data);
    }
    if (req.method === 'GET' && url.pathname === '/api/terminal/signals') {
      const launches = (await store.readLaunches()).filter(item => item.onchainVerified && item.cluster === solanaCluster).map(item => ({ ...item, ...buildTerminalSignal(item) }));
      return json(res, 200, { source: 'verified-Solana-launch-registry', cluster: solanaCluster, generatedAt: new Date().toISOString(), items: launches, status: launches.length ? 'ready' : 'waiting-for-indexer' });
    }
    const creatorProfileWallet = route(url.pathname, req.method, /^\/api\/creators\/([^/]+)$/);
    if (creatorProfileWallet) {
      const state = await store.read();
      const wallet = decodeURIComponent(creatorProfileWallet);
      const profile = creatorReputation(state.launches, state.settlements).find(item => item.wallet === wallet);
      return profile ? json(res, 200, profile) : json(res, 404, { error: 'Creator profile not found.' });
    }
    if (req.method === 'GET' && url.pathname === '/api/launch-reviews') {
      const state = await store.read();
      return json(res, 200, Object.values(state.launchReviews || {}).map(item => ({ ...item, policy: undefined })));
    }
    if (req.method === 'GET' && url.pathname === '/api/alerts') {
      const wallet = String(url.searchParams.get('wallet') || '').trim();
      const state = await store.read();
      return json(res, 200, Object.values(state.alerts || {}).filter(item => !wallet || item.wallet === wallet));
    }
    if (req.method === 'GET' && url.pathname === '/api/indexer/status') {
      const state = await store.read();
      return json(res, 200, { provider: 'pump.fun', configured: true, indexedLaunches: Object.keys(state.launches).length, lastIndexedAt: state.lastIndexedAt || null, status: state.lastIndexedAt ? 'ready' : 'waiting-for-sync' });
    }
    if (req.method === 'GET' && url.pathname === '/api/launches') {
      const requestedLimit = url.searchParams.get('limit');
      const requestedOffset = url.searchParams.get('offset');
      if ((requestedLimit != null && !/^\d+$/.test(requestedLimit)) || (requestedOffset != null && !/^\d+$/.test(requestedOffset))) return json(res, 400, { error: 'limit and offset must be non-negative integers.' });
      const limit = requestedLimit == null ? null : Math.min(100, Number(requestedLimit));
      const offset = requestedOffset == null ? 0 : Math.min(100_000, Number(requestedOffset));
      return json(res, 200, await store.readLaunches({ limit, offset }));
    }
    if (req.method === 'GET' && url.pathname === '/api/referral-claims') {
      let wallet;
      try { wallet = walletKey(url.searchParams.get('wallet')); } catch { return json(res, 400, { error: 'A valid wallet query parameter is required.' }); }
      const claims = (await store.readReferralClaimsForWallet(wallet)).map(item => ({ id: item.id, level: item.level, amount: item.amount, asset: item.asset, status: item.status, createdAt: item.createdAt, expiresAt: item.expiresAt, statement: `funded.app referral reward claim ${item.id} nonce ${item.nonce}`, payoutSignature: item.payoutSignature }));
      return json(res, 200, { wallet, claims });
    }
    if (req.method === 'GET' && url.pathname === '/api/referrals/dashboard') {
      let wallet;
      try { wallet = walletKey(url.searchParams.get('wallet')); } catch { return json(res, 400, { error: 'A valid wallet query parameter is required.' }); }
      const state = await store.read(); const network = referralNetworkForWallet(state, wallet); const qualified = new Set(Object.values(state.settlements).filter(item => network.includes(item.creatorWallet)).map(item => item.creatorWallet));
      return json(res, 200, { wallet, directCreators: Object.values(state.referrals.attributions).filter(item => item.inviterWallet === wallet).length, networkCreators: network.length, qualifiedCreators: qualified.size, conversionRate: network.length ? Number((qualified.size / network.length * 100).toFixed(1)) : null });
    }
    if (req.method === 'POST' && url.pathname === '/api/launch-reviews') {
      const review = immutableLaunchReview(await body(req));
      if (!review.mint || !review.creatorWallet) return json(res, 400, { error: 'mint and creatorWallet are required.' });
      const result = await store.update(state => { const existing = state.launchReviews[review.mint]; if (existing) return existing; state.launchReviews[review.mint] = review; return review; });
      return json(res, 201, result);
    }
    if (req.method === 'POST' && url.pathname === '/api/alerts') {
      const input = await body(req); const wallet = String(input.wallet || '').trim(); const mint = String(input.mint || '').trim(); const type = String(input.type || 'graduation').trim();
      if (!wallet || !mint || !['graduation', 'risk-change', 'volume-spike'].includes(type)) return json(res, 400, { error: 'wallet, mint, and a supported alert type are required.' });
      const alert = { id: id('alert'), wallet, mint, type, threshold: Number.isFinite(Number(input.threshold)) ? Number(input.threshold) : null, status: 'active', createdAt: new Date().toISOString() };
      await store.update(state => { state.alerts[alert.id] = alert; return alert; }); return json(res, 201, alert);
    }
    if (req.method === 'POST' && url.pathname === '/api/x-intake') {
      try { const intake = normalizeXIntake(await body(req)); const record = { id: id('x_intake'), ...intake }; await store.update(state => { state.xIntake[record.id] = record; return record; }); return json(res, 201, record); } catch (error) { return json(res, 400, { error: error.message }); }
    }

    if (req.method === 'POST' && url.pathname === '/api/launches') {
      const input = await body(req); if (!input.mint || input.chain !== 'solana' || input.cluster !== solanaCluster) return json(res, 400, { error: 'A Solana launch on the configured cluster is required.' });
      const policy = canonicalLaunchPolicy(input);
      const isolated = policy.solClaimPercent > 0;
      if (isolated && !(await xFeeReadiness()).ready) return json(res, 503, { error: 'X fee claims are not operational on Devnet yet.' });
      if (isolated && (await resolveXUser(policy.xRecipient)).id !== policy.xUserId) return json(res, 409, { error: 'The X account ID changed since launch preparation; registration is blocked.' });
        const promotionTiers = createLaunchBurnTiers({
          boostAmount: Number(process.env.VITE_FUNDED_BOOST_BURN_AMOUNT || 25_000),
          proAmount: Number(process.env.VITE_FUNDED_PRO_BURN_AMOUNT || 100_000),
          premierAmount: Number(process.env.VITE_FUNDED_PREMIER_BURN_AMOUNT || 250_000),
        });
        const proof = await verifyPumpLaunch({ connection: new Connection(solanaRpcUrl, 'confirmed'), mint: input.mint, signature: input.signature || input.pumpFeeRoute?.transaction,
          promotionClaim: input.creatorLaunchBurn || null, fundedMint: String(process.env.VITE_FUNDED_TOKEN_MINT || '').trim(), promotionTiers });
      const preparedMetadata = await store.readMetadata(proof.mint);
      if (input.metadataUri && input.metadataUri !== devnetMetadataUri(proof.mint)) return json(res, 409, { error: 'Launch metadata URL does not match the mint.' });
      if (input.metadataUri && !preparedMetadata) return json(res, 409, { error: 'Signed Devnet metadata is missing.' });
      if (preparedMetadata && (preparedMetadata.creatorWallet !== proof.feePayer || preparedMetadata.name !== proof.name || preparedMetadata.symbol !== proof.symbol || (proof.uri && proof.uri !== devnetMetadataUri(proof.mint)))) return json(res, 409, { error: 'Signed metadata does not match the confirmed Pump launch.' });
      const routerConfig = feeRouterConfig();
      const configuredRouter = isolated ? deriveMintFeeRouter(routerConfig.programId, proof.mint).address.toBase58() : routerConfig?.address.toBase58();
      if (policy.creatorWallet !== proof.feePayer || policy.feeRouter !== proof.creator || policy.feeRouter !== configuredRouter) return json(res, 409, { error: 'Launch payer or Pump fee owner does not match the signed router policy.' });
      if (isolated) {
        const connection = new Connection(solanaRpcUrl, 'confirmed');
        const legacy = await connection.getAccountInfo(routerConfig.address, 'confirmed');
        const checked = await verifyMintFeeRouterAccount({ connection, programId: routerConfig.programId, mint: proof.mint, expectedAuthority: new PublicKey(legacy.data.subarray(41, 73)) });
        if (!checked.verified) return json(res, 409, { error: `The mint-specific fee router is not verified: ${checked.reason}.` });
      }
      const signature = bs58.decode(String(input.policySignature || ''));
      if (!nacl.sign.detached.verify(new TextEncoder().encode(launchPolicyStatement(input)), signature, new PublicKey(policy.creatorWallet).toBytes())) return json(res, 401, { error: 'Creator wallet signature for this launch policy is invalid.' });
      const feeDistribution = buildFeeDistributionPolicy({ creatorWalletPercent: policy.creatorWalletPercent, holderAirdropPercent: policy.holderAirdropPercent, solClaimPercent: policy.solClaimPercent, xRecipient: policy.xRecipient, feeRouterAddress: configuredRouter });
      const record = {
        ...proof, cluster: solanaCluster, creatorWallet: proof.feePayer,
        ...(preparedMetadata ? { metadataUri: devnetMetadataUri(proof.mint), description: preparedMetadata.description, imageUri: preparedMetadata.imageSha256 ? devnetImageUri(proof.mint) : 'https://metadata.funded.vip/default.svg', website: preparedMetadata.website, twitter: preparedMetadata.x, telegram: preparedMetadata.telegram } : {}),
        communityAllocation: policy.communityAllocation,
        ...(isolated ? { xUserId: policy.xUserId } : {}),
        communityAirdrop: buildCommunityAirdropPolicy({ allocationPercent: policy.communityAllocation, supply: 1_000_000_000 }),
        feeDistribution,
        solClaim: { ...buildSolClaimPolicy({ handle: policy.xRecipient, percent: policy.solClaimPercent, feeRouterAddress: configuredRouter }), forwardingStatus: isolated ? 'awaiting-mint-verified-collection' : 'not-selected' },
        pumpFeeRoute: { percent: 100, router: proof.creator, scope: isolated ? 'per-mint-v2' : 'shared-legacy', verified: true, transaction: proof.signature },
        policyStatement: launchPolicyStatement(input), policySignature: String(input.policySignature),
        id: id('launch'), updatedAt: new Date().toISOString(),
      };
      const saved = await store.update(state => {
        const existing = state.launches[record.mint];
        if (existing) {
          if (existing.policyStatement !== record.policyStatement) throw new Error('An immutable launch policy already exists for this mint.');
          return existing;
        }
        state.launches[record.mint] = record; return record;
      });
      return json(res, 201, saved);
    }

    if (req.method === 'POST' && url.pathname === '/api/settlements/claims') {
      const input = await body(req); const signature = String(input.claimSignature || '').trim(); if (!signature) return json(res, 400, { error: 'claimSignature is required.' });
      const result = await store.update(state => {
        if (state.settlements[signature]) return state.settlements[signature];
        const collection = state.collections?.[signature];
        if (!collection || collection.signature !== signature || collection.status !== 'collected' || collection.attribution !== 'mint-verified'
          || collection.cluster !== solanaCluster || !collection.mint || !Number.isSafeInteger(Number(collection.collectedLamports))
          || Number(collection.collectedLamports) <= 0) throw new Error('A positive, mint-verified collection on the configured cluster is required.');
        const launch = state.launches?.[collection.mint];
        const shares = launch?.feeDistribution?.creatorDirected?.shares;
        if (!launch?.onchainVerified || launch.cluster !== solanaCluster || !launch.creatorWallet || !shares) throw new Error('A verified launch with an immutable fee policy is required.');
        const creatorWallet = walletKey(launch.creatorWallet);
        const policy = { ...shares, xRecipient: launch.feeDistribution.creatorDirected.recipients?.xAccount || null };
        const grossCreatorFees = Number(collection.collectedLamports) / 1_000_000_000;
        const referralRecipients = referralUplineForWallet(state, creatorWallet);
        const settlement = settleCreatorFeeClaim({ claimSignature: signature, grossCreatorFees, asset: 'SOL', claimedAt: collection.recordedAt }, policy, { referralRecipients });
        settlement.creatorWallet = creatorWallet;
        settlement.referralResolution = { source: 'server-referral-graph', directInviter: referralRecipients[0] || null, depth: referralRecipients.length };
        state.settlements[signature] = settlement;
        settlement.fundedApp.referralClaims = settlement.fundedApp.referralLevels
          .filter(level => level.recipient && level.status === 'claimable')
          .map(level => ({ level: level.level, recipient: level.recipient, amount: level.amount, status: 'claimable' }));
        return settlement;
      }); return json(res, 201, result);
    }

    if (req.method === 'POST' && url.pathname === '/api/referral-claims/prepare') {
      const input = await body(req);
      const settlementSignature = String(input.settlementSignature || '').trim();
      let recipientWallet;
      try { recipientWallet = walletKey(input.recipientWallet); } catch { return json(res, 400, { error: 'A valid recipientWallet is required.' }); }
      const levelNumber = Number(input.level);
      if (!settlementSignature || !recipientWallet || !Number.isInteger(levelNumber)) return json(res, 400, { error: 'settlementSignature, recipientWallet, and level are required.' });
      const claim = await store.update(state => {
        const settlement = state.settlements[settlementSignature];
        const level = settlement?.fundedApp?.referralLevels?.find(item => item.level === levelNumber && item.recipient === recipientWallet && item.status === 'claimable');
        if (!level) throw new Error('No claimable referral reward matches this wallet.');
        const existing = Object.values(state.referralClaims || {}).find(item => item.settlementSignature === settlementSignature && item.level === levelNumber && item.recipientWallet === recipientWallet);
        if (existing) return existing;
        const createdAt = new Date().toISOString(); const created = { id: id('referral_claim'), settlementSignature, level: levelNumber, recipientWallet, amount: level.amount, asset: settlement.asset, nonce: randomBytes(24).toString('hex'), status: 'awaiting-wallet-signature', createdAt, expiresAt: new Date(Date.now() + referralClaimExpiryMs).toISOString() };
        state.referralClaims[created.id] = created;
        return created;
      });
      return json(res, 200, { ...claim, statement: `funded.app referral reward claim ${claim.id} nonce ${claim.nonce}`, expiresInMinutes: 14 * 24 * 60 });
    }

    const referralClaimId = route(url.pathname, req.method, /^\/api\/referral-claims\/([^/]+)\/verify$/);
    if (referralClaimId) {
      const input = await body(req); const state = await store.read(); const claim = state.referralClaims?.[referralClaimId]; if (!claim) return json(res, 404, { error: 'Referral claim not found.' });
      if (claim.status === 'wallet-verified' || claim.status === 'paid') return json(res, 200, claim);
      if (claim.status === 'executing' || (claim.expiresAt && Date.parse(claim.expiresAt) < Date.now())) return json(res, 409, { error: 'Referral claim is no longer available.' });
      const publicKey = new PublicKey(String(input.publicKey || '')); if (publicKey.toBase58() !== claim.recipientWallet) return json(res, 401, { error: 'The claiming wallet must match the referral recipient.' });
      const message = new TextEncoder().encode(`funded.app referral reward claim ${referralClaimId} nonce ${claim.nonce}`); const signature = bs58.decode(String(input.signature || ''));
      if (!nacl.sign.detached.verify(message, signature, publicKey.toBytes())) return json(res, 401, { error: 'Wallet signature is invalid.' });
      const updated = await store.update(current => { current.referralClaims[referralClaimId] = { ...claim, publicKey: publicKey.toBase58(), status: 'wallet-verified', verifiedAt: new Date().toISOString() }; return current.referralClaims[referralClaimId]; }); return json(res, 200, updated);
    }

    const referralExecuteId = route(url.pathname, req.method, /^\/api\/referral-claims\/([^/]+)\/execute$/);
    if (referralExecuteId) {
      const state = await store.read(); const claim = state.referralClaims?.[referralExecuteId]; if (!claim) return json(res, 404, { error: 'Referral claim not found.' });
      if (claim.status === 'paid') return json(res, 200, state.payouts[claim.payoutId]);
      if (claim.status !== 'wallet-verified') return json(res, 409, { error: 'The referral claim must be wallet-signed before execution.' });
      if (claim.expiresAt && Date.parse(claim.expiresAt) < Date.now()) return json(res, 409, { error: 'Referral claim has expired.' });
      if (claim.asset !== 'SOL') return json(res, 409, { error: 'Only SOL referral claims are executable by this keeper.' });
      const amountSol = Number(claim.amount); if (!Number.isFinite(amountSol) || amountSol <= 0 || amountSol > maxReferralPayoutSol) return json(res, 409, { error: 'Referral claim exceeds the configured payout limit.' });
      const locked = await store.update(current => {
        const currentClaim = current.referralClaims[referralExecuteId];
        if (currentClaim.status !== 'wallet-verified') return null;
        currentClaim.status = 'executing'; currentClaim.executionStartedAt = new Date().toISOString(); return currentClaim;
      });
      if (!locked) return json(res, 409, { error: 'Referral claim is already being executed.' });
      try {
        const transfer = await executeSolPayout({ recipientWallet: claim.recipientWallet, amountSol });
        const payout = await store.update(current => {
          const record = { id: id('payout'), claimId: referralExecuteId, amountSol, ...transfer, status: 'paid', paidAt: new Date().toISOString(), source: 'solana-keeper-referral-claim' };
          current.payouts[record.id] = record; current.referralClaims[referralExecuteId] = { ...claim, status: 'paid', payoutId: record.id, payoutSignature: transfer.signature, paidAt: record.paidAt }; return record;
        });
        return json(res, 200, payout);
      } catch (error) {
        await store.update(current => { current.referralClaims[referralExecuteId] = { ...claim, status: 'failed', failureReason: error.message, failedAt: new Date().toISOString() }; return current.referralClaims[referralExecuteId]; });
        throw error;
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/payout-obligations/sol') {
      return json(res, 410, { error: 'Caller-supplied SOL payout amounts are disabled. Use verified per-mint fee collections.' });
    }
    if (req.method === 'POST' && url.pathname === '/api/x-fee/obligations') {
      if (!requireAuthorized(req, res)) return;
      const input = await body(req);
      const obligation = await store.update(state => {
        const computed = deriveXFeeObligation(state, input);
        const existing = state.obligations[computed.id];
        if (existing) return existing;
        state.obligations[computed.id] = { ...computed, createdAt: new Date().toISOString() };
        return state.obligations[computed.id];
      });
      return json(res, 201, obligation);
    }

    const claimId = decodeURIComponent(route(url.pathname, req.method, /^\/api\/sol-claims\/([^/]+)\/prepare$/) || '');
    if (claimId) {
      const input = await body(req); const recipient = String(input.xHandle || input.recipient || '').trim();
      const session = xSession(req);
      if (!session?.user?.id || `@${session.user.username}`.toLowerCase() !== recipient.toLowerCase()) return json(res, 401, { error: 'Sign in with the recipient X account before preparing a claim.' });
      const obligation = (await store.read()).obligations[claimId];
      if (!obligation || obligation.source !== 'verified-per-mint-router-collection' || obligation.xUserId !== String(session.user.id)) return json(res, 409, { error: 'A verified X fee obligation for this X user ID is required.' });
      const claim = await store.update(state => state.claims[claimId] || (state.claims[claimId] = { id: claimId, recipient: obligation.recipient, xUserId: obligation.xUserId, obligationId: obligation.id, nonce: randomBytes(24).toString('hex'), status: 'awaiting-wallet-signature', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString() }));
      if (claim.xUserId !== String(session.user.id)) return json(res, 409, { error: 'Claim X user ID does not match the original account.' });
      if (claim.expiresAt && Date.parse(claim.expiresAt) < Date.now()) return json(res, 409, { error: 'Claim has expired; contact support for a new claim window.' });
      return json(res, 200, { claimId, recipient: claim.recipient, statement: `funded.app SOL claim ${claimId} for ${claim.recipient} nonce ${claim.nonce}`, expiresAt: claim.expiresAt });
    }

    const verifyId = decodeURIComponent(route(url.pathname, req.method, /^\/api\/sol-claims\/([^/]+)\/verify$/) || '');
    if (verifyId) {
      const input = await body(req); const state = await store.read(); const claim = state.claims[verifyId]; if (!claim) return json(res, 404, { error: 'Claim not found.' });
      const session = xSession(req);
      if (!session?.user?.id || String(session.user.id) !== claim.xUserId) return json(res, 401, { error: 'Sign in with the original X account before verifying a wallet.' });
      if (String(input.xHandle || input.recipient || '').toLowerCase() !== `@${session.user.username}`.toLowerCase()) return json(res, 409, { error: 'X handle does not match the signed-in account.' });
      if (claim.expiresAt && Date.parse(claim.expiresAt) < Date.now()) return json(res, 409, { error: 'Claim has expired.' });
      const publicKey = new PublicKey(String(input.publicKey || '')); const message = new TextEncoder().encode(`funded.app SOL claim ${verifyId} for ${claim.recipient} nonce ${claim.nonce}`); const signature = bs58.decode(String(input.signature || ''));
      if (!nacl.sign.detached.verify(message, signature, publicKey.toBytes())) return json(res, 401, { error: 'Wallet signature is invalid.' });
      if (claim.publicKey && claim.publicKey !== publicKey.toBase58()) return json(res, 409, { error: 'Claim is already bound to another verified wallet.' });
      const updated = await store.update(current => { const existing = current.claims[verifyId]; if (existing.publicKey && existing.publicKey !== publicKey.toBase58()) throw new Error('Claim is already bound to another verified wallet.'); if (existing.status === 'paid' || existing.status === 'executing') return existing; current.claims[verifyId] = { ...existing, publicKey: publicKey.toBase58(), status: existing.xAttestation ? 'ready-to-execute' : 'wallet-verified', verifiedAt: new Date().toISOString() }; return current.claims[verifyId]; }); return json(res, 200, updated);
    }

    const attestId = decodeURIComponent(route(url.pathname, req.method, /^\/api\/sol-claims\/([^/]+)\/attest$/) || '');
    if (attestId) {
      const input = await body(req); const handle = String(input.xHandle || input.recipient || '').trim();
      if (!/^@[A-Za-z0-9_]{1,15}$/.test(handle)) return json(res, 400, { error: 'A valid X handle is required.' });
      const state = await store.read(); const claim = state.claims[attestId]; if (!claim) return json(res, 404, { error: 'Claim not found.' });
      const session = xSession(req);
      const oauthMatchesHandle = session?.user?.id && String(session.user.id) === claim.xUserId && `@${session.user.username}`.toLowerCase() === handle.toLowerCase();
      const trusted = Boolean(oauthMatchesHandle) || (String(input.subject || '') === claim.xUserId && verifyHmacAttestation({ handle, subject: input.subject, issuedAt: input.issuedAt, signature: input.signature }));
      if (!trusted) return json(res, 401, { error: 'Trusted X identity attestation is required.' });
      if (claim.expiresAt && Date.parse(claim.expiresAt) < Date.now()) return json(res, 409, { error: 'Claim has expired.' });
      const updated = await store.update(current => { const existing = current.claims[attestId]; if (existing.status === 'paid' || existing.status === 'executing') return existing; current.claims[attestId] = { ...existing, xAttestation: { provider: oauthMatchesHandle ? 'x-oauth' : 'trusted-webhook', subject: oauthMatchesHandle ? String(session.user.id) : String(input.subject), attestedAt: new Date().toISOString() }, status: existing.publicKey ? 'ready-to-execute' : 'x-attested-awaiting-wallet' }; return current.claims[attestId]; });
      return json(res, 200, updated);
    }

    const executeId = decodeURIComponent(route(url.pathname, req.method, /^\/api\/sol-claims\/([^/]+)\/execute$/) || '');
    if (executeId) {
      const state = await store.read(); const claim = state.claims[executeId]; if (!claim) return json(res, 404, { error: 'Claim not found.' });
      if (claim.expiresAt && Date.parse(claim.expiresAt) < Date.now()) return json(res, 409, { error: 'Claim has expired.' });
      if (!claim.xAttestation || claim.xAttestation.subject !== claim.xUserId) return json(res, 409, { error: 'The original X user ID must be attested before payout.' });
      if (!claim.publicKey) return json(res, 409, { error: 'A verified recipient wallet is required before payout.' });
      const existing = Object.values(state.payouts).find(item => item.claimId === executeId);
      if (existing) return json(res, 200, existing);
      const obligation = state.obligations[claim.obligationId];
      if (!obligation || obligation.source !== 'verified-per-mint-router-collection') return json(res, 409, { error: 'A verified router-funded X fee obligation is required.' });
      const recalculated = deriveXFeeObligation(state, { mint: obligation.mint, claimSignature: obligation.claimSignature });
      if (recalculated.id !== obligation.id || recalculated.amountLamports !== obligation.amountLamports || recalculated.router !== obligation.router || recalculated.recipient !== obligation.recipient || recalculated.xUserId !== obligation.xUserId || claim.xUserId !== obligation.xUserId) return json(res, 409, { error: 'Stored X fee amount or user ID does not match the verified launch policy and collection.' });
      const readiness = await xFeeReadiness();
      if (!readiness.ready) return json(res, 503, { error: 'Mint-router payout is not active on Devnet.', reasons: readiness.reasons });
      const config = feeRouterConfig();
      const authority = routerAuthorityKeypair();
      const connection = new Connection(solanaRpcUrl, 'confirmed');
      const launch = state.launches[obligation.mint];
      const collection = state.collections[obligation.claimSignature];
      if (!launch?.onchainVerified || launch.pumpFeeRoute?.scope !== 'per-mint-v2' || launch.creator !== obligation.router || collection?.mint !== obligation.mint || collection?.router !== obligation.router || !collection.onchainVerified || collection.status !== 'collected' || obligation.recipient !== claim.recipient || claim.obligationId !== obligation.id) return json(res, 409, { error: 'Mint-specific launch, collection, and claim records do not match.' });
      const checked = await verifyMintFeeRouterAccount({ connection, programId: config.programId, mint: obligation.mint, expectedAuthority: authority.publicKey });
      if (!checked.verified || checked.address.toBase58() !== obligation.router) return json(res, 409, { error: 'The on-chain mint router does not match this payout obligation.' });
      const settlement = buildMintRouterSettlementInstruction({ programId: config.programId, mint: obligation.mint, authority: authority.publicKey, recipient: claim.publicKey, amountLamports: obligation.amountLamports, obligationId: obligation.id });
      const recordMatches = account => readMintClaimRecord(account, { programId: config.programId, mint: obligation.mint, recipient: claim.publicKey, amountLamports: obligation.amountLamports, claimId: settlement.claimId });
      const priorRecord = await connection.getAccountInfo(settlement.claim, 'confirmed');
      if (priorRecord && !recordMatches(priorRecord)) return json(res, 409, { error: 'The on-chain claim record conflicts with this obligation.' });
      const locked = await store.update(current => {
        const currentClaim = current.claims[executeId];
        if (currentClaim.status === 'paid' || currentClaim.status === 'executing') return false;
        if (!currentClaim.xAttestation || !currentClaim.publicKey || currentClaim.publicKey !== claim.publicKey) return false;
        currentClaim.status = 'executing'; currentClaim.executionStartedAt = new Date().toISOString(); return true;
      });
      if (!locked) return json(res, 409, { error: 'This claim is already executing or has been paid. Refresh its status.' });
      let signature = null;
      try {
        if (priorRecord) {
          const signatures = await connection.getSignaturesForAddress(settlement.claim, { limit: 1 }, 'confirmed');
          signature = signatures[0]?.signature || null;
        } else {
          const transaction = new Transaction().add(settlement.instruction);
          signature = await sendAndConfirmTransaction(connection, transaction, [authority], { commitment: 'confirmed' });
        }
        const onchainRecord = await connection.getAccountInfo(settlement.claim, 'confirmed');
        if (!recordMatches(onchainRecord)) throw new Error('Settlement submitted, but the matching on-chain claim record is not confirmed yet.');
        if (!signature) throw new Error('On-chain claim record exists, but its transaction signature is not indexed yet.');
        const paidAt = new Date().toISOString();
        const payout = await store.update(current => {
          const payoutId = `x:${executeId}`;
          const record = { id: payoutId, claimId: executeId, obligationId: obligation.id, mint: obligation.mint, amountLamports: obligation.amountLamports, amountSol: obligation.amountSol, from: settlement.router.toBase58(), to: claim.publicKey, signature, status: 'paid', paidAt, source: 'mint-router-settle-mint', cluster: solanaCluster };
          current.payouts[payoutId] = record;
          current.claims[executeId] = { ...current.claims[executeId], status: 'paid', payoutId, payoutSignature: signature, paidAt };
          return record;
        });
        return json(res, 200, payout);
      } catch (error) {
        await store.update(current => { if (current.claims[executeId]?.status === 'executing') current.claims[executeId] = { ...current.claims[executeId], status: 'verification-pending', failureReason: String(error.message || error), lastAttemptAt: new Date().toISOString() }; });
        throw error;
      }
    }

    const metadataMint = req.method === 'GET' ? url.pathname.match(/^\/devnet-metadata\/([1-9A-HJ-NP-Za-km-z]{32,44})$/)?.[1] : null;
    if (metadataMint) {
      const launch = await store.readLaunch(metadataMint);
      const routerAddress = feeRouterConfig()?.address.toBase58();
      if (!launch || launch.cluster !== 'devnet' || !launch.onchainVerified || launch.creator !== routerAddress || !launch.name || !launch.symbol) return json(res, 404, { error: 'Verified Devnet launch metadata is not available.' });
      return json(res, 200, { name: launch.name, symbol: launch.symbol, description: 'Devnet test token launched on funded.vip. Devnet assets have no intended monetary value.', image: 'https://funded.vip/favicon.svg' });
    }
    if (req.method === 'GET' && isAppPagePath(url.pathname)) return serveStatic('/', res);
    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) return serveStatic(url.pathname, res);
    return json(res, 404, { error: 'Not found.' });
  } catch (error) {
    if (error.statusCode === 413) return json(res, 413, { error: 'Request body too large.' });
    if (error.severity || ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].includes(error.code)) {
      console.error('Backend dependency failure:', error);
      return json(res, 503, { error: 'Backend dependency is temporarily unavailable.' });
    }
    return json(res, 400, { error: error.message || 'Request failed.' });
  }
}

await store.read();
const server = createServer(handle);
server.headersTimeout = 10_000;
server.requestTimeout = 30_000;
server.timeout = 120_000;
server.listen(port, host, () => console.log(`funded.vip app listening on http://${host}:${port}`));
