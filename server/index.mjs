import { createPublicTradeSharingRoutes } from './routes/public-trade-sharing.mjs';
import { createLaunchSupportRoutes } from './routes/launch-support.mjs';
import { createReferralActivityRoutes } from './routes/referral-activity.mjs';
import { createServiceStatusRoutes } from './routes/service-status.mjs';
import { loadServerEnvironment } from './environment.mjs';
import { startShareVisitCleanup, startCommunityClaimIndex,
  startV3HolderRewardWorker } from './background-maintenance.mjs';
import { createFeeRouterService } from './fee-router-service.mjs';
import { createPageDelivery } from './page-delivery.mjs';
import { createDiscoveryRoutes } from './routes/discovery.mjs';
import { createLaunchQuoteRoutes } from './routes/launch-quotes.mjs';
import { createRewardStatusRoutes } from './routes/reward-status.mjs';
import { createSolanaRpcProxy } from './rpc-proxy.mjs';
import { createMarketProviders, normalizePumpToken } from './market-providers.mjs';
import { createLaunchTierPricing } from './launch-tier-pricing.mjs';
import { createXIdentityRoutes } from './routes/x-identity.mjs';
import { createCreatorFeesRoutes } from './routes/creator-fees.mjs';
import { createV3Routes } from './routes/v3-routes.mjs';
import { publicWalletSignedV3Post } from './v3-public-post-paths.mjs';
import { createKeeperCollectionRoutes } from './routes/keeper-collection.mjs';
import { createListingPaymentsRoutes } from './routes/listing-payments.mjs';
import { createLaunchRegistrationRoutes } from './routes/launch-registration.mjs';
import { createPublicReportsRoutes } from './routes/public-reports.mjs';
import { createQuoteAssetsRoutes } from './routes/quote-assets.mjs';
import { createDirectoryRoutes } from './routes/directory.mjs';
import { createTokenMarketRoutes } from './routes/token-market.mjs';
import { createBoostRoutes } from './routes/boost.mjs';
import { createAirdropsRoutes } from './routes/airdrops.mjs';
import { createTokenChatRoutes } from './routes/token-chat.mjs';
import { createReferralIdentityRoutes } from './routes/referral-identity.mjs';
import { applyHttpPolicy, invalidRequest, publicError, validateInput } from './http-policy.mjs';
import { readJsonBody } from './request-body.mjs';
import { createSolUsdQuoteReader } from './price-quote.mjs';
import { createServer } from 'node:http';
import { createAutomaticRewardStore } from './automatic-reward-store.mjs';
import { DEVNET_GENESIS_HASH } from './automatic-reward-chain.mjs';

import { createCommunityClaimService } from './community-claim-service.mjs';
import { communityProgramForLaunch } from './community-program-config.mjs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { isIP } from 'node:net';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction, clusterApiUrl } from '@solana/web3.js';

import { createReferralCode } from '../referral-program.js';
import { createStore } from './store.mjs';
import { rewardLedgerPath } from './reward-ledger-path.mjs';

import { createProductMetricsStore, createProductMetricsHandler, confirmedProductTotals } from './product-metrics.mjs';


import { createCreatorSupportHandler } from './creator-support.mjs';
import { createWatchlistHandler } from './watchlists.mjs';

import { CREATOR_SUPPORT_VERSION } from '../creator-support-model.js';
import { createXAuth, cookieValue, allowedAuthOrigin, callbackUrlFor, SESSION_SECONDS } from './x-auth.mjs';
import { createMobileWalletRelay } from './mobile-wallet-relay.mjs';
import { createReceiptEvidenceReader } from './receipt-service.mjs';
import { createPaymentHistoryReader } from './payment-history.mjs';

import { verifyPumpLaunch } from './launch-verification.mjs';


import { parseSignedMetadata, publicMetadata, metadataRecordOrigin } from './devnet-metadata.mjs';
import { devnetMetadataUri, normalizeDevnetMetadataOrigin, LEGACY_DEVNET_METADATA_ORIGIN } from '../devnet-metadata.js';

import { createCreatorFeeChallenges } from './creator-fee-claim.mjs';
import { createTokenChatSessions } from './token-chat-session.mjs';
import { createXUserResolver } from './x-user-lookup.mjs';

import { createReferralAuth } from './referral-auth.mjs';

loadServerEnvironment();

const port = Number(process.env.PORT || 8787);
const host = String(process.env.HOST || '127.0.0.1');
const staticRoot = resolve(process.cwd(), 'dist');
const storePath = process.env.FUNDED_STORE_PATH || resolve(process.cwd(), 'data', 'funded-store.json');
const automaticRewardStore = createAutomaticRewardStore(rewardLedgerPath());
const creatorFeeChallenges = createCreatorFeeChallenges();

// Explicit test/worker store paths must take precedence over the local database
// profile so isolated fixtures cannot accidentally write to the shared database.
const databaseUrl = process.env.FUNDED_STORE_PATH ? '' : process.env.DATABASE_URL;
if (process.env.NODE_ENV === 'production' && !databaseUrl) throw new Error('DATABASE_URL is required in production.');
if (process.env.NODE_ENV === 'production' && !String(process.env.FUNDED_API_TOKEN || '').trim()) throw new Error('FUNDED_API_TOKEN is required in production.');
const store = createStore(storePath, databaseUrl);
const maxBodyBytes = 1_000_000;
const devnetMetadataOrigin = normalizeDevnetMetadataOrigin(process.env.DEVNET_METADATA_ORIGIN || LEGACY_DEVNET_METADATA_ORIGIN);
const birdeyeApiKey = String(process.env.BIRDEYE_API_KEY || '').trim();
const birdeyeBaseUrl = String(process.env.BIRDEYE_API_URL || 'https://public-api.birdeye.so').replace(/\/$/, '');
const birdeyeChain = String(process.env.BIRDEYE_CHAIN || 'solana').trim();
const birdeyeTimeoutMs = 10_000;
const pumpApiUrl = String(process.env.PUMP_API_URL || 'https://frontend-api-v3.pump.fun').replace(/\/$/, '');
const solanaRpcUrl = String(process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com').trim();
const fundedTokenMint = String(process.env.FUNDED_TOKEN_MINT || process.env.VITE_FUNDED_TOKEN_MINT || '').trim();
const fundedSwapPool = String(process.env.FUNDED_SWAP_POOL || process.env.VITE_FUNDED_SWAP_POOL || '').trim();
const rpcMethods = new Set(['getAccountInfo', 'getMultipleAccounts', 'getBalance', 'getSlot', 'getGenesisHash', 'getTokenSupply', 'getTokenLargestAccounts', 'getTokenAccountsByOwner', 'getTokenAccountBalance', 'getSignaturesForAddress', 'getTransaction', 'getLatestBlockhash', 'getBlockHeight', 'getSignatureStatuses', 'getFeeForMessage', 'getMinimumBalanceForRentExemption', 'getRecentPrioritizationFees', 'simulateTransaction', 'sendTransaction']);
const publicPostPaths = new Set(['/api/rewards/preview', '/api/anti-sniper/analyze', '/api/referrals/registration/prepare', '/api/referrals/registration/verify', '/api/referrals/attribution/prepare', '/api/referrals/attribution/verify', '/api/referrals/session/prepare', '/api/referrals/session/verify', '/api/referrals/session/logout', '/api/launches', '/api/listings', '/api/burn-receipts', '/api/devnet-metadata']);
publicPostPaths.add('/api/airdrops/reserves/receipt');
publicPostPaths.add('/api/airdrops/claims/claim-instruction');
publicPostPaths.add('/api/x/logout'); // Cookie-authenticated, with an exact-origin check.
publicPostPaths.add('/api/shares/visit');
publicPostPaths.add('/api/boosts/quote');
publicPostPaths.add('/api/boosts/confirm');
publicPostPaths.add('/api/launch-tier-quote');
publicPostPaths.add('/api/listings/quote');
publicPostPaths.add('/api/x-public-trade-shares/challenge');
publicPostPaths.add('/api/x-public-trade-shares/consent');

const solanaCluster = String(process.env.VITE_SOLANA_CLUSTER || process.env.SOLANA_CLUSTER || 'devnet').trim();
const boostPurchasesEnabled = solanaCluster === 'devnet' && String(process.env.FUNDED_BOOST_ENABLED || '').toLowerCase() === 'true';
async function communityClaimService(mint) {
  if (solanaCluster !== 'devnet' || !fundedTokenMint) throw new Error('Solana community claim configuration is unavailable.');
  const config = communityProgramForLaunch(await store.readLaunch(mint), process.env, v3AuthorityKeypair);
  return createCommunityClaimService({ connection:new Connection(solanaRpcUrl, 'finalized'), store:automaticRewardStore,
    programId:config.programId, authority:config.authority,
    eligibilityMint:fundedTokenMint, cluster:solanaCluster,
    expectedCommunityProgramDataSha256:config.expectedHash });
}
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
const xAuth = createXAuth(store);
const referralAuth = createReferralAuth(store);
const mobileWalletRelay = createMobileWalletRelay({
  appOrigin: new URL(process.env.PUBLIC_APP_URL || `http://127.0.0.1:${port}`).origin,
  getLatestBlockhash: () => new Connection(solanaRpcUrl, 'confirmed').getLatestBlockhash('confirmed'),
  getFinalizedTransaction: signature => new Connection(solanaRpcUrl, 'finalized').getParsedTransaction(signature, { commitment:'finalized', maxSupportedTransactionVersion:0 }),
});

const readProviderSolUsdQuote = createSolUsdQuoteReader();
let configuredQuoteAssets = [];
const tokenChatSessions = createTokenChatSessions(store, { cluster: solanaCluster });
try { configuredQuoteAssets = JSON.parse(process.env.FUNDED_QUOTE_ASSETS_JSON || '[]'); } catch { configuredQuoteAssets = []; }

function json(res, status, body) { const encoded = JSON.stringify(body); res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': process.env.CORS_ORIGIN || '*' }); res.end(encoded); }
async function readSolUsdQuote() {
  return readProviderSolUsdQuote(process.env.SOL_USD_PRICE || process.env.SOLANA_USD_PRICE);
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
  return readJsonBody(req, { maxBytes: req.url === '/api/devnet-metadata' ? 2_000_000 : maxBodyBytes });
}
function route(path, method, pattern) { const match = path.match(pattern); return match && match[1] && method ? match[1] : null; }

function publicState(state) {
  return {
    version: state.version,
    launches: Object.values(state.launches),
    settlements: Object.values(state.settlements).map(item => ({ claimSignature: item.claimSignature, claimedAt: item.claimedAt, asset: item.asset, grossCreatorFees: item.grossCreatorFees, totalAllocated: item.totalAllocated, status: item.status, fundedApp: { total: item.fundedApp?.total, referralPayout: item.fundedApp?.referralPayout, community: item.fundedApp?.community, buyback: item.fundedApp?.buyback, referralLevels: (item.fundedApp?.referralLevels || []).map(level => ({ level: level.level, amount: level.amount, status: level.status })) } })),
    collections: Object.values(state.collections || {}).map(item => ({ id: item.id, mint: item.mint, signature: item.signature, status: item.status, collectedLamports: item.collectedLamports, recordedAt: item.recordedAt })),
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
// Retired public claim paths reach the V3 router's 410 guard without an auth
// challenge; no legacy write handler is registered below it.
function publicPost(path) { return publicPostPaths.has(path) || publicWalletSignedV3Post(path) || /^\/api\/tokens\/[^/]+\/v3-(?:x-claim\/[^/]+\/(?:prepare|verify|execute)|buyback\/[^/]+)$/.test(path) || /^\/api\/sol-claims\/[^/]+\/(?:prepare|verify|attest|execute)$/.test(path) || /^\/api\/referral-claims\/[^/]+\/(?:verify|execute)$/.test(path) || /^\/api\/tokens\/[^/]+\/creator-claim\/(?:prepare|request|settle)$/.test(path) || /^\/api\/tokens\/[^/]+\/reward-funding\/settle$/.test(path); }
function localDevWalletRequest(req, path) {
  if (!devMode || !/^\/api\/dev-wallet\/sign-(?:transaction|message)$/.test(path)) return false;
  try {
    const origin = new URL(String(req.headers.origin || ''));
    const hostname = new URL(`http://${req.headers.host || ''}`).hostname;
    // A localhost-only Docker port reaches Node through the Docker bridge, so
    // req.socket.remoteAddress is not loopback. Require both the browser origin
    // and requested host to be local instead; public/tunnel hosts still fail.
    return origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname)
      && ['localhost', '127.0.0.1'].includes(hostname);
  } catch { return false; }
}
function walletKey(value) {
  try { return new PublicKey(String(value || '').trim()).toBase58(); }
  catch { throw invalidRequest('A valid Solana wallet is required.'); }
}
function walletSignature(value) {
  try {
    if (typeof value !== 'string' || value.length > 100) throw new Error();
    const signature = bs58.decode(value);
    if (signature.length !== nacl.sign.signatureLength) throw new Error();
    return signature;
  } catch { throw invalidRequest('A valid wallet signature is required.'); }
}
function referralCodeFromBytes() { return createReferralCode(Uint8Array.from(randomBytes(6))); }
function referralChallengeStatement(challenge) { return `funded.app referral ${challenge.action} ${challenge.wallet} nonce ${challenge.nonce}`; }

function listingBurnAlreadyUsed(state, signature) {
  return Boolean(state.burnReceipts?.[signature]
    || Object.values(state.listings || {}).some(item => item.signature === signature)
    || Object.values(state.launches || {}).some(item => item.creatorLaunchBurn?.receipt?.signature === signature));
}

function xConfig() { return { clientId: String(process.env.X_CLIENT_ID || '').trim(), clientSecret: String(process.env.X_CLIENT_SECRET || '').trim(), callbackUrl: String(process.env.X_CALLBACK_URL || '').trim() }; }
const resolveXUser = createXUserResolver({ getBearerToken: () => process.env.X_BEARER_TOKEN });
async function xSession(req) { return xAuth.session(cookieValue(req, 'funded_x_session')); }
async function referralSession(req) { return referralAuth.session(cookieValue(req, 'funded_referral_session')); }
function requestCookieUrl(req) {
  const origin = String(req.headers.origin || '');
  if (!allowedAuthOrigin(req, process.env.CORS_ORIGIN)) throw new Error('Use the app origin for referral access.');
  return new URL('/api/referrals/session/verify', origin).href;
}
function xCallbackUrl(req) { return callbackUrlFor(req, xConfig().callbackUrl, process.env.NODE_ENV === 'production'); }
function xOAuthConfigured(req) {
  const config = xConfig();
  if (!config.clientId || !config.clientSecret) return false;
  try { xCallbackUrl(req); return true; } catch { return false; }
}
function html(res, status, title, message) { res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' }); res.end(`<!doctype html><title>${title}</title><p>${message}</p>`); }
const {
  keeperKeypair,
  routerAuthorityKeypair,
  v3AuthorityKeypair,
  mintRouterReadiness,
  xFeeReadiness,
  feeRouterConfig,
  v3RouterConfig,
  launchPolicyConfig,
  collectPumpCreatorFees,
} = createFeeRouterService({ store, solanaCluster, solanaRpcUrl, fundedTokenMint, devnetTestMode, xConfig, resolveXUser });

const readReceiptEvidence = createReceiptEvidenceReader({ store, cluster: solanaCluster,
  connectionFactory: () => new Connection(solanaRpcUrl, 'confirmed'),
  officialGenesis: () => solanaCluster === 'devnet' ? Promise.resolve(DEVNET_GENESIS_HASH) : new Connection(clusterApiUrl(solanaCluster), 'confirmed').getGenesisHash() });
const readFinalizedEvidence = createReceiptEvidenceReader({ store, cluster: solanaCluster, commitment:'finalized',
  connectionFactory: () => new Connection(solanaRpcUrl, 'finalized'),
  officialGenesis: () => solanaCluster === 'devnet' ? Promise.resolve(DEVNET_GENESIS_HASH) : new Connection(clusterApiUrl(solanaCluster), 'finalized').getGenesisHash() });
const readPaymentHistory = createPaymentHistoryReader({ readEvidence:readFinalizedEvidence, rewardsStore:automaticRewardStore, store,
  connectionFactory:() => new Connection(solanaRpcUrl, 'finalized'), cluster:solanaCluster,
  officialGenesis:() => solanaCluster === 'devnet' ? Promise.resolve(DEVNET_GENESIS_HASH) : new Connection(clusterApiUrl(solanaCluster), 'finalized').getGenesisHash() });

const handleWatchlist = createWatchlistHandler({ store, cluster: solanaCluster, getSession: xSession, getWalletSession: referralSession });
const handleCreatorSupport = createCreatorSupportHandler({ store, cluster: solanaCluster, getSession: xSession, readEvidence: readReceiptEvidence, readFinalizedEvidence,
  capabilities: async () => ({ version: CREATOR_SUPPORT_VERSION, build: process.env.FUNDED_BUILD_ID || CREATOR_SUPPORT_VERSION,
    cluster: solanaCluster, creatorPages: true, creatorIdentity: Boolean(process.env.X_CLIENT_ID && process.env.X_CLIENT_SECRET),
    sessions: { storage: databaseUrl ? 'postgresql' : 'local-file-single-process', absoluteLifetimeSeconds: SESSION_SECONDS },
    creatorDirectory: { storage: databaseUrl ? 'postgresql-projection' : 'local-file', cursorPagination: true },
    xPayouts: await xFeeReadiness({ creatorSigned:true }), gifts: { enabled: false, reason: 'No approved gifting provider or delivery-receipt integration is configured.' } }) });

const productMetrics = createProductMetricsStore(databaseUrl);
const handleProductMetrics = createProductMetricsHandler({metrics:productMetrics, cluster:solanaCluster,
  origin:process.env.PUBLIC_APP_URL || process.env.CORS_ORIGIN || '', authorized,
  charge:req => store.chargeRpcRate(`journey:${clientKey(req)}`,1,30,Math.floor(Date.now()/60000)*60000),
  confirmedTotals:async () => {
    const [state,evidence] = await Promise.all([store.read(),readFinalizedEvidence()]);
    return {...confirmedProductTotals(state,evidence,solanaCluster),tradingActivity:await productMetrics.trades(solanaCluster)};
  },
});

const handleBoostRoutes = createBoostRoutes({
  store, solanaCluster, boostPurchasesEnabled, clientKey, body, readSolUsdQuote, id, solanaRpcUrl, respond: json,
});
const { handle: handleAirdropsRoutes, invalidateReserveCache } = createAirdropsRoutes({
  solanaCluster, solanaRpcUrl, store, automaticRewardStore, fundedTokenMint, clientKey, body,
  requireAuthorized, communityClaimService, v3AuthorityKeypair, respond: json,
});
const handleTokenChatRoutes = createTokenChatRoutes({
  body, walletKey, store, clientKey, tokenChatSessions, referralSession, requireAuthorized, respond: json,
});
const handleReferralIdentityRoutes = createReferralIdentityRoutes({
  referralSession, body, walletKey, referralAuth, requestCookieUrl, store, id, referralChallengeStatement, walletSignature, referralCodeFromBytes, respond: json,
});

const handlePublicReportsRoutes = createPublicReportsRoutes({
  publicState, store, readReceiptEvidence, readPaymentHistory, automaticRewardStore, readFinalizedEvidence, solanaCluster, databaseUrl, respond: json,
});
const handleQuoteAssetsRoutes = createQuoteAssetsRoutes({
  configuredQuoteAssets, solanaRpcUrl, solanaCluster, respond: json,
});
const handleDirectoryRoutes = createDirectoryRoutes({
  store, solanaCluster, route, fundedTokenMint, currentLaunchTierPricing: () => currentLaunchTierPricing(), solanaRpcUrl, walletKey, respond: json,
});
const handleTokenMarketRoutes = createTokenMarketRoutes({
  route, store, clientKey, solanaRpcUrl, solanaCluster, respond: json,
});

const { proxySolanaRpc } = createSolanaRpcProxy({ store, solanaRpcUrl, body, authorized, clientKey, json, rpcMethods });
const { fetchBirdeye, fetchPump } = createMarketProviders({ birdeyeApiKey, birdeyeBaseUrl, birdeyeChain, birdeyeTimeoutMs, pumpApiUrl });
const { currentLaunchTierPricing } = createLaunchTierPricing({ solanaCluster, fundedTokenMint, fundedSwapPool, solanaRpcUrl, readSolUsdQuote });

const handleKeeperCollectionRoutes = createKeeperCollectionRoutes({
  requireAuthorized, body, fetchPump, normalizePumpToken, store, solanaCluster, collectPumpCreatorFees, solanaRpcUrl, respond: json,
});
const handleListingPaymentsRoutes = createListingPaymentsRoutes({
  body, fundedTokenMint, walletKey, store, solanaCluster, solanaRpcUrl, listingBurnAlreadyUsed,
  currentLaunchTierPricing, clientKey, id, respond: json,
});
const handleLaunchRegistrationRoutes = createLaunchRegistrationRoutes({
  solanaCluster, body, store, automaticRewardStore, resolveXUser, fundedTokenMint, solanaRpcUrl, walletSignature, v3AuthorityKeypair, id, invalidateReserveCache, respond: json,
});

const handleXIdentityRoutes = createXIdentityRoutes({
  xConfig, store, clientKey, xOAuthConfigured, xCallbackUrl, xAuth, html, xSession, resolveXUser, solanaCluster, readReceiptEvidence, automaticRewardStore, respond: json,
});
const handleCreatorFeesRoutes = createCreatorFeesRoutes({
  store, solanaCluster, route, solanaRpcUrl, readFinalizedEvidence, automaticRewardStore, feeRouterConfig,
  mintRouterReadiness, routerAuthorityKeypair, databaseUrl, body, creatorFeeChallenges, respond: json,
});
const handleV3Routes = createV3Routes({
  body, store, rewardStore:automaticRewardStore, xSession, walletSignature,
  solanaCluster, solanaRpcUrl, v3AuthorityKeypair, respond:json,
});

const handleDiscoveryRoutes = createDiscoveryRoutes({
  store, solanaCluster, solanaRpcUrl, birdeyeChain, fetchBirdeye, fetchPump, clientKey, respond: json,
});
const handleLaunchQuoteRoutes = createLaunchQuoteRoutes({
  store, body, clientKey, currentLaunchTierPricing, fundedTokenMint, id, respond: json,
});
const handleRewardStatusRoutes = createRewardStatusRoutes({
  store, automaticRewardStore, solanaCluster, xFeeReadiness, readFinalizedEvidence, clientKey, respond: json,
});

const { handlePublicMetadata, handlePages } = createPageDelivery({
  staticRoot, store, solanaCluster, respond: json,
});

const { handleShareVisit, handleReferralActivity } = createReferralActivityRoutes({
  store, body, clientKey, walletKey, referralSession, respond: json,
});
const { handleServiceStatus, handleOperationsStatus, handleKeeperStatus } = createServiceStatusRoutes({
  store, solanaCluster, solanaRpcUrl, automaticRewardStore, launchPolicyConfig,
  keeperKeypair, v3RouterConfig, birdeyeApiKey, pumpApiUrl, xOAuthConfigured,
  readSolUsdQuote, requireAuthorized, respond: json,
});

const handlePublicTradeSharing = createPublicTradeSharingRoutes({ store, solanaCluster, solanaRpcUrl, clientKey, respond: json });
const { handleLaunchPreview, handleLaunchSupport } = createLaunchSupportRoutes({ store, body, id, respond: json });

async function handle(req, res) {
  const requestId = applyHttpPolicy(req, res);
  try {
  // Routing does not depend on the untrusted Host header being a valid URL.
  let url;
  try { url = new URL(req.url, 'http://localhost'); }
  catch { throw invalidRequest('Invalid request URL.'); }
  const metadataHost = String(req.headers.host || '').split(':')[0].toLowerCase() === 'metadata.funded.vip';
  if (metadataHost && (req.method !== 'GET' || !/^\/(?:devnet-metadata|devnet-images|devnet-banners)\/[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(url.pathname) && url.pathname !== '/default.svg')) return json(res, 404, { error: 'Not found.' });
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': process.env.CORS_ORIGIN || '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type, solana-client, authorization, x-token-chat-session' }); return res.end(); }
    if (await handleProductMetrics(req,res,url)) return;
    if (await handlePublicTradeSharing(req, res, url)) return;
    if (await handleWatchlist(req, res, url)) return;
    if (await handleCreatorSupport(req, res, url)) return;
    if (req.method === 'POST' && url.pathname === '/api/mobile-wallet/relay') {
      if (!await store.chargeRpcRate(`mobile-wallet:${clientKey(req)}`, 1, 12, Math.floor(Date.now() / 60_000) * 60_000)) return json(res, 429, { error: 'Too many wallet connection requests; retry shortly.' });
    }
    if (await mobileWalletRelay.handle(req, res, url, body)) return;
    if (await handlePublicMetadata(req, res, url, metadataHost)) return;
    if (req.method === 'POST' && url.pathname !== '/api/solana/rpc') {
      if (/^\/api\/dev-wallet\/sign-(?:transaction|message)$/.test(url.pathname) && !devMode)
        return json(res, 403, { error: 'Local wallet signing is unavailable here.' });
      const cost = ['/api/launches', '/api/devnet-metadata'].includes(url.pathname) ? 10 : url.pathname.startsWith('/api/referrals/') ? 5 : 1;
      const windowStart = Math.floor(Date.now() / 60_000) * 60_000;
      if (!await store.chargeRpcRate(`api:${clientKey(req)}`, cost, 120, windowStart)) return json(res, 429, { error: 'API request limit reached; retry shortly.' });
      const chatPost = req.method === 'POST' && (/^\/api\/tokens\/[^/]+\/chat(?:\/(?:report|delete))?$/.test(url.pathname) || /^\/api\/token-chat\/session\/(?:prepare|verify|revoke)$/.test(url.pathname));
      if (!publicPost(url.pathname) && !chatPost && !localDevWalletRequest(req, url.pathname) && !authorized(req)) return json(res, 401, { error: 'API authorization required.' });
    }
    if (req.method === 'POST' && url.pathname === '/api/solana/rpc') return await proxySolanaRpc(req, res);
    if (await handleBoostRoutes(req, res, url, requestId)) return;
    if (req.method === 'POST' && url.pathname === '/api/devnet-metadata') {
      if (solanaCluster !== 'devnet') return json(res, 403, { error: 'Metadata publishing is Devnet-only.' });
      const input = await body(req);
      const { record, image, imageType, banner, bannerType } = validateInput(() => parseSignedMetadata(input));
      const saved = await store.writeMetadata({ ...record, metadataOrigin: devnetMetadataOrigin }, image, imageType, banner, bannerType);
      return json(res, 201, { uri: devnetMetadataUri(saved.mint, metadataRecordOrigin(saved)), image: publicMetadata(saved).image, mint: saved.mint });
    }
    if (req.method === 'GET' && url.pathname === '/api/dev-wallet') {
      if (!devMode) return json(res, 403, { error: 'Automatic wallet access is unavailable here.' });
      const wallet = devWalletKeypair();
      if (!wallet) return json(res, 503, { error: 'Local Solana wallet role is not configured.' });
      return json(res, 200, { role: wallet.role, publicKey: wallet.keypair.publicKey.toBase58(), cluster: 'devnet' });
    }
    if (req.method === 'POST' && url.pathname === '/api/dev-wallet/sign-transaction') {
      const wallet = devWalletKeypair();
      if (!wallet) return json(res, 503, { error: 'Local Solana wallet role is not configured.' });
      const input = await body(req);
      try {
        const bytes = Buffer.from(String(input.transaction || ''), 'base64');
        const decoded = VersionedTransaction.deserialize(bytes);
        const transaction = decoded.version === 'legacy' ? Transaction.from(bytes) : decoded;
        if (transaction instanceof VersionedTransaction) transaction.sign([wallet.keypair]);
        else transaction.partialSign(wallet.keypair);
        return json(res, 200, { transaction: Buffer.from(transaction.serialize({ requireAllSignatures: false, verifySignatures: false })).toString('base64') });
      } catch { return json(res, 400, { error: 'Invalid development transaction.' }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/dev-wallet/sign-message') {
      const wallet = devWalletKeypair();
      if (!wallet) return json(res, 503, { error: 'Local Solana wallet role is not configured.' });
      const input = await body(req);
      try { return json(res, 200, { signature: Buffer.from(nacl.sign.detached(Buffer.from(String(input.message || ''), 'base64'), wallet.keypair.secretKey)).toString('base64') }); }
      catch { return json(res, 400, { error: 'Invalid development message.' }); }
    }
    if (await handleRewardStatusRoutes(req, res, url)) return;
    if (await handleAirdropsRoutes(req, res, url, requestId)) return;
    if (await handleServiceStatus(req, res, url)) return;
    if (await handleLaunchQuoteRoutes(req, res, url)) return;
    if (await handleXIdentityRoutes(req, res, url, requestId)) return;
    if (await handleOperationsStatus(req, res, url)) return;
    if (await handleLaunchPreview(req, res, url)) return;
    if (await handleKeeperStatus(req, res, url)) return;
    if (await handleDiscoveryRoutes(req, res, url)) return;
    if (await handleTokenChatRoutes(req, res, url, requestId)) return;
    if (await handleV3Routes(req, res, url, requestId)) return;
    if (await handleCreatorFeesRoutes(req, res, url, requestId)) return;
    if (await handleTokenMarketRoutes(req, res, url, requestId)) return;
    if (await handleKeeperCollectionRoutes(req, res, url, requestId)) return;
    if (await handleReferralIdentityRoutes(req, res, url, requestId)) return;
    if (await handleShareVisit(req, res, url)) return;
    if (await handlePublicReportsRoutes(req, res, url, requestId)) return;
    if (await handleQuoteAssetsRoutes(req, res, url, requestId)) return;
    if (await handleDirectoryRoutes(req, res, url, requestId)) return;
    if (await handleReferralActivity(req, res, url)) return;
    if (await handleLaunchSupport(req, res, url)) return;
    if (await handleListingPaymentsRoutes(req, res, url, requestId)) return;
    if (await handleLaunchRegistrationRoutes(req, res, url, requestId)) return;
    if (await handlePages(req, res, url)) return;
    return json(res, 404, { error: 'Not found.' });
  } catch (error) {
    if (res.headersSent || res.destroyed) { res.destroy(); return; }
    if (!req.complete) { res.shouldKeepAlive = false; res.setHeader('connection', 'close'); }
    if (error.severity || ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].includes(error.code)) {
      console.error(JSON.stringify({ event: 'dependency_failure', requestId, code: error.code || 'DEPENDENCY_ERROR' }));
      return json(res, 503, { error: 'Backend dependency is temporarily unavailable.', requestId });
    }
    if (error instanceof URIError) error = Object.assign(new Error('Invalid URL encoding.'), { statusCode: 400 });
    const output = publicError(error, requestId);
    if (output.status >= 500) console.error(JSON.stringify({ event: 'request_failure', requestId, code: 'INTERNAL_ERROR' }));
    return json(res, output.status, output.body);
  }
}

await startShareVisitCleanup({ store });
const server = createServer(handle);
server.headersTimeout = 10_000;
server.requestTimeout = 30_000;
server.timeout = 120_000;
server.listen(port, host, () => console.log(`funded.vip app listening on http://${host}:${port}`));
startCommunityClaimIndex({ solanaCluster, solanaRpcUrl, fundedTokenMint, automaticRewardStore, v3AuthorityKeypair });
startV3HolderRewardWorker({ solanaCluster, solanaRpcUrl,
  automaticRewardStore, v3AuthorityKeypair });
