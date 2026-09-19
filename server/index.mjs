import { createServer } from 'node:http';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { isIP } from 'node:net';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { buildSolClaimPolicy } from '../sol-claim-policy.js';
import { buildFeeDistributionPolicy, settleCreatorFeeClaim } from '../distribution-policy.js';
import { buildCommunityAirdropPolicy } from '../airdrop-policy.js';
import { canonicalLaunchPolicy, launchPolicyStatement } from '../launch-policy-auth.js';
import { createReferralCode, normalizeReferralCode, resolveReferralUpline } from '../referral-program.js';
import { deriveFeeRouter, verifyFeeRouterAccount } from '../fee-router.js';
import { OnlinePumpSdk } from '@pump-fun/pump-sdk';
import { createStore } from './store.mjs';
import { readPumpMarketActivity } from './coin-market.mjs';
import { buildRewardCycle, validateRewardConfig } from '../reward-policy.js';
import { analyzeLaunchActivity } from '../anti-sniper-policy.js';
import { buildProductionReadiness } from '../production-readiness.js';
import { buildTerminalSignal, creatorReputation, immutableLaunchReview, normalizeXIntake, quoteAssetCatalog } from '../stonk-features.js';
import { verifyPumpLaunch } from './launch-verification.mjs';
import { deriveXFeeObligation } from './x-fee-guard.mjs';

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
let rpcInflight = 0;
let verifiedQuoteAssetsCache = null;
const solanaCluster = String(process.env.VITE_SOLANA_CLUSTER || process.env.SOLANA_CLUSTER || 'devnet').trim();
const devnetTestMode = solanaCluster === 'devnet' && process.env.DEVNET_TEST_MODE === 'true';
if (process.env.RPC_ALLOW_EXPENSIVE_METHODS === 'true') rpcMethods.add('getProgramAccounts');
if (devnetTestMode && process.env.RPC_ALLOW_AIRDROP === 'true') rpcMethods.add('requestAirdrop');
const xAttestationSecret = String(process.env.X_ATTESTATION_SECRET || '').trim();
const referralClaimExpiryMs = 14 * 24 * 60 * 60 * 1000;
const maxReferralPayoutSol = Number(process.env.MAX_REFERRAL_PAYOUT_SOL || 10);
const coinMarketCache = new Map();
const coinMarketInflight = new Map();
let coinMarketActive = 0;
let configuredQuoteAssets = [];
try { configuredQuoteAssets = JSON.parse(process.env.FUNDED_QUOTE_ASSETS_JSON || '[]'); } catch { configuredQuoteAssets = []; }

function json(res, status, body) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': process.env.CORS_ORIGIN || '*' }); res.end(JSON.stringify(body)); }
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
  let data = ''; for await (const chunk of req) { data += chunk; if (Buffer.byteLength(data) > maxBodyBytes) throw new Error('Request body too large.'); }
  return data ? JSON.parse(data) : {};
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
  const now = Date.now();
  if (['sendTransaction', 'simulateTransaction'].includes(request.method) && (typeof request.params[0] !== 'string' || request.params[0].length > 3_000)) return json(res, 400, { error: 'Invalid serialized transaction.' });
  if (request.method === 'getSignaturesForAddress' && Number(request.params[1]?.limit || 100) > 100) return json(res, 400, { error: 'Signature lookup limit exceeds 100.' });
  const cacheable = !['sendTransaction', 'simulateTransaction', 'requestAirdrop'].includes(request.method);
  const cacheKey = cacheable ? JSON.stringify([request.method, request.params]) : null;
  const cached = cacheKey && rpcCache.get(cacheKey);
  const client = clientKey(req);
  const windowStart = Math.floor(now / 60_000) * 60_000;
  const cost = cached?.expiresAt > now ? 1 : ({ getProgramAccounts: 20, sendTransaction: 10, simulateTransaction: 8, getTransaction: 3, getSignaturesForAddress: 3, requestAirdrop: 20 }[request.method] || 1);
  if (!await store.chargeRpcRate(`rpc:${client}`, cost, 120, windowStart)
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
function authorized(req) { const token = String(process.env.FUNDED_API_TOKEN || '').trim(); return Boolean(token) && req.headers.authorization === `Bearer ${token}`; }
function requireAuthorized(req, res) { const token = String(process.env.FUNDED_API_TOKEN || '').trim(); if (token && req.headers.authorization === `Bearer ${token}`) return true; json(res, 401, { error: 'Keeper/indexer API authorization is required.' }); return false; }
function walletKey(value) { return new PublicKey(String(value || '').trim()).toBase58(); }
function referralCodeFromBytes() { return createReferralCode(Uint8Array.from(randomBytes(6))); }
function referralUplineForWallet(state, wallet) {
  const direct = state.referrals.attributions[wallet]?.inviterWallet || null;
  if (!direct) return [];
  const graph = Object.fromEntries(Object.values(state.referrals.attributions).map(item => [item.wallet, item.inviterWallet]).filter(([key]) => key));
  return resolveReferralUpline(direct, graph, 3);
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
  return {
    mint,
    name: String(item.name || 'Unnamed Pump coin').slice(0, 80),
    symbol: String(item.symbol || 'TOKEN').slice(0, 20),
    creator: String(item.creator || '').trim() || null,
    description: item.description || null,
    imageUri: item.image_uri || item.image || null,
    metadataUri: item.metadata_uri || item.uri || null,
    website: item.website || null,
    twitter: item.twitter || null,
    telegram: item.telegram || null,
    marketCapUsd: Number.isFinite(Number(item.usd_market_cap)) ? Number(item.usd_market_cap) : null,
    complete: Boolean(item.complete),
    bondingCurve: item.bonding_curve || null,
    raydiumPool: item.raydium_pool || null,
    virtualSolReserves: item.virtual_sol_reserves ?? null,
    virtualTokenReserves: item.virtual_token_reserves ?? null,
    realSolReserves: item.real_sol_reserves ?? null,
    realTokenReserves: item.real_token_reserves ?? null,
    createdTimestamp: item.created_timestamp ?? item.createdTimestamp ?? null,
    lastTradeTimestamp: item.last_trade_timestamp || null,
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
function keeperKeypair() {
  const encoded = String(process.env.SOLANA_KEEPER_SECRET_KEY || '').trim();
  if (!encoded) return null;
  return Keypair.fromSecretKey(bs58.decode(encoded));
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
  const router = feeRouterConfig();
  if (!keeper || !router || (!process.env.SOLANA_KEEPER_CONFIGURED && !devnetTestMode)) throw new Error('Keeper and fee-router configuration are required.');
  const connection = new Connection(solanaRpcUrl, 'confirmed');
  const verification = await verifyFeeRouterAccount({ connection, programId: router.programId.toBase58() });
  if (!verification.verified) throw new Error(`Fee router is not deployable: ${verification.reason}.`);
  const mintKey = requestedMint ? new PublicKey(String(requestedMint)) : null;
  const beforeLamports = await connection.getBalance(router.address, 'confirmed');
  const instructions = await new OnlinePumpSdk(connection).collectCoinCreatorFeeInstructions(router.address, keeper.publicKey);
  if (!instructions.length) return { requestedMint: mintKey?.toBase58() || null, mint: null, attribution: 'router', router: router.address.toBase58(), status: 'nothing-to-collect', beforeLamports, afterLamports: beforeLamports };
  const latest = await connection.getLatestBlockhash('confirmed');
  const transaction = new Transaction().add(...instructions);
  transaction.recentBlockhash = latest.blockhash; transaction.feePayer = keeper.publicKey;
  const signature = await sendAndConfirmTransaction(connection, transaction, [keeper], { commitment: 'confirmed' });
  const afterLamports = await connection.getBalance(router.address, 'confirmed');
  const collectedLamports = Math.max(0, afterLamports - beforeLamports);
  return { requestedMint: mintKey?.toBase58() || null, mint: null, attribution: 'router', router: router.address.toBase58(), signature, beforeLamports, afterLamports, collectedLamports, cluster: solanaCluster, status: collectedLamports > 0 ? 'collected' : 'no-fees' };
}

async function handle(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': process.env.CORS_ORIGIN || '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type, solana-client' }); return res.end(); }
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (req.method === 'POST' && url.pathname !== '/api/solana/rpc') {
      const cost = url.pathname === '/api/launches' ? 10 : url.pathname.startsWith('/api/referrals/') ? 5 : 1;
      const windowStart = Math.floor(Date.now() / 60_000) * 60_000;
      if (!await store.chargeRpcRate(`api:${clientKey(req)}`, cost, 120, windowStart)) return json(res, 429, { error: 'API request limit reached; retry shortly.' });
    }
    if (req.method === 'POST' && url.pathname === '/api/solana/rpc') return await proxySolanaRpc(req, res);
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, service: 'funded-api', external: { solanaKeeper: Boolean(process.env.SOLANA_KEEPER_CONFIGURED), feeRouter: Boolean(feeRouterConfig()), birdeye: Boolean(birdeyeApiKey), pumpFun: Boolean(pumpApiUrl), pumpApiUrl } });
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
        const state = await store.read();
        const connection = new Connection(solanaRpcUrl, 'confirmed');
        const candidates = Object.values(state.launches || {}).filter(item => item?.mint && item?.chain === 'solana' && (item.cluster || 'devnet') === 'devnet');
        const verified = await Promise.all(candidates.map(async item => {
          if (item.onchainVerified) return item;
          try {
            const proof = await verifyPumpLaunch({ connection, mint: item.mint, signature: item.signature || item.pumpFeeRoute?.transaction });
            const updated = { ...item, ...proof, cluster: 'devnet' };
            await store.update(state => { state.launches[item.mint] = updated; return updated; });
            return updated;
          } catch { return null; }
        }));
        const localItems = verified.filter(Boolean).map(normalizePumpToken);
        return json(res, 200, { provider: 'funded.app-devnet-registry', chain: 'solana', cluster: 'devnet', fetchedAt: new Date().toISOString(), items: localItems.filter(Boolean).slice(offset, offset + limit) });
      }
      const items = await fetchPump('/coins', { offset: String(offset), limit: String(limit), sort, order: 'DESC', includeNsfw: 'false' });
      return json(res, 200, { provider: 'pump.fun', chain: 'solana', fetchedAt: new Date().toISOString(), apiBase: pumpApiUrl, items: items.map(normalizePumpToken).filter(Boolean) });
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
      const cached = coinMarketCache.get(address);
      if (cached && Date.now() - cached.at < 60_000) return json(res, 200, cached.data);
      const persisted = await store.readMarketActivity(address, solanaCluster);
      if (persisted && Date.now() - Date.parse(persisted.observedAt) < 60_000) {
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
      if (result.signature) await store.update(state => { state.collections[result.signature] = { id: result.signature, ...result, recordedAt: new Date().toISOString() }; return result; });
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
    if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, publicState(await store.read()));
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
      const state = await store.read();
      const launches = Object.values(state.launches || {}).filter(item => item.onchainVerified && item.cluster === solanaCluster).map(item => ({ ...item, ...buildTerminalSignal(item) }));
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
    if (req.method === 'GET' && url.pathname === '/api/launches') return json(res, 200, Object.values((await store.read()).launches));
    if (req.method === 'GET' && url.pathname === '/api/referral-claims') {
      let wallet;
      try { wallet = walletKey(url.searchParams.get('wallet')); } catch { return json(res, 400, { error: 'A valid wallet query parameter is required.' }); }
      const claims = Object.values((await store.read()).referralClaims || {}).filter(item => item.recipientWallet === wallet).map(item => ({ id: item.id, level: item.level, amount: item.amount, asset: item.asset, status: item.status, createdAt: item.createdAt, expiresAt: item.expiresAt, statement: `funded.app referral reward claim ${item.id} nonce ${item.nonce}`, payoutSignature: item.payoutSignature }));
      return json(res, 200, { wallet, claims });
    }
    const publicSignedPost = url.pathname === '/api/launches' || /^\/api\/sol-claims\/[^/]+\/(?:prepare|verify)$/.test(url.pathname)
      || /^\/api\/referral-claims\/[^/]+\/(?:verify|execute)$/.test(url.pathname);
    if (req.method === 'POST' && !publicSignedPost && !authorized(req)) return json(res, 401, { error: 'API authorization required.' });

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
      const proof = await verifyPumpLaunch({ connection: new Connection(solanaRpcUrl, 'confirmed'), mint: input.mint, signature: input.signature || input.pumpFeeRoute?.transaction });
      const policy = canonicalLaunchPolicy(input);
      const configuredRouter = feeRouterConfig()?.address.toBase58();
      if (policy.creatorWallet !== proof.feePayer || policy.feeRouter !== proof.creator || policy.feeRouter !== configuredRouter) return json(res, 409, { error: 'Launch payer or Pump fee owner does not match the signed router policy.' });
      const signature = bs58.decode(String(input.policySignature || ''));
      if (!nacl.sign.detached.verify(new TextEncoder().encode(launchPolicyStatement(input)), signature, new PublicKey(policy.creatorWallet).toBytes())) return json(res, 401, { error: 'Creator wallet signature for this launch policy is invalid.' });
      const feeDistribution = buildFeeDistributionPolicy({ creatorWalletPercent: policy.creatorWalletPercent, holderAirdropPercent: policy.holderAirdropPercent, solClaimPercent: policy.solClaimPercent, xRecipient: policy.xRecipient, feeRouterAddress: configuredRouter });
      const record = {
        ...proof, cluster: solanaCluster, creatorWallet: proof.feePayer,
        communityAllocation: policy.communityAllocation,
        communityAirdrop: buildCommunityAirdropPolicy({ allocationPercent: policy.communityAllocation, supply: 1_000_000_000 }),
        feeDistribution,
        solClaim: { ...buildSolClaimPolicy({ handle: policy.xRecipient, percent: policy.solClaimPercent, feeRouterAddress: configuredRouter }), forwardingStatus: policy.solClaimPercent > 0 ? 'blocked-shared-router' : 'not-selected' },
        pumpFeeRoute: { percent: 100, router: proof.creator, scope: 'shared-legacy', verified: true, transaction: proof.signature },
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

    const claimId = route(url.pathname, req.method, /^\/api\/sol-claims\/([^/]+)\/prepare$/);
    if (claimId) {
      const input = await body(req); const recipient = String(input.xHandle || input.recipient || '').trim();
      const obligation = (await store.read()).obligations[claimId];
      if (!obligation || obligation.source !== 'verified-per-mint-router-collection' || obligation.recipient !== recipient) return json(res, 409, { error: 'A verified X fee obligation for this handle is required.' });
      const claim = await store.update(state => state.claims[claimId] || (state.claims[claimId] = { id: claimId, recipient, obligationId: obligation.id, nonce: randomBytes(24).toString('hex'), status: 'awaiting-wallet-signature', createdAt: new Date().toISOString() }));
      if (claim.recipient !== recipient) return json(res, 409, { error: 'Claim recipient does not match the original X handle.' });
      return json(res, 200, { claimId, recipient: claim.recipient, statement: `funded.app SOL claim ${claimId} for ${claim.recipient} nonce ${claim.nonce}`, expiresInMinutes: 14 * 24 * 60 });
    }

    const verifyId = route(url.pathname, req.method, /^\/api\/sol-claims\/([^/]+)\/verify$/);
    if (verifyId) {
      const input = await body(req); const state = await store.read(); const claim = state.claims[verifyId]; if (!claim) return json(res, 404, { error: 'Claim not found.' });
      if (String(input.xHandle || input.recipient || '') !== claim.recipient) return json(res, 409, { error: 'X handle does not match the prepared claim.' });
      const publicKey = new PublicKey(String(input.publicKey || '')); const message = new TextEncoder().encode(`funded.app SOL claim ${verifyId} for ${claim.recipient} nonce ${claim.nonce}`); const signature = bs58.decode(String(input.signature || ''));
      if (!nacl.sign.detached.verify(message, signature, publicKey.toBytes())) return json(res, 401, { error: 'Wallet signature is invalid.' });
      const updated = await store.update(current => { current.claims[verifyId] = { ...claim, publicKey: publicKey.toBase58(), status: 'wallet-verified', verifiedAt: new Date().toISOString() }; return current.claims[verifyId]; }); return json(res, 200, { ...updated, status: process.env.SOLANA_KEEPER_CONFIGURED ? 'queued-for-keeper' : 'verified-awaiting-keeper' });
    }

    const attestId = route(url.pathname, req.method, /^\/api\/sol-claims\/([^/]+)\/attest$/);
    if (attestId) {
      const input = await body(req); const handle = String(input.xHandle || input.recipient || '').trim();
      if (!/^@[A-Za-z0-9_]{1,15}$/.test(handle)) return json(res, 400, { error: 'A valid X handle is required.' });
      const trusted = verifyHmacAttestation({ handle, subject: input.subject, issuedAt: input.issuedAt, signature: input.signature });
      if (!trusted) return json(res, 401, { error: 'Trusted X identity attestation is required.' });
      const state = await store.read(); const claim = state.claims[attestId]; if (!claim) return json(res, 404, { error: 'Claim not found.' });
      if (claim.recipient !== handle) return json(res, 409, { error: 'X handle does not match the prepared claim.' });
      const updated = await store.update(current => { current.claims[attestId] = { ...claim, xAttestation: { provider: 'trusted-webhook', subject: String(input.subject || handle), attestedAt: new Date().toISOString() }, status: 'x-attested-awaiting-wallet' }; return current.claims[attestId]; });
      return json(res, 200, updated);
    }

    const executeId = route(url.pathname, req.method, /^\/api\/sol-claims\/([^/]+)\/execute$/);
    if (executeId) {
      if (!requireAuthorized(req, res)) return;
      const state = await store.read(); const claim = state.claims[executeId]; if (!claim) return json(res, 404, { error: 'Claim not found.' });
      if (!claim.xAttestation) return json(res, 409, { error: 'X identity must be attested before payout.' });
      if (!claim.publicKey) return json(res, 409, { error: 'A verified recipient wallet is required before payout.' });
      const existing = Object.values(state.payouts).find(item => item.claimId === executeId);
      if (existing) return json(res, 200, existing);
      const obligation = state.obligations[claim.obligationId];
      if (!obligation || obligation.source !== 'verified-per-mint-router-collection') return json(res, 409, { error: 'A verified router-funded X fee obligation is required.' });
      return json(res, 503, { error: 'Router-backed X payout is not deployed; keeper-wallet transfers are disabled for X fee claims.' });
    }

    const metadataMint = req.method === 'GET' ? url.pathname.match(/^\/devnet-metadata\/([1-9A-HJ-NP-Za-km-z]{32,44})$/)?.[1] : null;
    if (metadataMint) {
      const launch = (await store.read()).launches[metadataMint];
      const routerAddress = feeRouterConfig()?.address.toBase58();
      if (!launch || launch.cluster !== 'devnet' || !launch.onchainVerified || launch.creator !== routerAddress || !launch.name || !launch.symbol) return json(res, 404, { error: 'Verified Devnet launch metadata is not available.' });
      return json(res, 200, { name: launch.name, symbol: launch.symbol, description: 'Devnet test token launched on funded.vip. Devnet assets have no intended monetary value.', image: 'https://funded.vip/favicon.svg' });
    }
    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) return serveStatic(url.pathname, res);
    return json(res, 404, { error: 'Not found.' });
  } catch (error) { return json(res, 400, { error: error.message || 'Request failed.' }); }
}

await store.read();
const server = createServer(handle);
server.headersTimeout = 10_000;
server.requestTimeout = 30_000;
server.timeout = 120_000;
server.listen(port, host, () => console.log(`funded.vip app listening on http://${host}:${port}`));
