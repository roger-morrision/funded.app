import { Buffer } from 'buffer';
import { formatTradeAmountInput, parseTradeAmountInput } from './trade-amount-input.js';
import { formatTokenBaseAmount, tokenBalancePercentage } from './trade-panel-balance.js';
import { buildTradeReview } from './trade-review-model.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { decryptPhantomMobileResult, verifyPhantomMobileSession, verifyPhantomMobileSignature, verifyPhantomMobileTransaction } from './phantom-mobile-crypto.js';
import { formatXClaimSol, summarizeXClaims } from './x-claim-summary.js';
import { APP_REFERRAL_LEVELS, buildFeeDistributionPolicy, FEE_DISTRIBUTION, validateFeeDistribution } from './distribution-policy.js';
import { buildCommunityAirdropPolicy, buildLaunchReservePlan } from './airdrop-policy.js';
import { buildBuybackAccrual, buildBuybackPolicy, buildBuybackReceipt, evaluateBuybackBatch, summarizeBuybackLedger } from './buyback-policy.js';
import { buildFeeRouterPolicy, deriveMintFeeRouter, verifyFeeRouterAccount } from './fee-router.js';
import { buildMintRouterInitializeInstruction, buildPumpLaunchPlan } from './mint-router-launch.js';
import { buildLaunchBurnPolicy, createLaunchBurnTiers, validateLaunchBurnPolicy } from './launch-burn-policy.js';
import { burnedSupplyBaseUnits, formatTokenBaseUnits, parseTokenAmount, waitForSignatureConfirmation } from './funded-burn.js';
import { bindReferralAttribution, captureFirstTouch, createReferralCode, normalizeReferralCode } from './referral-program.js';
  import { buildSolClaimPolicy, normalizeXHandle } from './sol-claim-policy.js';
import { buildTradeTransaction, buildVerifiedPoolTradeTransaction, describeTradeQuote, estimateBuyTokenAmountFromSnapshot, fetchBondingCurveSnapshot, fetchGraduatedPoolSnapshot, fetchVerifiedPoolSnapshot, submitTrade } from './pump-trading.js';
import { PUMP_PROGRAM_ID, PUMP_SDK, bondingCurvePda } from '@pump-fun/pump-sdk';
import { PUMP_AMM_PROGRAM_ID, PUMP_AMM_SDK, canonicalPumpPoolPda } from '@pump-fun/pump-swap-sdk';
import { APP_CLUSTER, APP_EXPLORER_QUERY, APP_MAINNET_READ_ONLY, APP_RPC_URL, DEV_MODE, DEV_WALLET_AUTOCONNECT, DEV_WALLET_ROLE, EXPLORE_CLUSTER, EXPLORE_RPC_URL, TRADE_FEE_BPS, TRADE_FEE_OWNER } from './app-config.js';
import { apiRequest, persistLaunchPolicy } from './client.js';
import { recordLaunchEvent, readLaunchJournal, policyMatchesJournal } from './launch-journal.js';
import { launchReview, freshLaunchReview, launchReviewMarkup, launchReviewNeedsRefresh } from './launch-review.js';
import { confirmedClaimResult } from './reward-discovery.js';
import {focusLaunchStep} from './launch-accessibility.js';
import { getPreparedImage, prepareLaunchImage, assertImageReady } from './launch-image.js';
import { launchPolicyStatement } from './launch-policy-auth.js';
import { verifiedPromotionBadge } from './promotion-badge.js';
import { metadataStatement, devnetMetadataUri, devnetImageUri } from './devnet-metadata.js';
import { collectRecentTrades, enrichMarketRecord, filterMarketRecords, formatSignal, sortMarketRecords, summarizeMarkets, withMarketWindow } from './market-intelligence.js';
import { formatSolMetric, readCurveMetrics, readPumpSwapMetrics } from './explore-onchain-metrics.js';
import { buildTradePricePath, selectRecentTrades, summarizeTokenAccounts, verifiedRegistryLaunch } from './coin-detail-model.js';
import { buildCoinSummary } from './coin-summary-model.js';
import { canSignTransactions, connectWalletProvider, selectRememberedWalletProvider, walletAddress, walletLaunches } from './wallet-core.js';
import { TOKEN_CHAT_MAX_LENGTH, normalizeTokenChatText } from './token-chat.js';

globalThis.Buffer ??= Buffer;
let solanaModules;
let connection;
let exploreConnection;
let tradePreviewConnection;
function connectionConfig(web3, cluster = APP_CLUSTER){
  return {
    commitment: 'confirmed',
    disableRetryOnRateLimit: true,
    ...(APP_RPC_URL ? { wsEndpoint: web3.clusterApiUrl(cluster).replace(/^http/, 'ws') } : {}),
  };
}
async function getSolana(){
  if (!solanaModules) {
    const [web3, spl] = await Promise.all([import('@solana/web3.js'), import('@solana/spl-token')]);
    connection = new web3.Connection(APP_RPC_URL || web3.clusterApiUrl(APP_CLUSTER), connectionConfig(web3));
    solanaModules = { ...web3, ...spl };
  }
  return solanaModules;
}
async function getExploreConnection(){
  const { Connection } = await getSolana();
  if (!exploreConnection) exploreConnection = new Connection(EXPLORE_RPC_URL || (solanaModules.clusterApiUrl ? solanaModules.clusterApiUrl(EXPLORE_CLUSTER) : `https://api.${EXPLORE_CLUSTER}.solana.com`), connectionConfig(solanaModules, EXPLORE_CLUSTER));
  return exploreConnection;
}
async function fetchTokenAccountSample(mintAddress, rpc, PublicKey){
  const response = await apiRequest(`/api/tokens/${encodeURIComponent(mintAddress)}/token-accounts`, { signal: AbortSignal.timeout(8000) }).catch(() => ({ available: false, data: null }));
  if (response.available && response.data?.cluster === EXPLORE_CLUSTER && Array.isArray(response.data.accounts)) return response.data;
  const result = await rpc.getTokenLargestAccounts(new PublicKey(mintAddress), 'confirmed');
  const rows = Array.isArray(result?.value) ? result.value : [];
  const accounts = rows.filter(row => BigInt(String(row.amount || '0')) > 0n).map(row => ({
    address: row.address.toBase58(), amount: String(row.amount), decimals: Number(row.decimals), uiAmountString: String(row.uiAmountString ?? row.uiAmount ?? ''),
  }));
  return { mint: mintAddress, cluster: EXPLORE_CLUSTER, accounts, count: accounts.length, coverage: rows.length >= 20 ? 'lower-bound' : 'complete-account-list', source: 'browser-rpc-fallback' };
}
async function getTradePreviewConnection(){
  const { Connection, clusterApiUrl } = await getSolana();
  if (!tradePreviewConnection) tradePreviewConnection = new Connection(APP_RPC_URL ? `${APP_RPC_URL}?purpose=trade-preview` : clusterApiUrl(APP_CLUSTER), connectionConfig(solanaModules));
  return tradePreviewConnection;
}
const explorer = (path) => `https://explorer.solana.com/${path}${APP_EXPLORER_QUERY}`;
const exploreExplorer = (path) => `https://explorer.solana.com/${path}${EXPLORE_CLUSTER === 'mainnet-beta' ? '' : `?cluster=${EXPLORE_CLUSTER}`}`;
let wallet = null;
let connectedWalletAddress = null;
let walletVersion = 0;
let coinChatSession = null;
let coinChatSessionPromise = null;
let walletConnectRequest = 0;
const observedWalletProviders = new WeakSet();
const disconnectingWalletProviders = new WeakSet();
const WALLET_MANUAL_DISCONNECT_KEY = 'funded.app.wallet.manual-disconnect';
const WALLET_PROVIDER_KEY = 'funded.app.wallet.provider';
const MOBILE_WALLET_SESSION_KEY = 'funded.app.phantom.mobile.session';
const COIN_CHAT_SESSION_KEY = 'funded.app.token-chat.session.v1';
let walletDisconnectRequested = false;
let mobileWalletRequestVersion = 0;
let mobileWalletLink = '';
let metricsRequest = 0;
let launchCostRefreshTimer = null;
let walletBalanceLamports = null;
let estimatedLaunchFeeLamports = null;
let estimatedInitialBuyLamports = 0;
let estimatedInitialBuyTokens = 0;
let launchCostReview = null;
let walletMetricsLoading = false;
let walletEstimateError = '';
let walletDetailTab = 'activity';
let tradePreview = null;
let tradeQuoteVersion = 0;
let tradeQuoteTimer = null;
let tradeQuoteInFlight = null;
let tradeActionBusy = false;
let coinTradeEstimate = null;
let tradeBalanceRequest = 0;
let tradeBalanceState = { key:'', solLamports:null, tokenRaw:null, tokenDecimals:0 };
let launchStep = 1;
let launchMode = 'quick';
let launchProfile = 'fast';
let launchBurnTier = 'standard';
let launchBurnReadiness = { ready: true, message: 'No creator-funded burn is required.' };
let fundedBurnRequest = 0;
let fundedBurnState = { status: 'idle', wallet: null, decimals: 0, balanceBaseUnits: 0n, supplyBaseUnits: 0n, burnedBaseUnits: 0n, tokenAccounts: [], receipts: [], message: '' };
let fundedBuyRoute = { status:'checking', snapshot:null, reason:'Checking the verified Devnet pool…' };
let fundedBuyPreview = null;
let fundedBuyBusy = false;
const WATCHLIST_KEY = 'funded.app.community.watchlist';
const APP_REFERRAL_KEY = 'funded.app.referral.attribution';
const REFERRAL_ANALYTICS_KEY = 'funded.app.referral.analytics';
const REFERRAL_SERVER_KEY_PREFIX = 'funded.app.referral.server.';
const AIRDROP_PREVIEW_CLAIM_KEY = 'funded.app.airdrop.preview-claims';
const BUYBACK_PREVIEW_KEY = 'funded.app.buyback.preview-ledger';
const LAUNCH_TOKEN_SUPPLY = 1_000_000_000;
const MIN_COMMUNITY_AIRDROP_TOKENS = 30_000_000;
const MAX_COMMUNITY_AIRDROP_TOKENS = 500_000_000;
const FEE_ROUTER_PROGRAM_ID = String(import.meta.env.VITE_FUNDED_FEE_ROUTER_PROGRAM_ID || '').trim();
const PROTOCOL_FUNDED_MINT = String(import.meta.env.VITE_FUNDED_TOKEN_MINT || '').trim();
const PROTOCOL_FUNDED_SWAP_POOL = String(import.meta.env.VITE_FUNDED_SWAP_POOL || '').trim();
const LAUNCH_BURN_TIERS = createLaunchBurnTiers({
  boostAmount: Number(import.meta.env.VITE_FUNDED_BOOST_BURN_AMOUNT || 25_000),
  proAmount: Number(import.meta.env.VITE_FUNDED_PRO_BURN_AMOUNT || 100_000),
  premierAmount: Number(import.meta.env.VITE_FUNDED_PREMIER_BURN_AMOUNT || 250_000),
});
let feeRouterState = { status: 'checking', verified: false, address: null, programId: FEE_ROUTER_PROGRAM_ID || null, bump: null };
let xFeeStatus = { ready: false, reasons: ['X fee service has not been verified'] };
const APP_ECONOMICS = Object.freeze({
  fundedSharePercent: FEE_DISTRIBUTION.fundedPercent,
  creatorSharePercent: FEE_DISTRIBUTION.creatorPercent,
  appReferralRateOfFundedRevenue: FEE_DISTRIBUTION.appReferralRateOfFundedRevenue,
  appReferralEffectivePercent: FEE_DISTRIBUTION.appReferralEffectivePercent,
  appReferralLevels: APP_REFERRAL_LEVELS,
  operationsRateOfFundedRevenue: FEE_DISTRIBUTION.operationsRateOfFundedRevenue,
  operationsEffectivePercent: FEE_DISTRIBUTION.operationsEffectivePercent,
  communityRateOfFundedRevenue: FEE_DISTRIBUTION.communityRateOfFundedRevenue,
  communityEffectivePercent: FEE_DISTRIBUTION.communityEffectivePercent,
  buybackRateOfFundedRevenue: FEE_DISTRIBUTION.buybackRateOfFundedRevenue,
  buybackEffectivePercent: FEE_DISTRIBUTION.buybackEffectivePercent,
});

function getFundedMintAddress(){ return PROTOCOL_FUNDED_MINT; }
function getLaunchBurnPolicy(){ return buildLaunchBurnPolicy({ tierId: launchBurnTier, fundedMint: PROTOCOL_FUNDED_MINT || null, tiers: LAUNCH_BURN_TIERS }); }
function getCreatorBuySol(){
  const value = Number(document.querySelector('#creator-buy-sol')?.value || 0);
  return Number.isFinite(value) ? value : 0;
}
function creatorBuyExceedsWalletBalance(){
  const buySol = getCreatorBuySol();
  return walletBalanceLamports != null && buySol > 0 && Math.ceil(buySol * 1_000_000_000) >= walletBalanceLamports;
}
function getCreatorBuySummary(){
  const sol = getCreatorBuySol();
  const tokens = sol > 0 ? estimatedInitialBuyTokens : 0;
  const percent = tokens > 0 ? tokens / LAUNCH_TOKEN_SUPPLY * 100 : 0;
  return { sol, percent, tokens };
}
function getCommunityAirdropTokens(){
  const raw = document.querySelector('#community-airdrop-tokens')?.value;
  if (raw == null || String(raw).trim() === '') return NaN;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.round(value) : NaN;
}
function getCommunityAllocationPercent(){
  return getCommunityAirdropTokens() / LAUNCH_TOKEN_SUPPLY * 100;
}
function syncCommunityAirdropPresets(){
  const tokens = getCommunityAirdropTokens();
  document.querySelectorAll('[data-airdrop-tokens]').forEach(button => {
    const active = Number(button.dataset.airdropTokens) === tokens;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}
function validateSolanaMint(value){
  const address = String(value || '').trim();
  if (!address) return { valid: false, empty: true };
  try { return { valid: bs58.decode(address).length === 32, address }; } catch { return { valid: false, address }; }
}
function getAppReferralAttribution(){
  try {
    const attribution = JSON.parse(localStorage.getItem(APP_REFERRAL_KEY) || 'null');
    const walletAddress = connectedWalletAddress;
    if (!attribution?.code || !normalizeReferralCode(attribution.code)) return null;
    if (attribution.wallet && walletAddress && attribution.wallet !== walletAddress) return null;
    return { ...attribution, code: normalizeReferralCode(attribution.code) };
  } catch { return null; }
}
function trackReferralEvent(event, detail = {}){
  try {
    const events = JSON.parse(localStorage.getItem(REFERRAL_ANALYTICS_KEY) || '[]');
    events.push({ event, at: new Date().toISOString(), ...detail });
    localStorage.setItem(REFERRAL_ANALYTICS_KEY, JSON.stringify(events.slice(-100)));
  } catch {}
}
function captureAppReferral(){
  const code = new URLSearchParams(window.location.search).get('ref')?.trim().toUpperCase();
  const attribution = captureFirstTouch(getAppReferralAttribution(), code, { ownCode: getReferralCode() });
  if (!attribution) return getAppReferralAttribution();
  localStorage.setItem(APP_REFERRAL_KEY, JSON.stringify(attribution));
  trackReferralEvent('referral_captured');
  return attribution;
}
function bindAppReferralToWallet(){
  const attribution = getAppReferralAttribution();
  const walletAddress = connectedWalletAddress;
  if (!attribution || !walletAddress) return;
  const bound = bindReferralAttribution(attribution, walletAddress, getReferralCode());
  if (bound) { localStorage.setItem(APP_REFERRAL_KEY, JSON.stringify(bound)); trackReferralEvent('wallet_bound'); }
  else localStorage.removeItem(APP_REFERRAL_KEY);
}
async function syncServerReferralState({ register = true } = {}){
  const session = captureWalletSession();
  const walletAddress = session?.address;
  if (!session || session.provider.remoteMobile || typeof session.provider.signMessage !== 'function') return;
  try {
    const registrationKey = `${REFERRAL_SERVER_KEY_PREFIX}${walletAddress}`;
    let registered = null;
    try { registered = JSON.parse(localStorage.getItem(registrationKey) || 'null'); } catch {}
    if (register && !registered?.code) {
      const prepared = await apiRequest('/api/referrals/registration/prepare', { method: 'POST', body: { wallet: walletAddress } });
      if (!prepared.available) return;
      assertWalletSessionCurrent(session);
      const signature = await session.provider.signMessage(new TextEncoder().encode(prepared.data.statement));
      assertWalletSessionCurrent(session);
      const verified = await apiRequest('/api/referrals/registration/verify', { method: 'POST', body: { challengeId: prepared.data.challengeId, wallet: walletAddress, signature: bs58.encode(signature) } });
      assertWalletSessionCurrent(session);
      if (verified.data?.code) { registered = verified.data; localStorage.setItem(registrationKey, JSON.stringify(registered)); localStorage.setItem(`funded.app.referral.code.${walletAddress}`, registered.code); }
    }
    const attribution = getAppReferralAttribution();
    if (attribution?.code && attribution.wallet === walletAddress && !attribution.serverVerified) {
      const prepared = await apiRequest('/api/referrals/attribution/prepare', { method: 'POST', body: { wallet: walletAddress, code: attribution.code } });
      if (!prepared.available) return;
      assertWalletSessionCurrent(session);
      const signature = await session.provider.signMessage(new TextEncoder().encode(prepared.data.statement));
      assertWalletSessionCurrent(session);
      await apiRequest('/api/referrals/attribution/verify', { method: 'POST', body: { challengeId: prepared.data.challengeId, wallet: walletAddress, signature: bs58.encode(signature) } });
      assertWalletSessionCurrent(session);
      localStorage.setItem(APP_REFERRAL_KEY, JSON.stringify({ ...attribution, serverVerified: true }));
      trackReferralEvent('server_attribution_verified');
    }
  } catch (error) { trackReferralEvent('server_referral_sync_failed', { reason: error.message }); throw error; }
}
async function referralCodeForShare(){
  try {
    if (!wallet) await connectWallet();
    const session = captureWalletSession();
    if (!session) throw new Error('Connect your wallet to share an invite.');
    await syncServerReferralState();
    assertWalletSessionCurrent(session);
    const registered = JSON.parse(localStorage.getItem(`${REFERRAL_SERVER_KEY_PREFIX}${session.address}`) || 'null');
    const code = normalizeReferralCode(registered?.code);
    if (!code) throw new Error('Invite link activation needs one wallet approval. Try again.');
    updateReferralLink();
    return code;
  } catch (error) { showToast(error.message || 'Invite link is unavailable.'); return ''; }
}
function renderReferralClaimPrompt(title = 'Connect wallet to check claimable referral rewards', note = 'Each available reward requires a wallet signature and a separate payout action.'){
  const panel = document.querySelector('#referral-claim-center');
  if (!panel) return;
  panel.replaceChildren();
  const content = document.createElement('div');
  const eyebrow = document.createElement('span'); eyebrow.className = 'eyebrow'; eyebrow.textContent = 'Manual rewards';
  const heading = document.createElement('strong'); heading.textContent = title;
  const detail = document.createElement('small'); detail.textContent = note;
  content.append(eyebrow, heading, detail); panel.append(content);
}
async function refreshReferralClaims(){
  const session = captureWalletSession();
  const walletAddress = session?.address; const dashboard = document.querySelector('#referral-command-center');
  if (!session || !dashboard) return;
  const [result, dashboardResult] = await Promise.all([
    apiRequest(`/api/referral-claims?wallet=${encodeURIComponent(walletAddress)}`).catch(() => ({ available: false })),
    apiRequest(`/api/referrals/dashboard?wallet=${encodeURIComponent(walletAddress)}`).catch(() => ({ available: false })),
  ]);
  if (!isWalletSessionCurrent(session)) return;
  if (!result.available) { renderReferralClaimPrompt('Referral claim service unavailable', 'No reward action is available until the claim service can be verified.'); return; }
  if (dashboardResult.available) { const active = document.querySelector('#referral-active-creators'); if (active) active.textContent = String(dashboardResult.data.networkCreators ?? '—'); const conversion = document.querySelector('#referral-conversion-rate'); if (conversion) conversion.textContent = dashboardResult.data.conversionRate == null ? '—' : `${dashboardResult.data.conversionRate}%`; }
  const claims = Array.isArray(result.data.claims) ? result.data.claims : [];
  const claimable = claims.filter(claim => ['awaiting-wallet-signature', 'wallet-verified'].includes(claim.status)).reduce((sum, claim) => sum + Number(claim.amount || 0), 0);
  const paid = claims.filter(claim => claim.status === 'paid').reduce((sum, claim) => sum + Number(claim.amount || 0), 0);
  const claimableNode = document.querySelector('#referral-total-claimable'); if (claimableNode) claimableNode.textContent = `${claimable.toFixed(4)} SOL`;
  const paidNode = document.querySelector('#referral-paid-total'); if (paidNode) paidNode.textContent = `${paid.toFixed(4)} SOL`;
  const ledger = document.querySelector('#referral-ledger-list');
  if (ledger) { ledger.replaceChildren(); if (!claims.length) { const empty = document.createElement('div'); empty.className = 'empty-state'; empty.textContent = 'No referral claim receipts yet.'; ledger.append(empty); } else claims.slice().reverse().forEach(claim => { const row = document.createElement('div'); row.className = 'referral-ledger-row'; const label = document.createElement('strong'); label.textContent = `Level ${claim.level}`; const status = document.createElement('small'); status.textContent = claim.status; const amount = document.createElement('b'); amount.textContent = `${Number(claim.amount || 0).toFixed(4)} ${claim.asset}`; row.append(label, status, amount); ledger.append(row); }); }
  let panel = document.querySelector('#referral-claim-center');
  if (!panel) { panel = document.createElement('div'); panel.id = 'referral-claim-center'; panel.className = 'referral-dashboard'; panel.setAttribute('aria-live', 'polite'); dashboard.querySelector('.referral-kpi-grid')?.after(panel); }
  panel.replaceChildren();
  const heading = document.createElement('div'); const title = document.createElement('strong'); title.textContent = 'Referral claim center'; const note = document.createElement('small'); note.textContent = claims.length ? 'Rewards require your wallet signature and a separate payout action.' : 'No claimable referral rewards yet.'; heading.append(title, note); panel.append(heading);
  for (const claim of result.data.claims) {
    const row = document.createElement('div'); row.className = 'referral-claim-row'; const label = document.createElement('span'); label.textContent = `Level ${claim.level} · ${claim.amount} ${claim.asset} · ${claim.status}`; row.append(label);
    if (claim.status === 'awaiting-wallet-signature' && session.provider.signMessage) { const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary-button'; button.textContent = 'Sign claim'; button.onclick = async () => { button.disabled = true; try { assertWalletSessionCurrent(session); const signature = await session.provider.signMessage(new TextEncoder().encode(claim.statement)); assertWalletSessionCurrent(session); await apiRequest(`/api/referral-claims/${encodeURIComponent(claim.id)}/verify`, { method: 'POST', body: { publicKey: walletAddress, signature: bs58.encode(signature) } }); if (isWalletSessionCurrent(session)) await refreshReferralClaims(); } catch (error) { if (isWalletSessionCurrent(session)) { showToast(error.message); button.disabled = false; } } }; row.append(button); }
    if (claim.status === 'wallet-verified') { const button = document.createElement('button'); button.type = 'button'; button.className = 'primary-button'; button.textContent = 'Execute payout'; button.onclick = async () => { button.disabled = true; try { assertWalletSessionCurrent(session); await apiRequest(`/api/referral-claims/${encodeURIComponent(claim.id)}/execute`, { method: 'POST' }); if (isWalletSessionCurrent(session)) { showToast('Referral reward paid'); await refreshReferralClaims(); } } catch (error) { if (isWalletSessionCurrent(session)) { showToast(error.message); button.disabled = false; } } }; row.append(button); }
    if (claim.status === 'paid' && claim.payoutSignature) { const receipt = document.createElement('small'); receipt.textContent = `Paid · ${claim.payoutSignature}`; row.append(receipt); }
    panel.append(row);
  }
}
function getReferralCode(){
  const walletAddress = connectedWalletAddress;
  if (!walletAddress) return '';
  const key = `funded.app.referral.code.${walletAddress}`;
  const saved = normalizeReferralCode(localStorage.getItem(key));
  if (saved) return saved;
  const code = createReferralCode();
  localStorage.setItem(key, code);
  return code;
}
function updateReferralLink(){
  const code = getReferralCode();
  const value = code ? buildReferralUrl(code) : 'Connect wallet to generate';
  document.querySelectorAll('[data-referral-link]').forEach(node => { node.textContent = value; });
  let registered = null;
  try { registered = JSON.parse(localStorage.getItem(`${REFERRAL_SERVER_KEY_PREFIX}${connectedWalletAddress}`) || 'null'); } catch {}
  const status = document.querySelector('#referral-link-status'); if (status) status.textContent = !code ? 'Connect wallet' : registered?.code === code ? 'Ready to share' : 'Verify to share';
}
function buildReferralUrl(code, source = ''){
  const url = new URL('/', window.location.origin);
  url.searchParams.set('ref', code);
  if (source) url.searchParams.set('src', source);
  return url.toString();
}
function updateFundedMintConfig(){
  const input = document.querySelector('#funded-mint-address');
  const status = document.querySelector('#funded-mint-status');
  if (!input || !status) return;
  const result = validateSolanaMint(PROTOCOL_FUNDED_MINT);
  if (input.parentElement?.firstChild) input.parentElement.firstChild.textContent = 'Protocol $FUNDED mint';
  input.value = PROTOCOL_FUNDED_MINT;
  input.readOnly = true;
  input.placeholder = 'Set by the protocol deployment';
  if (result.empty) { status.textContent = 'Protocol mint not configured. Paid launch tiers remain disabled.'; status.className = 'field-help'; }
  else if (!result.valid) { status.textContent = 'Deployment configuration contains an invalid mint address.'; status.className = 'field-help funded-mint-invalid'; }
  else { status.textContent = `Protocol mint: ${result.address.slice(0, 6)}…${result.address.slice(-6)}`; status.className = 'field-help funded-mint-valid'; }
  updateLaunchPreview();
}

async function refreshFeeRouterConfig(){
  const status = document.querySelector('#fee-router-status');
  const addressNode = document.querySelector('#fee-router-address');
  feeRouterState = { status: 'checking', verified: false, address: null, programId: FEE_ROUTER_PROGRAM_ID || null, bump: null };
  if (status) { status.textContent = 'Checking the funded.vip router program…'; status.className = 'field-help'; }
  if (!FEE_ROUTER_PROGRAM_ID) {
    feeRouterState.status = 'program-id-not-configured';
    if (status) { status.textContent = 'Launch blocked: VITE_FUNDED_FEE_ROUTER_PROGRAM_ID is not configured.'; status.className = 'field-help funded-mint-invalid'; }
    if (addressNode) addressNode.textContent = 'Not configured';
    updateLaunchPreview();
    updateLaunchButton();
    return;
  }
  try {
    await getSolana();
    const verified = await verifyFeeRouterAccount({ connection, programId: FEE_ROUTER_PROGRAM_ID });
    feeRouterState = { status: verified.reason, verified: verified.verified, address: verified.address.toBase58(), programId: verified.programId.toBase58(), bump: verified.bump };
    if (addressNode) addressNode.textContent = `${feeRouterState.address.slice(0, 6)}…${feeRouterState.address.slice(-6)}`;
    if (status) {
      status.textContent = verified.verified ? 'Verified on Devnet. This PDA can be assigned as Pump’s fee owner at creation.' : `Launch blocked: ${verified.reason.replaceAll('-', ' ')}.`;
      status.className = `field-help ${verified.verified ? 'funded-mint-valid' : 'funded-mint-invalid'}`;
    }
  } catch (error) {
    feeRouterState = { status: 'router-verification-unavailable', verified: false, address: null, programId: FEE_ROUTER_PROGRAM_ID, bump: null };
    if (status) { status.textContent = 'Fee-router verification is unavailable. Check your connection before trying again. Signing stays blocked until verification succeeds.'; status.className = 'field-help funded-mint-invalid'; }
    if (addressNode) addressNode.textContent = 'Not verified';
  }
  updateLaunchPreview();
  updateLaunchButton();
  if (wallet) refreshWalletInfo();
}
async function refreshXFeeStatus(){
  try {
    const result = await apiRequest('/api/x-fee/status');
    xFeeStatus = result.available && result.data?.ready === true ? result.data : { ready: false, reasons: result.data?.reasons || ['X fee service is unavailable'] };
  } catch (error) { xFeeStatus = { ready: false, reasons: [error.message || 'X fee service is unavailable'] }; }
  const help = document.querySelector('#x-share-help');
  if (help) help.textContent = xFeeStatus.ready ? 'Verified X accounts can claim their share after mint-specific creator fees are collected.' : `Unavailable: ${xFeeStatus.reasons.join('; ')}.`;
  updateLaunchPreview();
  updateLaunchButton();
  if (wallet) scheduleLaunchCostRefresh();
}

const previewAirdrop = Object.freeze({
  id: 'nova-community-preview',
  name: 'Nova Protocol',
  symbol: 'NOVA',
  allocationPercent: 3,
  reservedTokens: 30_000_000,
  walletAllocation: 12_500,
  status: 'preview-open',
});
let activeAirdropFilter = 'all';
function escapeHtml(value){ return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]); }
function formatFlowAmount(value){
  const amount = Number(value || 0);
  if (amount > 0 && amount < 0.000000001) return '<0.000000001 SOL';
  return `${amount.toLocaleString(undefined, { minimumFractionDigits: amount > 0 && amount < 1 ? 3 : 0, maximumFractionDigits: 9 })} SOL`;
}
function renderFeeFlowCalculator(){
  const input = document.querySelector('#fee-flow-input');
  if (!input) return;
  const note = document.querySelector('#fee-flow-note');
  const gross = Number(input.value);
  if (input.value.trim() === '' || !Number.isFinite(gross) || gross < 0) {
    ['creator', 'operations', 'referrals', 'community', 'buyback'].forEach(key => {
      const node = document.querySelector(`#fee-output-${key}`);
      if (node) node.textContent = '—';
    });
    if (note) note.textContent = 'Enter a non-negative gross creator-fee amount to preview the policy split.';
    return;
  }
  const allocations = {
    creator: gross * APP_ECONOMICS.creatorSharePercent / 100,
    operations: gross * APP_ECONOMICS.operationsEffectivePercent / 100,
    referrals: gross * APP_ECONOMICS.appReferralEffectivePercent / 100,
    community: gross * APP_ECONOMICS.communityEffectivePercent / 100,
    buyback: gross * APP_ECONOMICS.buybackEffectivePercent / 100,
  };
  Object.entries(allocations).forEach(([key, amount]) => {
    const node = document.querySelector(`#fee-output-${key}`);
    if (node) node.textContent = formatFlowAmount(amount);
  });
  const allocated = Object.values(allocations).reduce((sum, amount) => sum + amount, 0);
  if (note) note.textContent = `A ${formatFlowAmount(gross)} claim allocates exactly ${formatFlowAmount(allocated)} under the published policy.`;
}
function getPreviewClaims(){ try { return JSON.parse(localStorage.getItem(AIRDROP_PREVIEW_CLAIM_KEY) || '{}'); } catch { return {}; } }
let verifiedLaunchPolicies = [];
let verifiedLaunchPoliciesStatus = 'loading';
let verifiedCommunityReserves = new Map();
let communityReserveStatus = 'loading';
let communityClaimPolicy = null;
let communityFundingPreview = null;
async function loadCommunityReserveStatuses(){
  const response = await apiRequest('/api/airdrops/reserves').catch(() => ({ available:false }));
  communityReserveStatus = response.available && response.data?.cluster === 'devnet' && Array.isArray(response.data.reserves) ? 'ready' : 'unavailable';
  verifiedCommunityReserves = communityReserveStatus === 'ready'
    ? new Map(response.data.reserves.filter(row => row?.mint).map(row => [row.mint, row])) : new Map();
  communityClaimPolicy = communityReserveStatus === 'ready' ? response.data.claimPolicy || null : null;
  renderAirdropClaims();
}
async function loadVerifiedLaunchPolicies(){
  const response = await apiRequest('/api/launches').catch(() => ({ available: false }));
  if (!response.available || !Array.isArray(response.data)) {
    if (verifiedLaunchPoliciesStatus !== 'ready') {
      verifiedLaunchPoliciesStatus = 'unavailable';
      renderHomeHolderRewardCoins();
      renderCreatorLaunches();
      renderAirdropClaims();
    }
    return;
  }
  verifiedLaunchPoliciesStatus = 'ready';
  verifiedLaunchPolicies = response.data.filter(launch => launch.onchainVerified
    && launch.cluster === EXPLORE_CLUSTER
    && (launch.creatorWallet || launch.feePayer));
  updateExploreSortAvailability();
  renderCreatorLaunches();
  renderExploreAssets();
  renderRegistry();
  renderHomeLaunchBoard();
  renderHomeHolderRewardCoins();
  renderHomeKpiDashboard(assets);
  renderLeaderboard();
  renderOnchainReportState(assets);
  renderHomeOnchainSnapshot(assets);
  renderCoinPromotionBadge();
  renderWalletDetail();
  renderAirdropClaims();
  renderBuybackDashboard();
  void loadCommunityReserveStatuses();
}
function promotionForMint(mint){
  return verifiedPromotionBadge(verifiedLaunchPolicies.find(launch => launch.mint === mint));
}
function verifiedLaunchPolicyForMint(mint){
  return verifiedLaunchPolicies.find(launch => launch.mint === mint) || null;
}
function verifiedPolicyPercent(value){
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100 ? number : null;
}
function withVerifiedExploreBenefits(record){
  const policy = verifiedLaunchPolicyForMint(record.address || record.mint);
  if (!policy) return { ...record, benefitPolicyVerified: false, promotionTier: null, communityAirdropPercent: null, holderFeePercent: null, xFeePercent: null, creatorFeePercent: null };
  const paidPromotion = verifiedPromotionBadge(policy);
  const shares = policy.feeDistribution?.creatorDirected?.shares || {};
  return {
    ...record,
    benefitPolicyVerified: true,
    promotionTier: paidPromotion?.tier || 'standard',
    communityAirdropPercent: verifiedPolicyPercent(policy.communityAirdrop?.allocationPercent),
    holderFeePercent: verifiedPolicyPercent(shares.holderAirdropPercent),
    xFeePercent: verifiedPolicyPercent(shares.solClaimPercent),
    creatorFeePercent: verifiedPolicyPercent(shares.creatorWalletPercent),
  };
}
function promotionElement(mint, withProof = false){
  const badge = promotionForMint(mint);
  if (!badge) return null;
  const element = document.createElement(withProof ? 'a' : 'span');
  element.className = `promotion-badge promotion-badge--${badge.tier}`;
  element.textContent = badge.label;
  element.title = `${badge.amountTokens.toLocaleString()} $FUNDED burned in the creation transaction · paid promotion, not a token safety endorsement`;
  if (withProof) {
    element.href = exploreExplorer(`tx/${encodeURIComponent(badge.signature)}`);
    element.target = '_blank';
    element.rel = 'noopener noreferrer';
    element.setAttribute('aria-label', `${badge.tier} promotion burn proof on Solana Explorer`);
  }
  return element;
}
function renderCoinPromotionBadge(){
  const row = document.querySelector('.coin-title-row');
  if (!row) return;
  let holder = document.querySelector('#coin-promotion-badge');
  if (!holder) {
    holder = document.createElement('span');
    holder.id = 'coin-promotion-badge';
    row.querySelector('#coin-watch')?.before(holder);
  }
  holder.replaceChildren();
  const badge = promotionElement(getCoinMintAddress(), true);
  holder.hidden = !badge;
  if (badge) holder.append(badge);
}
function getWalletLaunchPolicies(){
  return walletLaunches(verifiedLaunchPolicies, connectedWalletAddress);
}
function portfolioHolderCount(asset){
  const indexed = asset?.holders == null || asset.holders === '' ? NaN : Number(asset.holders);
  if (Number.isFinite(indexed) && indexed >= 0) return indexed.toLocaleString();
  const accounts = asset?.holderAccounts == null || asset.holderAccounts === '' ? NaN : Number(asset.holderAccounts);
  if (Number.isFinite(accounts) && accounts >= 0) return `${asset?.holderCoverage === 'lower-bound' ? '≥' : ''}${accounts.toLocaleString()}`;
  const cached = homeHolderCountCache.get(asset?.address);
  if (cached && Date.now() - cached.at < 300_000 && Number.isFinite(cached.count) && cached.count >= 0) {
    return `${cached.coverage === 'lower-bound' ? '≥' : ''}${cached.count.toLocaleString()}`;
  }
  return '—';
}
function loadTokenLogo(avatar, launch){
  const mint = String(launch?.mint || '');
  if (!avatar || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint) || launch?.imageUri !== devnetImageUri(mint)) return;
  const sources = [`/devnet-images/${encodeURIComponent(mint)}`, devnetImageUri(mint)];
  let next = 0;
  const trySource = () => {
    if (!avatar.isConnected || next >= sources.length) return;
    const image = new Image();
    image.alt = '';
    image.decoding = 'async';
    image.onload = () => { if (avatar.isConnected) avatar.replaceChildren(image); };
    image.onerror = trySource;
    image.src = sources[next++];
  };
  trySource();
}
function loadPortfolioLogo(card, launch){
  loadTokenLogo(card?.querySelector('.portfolio-token-avatar, .asset-icon, .wallet-activity-icon, .home-token-avatar, .home-holder-reward-avatar, .claim-token-mark, .claim-token > span, .explore-ticker-token > i, .explore-tape-logo, .terminal-signal-logo, .leader-token-logo, .coin-trade-token-avatar'), launch);
}
function loadVerifiedTokenLogos(container){
  container?.querySelectorAll('[data-logo-mint]').forEach(row => loadPortfolioLogo(row, verifiedLaunchPolicyForMint(row.dataset.logoMint)));
}
function portfolioTokenCardMarkup({ mint, name, symbol, source, allocationPercent, removable = false }){
  const market = assets.find(item => item.address === mint);
  const tokenName = market?.name || name || 'Unnamed token';
  const tokenSymbol = market?.symbol || symbol || 'TOKEN';
  const stage = market ? exploreStageLabel(market) : 'Verified launch';
  const volume = market ? formatExploreUsd(market.volume24hSol, { partial: market.volumeCoverage === 'partial' }) : '—';
  const holders = portfolioHolderCount(market);
  const marketValue = market ? formatCoinUsd(market.migrated === true ? market.poolMarketCapSol : market.curveCapSol) : '—';
  const reserve = Number.isFinite(Number(allocationPercent)) ? `${Number(allocationPercent).toFixed(2).replace(/\.00$/, '')}%` : '—';
  const change = market?.change || '—';
  const changeValue = Number.parseFloat(change);
  const changeClass = Number.isFinite(changeValue) ? (changeValue >= 0 ? 'is-positive' : 'is-negative') : '';
  const icon = market?.icon || tokenSymbol.slice(0, 1);
  const freshness = market?.fetchedAt ? `Market checked ${formatFeedAge(market.fetchedAt)}` : 'Verified registry';
  const safeMint = escapeHtml(mint || '');
  const facts = allocationPercent == null
    ? [[market?.migrated === true ? 'Market cap' : 'Curve cap', marketValue], ['24h volume', market?.migrated === true ? 'Pool unindexed' : volume], [EXPLORE_CLUSTER === 'devnet' ? 'Token accounts' : 'Holders', holders], ['24h change', market?.migrated === true ? 'Pool unindexed' : change, changeClass]]
    : [['Launch stage', stage], ['Community reserve', reserve], ['24h volume', market?.migrated === true ? 'Pool unindexed' : volume], [EXPLORE_CLUSTER === 'devnet' ? 'Token accounts' : 'Holders', holders]];
  return `<article class="token-card-shell portfolio-token-card${removable ? ' watchlist-token-card' : ' project-token-card'}" data-mint="${safeMint}">
    <div class="portfolio-token-card-top">
      <span class="portfolio-token-avatar">${escapeHtml(icon)}</span>
      <span class="portfolio-token-identity"><strong>${escapeHtml(tokenSymbol)}</strong><small>${escapeHtml(tokenName)}</small></span>
      <span class="portfolio-token-stage">${escapeHtml(stage)}</span>
    </div>
    <p class="portfolio-token-source"><span>${escapeHtml(source || 'Solana Devnet')}</span><code>${safeMint ? `${escapeHtml(mint.slice(0, 4))}…${escapeHtml(mint.slice(-4))}` : 'Mint unavailable'}</code></p>
    <div class="portfolio-token-stats">${facts.map(([label, value, className = '']) => `<span class="${className}"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></span>`).join('')}</div>
    <div class="portfolio-token-footer"><span>${escapeHtml(freshness)}</span><div><a href="/token/${encodeURIComponent(mint || '')}">View token ↗</a>${market ? `<button type="button" data-trade-mint="${safeMint}">Trade</button>` : ''}${removable ? `<button type="button" class="portfolio-remove" data-remove-watch="${safeMint}" aria-label="Remove ${escapeHtml(tokenSymbol)} from watchlist">Remove</button>` : ''}</div></div>
  </article>`;
}
function renderCreatorLaunches(){
  const list = document.querySelector('#creator-launch-empty');
  if (!list) return;
  const sourceLabel = document.querySelector('#my-launches .section-state');
  if (sourceLabel) sourceLabel.textContent = verifiedLaunchPoliciesStatus === 'ready' ? 'verified registry' : 'checking registry';
  const sourceBadge = document.querySelector('#my-launches .data-badge');
  if (sourceBadge) sourceBadge.textContent = !connectedWalletAddress ? 'Connect wallet' : verifiedLaunchPoliciesStatus === 'ready' ? 'Registry ready' : verifiedLaunchPoliciesStatus === 'unavailable' ? 'Registry unavailable' : 'Checking registry';
  const launches = getWalletLaunchPolicies();
  const projectSelect = document.querySelector('#funded-burn-project');
  if (projectSelect) {
    const selectedMint = projectSelect.value;
    projectSelect.replaceChildren(new Option('No project selected', ''));
    for (const launch of launches) projectSelect.add(new Option(`${launch.name || 'Devnet coin'} (${launch.symbol || 'TOKEN'})`, launch.mint));
    projectSelect.value = launches.some(launch => launch.mint === selectedMint) ? selectedMint : '';
  }
  const stats = document.querySelector('#my-launches .projects-panel .role-stats');
  if (stats) {
    stats.hidden = !launches.length;
    const marketByMint = new Map(assets.map(asset => [asset.address, asset]));
    const stages = launches.map(launch => {
      const market = marketByMint.get(launch.mint);
      return market?.migrated === true ? 'migrated'
        : market?.complete === false || market?.migrated === false ? 'not-migrated'
          : 'unknown';
    });
    const statusKnown = stages.every(stage => stage !== 'unknown');
    const values = [
      launches.length,
      statusKnown ? stages.filter(stage => stage === 'not-migrated').length : '—',
      statusKnown ? stages.filter(stage => stage === 'migrated').length : '—',
    ];
    stats.querySelectorAll('b').forEach((value, index) => { value.textContent = String(values[index] ?? '—'); });
    stats.title = statusKnown ? 'Migration status verified on Solana' : 'Migration status awaiting on-chain verification';
  }
  list.replaceChildren();
  list.classList.toggle('empty-state', !launches.length);
  list.classList.toggle('compact-empty', !launches.length);
  list.classList.toggle('creator-launch-list', launches.length > 0);
  if (!launches.length) {
    const state = !connectedWalletAddress ? 'disconnected' : verifiedLaunchPoliciesStatus;
    const empty = document.createElement('div');
    empty.className = 'projects-empty-content';
    const icon = document.createElement('span');
    icon.className = 'projects-empty-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = state === 'ready' ? '◎' : '◫';
    const heading = document.createElement('h3');
    heading.textContent = state === 'disconnected' ? 'Connect your creator wallet' : state === 'ready' ? 'No projects for this wallet' : state === 'unavailable' ? 'Project registry unavailable' : 'Checking your projects';
    const explanation = document.createElement('p');
    explanation.textContent = state === 'disconnected'
      ? 'Projects are matched to the wallet recorded as creator at launch.'
      : state === 'ready'
        ? `Wallet ${shortAddress(connectedWalletAddress)} is not the creator wallet on any of the ${verifiedLaunchPolicies.length} verified funded.vip launches. Connect the wallet used to launch your coin to see it here.`
        : state === 'unavailable'
          ? `Verified launches for ${shortAddress(connectedWalletAddress)} cannot be checked right now.`
          : `Checking verified launches for ${shortAddress(connectedWalletAddress)}…`;
    const actions = document.createElement('div');
    actions.className = 'projects-empty-actions';
    const walletLink = document.createElement('a');
    walletLink.href = '#profile';
    walletLink.className = 'primary-button';
    walletLink.textContent = connectedWalletAddress ? 'Manage wallet' : 'Connect wallet';
    const exploreLink = document.createElement('a');
    exploreLink.href = '#explore';
    exploreLink.className = 'text-button';
    exploreLink.textContent = 'Explore launches →';
    actions.append(walletLink, exploreLink);
    empty.append(icon, heading, explanation, actions);
    if (verifiedLaunchPoliciesStatus === 'ready' && verifiedLaunchPolicies.length) {
      const recent = document.createElement('div');
      recent.className = 'projects-public-launches';
      const label = document.createElement('strong');
      label.textContent = connectedWalletAddress ? 'Other platform launches' : 'Recent platform launches';
      recent.append(label);
      for (const launch of verifiedLaunchPolicies.slice(0, 3)) {
        const link = document.createElement('a');
        link.href = `/token/${encodeURIComponent(launch.mint)}`;
        const name = document.createElement('span');
        name.textContent = `${launch.name || launch.symbol || 'Coin'} (${launch.symbol || 'TOKEN'})`;
        const walletLabel = document.createElement('small');
        walletLabel.textContent = `Creator ${shortAddress(launch.creatorWallet || launch.feePayer)} · View coin →`;
        link.append(name, walletLabel);
        recent.append(link);
      }
      empty.append(recent);
    }
    list.append(empty);
    return;
  }
  for (const launch of launches) {
    const holder = document.createElement('div');
    const market = assets.find(item => item.address === launch.mint);
    const marketCard = market
      ? withVerifiedExploreBenefits(EXPLORE_CLUSTER === 'devnet' ? withMarketWindow(market, exploreWindow) : enrichMarketRecord(market))
      : withVerifiedExploreBenefits({
          address: launch.mint,
          name: launch.name || 'Devnet coin',
          symbol: launch.symbol || 'TOKEN',
          icon: (launch.symbol || 'T').slice(0, 1).toUpperCase(),
          riskLevel: 'watch',
          change: '—',
          marketUnavailable: true,
        });
    holder.innerHTML = exploreAssetCardMarkup(marketCard);
    const card = holder.firstElementChild;
    card.classList.add('project-token-card');
    list.append(card);
    decorateExploreAssetCard(card, marketCard, launch);
    setWatchButtonState(card.querySelector('.watch-button'), getWatchlist().includes(launch.mint));
    if (marketCard.marketUnavailable) {
      card.querySelector('.asset-meta').textContent = 'Verified launch · market data unavailable';
      card.querySelector('.asset-status-badge').textContent = 'Registry verified';
      const flow = card.querySelector('.asset-trade-flow');
      if (flow) flow.innerHTML = '<span>24h trades <b>—</b></span><span>— traders</span>';
    }
  }
}
window.addEventListener('funded:projects-view-ready', renderCreatorLaunches);
function formatTokenAmount(value){ return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }); }
function formatVerifiedAirdropAmount(value){ return value == null ? '—' : formatTokenAmount(value); }
const demoAirdropPrograms = Object.freeze([]);
const demoClaimers = Object.freeze([]);
const demoUnclaimedWallets = Object.freeze([]);
const demoAirdropNotifications = Object.freeze([]);
const demoAirdropHistory = Object.freeze([]);
function getAirdropPrograms(){
  return verifiedLaunchPolicies.flatMap(launch => {
    const allocationPercent = Number(launch.communityAirdrop?.allocationPercent);
    const reservedTokens = Number(launch.communityAirdrop?.reservedTokens);
    if (!launch.mint || !Number.isFinite(allocationPercent) || !Number.isFinite(reservedTokens) || reservedTokens <= 0) return [];
    const reserve = verifiedCommunityReserves.get(launch.mint);
    return [{
      id: launch.mint,
      name: launch.name || 'Devnet launch',
      symbol: launch.symbol || 'TOKEN',
      allocationPercent,
      reservedTokens,
      creatorWallet: launch.creatorWallet,
      reserveStatus: reserve?.status || 'unverified',
      vaultInitialized: reserve?.vaultInitialized === true,
      vaultForFunding: reserve?.vault || null,
      claimedTokens: null,
      eligibleWallets: null,
      claimedWallets: null,
      vaultVerified: reserve?.verified === true && reserve.status === 'funded' && Number(reserve.reservedTokens) === reservedTokens,
      vaultAddress: reserve?.verified === true ? reserve.vault : null,
      fundingSignature: reserve?.verified === true ? reserve.fundingSignature : null,
      status: 'upcoming',
      deadline: 'After verified migration snapshot',
      snapshot: 'Migration · pending',
      walletAllocation: null,
    }];
  });
}
function airdropClaimRate(program){ return program.claimedTokens != null && program.vaultVerified === true && program.reservedTokens ? program.claimedTokens / program.reservedTokens : null; }
function renderAirdropSummary(programs){
  const node = document.querySelector('#airdrop-summary-kpis');
  if (!node) return;
  if (verifiedLaunchPoliciesStatus !== 'ready') {
    const note = verifiedLaunchPoliciesStatus === 'loading' ? 'Checking the verified launch registry' : 'Launch registry unavailable; counts not verified';
    node.innerHTML = `<article><span>Indexed launch policies</span><strong>—</strong><small>${note}</small></article><article><span>Policy allocation</span><strong>—</strong><small>${note}</small></article><article><span>Claimed so far</span><strong>—</strong><small>Claim receipts unavailable</small></article><article><span>Eligible wallets</span><strong>—</strong><small>Eligibility snapshot unavailable</small></article>`;
    return;
  }
  const reserved = programs.reduce((sum, item) => sum + item.reservedTokens, 0);
  const claimsVerified = programs.length > 0 && programs.every(item => item.claimedTokens != null && item.vaultVerified === true);
  const eligibilityVerified = programs.length > 0 && programs.every(item => item.eligibleWallets != null);
  const claimed = claimsVerified ? programs.reduce((sum, item) => sum + item.claimedTokens, 0) : null;
  const eligible = eligibilityVerified ? programs.reduce((sum, item) => sum + item.eligibleWallets, 0) : null;
  const fundedCount = programs.filter(item => item.vaultVerified).length;
  const fundingNote = communityReserveStatus === 'ready'
    ? `${fundedCount}/${programs.length} vaults funded and verified; eligibility pending`
    : communityReserveStatus === 'loading' ? 'Checking finalized vault accounts' : 'Vault verification unavailable; funded count unknown';
  node.innerHTML = `<article><span>Indexed launch policies</span><strong>${programs.length}</strong><small>Upcoming allocations; distribution not yet active</small></article><article><span>Policy allocation</span><strong>${formatTokenAmount(reserved)}</strong><small>${fundingNote}</small></article><article><span>Claimed so far</span><strong>${formatVerifiedAirdropAmount(claimed)}</strong><small>${claimed == null ? 'Claim receipts unavailable' : `${(claimed / reserved * 100).toFixed(1)}% of verified reserve`}</small></article><article><span>Eligible wallets</span><strong>${formatVerifiedAirdropAmount(eligible)}</strong><small>${eligible == null ? 'Eligibility snapshot unavailable' : 'Published snapshot participants'}</small></article>`;
}
function renderAirdropDirectory(programs = getAirdropPrograms()){
  const list = document.querySelector('#airdrop-directory');
  if (!list) return;
  const query = document.querySelector('#airdrop-search')?.value.trim().toLowerCase() || '';
  const sort = document.querySelector('#airdrop-sort')?.value || 'largest';
  const filtered = programs.filter(item => !query || `${item.name} ${item.symbol}`.toLowerCase().includes(query)).sort((a, b) => {
    if (sort === 'claim-rate') return (airdropClaimRate(b) ?? -1) - (airdropClaimRate(a) ?? -1);
    if (sort === 'unclaimed') return (b.vaultVerified && b.claimedTokens != null ? b.reservedTokens - b.claimedTokens : -1) - (a.vaultVerified && a.claimedTokens != null ? a.reservedTokens - a.claimedTokens : -1);
    if (sort === 'ending') return String(a.deadline).localeCompare(String(b.deadline));
    return b.reservedTokens - a.reservedTokens;
  });
  list.innerHTML = filtered.map(program => {
    const rate = airdropClaimRate(program);
    const unclaimed = program.vaultVerified === true && program.claimedTokens != null ? program.reservedTokens - program.claimedTokens : null;
    return `<article class="token-card-shell airdrop-directory-card" data-logo-mint="${escapeHtml(program.id)}"><div class="directory-card-top"><span class="claim-token-mark">${escapeHtml(program.symbol.slice(0, 1))}</span><div><strong>${escapeHtml(program.name)}</strong><small>${escapeHtml(program.symbol)} · ${escapeHtml(program.snapshot)}</small></div><span class="airdrop-status ${program.status}">${program.vaultVerified ? 'Vault funded · claims pending' : 'Funding unverified'}</span></div><div class="directory-stats"><span><small>Policy allocation</small><b>${formatTokenAmount(program.reservedTokens)}</b></span><span><small>Claimed</small><b>${formatVerifiedAirdropAmount(program.claimedTokens)}</b></span><span><small>Unclaimed</small><b>${formatVerifiedAirdropAmount(unclaimed)}</b></span><span><small>Eligible wallets</small><b>${formatVerifiedAirdropAmount(program.eligibleWallets)}</b></span></div><div class="directory-progress"><i style="width:${rate == null ? 0 : Math.min(100, rate * 100)}%"></i></div><div class="directory-footer"><span>${rate == null ? 'Claim status unverified' : `${(rate * 100).toFixed(1)}% claimed`} · ${escapeHtml(program.deadline)}</span><button type="button" class="secondary-button directory-claim" data-directory-mint="${escapeHtml(program.id)}" aria-controls="airdrop-selected-program">View details</button></div></article>`;
  }).join('') || `<div class="empty-state">${verifiedLaunchPoliciesStatus === 'loading' ? 'Checking published allocations…' : verifiedLaunchPoliciesStatus === 'unavailable' ? 'Launch registry unavailable; allocations cannot be verified.' : 'No airdrops match your search.'}</div>`;
  loadVerifiedTokenLogos(list);
}
function renderAirdropProgramDetail(program){
  const panel = document.querySelector('#airdrop-selected-program');
  if (!panel) return;
  const eyebrow = document.querySelector('#airdrop-selected-eyebrow');
  if (eyebrow) eyebrow.textContent = program.vaultVerified ? 'Indexed launch policy · vault funded on Devnet' : 'Indexed launch policy · funding unverified';
  document.querySelector('#airdrop-selected-title').textContent = `${program.name} (${program.symbol})`;
  document.querySelector('#airdrop-selected-stats').innerHTML = `<span><small>Policy reserve</small><strong>${formatTokenAmount(program.reservedTokens)} tokens · ${program.allocationPercent}% of supply</strong></span><span><small>Claimed</small><strong>${formatVerifiedAirdropAmount(program.claimedTokens)}</strong></span><span><small>Snapshot</small><strong>${escapeHtml(program.snapshot)}</strong></span><span><small>Eligible wallets</small><strong>${formatVerifiedAirdropAmount(program.eligibleWallets)}</strong></span>`;
  const status = document.querySelector('#airdrop-selected-status');
  status.textContent = program.vaultVerified
    ? `The ${formatTokenAmount(program.reservedTokens)} token reserve is verified in vault ${program.vaultAddress}. A migration-time $FUNDED snapshot and published claim proof are still required; claims are closed.`
    : 'Policy allocation is indexed, but vault funding, a finalized eligibility snapshot, and a claim proof are not verified. No wallet claim or token transfer is available.';
  if (communityClaimPolicy?.windowDays === 90 && communityClaimPolicy.unclaimedRecipient && communityClaimPolicy.status === 'not-activated') {
    status.append(document.createTextNode(` Planned policy: unclaimed tokens go to app owner ${communityClaimPolicy.unclaimedRecipient} after 90 days. Claim program not activated.`));
  }
  if (program.vaultVerified && /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(program.fundingSignature || '')) {
    const receipt = document.createElement('a');
    receipt.href = `https://explorer.solana.com/tx/${program.fundingSignature}${APP_EXPLORER_QUERY}`;
    receipt.target = '_blank'; receipt.rel = 'noopener noreferrer';
    receipt.textContent = ' Verify funding transaction ↗';
    status.append(receipt);
  }
  if (!program.vaultVerified && program.vaultInitialized && program.creatorWallet === connectedWalletAddress && canSignTransactions(wallet)) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'secondary-button'; button.dataset.fundCommunityMint = program.id;
    button.textContent = `Review funding ${formatTokenAmount(program.reservedTokens)} ${program.symbol}`;
    status.append(document.createElement('br'), button);
  } else if (!program.vaultVerified && program.creatorWallet === connectedWalletAddress && !program.vaultInitialized) {
    status.append(document.createTextNode(' The reward vault must be initialized before your wallet can fund it.'));
  }
  panel.hidden = false;
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
async function fundCommunityReserve(mintAddress){
  const session = captureWalletSession();
  const button = document.querySelector('[data-fund-community-mint]');
  const status = document.querySelector('#airdrop-selected-status');
  let submittedSignature = null;
  if (!session || !canSignTransactions(session.provider)) return;
  button.disabled = true;
  try {
    const launch = verifiedLaunchPolicies.find(row => row.mint === mintAddress && row.onchainVerified && row.cluster === 'devnet');
    if (!launch || launch.creatorWallet !== session.address || APP_CLUSTER !== 'devnet' || APP_MAINNET_READ_ONLY) throw new Error('Only the verified Devnet launch creator can fund this reserve.');
    const fresh = await apiRequest('/api/airdrops/reserves');
    const reserve = fresh.data?.reserves?.find(row => row.mint === mintAddress);
    if (!fresh.available || fresh.data.cluster !== 'devnet' || !reserve?.vaultInitialized || reserve.verified || reserve.creatorWallet !== session.address || reserve.status !== 'unfunded' || Number(reserve.reservedTokens) !== Number(launch.communityAirdrop?.reservedTokens)) throw new Error('Reserve state changed or the reward vault is not ready. Refresh the program details.');
    const { PublicKey, Transaction, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction } = await getSolana();
    const rpc = await getTradePreviewConnection();
    const mint = new PublicKey(mintAddress), vault = new PublicKey(reserve.vault);
    const mintInfo = await rpc.getAccountInfo(mint, 'finalized');
    if (!mintInfo || (!mintInfo.owner.equals(TOKEN_PROGRAM_ID) && !mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) || mintInfo.data.length < 45) throw new Error('Launch mint is not a finalized supported SPL mint.');
    const decimals = mintInfo.data[44];
    if (decimals > 9) throw new Error('Launch mint decimals are unsupported.');
    const amount = BigInt(reserve.reservedTokens) * 10n ** BigInt(decimals);
    const source = getAssociatedTokenAddressSync(mint, session.provider.publicKey, false, mintInfo.owner);
    const destination = getAssociatedTokenAddressSync(mint, vault, true, mintInfo.owner);
    const sourceBefore = BigInt((await rpc.getTokenAccountBalance(source, 'finalized')).value.amount);
    const destinationBefore = await rpc.getTokenAccountBalance(destination, 'finalized').then(row => BigInt(row.value.amount)).catch(() => 0n);
    if (sourceBefore < amount || destinationBefore !== 0n) throw new Error('The creator wallet lacks the full reserve or the vault already contains tokens.');
    if (!communityFundingPreview || communityFundingPreview.mint !== mintAddress || communityFundingPreview.wallet !== session.address || Date.now() - communityFundingPreview.at > 60_000) {
      communityFundingPreview = { mint:mintAddress, wallet:session.address, at:Date.now() };
      button.textContent = 'Sign reserve funding in wallet';
      status.append(document.createTextNode(` Review: transfer ${formatTokenAmount(reserve.reservedTokens)} ${launch.symbol || 'tokens'} from your wallet to reward vault ${reserve.vault}. Your wallet also pays network and token-account rent. The transfer does not open claims.`));
      return;
    }
    communityFundingPreview = null;
    assertWalletSessionCurrent(session);
    const latest = await rpc.getLatestBlockhash('confirmed');
    const transaction = new Transaction({ feePayer:session.provider.publicKey, recentBlockhash:latest.blockhash }).add(
      createAssociatedTokenAccountIdempotentInstruction(session.provider.publicKey, destination, vault, mint, mintInfo.owner),
      createTransferCheckedInstruction(source, mint, destination, session.provider.publicKey, amount, decimals, [], mintInfo.owner),
    );
    const signed = await session.provider.signTransaction(transaction);
    assertWalletSessionCurrent(session);
    submittedSignature = await rpc.sendRawTransaction(signed.serialize(), { skipPreflight:false, maxRetries:3 });
    const confirmation = await waitForSignatureConfirmation(rpc, { signature:submittedSignature, lastValidBlockHeight:latest.lastValidBlockHeight, commitment:'finalized' });
    if (confirmation.value.err) throw new Error(`Funding transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    const [sourceAfter, destinationAfter] = await Promise.all([
      rpc.getTokenAccountBalance(source, 'finalized').then(row => BigInt(row.value.amount)),
      rpc.getTokenAccountBalance(destination, 'finalized').then(row => BigInt(row.value.amount)),
    ]);
    if (sourceBefore - sourceAfter !== amount || destinationAfter - destinationBefore !== amount) throw new Error('Funding finalized, but exact token balance changes were not observed.');
    const recorded = await apiRequest('/api/airdrops/reserves/receipt', { method:'POST', body:{ mint:mintAddress, signature:submittedSignature } });
    if (!recorded.available || !recorded.data?.verified) throw new Error('The server did not verify the finalized creator funding receipt.');
    await loadCommunityReserveStatuses();
    renderAirdropProgramDetail(getAirdropPrograms().find(row => row.id === mintAddress));
    showToast('Community reserve funded and verified on Devnet');
  } catch (error) {
    communityFundingPreview = null;
    status.append(document.createTextNode(submittedSignature
      ? ` Funding status is uncertain for ${submittedSignature}. Check the Devnet transaction before retrying: ${String(error.message || error)}`
      : ` Funding stopped: ${String(error.message || error)}`));
  } finally { button.disabled = false; }
}
function renderAirdropAnalytics(){
  const claimers = document.querySelector('#airdrop-top-claimers');
  const programs = document.querySelector('#airdrop-top-programs');
  const wallets = document.querySelector('#unclaimed-wallets');
  const leaderboardSort = document.querySelector('#leaderboard-sort')?.value || 'amount';
  const privateMode = document.querySelector('#leaderboard-private')?.checked ?? true;
  const sortedClaimers = [...demoClaimers].sort((a, b) => leaderboardSort === 'rate' ? (b.amount / 1_000_000) - (a.amount / 1_000_000) : b.amount - a.amount);
  if (claimers) claimers.innerHTML = sortedClaimers.map((item, index) => `<div class="leader-row"><b>${index + 1}</b><span><strong>${privateMode ? item.wallet : item.wallet.replace('…', '…')}</strong><small>${item.symbol} claimed${leaderboardSort === 'rate' ? ' · 85.0% of allocation' : ''}</small></span><em>${formatTokenAmount(item.amount)}</em></div>`).join('');
  if (programs) programs.innerHTML = getAirdropPrograms().sort((a, b) => b.reservedTokens - a.reservedTokens).slice(0, 5).map((item, index) => `<div class="leader-row" data-logo-mint="${escapeHtml(item.id)}"><b>${index + 1}</b><i class="leader-token-logo" aria-hidden="true">${escapeHtml(String(item.symbol || "T").slice(0, 1))}</i><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.symbol)} · ${airdropClaimRate(item) == null ? 'Snapshot pending' : `${(airdropClaimRate(item) * 100).toFixed(1)}% claimed`}</small></span><em>${formatTokenAmount(item.reservedTokens)}</em></div>`).join('');
  loadVerifiedTokenLogos(programs);
  const verifiedWallets = getVerifiedUnclaimedWallets();
  if (wallets) wallets.innerHTML = verifiedWallets.map(item => `<tr><td><strong>${item.wallet}</strong></td><td>${item.program}</td><td>${formatTokenAmount(item.eligible)}</td><td>${formatTokenAmount(item.claimed)}</td><td>${formatTokenAmount(item.eligible - item.claimed)}</td><td><span class="wallet-claim-status">${item.status}</span></td></tr>`).join('');
  const count = document.querySelector('#unclaimed-wallet-count');
  if (count) count.textContent = verifiedWallets.length ? `${verifiedWallets.length} verified wallets` : 'Eligibility snapshot pending';
  const exportButton = document.querySelector('#airdrop-export-csv');
  if (exportButton) exportButton.disabled = verifiedWallets.length === 0;
  const notificationNode = document.querySelector('#airdrop-notifications');
  if (notificationNode) notificationNode.innerHTML = demoAirdropNotifications.map(item => `<div class="notification-row ${item.tone}"><b>${item.icon}</b><span><strong>${item.title}</strong><small>${item.detail}</small></span></div>`).join('');
  const historyNode = document.querySelector('#airdrop-history');
  if (historyNode) historyNode.innerHTML = `<p class="history-label">Recent activity</p>${demoAirdropHistory.map(item => `<div class="history-row"><span><strong>${item.token} · ${item.event}</strong><small>${item.date} · ${item.status}</small></span><em>${item.amount}</em></div>`).join('')}`;
}
function getVerifiedUnclaimedWallets(){
  return demoUnclaimedWallets.filter(item => item.snapshotVerified === true && Number(item.eligible) > Number(item.claimed));
}
function exportAirdropCsv(){
  const verifiedWallets = getVerifiedUnclaimedWallets();
  if (!verifiedWallets.length) {
    showToast('No verified eligibility snapshot or unclaimed wallets are available to export');
    return;
  }
  const rows = [['wallet', 'program', 'eligible', 'claimed', 'unclaimed', 'status'], ...verifiedWallets.map(item => [item.wallet, item.program, item.eligible, item.claimed, item.eligible - item.claimed, item.status])];
  const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'funded-airdrop-unclaimed-wallets.csv';
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('Unclaimed wallet CSV exported');
}
function renderAirdropClaims(filter = activeAirdropFilter){
  activeAirdropFilter = filter;
  const list = document.querySelector('#airdrop-claim-list');
  if (!list) return;
  const previewClaimed = Boolean(getPreviewClaims()[previewAirdrop.id]);
  const programs = getAirdropPrograms();
  const claims = [
    ...programs.map(program => ({ ...program, state: program.id === previewAirdrop.id && previewClaimed ? 'claimed' : program.status, badge: program.id === previewAirdrop.id ? 'Demo allocation' : 'Policy allocation' })),
  ];
  const filtered = claims.filter(claim => filter === 'all' || claim.state === filter);
  list.innerHTML = filtered.map(claim => {
    const isPreview = claim.id === previewAirdrop.id;
    const action = claim.state === 'claimable' ? `<button type="button" class="secondary-button claim-action" data-preview-claim="${escapeHtml(claim.id)}" ${claim.state === 'claimed' ? 'disabled' : ''}>${claim.state === 'claimed' ? 'Already claimed' : isPreview ? 'Test claim flow' : 'Check eligibility'}</button>` : `<button type="button" class="secondary-button claim-action" disabled>${claim.state === 'claimed' ? 'Claim recorded' : claim.vaultVerified ? 'Opens after snapshot' : 'Requires funded vault'}</button>`;
    const amount = claim.walletAllocation == null ? `${formatTokenAmount(claim.reservedTokens)} ${claim.vaultVerified ? 'tokens vaulted' : 'tokens planned'}` : `${formatTokenAmount(claim.walletAllocation)} ${escapeHtml(claim.symbol)}`;
    const detail = isPreview
      ? 'Local interaction preview. No wallet signature or token transfer occurs.'
      : `${claim.allocationPercent}% supply policy allocation · $FUNDED-holder snapshot at migration`;
    return `<article class="token-card-shell claim-card" data-claim-state="${claim.state}" data-logo-mint="${escapeHtml(claim.id)}"><div class="claim-token"><span>${escapeHtml(claim.symbol.slice(0, 1))}</span><div><strong>${escapeHtml(claim.name)}</strong><small>${escapeHtml(claim.symbol)} · ${escapeHtml(claim.badge)}</small></div></div><div class="claim-amount"><span>${claim.state === 'claimed' ? 'Preview result' : claim.walletAllocation == null ? claim.vaultVerified ? 'Verified vault reserve' : 'Policy allocation' : 'Example allocation'}</span><strong>${amount}</strong></div><p>${detail}</p>${action}</article>`;
  }).join('') || `<div class="empty-state">${verifiedLaunchPoliciesStatus === 'loading' ? 'Checking published allocations…' : verifiedLaunchPoliciesStatus === 'unavailable' ? 'Launch registry unavailable; claim availability cannot be verified.' : 'No claims match this filter.'}</div>`;
  loadVerifiedTokenLogos(list);
  document.querySelectorAll('[data-airdrop-filter]').forEach(button => button.classList.toggle('active', button.dataset.airdropFilter === filter));
  const state = document.querySelector('#claim-wallet-state');
  if (state) state.textContent = connectedWalletAddress ? `Wallet ${connectedWalletAddress.slice(0, 4)}…${connectedWalletAddress.slice(-4)} connected. Eligibility appears only after a verified Devnet snapshot is indexed.` : 'Connect your wallet to check eligibility. No claim data is shown until confirmed Devnet receipts or an indexed proof is available.';
  const count = document.querySelector('#claim-program-count');
  if (count) count.textContent = verifiedLaunchPoliciesStatus === 'ready'
    ? `${programs.length} published ${programs.length === 1 ? 'allocation' : 'allocations'}`
    : verifiedLaunchPoliciesStatus === 'loading' ? 'Checking allocations…' : 'Allocations unavailable';
  renderAirdropSummary(programs);
  renderAirdropDirectory(programs);
  renderAirdropAnalytics();
}

function getBuybackPreviewState(){
  return { accruals: [], receipts: [] };
}
let buybackNetworkState = { status:'loading', receipts:[], pending:[] };
async function loadBuybackNetworkState(){
  try {
    const response = await apiRequest('/api/buyback/status', { signal:AbortSignal.timeout(8000) });
    if (!response.available || !response.data || response.data.cluster !== 'devnet') throw new Error('Devnet buyback index unavailable.');
    buybackNetworkState = { status:'ready', receipts:Array.isArray(response.data.receipts) ? response.data.receipts : [], pending:Array.isArray(response.data.pending) ? response.data.pending : [] };
  } catch { buybackNetworkState = { status:'unavailable', receipts:[], pending:[] }; }
  renderBuybackDashboard();
}
function saveBuybackPreviewState(state){ localStorage.setItem(BUYBACK_PREVIEW_KEY, JSON.stringify(state)); }
function formatBuybackAmount(value, maximumFractionDigits = 4){ return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits }); }
function renderBuybackExample(){
  const input = document.querySelector('#buyback-example-fees');
  const help = input?.parentElement?.querySelector('.field-help');
  if (!help) return;
  const fees = Number(input.value);
  help.textContent = input.value.trim() && Number.isFinite(fees) && fees > 0
    ? `${formatBuybackAmount(fees, 9)} SOL in gross fees would allocate ${formatBuybackAmount(fees * 0.01, 9)} SOL (1%) to buybacks. Local calculation only; no claim recorded.`
    : 'Enter gross creator fees above zero to preview the 1% buyback allocation.';
}
function fundedReceiptProject(receipt){
  if (!receipt?.projectMint) return 'No project attribution';
  const launch = verifiedLaunchPolicies.find(item => item.mint === receipt.projectMint);
  return launch ? `${launch.name || 'Devnet coin'} (${launch.symbol || 'TOKEN'})` : `${receipt.projectMint.slice(0, 4)}…${receipt.projectMint.slice(-4)}`;
}
function updateFundedBurnButton(){
  const input = document.querySelector('#funded-burn-amount');
  const button = document.querySelector('#funded-burn-submit');
  if (!input || !button) return;
  const signingReady = fundedBurnState.status === 'ready' && Boolean(wallet && canSignTransactions(wallet));
  let reason = '';
  try {
    const amount = parseTokenAmount(input.value, fundedBurnState.decimals);
    if (amount > fundedBurnState.balanceBaseUnits) reason = 'The burn amount exceeds this wallet’s $FUNDED balance.';
  } catch (error) { reason = error.message; }
  input.disabled = !signingReady || fundedBurnState.balanceBaseUnits <= 0n;
  button.disabled = input.disabled || Boolean(reason) || fundedBurnState.status === 'submitting';
  button.title = input.disabled
    ? (fundedBurnState.status === 'loading' ? 'Loading the on-chain $FUNDED balance.' : 'Connect a signing wallet with a verified $FUNDED balance.')
    : reason;
}
function renderWalletFundedBalance(){
  const balance = document.querySelector('#wallet-popover-funded');
  if (!balance) return;
  const note = balance.closest('.wallet-popover-balance')?.parentElement?.querySelector('em');
  const currentWallet = Boolean(connectedWalletAddress && fundedBurnState.wallet === connectedWalletAddress);
  const ready = currentWallet && fundedBurnState.status === 'ready';
  balance.textContent = ready ? formatTokenBaseUnits(fundedBurnState.balanceBaseUnits, fundedBurnState.decimals, 6) : '—';
  if (note) note.textContent = ready ? 'Live SPL token balance' : currentWallet && fundedBurnState.status === 'loading' ? 'Loading from Devnet' : 'Balance unavailable';
}
async function loadFundedBurnState({ force = false } = {}){
  const address = connectedWalletAddress;
  if (!force && fundedBurnState.status === 'loading') return;
  if (!force && fundedBurnState.status === 'ready' && fundedBurnState.wallet === address && Date.now() - (fundedBurnState.loadedAt || 0) < 30_000) return;
  const request = ++fundedBurnRequest;
  fundedBurnState = { ...fundedBurnState, status: 'loading', wallet: address, message: 'Reading the $FUNDED mint, wallet balance, and indexed receipts from Devnet…' };
  renderBuybackDashboard();
  renderWalletFundedBalance();
  try {
    if (!PROTOCOL_FUNDED_MINT) throw new Error('The protocol $FUNDED mint is not configured.');
    const { PublicKey, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getMint, unpackAccount } = await getSolana();
    const mint = new PublicKey(PROTOCOL_FUNDED_MINT);
    const mintAccount = await connection.getAccountInfo(mint, 'confirmed');
    if (!mintAccount || (!mintAccount.owner.equals(TOKEN_PROGRAM_ID) && !mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID))) throw new Error('The configured $FUNDED mint is not a supported SPL mint on Devnet.');
    const tokenProgram = mintAccount.owner;
    const mintState = await getMint(connection, mint, 'confirmed', tokenProgram);
    let tokenAccounts = [];
    let balanceBaseUnits = 0n;
    if (address) {
      const owner = new PublicKey(address);
      const response = await connection.getTokenAccountsByOwner(owner, { mint }, 'confirmed');
      tokenAccounts = response.value.map(row => {
        const account = unpackAccount(row.pubkey, row.account, tokenProgram);
        return { address: row.pubkey, amount: account.amount };
      }).filter(row => row.amount > 0n).sort((a, b) => a.amount === b.amount ? 0 : a.amount > b.amount ? -1 : 1);
      balanceBaseUnits = tokenAccounts.reduce((sum, row) => sum + row.amount, 0n);
    }
    const indexed = address ? await apiRequest(`/api/burn-receipts?wallet=${encodeURIComponent(address)}`).catch(() => ({ available: false })) : { available: true, data: { receipts: [] } };
    if (request !== fundedBurnRequest || address !== connectedWalletAddress) return;
    fundedBurnState = {
      status: 'ready', wallet: address, decimals: mintState.decimals, balanceBaseUnits,
      supplyBaseUnits: mintState.supply, burnedBaseUnits: burnedSupplyBaseUnits(mintState.supply, mintState.decimals),
      tokenProgram, tokenAccounts, receipts: indexed.available && Array.isArray(indexed.data?.receipts) ? indexed.data.receipts : [],
      receiptIndexAvailable: indexed.available, loadedAt: Date.now(), message: address
        ? (indexed.available ? 'Live Devnet balance and server-verified receipts loaded.' : 'Live Devnet balance loaded; the receipt index is unavailable.')
        : 'Live Devnet supply loaded. Connect a wallet to view its balance and burn receipts.',
    };
  } catch (error) {
    if (request !== fundedBurnRequest) return;
    const detail = String(error?.message || '');
    const unavailable = /(?:5\d\d Internal Server Error|failed to fetch|networkerror|econnrefused)/i.test(detail);
    fundedBurnState = { ...fundedBurnState, status: 'error', wallet: address, message: unavailable
      ? 'Devnet RPC unavailable; $FUNDED mint and balance could not be verified.'
      : detail || 'Devnet burn data is unavailable.' };
  }
  renderBuybackDashboard();
  renderWalletFundedBalance();
  if (document.querySelector('#wallet-page:not([hidden])')) renderWalletDetail();
}
function renderFundedBuyControl(message = null){
  const input = document.querySelector('#funded-buy-amount');
  const button = document.querySelector('#funded-buy-submit');
  const badge = document.querySelector('#funded-buy-route-state');
  const status = document.querySelector('#funded-buy-status');
  if (!input || !button || !badge || !status) return;
  const ready = fundedBuyRoute.status === 'ready';
  const amount = Number(input.value);
  input.disabled = !ready || fundedBuyBusy;
  button.disabled = !ready || fundedBuyBusy || !Number.isFinite(amount) || amount <= 0;
  button.textContent = fundedBuyBusy ? 'Waiting for Devnet…' : fundedBuyPreview ? 'Confirm buy' : wallet ? 'Preview buy' : 'Connect wallet to preview';
  badge.textContent = ready ? 'Devnet pool live' : fundedBuyRoute.status === 'checking' ? 'Checking' : 'Unavailable';
  badge.classList.toggle('unavailable', !ready);
  if (message != null) status.textContent = message;
  else if (!ready) status.textContent = fundedBuyRoute.reason;
}
async function refreshFundedBuyRoute(){
  try {
    if (APP_CLUSTER !== 'devnet' || APP_MAINNET_READ_ONLY || !PROTOCOL_FUNDED_MINT || !PROTOCOL_FUNDED_SWAP_POOL) throw new Error('A Devnet $FUNDED mint and pool are required.');
    const rpc = await getTradePreviewConnection();
    const snapshot = await fetchVerifiedPoolSnapshot({ connection:rpc, mint:PROTOCOL_FUNDED_MINT, poolAddress:PROTOCOL_FUNDED_SWAP_POOL });
    fundedBuyPreview = null;
    fundedBuyRoute = { status:'ready', snapshot, reason:null };
    renderFundedBuyControl(`Verified Devnet pool ${snapshot.pool.slice(0, 6)}…${snapshot.pool.slice(-4)} · ${snapshot.quoteReservesSol.toFixed(3)} SOL liquidity.`);
  } catch (error) {
    fundedBuyPreview = null;
    fundedBuyRoute = { status:'unavailable', snapshot:null, reason:`Buy is unavailable: ${String(error.message || error)}` };
    renderFundedBuyControl();
  }
}
async function handleFundedBuy(){
  if (fundedBuyBusy || fundedBuyRoute.status !== 'ready') return;
  const amount = Number(document.querySelector('#funded-buy-amount')?.value);
  if (!Number.isFinite(amount) || amount <= 0) return renderFundedBuyControl('Enter a positive SOL amount to preview.');
  const maxAmount = Math.min(0.01, fundedBuyRoute.snapshot.quoteReservesSol * 0.03);
  if (amount > maxAmount) return renderFundedBuyControl(`This test pool limits each buy to ${maxAmount.toFixed(6)} SOL (3% of verified reserves).`);
  if (!wallet) { await connectWallet(); if (!wallet) return; }
  const session = captureWalletSession();
  if (!session || !canSignTransactions(session.provider)) return renderFundedBuyControl('Open the app in a wallet that can sign Devnet transactions.');
  const samePreview = fundedBuyPreview && fundedBuyPreview.amount === amount && fundedBuyPreview.wallet === session.address;
  if (fundedBuyPreview && (!samePreview || Date.now() - fundedBuyPreview.preparedAt > 15_000)) {
    fundedBuyPreview = null;
    return renderFundedBuyControl('The quote changed or expired. Preview again before signing.');
  }
  fundedBuyBusy = true;
  renderFundedBuyControl();
  let submittedSignature = null;
  try {
    const rpc = await getTradePreviewConnection();
    assertWalletSessionCurrent(session);
    if (!fundedBuyPreview) {
      const trade = await buildVerifiedPoolTradeTransaction({ connection:rpc, side:'buy', mint:PROTOCOL_FUNDED_MINT, poolAddress:PROTOCOL_FUNDED_SWAP_POOL, user:session.provider.publicKey, amount, slippagePercent:1, feeOwner:TRADE_FEE_OWNER, feeBps:TRADE_FEE_BPS });
      assertWalletSessionCurrent(session);
      const quote = describeTradeQuote(trade, 1);
      fundedBuyPreview = { trade, amount, wallet:session.address, preparedAt:Date.now() };
      renderFundedBuyControl(`Estimated ${quote.expected.toLocaleString(undefined, { maximumFractionDigits:6 })} $FUNDED. Maximum pool spend ${quote.maximumSpendSol.toFixed(6)} SOL; app fee ${quote.appFeeSol.toFixed(6)} SOL, plus network costs. Quote expires in 15 seconds.`);
      return;
    }
    const { PublicKey, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } = await getSolana();
    const mint = new PublicKey(PROTOCOL_FUNDED_MINT);
    const mintInfo = await rpc.getAccountInfo(mint, 'finalized');
    if (!mintInfo || (!mintInfo.owner.equals(TOKEN_PROGRAM_ID) && !mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID))) throw new Error('The $FUNDED mint is not a verified SPL mint.');
    const tokenAccount = getAssociatedTokenAddressSync(mint, session.provider.publicKey, false, mintInfo.owner);
    const beforeAccount = await rpc.getAccountInfo(tokenAccount, 'finalized');
    const before = beforeAccount ? BigInt((await rpc.getTokenAccountBalance(tokenAccount, 'finalized')).value.amount) : 0n;
    const preparedTrade = fundedBuyPreview.trade;
    fundedBuyPreview = null;
    const result = await submitTrade({ connection:rpc, provider:session.provider, side:'buy', mint, user:session.provider.publicKey, amount, slippagePercent:1, feeOwner:TRADE_FEE_OWNER, feeBps:TRADE_FEE_BPS, preparedTrade, tokenName:'Funded', tokenSymbol:'FUNDED', assertWalletCurrent:()=>assertWalletSessionCurrent(session), onStatus:renderFundedBuyControl });
    submittedSignature = result.signature;
    await waitForSignatureConfirmation(rpc, { signature:result.signature, commitment:'finalized' });
    assertWalletSessionCurrent(session);
    const after = BigInt((await rpc.getTokenAccountBalance(tokenAccount, 'finalized')).value.amount);
    const minimum = BigInt((result.minimumOutputAmount || result.outputAmount).toString());
    if (after - before < minimum) throw new Error(`Transaction ${result.signature} finalized, but the expected $FUNDED balance increase was not observed.`);
    document.querySelector('#funded-buy-amount').value = '';
    renderFundedBuyControl(`Buy finalized: ${result.signature}. Received ${Number(after - before) / 10 ** result.tokenDecimals} $FUNDED.`);
    showToast('Verified $FUNDED buy finalized on Devnet');
    void loadFundedBurnState({ force:true });
  } catch (error) {
    fundedBuyPreview = null;
    renderFundedBuyControl(error.signature || submittedSignature
      ? `Confirmation is uncertain for ${error.signature || submittedSignature}. Check that signature on Devnet before trying again.`
      : `Buy stopped or confirmation unavailable: ${String(error.message || error)}`);
  } finally {
    fundedBuyBusy = false;
    renderFundedBuyControl();
  }
}
function renderBuybackDashboard(message = ''){
  const state = getBuybackPreviewState();
  const summary = summarizeBuybackLedger(state.accruals, state.receipts);
  const pendingSol = summary.pendingByAsset.SOL || 0;
  const launchBurns = verifiedLaunchPolicies.filter(launch => launch?.creatorLaunchBurn?.status === 'verified'
    && launch.creatorLaunchBurn.receipt && Number(launch.creatorLaunchBurn.receipt.amountTokens ?? launch.creatorLaunchBurn.amountTokens) > 0);
  const walletLaunchBurns = launchBurns.filter(launch => launch.creatorWallet === connectedWalletAddress);
  const standaloneReceipts = fundedBurnState.wallet === connectedWalletAddress ? fundedBurnState.receipts : [];
  const receiptSignatures = new Set([...walletLaunchBurns.map(launch => launch.creatorLaunchBurn.receipt.signature), ...standaloneReceipts.map(receipt => receipt.signature)].filter(Boolean));
  const indexedWalletBurned = walletLaunchBurns.reduce((sum, launch) => sum + Number(launch.creatorLaunchBurn.receipt.amountTokens ?? launch.creatorLaunchBurn.amountTokens), 0)
    + standaloneReceipts.filter(receipt => !walletLaunchBurns.some(launch => launch.creatorLaunchBurn.receipt.signature === receipt.signature)).reduce((sum, receipt) => sum + Number(receipt.amountTokens || 0), 0);
  document.querySelector('#buyback-pending').textContent = fundedBurnState.status === 'ready' ? formatTokenBaseUnits(fundedBurnState.balanceBaseUnits, fundedBurnState.decimals, 6) : '—';
  document.querySelector('#buyback-burned').textContent = fundedBurnState.status === 'ready' ? formatTokenBaseUnits(fundedBurnState.burnedBaseUnits, fundedBurnState.decimals, 6) : '—';
  document.querySelector('#buyback-claims').textContent = connectedWalletAddress && fundedBurnState.status === 'ready' ? String(receiptSignatures.size) : '—';
  const feeReceipts = buybackNetworkState.receipts;
  const totalReceiptCount = feeReceipts.length + launchBurns.length + standaloneReceipts.filter(receipt => !launchBurns.some(launch => launch.creatorLaunchBurn.receipt.signature === receipt.signature)).length;
  document.querySelector('#buyback-execution-count').textContent = `${totalReceiptCount} verified receipt${totalReceiptCount === 1 ? '' : 's'}`;
  const burnedNote = document.querySelector('#buyback-burned')?.parentElement?.querySelector('em');
  const claimsNote = document.querySelector('#buyback-claims')?.parentElement?.querySelector('em');
  const balanceNote = document.querySelector('#buyback-pending')?.parentElement?.querySelector('em');
  if (balanceNote) balanceNote.textContent = fundedBurnState.status === 'ready' ? 'Live SPL token balance' : fundedBurnState.status === 'loading' ? 'Loading from Devnet' : 'Balance unavailable';
  if (burnedNote) burnedNote.textContent = fundedBurnState.status === 'ready' ? 'On-chain supply delta from 1B mint' : 'Supply unavailable';
  if (claimsNote) claimsNote.textContent = fundedBurnState.receiptIndexAvailable ? 'Server-verified BurnChecked receipts' : 'Receipt index unavailable';
  const executedIds = new Set(state.receipts.flatMap(receipt => receipt.accrualIds || []));
  const events = [
    ...state.accruals.map(accrual => ({ type: 'accrual', at: accrual.claimedAt, data: accrual })),
    ...state.receipts.map(receipt => ({ type: 'receipt', at: receipt.executedAt, data: receipt })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const previewRows = events.map(event => {
    if (event.type === 'receipt') {
      const receipt = event.data;
      return `<div class="buyback-ledger-row burn"><span class="buyback-ledger-icon">♨</span><span><strong>${formatBuybackAmount(receipt.tokensBurned, 2)} $FUNDED burned</strong><small>${formatBuybackAmount(receipt.inputAmount)} ${escapeHtml(receipt.asset)} · ${escapeHtml(receipt.burnInstruction)} · local preview</small></span><b>Supply ↓</b></div>`;
    }
    const accrual = event.data;
    const executed = executedIds.has(accrual.id);
    return `<div class="buyback-ledger-row"><span class="buyback-ledger-icon">↗</span><span><strong>${formatBuybackAmount(accrual.buybackAmount)} ${escapeHtml(accrual.asset)} allocated</strong><small>${formatBuybackAmount(accrual.grossCreatorFees)} ${escapeHtml(accrual.asset)} gross fees · claim ${escapeHtml(accrual.claimSignature.slice(-8))}</small></span><b>${executed ? 'Burned' : 'Pending'}</b></div>`;
  }).join('');
  const launchRows = launchBurns.map(launch => {
    const burn = launch.creatorLaunchBurn; const receipt = burn.receipt;
    const signature = String(receipt.signature || '');
    return `<div class="buyback-ledger-row burn"><span class="buyback-ledger-icon">♨</span><span><strong>${formatBuybackAmount(receipt.amountTokens ?? burn.amountTokens, 2)} $FUNDED burned</strong><small>${escapeHtml(launch.symbol || 'TOKEN')} launch promotion · ${escapeHtml(burn.label || burn.tier || 'verified tier')} · BurnChecked</small><a href="${escapeHtml(exploreExplorer(`tx/${encodeURIComponent(signature)}`))}" target="_blank" rel="noopener noreferrer">Confirmed transaction ↗</a></span><b>Supply ↓</b></div>`;
  }).join('');
  const standaloneRows = standaloneReceipts.filter(receipt => !launchBurns.some(launch => launch.creatorLaunchBurn.receipt.signature === receipt.signature)).map(receipt => `<div class="buyback-ledger-row burn"><span class="buyback-ledger-icon">♨</span><span><strong>${formatBuybackAmount(receipt.amountTokens, 6)} $FUNDED burned</strong><small>${escapeHtml(fundedReceiptProject(receipt))} · BurnChecked · server verified</small><a href="${escapeHtml(exploreExplorer(`tx/${encodeURIComponent(receipt.signature)}`))}" target="_blank" rel="noopener noreferrer">Confirmed transaction ↗</a></span><b>Supply ↓</b></div>`).join('');
  const feeRows = feeReceipts.map(receipt => {
    const baseUnits = BigInt(receipt.boughtAndBurnedBaseUnits || '0');
    const amount = formatTokenBaseUnits(baseUnits, Number(receipt.tokenDecimals ?? 6), 6);
    const spentSol = (BigInt(receipt.settledLamports || '0') - BigInt(receipt.returnedLamports || '0'));
    return `<div class="buyback-ledger-row burn"><span class="buyback-ledger-icon">♨</span><span><strong>${escapeHtml(amount)} $FUNDED bought and burned</strong><small>${escapeHtml(formatTokenBaseUnits(spentSol, 9, 9))} SOL from verified creator fees · BurnChecked · unused SOL returned to router</small><a href="${escapeHtml(exploreExplorer(`tx/${encodeURIComponent(receipt.signature)}`))}" target="_blank" rel="noopener noreferrer">Confirmed buy and burn ↗</a></span><b>Supply ↓</b></div>`;
  }).join('');
  document.querySelector('#buyback-ledger').innerHTML = `${feeRows}${standaloneRows}${launchRows}${previewRows}` || (buybackNetworkState.status === 'unavailable' ? '<div class="empty-state">Devnet buyback receipt index is unavailable. Try again shortly.</div>' : '<div class="empty-state">No verified $FUNDED burn receipts are indexed on Devnet yet. Fee-funded buybacks and launch-promotion burns are tracked separately.</div>');
  const runButton = document.querySelector('#buyback-run-preview');
  const addButton = document.querySelector('#buyback-add-claim');
  if (addButton) { addButton.disabled = true; addButton.title = 'Recording requires verified fee-claim receipts and a deployed buyback vault.'; }
  if (runButton) { runButton.disabled = true; runButton.title = 'Live Devnet buybacks execute automatically from verified fee accruals. This local preview control is disabled.'; }
  renderBuybackExample();
  const burnCard = document.querySelector('.burn-token-card');
  const burnBadge = burnCard?.querySelector('.burn-status');
  const burnStatus = document.querySelector('#funded-burn-status');
  const signingReady = fundedBurnState.status === 'ready' && Boolean(wallet && canSignTransactions(wallet)) && fundedBurnState.balanceBaseUnits > 0n;
  if (burnBadge) { burnBadge.textContent = fundedBurnState.status === 'loading' ? 'Loading' : signingReady ? 'Ready' : fundedBurnState.status === 'ready' ? 'View only' : 'Unavailable'; burnBadge.className = `burn-status ${signingReady ? 'available' : fundedBurnState.status === 'loading' ? 'loading' : 'unavailable'}`; }
  if (burnStatus) burnStatus.textContent = fundedBurnState.message;
  const tierCard = document.querySelector('.burn-tier-card');
  if (tierCard) {
    const progress = tierCard.querySelector('.burn-tier-head span');
    if (progress) progress.textContent = `${formatBuybackAmount(indexedWalletBurned, 6)} indexed`;
    const rows = tierCard.querySelectorAll('.burn-tier-row');
    [[100_000, 'Gold'], [500_000, 'Diamond']].forEach(([target], index) => {
      const row = rows[index]; if (!row) return;
      const width = Math.min(100, indexedWalletBurned / target * 100);
      row.querySelector('b').textContent = `${formatBuybackAmount(indexedWalletBurned, 2)} / ${target >= 1_000 ? `${target / 1_000}K` : target}`;
      row.querySelector('em').style.width = `${width}%`;
      row.querySelector('small').textContent = indexedWalletBurned >= target ? 'Unlocked by indexed receipts' : `${formatBuybackAmount(target - indexedWalletBurned, 2)} $FUNDED to go`;
    });
  }
  updateFundedBurnButton();
  const status = document.querySelector('#buyback-preview-status');
  if (message) status.textContent = message;
  else if (pendingSol >= 0.25) status.textContent = `${formatBuybackAmount(pendingSol)} SOL is ready for a protected batch preview.`;
  else if (pendingSol > 0) status.textContent = `${formatBuybackAmount(pendingSol)} SOL is safely accumulating toward the 0.25 SOL threshold.`;
  else status.textContent = feeReceipts.length > 0
    ? `${feeReceipts.length} verified fee-funded Devnet buyback${feeReceipts.length === 1 ? '' : 's'} completed. New batches run automatically from collected fees; this example cannot create a claim.`
    : 'Local calculation only. Live Devnet buybacks run automatically from verified fee collections; this example cannot create a claim.';
}
async function submitFundedBurn(){
  if (!wallet) { await connectWallet(); if (!wallet) return; }
  const session = captureWalletSession();
  if (!session || !canSignTransactions(session.provider)) { fundedBurnState.message = 'Open this page in a signing wallet to burn $FUNDED.'; renderBuybackDashboard(); return; }
  const input = document.querySelector('#funded-burn-amount');
  const projectMint = document.querySelector('#funded-burn-project')?.value || null;
  let amount;
  try {
    amount = parseTokenAmount(input.value, fundedBurnState.decimals);
    if (amount > fundedBurnState.balanceBaseUnits) throw new Error('The burn amount exceeds this wallet’s $FUNDED balance.');
  } catch (error) { fundedBurnState.message = error.message; renderBuybackDashboard(); return; }
  const source = fundedBurnState.tokenAccounts.find(account => account.amount >= amount);
  if (!source) { fundedBurnState.message = 'No single $FUNDED token account contains the requested burn amount.'; renderBuybackDashboard(); return; }
  const button = document.querySelector('#funded-burn-submit');
  const previousBalance = source.amount;
  const previousSupply = fundedBurnState.supplyBaseUnits;
  fundedBurnState.status = 'submitting';
  fundedBurnState.message = 'Review and approve the irreversible BurnChecked transaction in your wallet.';
  button.textContent = 'Awaiting approval…';
  renderBuybackDashboard();
  try {
    const { PublicKey, Transaction, createBurnCheckedInstruction, getAccount, getMint } = await getSolana();
    assertWalletSessionCurrent(session);
    const mint = new PublicKey(PROTOCOL_FUNDED_MINT);
    const latest = await connection.getLatestBlockhash('confirmed');
    const transaction = new Transaction({ feePayer: session.provider.publicKey, recentBlockhash: latest.blockhash }).add(
      createBurnCheckedInstruction(source.address, mint, session.provider.publicKey, amount, fundedBurnState.decimals, [], fundedBurnState.tokenProgram),
    );
    const signed = await session.provider.signTransaction(transaction);
    assertWalletSessionCurrent(session);
    const signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 3 });
    fundedBurnState.message = `Burn submitted (${signature.slice(0, 8)}…). Waiting for Devnet confirmation.`;
    renderBuybackDashboard();
    const confirmation = await waitForSignatureConfirmation(connection, { signature, lastValidBlockHeight: latest.lastValidBlockHeight });
    if (confirmation.value.err) throw new Error(`Burn transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    const [accountAfter, mintAfter] = await Promise.all([
      getAccount(connection, source.address, 'confirmed', fundedBurnState.tokenProgram),
      getMint(connection, mint, 'confirmed', fundedBurnState.tokenProgram),
    ]);
    if (previousBalance - accountAfter.amount !== amount || previousSupply - mintAfter.supply !== amount) throw new Error(`Burn confirmed as ${signature}, but the expected balance and supply deltas were not observed.`);
    const indexed = await apiRequest('/api/burn-receipts', { method: 'POST', body: { signature, wallet: session.address, amountBaseUnits: amount.toString(), projectMint } });
    fundedBurnState.message = indexed.available ? `Burn confirmed and indexed: ${signature}` : `Burn confirmed on Devnet, but receipt indexing is unavailable: ${signature}`;
    input.value = '';
    showToast('BurnChecked confirmed on Devnet');
    fundedBurnState.status = 'idle';
    await loadFundedBurnState({ force: true });
  } catch (error) {
    fundedBurnState.status = 'ready';
    fundedBurnState.message = `Burn stopped or confirmation unavailable: ${error.message}`;
    renderBuybackDashboard();
  } finally { button.textContent = 'Burn $FUNDED'; updateFundedBurnButton(); }
}
function recordBuybackPreviewClaim(){
  const fees = Number(document.querySelector('#buyback-example-fees').value);
  if (!Number.isFinite(fees) || fees <= 0) { renderBuybackDashboard('Enter a gross creator-fee amount above zero.'); return; }
  const state = getBuybackPreviewState();
  const signature = `preview-claim-${Date.now()}-${state.accruals.length + 1}`;
  state.accruals.push(buildBuybackAccrual({ claimSignature: signature, grossCreatorFees: fees, asset: 'SOL' }));
  saveBuybackPreviewState(state);
  renderBuybackDashboard(`${formatBuybackAmount(fees)} SOL claim recorded. Exactly ${formatBuybackAmount(fees * 0.01)} SOL was reserved for buyback.`);
  showToast('Example fee claim allocated to the buyback vault');
}
function runBuybackPreview(){
  const state = getBuybackPreviewState();
  const summary = summarizeBuybackLedger(state.accruals, state.receipts);
  const pending = summary.pendingByAsset.SOL || 0;
  const executedIds = new Set(state.receipts.flatMap(receipt => receipt.accrualIds || []));
  const pendingAccruals = state.accruals.filter(accrual => !executedIds.has(accrual.id));
  const lastReference = state.receipts.at(-1)?.executedAt || pendingAccruals[0]?.claimedAt || null;
  const decision = evaluateBuybackBatch({ pendingAmount: pending, asset: 'SOL', lastExecutionAt: lastReference, quote: { routeVerified: true, ageSeconds: 2, slippageBps: 50, priceImpactBps: 40, poolLiquidityAmount: Math.max(1000, pending * 400) } });
  if (!decision.executable) { renderBuybackDashboard(decision.reason === 'accumulating' ? 'The batch is still below 0.25 SOL and the six-hour maximum wait has not elapsed.' : `Execution blocked by safeguard: ${decision.reason}.`); return; }
  const tokensBought = Number((decision.executionAmount * 250).toFixed(6));
  const supplyBefore = 1_000_000_000 - summary.burnedTokens;
  const stamp = Date.now();
  state.receipts.push(buildBuybackReceipt({ accrualIds: pendingAccruals.map(accrual => accrual.id), asset: 'SOL', inputAmount: decision.executionAmount, tokensBought, buySignature: `preview-buy-${stamp}`, burnSignature: `preview-burn-${stamp}`, supplyBefore, supplyAfter: supplyBefore - tokensBought, mode: 'local-preview' }));
  saveBuybackPreviewState(state);
  renderBuybackDashboard(`Protected preview bought and burned ${formatBuybackAmount(tokensBought, 2)} $FUNDED. No transaction was submitted.`);
  showToast('Protected buyback and BurnChecked preview completed');
}

let assets = [];
let coinSolUsdPrice = null;
let exploreQuery = '';
let exploreSort = 'volume';
let exploreRisk = 'all';
let exploreStage = 'all';
let exploreAuthority = 'all';
let explorePromotion = 'all';
let exploreReward = 'all';
let exploreWindow = '24h';
let exploreTab = 'trending';
let exploreNewLane = 'launch';
let exploreView = 'grid';
let exploreMaxAgeHours = null;
let exploreMinVolumeSol = null;
let exploreMinCurveCapSol = null;
let exploreMinTrades = null;
let exploreMinTraders = null;
let exploreAutoRefresh = true;
let exploreBackoffUntil = 0;
let exploreFeedSort = null;
let exploreUpdatedAt = null;
let exploreLastVerifiedAt = null;
let exploreFeedAvailable = false;
let exploreProviderStatus = 'On-chain only · loading';
const exploreActivityCache = new Map();
let exploreScannedCount = 0;
const payments = [];

function getWatchlist(){ try { return JSON.parse(localStorage.getItem(WATCHLIST_KEY) || '[]'); } catch { return []; } }
function saveWatchlist(list){ localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list)); }
function setWatchButtonState(button, active){
  if (!button) return;
  button.classList.toggle('active', active);
  button.textContent = active ? '★' : '☆';
  button.setAttribute('aria-pressed', String(active));
  button.setAttribute('aria-label', active ? 'Remove token from watchlist' : 'Save token to watchlist');
}
function renderWatchlist(){
  const saved = getWatchlist();
  const count = document.querySelector('#watch-count');
  const empty = document.querySelector('#watchlist-empty');
  const items = document.querySelector('#watchlist-items');
  if (count) count.textContent = `${saved.length} saved`;
  if (empty) empty.hidden = saved.length > 0;
  if (items) items.innerHTML = saved.map(mint => {
    const asset = assets.find(item => item.address === mint);
    return asset ? portfolioTokenCardMarkup({ mint: asset.address, name: asset.name, symbol: asset.symbol, source: 'Saved from Explore · RPC verified', verified: true, removable: true }) : '';
  }).join('');
  items?.querySelectorAll('.watchlist-token-card').forEach(card => loadPortfolioLogo(card, verifiedLaunchPolicyForMint(card.dataset.mint)));
  document.querySelectorAll('.watch-button').forEach(button => setWatchButtonState(button, saved.includes(button.dataset.mint)));
}
function formatFeedAge(timestamp){
  const ms = Date.parse(String(timestamp || ''));
  return Number.isFinite(ms) ? formatOnchainAge(ms) : 'freshness unavailable';
}
function exploreFilterOptions(query = exploreQuery, sort = exploreSort){
  const laneStage = exploreNewLane === 'almost' ? 'near' : exploreNewLane === 'migrated' ? 'migrated' : 'launch';
  const maxAgeHours = exploreTab === 'new' && exploreNewLane === 'launch' ? Math.min(24, exploreMaxAgeHours ?? 24) : exploreMaxAgeHours;
  return { query, sort, risk: exploreRisk, stage: exploreTab === 'new' ? laneStage : exploreStage, authority: exploreAuthority,
    promotion: explorePromotion, reward: exploreReward, watchlist: getWatchlist(), maxAgeHours,
    minVolumeSol: EXPLORE_CLUSTER === 'devnet' ? exploreMinVolumeSol : null,
    minCurveCapSol: EXPLORE_CLUSTER === 'devnet' ? exploreMinCurveCapSol : null,
    minTrades: EXPLORE_CLUSTER === 'devnet' ? exploreMinTrades : null,
    minTraders: EXPLORE_CLUSTER === 'devnet' ? exploreMinTraders : null };
}
function formatExploreTradeCount(value, coverage){
  return value == null || !Number.isInteger(Number(value)) ? '—' : `${coverage === 'partial' ? '≥' : ''}${Number(value).toLocaleString()}`;
}
function exploreStageLabel(record){
  return record.migrated === true ? 'Migrated · PumpSwap' : record.complete === true ? 'Curve complete · pool unverified' : record.complete === false ? 'Pump curve' : 'Stage unverified';
}
function exploreDevnetVolumeLabel(record){ return record.migrated === true ? 'Pool activity' : '24h traded'; }
function exploreDevnetVolume(record){ return record.migrated === true ? 'Unindexed' : formatExploreUsd(record.volume24hSol, { partial: record.volumeCoverage === 'partial' }); }
function exploreDevnetReserveLabel(record){ return record.migrated === true ? 'Pool reserve' : 'Curve reserve'; }
function exploreDevnetReserve(record){ return formatCoinUsd(record.migrated === true ? record.poolReserveSol : record.curveReserveSol); }
function exploreMarketCapLabel(record){ return EXPLORE_CLUSTER === 'devnet' ? record.migrated === true ? 'Pool MC' : 'Curve MC' : 'Market cap'; }
function exploreMarketCapUsd(record){
  const cap = EXPLORE_CLUSTER === 'devnet' ? record.migrated === true ? record.poolMarketCapSol : record.curveCapSol : record.marketCapUsd;
  if (cap == null || cap === '' || (EXPLORE_CLUSTER === 'devnet' && !Number.isFinite(coinSolUsdPrice))) return '$—';
  const usd = EXPLORE_CLUSTER === 'devnet' ? Number(cap) * coinSolUsdPrice : Number(cap);
  return Number.isFinite(usd) && usd >= 0 ? formatDashboardUsd(usd) : '$—';
}
function renderExplorePulse(records){
  const ready = Boolean(exploreLastVerifiedAt);
  const scope = document.querySelector('#explore-pulse-scope');
  if (scope) scope.textContent = exploreProviderStatus.includes('stale') ? 'Counts reflect the last verified feed; live verification is paused.' : 'Counts reflect only mints confirmed in this feed.';
  const lanes = {
    launch: filterMarketRecords(records, { stage: 'launch', maxAgeHours: 24, sort: 'newest' }),
    almost: filterMarketRecords(records, { stage: 'near', sort: 'newest' }),
    migrated: filterMarketRecords(records, { stage: 'migrated', sort: 'newest' }),
  };
  for (const button of document.querySelectorAll('[data-explore-lane]')) {
    const lane = button.dataset.exploreLane;
    const items = lanes[lane] || [];
    button.querySelector('strong').textContent = ready ? String(items.length).padStart(2, '0') : '—';
    button.querySelector('small').textContent = !ready ? 'Waiting for verified feed' : items.length ? items.slice(0, 3).map(item => item.symbol).join(' · ') : lane === 'migrated' ? 'No RPC-verified migrated pool' : 'No verified launches in this stage';
    const active = exploreTab === 'new' && lane === exploreNewLane;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}
function exploreEmptyReason(){
  if (exploreQuery) return ['No verified launch matches this search.', 'Try a symbol, name, or full mint address from the current feed.'];
  if (explorePromotion !== 'all') return ['No launch matches this promotion filter.', 'Only paid tiers with a verified atomic $FUNDED burn receipt count as promoted.'];
  if (exploreReward !== 'all') return ['No launch has this verified reward allocation.', 'Choose another route or clear filters. Zero-percent routes are not counted as rewards.'];
  if (exploreMinTraders != null) return ['No launch meets the trading-wallet minimum.', 'Lower the selected-window minimum or clear filters.'];
  if (exploreMinTrades != null || exploreMinVolumeSol != null) return ['No launch meets these trade-activity minimums.', 'Lower the selected-window minimums or clear filters.'];
  if (exploreMinCurveCapSol != null || exploreMaxAgeHours != null) return ['No launch meets these advanced filters.', 'Broaden the curve-cap or age limit, or clear filters.'];
  if (exploreAuthority !== 'all') return ['No verified mint matches this authority filter.', 'Choose Any authority or clear filters to see all verified launches.'];
  if (exploreRisk === 'watchlist') return ['No watched launches in this feed.', 'Use the star on a verified token to save it here.'];
  if (exploreTab === 'new' && exploreNewLane === 'almost') return ['No launch is Almost Born yet.', 'This view requires an active Pump curve at least 80% filled.'];
  if (exploreTab === 'new' && exploreNewLane === 'migrated') return ['No RPC-verified migrated pools in this feed.', 'A completed curve alone is not migration proof. A PumpSwap pool must also exist on this network.'];
  if (exploreTab === 'new') return ['No verified New Launch in the last 24 hours.', 'Older confirmed launches remain available under All tokens.'];
  if (exploreStage === 'near') return ['No launch is in the final stretch.', 'This lane requires a verified active Pump curve at least 80% filled.'];
  if (exploreStage === 'graduated') return ['No graduated launch in this feed.', 'A token appears here only after its Pump curve is confirmed complete.'];
  return null;
}
function renderExploreControls(){
  const page = document.querySelector('#explore');
  const displayUnit = Number.isFinite(coinSolUsdPrice) ? 'USD' : 'SOL';
  if (page) { page.dataset.exploreView = exploreView; page.dataset.cluster = EXPLORE_CLUSTER; page.dataset.exploreTab = exploreTab; }
  document.querySelectorAll('.explore-tabs [data-explore-tab]').forEach(button => { const active = button.dataset.exploreTab === exploreTab; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  document.querySelectorAll('[data-explore-window]').forEach(button => {
    const active = button.dataset.exploreWindow === exploreWindow;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('[data-explore-sort]').forEach(button => {
    const active = button.dataset.exploreSort === exploreSort;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const volumeSortButton = document.querySelector('[data-explore-sort="volume"]');
  if (volumeSortButton) volumeSortButton.textContent = `${exploreWindow} volume`;
  const hasExploreFilters = exploreRisk !== 'all' || exploreStage !== 'all' || exploreAuthority !== 'all'
    || explorePromotion !== 'all' || exploreReward !== 'all'
    || exploreMaxAgeHours != null || exploreMinVolumeSol != null || exploreMinCurveCapSol != null
    || exploreMinTrades != null || exploreMinTraders != null;
  document.querySelector('#explore-filter-toggle')?.classList.toggle('has-filters', hasExploreFilters);
  for (const [selector, label] of [
    ['#explore-sort option[value="market-cap"]', `Curve cap (${displayUnit})`],
    ['#explore-sort option[value="volume"]', `${exploreWindow} traded (${displayUnit})`],
    ['#explore-sort option[value="trades"]', `${exploreWindow} trades`],
    ['#explore-sort option[value="liquidity"]', `Curve reserve (${displayUnit})`],
    ['#explore-min-volume-label', `Minimum ${exploreWindow} traded · SOL`],
    ['#explore-min-trades-label', `Minimum ${exploreWindow} trades`],
    ['#explore-min-traders-label', `Minimum ${exploreWindow} trading wallets`],
    ['.scanner-head span:nth-child(3)', `Curve cap · ${displayUnit}`],
    ['#scanner-volume-heading', `${exploreWindow} traded · ${displayUnit}`],
    ['.scanner-head span:nth-child(5)', `Curve reserve · ${displayUnit}`],
    ['#scanner-trades-heading', `${exploreWindow} trades`],
    ['.registry-order button[data-registry-sort="change"]', `${exploreWindow} trades`],
  ]) { const node = document.querySelector(selector); if (node) node.textContent = label; }
  document.querySelectorAll('[data-explore-view]').forEach(button => {
    const active = button.dataset.exploreView === exploreView;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const checked = document.querySelector('#explore-last-updated');
  if (checked) checked.textContent = exploreUpdatedAt ? `Checked ${new Date(exploreUpdatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Waiting for first check';
}
function formatVerifiedPercent(value){
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${number.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
}
function renderExploreBenefitLeaders(records){
  const container = document.querySelector('#explore-benefit-leaders');
  if (!container) return;
  const definitions = [
    { sort: 'volume', label: `Top ${exploreWindow} volume`, field: 'windowVolumeSol', policy: false },
    { sort: 'airdrop', label: 'Top token airdrop', field: 'communityAirdropPercent', policy: true, suffix: 'of supply' },
    { sort: 'holder-fee', label: 'Top fee to holders', field: 'holderFeePercent', policy: true, suffix: 'of creator fees' },
    { sort: 'x-fee', label: 'Top fee to X account', field: 'xFeePercent', policy: true, suffix: 'of creator fees' },
  ];
  container.innerHTML = definitions.map(definition => {
    const candidates = records.filter(record => definition.policy
      ? record.benefitPolicyVerified && record[definition.field] > 0
      : record[definition.field] != null && Number.isFinite(Number(record[definition.field])));
    const leader = candidates.length ? sortMarketRecords(candidates, definition.sort)[0] : null;
    const hasVerifiedField = records.some(record => definition.policy
      ? record.benefitPolicyVerified && record[definition.field] != null
      : record[definition.field] != null);
    const value = leader
      ? definition.policy ? formatVerifiedPercent(leader[definition.field]) : formatExploreUsd(leader[definition.field], { partial: leader.windowCoverage === 'partial' })
      : hasVerifiedField && definition.policy ? '0%' : 'Unavailable';
    const detail = leader
      ? `${leader.symbol || shortAddress(leader.address)}${definition.suffix ? ` · ${definition.suffix}` : leader.windowCoverage === 'partial' ? ' · partial history' : ' · scanned'}`
      : hasVerifiedField && definition.policy ? 'No verified positive share' : definition.policy ? 'No verified launch policy' : 'No scanned value';
    return `<button type="button" class="${definition.sort === exploreSort ? 'active' : ''}" data-explore-leader-sort="${definition.sort}" data-state="${leader ? 'ready' : hasVerifiedField ? 'empty' : 'unavailable'}" aria-pressed="${definition.sort === exploreSort}" ${leader ? '' : 'disabled'}><span>${escapeHtml(definition.label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></button>`;
  }).join('');
}
function exploreAssetCardMarkup(a){ return `<article class="token-card-shell asset-card signal-${escapeHtml(a.riskLevel)}" data-search="${escapeHtml(a.symbol)} ${escapeHtml(a.name)} ${escapeHtml(a.address || '')}" data-mint="${escapeHtml(a.address || '')}"><div class="asset-top"><span class="asset-symbol"><i class="asset-icon">${escapeHtml(a.icon)}</i>${escapeHtml(a.symbol)}</span><button type="button" class="watch-button" data-mint="${escapeHtml(a.address || '')}" aria-label="Save ${escapeHtml(a.symbol)} to watchlist" aria-pressed="false">☆</button></div><div class="asset-status"><span class="asset-meta">${exploreStageLabel(a)} · ${a.createdTimestamp ? escapeHtml(formatOnchainAge(Number(a.createdTimestamp) * 1000)) : 'age unavailable'}</span><span class="asset-status-badge">On-chain record</span></div><p class="asset-name">${escapeHtml(a.name)}</p><div class="asset-signal-row"><span>${EXPLORE_CLUSTER === 'devnet' ? exploreDevnetVolumeLabel(a) : '24h volume'} <b>${EXPLORE_CLUSTER === 'devnet' ? exploreDevnetVolume(a) : formatSignal(a.volume24hUsd, ' USD')}</b></span><span>${EXPLORE_CLUSTER === 'devnet' ? exploreDevnetReserveLabel(a) : 'Liquidity'} <b>${EXPLORE_CLUSTER === 'devnet' ? exploreDevnetReserve(a) : formatSignal(a.liquidityUsd, ' USD')}</b></span></div><div class="asset-bottom"><span class="asset-value" title="Estimated market capitalization from the confirmed ${a.migrated === true ? 'PumpSwap pool' : 'Pump curve'} snapshot">${escapeHtml(exploreMarketCapLabel(a))} · ${escapeHtml(exploreMarketCapUsd(a))}</span><span class="asset-change">${escapeHtml(a.migrated === true ? 'Pool change unindexed' : a.change)}</span></div><div class="asset-risk"><span>${escapeHtml(a.source || 'Solana RPC')} · ${escapeHtml(formatFeedAge(a.fetchedAt))}</span><button type="button" class="share-asset" data-share-symbol="${escapeHtml(a.symbol)}" data-share-mint="${escapeHtml(a.address || '')}">Share</button></div><div class="asset-actions"><a href="/token/${encodeURIComponent(a.address || '')}">Open token ↗</a><button type="button" data-trade-mint="${escapeHtml(a.address || '')}">Trade</button></div></article>`; }
function decorateExploreAssetCard(card, asset, launch = verifiedLaunchPolicyForMint(asset.address)){
  loadPortfolioLogo(card, launch);
    const promotion = promotionElement(asset.address, true);
    if (promotion) card.querySelector('.asset-status')?.append(promotion);
    if (exploreProviderStatus.includes('stale')) card.querySelector('.asset-status-badge').textContent = 'Last verified · stale';
    const proof = document.createElement('a');
    proof.className = 'asset-proof-link';
    proof.href = exploreExplorer(`address/${encodeURIComponent(asset.address)}`);
    proof.target = '_blank';
    proof.rel = 'noopener noreferrer';
    proof.textContent = 'Mint proof ↗';
    card.querySelector('.asset-actions')?.prepend(proof);
    if (EXPLORE_CLUSTER === 'devnet') {
      const activity = card.querySelector('.asset-signal-row span:first-child');
      if (activity) activity.innerHTML = `${exploreWindow} traded <b>${escapeHtml(formatExploreUsd(asset.windowVolumeSol, { partial: asset.windowCoverage === 'partial' }))}</b>`;
    }
    if (typeof asset.mintAuthorityRevoked === 'boolean' && typeof asset.freezeAuthorityRevoked === 'boolean') {
      const authorities = document.createElement('div');
      authorities.className = 'asset-authorities';
      authorities.innerHTML = `<span class="${asset.mintAuthorityRevoked ? 'revoked' : 'active'}" title="Mint authority ${asset.mintAuthorityRevoked ? 'revoked' : 'active'} on the verified mint account">Mint ${asset.mintAuthorityRevoked ? 'revoked' : 'active'}</span><span class="${asset.freezeAuthorityRevoked ? 'revoked' : 'active'}" title="Freeze authority ${asset.freezeAuthorityRevoked ? 'revoked' : 'active'} on the verified mint account">Freeze ${asset.freezeAuthorityRevoked ? 'revoked' : 'active'}</span>`;
      card.querySelector('.asset-bottom')?.before(authorities);
    }
    if (asset.benefitPolicyVerified) {
      const benefits = document.createElement('div');
      benefits.className = 'asset-benefit-policy';
      benefits.setAttribute('aria-label', 'Token allocation and creator-fee policy');
      const promotionLabel = asset.promotionTier === 'standard' ? '' : `${asset.promotionTier} promotion`;
      benefits.innerHTML = `${promotionLabel ? `<span class="promotion">${escapeHtml(promotionLabel)}</span>` : ''}<span class="${asset.communityAirdropPercent > 0 ? 'positive' : 'zero'}">Airdrop ${escapeHtml(formatVerifiedPercent(asset.communityAirdropPercent))}</span><span class="${asset.holderFeePercent > 0 ? 'positive' : 'zero'}">Holders ${escapeHtml(formatVerifiedPercent(asset.holderFeePercent))}</span><span class="${asset.xFeePercent > 0 ? 'positive' : 'zero'}">X ${escapeHtml(formatVerifiedPercent(asset.xFeePercent))}</span><span class="${asset.creatorFeePercent > 0 ? 'positive' : 'zero'}">Creator ${escapeHtml(formatVerifiedPercent(asset.creatorFeePercent))}</span>`;
      const disclosure = document.createElement('details');
      disclosure.className = 'asset-policy-details';
      const summary = document.createElement('summary');
      summary.textContent = `Rewards · ${formatVerifiedPercent(asset.holderFeePercent)} of creator fees to holders`;
      const basis = document.createElement('p');
      basis.textContent = 'Airdrop: % of token supply. Holder, X and creator shares: % of gross collected creator fees. Allocations are not payments.';
      disclosure.append(summary, benefits, basis);
      card.querySelector('.asset-bottom')?.after(disclosure);
    }
    if (EXPLORE_CLUSTER === 'devnet') {
      const flow = document.createElement('div');
      flow.className = 'asset-trade-flow';
      const count = formatExploreTradeCount(asset.windowTradeCount, asset.windowCoverage);
      const buys = formatExploreTradeCount(asset.windowBuyCount, asset.windowCoverage);
      const sells = formatExploreTradeCount(asset.windowSellCount, asset.windowCoverage);
      flow.innerHTML = `<span>${exploreWindow} trades <b>${count}</b></span>${asset.windowBuyCount != null && asset.windowSellCount != null ? `<span class="asset-flow-buy">${buys} ${asset.windowBuyCount === 1 ? 'buy' : 'buys'}</span><span class="asset-flow-sell">${sells} ${asset.windowSellCount === 1 ? 'sell' : 'sells'}</span>` : '<span>Split unavailable</span>'}${asset.windowTraderCount != null ? `<span title="Distinct wallets in confirmed Pump trade events">${formatExploreTradeCount(asset.windowTraderCount, asset.windowCoverage)} ${asset.windowTraderCount === 1 ? 'trader' : 'traders'}</span>` : ''}`;
      card.querySelector('.asset-bottom')?.before(flow);
      if (asset.windowBuyCount != null && asset.windowSellCount != null && asset.windowTradeCount > 0) {
        const buyPercent = Math.max(0, Math.min(100, asset.windowBuyCount / asset.windowTradeCount * 100));
        const pressure = document.createElement('div');
        pressure.className = 'asset-buy-pressure';
        pressure.setAttribute('aria-label', `${exploreWindow} buy share ${buyPercent.toFixed(0)} percent of scanned trades`);
        pressure.innerHTML = `<span>Buy share <b>${buyPercent.toFixed(0)}%</b></span><i><em></em></i>`;
        pressure.querySelector('em').style.width = `${buyPercent}%`;
        card.querySelector('.asset-bottom')?.before(pressure);
      }
    }
    if (asset.complete !== false || asset.curveProgressPercent == null || !Number.isFinite(Number(asset.curveProgressPercent))) return;
    const percent = Math.max(0, Math.min(100, Number(asset.curveProgressPercent)));
    const progress = document.createElement('div');
    progress.className = 'asset-curve-progress';
    progress.innerHTML = `<span>Curve filled <b>${percent.toFixed(0)}%</b></span><i><em></em></i>`;
    progress.querySelector('em').style.width = `${percent}%`;
    card.querySelector('.asset-bottom')?.before(progress);
}
function renderExploreAssets({ force = false } = {}){
  const grid = document.querySelector('#asset-grid');
  // Preserve the focused action through background market refreshes.
  if (!force && grid?.contains(document.activeElement)) {
    grid.dataset.refreshPending = 'true';
    return;
  }
  if (grid) delete grid.dataset.refreshPending;
  const count = document.querySelector('#explore-launch-count');
  const status = document.querySelector('#explore-data-status');
  const ticker = document.querySelector('#explore-ticker');
  const clusterLabel = document.querySelector('#explore-cluster-label');
  const loading = exploreProviderStatus === 'On-chain only · loading' && !exploreLastVerifiedAt;
  if (clusterLabel) clusterLabel.textContent = `Solana ${EXPLORE_CLUSTER === 'mainnet-beta' ? 'mainnet' : EXPLORE_CLUSTER} · ${exploreProviderStatus.includes('stale') ? 'last verified snapshot' : exploreProviderStatus.includes('RPC verified') ? 'RPC verified' : exploreProviderStatus.includes('unavailable') ? 'data unavailable' : 'awaiting verification'}`;
  const records = assets.map(item => withVerifiedExploreBenefits(EXPLORE_CLUSTER === 'devnet' ? withMarketWindow(item, exploreWindow) : enrichMarketRecord(item)));
  const visible = filterMarketRecords(records, exploreFilterOptions());
  renderExploreControls();
  renderExplorePulse(records);
  renderExploreBenefitLeaders(visible);
  const summary = summarizeMarkets(records);
  if (count) count.textContent = String(visible.length).padStart(2, '0');
  if (status) status.textContent = exploreProviderStatus === 'On-chain only · loading' ? exploreProviderStatus : `${exploreProviderStatus}${assets.length ? ` · ${visible.length} shown` : ''}`;
  const kpis = document.querySelector('#explore-market-kpis');
  if (kpis) kpis.innerHTML = EXPLORE_CLUSTER === 'devnet'
    ? `<span><small>${exploreWindow} curve traded · scanned</small><strong>${formatExploreUsd(records.some(item => item.windowVolumeSol != null) ? records.reduce((sum, item) => sum + (item.windowVolumeSol || 0), 0) : null, { partial: exploreScannedCount < records.length || records.some(item => item.windowCoverage === 'partial') })}</strong></span><span><small>On-chain reserves</small><strong>${formatExploreUsd(records.some(item => (item.migrated === true ? item.poolReserveSol : item.curveReserveSol) != null) ? records.reduce((sum, item) => sum + (item.migrated === true ? item.poolReserveSol : item.curveReserveSol || 0), 0) : null)}</strong></span><span><small>Curve histories scanned</small><strong>${exploreScannedCount} / ${records.length}</strong></span>`
    : `<span><small>24h volume</small><strong>${formatSignal(summary.volume24hUsd, ' USD')}</strong></span><span><small>Liquidity indexed</small><strong>${formatSignal(summary.liquidityUsd, ' USD')}</strong></span><span><small>High-risk signals</small><strong>${summary.highRisk}</strong></span>`;
  if (ticker) {
    if (visible.length) {
      const tickerItems = visible.slice(0, 8).map(asset => `<a class="explore-ticker-token" data-logo-mint="${escapeHtml(asset.address || '')}" href="/token/${encodeURIComponent(asset.address || '')}"><i>${escapeHtml(String(asset.symbol || 'T').slice(0, 1))}</i><span><strong>${escapeHtml(asset.symbol)}</strong><small>${escapeHtml(exploreStageLabel(asset))}</small></span><b>${escapeHtml(EXPLORE_CLUSTER === 'devnet' ? formatExploreUsd(asset.windowVolumeSol, { partial: asset.windowCoverage === 'partial' }) : asset.change)}</b></a>`).join('');
      ticker.innerHTML = `<span class="ticker-label"><i></i> Trending</span><div class="explore-ticker-window"><div class="explore-ticker-track"><div class="explore-ticker-set">${tickerItems}</div><div class="explore-ticker-set" aria-hidden="true">${tickerItems}</div></div></div>`;
      loadVerifiedTokenLogos(ticker);
    } else {
      ticker.innerHTML = `<span class="ticker-label"><i></i> Trending</span><span id="explore-ticker-status">${loading ? 'Loading verified launches…' : 'No verified launches match these filters'}</span>`;
    }
  }
  if (!grid) return;
  grid.innerHTML = visible.length ? visible.map(exploreAssetCardMarkup).join('') : loading
    ? '<div class="empty-state onchain-empty"><strong>Loading verified launches…</strong><span>Checking the indexed launch feed and confirming current Solana state.</span></div>'
    : `<div class="empty-state onchain-empty"><strong>${assets.length ? 'No verified launches match these filters.' : 'No verified on-chain launches yet.'}</strong><span>${assets.length ? 'Broaden the search or wait for a confirmed Solana indexer response.' : 'Explore will populate after a confirmed Solana RPC response.'}</span></div>`;
  if (!visible.length && /RPC (?:rate limited|unavailable)/.test(exploreProviderStatus)) grid.innerHTML = `<div class="empty-state onchain-empty"><strong>On-chain verification is temporarily unavailable.</strong><span>${escapeHtml(exploreProviderStatus)}. Retry with Refresh shortly; no unverified tokens are shown.</span></div>`;
  if (!visible.length && assets.length) {
    const reason = exploreEmptyReason();
    if (reason) { grid.querySelector('.empty-state strong').textContent = reason[0]; grid.querySelector('.empty-state span').textContent = reason[1]; }
  }
  for (const card of grid.querySelectorAll('.asset-card')) {
    const asset = visible.find(item => item.address === card.dataset.mint);
    if (asset) decorateExploreAssetCard(card, asset);
  }
  if (!visible.length && !loading) {
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'explore-empty-action';
    action.dataset.exploreEmptyAction = assets.length ? 'clear' : 'retry';
    action.textContent = assets.length ? exploreTab === 'new' ? 'View all tokens' : 'Clear filters' : 'Retry verification';
    grid.querySelector('.empty-state')?.append(action);
  }
  renderWatchlist();
  if (EXPLORE_CLUSTER === 'devnet') renderVerifiedTradeFlow();
  renderExploreTradeTape();
  renderWalletDetail();
}
document.querySelector('#asset-grid')?.addEventListener('focusout', () => {
  queueMicrotask(() => {
    const grid = document.querySelector('#asset-grid');
    if (grid?.dataset.refreshPending && !grid.contains(document.activeElement)) renderExploreAssets();
  });
});
function renderExploreTradeTape(){
  const panel = document.querySelector('.explore-trade-tape');
  const list = document.querySelector('#explore-trade-tape-list');
  const status = document.querySelector('#explore-trade-tape-status');
  if (!panel || !list || !status) return;
  panel.hidden = EXPLORE_CLUSTER !== 'devnet';
  if (panel.hidden) return;
  const observedSeconds = Number.isFinite(Date.parse(exploreLastVerifiedAt)) ? Date.parse(exploreLastVerifiedAt) / 1000 : Date.now() / 1000;
  const windowSeconds = { '1h': 3600, '6h': 21600, '24h': 86400 }[exploreWindow];
  const trades = collectRecentTrades(assets, { since: observedSeconds - windowSeconds });
  const partial = assets.some(item => item.volumeCoverage === 'partial');
  const note = document.querySelector('#explore-trade-tape-note');
  if (note) note.textContent = `Latest confirmed bonding-curve trades in the selected ${exploreWindow} window from scanned launches only. Open a transaction to inspect its on-chain proof.`;
  status.textContent = exploreProviderStatus.includes('stale') ? 'Last verified · stale' : `${exploreScannedCount} / ${assets.length} scanned${partial ? ' · partial history' : ''}`;
  list.innerHTML = trades.length ? trades.map(trade => `<div class="explore-tape-row" data-logo-mint="${escapeHtml(trade.mint)}"><span class="explore-tape-side ${trade.side}">${trade.side === 'buy' ? 'Buy' : 'Sell'}</span><i class="explore-tape-logo" aria-hidden="true">${escapeHtml(String(trade.symbol || 'T').slice(0, 1))}</i><span class="explore-tape-token"><a href="/token/${encodeURIComponent(trade.mint)}">${escapeHtml(trade.symbol || shortAddress(trade.mint))}</a><small>${escapeHtml(shortAddress(trade.mint))}</small></span><strong>${escapeHtml(formatCoinUsd(trade.solAmount))}</strong><time title="${escapeHtml(new Date(trade.blockTime * 1000).toLocaleString())}">${escapeHtml(formatOnchainAge(trade.blockTime * 1000))}</time><a class="explore-tape-proof" href="${escapeHtml(exploreExplorer(`tx/${encodeURIComponent(trade.signature)}`))}" target="_blank" rel="noopener noreferrer" aria-label="Inspect ${escapeHtml(trade.side)} transaction for ${escapeHtml(trade.symbol || 'token')} on Solana Explorer">Tx ↗</a></div>`).join('') : `<div class="empty-state">${assets.length ? `No confirmed Pump trades in the scanned ${exploreWindow} window.${exploreScannedCount < assets.length || partial ? ' History may be incomplete.' : ''}` : 'Waiting for RPC-verified Devnet launches and trade history.'}</div>`;
  loadVerifiedTokenLogos(list);
}
function renderVerifiedTradeFlow(){
  const list = document.querySelector('#terminal-signal-list');
  const status = document.querySelector('#terminal-signals-status');
  if (!list || !status) return;
  const scanned = assets.map(item => withMarketWindow(item, exploreWindow)).filter(item => item.windowTradeCount != null)
    .sort((a, b) => b.windowTradeCount - a.windowTradeCount).slice(0, 5);
  status.textContent = exploreProviderStatus.includes('stale') ? 'Last verified · stale' : `${exploreScannedCount} / ${assets.length} scanned`;
  list.innerHTML = scanned.length ? scanned.map(item => `<div class="terminal-signal-row" data-logo-mint="${escapeHtml(item.address)}"><i class="terminal-signal-logo" aria-hidden="true">${escapeHtml(String(item.symbol || "T").slice(0, 1))}</i><span><strong>${escapeHtml(item.symbol)}</strong><small>${exploreWindow} · ${item.windowBuyCount != null && item.windowSellCount != null ? `${formatExploreTradeCount(item.windowBuyCount, item.windowCoverage)} ${item.windowBuyCount === 1 ? 'buy' : 'buys'} · ${formatExploreTradeCount(item.windowSellCount, item.windowCoverage)} ${item.windowSellCount === 1 ? 'sell' : 'sells'}` : 'Buy/sell split unavailable'} · confirmed Pump events</small></span><b>${formatExploreTradeCount(item.windowTradeCount, item.windowCoverage)} ${item.windowTradeCount === 1 ? 'trade' : 'trades'}</b></div>`).join('') : '<div class="empty-state">No confirmed Pump trade events have been scanned for this feed.</div>';
  loadVerifiedTokenLogos(list);
}
function renderStonkEnhancements(){
  const quoteList = document.querySelector('#quote-asset-list');
  const quoteStatus = document.querySelector('#quote-assets-status');
  const signalList = document.querySelector('#terminal-signal-list');
  const signalStatus = document.querySelector('#terminal-signals-status');
  if (!quoteList && !signalList) return;
  const quoteLoad = apiRequest('/api/quote-assets').then(result => {
    const verified = result.data?.status === 'onchain-verified-catalog' && result.data?.cluster === EXPLORE_CLUSTER;
    const assets = verified && Array.isArray(result.data?.assets) ? result.data.assets : [];
    if (quoteStatus) quoteStatus.textContent = verified ? 'RPC verified' : 'Unavailable';
    if (quoteList) quoteList.innerHTML = assets.length ? assets.map(item => `<div class="quote-asset-row"><span class="asset-icon">${escapeHtml(item.symbol.slice(0, 1))}</span><span><strong>${escapeHtml(item.symbol)}</strong><small>${escapeHtml(item.name)} · ${escapeHtml(item.category)}</small></span><b>✓</b></div>`).join('') : '<div class="empty-state">No verified quote assets configured.</div>';
  }).catch(() => { if (quoteStatus) quoteStatus.textContent = 'Unavailable'; if (quoteList) quoteList.innerHTML = '<div class="empty-state">Quote catalog unavailable; no unverified assets shown.</div>'; });
  const signalLoad = EXPLORE_CLUSTER === 'devnet' ? (renderVerifiedTradeFlow(), Promise.resolve()) : apiRequest('/api/terminal/signals').then(result => {
    const verified = result.data?.status === 'ready' && result.data?.cluster === EXPLORE_CLUSTER;
    const items = verified && Array.isArray(result.data?.items) ? result.data.items.slice(0, 5) : [];
    if (signalStatus) signalStatus.textContent = verified ? 'Verified launch signals' : 'Waiting for indexer';
    if (signalList) signalList.innerHTML = items.length ? items.map(item => `<div class="terminal-signal-row"><span><strong>${escapeHtml(item.symbol || item.name || 'Launch')}</strong><small>${escapeHtml(item.riskLevel || 'watch')} · ${item.graduationProgress == null && item.volume24hUsd == null && item.holders == null ? 'score unavailable' : `score ${Number(item.signalScore || 0)}/100`}</small></span><b>${item.graduationProgress == null ? '—' : `${Number(item.graduationProgress).toFixed(0)}%`}</b></div>`).join('') : '<div class="empty-state">Signals appear after the server indexer records launches.</div>';
  }).catch(() => { if (signalStatus) signalStatus.textContent = 'Unavailable'; if (signalList) signalList.innerHTML = '<div class="empty-state">Terminal signals unavailable.</div>'; });
  return Promise.all([quoteLoad, signalLoad]);
}
function formatOnchainAge(timestamp){
  if (!timestamp) return 'confirmed on-chain';
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}
function formatUsd(value){
  const amount = Number(value);
  if (value == null || value === '' || !Number.isFinite(amount)) return '—';
  if (amount === 0) return '$0.00';
  if (amount > 0 && amount < 0.01) return '< $0.01';
  if (amount >= 1) return `$${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (amount >= 0.01) return `$${amount.toFixed(4)}`;
  const digits = Math.min(12, Math.max(4, Math.ceil(-Math.log10(amount)) + 4));
  return `$${amount.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '')}`;
}
function formatCompactUsd(value){
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return '—';
  return `$${Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 }).format(amount)}`;
}
function formatDashboardUsd(value, { partial = false } = {}){
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return '$—';
  if (amount > 0 && amount < 0.01) return `${partial ? '≥' : ''}<$0.01`;
  const formatted = amount >= 1_000_000
    ? Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 }).format(amount)
    : amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${partial ? '≥' : ''}$${formatted}`;
}
function formatSmallDashboardUsd(value, { partial = false } = {}){
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return '$—';
  if (amount === 0) return `${partial ? '≥' : ''}$0.00`;
  return `${partial ? '≥' : ''}${amount > 0 && amount < 0.01 ? formatUsd(amount) : formatDashboardUsd(amount)}`;
}
function formatDashboardQuantity(value){
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return '—';
  return amount >= 1_000_000
    ? Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 }).format(amount)
    : amount.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
function setHomeDashboardMetric(key, value, note, state = 'available'){
  const card = document.querySelector(`#home-kpi-${key}-card`);
  const valueNode = document.querySelector(`#home-kpi-${key}`);
  const noteNode = document.querySelector(`#home-kpi-${key}-note`);
  if (card) card.dataset.state = state;
  if (valueNode) valueNode.textContent = value;
  if (noteNode) noteNode.textContent = note;
}
function verifiedLaunchBurns(){
  return verifiedLaunchPolicies
    .map(launch => launch?.creatorLaunchBurn)
    .filter(burn => burn?.status === 'verified' && burn.receipt && Number(burn.receipt.amountTokens ?? burn.amountTokens) > 0);
}
function renderHomeKpiDashboard(verified = assets){
  // A direct token URL does not load the Explore index until the visitor
  // returns to a workspace route. Keep the HTML loading state in that case;
  // an empty pre-fetch array is not evidence that there are zero launches.
  if (!exploreUpdatedAt) return;
  const records = Array.isArray(verified) ? verified : [];
  const fundedLaunchRecords = records.filter(item => {
    const policy = verifiedLaunchPolicyForMint(item.address);
    return policy?.onchainVerified && (policy.creatorWallet || policy.feePayer);
  });
  const solQuoteReady = Number.isFinite(coinSolUsdPrice) && coinSolUsdPrice > 0;
  const launchFeedUnavailable = !exploreFeedAvailable && !exploreLastVerifiedAt;
  const launchCard = document.querySelector('#home-kpi-launches-card');
  const launchValue = document.querySelector('#home-pulse-launches');
  const launchNote = document.querySelector('#home-pulse-launches-note');
  if (launchCard) launchCard.dataset.state = launchFeedUnavailable ? 'unavailable' : fundedLaunchRecords.length ? 'available' : 'empty';
  if (launchValue) launchValue.textContent = launchFeedUnavailable ? '—' : fundedLaunchRecords.length.toLocaleString();
  if (launchNote) launchNote.textContent = launchFeedUnavailable ? 'Launch feed unavailable; count not verified' : fundedLaunchRecords.length ? `Funded policy and mint confirmed on Solana ${EXPLORE_CLUSTER}` : 'No funded launch policies confirmed';

  const evidenceReady = ['onchain-indexed', 'partial'].includes(receiptEvidence?.status);
  const collections = evidenceReady && Array.isArray(receiptEvidence?.verifiedCollections) ? receiptEvidence.verifiedCollections : [];
  const collectionSol = collections.reduce((sum, item) => sum + Number(item.collectedLamports || 0) / 1_000_000_000, 0);
  const feeAvailable = evidenceReady && solQuoteReady;
  const recordedCollections = Number(receiptEvidence?.coverage?.recordedCollections || 0);
  setHomeDashboardMetric('fees', feeAvailable ? formatDashboardUsd(collectionSol * coinSolUsdPrice) : '$—', feeAvailable
    ? `${collections.length} verified claim receipt${collections.length === 1 ? '' : 's'}`
    : recordedCollections ? `${recordedCollections} recorded claim${recordedCollections === 1 ? '' : 's'} awaiting receipt verification` : solQuoteReady ? 'No verified fee receipts indexed' : 'USD quote or verified receipts unavailable', feeAvailable ? (receiptEvidence.status === 'partial' ? 'partial' : 'available') : 'unavailable');

  const allocation = homeFeeAllocations;
  const allocationReady = ['verified', 'partial'].includes(allocation?.status);
  const partialAllocation = allocation?.status === 'partial';
  const appRevenueLamports = allocationReady ? Number(allocation.appRevenueLamports) : NaN;
  const appRevenueAvailable = allocationReady && solQuoteReady && Number.isSafeInteger(appRevenueLamports) && appRevenueLamports >= 0;
  setHomeDashboardMetric('app-revenue', appRevenueAvailable
    ? formatSmallDashboardUsd(appRevenueLamports / 1_000_000_000 * coinSolUsdPrice, { partial:partialAllocation }) : '$—',
    appRevenueAvailable
      ? `20% protocol share of collected fees · ${allocation.settledCollections} verified settlement${allocation.settledCollections === 1 ? '' : 's'}${partialAllocation ? ' · partial coverage' : ''} · includes earmarked rewards and reserves`
      : allocationReady ? 'Current SOL/USD quote unavailable' : 'Verified protocol fee allocations unavailable',
    appRevenueAvailable ? partialAllocation ? 'partial' : appRevenueLamports ? 'available' : 'empty' : 'unavailable');
  const allocationMetrics = [
    ['holders', 'holderLamports', 'Holder reward allocation; payment requires a verified receipt'],
    ['x', 'xLamports', 'X reward allocation; payment requires a verified receipt'],
    ['buyback', 'buybackLamports', 'Fee allocation for buyback; separate from confirmed burns'],
    ['community', 'communityLamports', 'Community fee reserve, including redirected referral shares'],
  ];
  for (const [key, field, description] of allocationMetrics) {
    const lamports = allocationReady ? Number(allocation[field]) : NaN;
    const available = allocationReady && solQuoteReady && Number.isSafeInteger(lamports) && lamports >= 0;
    setHomeDashboardMetric(key, available ? formatSmallDashboardUsd(lamports / 1_000_000_000 * coinSolUsdPrice, { partial:partialAllocation }) : '$—',
      available ? `${description} · ${allocation.settledCollections} verified settlement${allocation.settledCollections === 1 ? '' : 's'}${partialAllocation ? ' · partial coverage' : ''}`
        : allocationReady ? 'Current SOL/USD quote unavailable' : 'Verified fee allocation receipts unavailable',
      available ? partialAllocation ? 'partial' : lamports ? 'available' : 'empty' : 'unavailable');
  }

  const burnSummaryReady = allocationReady
    && allocation.burnedTokens != null
    && Number.isFinite(Number(allocation.burnedTokens));
  const burnedTokens = burnSummaryReady ? Number(allocation.burnedTokens) : NaN;
  const burnCount = burnSummaryReady ? Number(allocation.verifiedBurnCount || 0) : 0;
  const fundedAsset = records.find(item => item.address === PROTOCOL_FUNDED_MINT);
  const fundedUsdPrice = Number(fundedAsset?.priceUsd) > 0
    ? Number(fundedAsset.priceUsd)
    : Number(fundedAsset?.curvePriceSol) > 0 && solQuoteReady ? Number(fundedAsset.curvePriceSol) * coinSolUsdPrice : null;
  const burnUsdAvailable = burnSummaryReady && (burnedTokens === 0 || Number.isFinite(fundedUsdPrice));
  setHomeDashboardMetric('burn', burnSummaryReady ? formatDashboardQuantity(burnedTokens) : '—', !burnSummaryReady
    ? 'Burn receipts unavailable; amount not verified'
    : burnedTokens === 0 ? '$0.00 USD value · no verified burn receipts yet'
    : Number.isFinite(fundedUsdPrice) ? `${formatDashboardUsd(burnedTokens * fundedUsdPrice)} spot value · ${burnCount} verified receipt${burnCount === 1 ? '' : 's'}` : `${burnCount} verified receipt${burnCount === 1 ? '' : 's'} · USD quote unavailable`, !burnSummaryReady ? 'unavailable' : burnedTokens === 0 ? 'empty' : burnUsdAvailable ? 'available' : 'partial');
  setHomeDashboardMetric('burn-value', burnUsdAvailable ? formatDashboardUsd(burnedTokens * (fundedUsdPrice || 0)) : '$—',
    !burnSummaryReady ? 'Verified burn receipts unavailable'
      : burnedTokens === 0 ? 'No indexed confirmed $FUNDED burns'
      : Number.isFinite(fundedUsdPrice) ? `${burnCount} confirmed burn receipt${burnCount === 1 ? '' : 's'} · current $FUNDED quote` : 'Current $FUNDED/USD quote unavailable',
    burnUsdAvailable ? burnedTokens ? 'available' : 'empty' : 'unavailable');

  const reservePrograms = verifiedLaunchPolicies.filter(launch => launch?.onchainVerified && Number(launch?.communityAirdrop?.reservedTokens) > 0);
  let pricedPrograms = 0;
  const airdropUsd = reservePrograms.reduce((sum, launch) => {
    const asset = records.find(item => item.address === launch.mint);
    const tokenUsd = Number(asset?.priceUsd) > 0
      ? Number(asset.priceUsd)
      : Number(asset?.curvePriceSol) > 0 && solQuoteReady ? Number(asset.curvePriceSol) * coinSolUsdPrice : null;
    if (!Number.isFinite(tokenUsd)) return sum;
    pricedPrograms += 1;
    return sum + Number(launch.communityAirdrop.reservedTokens) * tokenUsd;
  }, 0);
  const airdropAvailable = reservePrograms.length > 0 && pricedPrograms > 0;
  const partialAirdrop = airdropAvailable && pricedPrograms < reservePrograms.length;
  setHomeDashboardMetric('airdrop', airdropAvailable ? formatDashboardUsd(airdropUsd, { partial: partialAirdrop }) : '$—', launchFeedUnavailable
    ? 'Launch policies unavailable; allocation not verified'
    : airdropAvailable
    ? `${pricedPrograms}/${reservePrograms.length} policy allocation${reservePrograms.length === 1 ? '' : 's'} valued at spot · vault funding unverified`
    : reservePrograms.length ? `${reservePrograms.length} policy allocation${reservePrograms.length === 1 ? '' : 's'} · USD pricing unavailable · vault funding unverified` : 'No published community allocations', partialAirdrop ? 'partial' : airdropAvailable ? 'available' : 'unavailable');

  const payoutEvidenceReady = Boolean(receiptEvidence) && Array.isArray(receiptEvidence?.verifiedPayouts);
  const referralPayouts = payoutEvidenceReady ? receiptEvidence.verifiedPayouts.filter(item => item.source === 'solana-keeper-referral-claim') : [];
  const referralSol = referralPayouts.reduce((sum, item) => sum + Number(item.amountLamports || 0) / 1_000_000_000, 0);
  const recordedPayouts = Number(receiptEvidence?.coverage?.recordedPayouts || 0);
  const referralAvailable = payoutEvidenceReady && solQuoteReady && (referralPayouts.length > 0 || recordedPayouts === 0);
  setHomeDashboardMetric('referrals', referralAvailable ? formatDashboardUsd(referralSol * coinSolUsdPrice) : '$—', referralAvailable
    ? referralPayouts.length ? `${referralPayouts.length} verified referral payout${referralPayouts.length === 1 ? '' : 's'}` : 'No verified referral payouts yet'
    : recordedPayouts ? 'Recorded payouts are awaiting receipt verification' : 'USD quote or payout evidence unavailable', referralPayouts.length ? 'available' : referralAvailable ? 'empty' : 'unavailable');

  const windowed = fundedLaunchRecords.map(item => withMarketWindow(item, '24h'));
  const volumeRecords = windowed.filter(item => item.windowVolumeSol != null);
  const totalVolumeSol = volumeRecords.reduce((sum, item) => sum + Number(item.windowVolumeSol || 0), 0);
  const partialVolume = volumeRecords.length < fundedLaunchRecords.length || volumeRecords.some(item => item.windowCoverage === 'partial');
  const volumeAvailable = volumeRecords.length > 0 && solQuoteReady;
  const volumeCard = document.querySelector('#home-kpi-volume-card');
  const volumeValue = document.querySelector('#home-pulse-volume');
  const volumeNote = document.querySelector('#home-pulse-volume-note');
  if (volumeCard) volumeCard.dataset.state = volumeAvailable ? (partialVolume ? 'partial' : 'available') : 'unavailable';
  if (volumeValue) volumeValue.textContent = volumeAvailable ? formatDashboardUsd(totalVolumeSol * coinSolUsdPrice, { partial: partialVolume }) : '$—';
  if (volumeNote) volumeNote.textContent = volumeAvailable ? `${volumeRecords.length}/${fundedLaunchRecords.length} funded launches scanned${partialVolume ? ' · partial coverage' : ''}` : 'USD quote or trade history unavailable';

  const status = document.querySelector('#home-dashboard-status');
  const updated = document.querySelector('#home-dashboard-updated');
  if (status) status.innerHTML = `<i></i> ${launchFeedUnavailable ? `Launch feed unavailable · ${EXPLORE_CLUSTER}` : fundedLaunchRecords.length ? `Verified funded launches · ${EXPLORE_CLUSTER}` : `Awaiting verified funded launches · ${EXPLORE_CLUSTER}`}`;
  if (updated) updated.textContent = exploreUpdatedAt ? `Checked ${new Date(exploreUpdatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Waiting for first check';
}
function renderHomeOnchainSnapshot(verified){
  verified = verified.filter(item => {
    const policy = verifiedLaunchPolicyForMint(item.address);
    return policy?.onchainVerified && (policy.creatorWallet || policy.feePayer);
  });
  const status = document.querySelector('#home-live-status');
  const count = document.querySelector('#home-verified-launches');
  const countNote = document.querySelector('#home-verified-launches-note');
  const policyUpdated = document.querySelector('#home-policy-updated');
  status.textContent = `Solana RPC · ${EXPLORE_CLUSTER} confirmed`;
  if (count) count.textContent = String(verified.length);
  if (countNote) countNote.textContent = verified.length ? `Confirmed on ${EXPLORE_CLUSTER}` : 'No confirmed launches found';
  const pulseStatus = document.querySelector('#home-pulse-status');
  const pulseNetwork = document.querySelector('#home-pulse-network');
  const pulseLaunches = document.querySelector('#home-pulse-launches');
  const pulseLaunchesNote = document.querySelector('#home-pulse-launches-note');
  const pulseTrades = document.querySelector('#home-pulse-trades');
  const pulseTradesNote = document.querySelector('#home-pulse-trades-note');
  const pulseVolume = document.querySelector('#home-pulse-volume');
  const pulseVolumeNote = document.querySelector('#home-pulse-volume-note');
  const pulseGraduated = document.querySelector('#home-pulse-graduated');
  const pulseGraduatedNote = document.querySelector('#home-pulse-graduated-note');
  const windowed = verified.map(item => withMarketWindow(item, '24h'));
  const tradeRecords = windowed.filter(item => item.windowTradeCount != null);
  const volumeRecords = windowed.filter(item => item.windowVolumeSol != null);
  const totalTrades = tradeRecords.length ? tradeRecords.reduce((sum, item) => sum + Number(item.windowTradeCount || 0), 0) : null;
  const totalVolume = volumeRecords.length ? volumeRecords.reduce((sum, item) => sum + Number(item.windowVolumeSol || 0), 0) : null;
  const partialTrades = tradeRecords.some(item => item.windowCoverage === 'partial') || tradeRecords.length < verified.length;
  const partialVolume = volumeRecords.some(item => item.windowCoverage === 'partial') || volumeRecords.length < verified.length;
  if (pulseStatus) pulseStatus.textContent = `Solana RPC · ${EXPLORE_CLUSTER} confirmed`;
  if (pulseNetwork) pulseNetwork.textContent = `Solana ${EXPLORE_CLUSTER === 'devnet' ? 'Devnet' : EXPLORE_CLUSTER}`;
  if (pulseLaunches) pulseLaunches.textContent = verified.length ? String(verified.length) : '—';
  if (pulseLaunchesNote) pulseLaunchesNote.textContent = verified.length ? `Confirmed on ${EXPLORE_CLUSTER}` : 'No confirmed launches';
  if (pulseTrades) pulseTrades.textContent = totalTrades == null ? '—' : formatExploreTradeCount(totalTrades, partialTrades ? 'partial' : 'complete');
  if (pulseTradesNote) pulseTradesNote.textContent = totalTrades == null ? 'Not available from current feed' : `${partialTrades ? 'Partial scan · ' : ''}confirmed Pump events`;
  if (pulseVolume) pulseVolume.textContent = totalVolume == null ? '—' : formatExploreUsd(totalVolume, { partial: partialVolume });
  if (pulseVolumeNote) pulseVolumeNote.textContent = totalVolume == null ? 'Not available from current feed' : `${partialVolume ? 'Partial scan · ' : ''}${Number.isFinite(coinSolUsdPrice) ? 'USD equivalent · ' : ''}SOL volume`;
  const graduated = verified.filter(item => item.migrated === true).length;
  if (pulseGraduated) pulseGraduated.textContent = graduated ? String(graduated) : verified.length ? '0' : '—';
  if (pulseGraduatedNote) pulseGraduatedNote.textContent = verified.length ? 'Verified PumpSwap stage' : 'Waiting for verified mints';
  if (policyUpdated) policyUpdated.textContent = `RPC checked ${new Date().toLocaleTimeString()} · ${EXPLORE_CLUSTER}`;
  renderHomeKpiDashboard(verified);
}
let receiptEvidence = null;
let homeFeeAllocations = null;
let receiptEvidenceChecked = false;
let analyticsSummary = null;
function renderExtendedAnalyticsDashboard(){
  const records = Array.isArray(assets) ? assets : [];
  const burns = verifiedLaunchBurns();
  const burnedTokens = burns.reduce((sum, burn) => sum + Number(burn.receipt.amountTokens ?? burn.amountTokens ?? 0), 0);
  const burnCard = document.querySelector('[data-analytics-metric="burned"]');
  if (burnCard) {
    burnCard.querySelector('strong').textContent = burnedTokens ? formatDashboardQuantity(burnedTokens) : '—';
    burnCard.querySelector('small').innerHTML = burnedTokens
      ? `<b>$FUNDED</b>${burns.length} verified burn receipt${burns.length === 1 ? '' : 's'}`
      : '<b>$FUNDED</b>No verified burn receipts';
  }

  const reserves = verifiedLaunchPolicies.filter(launch => launch?.onchainVerified && Number(launch?.communityAirdrop?.reservedTokens) > 0);
  let pricedReserves = 0;
  const reserveUsd = reserves.reduce((sum, launch) => {
    const asset = records.find(item => item.address === launch.mint);
    const tokenUsd = Number(asset?.priceUsd) > 0
      ? Number(asset.priceUsd)
      : Number(asset?.curvePriceSol) > 0 && Number.isFinite(coinSolUsdPrice) ? Number(asset.curvePriceSol) * coinSolUsdPrice : null;
    if (!Number.isFinite(tokenUsd)) return sum;
    pricedReserves += 1;
    return sum + Number(launch.communityAirdrop.reservedTokens) * tokenUsd;
  }, 0);
  const airdropCard = document.querySelector('[data-analytics-metric="airdrops"]');
  if (airdropCard) {
    const partial = pricedReserves > 0 && pricedReserves < reserves.length;
    airdropCard.querySelector('span').textContent = 'Indicative policy allocation value';
    airdropCard.querySelector('strong').textContent = pricedReserves ? formatDashboardUsd(reserveUsd, { partial }) : '—';
    airdropCard.querySelector('small').innerHTML = pricedReserves
      ? `<b>USD</b>${pricedReserves}/${reserves.length} policy allocation${reserves.length === 1 ? '' : 's'} priced at spot · vault funding unverified`
      : `<b>USD</b>${reserves.length ? 'Policy allocations lack current pricing · vault funding unverified' : 'No published community allocations'}`;
  }

  const verifiedPayouts = Array.isArray(receiptEvidence?.verifiedPayouts) ? receiptEvidence.verifiedPayouts : [];
  const referralPayouts = verifiedPayouts.filter(item => item.source === 'solana-keeper-referral-claim');
  const referralSol = referralPayouts.reduce((sum, item) => sum + Number(item.amountLamports || 0) / 1_000_000_000, 0);
  const referralCard = document.querySelector('[data-analytics-metric="referrals"]');
  if (referralCard) {
    referralCard.querySelector('strong').textContent = referralPayouts.length && Number.isFinite(coinSolUsdPrice)
      ? formatDashboardUsd(referralSol * coinSolUsdPrice)
      : referralPayouts.length ? `${referralSol.toFixed(6)} SOL` : '—';
    referralCard.querySelector('small').innerHTML = referralPayouts.length
      ? `<b>${Number.isFinite(coinSolUsdPrice) ? 'USD' : 'SOL'}</b>${referralPayouts.length} verified manual referral payout${referralPayouts.length === 1 ? '' : 's'}`
      : '<b>USD</b>No verified referral payouts';
  }

  const recipients = document.querySelector('.recipients-panel');
  if (recipients) {
    const count = recipients.querySelector('.panel-count');
    if (count) count.textContent = verifiedPayouts.length ? `${verifiedPayouts.length} verified receipt${verifiedPayouts.length === 1 ? '' : 's'}` : 'Awaiting verified receipts';
    const target = recipients.querySelector('.payment-list, .empty-state');
    if (target && verifiedPayouts.length) {
      target.className = 'payment-list';
      target.replaceChildren();
      for (const payout of verifiedPayouts) {
        const row = document.createElement('div'); row.className = 'payment-row';
        const identity = document.createElement('span');
        const name = document.createElement('strong'); name.textContent = payout.source === 'solana-keeper-referral-claim' ? `Referral · ${shortAddress(payout.to)}` : `Recipient · ${shortAddress(payout.to)}`;
        const proof = document.createElement('a'); proof.href = exploreExplorer(`tx/${encodeURIComponent(payout.signature)}`); proof.target = '_blank'; proof.rel = 'noopener noreferrer'; proof.textContent = 'Confirmed transaction ↗';
        const amount = document.createElement('span'); amount.className = 'payment-amount'; amount.textContent = `${(Number(payout.amountLamports) / 1_000_000_000).toFixed(6)} SOL`;
        identity.append(name, proof); row.append(identity, amount); target.append(row);
      }
    }
  }
}
function renderVerifiedReceiptEvidence(){
  const verifiedStatus = ['onchain-indexed', 'partial'].includes(receiptEvidence?.status);
  const collections = verifiedStatus && Array.isArray(receiptEvidence.verifiedCollections) ? receiptEvidence.verifiedCollections : [];
  const payouts = verifiedStatus && Array.isArray(receiptEvidence.verifiedPayouts) ? receiptEvidence.verifiedPayouts : [];
  const cards = document.querySelectorAll('.analytics-kpis article');
  const feeCard = document.querySelector('[data-analytics-metric="fees"]') || cards[0];
  const payoutCard = document.querySelector('[data-analytics-metric="payouts"]') || cards[2];
  if (feeCard && !collections.length) {
    const recorded = Number(receiptEvidence?.coverage?.recordedCollections || 0);
    const ledgerLamports = Number(analyticsSummary?.collectedLamports);
    const ledgerAmount = analyticsSummary?.status === 'recorded-claims-only' && Number.isSafeInteger(ledgerLamports) && ledgerLamports > 0
      ? `; ${(ledgerLamports / 1_000_000_000).toFixed(9).replace(/0+$/, '').replace(/\.$/, '')} SOL recorded in the ledger` : '';
    feeCard.querySelector('span').textContent = 'Verified fees collected';
    feeCard.querySelector('small').innerHTML = receiptEvidence?.status === 'unverified-records' && recorded
      ? `<b>LEDGER ONLY</b>${recorded} claim${recorded === 1 ? '' : 's'} in the checked window${ledgerAmount}; no matching on-chain proof`
      : `<b>SOL</b>${!receiptEvidenceChecked ? 'Checking receipt evidence' : !receiptEvidence || receiptEvidence.status === 'unavailable' ? 'Receipt verification unavailable' : 'No verified fee claims in the checked window'}`;
  }
  if (collections.length && feeCard) {
    feeCard.querySelector('span').textContent = 'Verified fees collected';
    const lamports = collections.reduce((sum, item) => sum + Number(item.collectedLamports || 0), 0);
    feeCard.querySelector('strong').textContent = `${(lamports / 1_000_000_000).toFixed(6)} SOL`;
    feeCard.querySelector('small').innerHTML = `<b>SOL</b>${collections.length} confirmed fee claims · verified subset`;
  }
  if (payouts.length && payoutCard) {
    payoutCard.querySelector('span').textContent = 'Verified payouts';
    payoutCard.querySelector('strong').textContent = `${payouts.length} verified`;
    payoutCard.querySelector('small').innerHTML = '<b>COUNT</b>Confirmed recipient balance deltas · checked window';
  }
  else if (payoutCard) {
    payoutCard.querySelector('span').textContent = 'Verified payouts';
    payoutCard.querySelector('small').innerHTML = `<b>COUNT</b>${!receiptEvidenceChecked ? 'Checking receipt evidence' : !receiptEvidence || receiptEvidence.status === 'unavailable' ? 'Receipt verification unavailable' : 'No verified payouts in the checked window'}`;
  }
  const list = document.querySelector('#payment-list');
  const tape = document.querySelector('#payment-dialog-list');
  if (!list || !tape) return;
  list.replaceChildren();
  for (const receipt of payouts) {
    const row = document.createElement('div');
    row.className = 'payment-row';
    const identity = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = `Verified SOL payout · ${shortAddress(receipt.to)}`;
    const proof = document.createElement('a');
    proof.href = exploreExplorer(`tx/${encodeURIComponent(receipt.signature)}`);
    proof.target = '_blank'; proof.rel = 'noopener noreferrer'; proof.textContent = 'Confirmed transaction ↗';
    identity.append(name, proof);
    const amount = document.createElement('span');
    amount.className = 'payment-amount';
    amount.textContent = `${(Number(receipt.amountLamports) / 1_000_000_000).toFixed(6)} SOL`;
    row.append(identity, amount);
    list.append(row);
  }
  if (payouts.length) tape.replaceChildren(...[...list.children].map(row => row.cloneNode(true)));
  else tape.innerHTML = '<p class="empty-state">No verified payout receipts are available on Devnet yet. The payment tape will populate only after on-chain receipts are indexed.</p>';
  const footnote = document.querySelector('#payments .panel-footnote');
  if (footnote) footnote.textContent = payouts.length
    ? `${payouts.length} confirmed payout receipt${payouts.length === 1 ? '' : 's'} in the checked window${receiptEvidence.status === 'partial' ? ' · other records remain unverified' : ''}.`
    : receiptEvidence?.status === 'unverified-records' ? 'Recorded payouts have no matching confirmed balance-delta proof.'
      : receiptEvidence?.status === 'unavailable' || !receiptEvidence ? 'Payout receipt verification is unavailable.'
        : 'No verified payout receipts are available.';
  renderExtendedAnalyticsDashboard();
}
function renderOnchainReportState(verified){
  // A direct detail URL can render analytics before the Explore registry has
  // completed its first check. An empty pre-fetch array is not a zero result.
  const feedChecked = Boolean(exploreUpdatedAt);
  verified = verified.filter(item => {
    const policy = verifiedLaunchPolicyForMint(item.address);
    return policy?.onchainVerified && (policy.creatorWallet || policy.feePayer);
  });
  const cards = document.querySelectorAll('.analytics-kpis article');
  const feeCard = document.querySelector('[data-analytics-metric="fees"]') || cards[0];
  const launchCard = document.querySelector('[data-analytics-metric="launches"]') || cards[1];
  const payoutCard = document.querySelector('[data-analytics-metric="payouts"]') || cards[2];
  const volumeCard = document.querySelector('[data-analytics-metric="volume"]');
  const walletCard = document.querySelector('[data-analytics-metric="wallets"]');
  const indexedLaunches = verifiedLaunchPoliciesStatus === 'ready' ? verifiedLaunchPolicies.length : null;
  const launchCount = indexedLaunches ?? verified.length;
  const marketUnavailable = /rate limited|unavailable/i.test(exploreProviderStatus);
  if (feeCard) { feeCard.querySelector('span').textContent = 'Verified fees collected'; feeCard.querySelector('strong').textContent = '—'; feeCard.querySelector('small').innerHTML = '<b>SOL</b>Checking receipt evidence'; }
  if (launchCard) { launchCard.querySelector('strong').textContent = launchCount ? String(launchCount) : '—'; launchCard.querySelector('small').innerHTML = `<b>COUNT</b>${indexedLaunches != null ? feedChecked && !marketUnavailable && verified.length === indexedLaunches ? `Confirmed mints · ${EXPLORE_CLUSTER}` : 'Saved verified launch records · live RPC scan incomplete' : !feedChecked ? 'Checking confirmed mints' : verified.length ? `Confirmed mints · ${EXPLORE_CLUSTER}` : `No confirmed mints · ${EXPLORE_CLUSTER}`}`; }
  if (payoutCard) { payoutCard.querySelector('span').textContent = 'Verified payouts'; payoutCard.querySelector('strong').textContent = '—'; payoutCard.querySelector('small').innerHTML = '<b>COUNT</b>Checking receipt evidence'; }
  const volumeSol = verified.reduce((sum, item) => sum + (Number.isFinite(Number(item.volume24hSol)) ? Number(item.volume24hSol) : 0), 0);
  const hasVolume = verified.some(item => item.volume24hSol != null && Number.isFinite(Number(item.volume24hSol)));
  const partialVolume = verified.some(item => item.volumeCoverage === 'partial' || item.volume24hSol == null);
  if (volumeCard) {
    volumeCard.querySelector('strong').textContent = hasVolume && (!partialVolume || volumeSol > 0) && Number.isFinite(coinSolUsdPrice) ? formatDashboardUsd(volumeSol * coinSolUsdPrice, { partial: partialVolume }) : '—';
    volumeCard.querySelector('small').innerHTML = `<b>USD · 24H</b>${!feedChecked ? 'Checking confirmed trades' : hasVolume ? partialVolume && volumeSol === 0 ? 'Partial scan · volume total unavailable' : volumeSol === 0 ? 'No trades in the checked 24h window' : `${partialVolume ? 'Partial ' : ''}verified Pump events` : marketUnavailable ? 'Market scan unavailable' : 'No verified trade volume'}`;
  }
  const observedWallets = verified.reduce((sum, item) => sum + (Number.isFinite(Number(item.traderCount24h)) ? Number(item.traderCount24h) : 0), 0);
  const hasWallets = verified.some(item => item.traderCount24h != null && Number.isFinite(Number(item.traderCount24h)));
  const partialWallets = verified.some(item => item.traderCount24h == null);
  if (walletCard) {
    walletCard.querySelector('strong').textContent = hasWallets && (!partialWallets || observedWallets > 0) ? `${partialWallets ? '≥' : ''}${observedWallets.toLocaleString()}` : '—';
    walletCard.querySelector('small').innerHTML = `<b>COUNT · 24H</b>${!feedChecked ? 'Checking confirmed trades' : hasWallets ? partialWallets && observedWallets === 0 ? 'Partial scan · wallet total unavailable' : observedWallets === 0 ? 'No trading wallets in the checked 24h window' : `${partialWallets ? 'Partial scan · ' : ''}sum of per-launch wallet counts` : marketUnavailable ? 'Market scan unavailable' : 'No verified wallet activity'}`;
  }
  const strip = document.querySelector('#analytics .strip-stat');
  if (strip) strip.innerHTML = !feedChecked ? '— <small>checking confirmed mints</small>' : verified.length ? `${verified.length} <small>confirmed mints · ${EXPLORE_CLUSTER}</small>` : '— <small>no confirmed mints</small>';
  const chart = document.querySelector('.analytics-chart .mini-chart');
  if (chart) chart.innerHTML = '<div class="empty-state onchain-report-empty"><strong>No fee events to chart.</strong><span>Charts appear after confirmed router claim signatures are indexed.</span></div>';
  const chartBadge = document.querySelector('.analytics-chart .data-badge');
  if (chartBadge) chartBadge.textContent = 'On-chain only';
  const community = document.querySelectorAll('.community-section .signal-list>div b');
  if (community[0]) community[0].textContent = '—';
  if (community[1]) community[1].textContent = verified.length ? String(verified.length) : '—';
  if (community[2]) community[2].textContent = verified.length ? String(verified.filter(item => item.riskLevel === 'high').length) : '—';
  const communityBadge = document.querySelector('.community-section .data-badge');
  if (communityBadge) communityBadge.textContent = 'RPC state';
  renderVerifiedReceiptEvidence();
  renderExtendedAnalyticsDashboard();
  const rangeStatus = document.querySelector('#analytics-range-status');
  if (rangeStatus) {
    const clusterLabel = EXPLORE_CLUSTER === 'mainnet-beta' ? 'Mainnet' : 'Devnet';
    const dataSource = `${clusterLabel} · ${analyticsSummary ? 'Recorded activity. ' : 'Activity service unavailable. '}`;
    const technical = document.querySelector('#analytics-technical-source');
    if (technical) technical.textContent = analyticsSummary ? `Build: ${analyticsSummary.build || 'unavailable'} · Source: ${analyticsSummary.source || 'unavailable'}` : 'Source details unavailable.';
    const recorded = Number(receiptEvidence?.coverage?.recordedCollections || 0);
    const proven = receiptEvidence?.verifiedCollections?.length || 0;
    const launchStatus = indexedLaunches != null
      ? feedChecked && !marketUnavailable && verified.length === indexedLaunches
        ? `${indexedLaunches} funded launch${indexedLaunches === 1 ? '' : 'es'} in the current verified ${clusterLabel} feed.`
        : `${indexedLaunches} previously verified funded launch${indexedLaunches === 1 ? '' : 'es'} in the ${clusterLabel} index. Live RPC scan incomplete.`
      : !feedChecked ? `Checking the ${clusterLabel} launch feed.` : `${verified.length} funded launch${verified.length === 1 ? '' : 'es'} in the current ${clusterLabel} feed.`;
    const receiptStatus = !receiptEvidenceChecked ? 'Checking fee and payout receipts.'
      : !receiptEvidence || receiptEvidence.status === 'unavailable' ? 'Receipt verification is unavailable.'
        : recorded > proven ? `${recorded - proven} recorded fee claim${recorded - proven === 1 ? '' : 's'} ${recorded - proven === 1 ? 'lacks' : 'lack'} matching on-chain proof and ${recorded - proven === 1 ? 'is' : 'are'} excluded from verified totals.`
          : 'Fee and payout figures use matching on-chain receipt proofs.';
    rangeStatus.textContent = `${dataSource}${launchStatus} ${receiptStatus}`;
  }
}
document.addEventListener('funded:analytics-upgraded', () => renderOnchainReportState(assets));
function renderLeaderboard(){
  const title = document.querySelector('#leaderboard-status-title');
  const note = document.querySelector('#leaderboard-status-note');
  const badge = document.querySelector('#leaderboard-status-badge');
  const podium = document.querySelector('#leaderboard-podium');
  const table = document.querySelector('#leaderboard-table');
  const podiumBadge = document.querySelector('#leaderboard-podium-badge');
  if (!podium || !table) return;
  const launchByMint = new Map((Array.isArray(verifiedLaunchPolicies) ? verifiedLaunchPolicies : []).map(item => [item.mint, item]));
  const verified = EXPLORE_CLUSTER === 'devnet'
    ? assets.flatMap(item => {
      const policy = launchByMint.get(item.address);
      const creator = policy?.onchainVerified ? policy.creatorWallet || policy.feePayer : null;
      return item.address && creator ? [{ ...item, creator }] : [];
    })
    : [];
  const groups = new Map();
  for (const item of verified) {
    const wallet = String(item.creator).trim();
    if (!wallet) continue;
    const current = groups.get(wallet) || { wallet, launches: 0, trades: 0, lastActivity: 0 };
    current.launches += 1;
    current.trades += Number.isInteger(item.tradeCount24h) ? item.tradeCount24h : 0;
    current.lastActivity = Math.max(current.lastActivity, Number(item.lastTradeUnixTime || item.createdTimestamp || 0));
    groups.set(wallet, current);
  }
  const ranked = [...groups.values()].sort((a, b) => b.launches - a.launches || b.trades - a.trades || b.lastActivity - a.lastActivity).slice(0, 25);
  const empty = '<div class="empty-state"><strong>No verified creator activity yet.</strong><span>Rankings appear after a funded launch policy and its mint are verified on Devnet.</span></div>';
  if (!ranked.length) {
    if (title) title.textContent = EXPLORE_CLUSTER === 'devnet' ? 'No verified Devnet activity yet' : 'Leaderboard unavailable on this cluster';
    if (note) note.textContent = 'No confirmed creator records are available to rank.';
    if (badge) badge.textContent = 'Unavailable';
    if (podiumBadge) podiumBadge.textContent = 'Awaiting RPC';
    podium.innerHTML = empty;
    table.innerHTML = `<div class="leaderboard-table-head" role="row"><span>Rank</span><span>Builder</span><span>Activity</span><span>Contribution</span><span></span></div>${empty}`;
    return;
  }
  if (title) title.textContent = `${ranked.length} verified creator${ranked.length === 1 ? '' : 's'} on Devnet`;
  if (note) note.textContent = 'Ranked from verified funded launch policies and confirmed mint records; no unregistered coins or simulated activity are included.';
  if (badge) badge.textContent = 'RPC verified';
  if (podiumBadge) podiumBadge.textContent = 'RPC verified';
  const initials = wallet => wallet.slice(0, 2);
  const avatarClass = index => ['mint', 'lavender', 'coral', 'blue'][index % 4];
  const amount = item => `${item.launches} launch${item.launches === 1 ? '' : 'es'}`;
  podium.innerHTML = ranked.slice(0, 3).map((item, index) => `<div class="podium-user ${index === 0 ? 'first' : index === 1 ? 'second' : 'third'}"><span class="${index === 0 ? 'podium-crown' : 'podium-rank'}">${index === 0 ? '✦' : String(index + 1).padStart(2, '0')}</span><span class="leader-avatar ${avatarClass(index)}">${escapeHtml(initials(item.wallet))}</span><strong>${escapeHtml(shortAddress(item.wallet))}</strong><small>${escapeHtml(amount(item))}</small><b>${item.trades ? `${item.trades} trades` : 'Trade data pending'}</b></div>`).join('');
  table.innerHTML = `<div class="leaderboard-table-head" role="row"><span>Rank</span><span>Builder</span><span>Activity</span><span>Contribution</span><span></span></div>${ranked.slice(0, 10).map((item, index) => `<div class="leaderboard-row${index === 0 ? ' featured' : ''}" role="row"><span class="rank-number">${String(index + 1).padStart(2, '0')}</span><span class="leader-identity"><span class="leader-avatar ${avatarClass(index)}">${escapeHtml(initials(item.wallet))}</span><span><strong>${escapeHtml(shortAddress(item.wallet))}</strong><small>Creator · ${escapeHtml(item.lastActivity ? formatOnchainAge(item.lastActivity * 1000) : 'confirmed Devnet')}</small></span></span><span><b>${item.launches}</b><small>launches</small></span><span class="leader-value">${item.trades ? `${item.trades} trades` : '—'}</span><span class="trend">RPC</span></div>`).join('')}`;
}
let homeLaunchTab = 'trending';
const homeHolderCountCache = new Map();
let homeHolderCountLoading = false;
async function loadHomeHolderCounts(records){
  if (homeHolderCountLoading || EXPLORE_CLUSTER !== 'devnet' || !Array.isArray(records) || !records.length) return;
  const candidates = records.slice(0, 6).filter(item => item?.address && (item.holders == null || item.holders === '' || !Number.isFinite(Number(item.holders))));
  if (!candidates.length) return;
  homeHolderCountLoading = true;
  try {
    const { PublicKey } = await getSolana();
    const rpc = await getExploreConnection();
    await Promise.all(candidates.map(async item => {
      const cached = homeHolderCountCache.get(item.address);
      if (cached && Date.now() - cached.at < 300_000) {
        item.holderAccounts = cached.count;
        item.holderCoverage = cached.coverage;
        return;
      }
      try {
        const result = await fetchTokenAccountSample(item.address, rpc, PublicKey);
        const count = Number(result.count);
        const coverage = result.coverage;
        item.holderAccounts = count;
        item.holderCoverage = coverage;
        homeHolderCountCache.set(item.address, { count, coverage, at: Date.now() });
      } catch { /* Keep holder count unavailable when the RPC does not return token accounts. */ }
    }));
  } finally {
    homeHolderCountLoading = false;
    renderHomeLaunchBoard();
  }
}
function renderHomeHolderRewardCoins(){
  const list = document.querySelector('#home-holder-rewards-list');
  const count = document.querySelector('#home-holder-rewards-count');
  if (!list || !count) return;
  if (verifiedLaunchPoliciesStatus !== 'ready') {
    count.textContent = 'Unavailable';
    list.innerHTML = '<li class="home-holder-rewards-empty">Verified launch policies are unavailable right now.</li>';
    return;
  }
  const coins = verifiedLaunchPolicies
    .map(launch => ({ launch, share:verifiedPolicyPercent(launch.feeDistribution?.creatorDirected?.shares?.holderAirdropPercent) }))
    .filter(({ launch, share }) => share > 0 && share <= 80 && launch.mint
      && launch.pumpFeeRoute?.scope === 'per-mint-v2' && launch.pumpFeeRoute?.verified === true
      && launch.pumpFeeRoute.router === launch.creator)
    .sort((a, b) => Number(b.launch.createdTimestamp || 0) - Number(a.launch.createdTimestamp || 0));
  count.textContent = `${coins.length} verified coin${coins.length === 1 ? '' : 's'}`;
  if (!coins.length) {
    list.innerHTML = '<li class="home-holder-rewards-empty">No verified coins currently allocate creator fees to coin holders.</li>';
    return;
  }
  list.innerHTML = coins.map(({ launch, share }) => `<li>
    <a class="home-holder-reward-coin" data-logo-mint="${escapeHtml(launch.mint)}" href="/token/${encodeURIComponent(launch.mint)}">
      <span class="home-holder-reward-avatar" aria-hidden="true">${escapeHtml(String(launch.symbol || launch.name || 'C').slice(0, 1).toUpperCase())}</span>
      <span class="home-holder-reward-identity"><strong>${escapeHtml(launch.name || launch.symbol || 'Unnamed coin')}</strong><small>${escapeHtml(launch.symbol || 'TOKEN')} · Solana ${escapeHtml(EXPLORE_CLUSTER)}</small></span>
      <span class="home-holder-reward-share"><strong>${escapeHtml(share.toLocaleString(undefined, { maximumFractionDigits: 2 }))}%</strong><small>of collected creator fees</small></span>
      <span class="home-holder-reward-link">View coin →</span>
    </a>
  </li>`).join('');
  loadVerifiedTokenLogos(list);
}
function renderHomeLaunchBoard(){
  const grid = document.querySelector('#home-launch-grid');
  if (!grid) return;
  let visible = assets.filter(item => verifiedLaunchPolicyForMint(item.address));
  if (homeLaunchTab === 'new') visible.sort((a, b) => Number(b.createdTimestamp || 0) - Number(a.createdTimestamp || 0));
  else if (homeLaunchTab === 'watchlist') visible = visible.filter(item => getWatchlist().includes(item.address));
  else visible.sort((a, b) => EXPLORE_CLUSTER === 'devnet'
    ? Number(b.curveCapSol || 0) - Number(a.curveCapSol || 0)
    : Number(b.marketCapUsd || 0) - Number(a.marketCapUsd || 0));
  visible = visible.slice(0, 6);
  if (!visible.length) {
    grid.innerHTML = `<div class="empty-state"><strong>${homeLaunchTab === 'watchlist' ? 'No watched launches yet.' : 'No verified launches yet.'}</strong><span>${homeLaunchTab === 'watchlist' ? 'Save a verified mint from Explore to see it here.' : 'This board populates after Solana RPC confirms a Devnet mint.'}</span></div>`;
    return;
  }
  grid.innerHTML = visible.map(item => {
    const change = item.change || '—';
    const changeValue = Number.parseFloat(change);
    const changeClass = Number.isFinite(changeValue) ? (changeValue >= 0 ? 'is-positive' : 'is-negative') : '';
    const progressValue = item.complete === true ? 100 : Number.isFinite(Number(item.curveProgressPercent)) ? Math.max(0, Math.min(100, Number(item.curveProgressPercent))) : 0;
    const progressLabel = item.complete === true ? 'Migrated' : progressValue > 0 ? `${Math.round(progressValue)}% filled` : 'On curve';
    const capSol = item.migrated === true ? item.poolMarketCapSol : item.curveCapSol;
    const capLabel = item.migrated === true ? 'Market cap' : 'Curve cap';
    const hasNoCurveTrades = item.migrated !== true && item.volumeCoverage === 'complete' && Number(item.tradeCount24h) === 0;
    const volumeUsd = EXPLORE_CLUSTER === 'devnet'
      ? item.migrated === true ? 'Pool unindexed' : hasNoCurveTrades ? 'No trades' : item.volume24hSol == null || !Number.isFinite(coinSolUsdPrice) ? '$—' : formatDashboardUsd(Number(item.volume24hSol) * coinSolUsdPrice, { partial: item.volumeCoverage === 'partial' })
      : item.volume24hUsd == null ? '$—' : formatDashboardUsd(item.volume24hUsd);
    const value = EXPLORE_CLUSTER === 'devnet' ? formatCoinUsd(capSol) : item.marketCapUsd != null ? formatCompactUsd(item.marketCapUsd) : '—';
    const providerHolders = item.holders == null || item.holders === '' ? NaN : Number(item.holders);
    const accountHolders = item.holderAccounts == null || item.holderAccounts === '' ? NaN : Number(item.holderAccounts);
    const holderCount = Number.isFinite(providerHolders) && providerHolders >= 0
      ? providerHolders.toLocaleString()
      : Number.isFinite(accountHolders) && accountHolders >= 0 ? `${item.holderCoverage === 'lower-bound' ? '≥' : ''}${accountHolders.toLocaleString()}` : '—';
    const holderTitle = Number.isFinite(providerHolders)
      ? 'Holder count from the indexed market provider'
      : Number.isFinite(accountHolders) ? `${item.holderCoverage === 'lower-bound' ? 'At least ' : ''}${accountHolders} confirmed non-zero token account${accountHolders === 1 ? '' : 's'}; token accounts are not necessarily unique wallets` : 'Token-account count unavailable';
    return `<article class="token-card-shell home-launch-card" data-mint="${escapeHtml(item.address || '')}" data-logo-mint="${escapeHtml(item.address || '')}">
      <div class="home-launch-card-top">
        <span class="home-token-avatar">${escapeHtml(item.icon || String(item.symbol || 'T').slice(0, 1))}</span>
        <span class="home-token-identity"><strong>${escapeHtml(item.symbol || 'TOKEN')}</strong><small>${escapeHtml(item.name || 'Unnamed token')}</small></span>
        <span class="home-stage-pill">${escapeHtml(exploreStageLabel(item))}</span>
      </div>
      <div class="home-launch-card-stats">
        <span><small>${EXPLORE_CLUSTER === 'devnet' ? capLabel : 'Market cap'}</small><strong>${escapeHtml(value)}</strong></span>
        <span><small>24h volume</small><strong>${escapeHtml(volumeUsd)}</strong></span>
        <span title="${escapeHtml(holderTitle)}"><small>${EXPLORE_CLUSTER === 'devnet' ? 'Token accounts' : 'Holders'}</small><strong>${escapeHtml(holderCount)}</strong></span>
        <span class="home-launch-change ${changeClass}"><small>24h change</small><strong>${escapeHtml(item.migrated === true ? 'Pool unindexed' : hasNoCurveTrades ? 'No trades' : change)}</strong></span>
      </div>
      <div class="home-launch-progress" aria-label="${escapeHtml(progressLabel)}"><i style="--launch-progress:${progressValue}%"></i></div>
      <div class="home-launch-meta"><span>${escapeHtml(formatOnchainAge(Number(item.createdTimestamp || 0) * 1000))}</span><span>${escapeHtml(progressLabel)}</span></div>
      <div class="home-launch-card-actions"><a href="/token/${encodeURIComponent(item.address || '')}">Details ↗</a><button type="button" data-trade-mint="${escapeHtml(item.address || '')}">Trade</button></div>
    </article>`;
  }).join('');
  grid.querySelectorAll('.home-launch-card').forEach((card, index) => {
    const promotion = promotionElement(visible[index]?.address, true);
    if (promotion) card.querySelector('.home-launch-card-top')?.append(promotion);
  });
  loadVerifiedTokenLogos(grid);
}
document.querySelectorAll('[data-home-launch-tab]').forEach(button => button.addEventListener('click', () => {
  homeLaunchTab = button.dataset.homeLaunchTab || 'trending';
  document.querySelectorAll('[data-home-launch-tab]').forEach(item => { const active = item === button; item.classList.toggle('active', active); item.setAttribute('aria-selected', String(active)); });
  renderHomeLaunchBoard();
}));
let exploreLoadInFlight = null;
async function loadOnchainExploreData(){
  if (exploreLoadInFlight) return exploreLoadInFlight;
  const load = loadOnchainExploreDataOnce();
  exploreLoadInFlight = load;
  try { return await load; }
  finally { if (exploreLoadInFlight === load) exploreLoadInFlight = null; }
}
async function loadOnchainExploreDataOnce(){
    const pumpSort = exploreSort === 'newest' ? 'created_timestamp' : 'last_trade_timestamp';
    const birdeyeSort = exploreSort === 'change' ? 'price_change_24h_percent' : exploreSort === 'market-cap' ? 'market_cap' : 'volume_24h_usd';
    const feeds = [
      Promise.resolve({ available: false, data: null }),
      apiRequest(`/api/pump/explore?limit=40&sort=${encodeURIComponent(pumpSort)}`).catch(() => ({ available: false, data: null })),
    ];
    if (EXPLORE_CLUSTER !== 'devnet') feeds[0] = apiRequest(`/api/birdeye/explore?limit=40&sort_by=${encodeURIComponent(birdeyeSort)}`).catch(() => ({ available: false, data: null }));
    const [birdeyeFeed, pumpFeed] = await Promise.all(feeds);
    exploreFeedAvailable = pumpFeed.available;
    if (pumpFeed.available) exploreFeedSort = pumpSort;
    const birdeyeRecords = Array.isArray(birdeyeFeed.data?.items) ? birdeyeFeed.data.items : [];
    const pumpRecords = Array.isArray(pumpFeed.data?.items) ? pumpFeed.data.items : [];
    const birdeyeByAddress = new Map(birdeyeRecords.map(item => [item.address, item]));
    const records = pumpRecords.map(pump => {
      const market = birdeyeByAddress.get(pump.mint);
      return {
        ...pump,
        address: pump.mint,
        priceUsd: market?.priceUsd ?? null,
        priceChange24hPercent: market?.priceChange24hPercent ?? null,
        marketCapUsd: market?.marketCapUsd ?? pump.marketCapUsd,
        liquidityUsd: market?.liquidityUsd ?? null,
        volume24hUsd: market?.volume24hUsd ?? null,
        holders: market?.holders ?? null,
        lastTradeUnixTime: market?.lastTradeUnixTime ?? pump.lastTradeTimestamp ?? null,
        source: market ? 'Pump.fun + Birdeye' : EXPLORE_CLUSTER === 'devnet' ? 'Verified Devnet registry' : 'Pump.fun',
        fetchedAt: market ? birdeyeFeed.data?.fetchedAt : pumpFeed.data?.fetchedAt,
      };
    });
    const verified = [];
    let exploreVerificationFailed = false;
    let exploreRateLimited = false;
    if (records.length) {
      try {
        const { PublicKey, unpackAccount, unpackMint, NATIVE_MINT, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } = await getSolana();
        const exploreRpc = await getExploreConnection();
        const candidates = records.flatMap(record => { try { return [{ record, mint: new PublicKey(record.address) }]; } catch { return []; } });
        const accountBatch = candidates.length ? await exploreRpc.getMultipleAccountsInfo([...candidates.map(item => item.mint), ...candidates.map(item => bondingCurvePda(item.mint))], 'confirmed') : [];
        const accounts = accountBatch.slice(0, candidates.length);
        const curveAccounts = accountBatch.slice(candidates.length);
        for (let index = 0; index < candidates.length; index += 1) {
          const { record, mint } = candidates[index];
          try {
            const mintAccount = accounts[index];
            if (!mintAccount || (!mintAccount.owner.equals(TOKEN_PROGRAM_ID) && !mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID))) continue;
            const mintState = unpackMint(mint, mintAccount, mintAccount.owner);
            const curveAccount = curveAccounts[index];
            const curve = curveAccount?.owner?.equals(PUMP_PROGRAM_ID) ? PUMP_SDK.decodeBondingCurveNullable(curveAccount) : null;
            const curveMetrics = readCurveMetrics(curve, mintState);
            const numeric = value => value == null || value === '' ? NaN : Number(value);
            const price = numeric(record.priceUsd);
            const change = numeric(record.priceChange24hPercent);
            const marketCap = numeric(record.marketCapUsd);
            verified.push({ mint: record.address, symbol: record.symbol || 'TOKEN', name: record.name || 'Unnamed token', value: EXPLORE_CLUSTER === 'devnet' && curveMetrics.curvePriceSol != null ? `Curve spot · ${formatCoinUsd(curveMetrics.curvePriceSol)}` : Number.isFinite(price) ? formatUsd(price) : 'Price unavailable', change: Number.isFinite(change) ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}%` : '—', meta: Number.isFinite(marketCap) ? `MC ${formatCompactUsd(marketCap)} · ${record.source || 'Pump.fun'}` : (record.source || 'Pump.fun'), icon: String(record.symbol || 'T').slice(0, 1), source: record.source || 'Pump.fun', creator: record.creator || null, complete: curve ? Boolean(curve.complete) : null, migrated: null, pumpSwapPool: null, quoteMint: curve?.quoteMint?.toBase58?.() || null, bondingCurve: curve ? bondingCurvePda(mint).toBase58() : null, raydiumPool: record.raydiumPool || null, fetchedAt: record.fetchedAt || null, address: record.address, mintSupplyRaw: mintState.supply.toString(), mintDecimals: mintState.decimals, mintAuthorityRevoked: mintState.mintAuthority == null, freezeAuthorityRevoked: mintState.freezeAuthority == null, volume24hUsd: record.volume24hUsd ?? null, liquidityUsd: record.liquidityUsd ?? null, holders: record.holders ?? null, marketCapUsd: Number.isFinite(marketCap) ? marketCap : null, priceChange24hPercent: Number.isFinite(change) ? change : null, createdTimestamp: record.createdTimestamp || null, lastTradeUnixTime: record.lastTradeUnixTime || null, ...curveMetrics });
         } catch {}
         }
         const completed = verified.filter(item => item.complete === true);
         if (completed.length) {
           try {
             const poolKeys = completed.map(item => canonicalPumpPoolPda(new PublicKey(item.address), item.quoteMint ? new PublicKey(item.quoteMint) : undefined));
             const poolAccounts = await exploreRpc.getMultipleAccountsInfo(poolKeys, 'confirmed');
              const decodedPools = completed.map(() => null);
              completed.forEach((item, index) => {
                const account = poolAccounts[index];
                item.migrated = false;
                if (!account?.owner?.equals(PUMP_AMM_PROGRAM_ID)) return;
                try {
                  const pool = PUMP_AMM_SDK.decodePool(account);
                  if (!pool.baseMint?.equals(new PublicKey(item.address))) return;
                  item.migrated = true;
                  item.pumpSwapPool = poolKeys[index].toBase58();
                  decodedPools[index] = pool;
                } catch {}
              });
              const migratedPools = decodedPools.flatMap((pool, index) => pool ? [{ pool, item: completed[index] }] : []);
              if (migratedPools.length) {
                const vaultAccounts = await exploreRpc.getMultipleAccountsInfo(migratedPools.flatMap(({ pool }) => [pool.poolBaseTokenAccount, pool.poolQuoteTokenAccount]), 'confirmed');
                migratedPools.forEach(({ pool, item }, index) => {
                  if (!pool.quoteMint?.equals(NATIVE_MINT)) return;
                  try {
                    const baseInfo = vaultAccounts[index * 2];
                    const quoteInfo = vaultAccounts[index * 2 + 1];
                    const baseVault = unpackAccount(pool.poolBaseTokenAccount, baseInfo, baseInfo?.owner);
                    const quoteVault = unpackAccount(pool.poolQuoteTokenAccount, quoteInfo, quoteInfo?.owner);
                    const metrics = readPumpSwapMetrics({ baseAmount: baseVault.amount, quoteAmount: quoteVault.amount, virtualQuoteAmount: pool.virtualQuoteReserves, baseDecimals: item.mintDecimals, quoteDecimals: 9, supply: item.mintSupplyRaw });
                    Object.assign(item, metrics, { pumpSwapBaseVault: pool.poolBaseTokenAccount.toBase58(), pumpSwapQuoteVault: pool.poolQuoteTokenAccount.toBase58() });
                    if (metrics.poolPriceSol != null) item.value = `Pool spot · ${formatCoinUsd(metrics.poolPriceSol)}`;
                  } catch {}
                });
              }
           } catch { /* A failed pool lookup leaves migration unverified. */ }
         }
      } catch (error) { exploreVerificationFailed = true; exploreRateLimited = /429|rate.?limit|too many requests/i.test(String(error?.message || '')); }
    }
    if (exploreRateLimited) exploreBackoffUntil = Date.now() + 60_000;
    else if (!exploreVerificationFailed) exploreBackoffUntil = 0;
    if ((exploreVerificationFailed || !pumpFeed.available) && assets.length && exploreLastVerifiedAt) {
      exploreUpdatedAt = new Date().toISOString();
      const cause = exploreVerificationFailed ? `Solana ${EXPLORE_CLUSTER} RPC ${exploreRateLimited ? 'rate limited' : 'unavailable'}` : 'Launch feed unavailable';
      exploreProviderStatus = `${cause} · last verified ${formatFeedAge(exploreLastVerifiedAt)} · stale`;
      renderExploreAssets();
      renderRegistry();
      return;
    }
    let scannedCount = 0;
    let marketScanRateLimited = false;
    if (EXPLORE_CLUSTER === 'devnet' && !exploreVerificationFailed) {
      // The endpoint's 60-credit minute budget charges ten credits per fresh scan.
      // Leave one scan available for an explicit token-detail request.
      const scanned = verified.slice(0, 5);
      await Promise.all(scanned.map(async item => {
        const cached = exploreActivityCache.get(item.address);
        const hasBreakdown = data => data?.tradeCount24h == null || (data.activityWindows?.['1h']
          && data.activityWindows?.['6h'] && data.activityWindows?.['24h']
          && Number.isInteger(data.buyCount24h) && Number.isInteger(data.sellCount24h));
        let market = cached && Date.now() - cached.at < 60_000 && hasBreakdown(cached.data) ? cached.data : null;
        if (!market) {
          const response = await apiRequest(`/api/tokens/${encodeURIComponent(item.address)}/market-activity`, { signal: AbortSignal.timeout(12000) }).catch(error => {
            if (/rate limit|429|too many requests/i.test(String(error?.message || ''))) marketScanRateLimited = true;
            return { available: false, data: null };
          });
          if (response.available && response.data?.cluster === EXPLORE_CLUSTER && response.data?.mint === item.address) {
            market = response.data;
            exploreActivityCache.set(item.address, { at: Date.now(), data: market });
          }
        }
        if (!market) return;
        scannedCount += 1;
        const volume = Number(market.volume24hSol);
        item.volume24hSol = market.volume24hSol != null && Number.isFinite(volume) && volume >= 0 ? volume : null;
        item.volumeCoverage = market.coverage;
        for (const key of ['tradeCount24h', 'buyCount24h', 'sellCount24h']) {
          const count = Number(market[key]);
          item[key] = market[key] != null && Number.isInteger(count) && count >= 0 ? count : null;
        }
        const traderCountRaw = market.activityWindows?.['24h']?.traderCount;
        const traderCount = Number(traderCountRaw);
        item.traderCount24h = traderCountRaw != null && Number.isInteger(traderCount) && traderCount >= 0 ? traderCount : null;
        item.recentTrades = Array.isArray(market.recentTrades) ? market.recentTrades : [];
        item.activityWindows = market.activityWindows && ['1h', '6h', '24h'].every(period => market.activityWindows[period]) ? market.activityWindows : null;
        const latestTrade = Number(market.recentTrades?.[0]?.blockTime);
        if (Number.isFinite(latestTrade) && latestTrade > 0) item.lastTradeUnixTime = latestTrade;
        if (market.priceChangeBasis === '24h' && market.priceChangePercent != null && Number.isFinite(Number(market.priceChangePercent))) {
          item.priceChange24hPercent = Number(market.priceChangePercent);
          item.change = `${item.priceChange24hPercent >= 0 ? '+' : ''}${item.priceChange24hPercent.toFixed(2)}%`;
        }
      }));
    }
    exploreScannedCount = scannedCount;
    if (marketScanRateLimited) exploreBackoffUntil = Date.now() + 60_000;
  assets = Array.from(new Map(verified.map(item => [item.address, item])).values());
    exploreUpdatedAt = new Date().toISOString();
    if (!exploreVerificationFailed && pumpFeed.available && records.length) exploreLastVerifiedAt = exploreUpdatedAt;
    exploreProviderStatus = exploreVerificationFailed ? `Solana ${EXPLORE_CLUSTER} RPC ${exploreRateLimited ? 'rate limited · retry shortly' : 'unavailable'}` : !pumpFeed.available ? 'Launch feed unavailable' : !records.length ? 'No indexed launches · awaiting RPC verification' : EXPLORE_CLUSTER === 'devnet' ? `Devnet registry · RPC verified${marketScanRateLimited ? ' · trade history rate limited' : ''}` : !birdeyeFeed.available ? `Pump.fun · Birdeye unavailable · RPC verified` : 'Pump.fun + Birdeye · RPC verified';
    const feedStatus = document.querySelector('#explore-data-status');
    renderExploreAssets();
    renderHomeLaunchBoard();
    renderCreatorLaunches();
    void loadHomeHolderCounts(assets);
    if (feedStatus) {
      feedStatus.textContent = exploreProviderStatus;
    }
    renderRegistry();
    updateExploreSortAvailability();
  renderOnchainReportState(verified);
  renderLeaderboard();
  renderHomeOnchainSnapshot(verified);
}
const exploreInitialLoadStarted = !coinRouteRequested();
if (exploreInitialLoadStarted) loadOnchainExploreData().catch(() => {
  const status = document.querySelector('#home-live-status');
  const note = document.querySelector('#home-verified-launches-note');
  if (status) status.textContent = 'Solana RPC · unavailable';
  if (note) note.textContent = 'Unable to verify live data';
});
setInterval(() => { if (!document.hidden && !coinRouteRequested() && exploreAutoRefresh && Date.now() >= exploreBackoffUntil) loadOnchainExploreData().catch(() => {}); }, 30000);
setInterval(() => { if (!document.hidden && exploreAutoRefresh) renderStonkEnhancements(); }, 30000);
let receiptEvidenceLoading = false;
async function loadReceiptEvidence(){
  if (receiptEvidenceLoading) return;
  receiptEvidenceLoading = true;
  try {
    const [result, summary] = await Promise.all([
      apiRequest('/api/evidence/receipts').catch(() => null),
      apiRequest('/api/analytics/summary').catch(() => null),
    ]);
    const data = result?.data;
    receiptEvidence = result?.available === true && data?.cluster === EXPLORE_CLUSTER ? data : null;
    receiptEvidenceChecked = true;
    analyticsSummary = summary?.available === true && summary.data?.homeFeeAllocations?.cluster === EXPLORE_CLUSTER
      ? summary.data : null;
    homeFeeAllocations = summary?.available === true && summary.data?.homeFeeAllocations?.cluster === EXPLORE_CLUSTER
      ? summary.data.homeFeeAllocations : null;
    renderOnchainReportState(assets);
    renderHomeKpiDashboard(assets);
  } finally { receiptEvidenceLoading = false; }
}
document.querySelector('#payment-list').innerHTML = payments.map(p => `<div class="payment-row"><span class="payment-avatar">${p[0]}</span><span><strong>${p[1]}</strong><small>${p[2]}</small></span><span class="payment-amount">${p[3]}<small> sample</small></span></div>`).join('');
document.querySelector('#payment-dialog-list').innerHTML = payments.length
  ? document.querySelector('#payment-list').innerHTML
  : '<p class="empty-state">No verified payout receipts are available on Devnet yet. The payment tape will populate only after on-chain receipts are indexed.</p>';
loadReceiptEvidence();
setInterval(() => { if (!document.hidden) loadReceiptEvidence().catch(() => {}); }, 60_000);
renderWatchlist();
let registryLaunches = [];
let registrySort = 'recent';
function updateExploreSortAvailability(){
  const select = document.querySelector('#explore-sort');
  if (EXPLORE_CLUSTER !== 'devnet') {
    const labels = { 'market-cap': 'Market cap', volume: '24h volume', airdrop: 'Community airdrop allocation', 'holder-fee': 'Creator fees to holders', 'x-fee': 'Creator fees to X account', trades: '24h trades', turnover: 'Volume / cap', liquidity: 'Liquidity', 'recent-trade': 'Recent activity', holders: 'Holders', change: '24h price change', newest: 'Newest' };
    if (select) for (const option of select.options) { option.textContent = labels[option.value]; option.disabled = option.value === 'trades'; }
    document.querySelectorAll('[data-explore-sort]').forEach(button => { button.disabled = false; button.title = ''; });
    const headings = document.querySelectorAll('.scanner-head span');
    if (headings[2]) headings[2].textContent = 'Market cap';
    if (headings[3]) headings[3].textContent = '24h volume';
    if (headings[4]) headings[4].textContent = 'Liquidity';
    if (headings[5]) headings[5].textContent = '24h change';
    const note = document.querySelector('#scanner-note');
    if (note) note.textContent = 'Market figures are provider-indexed estimates. A dash means no verified market value is available.';
    const button = document.querySelector('[data-registry-sort="market-cap"]');
    if (button) button.textContent = 'Market cap';
    const activityButton = document.querySelector('[data-registry-sort="change"]');
    if (activityButton) activityButton.textContent = '24h change';
    return;
  }
  const benefits = assets.map(withVerifiedExploreBenefits);
  const supported = {
    'market-cap': assets.some(item => item.curveCapSol != null),
    volume: exploreScannedCount === assets.length && assets.some(item => withMarketWindow(item, exploreWindow).windowVolumeSol != null),
    airdrop: benefits.some(item => item.benefitPolicyVerified && item.communityAirdropPercent != null),
    'holder-fee': benefits.some(item => item.benefitPolicyVerified && item.holderFeePercent != null),
    'x-fee': benefits.some(item => item.benefitPolicyVerified && item.xFeePercent != null),
    trades: exploreScannedCount === assets.length && assets.some(item => withMarketWindow(item, exploreWindow).windowTradeCount != null),
    turnover: exploreScannedCount === assets.length && assets.some(item => { const metric = withMarketWindow(item, exploreWindow); return metric.windowVolumeSol != null && metric.curveCapSol > 0; }),
    liquidity: assets.some(item => item.curveReserveSol != null),
    'recent-trade': true,
    holders: false,
    change: assets.some(item => item.priceChange24hPercent != null),
    newest: true,
  };
  document.querySelectorAll('[data-explore-sort]').forEach(button => {
    const available = supported[button.dataset.exploreSort] !== false;
    button.disabled = !available;
    button.title = available ? '' : 'This sort needs more verified data';
  });
  if (select) {
    for (const option of select.options) option.disabled = !supported[option.value];
    if (!supported[exploreSort]) {
      exploreSort = exploreTab === 'new' ? 'newest' : 'recent-trade';
      select.value = exploreSort;
      renderExploreAssets();
    }
  }
  const changeButton = [...document.querySelectorAll('.registry-order button')].find(button => button.dataset.registrySort === 'change');
  if (changeButton) {
    changeButton.textContent = `${exploreWindow} trades`;
    changeButton.disabled = !supported.trades;
    changeButton.title = supported.trades ? 'Confirmed Pump trade events' : 'A complete scanned trade count is not available on Devnet';
  }
  if (registrySort === 'change' && !supported.trades) {
    registrySort = 'recent';
    document.querySelectorAll('.registry-order button').forEach(button => button.classList.toggle('active', button.dataset.registrySort === 'recent'));
    renderRegistry();
  }
}
function refreshRegistryLaunches(){
  registryLaunches = assets.filter(item => item.address).map(item => EXPLORE_CLUSTER === 'devnet' ? withMarketWindow(item, exploreWindow) : enrichMarketRecord(item));
}
function renderRegistry(query = exploreQuery){
  refreshRegistryLaunches();
  const filtered = filterMarketRecords(registryLaunches, exploreFilterOptions(query, registrySort === 'recent' ? 'newest' : registrySort === 'market-cap' ? 'market-cap' : EXPLORE_CLUSTER === 'devnet' ? 'trades' : 'change'));
  const count = document.querySelector('#scanner-count');
  if (count) count.textContent = `${filtered.length} of ${registryLaunches.length} shown`;
  const list = document.querySelector('#launch-list');
  if (!list) return;
  if (!filtered.length) {
    const reason = exploreEmptyReason();
    list.innerHTML = /RPC (?:rate limited|unavailable)/.test(exploreProviderStatus) && !assets.length
      ? '<div class="empty-state">Solana verification is unavailable. Retry with Refresh shortly.</div>'
      : `<div class="empty-state">${escapeHtml(reason?.[0] || 'No verified launches match these filters.')} ${escapeHtml(reason?.[1] || 'Try All stages or clear the search.')}</div>`;
    return;
  }
  list.innerHTML = filtered.map(item => {
    const mint = escapeHtml(item.address);
    const symbol = escapeHtml(item.symbol);
    const stage = exploreStageLabel(item);
    const age = item.createdTimestamp ? escapeHtml(formatOnchainAge(Number(item.createdTimestamp) * 1000)) : 'Age unavailable';
    const change = item.priceChange24hPercent == null ? '—' : `${item.priceChange24hPercent >= 0 ? '+' : ''}${Number(item.priceChange24hPercent).toFixed(2)}%`;
    return `<div class="scanner-row" role="listitem" data-logo-mint="${mint}">
      <div class="scanner-token"><span class="asset-icon">${escapeHtml(item.icon)}</span><span><strong>${symbol} <small>${escapeHtml(item.name)}</small></strong><small title="${mint}">${escapeHtml(shortAddress(item.address))} · RPC mint</small><small class="scanner-authorities">Mint ${item.mintAuthorityRevoked ? 'revoked' : 'active'} · Freeze ${item.freezeAuthorityRevoked ? 'revoked' : 'active'}</small></span></div>
      <div class="scanner-stage"><strong>${stage}</strong><small>${age}${item.complete === false && item.curveProgressPercent != null && Number.isFinite(Number(item.curveProgressPercent)) ? ` · ${Number(item.curveProgressPercent).toFixed(0)}% curve` : ''}</small></div>
      <span class="scanner-metric">${escapeHtml(EXPLORE_CLUSTER === 'devnet' ? formatCoinUsd(item.curveCapSol) : formatCompactUsd(item.marketCapUsd))}</span>
      <span class="scanner-metric" title="${item.windowCoverage === 'partial' ? 'Partial confirmed trade-history scan; shown as a lower bound' : 'Confirmed trade history'}">${escapeHtml(EXPLORE_CLUSTER === 'devnet' ? formatExploreUsd(item.windowVolumeSol, { partial: item.windowCoverage === 'partial' }) : formatCompactUsd(item.volume24hUsd))}</span>
      <span class="scanner-metric">${escapeHtml(EXPLORE_CLUSTER === 'devnet' ? formatCoinUsd(item.curveReserveSol) : formatCompactUsd(item.liquidityUsd))}</span>
      <span class="scanner-metric ${EXPLORE_CLUSTER !== 'devnet' && Number(item.priceChange24hPercent) < 0 ? 'negative' : ''}">${EXPLORE_CLUSTER === 'devnet' ? `<strong>${formatExploreTradeCount(item.windowTradeCount, item.windowCoverage)}</strong><small>${item.windowBuyCount != null && item.windowSellCount != null ? `${formatExploreTradeCount(item.windowBuyCount, item.windowCoverage)} B · ${formatExploreTradeCount(item.windowSellCount, item.windowCoverage)} S` : 'Split unavailable'}${item.windowTraderCount != null ? ` · ${formatExploreTradeCount(item.windowTraderCount, item.windowCoverage)} wallets` : ''}</small>` : change}</span>
      <div class="scanner-actions"><button type="button" class="watch-button scanner-watch" data-mint="${mint}" aria-label="Save ${symbol} to watchlist" aria-pressed="false">☆</button><a href="/token/${encodeURIComponent(item.address)}" aria-label="Inspect ${symbol}">Inspect</a><button type="button" data-trade-mint="${mint}">Trade</button><button type="button" class="copy-row" data-mint="${mint}" aria-label="Copy ${symbol} mint address">⧉</button></div>
    </div>`;
  }).join('');
  list.querySelectorAll('.scanner-row').forEach((row, index) => {
    const promotion = promotionElement(filtered[index]?.address);
    if (promotion) row.querySelector('.scanner-token strong')?.append(' ', promotion);
  });
  loadVerifiedTokenLogos(list);
  renderWatchlist();
}
renderRegistry();

const toast = document.querySelector('#toast');
let toastTimer;
function showToast(message){
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      if (!toast.classList.contains('show') && toast.textContent === message) toast.textContent = '';
    }, 300);
  }, 2600);
}
function mobileWalletHex(bytes){ return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), byte => byte.toString(16).padStart(2, '0')).join(''); }
async function registerMobileWalletFlow(signRequest = null, transactionRequest = null){
  const id = mobileWalletHex(24), pollToken = mobileWalletHex(32);
  const result = await apiRequest('/api/mobile-wallet/relay', { method:'POST', body:{ id, pollToken, ...(signRequest ? { signRequest } : {}), ...(transactionRequest ? { transactionRequest } : {}) } });
  if (!result.available) throw new Error('Wallet connection API is unavailable in this browser build.');
  if (!result.data?.callbackUrl || new URL(result.data.callbackUrl).origin !== window.location.origin) throw new Error('Wallet callback is unavailable on this app origin.');
  return { id, pollToken, callbackUrl:result.data.callbackUrl, expiresAt:Date.now() + 5 * 60_000 };
}
function showMobileWalletRequest(link, phase, qrLink = link){
  const dialog = document.querySelector('#mobile-wallet-dialog');
  const message = document.querySelector('#mobile-wallet-message');
  const qr = document.querySelector('#mobile-wallet-qr');
  const qrLabel = document.querySelector('#mobile-wallet-qr-label');
  const alternate = document.querySelector('#mobile-wallet-alternate');
  if (alternate) alternate.hidden = phase !== 'sign';
  dialog.querySelector('h2').textContent = phase === 'connect' ? 'Connect Phantom to this desktop' : phase === 'sign-fallback' ? 'Approve the message in Phantom' : phase === 'transaction' ? 'Review the Devnet trade in Phantom' : 'Approve the claim in Phantom';
  const steps = dialog.querySelectorAll('.mobile-wallet-steps span');
  if (steps.length === 3) {
    steps[0].textContent = 'Scan this QR with Phantom on your phone';
    steps[1].textContent = phase === 'connect' ? 'Approve the Devnet wallet connection' : phase === 'sign-fallback' ? 'Tap Connect and sign the message' : phase === 'transaction' ? 'Tap Connect and review, then approve the transaction' : 'Approve the claim message in Phantom';
    steps[2].textContent = phase === 'connect' ? 'Continue on this desktop; scan again when a claim needs signing' : phase === 'transaction' ? 'Return here for Devnet confirmation' : 'Return to this desktop for payout verification';
  }
  mobileWalletLink = link;
  message.textContent = phase === 'connect' ? 'Scan with Phantom and approve this Devnet wallet connection. The address will appear in this desktop tab.' : phase === 'sign-fallback' ? 'Scan with Phantom, then tap Connect and sign on the funded.vip signer page. The signature returns to this desktop tab.' : phase === 'transaction' ? 'This QR opens a small funded.vip signer inside Phantom. Review the amount, fee, and token there before approving. Your desktop wallet stays connected and submits the signed transaction.' : 'Scan with Phantom and approve the claim message. The signature will return to this desktop tab.';
  qr.src = `https://quickchart.io/qr?size=320&margin=2&text=${encodeURIComponent(qrLink)}`;
  qr.alt = phase === 'connect' ? 'Scan to connect Phantom mobile wallet to this desktop' : phase === 'sign-fallback' ? 'Scan to open funded.vip signer in Phantom' : phase === 'transaction' ? 'Scan to sign the Devnet trade transaction with Phantom mobile wallet' : 'Scan to sign claim message with Phantom mobile wallet';
  qr.hidden = false;
  qrLabel.textContent = 'Waiting for approval in Phantom · expires in 5 minutes';
  if (!dialog.open) { if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', ''); }
}
async function waitForMobileWalletFlow(flow, version){
  let temporaryFailures = 0;
  while (Date.now() < flow.expiresAt) {
    if (version !== mobileWalletRequestVersion || !document.querySelector('#mobile-wallet-dialog')?.open) throw new Error('Wallet request cancelled on desktop.');
    let response;
    try {
      response = await apiRequest(`/api/mobile-wallet/relay/${flow.id}`, { headers:{ 'x-mobile-wallet-token':flow.pollToken }, cache:'no-store' });
      temporaryFailures = 0;
    } catch (error) {
      if (/API request failed \((?:502|503|504)\)|Failed to fetch|API service unavailable/i.test(String(error.message))) {
        if (++temporaryFailures <= 5) { await new Promise(resolve => setTimeout(resolve, 1200)); continue; }
        throw new Error('Connection interrupted. Close this QR and start the wallet request again.');
      }
      if (/API request failed \(404\)/.test(String(error.message))) throw new Error('Wallet request expired. Close this QR and start the wallet request again.');
      throw error;
    }
    if (response.data?.status === 'complete') return response.data.result;
    await new Promise(resolve => setTimeout(resolve, 1200));
  }
  throw new Error('Phantom approval expired. Start a new wallet request.');
}
async function createMobileWalletProvider(session){
  verifyPhantomMobileSession(session, window.location.origin);
  const { PublicKey } = await getSolana();
  let pendingTradeFlow = null;
  const provider = {
    publicKey:new PublicKey(session.publicKey), isConnected:true, remoteMobile:true,
    async signTransaction(transaction){
      if (!provider.isConnected) throw new Error('Reconnect the mobile wallet before trading.');
      const transactionRequest = { publicKey:session.publicKey, transaction:Buffer.from(transaction.serialize({ requireAllSignatures:false, verifySignatures:false })).toString('base64'), ...(Number.isSafeInteger(transaction.fundedLastValidBlockHeight) ? { lastValidBlockHeight:transaction.fundedLastValidBlockHeight } : {}), ...(transaction.fundedTradeSummary ? { summary:transaction.fundedTradeSummary } : {}) };
      const flow = await registerMobileWalletFlow(null, transactionRequest);
      pendingTradeFlow = flow;
      const version = ++mobileWalletRequestVersion;
      const signerUrl = `${window.location.origin}/api/mobile-wallet/trade/${flow.id}`;
      const browseLink = `https://phantom.app/ul/browse/${encodeURIComponent(signerUrl)}?ref=${encodeURIComponent(window.location.origin)}`;
      showMobileWalletRequest(browseLink, 'transaction');
      try {
        const result = await waitForMobileWalletFlow(flow, version);
        if (!Number.isSafeInteger(result.lastValidBlockHeight) || result.lastValidBlockHeight <= 0) throw new Error('Phantom returned a trade without a verified Devnet expiry. Nothing was submitted.');
        const signed = verifyPhantomMobileTransaction(transaction, result.transaction, session.publicKey, result.blockhash);
        signed.fundedLastValidBlockHeight = result.lastValidBlockHeight;
        closeDialog('mobile-wallet-dialog');
        return signed;
      } catch (error) {
        const label = document.querySelector('#mobile-wallet-qr-label');
        if (label) label.textContent = error.message;
        throw error;
      }
    },
    async reportTradeSubmission(signature){
      if (!pendingTradeFlow) return;
      const flow = pendingTradeFlow;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const response = await fetch(`/api/mobile-wallet/trade-status/${flow.id}`, { method:'POST', headers:{ 'content-type':'application/json', 'x-mobile-wallet-token':flow.pollToken }, body:JSON.stringify({ signature }) });
          if (response.ok) return;
        } catch { /* Retry a transient relay failure. */ }
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500));
      }
      throw new Error('Could not update the phone with the Devnet transaction signature.');
    },
    async signMessage(message){
      if (!provider.isConnected) throw new Error('Reconnect the mobile wallet before signing.');
      const bytes = message instanceof Uint8Array ? message : new Uint8Array(message);
      const statement = new TextDecoder('utf-8', { fatal:true }).decode(bytes);
      const flow = await registerMobileWalletFlow({ message:statement, publicKey:session.publicKey });
      const version = ++mobileWalletRequestVersion;
      const signerUrl = `${window.location.origin}/api/mobile-wallet/sign/${flow.id}`;
      const browseLink = `https://phantom.app/ul/browse/${encodeURIComponent(signerUrl)}?ref=${encodeURIComponent(window.location.origin)}`;
      showMobileWalletRequest(browseLink, 'sign-fallback');
      try {
        const signed = await waitForMobileWalletFlow(flow, version);
        const signature = verifyPhantomMobileSignature(bytes, signed.signature, session.publicKey);
        closeDialog('mobile-wallet-dialog');
        return { signature };
      } catch (error) { document.querySelector('#mobile-wallet-qr-label').textContent = error.message; throw error; }
    },
    async disconnect(){ provider.isConnected = false; sessionStorage.removeItem(MOBILE_WALLET_SESSION_KEY); },
  };
  return provider;
}
async function openMobileWalletDialog(){
  if (window.location.protocol !== 'https:') { showToast('Use the hosted HTTPS site to connect Phantom on your phone.'); return; }
  try {
    const flow = await registerMobileWalletFlow();
    const version = ++mobileWalletRequestVersion;
    const keyPair = nacl.box.keyPair();
    const link = new URL('https://phantom.app/ul/v1/connect');
    link.search = new URLSearchParams({ app_url:window.location.origin, dapp_encryption_public_key:bs58.encode(keyPair.publicKey), redirect_link:flow.callbackUrl, cluster:'devnet' }).toString();
    showMobileWalletRequest(link.toString(), 'connect');
    const result = await waitForMobileWalletFlow(flow, version);
    if (result.errorCode) throw new Error(result.errorMessage || 'Phantom connection was cancelled.');
    if (!result.phantom_encryption_public_key || bs58.decode(result.phantom_encryption_public_key).length !== 32) throw new Error('Phantom did not return an encryption key.');
    const sharedSecret = nacl.box.before(bs58.decode(result.phantom_encryption_public_key), keyPair.secretKey);
    const approved = decryptPhantomMobileResult(result, sharedSecret);
    const session = verifyPhantomMobileSession({ publicKey:approved.public_key, session:approved.session, secretKey:bs58.encode(keyPair.secretKey), phantomPublicKey:result.phantom_encryption_public_key }, window.location.origin);
    const provider = await createMobileWalletProvider(session);
    sessionStorage.setItem(MOBILE_WALLET_SESSION_KEY, JSON.stringify(session));
    allowWalletReconnect();
    activateWallet(provider, 'Phantom mobile wallet connected');
    closeDialog('mobile-wallet-dialog');
    showToast('Phantom wallet connected on desktop');
  } catch (error) { const label=document.querySelector('#mobile-wallet-qr-label'); if(label?.closest('dialog')?.open)label.textContent=error.message; showToast(error.message || 'Phantom connection failed.'); }
}
async function restoreMobileWallet(){
  if (wallet || wasWalletManuallyDisconnected()) return false;
  try { const stored=JSON.parse(sessionStorage.getItem(MOBILE_WALLET_SESSION_KEY)||'null'); if(!stored)return false; activateWallet(await createMobileWalletProvider(stored), 'Phantom mobile wallet restored'); return true; }
  catch { sessionStorage.removeItem(MOBILE_WALLET_SESSION_KEY); return false; }
}
function setTradeStatus(message, error = false){ const node = document.querySelector('#trade-status'); if (node) { node.textContent = message; node.className = `field-help ${error ? 'funded-mint-invalid' : ''}`; } }
function tradeBalanceKey(){
  const session = captureWalletSession();
  const mint = document.querySelector('#trade-mint')?.value.trim();
  return session && mint ? `${session.address}:${mint}` : '';
}
function resetTradeBalances(){
  tradeBalanceRequest++;
  tradeBalanceState = { key:'', solLamports:null, tokenRaw:null, tokenDecimals:0 };
  renderTradeBalances();
}
function renderTradeBalances(){
  const node = document.querySelector('#trade-wallet-balance');
  if (!node) return;
  const warning = document.querySelector('#trade-balance-warning');
  const side = document.querySelector('#trade-side')?.value;
  const current = Boolean(tradeBalanceState.key && tradeBalanceState.key === tradeBalanceKey());
  const symbol = coinTradeEstimate?.symbol || document.querySelector('#coin-symbol')?.textContent?.trim() || 'token';
  if (!wallet) node.textContent = 'Connect wallet';
  else if (!current) node.textContent = 'Checking balance…';
  else if (side === 'sell') node.textContent = tradeBalanceState.tokenRaw == null ? 'Balance unavailable' : `${formatTradeAmountInput(formatTokenBaseAmount(tradeBalanceState.tokenRaw, tradeBalanceState.tokenDecimals, Math.min(9, tradeBalanceState.tokenDecimals)))} ${symbol}`;
  else node.textContent = tradeBalanceState.solLamports == null ? 'Balance unavailable' : `${formatTradeAmountInput(formatTokenBaseAmount(tradeBalanceState.solLamports, 9, 6))} SOL`;
  document.querySelectorAll('[data-coin-sell-percent]').forEach(button => { button.disabled = !current || tradeBalanceState.tokenRaw == null || tradeBalanceState.tokenRaw <= 0n; });
  const amount = parseTradeAmountInput(document.querySelector('#trade-amount')?.value);
  const insufficient = current && Number.isFinite(amount) && amount > 0 && (side === 'buy'
    ? tradeBalanceState.solLamports != null && Math.ceil(amount * 1_000_000_000) >= tradeBalanceState.solLamports
    : tradeBalanceState.tokenRaw != null && amount > Number(tradeBalanceState.tokenRaw) / (10 ** tradeBalanceState.tokenDecimals));
  if (warning) { warning.hidden = !insufficient; warning.textContent = side === 'buy' ? 'Insufficient SOL for this amount and trade fees.' : `Insufficient ${symbol} balance.`; }
  updateTradeActionState();
}
async function refreshTradeBalances(){
  const key = tradeBalanceKey();
  const session = captureWalletSession();
  const mint = document.querySelector('#trade-mint')?.value.trim();
  if (!key || !session || !mint) { resetTradeBalances(); return; }
  const request = ++tradeBalanceRequest;
  tradeBalanceState = { key, solLamports:null, tokenRaw:null, tokenDecimals:coinTradeEstimate?.mint === mint ? coinTradeEstimate.decimals : 0 };
  renderTradeBalances();
  try {
    const { PublicKey } = await getSolana();
    const rpc = await getExploreConnection();
    const [sol, tokens] = await Promise.allSettled([
      rpc.getBalance(session.provider.publicKey, 'confirmed'),
      rpc.getParsedTokenAccountsByOwner(session.provider.publicKey, { mint:new PublicKey(mint) }, 'confirmed'),
    ]);
    if (request !== tradeBalanceRequest || !isWalletSessionCurrent(session) || key !== tradeBalanceKey()) return;
    const accounts = tokens.status === 'fulfilled' ? tokens.value.value : [];
    const parsed = accounts.map(account => account.account.data.parsed?.info?.tokenAmount).filter(Boolean);
    tradeBalanceState = {
      key,
      solLamports:sol.status === 'fulfilled' ? BigInt(sol.value) : null,
      tokenRaw:tokens.status === 'fulfilled' ? parsed.reduce((total, token) => total + BigInt(token.amount), 0n) : null,
      tokenDecimals:parsed.length ? Number(parsed[0].decimals) : coinTradeEstimate?.mint === mint ? coinTradeEstimate.decimals : 0,
    };
  } catch {
    if (request !== tradeBalanceRequest || key !== tradeBalanceKey()) return;
    tradeBalanceState = { key, solLamports:null, tokenRaw:null, tokenDecimals:0 };
  }
  renderTradeBalances();
}
function formatTradeEstimateAmount(value){
  if (!Number.isFinite(value)) return '—';
  const digits = value < 0.01 ? 9 : value < 1 ? 6 : 4;
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}
function renderTradeAmountEstimate(){
  const card = document.querySelector('#trade-live-estimate');
  const amountNode = document.querySelector('#trade-live-amount');
  const detailNode = document.querySelector('#trade-live-detail');
  if (!card || !amountNode || !detailNode) return;
  const side = document.querySelector('#trade-side')?.value;
  card.hidden = false;
  card.querySelector('span').textContent = side === 'sell' ? 'Estimated SOL received' : 'Estimated tokens received';
  const amountSol = parseTradeAmountInput(document.querySelector('#trade-amount')?.value);
  const mint = document.querySelector('#trade-mint')?.value.trim();
  const input = tradeInputs();
  const session = captureWalletSession();
  if (tradePreview?.inputKey === `${input.mint}:${input.side}:${input.amount}:${input.slippagePercent}:${session?.address || ''}` && Date.now() - tradePreview.preparedAt < 15_000) return;
  card.classList.remove('is-ready', 'is-unavailable');
  if (side === 'sell') {
    amountNode.textContent = Number.isFinite(amountSol) && amountSol > 0 ? wallet ? 'Calculating SOL…' : 'Connect wallet for quote' : 'Enter a token amount';
    detailNode.textContent = 'The live quote includes the app fee and slippage floor.';
    return;
  }
  if (!Number.isFinite(amountSol) || amountSol <= 0) {
    amountNode.textContent = 'Enter a SOL amount';
    detailNode.textContent = 'Your estimated token amount will appear here.';
    return;
  }
  if (!coinTradeEstimate || coinTradeEstimate.mint !== mint) {
    amountNode.textContent = 'Reading market reserves…';
    detailNode.textContent = 'The estimate appears after the on-chain snapshot is verified.';
    return;
  }
  try {
    const estimate = estimateBuyTokenAmountFromSnapshot({ amountSol, curveSnapshot: coinTradeEstimate.curve, graduatedPoolSnapshot: coinTradeEstimate.graduatedPool });
    amountNode.textContent = `≈ ${formatTradeEstimateAmount(estimate.expectedTokens)} ${coinTradeEstimate.symbol}`;
    detailNode.textContent = `${estimate.route === 'graduated-pool' ? 'PumpSwap pool' : 'Pump curve'} reserve estimate · A live quote adds fees and slippage.`;
    card.classList.add('is-ready');
  } catch (error) {
    amountNode.textContent = 'Estimate unavailable';
    detailNode.textContent = error.message;
    card.classList.add('is-unavailable');
  }
}
function updateTradeAmountLabel(){
  const side = document.querySelector('#trade-side')?.value;
  const panel = document.querySelector('#trade-panel');
  if (panel) panel.dataset.side = side;
  const label = document.querySelector('#trade-amount-heading');
  if (label) label.textContent = side === 'sell' ? 'Tokens to sell' : 'SOL to spend';
  const asset = document.querySelector('#trade-asset-symbol');
  if (asset) asset.textContent = side === 'sell' ? coinTradeEstimate?.symbol || document.querySelector('#coin-symbol')?.textContent?.trim() || 'Token' : '◎ SOL';
  const amount = document.querySelector('#trade-amount');
  if (amount) amount.placeholder = side === 'sell' ? '1,000' : '0.10';
  const presets = document.querySelector('#coin-quick-amounts');
  if (presets) presets.hidden = side === 'sell';
  const sellPresets = document.querySelector('#coin-sell-percentages');
  if (sellPresets) sellPresets.hidden = side !== 'sell';
  document.querySelectorAll('[data-coin-trade-side]').forEach(button => {
    const active = button.dataset.coinTradeSide === side;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const submit = document.querySelector('#trade-submit');
  if (submit) submit.textContent = side === 'sell' ? 'Approve Sell' : 'Approve Buy';
  renderTradeBalances();
  renderTradeAmountEstimate();
}
function tradeInputs(){
  const mint = document.querySelector('#trade-mint')?.value.trim() || '';
  const side = document.querySelector('#trade-side')?.value;
  const amount = parseTradeAmountInput(document.querySelector('#trade-amount')?.value);
  const slippagePercent = Number(document.querySelector('#trade-slippage')?.value);
  return { mint, side, amount, slippagePercent, valid: Boolean(mint && ['buy', 'sell'].includes(side) && Number.isFinite(amount) && amount > 0 && Number.isFinite(slippagePercent) && slippagePercent >= 0.1 && slippagePercent <= 10) };
}
function updateTradeActionState(){
  const submit = document.querySelector('#trade-submit');
  const { side, amount, valid } = tradeInputs();
  const current = Boolean(tradeBalanceState.key && tradeBalanceState.key === tradeBalanceKey());
  const insufficient = current && valid && (side === 'buy'
    ? tradeBalanceState.solLamports != null && Math.ceil(amount * 1_000_000_000) >= tradeBalanceState.solLamports
    : tradeBalanceState.tokenRaw != null && amount > Number(tradeBalanceState.tokenRaw) / (10 ** tradeBalanceState.tokenDecimals));
  if (submit) submit.disabled = tradeActionBusy || !valid || insufficient;
}
function invalidateTradePreview(){
  tradeQuoteVersion++;
  clearTimeout(tradeQuoteTimer);
  tradeQuoteTimer = null;
  tradePreview = null;
  const reviewDialog = document.querySelector('#trade-review-dialog');
  if (reviewDialog?.open) reviewDialog.close();
  const quote = document.querySelector('#trade-quote');
  if (quote) quote.textContent = !tradeInputs().valid ? 'Enter a positive amount to calculate the quote.' : !wallet ? 'Connect a signing wallet to calculate an exact trade quote.' : 'Calculating the current route, amount, slippage, and fees.';
  updateTradeActionState();
  renderTradeAmountEstimate();
}
function tradePreviewFailureMessage(error, side){
  const message = String(error?.message || error || 'Unknown error');
  if (side === 'sell' && /Associated token account not found for mint:/i.test(message)) {
    return 'Sell unavailable: this wallet has no token account for this mint. Connect a wallet that holds the token. No trade was submitted.';
  }
  return `Quote unavailable: ${message}`;
}
function queueTradeQuote(delay = 350){
  clearTimeout(tradeQuoteTimer);
  if (!tradeInputs().valid || !wallet || !canSignTransactions(wallet) || document.visibilityState === 'hidden' || document.querySelector('#trade-panel')?.hidden) return;
  tradeQuoteTimer = setTimeout(() => { void prepareTradeQuote().catch(() => {}); }, delay);
}
function refreshTradeQuoteWhenIdle(version){
  if (version !== tradeQuoteVersion) return;
  if (document.querySelector('#trade-review-dialog')?.open || tradeActionBusy) {
    tradeQuoteTimer = setTimeout(() => refreshTradeQuoteWhenIdle(version), 1000);
    return;
  }
  invalidateTradePreview();
  queueTradeQuote(0);
}
async function prepareTradeQuote({ connectIfNeeded = false } = {}){
  const { mint, side, amount, slippagePercent, valid } = tradeInputs();
  if (!valid) throw new Error('Enter a positive amount and slippage between 0.1% and 10%.');
  if (!wallet && connectIfNeeded) await connectWallet();
  const session = captureWalletSession();
  if (!session || !canSignTransactions(session.provider)) throw new Error('Connect a signing wallet to calculate the trade quote.');
  const inputKey = `${mint}:${side}:${amount}:${slippagePercent}:${session.address}`;
  if (tradePreview?.inputKey === inputKey && Date.now() - tradePreview.preparedAt < 15_000) return tradePreview;
  if (tradeQuoteInFlight?.inputKey === inputKey && tradeQuoteInFlight.version === tradeQuoteVersion) return tradeQuoteInFlight.promise;
  const version = tradeQuoteVersion;
  const request = (async () => {
    setTradeStatus('Calculating the current on-chain quote…');
    const previewConnection = await getTradePreviewConnection();
    assertWalletSessionCurrent(session);
    const trade = await buildTradeTransaction({ connection: previewConnection, side, mint, user: session.provider.publicKey, amount, slippagePercent, feeOwner: TRADE_FEE_OWNER, feeBps: TRADE_FEE_BPS });
    assertWalletSessionCurrent(session);
    if (version !== tradeQuoteVersion || !tradeInputs().valid || `${tradeInputs().mint}:${tradeInputs().side}:${tradeInputs().amount}:${tradeInputs().slippagePercent}:${session.address}` !== inputKey) return null;
    const quote = describeTradeQuote(trade, slippagePercent);
    if (side === 'sell' && quote.minimumNetSol <= 0) throw new Error('The app fee would exceed the minimum SOL output. Increase the sell amount.');
    tradePreview = { trade, inputKey, preparedAt: Date.now() };
    const outputDigits = quote.outputSymbol === 'SOL' ? 9 : 6;
    const receiveText = `${quote.expected.toLocaleString('en-US', { maximumFractionDigits: outputDigits })} ${quote.outputSymbol}`;
    const estimateCard = document.querySelector('#trade-live-estimate');
    estimateCard.querySelector('span').textContent = side === 'sell' ? 'Estimated SOL to wallet' : 'Estimated tokens received';
    document.querySelector('#trade-live-amount').textContent = `≈ ${side === 'sell' ? `${quote.expectedNetSol.toLocaleString('en-US', { maximumFractionDigits:9 })} SOL` : receiveText}`;
    document.querySelector('#trade-live-detail').textContent = side === 'sell'
      ? `After app fee · minimum after ${slippagePercent}% slippage: ${quote.minimumNetSol.toLocaleString('en-US', { maximumFractionDigits:9 })} SOL · network fee additional · quote expires in 15 seconds.`
      : `Minimum after ${slippagePercent}% slippage: ${quote.minimum.toLocaleString('en-US', { maximumFractionDigits:outputDigits })} ${quote.outputSymbol} · quote expires in 15 seconds.`;
    estimateCard.classList.add('is-ready');
    const slippageText = quote.maximumSpendSol != null
      ? `Quoted receive: ${receiveText}. Maximum pool spend: ${quote.maximumSpendSol.toFixed(9)} SOL with ${slippagePercent}% slippage.`
      : side === 'sell'
        ? `Gross Pump output: ${receiveText}. Estimated to wallet after app fee: ${quote.expectedNetSol.toLocaleString('en-US', { maximumFractionDigits:9 })} SOL. Minimum after slippage and app fee: ${quote.minimumNetSol.toLocaleString('en-US', { maximumFractionDigits:9 })} SOL.`
        : `Estimated receive: ${receiveText}. Slippage floor: ${quote.minimum.toLocaleString('en-US', { maximumFractionDigits: outputDigits })} ${quote.outputSymbol}.`;
    const feeText = quote.maximumSpendSol != null
      ? `Maximum pool spend includes Pump pool fees. App fee: ${quote.appFeeSol.toFixed(9)} SOL, plus network/account costs.`
      : `App fee: ${quote.appFeeSol.toFixed(9)} SOL, plus network and Pump fees.`;
    document.querySelector('#trade-quote').textContent = `${quote.route === 'graduated-pool' ? 'Graduated pool' : 'Pump curve'} · ${slippageText} ${feeText} Quote expires in 15 seconds.`;
    setTradeStatus('Review this quote and the transaction in your wallet before signing.');
    tradeQuoteTimer = setTimeout(() => refreshTradeQuoteWhenIdle(version), 12_000);
    return tradePreview;
  })();
  tradeQuoteInFlight = { inputKey, version, promise:request };
  try { return await request; }
  catch (error) {
    if (version === tradeQuoteVersion && isWalletSessionCurrent(session)) {
      tradePreview = null;
      const card = document.querySelector('#trade-live-estimate');
      card?.classList.add('is-unavailable');
      document.querySelector('#trade-live-amount').textContent = 'Quote unavailable';
      document.querySelector('#trade-live-detail').textContent = error.message;
      document.querySelector('#trade-quote').textContent = tradePreviewFailureMessage(error, side);
      setTradeStatus(tradePreviewFailureMessage(error, side), true);
    }
    throw error;
  } finally { if (tradeQuoteInFlight?.promise === request) tradeQuoteInFlight = null; }
}
async function openTradeReview(){
  if (tradeActionBusy) return;
  const { mint, side, amount, slippagePercent, valid } = tradeInputs();
  if (!valid) return setTradeStatus('Enter a positive amount and slippage between 0.1% and 10%.', true);
  tradeActionBusy = true;
  updateTradeActionState();
  const version = tradeQuoteVersion;
  try {
    const prepared = await prepareTradeQuote({ connectIfNeeded:true });
    if (!prepared) return;
    const session = captureWalletSession();
    const inputKey = `${mint}:${side}:${amount}:${slippagePercent}:${session?.address || ''}`;
    if (!session || prepared.inputKey !== inputKey || Date.now() - prepared.preparedAt > 15_000) return;
    const shownCoin = getCoinMintAddress() === mint;
    const review = buildTradeReview({ trade:prepared.trade, side, amount, slippagePercent, mint, wallet:session.address,
      tokenName:shownCoin ? document.querySelector('#coin-page-title')?.textContent?.trim() : '',
      tokenSymbol:shownCoin ? document.querySelector('#coin-symbol')?.textContent?.trim() : '' });
    const fields = {
      '#trade-review-title':review.title, '#trade-review-token-name':review.tokenName,
      '#trade-review-pay-label':review.payLabel, '#trade-review-pay':review.payAmount,
      '#trade-review-receive-label':review.receiveLabel, '#trade-review-receive':review.receiveAmount,
      '#trade-review-limit-label':review.limitLabel, '#trade-review-limit':review.limitAmount,
      '#trade-review-minimum-label':review.minimumLabel, '#trade-review-minimum':review.minimumAmount,
      '#trade-review-slippage':review.slippage, '#trade-review-fee':review.fee,
      '#trade-review-route':review.route, '#trade-review-mint':review.mint, '#trade-review-wallet':review.wallet,
      '#trade-review-note':review.note, '#trade-review-confirm':review.confirmLabel,
    };
    for (const [selector, value] of Object.entries(fields)) document.querySelector(selector).textContent = value;
    document.querySelector('#trade-review-minimum-row').hidden = !review.minimumLabel;
    document.querySelector('#trade-review-dialog').dataset.side = side;
    document.querySelector('#trade-review-dialog').showModal();
  } catch (error) { if (version === tradeQuoteVersion) setTradeStatus(tradePreviewFailureMessage(error, side), true); }
  finally { tradeActionBusy = false; updateTradeActionState(); }
}
async function executeTrade(){
  if (!wallet) return setTradeStatus('Connect a signing wallet to trade.', true);
  const session = captureWalletSession();
  if (!session || !canSignTransactions(session.provider)) return setTradeStatus('Open this app in a signing wallet to trade.', true);
  const mint = document.querySelector('#trade-mint').value.trim(); const side = document.querySelector('#trade-side').value;
  const amount = parseTradeAmountInput(document.querySelector('#trade-amount').value); const slippagePercent = Number(document.querySelector('#trade-slippage').value);
  if (!mint || !Number.isFinite(amount) || amount <= 0) { setTradeStatus('Enter a valid mint and positive trade amount.', true); return; }
  if (!TRADE_FEE_OWNER) { setTradeStatus('Trading is disabled: configure VITE_FUNDED_TRADE_FEE_OWNER for the app owner.', true); return; }
  const inputKey = `${mint}:${side}:${amount}:${slippagePercent}:${session.address}`;
  if (!tradePreview || tradePreview.inputKey !== inputKey || Date.now() - tradePreview.preparedAt > 15_000) {
    invalidateTradePreview();
    setTradeStatus('The quote changed or expired. Calculating a new quote for review.');
    await openTradeReview();
    return;
  }
  clearTimeout(tradeQuoteTimer);
  tradeActionBusy = true;
  updateTradeActionState();
  try {
    const activeConnection = connection || (await getSolana(), connection);
    assertWalletSessionCurrent(session);
    const shownCoin = getCoinMintAddress() === mint;
    const result = await submitTrade({ connection: activeConnection, provider: session.provider, side, mint, user: session.provider.publicKey, amount, slippagePercent, feeOwner: TRADE_FEE_OWNER, feeBps: TRADE_FEE_BPS, preparedTrade: tradePreview.trade, tokenName:shownCoin ? document.querySelector('#coin-page-title')?.textContent?.trim() : '', tokenSymbol:shownCoin ? document.querySelector('#coin-symbol')?.textContent?.trim() : '', assertWalletCurrent: () => assertWalletSessionCurrent(session), onStatus: message => { if (isWalletSessionCurrent(session)) setTradeStatus(message); } });
    if (!isWalletSessionCurrent(session)) return;
    setTradeStatus(`${side === 'buy' ? 'Buy' : 'Sell'} confirmed: ${result.signature}. App fee: ${(result.feeLamports / 1_000_000_000).toFixed(6)} SOL.`);
    if (getCoinMintAddress() === mint) void loadCoinOnChain(mint);
    showToast(`${side === 'buy' ? 'Buy' : 'Sell'} confirmed on Devnet`); refreshWalletInfo();
    void refreshTradeBalances();
  } catch (error) { if (isWalletSessionCurrent(session)) setTradeStatus(`Trade failed or confirmation unavailable: ${error.message}`, true); } finally {
    tradeActionBusy = false;
    if (isWalletSessionCurrent(session)) { invalidateTradePreview(); queueTradeQuote(); }
  }
}
const infoDialogRoutes = new Set(['terms', 'disclosures', 'opt-out']);
function openInfoDialog(kind, { routeDriven = false } = {}){
  const content = {
    terms: ['Terms of Use', '<div class="legal-meta"><span>Effective 18 Sep 2026</span><span>Version 1.0</span><span>Applies to funded.vip Devnet tools</span></div><p>Use the Devnet launcher for testing only. You are responsible for reviewing every transaction before signing and for complying with applicable rules.</p><h3>Contents</h3><ul class="legal-list"><li>Wallet connection and signatures</li><li>Token metadata and deployer responsibility</li><li>Network, fees, and transaction confirmation</li><li>Prohibited use and service limitations</li><li>Privacy, disclosures, and support</li></ul><p class="muted-note">This is a product disclosure for the local build, not legal advice or a production agreement.</p>'],
    disclosures: ['Disclosures', '<div class="legal-meta"><span>Effective 23 Sep 2026</span><span>Version 1.5</span><span>Applies to the Devnet preview</span></div><p>The Pump Devnet flow creates the coin with the verified funded.vip router PDA written directly into Pump’s creator field. The paying wallet never receives creator-fee authority, and the app reads the bonding curve back before reporting success.</p><h3>Important limits</h3><ul class="legal-list"><li>Devnet SOL has no intended monetary value.</li><li>This Devnet deployment indexes finalized receipts. Automatic creator and holder SOL delivery requires verified funding and an active healthy distribution worker; holder payouts also require complete finalized indexing. Check the live status on Home before relying on delivery. Referral rewards remain wallet-initiated claims.</li><li>Mainnet contracts, audited production treasury controls, X recipient verification, and community-token distribution are not enabled.</li><li>Pump protocol administrators or a future Pump program upgrade remain outside funded.vip’s control.</li><li>funded.vip is not affiliated with X, Phantom, or Pump.fun.</li></ul><p class="muted-note">Verify the Pump creator address in the launch transaction and bonding-curve account on Solana Explorer.</p>'],
    capital: ['Capital flow', '<p>This calculator illustrates the published allocation policy. Confirmed launch, collection, and payout records appear in the verified workspace pages when the Devnet indexer has recorded them.</p>'],
  'opt-out': ['Opt out', '<div class="legal-meta"><span>Account controls</span><span>Devnet preview</span></div><p>The Devnet deployment indexes launch and reward activity, but account-level discovery exclusions require verified X identity and are not available yet.</p><div class="optout-steps"><div><b>1</b><span><strong>Sign in with X</strong><small>Verify control of the account you want to manage.</small></span></div><div><b>2</b><span><strong>Choose exclusions</strong><small>Request exclusion from future discovery and recipient selection.</small></span></div><div><b>3</b><span><strong>Review status</strong><small>Confirm the effective date; finalized receipts and existing entitlements remain on record.</small></span></div></div><button type="button" class="secondary-button info-action" disabled>Opt-out requests unavailable</button><p class="muted-note">X sign-in and indexed exclusion requests are not connected in this Devnet build.</p>'],
  }[kind] || ['Information', '<p>Explore the funded.vip workspace and review each transaction before signing.</p>'];
  document.querySelector('#info-title').textContent = content[0];
  document.querySelector('#info-content').innerHTML = content[1];
  const dialog = document.querySelector('#info-dialog');
  dialog.dataset.infoKind = kind;
  dialog.dataset.routeDriven = routeDriven ? 'true' : 'false';
  if (!dialog.open) dialog.showModal();
}
function closeInfoDialog(){
  const dialog = document.querySelector('#info-dialog');
  const routeDriven = dialog.dataset.routeDriven === 'true';
  dialog.close();
  delete dialog.dataset.infoKind;
  delete dialog.dataset.routeDriven;
  const hash = location.hash.replace(/^#/, '');
  if (routeDriven && infoDialogRoutes.has(hash)) {
    history.replaceState({}, '', `${location.pathname}${location.search}#overview`);
    syncPageRoute();
  }
}
function openFilterDialog(button){
  const label = button.textContent.replace('⌄', '').trim();
  const choices = {
    'Market cap': ['Any market cap', 'Under $1M', '$1M–$10M', 'Over $10M'],
    'Flow direction': ['All flow', 'Funds in', 'Funds out', 'New positions'],
  }[label] || ['All'];
  document.querySelector('#filter-title').textContent = label;
  const options = document.querySelector('#filter-options');
  options.replaceChildren(...choices.map(choice => { const item = document.createElement('button'); item.type = 'button'; item.textContent = choice; item.addEventListener('click', () => { button.childNodes[0].textContent = `${choice} `; document.querySelector('#filter-dialog').close(); showToast(`${choice} filter selected`); }); return item; }));
  document.querySelector('#filter-dialog').showModal();
}
function closeDialog(id){
  const dialog = document.querySelector(`#${id}`);
  if (dialog?.open && typeof dialog.close === 'function') dialog.close();
}
function injectedWalletProviders(){
  return [
    { id: 'phantom', provider: window.phantom?.solana },
    { id: 'backpack', provider: window.backpack?.solana },
    { id: 'solflare', provider: window.solflare },
    { id: 'legacy', provider: window.solana },
  ].filter(entry => entry.provider);
}
function rememberedWalletProviderId(){
  try { return sessionStorage.getItem(WALLET_PROVIDER_KEY); } catch { return null; }
}
function getProvider(){
  return selectRememberedWalletProvider(injectedWalletProviders(), rememberedWalletProviderId());
}
async function restoreTrustedPhantomWallet(){
  const provider = window.phantom?.solana;
  const remembered = rememberedWalletProviderId();
  const chosenPhantom = !remembered || remembered === 'phantom' || (remembered === 'legacy' && window.solana === provider)
    || !injectedWalletProviders().some(entry => entry.id === remembered);
  if (!provider?.isPhantom || !chosenPhantom || wasWalletManuallyDisconnected() || wallet) return false;
  observeWalletProvider(provider);
  const request = ++walletConnectRequest;
  let timeout;
  try {
    const connected = await Promise.race([
      connectWalletProvider(provider, { onlyIfTrusted: true }),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Trusted wallet reconnection timed out.')), 3000); }),
    ]);
    if (request !== walletConnectRequest || wasWalletManuallyDisconnected() || wallet) return false;
    activateWallet(connected.provider);
    return true;
  } catch { return false; }
  finally { clearTimeout(timeout); }
}
function captureWalletSession(){
  return wallet && connectedWalletAddress ? { provider: wallet, address: connectedWalletAddress, version: walletVersion } : null;
}
function isWalletSessionCurrent(session){
  return Boolean(session && wallet === session.provider && walletVersion === session.version
    && wallet.isConnected !== false && connectedWalletAddress === session.address && walletAddress(wallet) === session.address);
}
function wasWalletManuallyDisconnected(){
  try { return walletDisconnectRequested || sessionStorage.getItem(WALLET_MANUAL_DISCONNECT_KEY) === '1'; }
  catch { return walletDisconnectRequested; }
}
function markWalletManuallyDisconnected(){
  walletDisconnectRequested = true;
  try { sessionStorage.setItem(WALLET_MANUAL_DISCONNECT_KEY, '1'); } catch {}
}
function allowWalletReconnect(){
  walletDisconnectRequested = false;
  try { sessionStorage.removeItem(WALLET_MANUAL_DISCONNECT_KEY); } catch {}
}
function assertWalletSessionCurrent(session){
  if (!isWalletSessionCurrent(session)) throw new Error('Wallet account changed. Review and retry with the connected account.');
}
function resetWalletDependentViews(){
  const previousChatToken = coinChatSession?.token;
  coinChatSession = null;
  coinChatSessionPromise = null;
  if (previousChatToken) {
    try { sessionStorage.removeItem(COIN_CHAT_SESSION_KEY); } catch {}
    void apiRequest('/api/token-chat/session/revoke', { method: 'POST', headers: { 'x-token-chat-session': previousChatToken } }).catch(() => {});
  }
  metricsRequest++;
  fundedBurnRequest++;
  fundedBurnState = { status: 'idle', wallet: null, decimals: 0, balanceBaseUnits: 0n, supplyBaseUnits: 0n, burnedBaseUnits: 0n, tokenAccounts: [], receipts: [], message: 'Connect a wallet to load its Devnet balance.' };
  renderWalletFundedBalance();
  clearTimeout(launchCostRefreshTimer);
  launchCostRefreshTimer = null;
  walletBalanceLamports = null;
  estimatedLaunchFeeLamports = null;
  resetTradeBalances();
  invalidateTradePreview();
  renderReferralClaimPrompt();
  for (const id of ['referral-active-creators', 'referral-conversion-rate']) {
    const node = document.querySelector(`#${id}`); if (node) node.textContent = '—';
  }
  for (const id of ['referral-total-claimable', 'referral-paid-total']) {
    const node = document.querySelector(`#${id}`); if (node) node.textContent = '— SOL';
  }
  const ledger = document.querySelector('#referral-ledger-list');
  if (ledger) ledger.replaceChildren();
  const claimStatus = document.querySelector('#sol-claim-status');
  if (claimStatus) claimStatus.textContent = '';
}
function observeWalletProvider(provider){
  if (!provider?.on || observedWalletProviders.has(provider)) return;
  observedWalletProviders.add(provider);
  provider.on('connect', () => { if (!wallet && !wasWalletManuallyDisconnected() && provider.isConnected && walletAddress(provider)) activateWallet(provider); });
  provider.on('disconnect', () => { if (wallet === provider) { markWalletManuallyDisconnected(); clearWalletState(); } });
  provider.on('accountChanged', publicKey => handleAccountChanged(provider, publicKey));
}
function activateWallet(provider, message = 'Wallet connected'){
  if (APP_MAINNET_READ_ONLY) return;
  const address = walletAddress(provider);
  if (!address) throw new Error('Wallet did not provide an account address.');
  if (wallet === provider && connectedWalletAddress === address) return;
  walletConnectRequest++;
  walletVersion++;
  resetWalletDependentViews();
  wallet = provider;
  connectedWalletAddress = address;
  restoreCoinChatSession(address);
  const providerId = injectedWalletProviders().find(entry => entry.provider === provider)?.id;
  if (providerId) { try { sessionStorage.setItem(WALLET_PROVIDER_KEY, providerId); } catch {} }
  observeWalletProvider(provider);
  setWalletState(message, address, true);
  void refreshTradeBalances();
  queueTradeQuote();
}
function clearWalletState(message = 'Wallet not connected', detail = 'Connect a wallet to continue'){
  walletConnectRequest++;
  walletVersion++;
  resetWalletDependentViews();
  try { sessionStorage.removeItem(COIN_CHAT_SESSION_KEY); } catch {}
  wallet = null;
  connectedWalletAddress = null;
  renderTradeBalances();
  setWalletState(message, detail);
  setLaunchStatus('');
}
function normalizePreviewLabels(){
  const replacements = new Map([
    ['Solana only', 'Preview route'],
    ['Solana claims', 'Claims'],
    ['Open Devnet trading ↗', 'Open trading ↗'],
    ['Get 1 Devnet SOL', 'Get test funds'],
  ]);
  document.querySelectorAll('button, .panel-count, .data-badge, .eyebrow').forEach(node => {
    const replacement = replacements.get(node.textContent.trim());
    if (replacement) node.textContent = replacement;
  });
}
function bytesToBase64(bytes){ let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }
function base64ToBytes(value){ const binary = atob(value); return Uint8Array.from(binary, character => character.charCodeAt(0)); }
async function connectDevWallet(){
  const injectedProvider = getProvider();
  if (!DEV_MODE || !DEV_WALLET_AUTOCONNECT || wasWalletManuallyDisconnected() || (injectedProvider?.isConnected && injectedProvider.publicKey)) return false;
  try {
    const result = await apiRequest('/api/dev-wallet');
    const { PublicKey, Transaction } = await getSolana();
    const publicKey = new PublicKey(result.data.publicKey);
    const devProvider = {
      devMode: true,
      publicKey,
      isConnected: true,
      signTransaction: async transaction => {
        const signed = await apiRequest('/api/dev-wallet/sign-transaction', { method: 'POST', body: { transaction: bytesToBase64(transaction.serialize({ requireAllSignatures: false, verifySignatures: false })) } });
        return Transaction.from(base64ToBytes(signed.data.transaction));
      },
      signMessage: async message => {
        const signed = await apiRequest('/api/dev-wallet/sign-message', { method: 'POST', body: { message: bytesToBase64(message) } });
        return base64ToBytes(signed.data.signature);
      },
      disconnect: async () => {},
    };
    activateWallet(devProvider, 'Dev wallet connected');
    setLaunchStatus(`Development wallet ready: ${DEV_WALLET_ROLE}`);
    return true;
  } catch { return false; }
}
function setLaunchStatus(message, error = false){ const node = document.querySelector('#launch-status'); node.textContent = message; node.className = `launch-status${error ? ' error' : message ? ' success' : ''}`; }
function setLaunchLinks(message, links, error = false){
  const node = document.querySelector('#launch-status');
  node.replaceChildren(document.createTextNode(message));
  for (const link of links) {
    node.append(document.createTextNode('\n'));
    const anchor = document.createElement('a');
    anchor.href = link.href;
    if (!link.href.startsWith('#')) { anchor.target = '_blank'; anchor.rel = 'noreferrer'; }
    anchor.textContent = link.label;
    node.append(anchor);
  }
  node.className = `launch-status${error ? ' error' : ' success'}`;
}
function formatSol(lamports){ return `${(Number(lamports) / 1_000_000_000).toFixed(4)} SOL`; }
function formatLaunchCost(lamports){ return `${(Number(lamports) / 1_000_000_000).toFixed(6)} SOL`; }
function formatLaunchBurnAmount(amount){ return Number(amount || 0).toLocaleString(); }
function renderLaunchBurnSelection(){
  const policy = getLaunchBurnPolicy();
  document.querySelectorAll('[data-burn-tier]').forEach(button => {
    const active = button.dataset.burnTier === policy.tier;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
    const tier = LAUNCH_BURN_TIERS.find(item => item.id === button.dataset.burnTier);
    const action = button.querySelector('b');
    if (action && tier) action.textContent = active ? 'Selected' : tier.amountTokens ? `Select ${tier.label}` : 'Included';
  });
  const boost = LAUNCH_BURN_TIERS.find(item => item.id === 'boost');
  const pro = LAUNCH_BURN_TIERS.find(item => item.id === 'pro');
  const premier = LAUNCH_BURN_TIERS.find(item => item.id === 'premier');
  const boostAmount = document.querySelector('#boost-burn-amount');
  const proAmount = document.querySelector('#pro-burn-amount');
  const premierAmount = document.querySelector('#premier-burn-amount');
  if (boostAmount) boostAmount.textContent = `${formatLaunchBurnAmount(boost.amountTokens)} $FUNDED`;
  if (proAmount) proAmount.textContent = `${formatLaunchBurnAmount(pro.amountTokens)} $FUNDED`;
  if (premierAmount) premierAmount.textContent = `${formatLaunchBurnAmount(premier.amountTokens)} $FUNDED`;
  const status = document.querySelector('#creator-burn-status');
  if (status) {
    const configured = validateLaunchBurnPolicy(policy).valid;
    const ready = !policy.requiresBurn || (configured && launchBurnReadiness.ready);
    status.className = `creator-burn-status ${ready ? 'ready' : 'blocked'}`;
    status.innerHTML = ready
      ? `<span>✓</span><p><strong>${policy.label} selected.</strong> ${policy.requiresBurn ? launchBurnReadiness.message : 'No creator-funded burn is required.'}</p>`
      : `<span>!</span><p><strong>${policy.label} cannot launch yet.</strong> ${configured ? launchBurnReadiness.message : 'The protocol $FUNDED mint is not configured, so this tier stays disabled.'}</p>`;
  }
}
function setLaunchBurnTier(tierId){
  launchBurnTier = LAUNCH_BURN_TIERS.some(item => item.id === tierId) ? tierId : 'standard';
  const policy = getLaunchBurnPolicy();
  launchBurnReadiness = policy.requiresBurn
    ? { ready: false, message: PROTOCOL_FUNDED_MINT ? wallet ? 'Checking the connected wallet’s $FUNDED balance…' : 'Connect a wallet to verify its $FUNDED balance.' : 'The fixed $FUNDED mint is not configured.' }
    : { ready: true, message: 'No creator-funded burn is required.' };
  estimatedLaunchFeeLamports = null;
  renderLaunchBurnSelection();
  updateLaunchPreview();
  if (wallet) scheduleLaunchCostRefresh();
  else { updateCostSummary(); updateLaunchButton(); }
}
function updateCostSummary(){
  renderLaunchCostDetails();
  const launchNode = document.querySelector('#cost-launch');
  const totalNode = document.querySelector('#cost-total-enabled');
  const noteNode = document.querySelector('#cost-note');
  const previewLaunchNode = document.querySelector('#preview-launch-cost');
  const burnNode = document.querySelector('#cost-burn');
  const burnRow = document.querySelector('#cost-burn-row');
  const tierLabelNode = document.querySelector('#cost-tier-label');
  const creatorBuyNode = document.querySelector('#cost-creator-buy');
  const communityTokensNode = document.querySelector('#cost-community-tokens');
  const communityDetailNode = document.querySelector('#cost-community-detail');
  const summaryNode = document.querySelector('#cost-summary');
  const burnPolicy = getLaunchBurnPolicy();
  const creatorBuy = getCreatorBuySummary();
  const communityTokens = getCommunityAirdropTokens();
  const communityPercent = getCommunityAllocationPercent();
  if (communityTokensNode) communityTokensNode.textContent = Number.isFinite(communityTokens) ? communityTokens.toLocaleString() : '—';
  if (communityDetailNode) communityDetailNode.innerHTML = Number.isFinite(communityPercent)
    ? `<b>${communityPercent.toFixed(2)}% of supply</b> · planned $FUNDED-holder allocation · vault funding unverified`
    : '<b>Enter a valid airdrop amount</b>';
  if (burnNode) burnNode.textContent = burnPolicy.requiresBurn ? `${formatLaunchBurnAmount(burnPolicy.amountTokens)} $FUNDED` : '0 $FUNDED';
  if (burnRow) burnRow.hidden = !burnPolicy.requiresBurn;
  if (tierLabelNode) tierLabelNode.textContent = burnPolicy.requiresBurn ? burnPolicy.label.toUpperCase() : 'Platform launch fee: 0';
  if (summaryNode) summaryNode.classList.toggle('free-launch', !burnPolicy.requiresBurn);
  if (creatorBuyNode) creatorBuyNode.textContent = creatorBuy.sol > 0
    ? `${creatorBuy.sol.toLocaleString(undefined, { maximumFractionDigits: 9 })} SOL${creatorBuyExceedsWalletBalance() ? ' · insufficient SOL' : creatorBuy.tokens > 0 ? ` · ${Math.round(creatorBuy.tokens).toLocaleString()} tokens` : wallet ? ' · quote pending' : ' · connect wallet to quote'}`
    : 'None';
  if (!launchNode || !totalNode || !noteNode) return;
  if (estimatedLaunchFeeLamports == null) {
    const pending = !wallet ? 'Connect wallet to estimate' : walletMetricsLoading ? 'Calculating…' : 'Estimate unavailable';
    launchNode.textContent = pending;
    totalNode.textContent = '—';
    if (previewLaunchNode) previewLaunchNode.textContent = !wallet ? 'Connect wallet' : pending;
    noteNode.textContent = !wallet
      ? 'Connect a wallet to build and estimate the transaction.'
      : walletMetricsLoading
        ? 'Building and estimating the Devnet transaction…'
        : walletEstimateError
          ? `Could not estimate the transaction: ${walletEstimateError} Refresh the estimate to try again.`
          : 'The launch cost is not verified. Refresh the estimate before signing.';
    return;
  }
  const launchCost = formatLaunchCost(estimatedLaunchFeeLamports);
  const networkReserve = launchCostReview
    ? formatLaunchCost(Number(BigInt(launchCostReview.networkFee) + BigInt(launchCostReview.otherLaunchCosts)))
    : launchCost;
  launchNode.textContent = networkReserve;
  totalNode.textContent = launchCost;
  if (previewLaunchNode) previewLaunchNode.textContent = launchCost;
  noteNode.textContent = burnPolicy.requiresBurn
    ? 'Total includes network fees, account reserve, any creator buy with its 1% allowance, and the selected $FUNDED burn.'
    : 'The free tier has no $FUNDED burn. Total includes network fees, account reserve, and any creator buy with its 1% allowance.';
}
function renderLaunchCostDetails(){
  let node=document.querySelector('#launch-cost-details');
  if(!node){node=document.createElement('div');node.id='launch-cost-details';node.className='adoption-panel';document.querySelector('#cost-note')?.after(node);}
  node.innerHTML=launchReviewMarkup(launchCostReview);
}
setInterval(()=>{
  renderPendingLaunchReview();
  if(!launchCostReview)return;
  const launchPageActive=requestedPageRoute()==='launch';
  if(launchPageActive&&!document.hidden&&!walletMetricsLoading&&launchReviewNeedsRefresh(launchCostReview)){
    scheduleLaunchCostRefresh();
  }else if(launchPageActive)renderLaunchCostDetails();
},1000);
function updatePreviewStatusDrawer(connected){
  const drawer = document.querySelector('.preview-status-drawer');
  const detail = drawer?.querySelector('small');
  if (detail) detail.textContent = `Indexer pending · Wallet ${connected ? 'connected' : 'not connected'}`;
}
function setWalletMetrics({ balance = null, fee = null, loading = false, error = '' } = {}){
  walletMetricsLoading = loading;
  walletEstimateError = loading || !wallet ? '' : String(error || '');
  if (loading || !wallet || fee == null) { estimatedLaunchFeeLamports = null; estimatedInitialBuyLamports = 0; estimatedInitialBuyTokens = 0; launchCostReview = null; }
  if (!wallet) { walletBalanceLamports = null; estimatedLaunchFeeLamports = null; document.querySelector('#profile-balance').textContent = 'Connect to load'; updateCostSummary(); updateLaunchButton(); return; }
  if (!loading) { walletBalanceLamports = balance; estimatedLaunchFeeLamports = fee; }
  document.querySelector('#profile-balance').textContent = loading ? 'Loading…' : balance == null ? 'Unavailable' : formatSol(balance);
  const headerBalance = document.querySelector('#header-wallet-balance');
  const popoverBalance = document.querySelector('#wallet-popover-sol');
  const compactBalance = loading ? '…' : balance == null ? '—' : formatSol(balance).replace(/\s*SOL$/i, '');
  if (headerBalance) {
    headerBalance.textContent = compactBalance;
    const headerWallet = document.querySelector('#connect-button');
    if (headerWallet?.classList.contains('wallet-pill-connected')) {
      headerWallet.setAttribute('aria-label', `Wallet ${connectedWalletAddress.slice(0, 4)}…${connectedWalletAddress.slice(-4)}, ${compactBalance} SOL`);
    }
  }
  if (popoverBalance) popoverBalance.textContent = compactBalance;
  renderWalletDetail();
  updateLaunchButton();
  updateCostSummary();
}
function updateLaunchPreview(){
  const name = document.querySelector('#token-name').value.trim();
  const symbol = document.querySelector('#token-symbol').value.trim().toUpperCase();
  const allocation = getCommunityAllocationPercent();
  const communityTokens = getCommunityAirdropTokens();
  const feeDistribution = getFeeDistributionInputs();
  const launchBurn = getLaunchBurnPolicy();
  const creatorBuy = getCreatorBuySummary();
  document.querySelector('#preview-name').textContent = name || 'Token name';
  document.querySelector('#preview-symbol').textContent = symbol || 'TICKER';
  const description = document.querySelector('#token-description')?.value || '';
  const descriptionCounter = document.querySelector('#token-description-counter');
  if (descriptionCounter) descriptionCounter.textContent = `${description.length}/280 · published with Devnet metadata`;
  const tagline = document.querySelector('#token-tagline')?.value.trim() || '';
  const taglinePreview = document.querySelector('#preview-tagline');
  if (taglinePreview) taglinePreview.textContent = tagline || 'Add a clear thesis for the community.';
  const buyLabel = creatorBuy.sol > 0 ? `${creatorBuy.sol.toLocaleString(undefined, { maximumFractionDigits: 9 })} SOL${creatorBuy.tokens > 0 ? ` · ${Math.round(creatorBuy.tokens).toLocaleString()} tokens` : ''}` : 'Creation only';
  const previewBuy = document.querySelector('#preview-creator-buy');
  if (previewBuy) previewBuy.textContent = buyLabel;
  const buyTokensNode = document.querySelector('#creator-buy-token-amount');
  const buySolNode = document.querySelector('#creator-buy-sol-amount');
  if (buyTokensNode) buyTokensNode.textContent = creatorBuyExceedsWalletBalance() ? 'Insufficient SOL' : creatorBuy.tokens > 0 ? `${Math.round(creatorBuy.tokens).toLocaleString()} tokens` : creatorBuy.sol > 0 ? wallet ? 'Calculating…' : 'Connect wallet to estimate' : 'None';
  if (buySolNode) buySolNode.textContent = creatorBuy.sol > 0 ? `${creatorBuy.sol.toLocaleString(undefined, { maximumFractionDigits: 9 })} SOL developer buy` : 'No developer buy';
  const image = getPreparedImage();
  const roadmap = document.querySelector('#token-roadmap')?.value.trim() || '';
  const website = document.querySelector('#token-website')?.value.trim() || '';
  const quality = [Boolean(image), Boolean(tagline), Boolean(website || document.querySelector('#token-x')?.value.trim() || document.querySelector('#token-telegram')?.value.trim() || document.querySelector('#token-discord')?.value.trim()), Boolean(roadmap)];
  const qualityLabels = ['logo', 'thesis', 'links', 'roadmap'];
  const qualityCount = quality.filter(Boolean).length;
  const qualityScore = document.querySelector('#preview-quality-score');
  const qualityFill = document.querySelector('#preview-quality-fill');
  if (qualityScore) qualityScore.textContent = `${qualityCount} / 4 ready`;
  if (qualityFill) qualityFill.style.width = `${qualityCount / 4 * 100}%`;
  qualityLabels.forEach((key, index) => { const node = document.querySelector(`#preview-quality-${key}`); if (node) { node.textContent = `${quality[index] ? '✓' : '○'} ${key === 'links' ? 'Official link' : key === 'roadmap' ? 'Milestones' : key[0].toUpperCase() + key.slice(1)}`; node.classList.toggle('ready', quality[index]); } });
  const compactPreviewValues = {
    '#preview-launchpad': 'Pump.fun',
    '#preview-network': 'Solana Devnet',
    '#preview-supply': '1 billion',
    '#preview-community': Number.isFinite(allocation) ? formatVerifiedPercent(allocation) : '—',
    '#preview-creator-wallet-share': `${feeDistribution.creatorWalletPercent}%`,
    '#preview-holder-share': `${feeDistribution.holderAirdropPercent}%`,
    '#preview-x-share': `${feeDistribution.solClaimPercent}%`,
    '#preview-funded-share': `${FEE_DISTRIBUTION.fundedPercent}%`,
  };
  Object.entries(compactPreviewValues).forEach(([selector, value]) => { const node = document.querySelector(selector); if (node) node.textContent = value; });
  const previewBurnTier = document.querySelector('#preview-burn-tier');
  if (previewBurnTier) { previewBurnTier.textContent = launchBurn.label.toUpperCase(); previewBurnTier.className = `tier-badge ${launchBurn.tier}`; }
  const promotionBadge = document.querySelector('#preview-promotion-badge');
  if (promotionBadge) {
    promotionBadge.textContent = launchBurn.requiresBurn ? `${launchBurn.label.toUpperCase()} PROMOTION` : 'STANDARD';
    promotionBadge.className = `preview-promotion-badge ${launchBurn.tier}`;
  }
  const previewBurnAmount = document.querySelector('#preview-burn-amount');
  if (previewBurnAmount) previewBurnAmount.textContent = launchBurn.requiresBurn ? `${formatLaunchBurnAmount(launchBurn.amountTokens)} $FUNDED` : 'None';
  const routerPreview = document.querySelector('#preview-fee-router');
  if (routerPreview) routerPreview.textContent = feeRouterState.verified ? `100% → ${feeRouterState.address.slice(0, 4)}…${feeRouterState.address.slice(-4)}` : 'Launch blocked';
  const feeStatus = document.querySelector('#fee-distribution-status');
  if (feeStatus) {
    const validation = validateFeeDistribution(feeDistribution);
    feeStatus.textContent = validation.valid
      ? feeDistribution.solClaimPercent > 0
        ? xFeeStatus.ready ? 'X rewards use an isolated per-coin fee router and verified X + wallet claim.' : `X account rewards unavailable: ${xFeeStatus.reasons.join('; ')}.`
        : ''
      : !validation.sharesValid
        ? 'Each creator destination must be between 0% and 80%.'
        : !validation.xRecipientValid
          ? 'Enter a valid X account for the SOL reward.'
          : `Creator-directed allocation totals ${validation.total.toFixed(1)}%; it must equal 80%.`;
    feeStatus.className = `field-help ${validation.valid && (feeDistribution.solClaimPercent === 0 || xFeeStatus.ready) ? 'funded-mint-valid' : 'funded-mint-invalid'}`;
    feeStatus.style.display = feeStatus.textContent ? '' : 'none';
  }
  renderLaunchBurnSelection();
  updateLaunchNavigation();
}
function getLaunchMetadataPreview(){
  const image = getPreparedImage();
  return {
    description: document.querySelector('#token-description')?.value.trim() || '',
    tagline: document.querySelector('#token-tagline')?.value.trim() || '',
    roadmap: document.querySelector('#token-roadmap')?.value.trim() || '',
    website: document.querySelector('#token-website')?.value.trim() || '',
    x: document.querySelector('#token-x')?.value.trim() || '',
    telegram: document.querySelector('#token-telegram')?.value.trim() || '',
    discord: document.querySelector('#token-discord')?.value.trim() || '',
    imageName: image?.name || '',
    imageType: image?.type || '',
  };
}
async function prepareLaunchMetadata({ mint, name, symbol }, session = captureWalletSession()){
  assertWalletSessionCurrent(session);
  if (typeof session.provider.signMessage !== 'function') throw new Error('This wallet must sign a metadata message before the Devnet transaction.');
  const preview = getLaunchMetadataPreview();
  assertImageReady();
  const image = getPreparedImage();
  if (image && (!['image/png', 'image/jpeg', 'image/webp'].includes(image.type) || image.size > 600_000)) throw new Error('Choose a PNG, JPG, or WEBP image under 600 KB.');
  const imageBytes = image ? new Uint8Array(await image.arrayBuffer()) : null;
  const imageSha256 = imageBytes ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', imageBytes)), byte => byte.toString(16).padStart(2, '0')).join('') : '';
  const imageBase64 = imageBytes ? Buffer.from(imageBytes).toString('base64') : '';
  const canonicalUrl = value => {
    if (!value) return '';
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Public metadata links must use http:// or https://.');
    return url.href;
  };
  const record = {
    mint, creatorWallet: session.address, name, symbol,
    description: preview.description, tagline: preview.tagline, roadmap: preview.roadmap,
    website: canonicalUrl(preview.website), x: canonicalUrl(preview.x), telegram: canonicalUrl(preview.telegram), discord: canonicalUrl(preview.discord), imageSha256,
  };
  assertWalletSessionCurrent(session);
  const signed = await session.provider.signMessage(new TextEncoder().encode(metadataStatement(record)));
  assertWalletSessionCurrent(session);
  const response = await apiRequest('/api/devnet-metadata', { method: 'POST', body: { ...record, imageBase64, imageType: image?.type || '', signature: bs58.encode(signed.signature || signed) } });
  assertWalletSessionCurrent(session);
  if (!response.available || response.data?.uri !== devnetMetadataUri(mint)) throw new Error('Devnet metadata could not be published. No token transaction was sent.');
  return response.data.uri;
}
function getFeeDistributionInputs(){
  return {
    creatorWalletPercent: Number(document.querySelector('#creator-wallet-share')?.value),
    holderAirdropPercent: Number(document.querySelector('#holder-airdrop-share')?.value),
     solClaimPercent: Number(document.querySelector('#x-share')?.value),
    xRecipient: normalizeXHandle(document.querySelector('#x-recipient')?.value),
  };
}
const LAUNCH_SOCIAL_FIELDS = ['token-website', 'token-x', 'token-telegram', 'token-discord'];
function validPublicUrl(value){
  if (!value) return true;
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
}
function invalidLaunchSocial(){
  return LAUNCH_SOCIAL_FIELDS.map(id => document.getElementById(id)).find(field => field && !validPublicUrl(field.value.trim())) || null;
}
function updateLaunchSocialValidity(field){
  if (!field) return;
  field.setCustomValidity(validPublicUrl(field.value.trim()) ? '' : 'Enter a complete http:// or https:// URL.');
}
function launchEstimateRefreshAvailable({ policyValid, hasWallet, signingReady, loading, developerBuyBlocked, estimateUnavailable }){
  return Boolean(policyValid && hasWallet && signingReady && !loading && !developerBuyBlocked && estimateUnavailable);
}
function updateLaunchButton(){
  const button = document.querySelector('#launch-button');
  const insufficient = walletBalanceLamports != null && estimatedLaunchFeeLamports != null && walletBalanceLamports < estimatedLaunchFeeLamports;
  const insufficientDeveloperBuy = creatorBuyExceedsWalletBalance();
    const balanceUnknown = wallet && (walletBalanceLamports == null || estimatedLaunchFeeLamports == null || !freshLaunchReview(launchCostReview));
  const feeDistribution = validateFeeDistribution(getFeeDistributionInputs());
  const launchBurn = getLaunchBurnPolicy();
  const creatorBuySol = getCreatorBuySol();
  const buyValid = Number.isFinite(creatorBuySol) && creatorBuySol >= 0 && (estimatedInitialBuyTokens <= 0 || estimatedInitialBuyTokens <= LAUNCH_TOKEN_SUPPLY * .2);
  const communityTokens = getCommunityAirdropTokens();
  const communityValid = Number.isSafeInteger(communityTokens) && communityTokens >= MIN_COMMUNITY_AIRDROP_TOKENS && communityTokens <= MAX_COMMUNITY_AIRDROP_TOKENS;
  const burnConfigured = validateLaunchBurnPolicy(launchBurn).valid;
  const burnReady = !launchBurn.requiresBurn || launchBurnReadiness.ready;
  const xRouteReady = feeDistribution.shares.solClaimPercent === 0 || xFeeStatus.ready;
  const identityValid = getLaunchStepState(1).valid;
  const policyValid = identityValid && feeDistribution.valid && xRouteReady && feeRouterState.verified && burnConfigured && burnReady && buyValid && communityValid;
  const ready = Boolean(canSignTransactions(wallet) && !walletMetricsLoading && !balanceUnknown && !insufficient && policyValid && document.querySelector('#terms-agree')?.checked && document.querySelector('#fee-route-agree')?.checked && document.querySelector('#token-name').value.trim() && document.querySelector('#token-symbol').value.trim());
  const estimateRefreshReady = launchEstimateRefreshAvailable({
    policyValid,
    hasWallet: Boolean(wallet),
    signingReady: canSignTransactions(wallet),
    loading: walletMetricsLoading,
    developerBuyBlocked: insufficientDeveloperBuy,
    estimateUnavailable: balanceUnknown,
  });
  button.disabled = !(ready || estimateRefreshReady);
  button.dataset.launchAction = estimateRefreshReady ? 'refresh-estimate' : 'launch';
  button.textContent = !communityValid ? 'Airdrop must be 30M–500M' : !identityValid ? 'Fix coin details' : !feeDistribution.valid ? 'Fix fee distribution' : !xRouteReady ? 'X account rewards unavailable' : !feeRouterState.verified ? 'Fee router required' : !buyValid ? 'Enter a valid developer buy' : !burnConfigured ? '$FUNDED mint required' : launchBurn.requiresBurn && !burnReady ? 'Verify $FUNDED balance' : !wallet ? 'Connect wallet to launch' : !canSignTransactions(wallet) ? 'Open in wallet to sign' : walletMetricsLoading ? 'Calculating launch cost' : walletBalanceLamports == null ? 'Refresh wallet balance' : insufficientDeveloperBuy ? 'Insufficient SOL for developer buy' : estimatedLaunchFeeLamports == null ? 'Refresh launch estimate' : insufficient ? 'Insufficient SOL for launch' : !document.querySelector('#fee-route-agree')?.checked ? 'Confirm the fee route' : !document.querySelector('#terms-agree')?.checked ? 'Agree to terms to launch' : !policyValid ? 'Complete launch policy' : ready ? (launchBurn.requiresBurn ? `Review launch · ${launchBurn.label}` : 'Review launch') : 'Add name and ticker';
  updateLaunchNavigation();
}
function handleLaunchAction(event){
  if (event.currentTarget?.dataset.launchAction === 'refresh-estimate') {
    void refreshWalletInfo();
    return;
  }
  openLaunchReview();
}
let pendingLaunchReview = null;
function renderPendingLaunchReview(){
  const dialog = document.querySelector('#launch-review-dialog');
  if (!dialog?.open) return;
  const pending = pendingLaunchReview;
  const current = Boolean(pending && pending.reviewedCost === launchCostReview
    && freshLaunchReview(pending.reviewedCost) && pending.wallet === connectedWalletAddress
    && pending.router === feeRouterState.address);
  const details = document.querySelector('#launch-review-details');
  const confirm = document.querySelector('#launch-review-confirm');
  if (details) details.innerHTML = current
    ? launchReviewMarkup(pending.reviewedCost)
    : '<p role="status">Launch estimate expired or changed. Go back, refresh the estimate, and review again; no transaction was sent.</p>';
  if (confirm) {
    confirm.disabled = !current;
    confirm.textContent = current ? 'Continue to Phantom' : 'Estimate expired — go back';
  }
}
function openLaunchReview(){
  const reviewedCost = launchCostReview;
  const session = captureWalletSession();
  if (!session || !freshLaunchReview(reviewedCost) || document.querySelector('#launch-button')?.disabled) {
    setLaunchStatus('Refresh the launch estimate and complete all checks before reviewing.', true);
    return;
  }
  const name = document.querySelector('#token-name').value.trim();
  const symbol = document.querySelector('#token-symbol').value.trim().toUpperCase();
  const shares = getFeeDistributionInputs();
  const burn = getLaunchBurnPolicy();
  pendingLaunchReview = { reviewedCost, wallet: session.address, router: feeRouterState.address };
  document.querySelector('#launch-review-token').textContent = `${name} (${symbol})`;
  document.querySelector('#launch-review-tier').textContent = `${burn.label} tier`;
  document.querySelector('#launch-review-wallet').textContent = session.address;
  document.querySelector('#launch-review-reserve').textContent = `${getCommunityAirdropTokens().toLocaleString()} tokens`;
  document.querySelector('#launch-review-buy').textContent = getCreatorBuySol() ? `${getCreatorBuySol()} SOL` : 'None';
  document.querySelector('#launch-review-route-short').textContent = `${feeRouterState.address.slice(0, 7)}…${feeRouterState.address.slice(-6)}`;
  document.querySelector('#launch-review-route-address').textContent = feeRouterState.address;
  document.querySelector('#launch-review-route-split').textContent = `${shares.creatorWalletPercent}% wallet · ${shares.holderAirdropPercent}% holders · ${shares.solClaimPercent}% X · 20% protocol`;
  document.querySelector('#launch-review-details').innerHTML = launchReviewMarkup(reviewedCost);
  document.querySelector('#launch-review-dialog').showModal();
  renderPendingLaunchReview();
}
function closeLaunchReview(){
  pendingLaunchReview = null;
  document.querySelector('#launch-review-dialog')?.close();
}
function confirmLaunchReview(){
  const pending = pendingLaunchReview;
  closeLaunchReview();
  if (!pending || pending.reviewedCost !== launchCostReview || !freshLaunchReview(pending.reviewedCost) || pending.wallet !== connectedWalletAddress || pending.router !== feeRouterState.address) {
    setLaunchStatus('Launch review changed or expired. Refresh the estimate and review again; no transaction was sent.', true);
    return;
  }
  void launchToken();
}
function getLaunchStepState(step){
  const name = document.querySelector('#token-name').value.trim();
  const symbol = document.querySelector('#token-symbol').value.trim().toUpperCase();
  if (step === 1) {
    try{assertImageReady();}catch(error){return {valid:false,message:error.message};}
    if (!name) return { valid: false, field: '#token-name', message: 'Enter the token name to continue.' };
    if (!/^[A-Z0-9]{1,10}$/.test(symbol)) return { valid: false, field: '#token-symbol', message: 'Use 1–10 letters or numbers for the ticker.' };
    const invalidSocial = invalidLaunchSocial();
    if (invalidSocial) return { valid: false, message: `${invalidSocial.getAttribute('aria-label') || 'Social link'} must be a complete http:// or https:// URL.` };
    return { valid: true, message: 'Coin identity is ready.' };
  }
  const distribution = validateFeeDistribution(getFeeDistributionInputs());
  if (step === 2) {
    const communityTokens = getCommunityAirdropTokens();
    if (!Number.isSafeInteger(communityTokens) || communityTokens < MIN_COMMUNITY_AIRDROP_TOKENS || communityTokens > MAX_COMMUNITY_AIRDROP_TOKENS) return { valid: false, field: '#community-airdrop-tokens', message: 'Community airdrop must be between 30,000,000 and 500,000,000 tokens.' };
    const creatorBuySol = getCreatorBuySol();
    if (!Number.isFinite(creatorBuySol) || creatorBuySol < 0) return { valid: false, field: '#creator-buy-sol', message: 'Developer buy must be a valid SOL amount of zero or more.' };
    if (!distribution.valid) {
      if (!distribution.sharesValid) return { valid: false, message: 'Each creator destination must be between 0% and 80%.' };
      if (!distribution.xRecipientValid) return { valid: false, message: 'Enter a valid X account for the SOL reward.' };
      return { valid: false, message: 'Creator wallet, holder rewards, and X account reward must total exactly 80%.' };
    }
    if (distribution.shares.solClaimPercent > 0 && !xFeeStatus.ready) return { valid: false, message: `X account rewards unavailable: ${xFeeStatus.reasons.join('; ')}.` };
    const launchBurn = getLaunchBurnPolicy();
    const burnValidation = validateLaunchBurnPolicy(launchBurn);
    if (!burnValidation.valid) return { valid: false, message: 'The protocol $FUNDED mint must be configured before a paid burn tier can launch.' };
    return { valid: true, message: launchBurn.requiresBurn ? `${launchBurn.label} selected: ${formatLaunchBurnAmount(launchBurn.amountTokens)} $FUNDED burn; atomicity depends on transaction size.` : launchMode === 'quick' ? 'Recommended distribution selected.' : 'Custom distribution is balanced.' };
  }
  if (step === 3) {
    if (!feeRouterState.verified) return { valid: false, message: 'The verified fee-router PDA is required before signing.' };
    if (!wallet) return { valid: false, message: 'Connect a wallet to continue to signing.' };
    if (!canSignTransactions(wallet)) return { valid: false, message: 'Open this app inside your wallet to sign.' };
    if (walletMetricsLoading) return { valid: false, message: 'Wait while the launch cost is calculated.' };
    if (creatorBuyExceedsWalletBalance()) return { valid: false, message: 'Reduce the developer buy or add Devnet SOL before continuing.' };
    if (!freshLaunchReview(launchCostReview)) return { valid:false, message:'Refresh the launch estimate before continuing; quotes expire after one minute.' };
    if (walletBalanceLamports == null || estimatedLaunchFeeLamports == null) return { valid: false, message: walletEstimateError ? `Launch estimate unavailable: ${walletEstimateError}` : 'Refresh the wallet balance and launch estimate.' };
    if (walletBalanceLamports < estimatedLaunchFeeLamports) return { valid: false, message: 'Add Devnet SOL before continuing.' };
    const launchBurn = getLaunchBurnPolicy();
    if (launchBurn.requiresBurn && !launchBurnReadiness.ready) return { valid: false, message: launchBurnReadiness.message };
    if (!document.querySelector('#fee-route-agree').checked) return { valid: false, message: 'Confirm that the Pump creator-fee route belongs to funded.vip.' };
    if (!document.querySelector('#terms-agree').checked) return { valid: false, message: 'Accept the Terms and Disclosures to continue.' };
    return { valid: true, message: 'Review complete. Continue to sign.' };
  }
  return { valid: true, message: 'Ready to sign and verify.' };
}
function updateLaunchNavigation(){
  const next = document.querySelector('#launch-next');
  const back = document.querySelector('#launch-back');
  const hint = document.querySelector('#wizard-hint');
  if (!next || !back || !hint) return;
  const state = getLaunchStepState(launchStep);
  back.hidden = launchStep === 1;
  next.hidden = launchStep === 3;
  next.disabled = false;
  next.textContent = launchStep === 2 ? 'Review settings' : 'Continue to settings';
  hint.textContent = state.message;
  hint.classList.toggle('ready', state.valid);
}
function setLaunchStep(step){
  const target = Math.min(3, Math.max(1, Number(step) || 1));
  if (target > launchStep) {
    for (let previous = 1; previous < target; previous++) {
      const state = getLaunchStepState(previous);
      if (!state.valid) {
        document.querySelector('#wizard-hint').textContent = state.message;
        const invalid = state.field && document.querySelector(state.field);
        if (invalid && invalid.getClientRects().length) {
          invalid.setAttribute('aria-invalid','true');
          const described = new Set((invalid.getAttribute('aria-describedby') || '').split(' ').filter(Boolean));
          described.add('wizard-hint'); invalid.setAttribute('aria-describedby',[...described].join(' '));
          invalid.focus();
          invalid.addEventListener('input',()=>invalid.removeAttribute('aria-invalid'),{once:true});
        } else document.querySelector('#wizard-hint').focus();
        return;
      }
    }
  }
  launchStep = target;
  const page = document.querySelector('#launch-dialog');
  page.dataset.step = String(launchStep);
  document.querySelectorAll('[data-launch-step]').forEach(panel => {
    const active = Number(panel.dataset.launchStep) === launchStep;
    panel.hidden = !active;
    panel.classList.toggle('active', active);
  });
  document.querySelectorAll('[data-launch-step-target]').forEach(button => {
    const target = Number(button.dataset.launchStepTarget);
    button.classList.toggle('active', target === launchStep);
    button.classList.toggle('complete', target < launchStep);
    if (target === launchStep) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  });
  updateLaunchPreview();
  updateLaunchButton();
  window.dispatchEvent(new CustomEvent('funded:launch-step', {detail: {step: launchStep}}));
  const heading = page.querySelector('[data-launch-step="' + launchStep + '"] h3');
  if (heading && location.hash === '#launch') { heading.tabIndex = -1; heading.focus({preventScroll:true}); heading.scrollIntoView({block:'start',behavior:'instant'}); }
}
function setLaunchMode(mode){
  launchMode = mode === 'custom' ? 'custom' : 'quick';
  const custom = launchMode === 'custom';
  document.querySelector('#custom-policy').hidden = !custom;
  document.querySelector('#launch-mode-quick').classList.toggle('active', !custom);
  document.querySelector('#launch-mode-quick').setAttribute('aria-pressed', String(!custom));
  document.querySelector('#launch-mode-custom').classList.toggle('active', custom);
  document.querySelector('#launch-mode-custom').setAttribute('aria-pressed', String(custom));
  if (!custom) {
    document.querySelector('#creator-wallet-share').value = '80';
    document.querySelector('#holder-airdrop-share').value = '0';
    document.querySelector('#x-share').value = '0';
    document.querySelector('#x-recipient').value = '';
    document.querySelector('#x-recipient').disabled = true;
  }
  updateLaunchPolicyControls();
}
function setLaunchProfile(profile){
  launchProfile = profile === 'fast' ? 'fast' : 'community';
  document.querySelectorAll('[data-launch-profile]').forEach(card => {
    const active = card.dataset.launchProfile === launchProfile;
    card.classList.toggle('active', active);
    card.setAttribute('aria-pressed', String(active));
  });
  const socials = document.querySelector('.social-section');
  const pageDetails = document.querySelector('.launch-page-details');
  if (launchProfile === 'community') {
    if (socials) socials.open = true;
    if (pageDetails) pageDetails.open = true;
  } else {
    if (socials) socials.open = false;
    if (pageDetails) pageDetails.open = false;
  }
  const hint = document.querySelector('#wizard-hint');
  if (hint && launchStep === 1 && !document.querySelector('#token-name')?.value.trim()) {
    hint.textContent = launchProfile === 'fast' ? 'Quick setup selected. Enter a name and ticker to continue.' : 'Add the identity and public story people will see after launch.';
  }
}
async function refreshWalletInfo({ rateLimitRetry = 0 } = {}){
  clearTimeout(launchCostRefreshTimer);
  launchCostRefreshTimer = null;
  if (!wallet) { setWalletMetrics(); return; }
  const session = captureWalletSession();
  if (!session) { setWalletMetrics(); return; }
  const payer = session.provider.publicKey;
  const request = ++metricsRequest;
  const quoteStartedAt=Date.now();
  setWalletMetrics({ loading: true });
  try {
    await getSolana();
    const balance = await connection.getBalance(payer, 'confirmed');
    if (request !== metricsRequest || !isWalletSessionCurrent(session)) return;
    if (!feeRouterState.verified || !feeRouterState.address) throw new Error('Fee router is not ready.');
    const creatorBuySol = getCreatorBuySol();
    if (creatorBuySol > 0 && Math.ceil(creatorBuySol * 1_000_000_000) >= balance) throw new Error('Insufficient Devnet SOL for the developer buy and network costs. Reduce the buy amount or add test funds.');
    const [{ PUMP_SDK, OnlinePumpSdk }, { normalizeLaunchInput }, { getInitialBuyQuote, prepareFundedLaunchBurn }] = await Promise.all([import('@pump-fun/pump-sdk'), import('./launch-core.js'), import('./launch-flow.js')]);
    const { Keypair, PublicKey } = await getSolana();
    const name = document.querySelector('#token-name').value.trim() || 'Devnet Coin';
    const symbol = document.querySelector('#token-symbol').value.trim().toUpperCase() || 'COIN';
    const input = normalizeLaunchInput({ name, symbol, supply: LAUNCH_TOKEN_SUPPLY, decimals: 6 });
    const initialBuy = await getInitialBuyQuote({ connection, input: { ...input, initialBuySol: getCreatorBuySol() } });
    const mint = Keypair.generate();
    const xLinked = getFeeDistributionInputs().solClaimPercent > 0;
    if (xLinked && !xFeeStatus.ready) throw new Error('Mint-specific X fee claims are not ready on Devnet.');
    const mintRouter = buildMintRouterInitializeInstruction({ programId: FEE_ROUTER_PROGRAM_ID, mint: mint.publicKey, payer });
    const router = mintRouter.router.address;
    const launchInstructions = initialBuy.amountBaseUnits > 0n
      ? await PUMP_SDK.createV2AndBuyInstructions({ global: await new OnlinePumpSdk(connection).fetchGlobal(), mint: mint.publicKey, name: input.name, symbol: input.symbol, uri: `https://funded.vip/devnet-metadata/${mint.publicKey.toBase58()}`, creator: router, user: payer, amount: new (await import('bn.js')).default(initialBuy.amountBaseUnits.toString()), solAmount: new (await import('bn.js')).default(initialBuy.solAmountLamports.toString()), mayhemMode: false, cashback: false, holderReward: false })
      : [await PUMP_SDK.createV2Instruction({ mint: mint.publicKey, name: input.name, symbol: input.symbol, uri: `https://funded.vip/devnet-metadata/${mint.publicKey.toBase58()}`, creator: router, user: payer, mayhemMode: false, holderReward: false })];
    const launchBurn = getLaunchBurnPolicy();
    const burnPlan = launchBurn.requiresBurn
      ? await prepareFundedLaunchBurn({ connection, payer, fundedMint: launchBurn.fundedMint, amountTokens: launchBurn.amountTokens })
      : null;
    let plan;
    let estimates;
    for (let blockhashAttempt = 0; blockhashAttempt < 2; blockhashAttempt += 1) {
      // A finalized hash is visible across every backend in a load-balanced
      // Devnet RPC pool. Retry once after the proxy cache window if a backend
      // still reports that it has not observed the hash.
      if (blockhashAttempt > 0) await new Promise(resolve => setTimeout(resolve, 1100));
      const latest = await connection.getLatestBlockhash('finalized');
      plan = buildPumpLaunchPlan({ payer, mint, blockhash: latest.blockhash, launchInstructions, burnInstruction: burnPlan?.instruction, mintRouterInstruction: mintRouter?.instruction });
      const estimateTransactions = plan.steps.map(step => step.transaction);
      try {
        // The split path still simulates every transaction; the legacy path is the original full launch simulation: connection.simulateTransaction(launchTransaction, undefined, [payer]).
        estimates = await Promise.all(estimateTransactions.map(async transaction => {
          const transactionFee = await connection.getFeeForMessage(transaction.compileMessage(), 'confirmed');
          if(transactionFee.value==null)throw new Error('Network fee quote is unavailable. Refresh before signing.');
          const transactionSimulation = await connection.simulateTransaction(transaction, undefined, [payer]);
          if (transactionSimulation.value.err) {
            const reason = JSON.stringify(transactionSimulation.value.err);
            throw new Error(`The launch transaction could not be simulated on Devnet: ${reason}.`);
          }
          const simulatedPayerBalance = transactionSimulation.value.accounts?.[0]?.lamports;
          const fee = Number(transactionFee.value);
          const estimatedSpend = balance - simulatedPayerBalance;
          if (!Number.isSafeInteger(simulatedPayerBalance) || !Number.isSafeInteger(fee) || !Number.isSafeInteger(estimatedSpend) || estimatedSpend < fee) throw new Error('The full Devnet launch cost could not be verified.');
          return { fee, spend: estimatedSpend };
        }));
        break;
      } catch (error) {
        const blockhashMissing = /BlockhashNotFound|blockhash not found/i.test(String(error?.message || error));
        if (!blockhashMissing || blockhashAttempt > 0) throw error;
      }
    }
    if (!plan || !estimates) throw new Error('The Devnet blockhash could not be refreshed for launch estimation.');
    const fee = estimates.reduce((total, item) => total + item.fee, 0);
    const estimatedSpend = estimates.reduce((total, item) => total + item.spend, 0);
    if (!Number.isSafeInteger(fee)
      || !Number.isSafeInteger(estimatedSpend) || estimatedSpend < fee) {
      throw new Error('The full Devnet launch cost could not be verified.');
    }
    if (request !== metricsRequest || !isWalletSessionCurrent(session)) return;
    launchBurnReadiness = burnPlan
      ? { ready: true, message: `Wallet verified for an atomic ${formatLaunchBurnAmount(launchBurn.amountTokens)} $FUNDED burn with Pump creation${plan.mintRouterSeparate ? '; router initialization uses a separate approval' : ''}.` }
      : { ready: true, message: 'No creator-funded burn is required.' };
    renderLaunchBurnSelection();
    const review=launchReview({balance,simulatedSpend:estimatedSpend,networkFee:fee,buyQuote:initialBuy.solAmountLamports,buyMaximum:initialBuy.maxSolAmountLamports,transactionCount:plan.steps.length,curvePremiumBps:initialBuy.curvePremiumBps,now:quoteStartedAt});
    if(!freshLaunchReview(review))throw new Error('Estimate took too long and expired. Refresh before signing.');
    launchCostReview=review;
    estimatedInitialBuyLamports=Number(initialBuy.solAmountLamports);
    estimatedInitialBuyTokens=Number(initialBuy.amountTokens);
    updateLaunchPreview();
    setWalletMetrics({ balance, fee: Number(launchCostReview.budget) });
  } catch (error) {
    if (request === metricsRequest && isWalletSessionCurrent(session)) {
      const rawReason = String(error?.message || 'The exact Devnet launch cost could not be verified.');
      const rateLimited = /\b429\b|rate limit|too many requests/i.test(rawReason);
      if (rateLimited && rateLimitRetry < 2) {
        await new Promise(resolve => setTimeout(resolve, (rateLimitRetry + 1) * 2_000));
        if (request === metricsRequest && isWalletSessionCurrent(session)) return refreshWalletInfo({ rateLimitRetry: rateLimitRetry + 1 });
        return;
      }
      // Invalid form input is an expected validation state, not a runtime failure.
      const expectedInputError = [
        'Token name must be 1–32 characters.',
        'Ticker must contain 1–10 letters or numbers.',
        'Initial supply must be a positive whole number.',
        'Decimals must be an integer from 0 to 9.',
      ].includes(rawReason);
      if (!expectedInputError) console.warn('Launch cost estimate failed:', error);
      const reason = rateLimited
        ? 'Devnet RPC is rate limited. Wait a moment, then refresh the estimate.'
        : rawReason.slice(0, 180);
      const launchBurn = getLaunchBurnPolicy();
      if (launchBurn.requiresBurn) {
        launchBurnReadiness = { ready: false, message: error?.message || 'The $FUNDED burn could not be prepared.' };
        renderLaunchBurnSelection();
      }
      try {
        await getSolana();
        const balance = await connection.getBalance(payer, 'confirmed');
        if (request === metricsRequest && isWalletSessionCurrent(session)) setWalletMetrics({ balance, fee: null, error: reason });
      } catch {
        if (request === metricsRequest && isWalletSessionCurrent(session)) setWalletMetrics({ balance: null, fee: null, error: reason });
      }
    }
  }
}
function scheduleLaunchCostRefresh(){
  if (!wallet) return;
  metricsRequest += 1;
  clearTimeout(launchCostRefreshTimer);
  setWalletMetrics({ loading: true });
  launchCostRefreshTimer = setTimeout(() => { launchCostRefreshTimer = null; refreshWalletInfo(); }, 350);
}
function setWalletState(message, detail = '', connected = false){
  connected = Boolean(connected && wallet && connectedWalletAddress === walletAddress(wallet));
  document.documentElement.dataset.connectedWallet = connected ? connectedWalletAddress : '';
  window.dispatchEvent(new Event('funded:reward-identity-change'));
  const signingReady = connected && canSignTransactions(wallet);
  const header = document.querySelector('#connect-button');
  const walletPopover = document.querySelector('#wallet-popover');
  header.classList.toggle('wallet-pill-connected', connected);
  if (connected) {
    const walletIcon = document.createElement('span'); walletIcon.className = 'header-wallet-icon'; walletIcon.setAttribute('aria-hidden', 'true');
    const solanaMark = document.createElement('span'); solanaMark.className = 'header-solana-mark'; solanaMark.setAttribute('aria-hidden', 'true');
    const balance = document.createElement('span'); balance.className = 'header-wallet-balance'; balance.id = 'header-wallet-balance'; balance.textContent = '—';
    const chevron = document.createElement('span'); chevron.className = 'header-wallet-chevron'; chevron.setAttribute('aria-hidden', 'true'); chevron.textContent = '⌄';
    header.replaceChildren(walletIcon, solanaMark, balance, chevron);
    header.setAttribute('aria-label', `Wallet ${connectedWalletAddress.slice(0, 4)}…${connectedWalletAddress.slice(-4)}`);
  } else {
    const arrow = document.createElement('span'); arrow.textContent = '↗';
    header.replaceChildren(document.createTextNode('Connect wallet '), arrow);
    header.setAttribute('aria-label', 'Connect wallet');
  }
  header.removeAttribute('title');
  header.setAttribute('aria-expanded', 'false');
  if (walletPopover) walletPopover.hidden = true;
  header.onclick = connected ? event => {
    event.stopPropagation();
    if (!walletPopover) return;
    const opening = walletPopover.hidden;
    walletPopover.hidden = !opening;
    header.setAttribute('aria-expanded', String(opening));
  } : connectWallet;
  const popoverAddress = document.querySelector('#wallet-popover-address');
  const popoverNetwork = document.querySelector('#wallet-popover-network');
  const popoverDetailLink = document.querySelector('#wallet-popover-detail-link');
  if (popoverAddress) popoverAddress.textContent = connected ? `${connectedWalletAddress.slice(0, 4)}…${connectedWalletAddress.slice(-4)}` : 'Wallet';
  if (popoverNetwork) popoverNetwork.textContent = connected ? 'Solana Devnet' : 'Not connected';
  if (popoverDetailLink) popoverDetailLink.href = connected ? `/wallet/${encodeURIComponent(connectedWalletAddress)}` : '#profile';
  renderWalletFundedBalance();
  const sidebarName = document.querySelector('#sidebar-wallet-name');
  const sidebarAddress = document.querySelector('#sidebar-wallet-address');
  const sidebarAvatar = document.querySelector('#sidebar-wallet-avatar');
  if (sidebarName) sidebarName.textContent = connected ? 'Wallet connected' : 'Wallet not connected';
  if (sidebarAddress) sidebarAddress.textContent = connected ? `${connectedWalletAddress.slice(0, 4)}…${connectedWalletAddress.slice(-4)}` : 'Connect to review signing';
  if (sidebarAvatar) sidebarAvatar.textContent = connected ? '✓' : '◎';
  const leaderboardBadge = document.querySelector('#leaderboard-wallet-badge');
  const leaderboardTitle = document.querySelector('#leaderboard-wallet-title');
  const leaderboardLink = document.querySelector('#leaderboard-wallet-link');
  if (leaderboardBadge) leaderboardBadge.textContent = connected ? 'Indexer pending' : 'Wallet required';
  if (leaderboardTitle) leaderboardTitle.textContent = connected ? 'Rank unavailable until activity is indexed' : 'Connect to see your rank';
  if (leaderboardLink) { leaderboardLink.href = connected ? '#docs' : '#profile'; leaderboardLink.textContent = connected ? 'View Devnet status →' : 'Connect wallet →'; }
  const profileName = document.querySelector('#profile-wallet-name');
  const profileAddress = document.querySelector('#profile-wallet-address');
  const profileAvatar = document.querySelector('#profile-wallet-avatar');
  const profileConnect = document.querySelector('#profile-connect');
  if (profileName) profileName.textContent = connected ? 'Wallet connected' : 'Wallet not connected';
  if (profileAddress) profileAddress.textContent = connected ? `${connectedWalletAddress.slice(0, 4)}…${connectedWalletAddress.slice(-4)}` : 'Connect to review signing';
  if (profileAvatar) profileAvatar.textContent = connected ? '✓' : '◎';
  if (profileConnect) profileConnect.textContent = connected ? 'View wallet details' : 'Connect wallet';
  renderCreatorLaunches();
  document.querySelector('#profile-address').textContent = connected ? connectedWalletAddress : 'Not connected';
  const profileCopyAddress = document.querySelector('#profile-copy-address');
  if (profileCopyAddress) {
    profileCopyAddress.disabled = !connected;
    profileCopyAddress.title = connected ? 'Copy wallet address' : 'Connect a wallet before copying its address';
  }
  const profileDisconnect = document.querySelector('#profile-disconnect');
  if (profileDisconnect) profileDisconnect.disabled = !connected;
  document.querySelector('#profile-status').textContent = connected ? wallet.remoteMobile ? 'Phantom mobile wallet connected. Scan a new QR to approve each claim or trade on your phone.' : wallet.readOnly ? 'Address linked for viewing. Open this app inside Phantom to sign transactions.' : wallet.devMode ? 'Disposable Devnet test wallet connected. The local API signs; private keys do not enter this browser app.' : 'Connected locally. Your wallet remains the signer; private keys do not enter this app.' : 'This profile is local to the demo workspace.';
  const launchPathWallet = document.querySelector('#launch-path-wallet');
  if (launchPathWallet) { launchPathWallet.querySelector('strong').textContent = connected ? 'Wallet connected' : 'Connect wallet'; launchPathWallet.querySelector('small').textContent = signingReady ? 'Ready for Devnet review.' : connected ? 'Review before signing.' : 'Connect to review signing.'; launchPathWallet.classList.toggle('complete', signingReady); }
  const onboardingWallet = document.querySelector('[data-onboarding-step="creator"]');
  if (onboardingWallet) { onboardingWallet.querySelector('strong').textContent = connected ? 'Wallet connected' : 'Connect your wallet'; onboardingWallet.querySelector('small').textContent = signingReady ? 'Ready to review a launch.' : connected ? 'Review before signing.' : 'Connect to unlock your workspace.'; }
  const claimButton = document.querySelector('#sol-claim-submit');
  if (claimButton) claimButton.textContent = connected && typeof wallet.signMessage === 'function' && !wallet.readOnly ? 'Verify linked wallet' : connected ? 'Open in wallet to verify' : 'Connect wallet to verify';
  updateClaimBindingReview();
  const referralActivity = document.querySelector('#referral-activity-list .empty-state');
  if (referralActivity) {
    referralActivity.hidden = connected;
    if (!connected) referralActivity.textContent = 'Connect a wallet to load qualified referral activity.';
  }
  const tradeQuote = document.querySelector('#trade-quote');
  if (tradeQuote && (!connected || !signingReady || tradeQuote.textContent.startsWith('Connect your wallet'))) tradeQuote.textContent = signingReady ? 'The current quote appears automatically when you enter an amount.' : connected ? 'Open this app inside your wallet to calculate and approve a trade.' : 'Connect a signing wallet to calculate an exact trade quote.';
  const selectedProgram = document.querySelector('[data-program-tier="standard"].active');
  const programNote = document.querySelector('#program-progress-note');
  if (selectedProgram && programNote) programNote.textContent = signingReady ? 'Wallet connected. Review the fee route and launch cost before signing.' : connected ? 'Address linked. Open inside your wallet before signing.' : 'Connect a wallet to begin your launch review.';
  updatePreviewStatusDrawer(connected);
  if (connected) { bindAppReferralToWallet(); void refreshReferralClaims().catch(() => {}); }
  updateReferralLink();
  updateOnboardingProgress();
  renderAirdropClaims();
  updateLaunchButton();
  if (connected) { setWalletMetrics({ loading: true }); if (feeRouterState.status !== 'checking') refreshWalletInfo(); }
  else setWalletMetrics();
  renderWalletDetail();
  void loadFundedBurnState({ force: true });
  updateTokenChatComposerState();
  if (currentCoinFeeOverview) renderCoinFeeDashboard(currentCoinFeeOverview);
}
async function connectWallet(){
  if (APP_MAINNET_READ_ONLY) {
    setLaunchStatus('This private Mainnet preview is read-only. Wallet connection and signing are disabled.', true);
    showToast('Mainnet preview is read-only. Wallet actions are disabled.');
    return;
  }
  const provider = getProvider();
  if (!provider) {
    if (DEV_MODE && DEV_WALLET_AUTOCONNECT) {
      allowWalletReconnect();
      if (await connectDevWallet()) return;
    }
    const message = 'No injected wallet was found. Open funded.vip in Chrome or Edge with Phantom, Backpack, or Solflare installed.';
    if (!wallet) setWalletState('Wallet unavailable', message);
    setLaunchStatus('No injected Solana wallet was detected in this browser.', true);
    const header = document.querySelector('#connect-button');
    if (header) { header.title = message; header.setAttribute('aria-label', message); }
    void openMobileWalletDialog();
    return;
  }
  const request = ++walletConnectRequest;
  try { const connected = await connectWalletProvider(provider); if (request !== walletConnectRequest) return; allowWalletReconnect(); activateWallet(connected.provider); setLaunchStatus(`Ready to sign with ${connected.publicKey.toBase58()}`); }
  catch (error) {
    if (request !== walletConnectRequest) return;
    const message = `Connection failed: ${error.message}`;
    if (!wallet) setWalletState('Connection failed', 'Check your wallet and try again.');
    setLaunchStatus(message, true);
    showToast(message);
  }
}
function syncXClaimFlow(){
  const xConnected=document.querySelector('#x-sign-in')?.dataset.connected==='true';
  const claimId=String(document.querySelector('#sol-claim-id')?.value||'').trim();
  const address=captureWalletSession()?.address||'';
  const agreed=Boolean(document.querySelector('#claim-binding-agree')?.checked);
  const readyCount=document.querySelectorAll('#sol-claim-list .x-claim-reward-state.ready').length;
  const paidCount=document.querySelectorAll('#sol-claim-list .x-claim-reward-state.paid').length;
  const button=document.querySelector('#sol-claim-submit');
  const review=document.querySelector('#selected-claim-review');
  const walletReview=document.querySelector('#claim-binding-review');
  if(review){
    review.hidden=!xConnected||!claimId;
    const row=[...document.querySelectorAll('#sol-claim-list [data-claim-id]')].find(item=>item.dataset.claimId===claimId);
    const summary=document.querySelector('#selected-claim-summary');
    if(summary)summary.textContent=row?.dataset.claimSummary||`Claim ${claimId}`;
  }
  if(walletReview)walletReview.hidden=!xConnected||!claimId;
  if(button){
    button.hidden=!xConnected||!claimId;
    button.disabled=!xConnected||!claimId||Boolean(address&&!agreed)||button.dataset.processing==='true';
    button.textContent=!xConnected?'Sign in with X first':!claimId?(readyCount?'Choose a reward to continue':'No rewards ready to claim'):!address?'Connect wallet to continue':!agreed?'Confirm wallet above':'Verify wallet and claim SOL';
  }
  const paidOnly=xConnected&&paidCount>0&&readyCount===0&&!claimId;
  const stepState={x:xConnected,choose:xConnected&&(Boolean(claimId)||paidOnly),wallet:xConnected&&((Boolean(claimId)&&Boolean(address&&agreed))||paidOnly),paid:paidOnly};
  let foundCurrent=false;
  for(const step of document.querySelectorAll('#x-claim-steps [data-claim-step]')){
    const done=stepState[step.dataset.claimStep]===true;
    const current=!done&&!foundCurrent;
    step.classList.toggle('complete',done);
    step.classList.toggle('current',current);
    if(current){step.setAttribute('aria-current','step');foundCurrent=true;}else step.removeAttribute('aria-current');
  }
}
function updateClaimBindingReview(){
  const node=document.querySelector('#claim-binding-review');
  if(!node)return;
  const address=captureWalletSession()?.address||'';
  const check=document.querySelector('#claim-binding-agree');
  if(check?.dataset.wallet!==address){check.checked=false;check.dataset.wallet=address;}
  if(check)check.disabled=!address;
  const destination=document.querySelector('#claim-binding-wallet');
  if(destination)destination.textContent=address?`Solana Devnet · ${address}`:'Connect the wallet that should receive this claim.';
  syncXClaimFlow();
}
async function submitSolClaim(){
  const status = document.querySelector('#sol-claim-status');
  const handle = normalizeXHandle(document.querySelector('#sol-claim-x-account')?.value);
  const claimId = String(document.querySelector('#sol-claim-id')?.value || '').trim();
  if (!handle || !claimId) { if (status) status.textContent = 'Sign in with X and choose one of your available claims first.'; return; }
  if (!wallet) { await connectWallet(); if (!wallet) return; }
  const session = captureWalletSession();
  if (!session || session.provider.readOnly || typeof session.provider.signMessage !== 'function') { if (status) status.textContent = 'This wallet cannot sign claim messages here.'; return; }
  updateClaimBindingReview();
  if(!document.querySelector('#claim-binding-agree')?.checked){if(status)status.textContent='Review and confirm the destination wallet before binding this claim.';return;}
  const button = document.querySelector('#sol-claim-submit'); if (button){button.disabled=true;button.dataset.processing='true';}
  try {
    const identity = await apiRequest('/api/x/me');
    if (!identity.data?.authenticated || `@${identity.data.user.username}`.toLowerCase() !== handle.toLowerCase()) throw new Error('Sign in with the X account named in this claim first.');
    if (status) status.textContent = 'Preparing claim…';
    const prepared = await apiRequest(`/api/sol-claims/${encodeURIComponent(claimId)}/prepare`, { method: 'POST', body: { xHandle: handle } });
    if(!prepared.available||!prepared.data?.statement)throw new Error('Claim preparation unavailable. No wallet signature requested.');
    if(prepared.data.boundWallet&&prepared.data.boundWallet!==session.address)throw new Error(`This claim is already bound to ${prepared.data.boundWallet}. Connect that wallet; redirection is not supported.`);
    assertWalletSessionCurrent(session);
    if (status) status.textContent = 'Verifying X identity…';
    await apiRequest(`/api/sol-claims/${encodeURIComponent(claimId)}/attest`, { method: 'POST', body: { xHandle: handle } });
    if (status) status.textContent = 'Requesting wallet signature…';
    const message = new TextEncoder().encode(prepared.data.statement);
    const signed = await session.provider.signMessage(message);
    assertWalletSessionCurrent(session);
    const publicKey = session.address;
    const verified = await apiRequest(`/api/sol-claims/${encodeURIComponent(claimId)}/verify`, { method: 'POST', body: { xHandle: handle, publicKey, signature: bs58.encode(signed.signature || signed) } });
    if (!isWalletSessionCurrent(session)) return { verified };
    if (status) status.textContent = 'Settling the mint-specific claim on Devnet…';
    const paid = await apiRequest(`/api/sol-claims/${encodeURIComponent(claimId)}/execute`, { method: 'POST' });
    if (!isWalletSessionCurrent(session)) return { verified, paid };
    if(!paid.available||!paid.data?.signature)throw new Error('Payout outcome is uncertain. Refresh rewards; do not submit another payout.');
    const checked=await apiRequest('/api/x-fee/claims').catch(()=>null);
    if(!isWalletSessionCurrent(session))return {verified,paid};
    const confirmed=confirmedClaimResult(checked?.data?.claims,claimId,paid.data.signature);
    if (status) status.textContent = confirmed?`Verified payment of ${confirmed.amountSol} SOL to ${publicKey}. Transaction: ${confirmed.payoutSignature}`:'Settlement response received. Payment verification is pending; refresh rewards later. Do not submit another payout.';
    showToast(confirmed?'Payment receipt verified':'Payment verification pending');
    await refreshXClaims();
    return { verified, paid };
  } catch (error) { if (isWalletSessionCurrent(session)) { if (status) status.textContent = error.message || 'Claim failed.'; showToast(error.message || 'Claim failed'); } }
  finally { if (button) delete button.dataset.processing; syncXClaimFlow(); }
}
async function disconnectWallet(){
  const provider = wallet;
  markWalletManuallyDisconnected();
  if (provider) disconnectingWalletProviders.add(provider);
  clearWalletState();
  try { await provider?.disconnect?.(); } catch {}
  finally { if (provider) disconnectingWalletProviders.delete(provider); }
}
function handleAccountChanged(provider, publicKey){
  if (wallet !== provider) return;
  const address = publicKey?.toBase58?.();
  if (!address || address !== walletAddress(provider)) { clearWalletState('Wallet account changed', 'Reconnect your wallet to continue safely.'); return; }
  if (address === connectedWalletAddress) return;
  activateWallet(provider);
  setLaunchStatus(`Wallet changed. Ready to sign with ${address}`);
}
function reconcileWalletState(){
  if (wallet) {
    if (wallet.isConnected === false || walletAddress(wallet) !== connectedWalletAddress) clearWalletState('Wallet account changed', 'Reconnect your wallet to continue safely.');
    return;
  }
  const provider = getProvider();
  if (provider?.isConnected && !wasWalletManuallyDisconnected() && !disconnectingWalletProviders.has(provider) && walletAddress(provider)) activateWallet(provider);
}
let launchOpener=null;
function mountLaunchPage(){
  const shell = document.querySelector('#launch-route-shell');
  const page = document.querySelector('#launch-dialog');
  if (shell && page && !shell.contains(page)) shell.append(page);
  if (page) page.dataset.step = String(launchStep);
  const preview = page?.querySelector('.launch-preview');
  const costSummary = page?.querySelector('#cost-summary');
  const previewEconomics = preview?.querySelector('.preview-economics');
  if (preview && costSummary && previewEconomics && !preview.contains(costSummary)) preview.insertBefore(costSummary, previewEconomics);
}
mountLaunchPage();
function openLaunchPage(event){
  event?.preventDefault();
  if(event?.currentTarget instanceof HTMLElement)launchOpener=event.currentTarget;
  if (location.hash !== '#launch') location.hash = '#launch'; else syncPageRoute();
  setLaunchStep(1);
}
function openBurnPageAfterLaunch(launchPolicy){
  const projectSelect = document.querySelector('#funded-burn-project');
  const mint = launchPolicy?.mint || '';
  if (projectSelect && mint && [...projectSelect.options].some(option => option.value === mint)) projectSelect.value = mint;
  if (location.hash !== '#buybacks') location.hash = '#buybacks';
  else syncPageRoute();
}
async function requestAirdrop(){
  if (!wallet) { await connectWallet(); if (!wallet) return; }
  const session = captureWalletSession();
  if (!session) return;
  const button = document.querySelector('#airdrop-button'); button.disabled = true;
  try { const { LAMPORTS_PER_SOL } = await getSolana(); assertWalletSessionCurrent(session); setLaunchStatus('Requesting 1 Devnet SOL…'); const signature = await connection.requestAirdrop(session.provider.publicKey, LAMPORTS_PER_SOL); await connection.confirmTransaction(signature, 'confirmed'); if (!isWalletSessionCurrent(session)) return; setLaunchLinks('Airdrop confirmed.', [{ label: 'View airdrop transaction on Explorer', href: explorer(`tx/${signature}`) }]); refreshWalletInfo(); }
  catch (error) { if (!isWalletSessionCurrent(session)) return; const message = String(error?.message || error); const lower = message.toLowerCase(); const faucetIssue = message.includes('429') || lower.includes('rate limit') || lower.includes('faucet') || lower.includes('internal error') || lower.includes('service unavailable') || lower.includes('timed out') || lower.includes('unsupported solana rpc request'); if (faucetIssue) setLaunchLinks('The API faucet is unavailable or disabled. Fund this Devnet wallet through the Solana Faucet.', [{ label: 'Open Solana Faucet', href: 'https://faucet.solana.com/' }], true); else setLaunchStatus(`Airdrop failed: ${message}`, true); } finally { button.disabled = false; }
}
async function launchToken(){
  if (APP_CLUSTER !== 'devnet') {
    setLaunchStatus('Mainnet coin launching is not available yet. Use the Devnet launch while Mainnet routing, metadata, and settlement are prepared.', true);
    return;
  }
  if (!wallet) { await connectWallet(); if (!wallet) return; }
  const session = captureWalletSession();
  if (!session || !canSignTransactions(session.provider)) { setLaunchStatus('Open this app inside a signing wallet to launch.', true); return; }
  const name = document.querySelector('#token-name').value.trim(); const symbol = document.querySelector('#token-symbol').value.trim().toUpperCase(); const supply = Number(document.querySelector('#token-supply').value); const decimals = Number(document.querySelector('#token-decimals').value);
  const metadataPreview = getLaunchMetadataPreview();
  const communityTokens = getCommunityAirdropTokens();
  const communityAllocation = getCommunityAllocationPercent();
  const xRecipient = normalizeXHandle(document.querySelector('#x-recipient').value);
  const fundedMint = getFundedMintAddress();
  const launchBurn = getLaunchBurnPolicy();
  const launchBurnValidation = validateLaunchBurnPolicy(launchBurn);
  const feeDistributionInput = getFeeDistributionInputs();
  const feeDistribution = validateFeeDistribution(feeDistributionInput);
  if (!document.querySelector('#fee-route-agree').checked) { setLaunchStatus('Confirm the funded.vip creator-fee route before launching.', true); return; }
  if (!document.querySelector('#terms-agree').checked) { setLaunchStatus('Agree to the Terms of Use before launching.', true); return; }
  if (!name || !/^[A-Z0-9]{1,10}$/.test(symbol) || !Number.isFinite(supply) || supply < 1 || decimals < 0 || decimals > 9) { setLaunchStatus('Enter a valid name and a 1–10 character ticker using letters or numbers.', true); return; }
  const invalidSocial = invalidLaunchSocial();
  if (invalidSocial) { updateLaunchSocialValidity(invalidSocial); invalidSocial.reportValidity(); setLaunchStatus(`${invalidSocial.getAttribute('aria-label') || 'Social link'} must be a complete http:// or https:// URL.`, true); return; }
  if (!Number.isSafeInteger(communityTokens) || communityTokens < MIN_COMMUNITY_AIRDROP_TOKENS || communityTokens > MAX_COMMUNITY_AIRDROP_TOKENS || !Number.isFinite(communityAllocation)) { setLaunchStatus('Community airdrop must be between 30,000,000 and 500,000,000 tokens.', true); return; }
   if (feeDistributionInput.solClaimPercent > 0 && !/^@[A-Za-z0-9_]{1,15}$/.test(xRecipient)) { setLaunchStatus('Enter a valid X handle such as @account when X account rewards are above 0%.', true); return; }
  if (feeDistributionInput.solClaimPercent > 0 && !xFeeStatus.ready) { setLaunchStatus(`X account rewards unavailable: ${xFeeStatus.reasons.join('; ')}.`, true); return; }
  if (!feeDistribution.valid) { setLaunchStatus('Creator fee shares must total exactly 80%. Check the wallet, holder, and X percentages.', true); return; }
  if (!launchBurnValidation.valid) { setLaunchStatus('The fixed $FUNDED mint must be configured before a paid launch tier can be used.', true); return; }
  if (launchBurn.requiresBurn && !launchBurnReadiness.ready) { setLaunchStatus(launchBurnReadiness.message, true); return; }
  if (!feeRouterState.verified || !feeRouterState.address) { setLaunchStatus('Launch blocked until the funded.vip fee-router PDA is deployed and verified on Devnet.', true); return; }
  const reviewedCost=launchCostReview;
  if(!freshLaunchReview(reviewedCost)){setLaunchStatus('Estimate expired. Refresh the launch estimate before signing.',true);return;}
  if (walletBalanceLamports == null || estimatedLaunchFeeLamports == null) { setLaunchStatus('Wallet balance and launch cost could not be verified. Refresh the estimate before signing.', true); return; }
  if (walletBalanceLamports != null && estimatedLaunchFeeLamports != null && walletBalanceLamports < estimatedLaunchFeeLamports) { setLaunchStatus('Insufficient Devnet SOL for this launch. Fund the wallet, then refresh the balance and fee estimate before signing.', true); return; }
  document.querySelector('#launch-button').disabled = true;
  let journalId;
  try {
    const [{ submitPumpDevnetLaunch }, { devnetExplorer }] = await Promise.all([import('./launch-flow.js'), import('./launch-core.js')]);
    assertWalletSessionCurrent(session);
    const pendingReferral = getAppReferralAttribution();
    if (pendingReferral?.wallet === session.address && !pendingReferral.serverVerified) {
      setLaunchStatus('Verifying your invite before launch…');
      await syncServerReferralState({ register: false });
      assertWalletSessionCurrent(session);
    }
    const creatorBuySol = getCreatorBuySol();
    if (!Number.isFinite(creatorBuySol) || creatorBuySol < 0) { setLaunchStatus('Developer buy must be a valid SOL amount of zero or more.', true); return; }
    const xLinked = feeDistributionInput.solClaimPercent > 0;
    let xUserId = null;
    if (xLinked) {
      setLaunchStatus('Resolving the X account to its stable user ID before signing…');
      const resolved = await apiRequest(`/api/x/resolve?handle=${encodeURIComponent(xRecipient)}`);
      assertWalletSessionCurrent(session);
      if (!resolved.available || !/^\d{1,24}$/.test(String(resolved.data?.id || '')) || resolved.data.handle.toLowerCase() !== xRecipient.toLowerCase()) throw new Error('X account identity could not be verified before launch. No coin transaction was sent.');
      xUserId = resolved.data.id;
    }
    const unresolved=readLaunchJournal().find(row=>row.payer===session.address&&row.name===name&&row.symbol===symbol&&['broadcasting','submitted','unknown','confirmed','verification-pending','registration-pending'].includes(row.state));
    if(unresolved)throw new Error('An earlier launch with this name and ticker needs recovery in Portfolio. Check its receipts before creating another coin.');
    if(!freshLaunchReview(reviewedCost))throw new Error('Estimate expired during identity lookup. Refresh and review again before signing.');
    journalId=crypto.randomUUID();recordLaunchEvent(journalId,{state:'prepared',name,symbol,payer:session.address,cluster:'devnet'});
    const result = await submitPumpDevnetLaunch({ cluster: APP_CLUSTER, connection, provider: session.provider, payer: session.provider.publicKey, input: { name, symbol, supply, decimals, initialBuySol: creatorBuySol, maxInitialBuyLamports:reviewedCost.buyMaximum }, prepareMetadata: input => prepareLaunchMetadata(input, session), feeRouterAddress: feeRouterState.address, feeRouterProgramId: FEE_ROUTER_PROGRAM_ID, useMintRouter: true, launchBurn, assertWalletCurrent: () => assertWalletSessionCurrent(session), onJournal:event=>recordLaunchEvent(journalId,event), onStatus: message => { if (isWalletSessionCurrent(session)) setLaunchStatus(message); } });
    const routeAddress = result.feeRouter.toBase58();
    const routeState = { ...feeRouterState, ...deriveMintFeeRouter(FEE_ROUTER_PROGRAM_ID, result.mint.publicKey), address: routeAddress, scope: 'per-mint-v2' };
    const launchPolicy = {
      chain: 'solana',
      cluster: 'devnet',
      launchpad: 'pump',
      mint: result.mint.publicKey.toBase58(),
      creatorWallet: session.address,
      name: result.name,
      symbol: result.symbol,
      metadataUri: result.metadataUri,
      metadataPreview,
      supply,
      decimals,
      initialBuy: result.initialBuy ? { percent: result.initialBuy.percent, amountTokens: result.initialBuy.amountTokens, amountBaseUnits: result.initialBuy.amountBaseUnits.toString(), solAmountLamports: result.initialBuy.solAmountLamports.toString() } : null,
      communityAllocation,
      communityAirdrop: buildCommunityAirdropPolicy({ allocationPercent: communityAllocation, supply }),
      launchReserve: buildLaunchReservePlan({ allocationPercent: communityAllocation, supply, mintAddress: result.mint.publicKey.toBase58() }),
      revenueBuyback: buildBuybackPolicy({ fundedMint: fundedMint || null }),
      creatorLaunchBurn: {
        ...launchBurn,
        status: result.launchBurnReceipt ? 'verified' : 'not-required',
        receipt: result.launchBurnReceipt,
      },
      fundedTokenMint: fundedMint || null,
      feeRouter: buildFeeRouterPolicy(routeState),
      feeDistribution: buildFeeDistributionPolicy({ ...feeDistributionInput, feeRouterAddress: routeAddress }),
      ...(xLinked ? { xUserId } : {}),
       solClaim: buildSolClaimPolicy({ handle: xRecipient, percent: feeDistributionInput.solClaimPercent, feeRouterAddress: routeAddress }),
      revenueModel: {
        fundedPercentOfCreatorFees: APP_ECONOMICS.fundedSharePercent,
        creatorConfigurablePercent: APP_ECONOMICS.creatorSharePercent,
        operationsPercentOfFundedRevenue: APP_ECONOMICS.operationsRateOfFundedRevenue,
        operationsEffectivePercentOfCreatorFees: APP_ECONOMICS.operationsEffectivePercent,
        referralNetworkPercentOfFundedRevenue: APP_ECONOMICS.appReferralRateOfFundedRevenue,
        referralNetworkEffectivePercentOfCreatorFees: APP_ECONOMICS.appReferralEffectivePercent,
        referralLevels: APP_ECONOMICS.appReferralLevels,
        communityPercentOfFundedRevenue: APP_ECONOMICS.communityRateOfFundedRevenue,
        communityEffectivePercentOfCreatorFees: APP_ECONOMICS.communityEffectivePercent,
        buybackPercentOfFundedRevenue: APP_ECONOMICS.buybackRateOfFundedRevenue,
        buybackEffectivePercentOfCreatorFees: APP_ECONOMICS.buybackEffectivePercent,
        status: 'pump-route-verified-settlement-program-required',
      },
      pumpFeeRoute: {
        percent: 100,
        router: routeAddress,
        scope: 'per-mint-v2',
        pumpCreator: result.feeRoute.creator,
        userHasCreatorFeeAuthority: result.feeRoute.userHasCreatorFeeAuthority,
        verified: result.feeRoute.verified,
        transaction: result.signature,
      },
      createdAt: new Date().toISOString(),
    };
    localStorage.setItem(`funded.launch.${launchPolicy.mint}`, JSON.stringify(launchPolicy));
    if (isWalletSessionCurrent(session)) renderCreatorLaunches();
    let persistedLaunch = { available: false };
    recordLaunchEvent(journalId,{state:'registration-pending',signature:result.signature});
    try {
      assertWalletSessionCurrent(session);
      if (typeof session.provider.signMessage !== 'function') throw new Error('Wallet message signing is required to register the immutable launch policy.');
      const policySignature = await session.provider.signMessage(new TextEncoder().encode(launchPolicyStatement(launchPolicy)));
      assertWalletSessionCurrent(session);
      launchPolicy.policySignature = bs58.encode(policySignature.signature || policySignature);
      localStorage.setItem(`funded.launch.${launchPolicy.mint}`, JSON.stringify(launchPolicy));
      persistedLaunch = await persistLaunchPolicy(launchPolicy);
      if(persistedLaunch.available){
        recordLaunchEvent(journalId,{state:'completed'});
        localStorage.removeItem(`funded.launch.${launchPolicy.mint}`);
      }
    } catch (policyError) {
      if (isWalletSessionCurrent(session)) setLaunchStatus(`Coin confirmed on Devnet, but policy registration is pending: ${policyError.message}`, true);
    }
    const tradeMint = document.querySelector('#trade-mint');
    if (tradeMint) tradeMint.value = launchPolicy.mint;
    if (persistedLaunch.available) await loadOnchainExploreData(); else renderRegistry();
    if (persistedLaunch.available) await loadVerifiedLaunchPolicies();
    if (isWalletSessionCurrent(session)) updateOnboardingProgress();
    if (!isWalletSessionCurrent(session)) { showToast(`${result.symbol} launched from ${session.address.slice(0, 4)}… while wallet account changed. Check your launch history.`); return; }
    const burnReceipt = result.launchBurnReceipt;
    const burnSummary = burnReceipt
      ? ` · ${formatLaunchBurnAmount(burnReceipt.amountTokens)} $FUNDED burned ${burnReceipt.atomicWithPumpLaunch ? 'atomically' : 'in a separately confirmed transaction'}`
      : '';
    const launchLinks = [
      { label: burnReceipt?.atomicWithPumpLaunch ? 'Verify launch and burn on Explorer ↗' : 'Verify fee owner on Explorer ↗', href: devnetExplorer(`tx/${result.signature}`) },
      ...(burnReceipt && !burnReceipt.atomicWithPumpLaunch ? [{ label: 'Verify separate $FUNDED burn on Explorer ↗', href: devnetExplorer(`tx/${burnReceipt.signature}`) }] : []),
      { label: 'View mint on Explorer ↗', href: devnetExplorer(`address/${result.mint.publicKey.toBase58()}`) },
      { label: 'Open My launches →', href: '#my-launches' },
      { label: 'Publish community airdrop →', href: '#airdrops' },
    ];
    setLaunchLinks(`Launch verified ✓\n${result.name} (${result.symbol}) is confirmed on Solana Devnet.\nMint: ${result.mint.publicKey.toBase58()}\nLaunch tier: ${launchBurn.label}${burnSummary}\nPump creator-fee owner: funded.vip router\nYour wallet has no creator-fee authority.\nCommunity policy: ${communityAllocation}% (${launchPolicy.communityAirdrop.reservedTokens.toLocaleString()} tokens)\nSettlement policy: 80% creator-directed / 20% app protocol${feeDistributionInput.solClaimPercent > 0 ? `\nSOL claim recipient: ${xRecipient}` : ''}`, launchLinks);
    document.querySelector('#launch-status').classList.add('launch-complete');
    showToast(persistedLaunch.available ? `${result.symbol} launched and listed in Explore` : `${result.symbol} launched on-chain; Explore listing is pending API verification`); renderAirdropClaims(); refreshWalletInfo(); openBurnPageAfterLaunch(launchPolicy);
  } catch (error) {
    let saved=readLaunchJournal().find(row=>row.id===journalId);
    if(journalId&&saved?.state==='prepared')saved=recordLaunchEvent(journalId,{state:'failed',message:error.message});
    const needsRecovery=Boolean(saved&&(saved.signature||saved.events?.some(event=>event.signature||['broadcasting','submitted','confirmed','verification-pending','registration-pending','unknown'].includes(event.state))));
    if (isWalletSessionCurrent(session)) {
      const message = `Launch stopped: ${error.message}${needsRecovery ? ' A transaction may have reached Devnet. Check its receipt before attempting another launch.' : ' No transaction was sent; correct the issue and retry.'}`;
      if (needsRecovery && saved?.signature) {
        setLaunchLinks(message, [{ label: 'Check transaction on Solana Explorer ↗', href: exploreExplorer(`tx/${encodeURIComponent(saved.signature)}`) }], true);
      } else setLaunchStatus(message, true);
    }
  } finally { updateLaunchButton(); }
}
async function simulateLaunch(){
  const name = document.querySelector('#token-name').value.trim(); const symbol = document.querySelector('#token-symbol').value.trim().toUpperCase(); const supply = Number(document.querySelector('#token-supply').value); const decimals = Number(document.querySelector('#token-decimals').value);
  try {
    const [{ Keypair, PublicKey, Transaction }, { PUMP_SDK }, { normalizeLaunchInput }] = await Promise.all([import('@solana/web3.js'), import('@pump-fun/pump-sdk'), import('./launch-core.js')]);
    const input = normalizeLaunchInput({ name, symbol, supply, decimals }); const payer = Keypair.generate(); const mint = Keypair.generate();
    const router = feeRouterState.address ? new PublicKey(feeRouterState.address) : Keypair.generate().publicKey;
    setLaunchStatus('Dry run: building one Pump launch with the router as creator-fee owner…');
    const createInstruction = await PUMP_SDK.createV2Instruction({ mint: mint.publicKey, name: input.name, symbol: input.symbol, uri: `https://funded.vip/devnet-metadata/${mint.publicKey.toBase58()}`, creator: router, user: payer.publicKey, mayhemMode: false, holderReward: false });
    const launchTransaction = new Transaction().add(createInstruction); const blockhash = Keypair.generate().publicKey.toBase58();
    launchTransaction.recentBlockhash = blockhash; launchTransaction.feePayer = payer.publicKey; launchTransaction.partialSign(mint, payer);
    const launchBytes = launchTransaction.serialize().length;
    setLaunchStatus(`Dry run passed for ${input.name} (${input.symbol}).\nMint: ${mint.publicKey.toBase58()}\nPump launch transaction: ${launchBytes} bytes\nPump creator-fee owner: ${router.toBase58()}\nPaying user is not the fee owner.${feeRouterState.verified ? '' : '\nTemporary dry-run address used; production router is not configured.'}\nNo network transaction was submitted.`); showToast('Pump fee-route dry run passed');
  } catch (error) { setLaunchStatus(`Dry run failed: ${error.message}`, true); }
}
window.addEventListener('funded:recover-registration',async event=>{
  const report=message=>window.dispatchEvent(new CustomEvent('funded:recovery-result',{detail:message}));
  try{
    const {mint,id}=event.detail||{};const row=readLaunchJournal().find(r=>r.id===id&&r.mint===mint&&r.state==='registration-pending');
    if(!row||row.cluster!=='devnet')throw new Error('No pending Devnet registration matches this request.');
    const policy=JSON.parse(localStorage.getItem(`funded.launch.${mint}`)||'null');if(!policyMatchesJournal(policy,row))throw new Error('Saved policy does not match this launch. Do not recreate the coin.');
    const session=captureWalletSession();if(!session||session.address!==row.payer)throw new Error('Connect the original launch wallet before registration.');assertWalletSessionCurrent(session);
    if(!policy.policySignature){if(typeof session.provider.signMessage!=='function')throw new Error('This wallet must support message signing.');const signed=await session.provider.signMessage(new TextEncoder().encode(launchPolicyStatement(policy)));assertWalletSessionCurrent(session);policy.policySignature=bs58.encode(signed.signature||signed);localStorage.setItem(`funded.launch.${mint}`,JSON.stringify(policy));}
    report('Checking the original launch and policy with the API. No coin transaction is being sent.');
    const result=await apiRequest('/api/launches',{method:'POST',body:policy});if(!result.available||result.data?.mint!==mint||!result.data?.onchainVerified)throw new Error('Registration is still pending verified API evidence.');
    recordLaunchEvent(id,{state:'completed'});report('Original launch registered. No duplicate launch was created.');void loadVerifiedLaunchPolicies();
  }catch(error){report(error.message);}
});

document.querySelector('#connect-button').onclick = connectWallet;
document.querySelector('#profile-connect')?.addEventListener('click', () => {
  if (connectedWalletAddress) document.querySelector('#profile-dialog')?.showModal();
  else void connectWallet();
});
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || !/^connect wallet/i.test(button.textContent.trim())) return;
  if (['connect-button', 'profile-connect', 'coin-trade-button', 'trade-submit', 'launch-button', 'airdrop-button', 'sol-claim-submit'].includes(button.id)) return;
  event.preventDefault();
  connectWallet();
});
document.querySelector('#mobile-wallet-close')?.addEventListener('click', () => { mobileWalletRequestVersion++; closeDialog('mobile-wallet-dialog'); });
document.querySelector('#mobile-wallet-copy')?.addEventListener('click', async () => { if (!mobileWalletLink) return; try { await navigator.clipboard.writeText(mobileWalletLink); showToast('Phantom request link copied'); } catch { showToast('Could not copy the Phantom request link.'); } });
document.querySelector('#launch-close').addEventListener('click', () => {
  requestPageRouteFocus();
  location.hash = '#overview';
  launchOpener=null;
});
document.querySelector('#airdrop-button').addEventListener('click', requestAirdrop);
document.querySelectorAll('#token-name, #token-symbol, #token-description, #token-tagline, #token-roadmap, #token-website, #token-x, #token-telegram, #token-discord, #x-recipient, #community-airdrop-tokens, #creator-buy-sol').forEach(input => input.addEventListener('input', () => {
  if (LAUNCH_SOCIAL_FIELDS.includes(input.id)) updateLaunchSocialValidity(input);
  if (input.matches('#community-airdrop-tokens')) syncCommunityAirdropPresets();
  updateLaunchPreview();
  updateCostSummary();
  updateLaunchButton();
  if (input.matches('#token-name, #token-symbol, #creator-buy-sol')) scheduleLaunchCostRefresh();
}));
document.querySelectorAll('[data-airdrop-tokens]').forEach(button => button.addEventListener('click', () => {
  const input = document.querySelector('#community-airdrop-tokens');
  if (!input) return;
  input.value = button.dataset.airdropTokens;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}));
document.querySelector('#token-image')?.addEventListener('change', async event => {
  const file = event.target.files?.[0];
  const preview = document.querySelector('#token-image-preview');
  const cardPreview = document.querySelector('#preview-token-image');
  const cardPlaceholder = document.querySelector('#preview-token-image-placeholder');
  if (!preview) return;
  const status=document.querySelector('#image-preparation-status');
  const removeButton=document.querySelector('#image-remove');
  if(removeButton)removeButton.disabled=!file;
  preview.style.backgroundImage='';preview.textContent=file?'…':'⌁';if(cardPreview){cardPreview.style.backgroundImage='';cardPreview.classList.remove('has-image');}if(cardPlaceholder)cardPlaceholder.hidden=false;if(status)status.textContent=file?'Preparing locally. Nothing is uploaded yet.':'No image selected.';
  try{const image=await prepareLaunchImage(file,{crop:document.querySelector('#image-square-crop')?.checked});if(file!==event.target.files?.[0])return;if(image){preview.textContent='';preview.style.backgroundImage=`url(${image.url})`;if(cardPreview){cardPreview.style.backgroundImage=`url(${image.url})`;cardPreview.classList.add('has-image');}if(cardPlaceholder)cardPlaceholder.hidden=true;if(status)status.textContent=`Ready: ${image.width} × ${image.height}, ${Math.ceil(image.file.size/1000)} KB. Review the preview before signing.`;}}
  catch(error){await prepareLaunchImage(null);event.target.value='';if(removeButton)removeButton.disabled=true;if(status)status.textContent=error.message;preview.textContent='!';}
  updateLaunchPreview();updateLaunchButton();
});
document.querySelector('#terms-agree').addEventListener('change', updateLaunchButton);
document.querySelector('#fee-route-agree').addEventListener('change', updateLaunchButton);
document.querySelector('#launch-next').addEventListener('click', () => setLaunchStep(launchStep + 1));
document.querySelector('#launch-back').addEventListener('click', () => setLaunchStep(launchStep - 1));
document.querySelector('#launch-mode-quick').addEventListener('click', () => setLaunchMode('quick'));
document.querySelector('#launch-mode-custom').addEventListener('click', () => setLaunchMode('custom'));
document.querySelectorAll('[data-launch-profile]').forEach(card => card.addEventListener('click', () => setLaunchProfile(card.dataset.launchProfile)));
setLaunchProfile('fast');
document.querySelectorAll('[data-burn-tier]').forEach(button => button.addEventListener('click', () => setLaunchBurnTier(button.dataset.burnTier)));
document.querySelectorAll('[data-launch-step-target]').forEach(button => button.addEventListener('click', () => { const target = Number(button.dataset.launchStepTarget); setLaunchStep(target); }));
document.querySelectorAll('[data-copy-referral-link]').forEach(button => button.addEventListener('click', async () => { const code = await referralCodeForShare(); if (!code) return; const link = buildReferralUrl(code); try { await navigator.clipboard.writeText(link); trackReferralEvent('invite_link_copied'); showToast('Invite link copied'); } catch { showToast(link); } }));
document.querySelector('#referral-share-native')?.addEventListener('click', async () => { const code = await referralCodeForShare(); if (!code) return; const link = buildReferralUrl(code); if (navigator.share) { try { await navigator.share({ title: 'Join funded.app', text: 'Launch with a transparent creator-fee route.', url: link }); trackReferralEvent('referral_command_center_shared'); } catch {} } else { try { await navigator.clipboard.writeText(link); showToast('Invite link copied'); } catch { showToast(link); } } });
document.querySelector('#referral-copy-code')?.addEventListener('click', async () => { const code = await referralCodeForShare(); if (!code) return; try { await navigator.clipboard.writeText(code); showToast('Referral code copied'); } catch { showToast(code); } });
document.querySelectorAll('[data-referral-campaign]').forEach(button => button.addEventListener('click', async () => { const code = await referralCodeForShare(); if (!code) return; const channel = button.dataset.referralCampaign; const link = buildReferralUrl(code, channel); try { await navigator.clipboard.writeText(link); trackReferralEvent('campaign_link_copied', { channel }); showToast(`${channel} campaign link copied`); } catch { showToast(link); } }));
function updateOnboardingProgress(){
  const steps = document.querySelectorAll('[data-onboarding-step]');
  if (!steps.length) return;
  const complete = { creator: canSignTransactions(wallet), launch: getWalletLaunchPolicies().length > 0, share: Boolean(getReferralCode()) };
  let count = 0;
  steps.forEach(step => { const done = Boolean(complete[step.dataset.onboardingStep]); step.classList.toggle('complete', done); if (done) count += 1; });
  const progress = document.querySelector('#onboarding-progress');
  if (progress) progress.textContent = `${count} of 3 complete`;
}
document.querySelectorAll('[data-role]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-role]').forEach(item => item.classList.toggle('active', item === button));
  const target = { creator: '#launch', referrer: '#referrals', community: '#airdrops' }[button.dataset.role];
  localStorage.setItem('funded.app.workspace.role', button.dataset.role);
  document.querySelector(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}));
document.querySelectorAll('.referral-share-row').forEach(row => {
  const actions = document.createElement('div');
  actions.className = 'referral-share-actions';
  const shareButton = document.createElement('button');
  shareButton.type = 'button'; shareButton.className = 'secondary-button'; shareButton.textContent = 'Share';
  shareButton.addEventListener('click', async () => {
    const code = await referralCodeForShare();
    if (!code) return;
    const link = `${window.location.origin}${window.location.pathname}?ref=${code}`;
    const text = 'Launch a coin on funded.vip and grow with a transparent creator-fee model.';
    if (navigator.share) { try { await navigator.share({ title: 'Join funded.vip', text, url: link }); trackReferralEvent('invite_shared'); } catch {} }
    else { trackReferralEvent('invite_shared_x'); window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(link)}`, '_blank', 'noopener,noreferrer'); }
  });
  const messageButton = document.createElement('button');
  messageButton.type = 'button'; messageButton.className = 'secondary-button'; messageButton.textContent = 'Copy message';
  messageButton.addEventListener('click', async () => {
    const code = await referralCodeForShare();
    if (!code) return;
    const link = `${window.location.origin}${window.location.pathname}?ref=${code}`;
    const message = `Join me on funded.vip to launch a coin: ${link}`;
    try { await navigator.clipboard.writeText(message); trackReferralEvent('invite_message_copied'); showToast('Invite message copied'); } catch { showToast(message); }
  });
  actions.append(shareButton, messageButton); row.append(actions);
});
const fundedMintInput = document.querySelector('#funded-mint-address');
if (fundedMintInput) { fundedMintInput.value = getFundedMintAddress(); updateFundedMintConfig(); }
function updateLaunchPolicyControls(){
  const xShare = Number(document.querySelector('#x-share')?.value) || 0;
  document.querySelector('#x-recipient').disabled = xShare <= 0;
  updateLaunchPreview();
  updateLaunchButton();
}
document.querySelectorAll('#creator-wallet-share, #holder-airdrop-share, #x-share, #x-recipient').forEach(input => input.addEventListener('input', updateLaunchPolicyControls));
document.querySelectorAll('[data-info]').forEach(link => link.addEventListener('click', event => { event.preventDefault(); openInfoDialog(link.dataset.info); }));
document.querySelector('#info-close').addEventListener('click', closeInfoDialog);
document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => closeDialog(button.dataset.closeDialog)));
document.querySelector('#open-tape').addEventListener('click', () => document.querySelector('#payment-dialog').showModal());
document.querySelector('.notification').addEventListener('click', () => document.querySelector('#notification-dialog').showModal());
document.querySelector('.profile-row').addEventListener('click', event => { event.preventDefault(); document.querySelector('#profile-dialog').showModal(); });
document.querySelector('#profile-disconnect')?.addEventListener('click', async () => {
  await disconnectWallet();
  document.querySelector('#profile-dialog')?.close();
});
document.querySelector('#wallet-popover-disconnect')?.addEventListener('click', async () => {
  await disconnectWallet();
});
document.querySelector('#wallet-popover-detail-link')?.addEventListener('click', event => {
  if (!connectedWalletAddress) return;
  event.preventDefault();
  walletDetailTab = 'activity';
  history.pushState({}, '', `/wallet/${encodeURIComponent(connectedWalletAddress)}`);
  showWalletPage();
});
document.querySelector('#wallet-popover')?.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
  const popover = document.querySelector('#wallet-popover');
  const trigger = document.querySelector('#connect-button');
  if (popover) popover.hidden = true;
  trigger?.setAttribute('aria-expanded', 'false');
}));
document.addEventListener('click', event => {
  const popover = document.querySelector('#wallet-popover');
  const trigger = document.querySelector('#connect-button');
  if (!popover || popover.hidden || trigger?.contains(event.target) || popover.contains(event.target)) return;
  popover.hidden = true;
  trigger?.setAttribute('aria-expanded', 'false');
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  const popover = document.querySelector('#wallet-popover');
  const trigger = document.querySelector('#connect-button');
  if (!popover || popover.hidden) return;
  popover.hidden = true;
  trigger?.setAttribute('aria-expanded', 'false');
  trigger?.focus();
});
document.querySelector('#profile-copy-address')?.addEventListener('click', async () => {
  const address = connectedWalletAddress;
  if (!address) return showToast('Connect your wallet to copy its address');
  try { await navigator.clipboard.writeText(address); showToast('Wallet address copied'); } catch { showToast(address); }
});
document.querySelector('#launch-button').addEventListener('click', handleLaunchAction);
document.querySelector('#launch-review-close')?.addEventListener('click', closeLaunchReview);
document.querySelector('#launch-review-cancel')?.addEventListener('click', closeLaunchReview);
document.querySelector('#launch-review-dialog')?.addEventListener('close', () => { pendingLaunchReview = null; });
document.querySelector('#launch-review-confirm')?.addEventListener('click', confirmLaunchReview);
document.querySelector('#simulate-button')?.addEventListener('click', simulateLaunch);
document.querySelector('#trade-submit')?.addEventListener('click', openTradeReview);
document.querySelector('#trade-review-close')?.addEventListener('click', () => document.querySelector('#trade-review-dialog')?.close());
document.querySelector('#trade-review-cancel')?.addEventListener('click', () => document.querySelector('#trade-review-dialog')?.close());
document.querySelector('#trade-review-confirm')?.addEventListener('click', () => {
  document.querySelector('#trade-review-dialog')?.close();
  void executeTrade();
});
document.querySelector('#sol-claim-submit')?.addEventListener('click', submitSolClaim);
function resetSolClaimStatus() {
  const status = document.querySelector('#sol-claim-status');
  if(status){
    const connected=document.querySelector('#x-sign-in')?.dataset.connected==='true';
    const chosen=Boolean(document.querySelector('#sol-claim-id')?.value?.trim());
    const address=captureWalletSession()?.address;
    const agreed=document.querySelector('#claim-binding-agree')?.checked;
    const readyCount=document.querySelectorAll('#sol-claim-list .x-claim-reward-state.ready').length;
    const paidCount=document.querySelectorAll('#sol-claim-list .x-claim-reward-state.paid').length;
    status.textContent=!connected?'Sign in with X to see your rewards.':!chosen?(readyCount?'Choose an available reward above.':paidCount?'Your listed reward has been paid. No other rewards are ready to claim.':'No rewards are ready to claim yet. Check back after creator fees are collected.'):!address?'Connect the wallet that should receive this payment.':!agreed?'Confirm the receiving wallet above.':'Ready to verify. Phantom will ask you to approve a message; signing does not spend SOL.';
  }
  syncXClaimFlow();
}
for (const id of ['sol-claim-x-account', 'sol-claim-id']) {
  document.getElementById(id)?.addEventListener('input', () => { updateClaimBindingReview(); resetSolClaimStatus(); });
}
document.addEventListener('change', event => {
  if (event.target?.id === 'claim-binding-agree') resetSolClaimStatus();
});
document.querySelector('#trade-side')?.addEventListener('change', updateTradeAmountLabel);
document.querySelectorAll('[data-coin-trade-side]').forEach(button => button.addEventListener('click', () => {
  const side = button.dataset.coinTradeSide;
  const select = document.querySelector('#trade-side');
  if (!select || !['buy', 'sell'].includes(side) || select.value === side) return;
  select.value = side;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  select.dispatchEvent(new Event('input', { bubbles: true }));
  const amount = document.querySelector('#trade-amount');
  if (amount) { amount.value = ''; amount.dispatchEvent(new Event('input', { bubbles: true })); }
  setTradeStatus(`Enter a ${side === 'buy' ? 'SOL' : 'token'} amount to calculate a live quote.`);
}));
document.querySelectorAll('[data-coin-buy-amount]').forEach(button => button.addEventListener('click', () => {
  if (document.querySelector('#trade-side')?.value !== 'buy') return;
  const amount = document.querySelector('#trade-amount');
  if (!amount) return;
  amount.value = button.dataset.coinBuyAmount;
  amount.dispatchEvent(new Event('input', { bubbles: true }));
  setTradeStatus('Quick amount selected. Calculating a live quote.');
}));
document.querySelectorAll('[data-coin-sell-percent]').forEach(button => button.addEventListener('click', () => {
  if (document.querySelector('#trade-side')?.value !== 'sell' || tradeBalanceState.key !== tradeBalanceKey() || tradeBalanceState.tokenRaw == null) return;
  const value = tokenBalancePercentage(tradeBalanceState.tokenRaw, tradeBalanceState.tokenDecimals, Number(button.dataset.coinSellPercent));
  const amount = document.querySelector('#trade-amount');
  if (!amount) return;
  amount.value = formatTradeAmountInput(value);
  amount.dispatchEvent(new Event('input', { bubbles:true }));
}));
function syncTradeSlippagePresets(){
  const value = Number(document.querySelector('#trade-slippage')?.value);
  document.querySelectorAll('[data-coin-slippage]').forEach(button => {
    const active = Number(button.dataset.coinSlippage) === value;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}
document.querySelectorAll('[data-coin-slippage]').forEach(button => button.addEventListener('click', () => {
  const input = document.querySelector('#trade-slippage');
  if (!input) return;
  input.value = button.dataset.coinSlippage;
  input.dispatchEvent(new Event('input', { bubbles:true }));
}));
document.querySelector('#trade-slippage')?.addEventListener('input', syncTradeSlippagePresets);
document.querySelector('#trade-mint')?.addEventListener('change', () => { setTradeStatus('Mint selected. Calculating a live quote.'); void refreshTradeBalances(); });
document.querySelector('#trade-amount')?.addEventListener('input', event => {
  const input = event.currentTarget;
  const caret = input.selectionStart;
  const formatted = formatTradeAmountInput(input.value);
  if (formatted === input.value) return;
  const formattedPrefix = caret == null ? formatted : formatTradeAmountInput(input.value.slice(0, caret));
  input.value = formatted;
  if (caret != null) input.setSelectionRange(formattedPrefix.length, formattedPrefix.length);
});
const restoredTradeAmount = document.querySelector('#trade-amount');
if (restoredTradeAmount?.value) restoredTradeAmount.value = formatTradeAmountInput(restoredTradeAmount.value);
document.querySelectorAll('#trade-mint, #trade-amount, #trade-slippage, #trade-side').forEach(input => input.addEventListener('input', () => {
  invalidateTradePreview();
  renderTradeBalances();
  if (tradeInputs().valid) { setTradeStatus(wallet ? 'Calculating a live quote…' : 'Connect a signing wallet to calculate the SOL amount.'); queueTradeQuote(); }
  else setTradeStatus('Enter a positive amount and slippage between 0.1% and 10%.');
}));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !tradeActionBusy && !document.querySelector('#trade-review-dialog')?.open && (!tradePreview || Date.now() - tradePreview.preparedAt >= 12_000)) { invalidateTradePreview(); queueTradeQuote(0); }
});
updateTradeAmountLabel();
syncTradeSlippagePresets();
queueTradeQuote();
normalizePreviewLabels();
const pendingTradeMint = sessionStorage.getItem('funded.pendingTradeMint');
if (pendingTradeMint && document.querySelector('#trade-mint')) {
  document.querySelector('#trade-mint').value = pendingTradeMint;
  void refreshTradeBalances();
  sessionStorage.removeItem('funded.pendingTradeMint');
  setTradeStatus('Mint selected. Calculating a live quote.');
  invalidateTradePreview();
  queueTradeQuote();
  setTimeout(() => document.querySelector('#trade-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
}
document.querySelectorAll('a[href="#launch"]').forEach(link => link.addEventListener('click', openLaunchPage));
document.querySelector('#launch-form').addEventListener('submit', event => event.preventDefault());
function updateExploreViews(force = false){ renderExploreAssets({ force }); renderRegistry(); }
function clearExploreFilters(){
  exploreQuery = '';
  exploreRisk = 'all';
  exploreStage = 'all';
  exploreAuthority = 'all';
  explorePromotion = 'all';
  exploreReward = 'all';
  exploreWindow = '24h';
  exploreTab = 'trending';
  exploreNewLane = 'launch';
  exploreMaxAgeHours = null;
  exploreMinVolumeSol = null;
  exploreMinCurveCapSol = null;
  exploreMinTrades = null;
  exploreMinTraders = null;
  exploreSort = document.querySelector('#explore-sort option[value="volume"]:not(:disabled)') ? 'volume' : 'recent-trade';
  for (const selector of ['#global-search', '#explore-search', '#explore-min-volume-sol', '#explore-min-cap-sol', '#explore-min-trades', '#explore-min-traders', '#explore-max-age-hours']) {
    const input = document.querySelector(selector);
    if (input) input.value = '';
  }
  document.querySelector('#explore-risk-filter').value = 'all';
  document.querySelector('#explore-authority-filter').value = 'all';
  document.querySelector('#explore-promotion-filter').value = 'all';
  document.querySelector('#explore-reward-filter').value = 'all';
  document.querySelector('#explore-sort').value = exploreSort;
  document.querySelectorAll('[data-explore-stage]').forEach(button => { const active = button.dataset.exploreStage === exploreStage; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  document.querySelectorAll('.explore-tabs [data-explore-tab]').forEach(button => { const active = button.dataset.exploreTab === exploreTab; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  updateExploreViews(true);
  document.querySelector('#explore')?.dispatchEvent(new Event('funded:explore-filters-cleared'));
  refreshExploreFeedForSort();
}
function refreshExploreFeedForSort(){
  const required = exploreSort === 'newest' ? 'created_timestamp' : 'last_trade_timestamp';
  if (exploreFeedSort !== required) loadOnchainExploreData().catch(() => showToast('Launch feed could not refresh.'));
}
function readOptionalSolFilter(selector, { integer = false } = {}){
  const input = document.querySelector(selector);
  const value = input?.value.trim();
  if (!value) return null;
  const number = Number(value);
  if (Number.isFinite(number) && number >= 0 && (!integer || Number.isInteger(number))) return number;
  input.value = '';
  showToast(integer ? 'Enter a whole-number minimum of 0 or more.' : 'Enter a minimum of 0 or more.');
  return null;
}
function openExploreTrade(mint){
  if (!assets.some(item => item.address === mint)) return;
  sessionStorage.setItem('funded.pendingTradeMint', mint);
  window.location.assign(`/token/${encodeURIComponent(mint)}`);
}
document.querySelector('#global-search').addEventListener('input', event => {
  exploreQuery = event.target.value;
  const field = document.querySelector('#explore-search');
  if (field) field.value = exploreQuery;
  if (exploreQuery && location.hash !== '#explore' && !/^\/explore\/?$/.test(location.pathname)) location.hash = '#explore';
  updateExploreViews();
});
document.querySelector('#search-shortcut').textContent = /Mac|iPhone|iPad/i.test(navigator.platform) ? '⌘ K' : 'Ctrl K';
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    document.querySelector('#global-search').focus();
    document.querySelector('#global-search').select();
  }
});
document.querySelector('#explore-search')?.addEventListener('input', event => {
  exploreQuery = event.target.value;
  const field = document.querySelector('#global-search');
  if (field && field.value !== exploreQuery) field.value = exploreQuery;
  updateExploreViews();
});
document.querySelector('#explore-refresh')?.addEventListener('click', async event => { const button = event.currentTarget; button.disabled = true; try { await loadOnchainExploreData(); await renderStonkEnhancements(); } catch { showToast('Refresh could not verify Devnet data.'); } finally { button.disabled = false; } });
document.querySelector('#explore-sort')?.addEventListener('change', event => { exploreSort = event.target.value; updateExploreViews(); refreshExploreFeedForSort(); });
document.querySelectorAll('[data-explore-sort]').forEach(button => button.addEventListener('click', () => {
  if (button.disabled) return;
  exploreSort = button.dataset.exploreSort;
  const select = document.querySelector('#explore-sort');
  if (select) select.value = exploreSort;
  updateExploreViews();
  refreshExploreFeedForSort();
}));
document.querySelector('#explore-risk-filter')?.addEventListener('change', event => { exploreRisk = event.target.value; updateExploreViews(); });
document.querySelector('#explore-promotion-filter')?.addEventListener('change', event => { explorePromotion = event.target.value; updateExploreViews(); });
document.querySelector('#explore-reward-filter')?.addEventListener('change', event => { exploreReward = event.target.value; updateExploreViews(); });
document.querySelectorAll('[data-explore-window]').forEach(button => button.addEventListener('click', () => {
  if (EXPLORE_CLUSTER !== 'devnet' || !['1h', '6h', '24h'].includes(button.dataset.exploreWindow)) return;
  exploreWindow = button.dataset.exploreWindow;
  updateExploreSortAvailability();
  updateExploreViews();
}));
document.querySelector('#explore-authority-filter')?.addEventListener('change', event => { exploreAuthority = event.target.value; updateExploreViews(); });
document.querySelector('#explore-max-age-hours')?.addEventListener('change', event => { exploreMaxAgeHours = event.target.value ? Number(event.target.value) : null; updateExploreViews(); });
document.querySelector('#explore-min-volume-sol')?.addEventListener('input', () => { exploreMinVolumeSol = readOptionalSolFilter('#explore-min-volume-sol'); updateExploreViews(); });
document.querySelector('#explore-min-cap-sol')?.addEventListener('input', () => { exploreMinCurveCapSol = readOptionalSolFilter('#explore-min-cap-sol'); updateExploreViews(); });
document.querySelector('#explore-min-trades')?.addEventListener('input', () => {
  exploreMinTrades = readOptionalSolFilter('#explore-min-trades', { integer: true });
  updateExploreViews();
});
document.querySelector('#explore-min-traders')?.addEventListener('input', () => {
  exploreMinTraders = readOptionalSolFilter('#explore-min-traders', { integer: true });
  updateExploreViews();
});
document.querySelector('#explore-clear-filters')?.addEventListener('click', () => clearExploreFilters());
function setExploreFilterOpen(open){
  const popover = document.querySelector('#explore-filter-popover');
  const toggle = document.querySelector('#explore-filter-toggle');
  if (!popover || !toggle) return;
  popover.hidden = !open;
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Close launch filters' : 'Open launch filters');
}
document.querySelector('#explore-filter-toggle')?.addEventListener('click', event => {
  event.stopPropagation();
  const popover = document.querySelector('#explore-filter-popover');
  setExploreFilterOpen(Boolean(popover?.hidden));
});
document.querySelector('#explore-filter-close')?.addEventListener('click', () => {
  setExploreFilterOpen(false);
  document.querySelector('#explore-filter-toggle')?.focus();
});
document.addEventListener('click', event => {
  const popover = document.querySelector('#explore-filter-popover');
  if (!popover || popover.hidden || document.querySelector('.explore-filter-wrap')?.contains(event.target)) return;
  setExploreFilterOpen(false);
});
document.addEventListener('keydown', event => {
  const popover = document.querySelector('#explore-filter-popover');
  if (event.key !== 'Escape' || !popover || popover.hidden) return;
  setExploreFilterOpen(false);
  document.querySelector('#explore-filter-toggle')?.focus();
});
document.querySelector('#explore-pulse')?.addEventListener('click', event => {
  const button = event.target.closest('[data-explore-lane]');
  if (!button) return;
  exploreTab = 'new';
  exploreNewLane = button.dataset.exploreLane;
  exploreSort = 'newest';
  document.querySelector('#explore-sort').value = exploreSort;
  updateExploreViews();
  refreshExploreFeedForSort();
});
document.querySelector('#explore-auto-refresh')?.addEventListener('click', event => {
  exploreAutoRefresh = !exploreAutoRefresh;
  event.currentTarget.textContent = `Auto-refresh ${exploreAutoRefresh ? 'on' : 'paused'}`;
  event.currentTarget.setAttribute('aria-pressed', String(exploreAutoRefresh));
});
document.querySelectorAll('[data-explore-view]').forEach(button => button.addEventListener('click', () => { exploreView = button.dataset.exploreView; renderExploreControls(); }));
document.querySelector('#explore-benefit-leaders')?.addEventListener('click', event => {
  const button = event.target.closest('[data-explore-leader-sort]');
  if (!button || button.disabled) return;
  exploreSort = button.dataset.exploreLeaderSort;
  const select = document.querySelector('#explore-sort');
  if (select) select.value = exploreSort;
  updateExploreViews();
  refreshExploreFeedForSort();
});
document.querySelectorAll('[data-explore-stage]').forEach(button => button.addEventListener('click', () => { exploreStage = button.dataset.exploreStage; document.querySelectorAll('[data-explore-stage]').forEach(item => { const active = item === button; item.classList.toggle('active', active); item.setAttribute('aria-pressed', String(active)); }); updateExploreViews(); }));
document.querySelectorAll('.explore-tabs [data-explore-tab]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.explore-tabs [data-explore-tab]').forEach(item => { const active = item === button; item.classList.toggle('active', active); item.setAttribute('aria-pressed', String(active)); });
  const tab = button.dataset.exploreTab;
  exploreTab = tab;
  if (tab === 'new') { exploreSort = 'newest'; document.querySelector('#explore-sort').value = 'newest'; }
  else { exploreSort = document.querySelector('#explore-sort option[value="volume"]:not(:disabled)') ? 'volume' : 'recent-trade'; document.querySelector('#explore-sort').value = exploreSort; }
  updateExploreViews();
  refreshExploreFeedForSort();
}));
document.querySelectorAll('.registry-order button').forEach(button => button.addEventListener('click', () => {
  if (button.disabled) return;
  document.querySelectorAll('.registry-order button').forEach(item => item.classList.toggle('active', item === button));
  registrySort = button.dataset.registrySort;
  renderRegistry();
}));
document.querySelector('#asset-grid').addEventListener('click', event => {
  const button = event.target.closest('.watch-button');
  const share = event.target.closest('.share-asset');
  const trade = event.target.closest('[data-trade-mint]');
  const emptyAction = event.target.closest('[data-explore-empty-action]');
  if (emptyAction) { if (emptyAction.dataset.exploreEmptyAction === 'clear') clearExploreFilters(); else document.querySelector('#explore-refresh')?.click(); return; }
  if (trade) { openExploreTrade(trade.dataset.tradeMint); return; }
  if (share) {
    const symbol = share.dataset.shareSymbol;
    const url = `${window.location.origin}/token/${encodeURIComponent(share.dataset.shareMint || '')}`;
    if (navigator.share) navigator.share({ title: `${symbol} on funded.vip`, text: `Inspect ${symbol} on funded.vip`, url }).catch(() => {});
    else navigator.clipboard?.writeText(url).then(() => showToast(`${symbol} link copied`)).catch(() => showToast(url));
    return;
  }
 if (!button) return;
  toggleExploreWatch(button.dataset.mint);
});
function toggleExploreWatch(mint){
  const asset = assets.find(item => item.address === mint);
  const symbol = asset?.symbol || 'TOKEN';
  const saved = getWatchlist();
  const next = saved.includes(mint) ? saved.filter(item => item !== mint) : [...saved, mint];
  saveWatchlist(next);
  updateExploreViews();
  showToast(next.includes(mint) ? `${symbol} saved to your watchlist` : `${symbol} removed from your watchlist`);
}
document.querySelector('#watchlist-items').addEventListener('click', event => {
  const trade = event.target.closest('[data-trade-mint]');
  if (trade) { openExploreTrade(trade.dataset.tradeMint); return; }
  const button = event.target.closest('[data-remove-watch]');
  if (!button) return;
  saveWatchlist(getWatchlist().filter(item => item !== button.dataset.removeWatch));
  updateExploreViews();
});
document.querySelector('#creator-launch-empty')?.addEventListener('click', event => {
  const watch = event.target.closest('.watch-button');
  if (watch) { toggleExploreWatch(watch.dataset.mint); return; }
  const trade = event.target.closest('[data-trade-mint]');
  if (trade) { openExploreTrade(trade.dataset.tradeMint); return; }
  if (event.target.closest('button, a')) return;
  const mint = event.target.closest('.asset-card')?.dataset.mint;
  if (mint) location.href = `/token/${encodeURIComponent(mint)}`;
});
document.querySelector('#home-launch-grid')?.addEventListener('click', event => {
  const trade = event.target.closest('[data-trade-mint]');
  if (trade) openExploreTrade(trade.dataset.tradeMint);
});
document.querySelector('#airdrop-claim-list')?.addEventListener('click', event => {
  const button = event.target.closest('[data-preview-claim]');
  if (!button) return;
  const claims = getPreviewClaims();
  claims[button.dataset.previewClaim] = { claimedAt: new Date().toISOString(), mode: 'local-preview' };
  localStorage.setItem(AIRDROP_PREVIEW_CLAIM_KEY, JSON.stringify(claims));
  renderAirdropClaims();
  showToast('Claim preview completed — no tokens were transferred');
});
document.querySelectorAll('[data-airdrop-filter]').forEach(button => button.addEventListener('click', () => renderAirdropClaims(button.dataset.airdropFilter)));
document.querySelector('#airdrop-search')?.addEventListener('input', () => {
  document.querySelector('#airdrop-selected-program').hidden = true;
  renderAirdropDirectory();
});
document.querySelector('#airdrop-sort')?.addEventListener('change', () => renderAirdropDirectory());
document.querySelector('#airdrop-directory')?.addEventListener('click', event => {
  const button = event.target.closest('[data-directory-mint]');
  if (!button) return;
  const program = getAirdropPrograms().find(item => item.id === button.dataset.directoryMint);
  if (!program) return;
  renderAirdropProgramDetail(program);
});
document.querySelector('#airdrop-detail-close')?.addEventListener('click', () => { document.querySelector('#airdrop-selected-program').hidden = true; });
document.querySelector('#airdrop-selected-status')?.addEventListener('click', event => {
  const button = event.target.closest('[data-fund-community-mint]');
  if (button) void fundCommunityReserve(button.dataset.fundCommunityMint);
});
document.querySelector('#leaderboard-sort')?.addEventListener('change', () => renderAirdropAnalytics());
document.querySelector('#leaderboard-private')?.addEventListener('change', () => renderAirdropAnalytics());
document.querySelector('#airdrop-export-csv')?.addEventListener('click', exportAirdropCsv);
document.querySelector('#toggle-airdrop-wizard')?.addEventListener('click', event => {
  const wizard = document.querySelector('#airdrop-wizard');
  if (!wizard) return;
  wizard.hidden = !wizard.hidden;
  event.currentTarget.textContent = wizard.hidden ? 'Open wizard' : 'Close wizard';
  event.currentTarget.setAttribute('aria-expanded', String(!wizard.hidden));
});
function resetAirdropWizardStatus(event) {
  if (!event.target.matches('input, select, textarea')) return;
  const status = document.querySelector('#wizard-status');
  if (status) status.textContent = 'Changes are local until saved. Production publishing is not connected.';
}
document.querySelector('#airdrop-wizard')?.addEventListener('input', resetAirdropWizardStatus);
document.querySelector('#airdrop-wizard')?.addEventListener('change', resetAirdropWizardStatus);
const communityClaimWindow = document.querySelector('#wizard-window');
if (communityClaimWindow) { communityClaimWindow.value = '90'; communityClaimWindow.readOnly = true; communityClaimWindow.title = 'Community claims close 90 days after migration.'; }
document.querySelector('#save-airdrop-draft')?.addEventListener('click', () => {
  const draft = {
    name: document.querySelector('#wizard-token-name')?.value.trim(),
    symbol: document.querySelector('#wizard-token-symbol')?.value.trim().toUpperCase(),
    allocationPercent: Number(document.querySelector('#wizard-allocation')?.value),
    claimWindowDays: Number(document.querySelector('#wizard-window')?.value),
    snapshotRule: document.querySelector('#wizard-snapshot')?.value,
    vesting: document.querySelector('#wizard-vesting')?.value,
    minimumHolding: Boolean(document.querySelector('#wizard-min-hold')?.checked),
    maxWallet: Boolean(document.querySelector('#wizard-max-wallet')?.checked),
    sybilScreening: Boolean(document.querySelector('#wizard-sybil')?.checked),
    savedAt: new Date().toISOString(),
  };
  if (!draft.name || !/^[A-Z0-9]{1,8}$/.test(draft.symbol) || !Number.isFinite(draft.allocationPercent) || draft.allocationPercent < 3 || draft.allocationPercent > 50) {
    document.querySelector('#wizard-status').textContent = 'Add a token name, a 1–8 character ticker using letters or numbers, and an allocation between 3% and 50%.';
    return;
  }
  if (draft.claimWindowDays !== 90) {
    document.querySelector('#wizard-status').textContent = 'The community claim window is fixed at 90 days after migration.';
    return;
  }
  localStorage.setItem('funded.airdrop.draft', JSON.stringify(draft));
  document.querySelector('#wizard-status').textContent = `Draft saved locally for ${draft.name} (${draft.symbol}). Production publishing is not connected.`;
  showToast('Airdrop draft saved locally');
});
document.querySelector('#restore-airdrop-draft')?.addEventListener('click', () => {
  const status = document.querySelector('#wizard-status');
  let draft;
  try {
    draft = JSON.parse(localStorage.getItem('funded.airdrop.draft') || 'null');
  } catch {
    status.textContent = 'Saved draft is unreadable. Delete it and save a new draft.';
    return;
  }
  if (!draft || typeof draft.name !== 'string' || typeof draft.symbol !== 'string') {
    status.textContent = 'No saved airdrop draft on this device.';
    return;
  }
  document.querySelector('#wizard-token-name').value = draft.name;
  document.querySelector('#wizard-token-symbol').value = draft.symbol;
  document.querySelector('#wizard-allocation').value = String(draft.allocationPercent ?? 3);
  document.querySelector('#wizard-window').value = '90';
  const snapshot = document.querySelector('#wizard-snapshot');
  if (Array.from(snapshot.options).some(option => option.value === draft.snapshotRule)) snapshot.value = draft.snapshotRule;
  const vesting = document.querySelector('#wizard-vesting');
  if (Array.from(vesting.options).some(option => option.value === draft.vesting)) vesting.value = draft.vesting;
  document.querySelector('#wizard-min-hold').checked = Boolean(draft.minimumHolding);
  document.querySelector('#wizard-max-wallet').checked = Boolean(draft.maxWallet);
  document.querySelector('#wizard-sybil').checked = draft.sybilScreening !== false;
  status.textContent = `Draft restored for ${draft.name} (${draft.symbol}). Review all fields before saving again.`;
});
document.querySelector('#delete-airdrop-draft')?.addEventListener('click', () => {
  localStorage.removeItem('funded.airdrop.draft');
  document.querySelector('#wizard-status').textContent = 'Saved airdrop draft deleted. Current form is unchanged.';
});
document.querySelector('#buyback-add-claim')?.addEventListener('click', recordBuybackPreviewClaim);
document.querySelector('#buyback-run-preview')?.addEventListener('click', runBuybackPreview);
document.querySelector('#buyback-example-fees')?.addEventListener('input', renderBuybackExample);
document.querySelector('#funded-burn-amount')?.addEventListener('input', updateFundedBurnButton);
document.querySelector('#funded-burn-submit')?.addEventListener('click', submitFundedBurn);
document.querySelector('#funded-buy-amount')?.addEventListener('input', () => { fundedBuyPreview = null; renderFundedBuyControl('Preview the current Devnet pool quote before signing.'); });
document.querySelector('#funded-buy-submit')?.addEventListener('click', handleFundedBuy);
document.querySelector('#referral-example-input').addEventListener('input', event => {
  const fees = Math.max(0, Number(event.target.value) || 0);
  const fundedRevenue = fees * APP_ECONOMICS.fundedSharePercent / 100;
  APP_ECONOMICS.appReferralLevels.forEach(level => {
    const output = document.querySelector(`#referral-level-${level.level}-output`);
    if (output) output.textContent = `$${(fundedRevenue * level.percentOfFundedRevenue / 100).toFixed(2)}`;
  });
});
document.querySelector('#fee-flow-input')?.addEventListener('input', renderFeeFlowCalculator);
document.querySelector('#manage-alerts').addEventListener('click', () => showToast('Alerts are ready for the indexed-data phase.'));
document.querySelector('#launch-list').addEventListener('click', async event => {
  const watch = event.target.closest('.scanner-watch');
  if (watch) { toggleExploreWatch(watch.dataset.mint); return; }
  const copy = event.target.closest('.copy-row');
  if (copy) {
    try { await navigator.clipboard.writeText(copy.dataset.mint); showToast('Mint address copied'); } catch { showToast(copy.dataset.mint); }
    return;
  }
  const trade = event.target.closest('[data-trade-mint]');
  if (trade) {
    openExploreTrade(trade.dataset.tradeMint);
  }
});
document.querySelectorAll('.quick-card, .text-button').forEach(el => el.addEventListener('click', () => { if (el.classList.contains('text-button')) showToast('View updated.'); }));
document.querySelectorAll('.segmented button:not(.explore-tabs button):not(.registry-order button):not(.explore-timeframe button):not(.explore-view-switch button)').forEach(button => button.addEventListener('click', () => { button.parentElement.querySelector('.active')?.classList.remove('active'); button.classList.add('active'); showToast(`${button.textContent} view selected`); }));
  document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => openFilterDialog(button)));
  document.querySelectorAll('.recipient-chip').forEach(button => button.addEventListener('click', () => { button.parentElement.querySelector('.active')?.classList.remove('active'); button.classList.add('active'); showToast(`${button.textContent} recipients selected`); }));
document.querySelector('#filter-close').addEventListener('click', () => closeDialog('filter-dialog'));
document.querySelector('#notifications-button').addEventListener('click', () => document.querySelector('#notification-dialog').showModal());
document.querySelector('#capital-flow .icon-button')?.addEventListener('click', () => openInfoDialog('capital'));
const DESKTOP_SIDEBAR_KEY = 'funded.desktop-sidebar-collapsed';
const desktopSidebarToggle = document.querySelector('#desktop-sidebar-toggle');
const desktopNavLinks = [...document.querySelectorAll('#sidebar .nav-item, #sidebar .profile-row')];
for (const link of desktopNavLinks) {
  const label = link.classList.contains('profile-row') ? 'Wallet profile' : [...link.childNodes]
    .filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent.trim()).filter(Boolean).join(' ');
  if (label) link.title = label;
}
function setDesktopSidebarCollapsed(collapsed){
  const isCollapsed = Boolean(collapsed);
  document.documentElement.classList.toggle('sidebar-collapsed', isCollapsed);
  if (desktopSidebarToggle) {
    desktopSidebarToggle.setAttribute('aria-expanded', String(!isCollapsed));
    desktopSidebarToggle.setAttribute('aria-label', isCollapsed ? 'Expand navigation' : 'Minimize navigation');
    desktopSidebarToggle.title = isCollapsed ? 'Expand navigation' : 'Minimize navigation';
    desktopSidebarToggle.querySelector('span').textContent = isCollapsed ? '›' : '‹';
  }
  try { localStorage.setItem(DESKTOP_SIDEBAR_KEY, String(isCollapsed)); } catch {}
}
desktopSidebarToggle?.addEventListener('click', () => {
  setDesktopSidebarCollapsed(!document.documentElement.classList.contains('sidebar-collapsed'));
});
setDesktopSidebarCollapsed(document.documentElement.classList.contains('sidebar-collapsed'));
function setMenuOpen(open, restoreFocus = false){
  document.querySelector('#sidebar').classList.toggle('open', open);
  document.querySelector('#menu-backdrop').hidden = !open;
  document.querySelector('#open-menu').setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('menu-open', open);
  if (open) document.querySelector('#close-menu').focus();
  else if (restoreFocus) document.querySelector('#open-menu').focus();
}
document.querySelector('#open-menu').addEventListener('click', () => setMenuOpen(true));
document.querySelector('#close-menu').addEventListener('click', () => setMenuOpen(false, true));
document.querySelector('#menu-backdrop').addEventListener('click', () => setMenuOpen(false, true));
document.addEventListener('keydown', event => { if (event.key === 'Escape' && document.querySelector('#sidebar').classList.contains('open')) setMenuOpen(false, true); });
const pageRouteTargets = {
  launch: '#launch-route-shell',
  explore: '#explore',
  payments: '#payments',
  'analytics-detail': '#analytics-detail',
  'my-launches': '#my-launches',
  referrals: '#referral-command-center',
  community: '#community',
  leaderboard: '#leaderboard',
  airdrops: '#airdrops',
  buybacks: '#buybacks',
  'capital-flow': '#capital-flow',
  docs: '#docs',
  profile: '#profile',
  privacy: '#privacy',
  paid: '#paid',
};
let pageRouteFocusRequested = false;
function requestPageRouteFocus(){
  pageRouteFocusRequested = true;
}
function focusCurrentPageRoute(){
  const route = requestedPageRoute();
  const routeTarget = pageRouteTargets[route];
  const selectors = route === 'overview'
    ? ['.hero-section h1']
    : route === 'launch'
      ? ['#launch-title']
      : ['#route-guide:not([hidden]) #route-guide-title', routeTarget ? `${routeTarget} h1, ${routeTarget} h2` : ''];
  const heading = selectors.filter(Boolean)
    .flatMap(selector => [...document.querySelectorAll(selector)])
    .find(candidate => candidate.getClientRects().length > 0);
  if (!heading) return;
  heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
}
function requestedPageRoute(){
  if (/^\/explore\/?$/.test(location.pathname)) return 'explore';
  const hash = location.hash.replace(/^#/, '');
  if (hash === 'overview' || hash === '') return 'overview';
  if (hash.startsWith('coin/')) return 'overview';
  if (hash === 'referral-faq') return 'referrals';
  return pageRouteTargets[hash] ? hash : 'overview';
}
const routeGuideCopy = {
  payments: { group: 'Workspace', state: 'Verified receipts only', description: 'See what your wallet can claim and review confirmed SOL payout receipts. Anything not verified stays blank.', primary: ['View analytics', '#analytics-detail'], secondary: ['How claims work', '#docs'] },
  'analytics-detail': { group: 'Workspace', state: 'Verified records only', description: 'Review launches, fees, payouts, trading volume, airdrops, referrals, and burns with a clear unit on every figure.', primary: ['See capital flow', '#capital-flow'], secondary: ['Explore launches', '#explore'] },
  'my-launches': { group: 'Build', state: 'Project workspace', description: 'Review verified launches, market activity, and token actions in one portfolio.', primary: ['Launch a project', '#launch'], secondary: ['Launch guide', '#docs'] },
  referrals: { group: 'Growth', state: 'Wallet claim required', description: 'Share one invite link and track qualified creator activity, reward status, and confirmed receipts.', primary: ['How rewards work', '#referral-faq'], secondary: ['Explore launches', '#explore'] },
  community: { group: 'Growth', state: 'Saved locally', description: 'Save verified launches and compare them with the same market data used on Explore.', primary: ['Find launches', '#explore'], secondary: ['See airdrops', '#airdrops'] },
  leaderboard: { group: 'Growth', state: 'Verified activity only', description: 'Compare verified creator contribution after launch and trading activity has been confirmed.', primary: ['Explore launches', '#explore'], secondary: ['View Devnet status', '#docs'] },
  airdrops: { group: 'Growth', state: 'Proof required', description: 'Review community reserves, wallet eligibility, claim progress, and confirmed distribution receipts.', primary: ['Explore launches', '#explore'], secondary: ['Claim guide', '#docs'] },
  buybacks: { group: 'Protocol', state: 'Burn center', description: 'Buy or burn $FUNDED, attribute a burn to a project, and verify each confirmed supply reduction.', primary: ['View my projects', '#my-launches'], secondary: ['Protocol guide', '#docs'] },
  'capital-flow': { group: 'Protocol', state: 'Example calculator', description: 'Enter any creator-fee amount to see how every destination is calculated. This preview never moves funds.', primary: ['View payments', '#payments'], secondary: ['Read the policy', '#docs'] },
  docs: { group: 'Protocol', state: 'Devnet guide', description: 'Understand what is live, what needs a wallet signature, and which records count as verified proof.', primary: ['Open launch', '#launch'], secondary: ['See capital flow', '#capital-flow'] },
  privacy: { group: 'Protocol', state: 'Information', description: 'Understand what the browser stores, what the wallet signs, and how to verify a transaction safely.', primary: ['Wallet profile', '#profile'], secondary: ['Back to overview', '#overview'] },
  paid: { group: 'Protocol', state: 'Policy preview', description: 'See how $FUNDED supports community rewards, referrals, operations, and permanent token burns.', primary: ['See buybacks', '#buybacks'], secondary: ['Read the docs', '#docs'] },
};
function normalizeDirectPagePathForHashRoute(){
  if (!location.hash || location.hash.startsWith('#coin/')) return;
  const directPath = location.pathname.startsWith('/token/') || location.pathname.startsWith('/launch/coin/') || location.pathname.startsWith('/wallet/');
  if (directPath) history.replaceState({}, '', `/${location.search}${location.hash}`);
}
function syncPageRoute(){
  normalizeDirectPagePathForHashRoute();
  const requestedHash = location.hash.replace(/^#/, '');
  const infoRoute = infoDialogRoutes.has(requestedHash) ? requestedHash : '';
  const infoDialog = document.querySelector('#info-dialog');
  if (infoRoute && (!infoDialog.open || infoDialog.dataset.infoKind !== infoRoute)) openInfoDialog(infoRoute, { routeDriven: true });
  else if (!infoRoute && infoDialog.open && infoDialog.dataset.routeDriven === 'true') closeDialog('info-dialog');
  const route = requestedPageRoute();
  document.body.classList.remove('page-route', ...Object.keys(pageRouteTargets).map(key => `page-route-${key}`), 'page-route-overview');
  document.body.classList.add('page-route', `page-route-${route}`);
  if (route === 'explore') document.body.classList.add('explore-route');
  else document.body.classList.remove('explore-route');
  document.querySelectorAll('.nav-item').forEach(item => {
    const hrefRoute = item.getAttribute('href')?.replace(/^#/, '');
    item.classList.toggle('active', hrefRoute === route || (route === 'referrals' && hrefRoute === 'referrals'));
    if (hrefRoute === route) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
  });
  let copy = {
    overview: ['Overview', 'Verified activity and next steps'],
    explore: ['Explore', 'Verified launches and market signals'],
    payments: ['Rewards', 'Claims and payout receipts'],
    'analytics-detail': ['Analytics', 'Protocol flow and indexed activity'],
    launch: ['Launch token', 'Create and review a Devnet coin'],
    'my-launches': ['Portfolio', 'Creator workspace'],
    referrals: ['Referrals', 'Track qualified growth'],
    community: ['Watchlist', 'Watchlist and verified signals'],
    leaderboard: ['Leaderboard', 'Ranked community contribution'],
    airdrops: ['Airdrops', 'Eligibility and claim records'],
    buybacks: ['Burn $FUNDED', 'Supply reduction and burn receipts'],
    'capital-flow': ['Capital flow', 'Follow the published allocation'],
    docs: ['Docs', 'Guides, safety, and disclosures'],
    profile: ['Profile', 'Wallet and signing safety'],
    privacy: ['Privacy', 'Wallet and browser data'],
    paid: ['$FUNDED', 'Token policy and availability'],
  }[route] || ['Overview', 'Verified activity and next steps'];
  if (coinRouteRequested()) copy = ['Token', 'Market activity and trade'];
  if (walletRouteRequested()) copy = ['Wallet', 'Balances and confirmed activity'];
  const routeContext = document.querySelector('#route-context');
  if (routeContext) {
    const label = routeContext.querySelector('[data-route-label]');
    const description = routeContext.querySelector('[data-route-description]');
    if (label) label.textContent = copy[0];
    if (description) description.textContent = copy[1];
  }
  const guide = routeGuideCopy[route];
  const routeGuide = document.querySelector('#route-guide');
  routeGuide.hidden = !guide;
  if (guide) {
    document.querySelector('#route-guide-group').textContent = guide.group;
    document.querySelector('#route-guide-state').textContent = guide.state;
    document.querySelector('#route-guide-title').textContent = copy[0];
    document.querySelector('#route-guide-description').textContent = guide.description;
    for (const [id, action] of [['#route-guide-primary', guide.primary], ['#route-guide-secondary', guide.secondary]]) {
      const link = document.querySelector(id);
      link.href = action[1];
      link.firstChild.textContent = action[0] + ' ';
    }
  }
  if (route === 'explore') {
    const count = document.querySelector('#explore-launch-count');
    if (count) count.textContent = String(assets.length).padStart(2, '0');
  }
  if (route === 'buybacks') void loadFundedBurnState();
  if (location.hash === '#referral-faq') requestAnimationFrame(() => {
    const faq = document.querySelector('#referral-faq');
    if (faq) faq.tabIndex = -1;
    faq?.scrollIntoView({ block: 'start', behavior: 'auto' });
    faq?.focus({ preventScroll: true });
  });
  else if (route !== 'overview') window.scrollTo({ top: 0, behavior: 'auto' });
  window.dispatchEvent(new CustomEvent('funded:route-change', {detail: {route}}));
}
document.querySelectorAll('.nav-item, .profile-row').forEach(item => item.addEventListener('click', () => setMenuOpen(false)));
syncPageRoute();
document.querySelectorAll('a[href^="#"]').forEach(link => link.addEventListener('click', () => {
  const href = link.getAttribute('href');
  if (href !== '#launch' && !link.dataset.info) closeDialog('launch-dialog');
  if (!link.dataset.info && href !== '#referral-faq') {
    requestPageRouteFocus();
    if (href === location.hash) requestAnimationFrame(() => {
      if (!pageRouteFocusRequested) return;
      pageRouteFocusRequested = false;
      focusCurrentPageRoute();
    });
  }
}));
window.addEventListener('hashchange', () => {
  if (location.hash !== '#launch') closeDialog('launch-dialog');
  syncPageRoute();
  if (pageRouteFocusRequested) {
    pageRouteFocusRequested = false;
    requestAnimationFrame(focusCurrentPageRoute);
  }
});
const existingProvider = getProvider();
if (APP_MAINNET_READ_ONLY) {
  const banner = document.createElement('div');
  banner.id = 'mainnet-readonly-banner';
  banner.setAttribute('role', 'status');
  banner.textContent = 'Private Mainnet preview · read-only · wallet signing and financial actions disabled';
  document.body.prepend(banner);
} else {
  if (existingProvider?.isConnected && walletAddress(existingProvider) && !wasWalletManuallyDisconnected()) activateWallet(existingProvider);
  if (!wallet) await restoreTrustedPhantomWallet();
  if (!wallet) await restoreMobileWallet();
  if (!wallet) await connectDevWallet();
}
captureAppReferral();
bindAppReferralToWallet();
updateReferralLink();
updateOnboardingProgress();
renderAirdropClaims();
renderCreatorLaunches();
loadVerifiedLaunchPolicies().catch(() => {});
setInterval(() => { if (!document.hidden) loadVerifiedLaunchPolicies().catch(() => {}); }, 60_000);
renderBuybackDashboard();
void loadBuybackNetworkState();
setInterval(() => { if (!document.hidden) void loadBuybackNetworkState(); }, 60_000);
void refreshFundedBuyRoute();
setInterval(() => { if (!document.hidden && !fundedBuyBusy) void refreshFundedBuyRoute(); }, 60_000);
renderFeeFlowCalculator();
await refreshFeeRouterConfig();
await refreshXFeeStatus();
renderLaunchBurnSelection();
updateLaunchPreview();
updateCostSummary();
updateLaunchButton();
observeWalletProvider(getProvider());
window.addEventListener('focus', reconcileWalletState);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { reconcileWalletState(); renderPendingLaunchReview(); } });
const simulateButton = document.querySelector('#simulate-button');
if (simulateButton && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') simulateButton.hidden = true;

// Token detail route. Every displayed value comes from Solana RPC or the Pump
// bonding-curve account. Values that require an off-chain indexer stay explicit.
const TOKEN_METADATA_PROGRAM_ID = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';
let coinActivity = { status: 'loading', collections: [], claims: [], accounts: [] };
function coinFeeSol(value) {
  try {
    const amount = BigInt(value);
    if (amount < 0n) return '—';
    const whole = amount / 1_000_000_000n;
    const fraction = String(amount % 1_000_000_000n).padStart(9, '0').replace(/0+$/, '');
    return `${whole}${fraction ? `.${fraction}` : ''} SOL`;
  } catch { return '—'; }
}
var currentCoinFeeOverview = null;
let coinSummaryLaunch = null;
let coinSummaryLedgerMint = null;
function renderCoinSummary() {
  const root = document.querySelector('#coin-summary-dashboard');
  const grid = document.querySelector('#coin-summary-grid');
  if (!root || !grid) return;
  const summary = buildCoinSummary({
    mint:getCoinMintAddress(), cluster:EXPLORE_CLUSTER, launch:coinSummaryLaunch,
    ledgerMint:coinSummaryLedgerMint, overview:currentCoinFeeOverview,
    market:coinMarketActivity, solUsd:coinSolUsdPrice, tokenSpotSol:coinSolUsdValues.spot,
  });
  root.hidden = !summary.visible;
  if (!summary.visible) { grid.replaceChildren(); return; }
  const source = document.querySelector('#coin-summary-source');
  if (source) source.textContent = `Verified launch · ${EXPLORE_CLUSTER}`;
  grid.innerHTML = summary.cards.map(item => {
    const value = item.amount == null ? item.unit === 'USD' ? '$—' : '—'
      : item.unit === 'USD' ? formatSmallDashboardUsd(item.amount, { partial:item.id === 'volume' && item.state === 'partial' })
        : formatDashboardQuantity(item.amount);
    return `<article class="coin-summary-card" data-metric="${escapeHtml(item.id)}" data-state="${escapeHtml(item.state)}"><span class="coin-summary-icon" aria-hidden="true">${escapeHtml(item.icon)}</span><div><small>${escapeHtml(item.label)}</small><span class="coin-summary-value"><strong>${escapeHtml(value)}</strong><b>${escapeHtml(item.unit)}</b></span><em>${escapeHtml(item.note)}</em></div></article>`;
  }).join('');
}
function renderCoinFeeDashboard(overview = null) {
  currentCoinFeeOverview = overview;
  renderCoinSummary();
  const root = document.querySelector('#coin-fee-dashboard');
  const badge = document.querySelector('#coin-fee-updated');
  if (!root) return;
  if (overview == null) {
    if (badge) badge.textContent = 'Checking';
    root.innerHTML = '<p class="coin-fee-note">Reading this coin’s Pump vault and verified payout records…</p>';
    return;
  }
  if (!overview?.available) {
    if (badge) badge.textContent = 'Unavailable';
    root.innerHTML = '<p class="coin-fee-note">A verified per coin fee route and its ledger are required to show fee amounts for this token.</p>';
    return;
  }
  if (badge) badge.textContent = overview.pump?.status === 'confirmed' ? 'Live vault' : 'Ledger only';
  const accrued = overview.pump?.status === 'confirmed' ? coinFeeSol(overview.pump.accruedLamports) : 'Unavailable';
  const creator = overview.receivers?.find(row => row.id === 'creator');
  const creatorWallet = overview.creatorWallet;
  const walletLink = creatorWallet ? `<a href="/wallet/${encodeURIComponent(creatorWallet)}">${escapeHtml(shortAddress(creatorWallet))} ↗</a>` : 'unavailable';
  const vaultLink = overview.pump?.vault ? `<a href="${escapeHtml(exploreExplorer(`address/${encodeURIComponent(overview.pump.vault)}`))}" target="_blank" rel="noopener noreferrer">Pump vault ↗</a>` : 'Pump vault unavailable';
  const status = overview.pump?.status === 'confirmed' && BigInt(overview.pump.accruedLamports || '0') > 0n ? '<p class="coin-fee-stage">Fees are accruing in Pump. Keeper collection is needed before payout allocations can be created.</p>' : '';
  root.innerHTML = `<div class="coin-fee-stats"><div><span>Still in Pump vault</span><strong>${escapeHtml(accrued)}</strong><small>${vaultLink}</small></div><div><span>Collected from Pump</span><strong>${escapeHtml(coinFeeSol(overview.collectedLamports))}</strong><small>${escapeHtml(overview.collectionCount)} verified collection${overview.collectionCount === 1 ? '' : 's'}</small></div><div><span>Allocated after collection</span><strong>${escapeHtml(coinFeeSol(overview.allocatedLamports))}</strong><small>${escapeHtml(coinFeeSol(overview.awaitingAllocationLamports))} awaiting allocation</small></div><div><span>Creator awaiting payout proof</span><strong>${escapeHtml(coinFeeSol(creator?.withoutConfirmedPayoutLamports || '0'))}</strong><small>For ${walletLink}</small></div></div>${status}<div class="coin-fee-how"></div>`;
  const claim = overview.creatorClaim;
  const claimable = BigInt(claim?.claimableLamports || '0');
  const minimum = BigInt(claim?.minimumLamports || '10000000');
  const connected = connectedWalletAddress === creatorWallet;
  const ready = Boolean(claim?.eligible && connected && wallet && typeof wallet.signMessage === 'function');
  const note = claimable < minimum ? `Claiming opens at ${coinFeeSol(minimum)} of allocated creator fees.` : !connectedWalletAddress ? 'Connect the launch wallet to request a payout.' : !connected ? 'Switch to the launch wallet shown above to claim.' : 'Sign one message to request payment. The payout worker then sends SOL to the launch wallet.';
  root.insertAdjacentHTML('afterbegin', `<section class="coin-creator-claim"><div><span>Creator available to claim</span><strong>${escapeHtml(coinFeeSol(claimable))}</strong><small>${escapeHtml(note)}</small></div><button type="button" id="coin-creator-claim-button" ${ready ? '' : 'disabled'}>Claim creator fees</button></section>`);
  const claimButton = root.querySelector('#coin-creator-claim-button');
  if (claimButton && ready) claimButton.onclick = () => { void requestCreatorFeeClaim(claimButton); };
  const stage = root.querySelector('.coin-fee-stage');
  if (stage) stage.textContent = `Fees are accruing in Pump. The Devnet collector checks the vault automatically and records allocations once at least ${coinFeeSol(minimum)} is available.`;
  const how = root.querySelector('.coin-fee-how');
  if (how) how.innerHTML = `<strong>How the coin creator receives fees</strong><ol><li>Pump accrues fees in this coin’s vault.</li><li>The Devnet collector moves fees into this coin’s router and records the allocation automatically.</li><li>Once allocated creator fees reach ${escapeHtml(coinFeeSol(minimum))}, connect launch wallet ${walletLink} and select Claim creator fees. The payout worker sends SOL to that wallet; a paid receipt appears after confirmation.</li></ol><small>Only the verified launch wallet can request payment. Amounts still in Pump are estimates until collected and allocated.</small>`;
}
async function requestCreatorFeeClaim(button) {
  const mint = getCoinMintAddress();
  const session = captureWalletSession();
  if (!mint || !session || session.address !== currentCoinFeeOverview?.creatorWallet) return;
  try {
    button.disabled = true;
    button.textContent = 'Waiting for wallet…';
    const path = `/api/tokens/${encodeURIComponent(mint)}/creator-claim`;
    const prepared = await apiRequest(`${path}/prepare`, { method:'POST', body:{} });
    assertWalletSessionCurrent(session);
    const signed = await session.provider.signMessage(new TextEncoder().encode(prepared.data.statement));
    assertWalletSessionCurrent(session);
    button.textContent = 'Requesting payout…';
    await apiRequest(`${path}/request`, { method:'POST', body:{ challengeId:prepared.data.challengeId, signature:bs58.encode(signed.signature || signed) } });
    showToast('Creator payout requested. Watch this panel for a confirmed payment receipt.');
    const updated = await apiRequest(`/api/tokens/${encodeURIComponent(mint)}/fee-activity`);
    if (getCoinMintAddress() === mint && updated.available && updated.data?.mint === mint) {
      coinSummaryLedgerMint = mint;
      renderCoinFeeDashboard(updated.data.overview);
    }
  } catch (error) {
    showToast(`Creator claim: ${error.message}`);
    if (button.isConnected) { button.disabled = false; button.textContent = 'Claim creator fees'; }
  }
}
let coinMarketActivity = { status: 'loading', trades: [], coverage: null, decimals: 6 };
renderExploreAssets();
renderStonkEnhancements();
let coinSolUsdValues = { spot: NaN, marketCap: NaN, reserve: NaN, virtualQuote: NaN };
let coinChatMessages = [];
let coinChatState = { loading: true, enabled: false, reason: '' };
let coinTradeFilter = 'all';
let coinChartView = 'snapshot';
let coinPulsePeriod = '24h';
let coinLoadId = 0;
function getCoinMintAddress(){
  const pathMatch = location.pathname.match(/\/(?:token|launch\/coin)\/([^/?#]+)/i);
  if (pathMatch?.[1]) return decodeURIComponent(pathMatch[1]);
  const hashMatch = location.hash.match(/^#coin\/([^/?#]+)/i);
  const hashValue = hashMatch?.[1] ? decodeURIComponent(hashMatch[1]) : '';
  return hashValue.length > 20 ? hashValue : '';
}
function shortAddress(address){ return address ? `${address.slice(0, 6)}…${address.slice(-6)}` : '—'; }
function renderCoinCreatorRoute(address){
  const route = document.querySelector('#coin-creator-route');
  if (!route) return;
  if (!address) { route.innerHTML = '<strong>Fee recipient unavailable</strong><small>The curve fee-owner address could not be verified.</small>'; return; }
  const safe = escapeHtml(address);
  route.innerHTML = `<strong>Pump fee recipient</strong><a class="coin-creator-link" href="/wallet/${encodeURIComponent(address)}">${safe}</a><button type="button" class="copy-creator-wallet" id="coin-copy-creator" aria-label="Copy fee recipient">⧉</button><small>Curve fee authority; may be a program/router, not the human creator.</small>`;
}
function renderCoinCreatorHeader(address){
  const link = document.querySelector('#coin-creator-by');
  if (!link) return;
  if (!address) { link.hidden = true; link.removeAttribute('href'); return; }
  link.textContent = `Fee owner ${shortAddress(address)}`;
  link.href = `/wallet/${encodeURIComponent(address)}`;
  link.hidden = false;
}
function compactCoinSocials(){
  const labels = {
    '#coin-explorer-link': ['◎', 'Open token on Solana Explorer'],
    '#coin-website-link': ['◉', 'Open token website'],
    '#coin-x-link': ['𝕏', 'Open token X profile'],
    '#coin-telegram-link': ['✈', 'Open token Telegram'],
    '#coin-discord-link': ['◈', 'Open token Discord'],
    '#coin-share-link': ['♧', 'Copy token link'],
    '#coin-refresh': ['↻', 'Refresh token data'],
  };
  const socials = document.querySelector('.coin-socials');
  if (!socials) return;
  socials.classList.add('is-compact');
  for (const [selector, [icon, title]] of Object.entries(labels)) {
    const element = socials.querySelector(selector);
    if (!element) continue;
    element.textContent = icon;
    element.title = title;
    element.setAttribute('aria-label', title);
    if (element.tagName === 'A' && selector !== '#coin-share-link' && !element.getAttribute('href')) {
      element.hidden = false;
      element.classList.add('is-unavailable');
      element.setAttribute('aria-disabled', 'true');
    } else if (element.tagName === 'A' && element.getAttribute('href')) {
      element.hidden = false;
      element.classList.remove('is-unavailable');
      element.removeAttribute('aria-disabled');
    }
  }
}
let coinLabelObserver = null;
function sanitizeCoinRpcLabels(){
  const root = document.querySelector('#coin-page');
  if (!root) return;
  const replacements = [
    [/Confirmed Solana RPC snapshot/gi, 'Confirmed Solana snapshot'],
    [/Confirmed RPC snapshot/gi, 'Confirmed on-chain snapshot'],
    [/RPC confirmed/gi, 'Data confirmed'],
    [/Checking RPC/gi, 'Checking data'],
    [/RPC SNAPSHOT/gi, 'LIVE SNAPSHOT'],
    [/RPC trade scan if available/gi, 'Trade scan if available'],
    [/RPC trade history unavailable/gi, 'Trade history unavailable'],
    [/RPC only/gi, 'On-chain'],
    [/Solana RPC/gi, 'Solana'],
    [/from the current RPC scan/gi, 'from the current scan'],
    [/partial RPC scan/gi, 'partial scan'],
    [/Complete RPC scan/gi, 'Complete scan'],
    [/RPC coverage/gi, 'data coverage'],
    [/from Solana RPC/gi, 'from Solana'],
    [/\bRPC\b/gi, 'on-chain'],
  ];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let node;
  while ((node = walker.nextNode())) nodes.push(node);
  for (const textNode of nodes) {
    let value = textNode.nodeValue;
    for (const [pattern, replacement] of replacements) value = value.replace(pattern, replacement);
    if (value !== textNode.nodeValue) textNode.nodeValue = value;
  }
}
function startCoinLabelSanitizer(){
  if (coinLabelObserver) return;
  const root = document.querySelector('#coin-page');
  if (!root || typeof MutationObserver === 'undefined') return;
  coinLabelObserver = new MutationObserver(() => {
    coinLabelObserver.disconnect();
    sanitizeCoinRpcLabels();
    coinLabelObserver.observe(root, { childList: true, subtree: true, characterData: true });
  });
  coinLabelObserver.observe(root, { childList: true, subtree: true, characterData: true });
  sanitizeCoinRpcLabels();
}
function getWalletDetailAddress(){
  const match = location.pathname.match(/^\/wallet\/([^/?#]+)/i);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}
function showWalletPage(open = true){
  const main = document.querySelector('.main-content');
  const page = document.querySelector('#wallet-page');
  const coin = document.querySelector('#coin-page');
  if (!main || !page) return;
  if (!open){ main.classList.remove('wallet-view'); page.hidden = true; return; }
  const address = getWalletDetailAddress();
  main.classList.remove('coin-view'); main.classList.add('wallet-view');
  if (coin) coin.hidden = true;
  page.hidden = false;
  renderWalletDetail();
  if (address && address === connectedWalletAddress) void loadFundedBurnState();
  const explorer = document.querySelector('#wallet-explorer-link');
  if (explorer) { explorer.href = address ? exploreExplorer(`address/${encodeURIComponent(address)}`) : '#'; explorer.hidden = !address; }
  const routeLabel = document.querySelector('#route-context [data-route-label]');
  const routeDescription = document.querySelector('#route-context [data-route-description]');
  if (routeLabel) routeLabel.textContent = 'Wallet';
  if (routeDescription) routeDescription.textContent = 'Balances, launches, and available activity';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function walletDetailLaunches(address){
  if (!address) return [];
  return verifiedLaunchPolicies.filter(launch => launch.creatorWallet === address && launch.mint)
    .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
}
function walletDetailTrades(address){
  if (!address) return [];
  return collectRecentTrades(assets, { limit: 100, since: Math.floor(Date.now() / 1000) - 86400 }).filter(trade => trade.trader === address);
}
function walletDetailBurned(launches){
  const values = launches.map(launch => launch.creatorLaunchBurn).filter(burn => burn?.status === 'verified' && burn.receipt);
  return values.reduce((sum, burn) => sum + Number(burn.receipt.amountTokens ?? burn.amountTokens ?? 0), 0);
}
function walletDetailEmpty(title, detail){
  return `<div class="wallet-detail-empty"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span></div>`;
}
function loadWalletRowLogos(content, launches){
  for (const row of content.querySelectorAll('.wallet-activity-row[data-token-mint]')) {
    const mint = row.dataset.tokenMint;
    loadPortfolioLogo(row, verifiedLaunchPolicyForMint(mint) || launches.find(launch => launch.mint === mint));
  }
}
function renderWalletDetail(){
  const page = document.querySelector('#wallet-page');
  if (!page) return;
  const address = getWalletDetailAddress();
  const isSelf = Boolean(address && address === connectedWalletAddress);
  const launches = walletDetailLaunches(address);
  const trades = walletDetailTrades(address);
  const burned = walletDetailBurned(launches);
  const launchTimes = launches.map(item => Date.parse(item.createdAt || '')).filter(Number.isFinite);
  const tradeTimes = trades.map(item => Number(item.blockTime) * 1000).filter(Number.isFinite);
  const lastActivity = Math.max(0, ...launchTimes, ...tradeTimes);
  const volume = trades.reduce((sum, trade) => sum + Number(trade.solAmount || 0), 0);
  const title = document.querySelector('#wallet-page-title');
  const addressNode = document.querySelector('#wallet-page-address');
  const selfBadge = document.querySelector('#wallet-self-badge');
  const edit = document.querySelector('#wallet-edit-profile');
  if (title) title.textContent = isSelf ? 'Your wallet' : 'Wallet';
  if (addressNode) addressNode.textContent = address || 'Wallet address unavailable';
  if (selfBadge) selfBadge.hidden = !isSelf;
  if (edit) edit.hidden = !isSelf;
  const statSol = document.querySelector('#wallet-stat-sol');
  const statSolNote = document.querySelector('#wallet-stat-sol-note');
  if (statSol) statSol.textContent = isSelf && walletBalanceLamports != null ? formatSol(walletBalanceLamports) : '—';
  if (statSolNote) statSolNote.textContent = isSelf ? (walletBalanceLamports == null ? 'Balance currently unavailable' : 'Connected wallet balance') : 'Connect this wallet to view balance';
  setCoinField('#wallet-stat-launches', String(launches.length));
  setCoinField('#wallet-stat-trades', trades.length ? String(trades.length) : '0');
  const hasSolUsdQuote = Number.isFinite(coinSolUsdPrice) && coinSolUsdPrice > 0;
  setCoinField('#wallet-stat-volume', !trades.length ? '$0.00' : hasSolUsdQuote ? formatDashboardUsd(volume * coinSolUsdPrice) : '$—');
  setCoinField('#wallet-stat-volume-note', !trades.length ? 'No scanned trades in 24h' : hasSolUsdQuote ? 'Approx. USD · scanned trades at current SOL price' : 'Current SOL/USD quote unavailable');
  setCoinField('#wallet-stat-burned', burned > 0 ? formatOnChainNumber(burned, 2) : launches.length ? '0' : '—');
  setCoinField('#wallet-stat-last', lastActivity ? formatOnchainAge(lastActivity) : '—');
  document.querySelectorAll('[data-wallet-tab]').forEach(button => { const active = button.dataset.walletTab === walletDetailTab; button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1; });
  const description = document.querySelector('#wallet-detail-description');
  const content = document.querySelector('#wallet-detail-content');
  if (!content || !description) return;
  if (walletDetailTab === 'balances') {
    description.textContent = 'Balances shown only when the app has a direct, current source.';
    const fundedBalance = isSelf && fundedBurnState.wallet === address && fundedBurnState.status === 'ready'
      ? formatTokenBaseUnits(fundedBurnState.balanceBaseUnits, fundedBurnState.decimals, 6)
      : isSelf && fundedBurnState.wallet === address && fundedBurnState.status === 'loading' ? 'Checking Devnet…' : 'Unavailable';
    content.innerHTML = `<div class="wallet-balance-grid"><article><span class="header-solana-mark" aria-hidden="true"></span><div><strong>${escapeHtml(isSelf && walletBalanceLamports != null ? formatSol(walletBalanceLamports) : 'Unavailable')}</strong><small>Native SOL · ${escapeHtml(EXPLORE_CLUSTER)}</small></div></article><article><span class="wallet-funded-mark" aria-hidden="true">f</span><div><strong>${escapeHtml(fundedBalance)}</strong><small>$FUNDED token balance${fundedBalance !== 'Unavailable' && fundedBalance !== 'Checking Devnet…' ? ' · live Devnet' : ''}</small></div></article></div>`;
    return;
  }
  const launchRows = launches.map(launch => `<a class="wallet-activity-row" data-token-mint="${escapeHtml(launch.mint)}" href="/token/${encodeURIComponent(launch.mint)}"><span class="wallet-activity-icon">✦</span><span><strong>Created ${escapeHtml(launch.name || launch.symbol || 'token')}</strong><small>${escapeHtml(launch.symbol || 'TOKEN')} · ${escapeHtml(shortAddress(launch.mint))}</small></span><b>Verified<small>${launch.createdAt ? escapeHtml(formatOnchainAge(Date.parse(launch.createdAt))) : 'Time unavailable'}</small></b></a>`).join('');
  if (walletDetailTab === 'created') {
    description.textContent = 'Coins attributed to this wallet in the verified launch registry.';
    content.innerHTML = launchRows || walletDetailEmpty('No created coins found', 'No verified launch is attributed to this wallet.');
    loadWalletRowLogos(content, launches);
    return;
  }
  description.textContent = 'Verified launches and scanned trades on Devnet.';
  const tradeRows = trades.map(trade => `<a class="wallet-activity-row" data-token-mint="${escapeHtml(trade.mint)}" href="${escapeHtml(exploreExplorer(`tx/${encodeURIComponent(trade.signature)}`))}" target="_blank" rel="noopener noreferrer"><span class="wallet-activity-icon ${trade.side}">${trade.side === 'buy' ? '↗' : '↘'}</span><span><strong>${trade.side === 'buy' ? 'Bought' : 'Sold'} ${escapeHtml(trade.symbol || 'token')}</strong><small>${escapeHtml(shortAddress(trade.mint))}</small></span><b>${escapeHtml(formatOnChainNumber(trade.solAmount, 4))} SOL<small>${escapeHtml(formatOnchainAge(Number(trade.blockTime) * 1000))}</small></b></a>`).join('');
  content.innerHTML = tradeRows + launchRows || walletDetailEmpty('No activity found', 'No launch or scanned trade record is attributed to this wallet.');
  loadWalletRowLogos(content, launches);
}
function formatOnChainNumber(value, digits = 4){
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}
function formatCoinSpot(value){
  if (!Number.isFinite(value)) return 'Unavailable';
  if (value !== 0 && Math.abs(value) < 0.000001) {
    const fixed = value.toFixed(15).replace(/0+$/, '').replace(/\.$/, '');
    return `${fixed} SOL`;
  }
  return `${formatOnChainNumber(value, 9)} SOL`;
}
function formatCoinUsd(solValue){
  if (solValue == null) return '$—';
  const sol = Number(solValue);
  if (!Number.isFinite(sol)) return '$—';
  const usd = Number.isFinite(sol) && Number.isFinite(coinSolUsdPrice) ? sol * coinSolUsdPrice : NaN;
  return Number.isFinite(usd) ? formatUsd(usd) : formatCoinSpot(sol);
}
function formatCoinSnapshotUsd(solValue){
  if (solValue == null || !Number.isFinite(Number(solValue)) || !Number.isFinite(coinSolUsdPrice) || coinSolUsdPrice <= 0) return '$—';
  const usd = Number(solValue) * coinSolUsdPrice;
  if (!Number.isFinite(usd) || usd < 0) return '$—';
  if (usd > 0 && usd < 0.0001) {
    const digits = Math.min(18, Math.max(8, Math.ceil(-Math.log10(usd)) + 4));
    return usd < 0.00000000000001 ? `$${usd.toExponential(4)}` : `$${usd.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '')}`;
  }
  return formatUsd(usd);
}
function renderCoinSnapshotUsd(){
  setCoinField('#coin-snapshot-spot-usd', formatCoinSnapshotUsd(coinSolUsdValues.spot));
  setCoinField('#coin-snapshot-quote-usd', formatCoinSnapshotUsd(coinSolUsdValues.virtualQuote));
}
function formatExploreUsd(value, options = {}){
  const prefix = options.partial ? '≥' : '';
  return `${prefix}${formatCoinUsd(value)}`;
}
async function loadSolUsdQuote(){
  const response = await apiRequest('/api/market/sol-usd').catch(() => ({ available: false, data: null }));
  const quote = Number(response.data?.priceUsd);
  if (!response.available || !Number.isFinite(quote) || quote <= 0) return;
  coinSolUsdPrice = quote;
  setCoinField('#coin-market-cap', formatCoinUsd(coinSolUsdValues.marketCap));
  setCoinField('#coin-strip-market-cap', formatCoinUsd(coinSolUsdValues.marketCap));
  setCoinField('#coin-liquidity', formatCoinUsd(coinSolUsdValues.reserve));
  renderCoinSnapshotUsd();
  renderCoinSummary();
  if (coinMarketActivity.graduated) setCoinField('#coin-volume', 'Pool activity unindexed');
  else if (coinMarketActivity.coverage === 'complete' && coinMarketActivity.tradeCount === 0) setCoinField('#coin-volume', 'No trades');
  else if (Number.isFinite(Number(coinMarketActivity.volume24hSol))) setCoinField('#coin-volume', formatExploreUsd(coinMarketActivity.volume24hSol, { partial: coinMarketActivity.coverage === 'partial' }));
  renderCoinPricePath(); renderCoinPulse(); renderCoinActivityTab();
  renderExploreAssets(); renderRegistry(); renderHomeLaunchBoard(); renderHomeKpiDashboard(assets); renderOnchainReportState(assets);
  if (document.querySelector('#wallet-page:not([hidden])')) renderWalletDetail();
}
void loadSolUsdQuote();
function readMetadataString(data, offset){
  if (offset + 4 > data.length) return { value: '', offset: data.length };
  const length = data.readUInt32LE(offset); const start = offset + 4; const end = Math.min(start + length, data.length);
  return { value: data.subarray(start, end).toString('utf8').replace(/\0/g, '').trim(), offset: start + length };
}
function parseOnChainMetadata(data){
  if (!data || data.length < 1 + 32 + 32 + 4) return {};
  let offset = 1 + 32 + 32;
  const name = readMetadataString(data, offset); offset = name.offset;
  const symbol = readMetadataString(data, offset);
  return { name: name.value, symbol: symbol.value };
}
function setCoinField(selector, value){ const node = document.querySelector(selector); if (node) node.textContent = value; }
function setCoinFact(selector, value, state = 'unknown'){
  const node = document.querySelector(selector);
  if (node) { node.textContent = value; node.dataset.state = state; }
}
function renderCoinAccountDistribution(distribution, sampleCount = 0, vaultLabel = 'Curve vault'){
  const panel = document.querySelector('#coin-account-distribution');
  if (!panel) return;
  panel.hidden = !distribution;
  if (!distribution) return;
  const vaultBar = document.querySelector('#coin-distribution-vault');
  const otherBar = document.querySelector('#coin-distribution-other');
  if (vaultBar) vaultBar.style.width = `${Math.max(0, Math.min(100, distribution.vaultShare))}%`;
  if (otherBar) otherBar.style.width = `${Math.max(0, Math.min(100 - distribution.vaultShare, distribution.otherShare))}%`;
  setCoinField('#coin-distribution-vault-label', `${formatOnChainNumber(distribution.vaultShare, 2)}%`);
  setCoinField('#coin-distribution-other-label', `${formatOnChainNumber(distribution.otherShare, 2)}%`);
  setCoinField('#coin-distribution-vault-name', vaultLabel);
  setCoinField('#coin-vault-fact-label', `${vaultLabel} balance`);
  setCoinField('#coin-distribution-note', `Top ${sampleCount} non-zero token accounts only · ${formatOnChainNumber(distribution.outsideSampleShare, 2)}% outside sample. Accounts are not necessarily unique wallets.`);
}
function setCoinCurveProgress(progress){
  const value = Number(progress);
  const valid = progress != null && Number.isFinite(value);
  setCoinField('#coin-curve-progress', valid ? `${formatOnChainNumber(value, 2)}%` : 'Unavailable');
  const fill = document.querySelector('#coin-curve-fill');
  if (fill) fill.style.width = `${valid ? Math.max(0, Math.min(100, value)) : 0}%`;
}
function setCoinChartView(view){
  coinChartView = view === 'trades' ? 'trades' : 'snapshot';
  const snapshot = document.querySelector('.coin-chart');
  const path = document.querySelector('#coin-price-path');
  if (snapshot) snapshot.hidden = coinChartView !== 'snapshot';
  if (path) path.hidden = coinChartView !== 'trades';
  document.querySelectorAll('[data-coin-chart-view]').forEach(button => {
    const active = button.dataset.coinChartView === coinChartView;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}
function renderCoinPricePath(){
  const panel = document.querySelector('#coin-price-path');
  if (!panel) return;
  const path = buildTradePricePath(coinMarketActivity.trades, coinMarketActivity.decimals);
  if (path.count < 2) {
    panel.innerHTML = `<div class="empty-state coin-activity-empty"><strong>${path.count ? 'One observed trade price' : 'Trade price path unavailable'}</strong><small>${path.count ? 'At least two confirmed Pump curve trades are needed to draw a path.' : 'No individual trade prices were returned by the current RPC scan.'} Historical candles are not indexed.</small></div>`;
    return;
  }
  const timeLabel = value => Number.isFinite(Number(value)) ? new Date(Number(value) * 1000).toLocaleString() : 'Time unavailable';
  panel.innerHTML = `<div class="coin-price-path-head"><span>Observed ${Number.isFinite(coinSolUsdPrice) ? 'USD' : 'SOL'} per token</span><strong>${escapeHtml(formatCoinUsd(path.latest))}</strong></div><svg viewBox="0 0 600 190" role="img" aria-label="Price path from ${path.count} confirmed Pump bonding-curve trade observations" preserveAspectRatio="none"><path class="coin-path-area" d="${path.area}"/><path class="coin-path-line" d="${path.line}"/><circle cx="${path.lastPoint.x.toFixed(1)}" cy="${path.lastPoint.y.toFixed(1)}" r="4"/></svg><div class="coin-price-path-range"><span>Low <b>${escapeHtml(formatCoinUsd(path.low))}</b></span><span>High <b>${escapeHtml(formatCoinUsd(path.high))}</b></span></div><div class="coin-price-path-times"><span>${escapeHtml(timeLabel(path.firstBlockTime))}</span><span>${escapeHtml(timeLabel(path.lastBlockTime))}</span></div>`;
}
function renderCoinFlow(buy, sell, partial = false){
  const buyBar = document.querySelector('#coin-flow-buy');
  const sellBar = document.querySelector('#coin-flow-sell');
  const note = document.querySelector('#coin-flow .coin-flow-heading small');
  const valid = Number.isFinite(buy) && Number.isFinite(sell) && buy >= 0 && sell >= 0;
  const total = valid ? buy + sell : 0;
  if (buyBar) buyBar.style.width = `${total ? buy / total * 100 : 0}%`;
  if (sellBar) sellBar.style.width = `${total ? sell / total * 100 : 0}%`;
  setCoinField('#coin-flow-buy-label', valid ? `Buy ${formatExploreUsd(buy, { partial })}` : 'Buy —');
  setCoinField('#coin-flow-sell-label', valid ? `Sell ${formatExploreUsd(sell, { partial })}` : 'Sell —');
  if (note) note.textContent = valid ? total ? `${partial ? 'Partial' : 'Confirmed'} curve trade scan` : 'No observed curve volume' : 'Buy/sell volume unavailable';
}
function renderCoinPulse(){
  document.querySelectorAll('[data-coin-pulse-period]').forEach(button => {
    const active = button.dataset.coinPulsePeriod === coinPulsePeriod;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const pulse = coinMarketActivity.activityWindows?.[coinPulsePeriod];
  const note = document.querySelector('#coin-pulse-note');
  const buyBar = document.querySelector('#coin-pulse-buy-bar');
  const sellBar = document.querySelector('#coin-pulse-sell-bar');
  if (!pulse) {
    const label = coinMarketActivity.status === 'loading' ? 'Loading…' : 'Unavailable';
    ['#coin-pulse-trades','#coin-pulse-traders','#coin-pulse-volume','#coin-pulse-largest'].forEach(selector => setCoinField(selector, label));
    setCoinField('#coin-pulse-buy-count', 'Buys —'); setCoinField('#coin-pulse-sell-count', 'Sells —');
    if (buyBar) buyBar.style.width = '0%'; if (sellBar) sellBar.style.width = '0%';
    if (note) note.textContent = coinMarketActivity.status === 'loading' ? 'Reading confirmed Pump trades from Solana RPC…' : 'Activity windows unavailable from the current RPC scan.';
    return;
  }
  const partial = pulse.coverage === 'partial';
  const count = value => `${partial && value > 0 ? '≥' : ''}${formatOnChainNumber(value, 0)}`;
  const usd = value => formatExploreUsd(value, { partial });
  setCoinField('#coin-pulse-trades', count(pulse.tradeCount));
  setCoinField('#coin-pulse-traders', count(pulse.traderCount));
  setCoinField('#coin-pulse-volume', usd(pulse.volumeSol));
  setCoinField('#coin-pulse-largest', usd(pulse.largestTradeSol));
  setCoinField('#coin-pulse-buy-count', `Buys ${count(pulse.buyCount)}`);
  setCoinField('#coin-pulse-sell-count', `Sells ${count(pulse.sellCount)}`);
  const volume = Number(pulse.buyVolumeSol) + Number(pulse.sellVolumeSol);
  if (buyBar) buyBar.style.width = `${volume > 0 ? Number(pulse.buyVolumeSol) / volume * 100 : 0}%`;
  if (sellBar) sellBar.style.width = `${volume > 0 ? Number(pulse.sellVolumeSol) / volume * 100 : 0}%`;
  if (note) note.textContent = `${partial ? 'Partial RPC scan · values are observed lower bounds' : 'Complete RPC scan'} · Pump curve only · distinct trader addresses are not holder counts.`;
}
function coinAuthorityLabel(value){ return value === null ? 'Disabled' : value ? shortAddress(value) : 'Unavailable'; }
function setCoinAuthority(selector, value){ setCoinFact(selector, coinAuthorityLabel(value), value === null ? 'clear' : value ? 'caution' : 'unknown'); }
function setCoinTabLabels(){
  const labels = {
    trades: `Trades ${['ready', 'summary-only'].includes(coinMarketActivity.status) ? coinMarketActivity.tradeCount : '—'}`,
    chat: 'Chat',
    payments: `Fee claims ${coinActivity.status === 'ready' && coinActivity.ledgerAvailable ? coinActivity.collections.length : '—'}`,
    claims: `Allocations ${coinActivity.status === 'ready' && coinActivity.ledgerAvailable ? coinActivity.claims.length : '—'}`,
    holders: `Holders ${coinActivity.accountAvailable && coinActivity.holderCount > 0 ? `${coinActivity.holderCount}${coinActivity.holderCountPartial ? '+' : ''}` : '—'}`,
  };
  document.querySelectorAll('[data-coin-tab]').forEach(item => {
    item.textContent = labels[item.dataset.coinTab] || item.textContent;
    item.setAttribute('aria-selected', String(item.classList.contains('active')));
    item.tabIndex = item.classList.contains('active') ? 0 : -1;
  });
}
function renderCoinChat(activity){
  const messages = coinChatMessages;
  const rows = messages.length ? messages.map(tokenChatMessageMarkup).join('') : tokenChatEmptyMarkup();
  activity.innerHTML = `<div class="coin-chat"><div class="coin-chat-intro"><div><strong>${escapeHtml(coinActivity.symbol || 'Token')} chat</strong><small>Wallet-verified community messages</small></div><span>${messages.length} message${messages.length === 1 ? '' : 's'}</span></div><div class="coin-chat-messages">${rows}</div>${tokenChatComposerMarkup('coin-chat')}</div>`;
}
function tokenChatAuthorLabel(author){ return author ? shortAddress(author) : 'Unknown wallet'; }
function tokenChatEmptyMarkup(){
  if (coinChatState.loading) return '<div class="empty-state coin-activity-empty"><strong>Loading chat…</strong><small>Reading wallet-verified messages.</small></div>';
  if (!coinChatState.enabled) return `<div class="empty-state coin-activity-empty"><strong>Chat unavailable</strong><small>${escapeHtml(coinChatState.reason || 'The chat service could not be reached.')}</small></div>`;
  return '<div class="empty-state coin-activity-empty"><strong>Start the conversation</strong><small>Share a useful observation about this token. Your wallet verifies authorship; signing does not send a transaction.</small></div>';
}
function tokenChatMessageMarkup(item){
  const own = Boolean(connectedWalletAddress && item.author === connectedWalletAddress);
  const action = own
    ? `<button type="button" data-chat-delete="${escapeHtml(item.id)}">Delete</button>`
    : `<label class="coin-chat-report-reason"><span class="sr-only">Report reason</span><select aria-label="Report reason"><option value="spam-or-scam">Spam or scam</option><option value="harassment">Harassment</option><option value="misleading">Misleading</option><option value="other">Other</option></select></label><button type="button" data-chat-report="${escapeHtml(item.id)}">Report</button>`;
  const reports = Number(item.reportCount) > 0 ? `<span>${Number(item.reportCount)} report${Number(item.reportCount) === 1 ? '' : 's'}</span>` : '';
  return `<article class="coin-community-message" data-chat-message="${escapeHtml(item.id)}"><div><strong>${escapeHtml(tokenChatAuthorLabel(item.author))}<small class="verified-author">✓ wallet</small></strong><time>${escapeHtml(new Date(item.createdAt).toLocaleString())}</time></div><p>${escapeHtml(item.text)}</p><footer>${reports}${action}</footer></article>`;
}
function tokenChatComposerMarkup(prefix = 'coin-community'){
  if (!coinChatState.enabled) return '';
  const connected = Boolean(connectedWalletAddress);
  const ready = tokenChatSessionReady();
  const buttonLabel = !connected ? 'Connect wallet' : ready ? 'Post' : 'Verify once & post';
  const note = !connected ? 'Connect a Solana wallet to post' : ready ? `Posting as ${escapeHtml(shortAddress(connectedWalletAddress))} · no approval needed for each post` : `Posting as ${escapeHtml(shortAddress(connectedWalletAddress))} · one wallet approval starts a 30-minute chat session`;
  return `<form class="coin-chat-form coin-community-form" id="${prefix}-form"><label><span class="sr-only">Message</span><input id="${prefix}-input" maxlength="${TOKEN_CHAT_MAX_LENGTH}" autocomplete="off" placeholder="Share a useful observation…" required /></label><button class="primary-button" type="submit">${buttonLabel}</button></form><small class="coin-chat-note">${note}</small>`;
}
function renderCoinCommunityPanel(){
  const feed = document.querySelector('#coin-community-feed');
  if (!feed) return;
  feed.innerHTML = coinChatMessages.length ? coinChatMessages.slice(-12).map(tokenChatMessageMarkup).join('') : tokenChatEmptyMarkup();
  const panel = feed.closest('.coin-community-panel');
  const badge = panel?.querySelector('.data-badge');
  if (badge) { badge.textContent = coinChatState.loading ? 'LOADING' : coinChatState.enabled ? 'LIVE' : 'OFFLINE'; badge.classList.toggle('is-live', coinChatState.enabled); }
  panel?.querySelector('.coin-community-form')?.remove();
  panel?.querySelector('.coin-chat-note')?.remove();
  panel?.insertAdjacentHTML('beforeend', tokenChatComposerMarkup('coin-community'));
}
function ensureCoinCommunityPanel(){
  const layout = document.querySelector('.coin-layout');
  if (!layout) return;
  const existing = layout.querySelector('.coin-community-panel');
  if (existing) {
    if (existing !== layout.lastElementChild) layout.append(existing);
    return;
  }
  const panel = document.createElement('aside');
  panel.className = 'panel coin-community-panel';
  panel.innerHTML = '<div class="coin-community-head"><div><p class="eyebrow">Community</p><h2>Chat</h2></div><span class="data-badge">LOADING</span></div><div id="coin-community-feed" class="coin-community-feed"></div>';
  layout.append(panel);
  renderCoinCommunityPanel();
}
async function loadCoinChat(mintAddress, loadId = coinLoadId){
  coinChatMessages = [];
  coinChatState = { loading: true, enabled: false, reason: '' };
  renderCoinCommunityPanel();
  const response = await apiRequest(`/api/tokens/${encodeURIComponent(mintAddress)}/chat`, { signal: AbortSignal.timeout(5000) }).catch(() => ({ available: false, data: null }));
  if (loadId !== coinLoadId) return;
  coinChatMessages = response.available && Array.isArray(response.data?.messages) ? response.data.messages : [];
  coinChatState = { loading: false, enabled: response.available && response.data?.enabled === true, reason: response.data?.reason || (response.available ? '' : 'The chat service is unavailable.') };
  renderCoinCommunityPanel();
  if (document.querySelector('[data-coin-tab="chat"].active')) renderCoinActivityTab();
}
function ensureCoinChatTab(){
  document.querySelector('.coin-tabs [data-coin-tab="chat"]')?.remove();
  const holders = document.querySelector('.coin-tabs [data-coin-tab="holders"]');
  if (holders) holders.textContent = 'Holders —';
}
function ensureCoinPolicyAccordion(){
  const card = document.querySelector('.coin-policy-card');
  if (!card) return;
  card.classList.add('is-compact');
  card.querySelector('#coin-policy-toggle')?.remove();
  card.querySelector('.coin-panel-head')?.remove();
  card.classList.remove('is-expanded');
}
function renderCoinActivityTab(){
  const activity = document.querySelector('#coin-activity-list');
  if (!activity) return;
  const tab = document.querySelector('[data-coin-tab].active')?.dataset.coinTab || 'trades';
  const tradeToolbar = document.querySelector('#coin-trade-toolbar');
  if (tradeToolbar) tradeToolbar.hidden = tab !== 'trades';
  const tradeRefine = document.querySelector('#coin-trade-refine');
  if (tradeRefine) tradeRefine.hidden = tab !== 'trades';
  if (tab === 'chat') { renderCoinChat(activity); return; }
  if (tab === 'trades' && coinMarketActivity.status === 'loading') {
    activity.innerHTML = '<div class="empty-state coin-activity-empty"><strong>Reading confirmed Pump trades…</strong><small>The 24-hour activity feed is loading from Solana RPC.</small></div>';
    return;
  }
  if (tab === 'trades' && coinMarketActivity.status === 'unavailable') {
    activity.innerHTML = '<div class="empty-state coin-activity-empty"><strong>Recent trades unavailable</strong><small>No confirmed Pump trade history was returned for this mint. Fee records and token accounts can still be inspected in the other tabs.</small></div>';
    return;
  }
  if (tab === 'trades' && coinMarketActivity.status === 'summary-only') {
    activity.innerHTML = '<div class="empty-state coin-activity-empty"><strong>Trade rows not indexed</strong><small>The 24-hour summary is available, but this cached response has no individual trade records. Refresh after the cache expires.</small></div>';
    return;
  }
  if (tab === 'trades') {
    const walletQuery = document.querySelector('#coin-trade-wallet')?.value.trim().toLowerCase() || '';
    const minInput = document.querySelector('#coin-trade-min-sol')?.value || '';
    const minSol = minInput === '' ? 0 : Math.max(0, Number(minInput) || 0);
    const trades = selectRecentTrades(coinMarketActivity.trades, { side: coinTradeFilter, wallet: walletQuery, minSol });
    const mint = getCoinMintAddress();
    const symbol = coinActivity.symbol || 'TOKEN';
    const explorerIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 4h14l-3 3H3z" fill="#78e7b4"/><path d="M4 10h14l3 3H7z" fill="#ab91ff"/><path d="M6 16h14l-3 3H3z" fill="#78e7b4"/></svg>';
    const rows = trades.map(item => {
      const timestamp = Number(item.blockTime) * 1000;
      const validTime = Number.isFinite(timestamp) && timestamp > 0 && timestamp < 8.64e15;
      const time = validTime ? new Date(timestamp).toLocaleString() : 'Time unavailable';
      const sol = Number(item.solLamports) / 1_000_000_000;
      const tokens = Number(item.tokenAmountRaw) / (10 ** coinMarketActivity.decimals);
      const side = item.side === 'buy' ? 'Buy' : 'Sell';
      const tokenQuantity = Number.isFinite(tokens) ? formatOnChainNumber(tokens, tokens >= 1 ? 2 : 6) : '—';
      const price = Number.isFinite(sol) && Number.isFinite(tokens) && tokens > 0 ? formatCoinSnapshotUsd(sol / tokens) : '$—';
      return `<tr class="coin-transaction-row ${item.side === 'buy' ? 'is-buy' : 'is-sell'}" data-logo-mint="${escapeHtml(mint)}"><td><time datetime="${validTime ? new Date(timestamp).toISOString() : ''}" title="${escapeHtml(time)}">${validTime ? escapeHtml(formatOnchainAge(timestamp)) : '—'}</time></td><td><span class="coin-transaction-side"><i aria-hidden="true">${item.side === 'buy' ? '↑' : '↓'}</i>${side}</span></td><td class="coin-transaction-number">${Number.isFinite(sol) ? escapeHtml(formatCoinUsd(sol)) : '$—'}</td><td><span class="coin-transaction-token"><span class="coin-trade-token-avatar" aria-hidden="true">${escapeHtml(symbol.slice(0, 1).toUpperCase())}</span><span>${escapeHtml(tokenQuantity)} <small>${escapeHtml(symbol)}</small></span></span></td><td class="coin-transaction-number">${Number.isFinite(sol) ? escapeHtml(formatOnChainNumber(sol, 6)) : '—'}</td><td class="coin-transaction-number">${escapeHtml(price)}</td><td><a class="coin-transaction-trader" href="/wallet/${encodeURIComponent(item.trader)}" aria-label="View wallet profile for ${escapeHtml(item.trader)}">${escapeHtml(shortAddress(item.trader))}</a></td><td><a class="coin-trade-explorer" href="${escapeHtml(exploreExplorer(`tx/${encodeURIComponent(item.signature)}`))}" target="_blank" rel="noopener noreferrer" aria-label="View ${side} ${escapeHtml(symbol)} transaction on Solana Explorer" title="View transaction on Solana Explorer">${explorerIcon}</a></td></tr>`;
    }).join('');
    activity.innerHTML = trades.length ? `<div class="coin-transactions-scroll" role="region" aria-label="${escapeHtml(symbol)} transactions" tabindex="0"><table class="coin-transactions-table"><thead><tr><th scope="col">Date</th><th scope="col">Type</th><th scope="col" title="At the current SOL/USD quote">USD est.</th><th scope="col">Token</th><th scope="col">SOL</th><th scope="col" title="Average trade price at the current SOL/USD quote">Price est.</th><th scope="col">Trader</th><th scope="col">Txn</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="empty-state coin-activity-empty"><strong>No matching trades in this view</strong><small>${coinMarketActivity.coverage === 'partial' ? 'RPC coverage is partial; more activity may exist.' : coinTradeFilter !== 'all' || walletQuery || minSol ? 'Filters apply to the latest 20 shown. The 24-hour totals include all scanned trades.' : 'No confirmed Pump bonding-curve trade was found in the scanned 24-hour window.'}</small></div>`;
    if (trades.length) loadVerifiedTokenLogos(activity);
    return;
  }
  if (coinActivity.status === 'loading') {
    activity.innerHTML = '<div class="coin-activity-row"><span class="activity-icon">◎</span><span><strong>Reading token records</strong><small>Confirmed Solana RPC request in progress</small></span><b class="activity-amount">—</b><span class="activity-time">RPC</span></div>';
    return;
  }
  if (coinActivity.status === 'unavailable') {
    activity.innerHTML = `<div class="coin-activity-row"><span class="activity-icon">!</span><span><strong>Token data unavailable</strong><small>${escapeHtml(coinActivity.message || 'Solana RPC could not load this mint.')}</small></span><b class="activity-amount">—</b><span class="activity-time">RPC</span></div>`;
    return;
  }
  if (tab === 'holders') {
    if (!coinActivity.accountAvailable) { activity.innerHTML = '<div class="empty-state coin-activity-empty"><strong>Token-account sample unavailable</strong><small>Solana RPC did not return token accounts for this mint.</small></div>'; return; }
    const holderAccounts = coinActivity.accounts.filter(item => item.address !== coinActivity.vaultAddress).sort((a, b) => (Number(b.balance) || 0) - (Number(a.balance) || 0));
    const scope = coinActivity.holderCountPartial ? 'Largest non-zero token-account sample; more holders may exist.' : 'Non-zero token-account sample.';
    const explorerIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 4h14l-3 3H3z" fill="#78e7b4"/><path d="M4 10h14l3 3H7z" fill="#ab91ff"/><path d="M6 16h14l-3 3H3z" fill="#78e7b4"/></svg>';
    const rows = holderAccounts.map((item, index) => {
      const share = Number.isFinite(item.share) ? Math.max(0, Math.min(100, item.share)) : null;
      const wallet = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(item.wallet || '') ? item.wallet : null;
      const address = wallet || item.address;
      const balance = Number(item.balance);
      const value = Number.isFinite(balance) && Number.isFinite(coinSolUsdValues.spot) && coinSolUsdValues.spot > 0 && Number.isFinite(coinSolUsdPrice) && coinSolUsdPrice > 0 ? formatUsd(balance * coinSolUsdValues.spot * coinSolUsdPrice) : '$—';
      const profile = wallet ? `/wallet/${encodeURIComponent(wallet)}` : exploreExplorer(`address/${encodeURIComponent(item.address)}`);
      const tradeAction = wallet ? `<button type="button" class="coin-holder-trades" data-coin-holder-trades="${escapeHtml(wallet)}" aria-label="Show recent trades by ${escapeHtml(wallet)}" title="Filter recent trades by this wallet">⌕</button>` : '<span class="coin-holder-no-trades" title="Wallet owner unavailable">—</span>';
      return `<tr><td class="coin-holder-rank">#${index + 1}</td><td><a class="coin-holder-address" href="${escapeHtml(profile)}" ${wallet ? '' : 'target="_blank" rel="noopener noreferrer"'} title="${escapeHtml(address)}">${escapeHtml(shortAddress(address))}</a>${wallet ? '' : '<small class="coin-holder-account-note">Token account</small>'}</td><td class="coin-holder-percent">${share == null ? '—' : `${escapeHtml(formatOnChainNumber(share, 2))}%`}</td><td><div class="coin-holder-amount"><strong>${escapeHtml(item.amount)} <small>${escapeHtml(coinActivity.symbol)}</small></strong><span class="coin-holder-bar" aria-hidden="true"><i style="width:${share == null ? 0 : share}%"></i></span></div></td><td class="coin-holder-value">${escapeHtml(value)}</td><td class="coin-holder-action">${tradeAction}</td><td class="coin-holder-action"><a class="coin-trade-explorer" href="${escapeHtml(exploreExplorer(`address/${encodeURIComponent(item.address)}`))}" target="_blank" rel="noopener noreferrer" aria-label="View token account ${escapeHtml(item.address)} on Solana Explorer" title="View token account on Solana Explorer">${explorerIcon}</a></td></tr>`;
    }).join('');
    activity.innerHTML = `<p class="coin-activity-scope">${scope} Balances are per token account, so rows may share a wallet. Protocol vault excluded. Value uses the current token spot price and SOL/USD quote.</p>` + (rows ? `<div class="coin-transactions-scroll coin-holders-scroll" role="region" aria-label="${escapeHtml(coinActivity.symbol)} holder account sample" tabindex="0"><table class="coin-transactions-table coin-holders-table"><thead><tr><th scope="col">Rank</th><th scope="col">Address</th><th scope="col">% supply</th><th scope="col">Amount</th><th scope="col" title="Spot token price at the current SOL/USD quote">Value est.</th><th scope="col">Txns</th><th scope="col">Explore</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty-state coin-activity-empty"><strong>No holders found</strong><small>No non-vault token accounts were returned.</small></div>');
    return;
  }
  if (!coinActivity.ledgerAvailable) {
    activity.innerHTML = '<div class="empty-state coin-activity-empty"><strong>Fee activity unavailable</strong><small>No mint-attributed claim or allocation count can be confirmed.</small></div>';
    return;
  }
  if (tab === 'claims') {
    activity.innerHTML = coinActivity.claims.length ? coinActivity.claims.map(item => `<div class="coin-activity-row"><span class="activity-icon">◌</span><span><strong>Fee allocation ${escapeHtml(item.status)}</strong><small>Claim ${escapeHtml(shortAddress(item.claimSignature))} · ${escapeHtml(coinActivity.ledgerSource)}</small></span><b class="activity-amount">${item.grossCreatorFees == null ? '—' : escapeHtml(formatOnChainNumber(Number(item.grossCreatorFees), 6))} ${escapeHtml(item.asset)}</b><span class="activity-time">${escapeHtml(item.claimedAt ? new Date(item.claimedAt).toLocaleDateString() : 'recorded')}</span></div>`).join('') : '<div class="empty-state coin-activity-empty"><strong>No allocation attributed to this mint</strong><small>Shared-router claims are excluded from per-coin totals.</small></div>';
    return;
  }
  const mintRows = coinActivity.collections.map(item => `<div class="coin-activity-row"><span class="activity-icon">↗</span><span><strong>Mint-attributed fee claim</strong><small><a href="${escapeHtml(exploreExplorer(`tx/${item.signature}`))}" target="_blank" rel="noreferrer">View ${escapeHtml(shortAddress(item.signature))} on Explorer ↗</a> · ${escapeHtml(coinActivity.ledgerSource)}</small></span><b class="activity-amount">${item.collectedLamports == null ? '—' : escapeHtml(formatOnChainNumber(Number(item.collectedLamports) / 1_000_000_000, 6))} SOL</b><span class="activity-time">${escapeHtml(item.recordedAt ? new Date(item.recordedAt).toLocaleDateString() : 'recorded')}</span></div>`).join('');
  const routerRows = (coinActivity.sharedRouterCollections || []).map(item => `<div class="coin-activity-row"><span class="activity-icon">↗</span><span><strong>Shared-router fee collection</strong><small><a href="${escapeHtml(exploreExplorer(`tx/${item.signature}`))}" target="_blank" rel="noreferrer">View ${escapeHtml(shortAddress(item.signature))} on Explorer ↗</a> · not attributable to this coin</small></span><b class="activity-amount">${escapeHtml(formatOnChainNumber(Number(item.collectedLamports) / 1_000_000_000, 6))} SOL</b><span class="activity-time">${escapeHtml(item.recordedAt ? new Date(item.recordedAt).toLocaleDateString() : 'recorded')}</span></div>`).join('');
  activity.innerHTML = (mintRows || '<div class="empty-state coin-activity-empty"><strong>No fee claim attributed to this mint</strong><small>Only mint-verified collections appear in this ledger.</small></div>') + (routerRows ? '<div class="coin-activity-context"><strong>Shared-router collection</strong><span>This receipt may include other coins and is excluded from this mint’s totals.</span></div>' + routerRows : '');
}
function renderOnChainUnavailable(message){
  coinTradeEstimate = null;
  renderTradeAmountEstimate();
  coinActivity = { status: 'unavailable', message, collections: [], claims: [], accounts: [] };
  coinSummaryLaunch = null;
  coinSummaryLedgerMint = null;
  renderCoinFeeDashboard({ available:false });
  renderCoinAccountDistribution(null);
  coinMarketActivity = { status: 'unavailable', trades: [], coverage: null, decimals: 6 };
  renderCoinPricePath(); renderCoinFlow(NaN, NaN); renderCoinPulse();
  setCoinTabLabels(); renderCoinActivityTab();
  setCoinField('.coin-live-dot', 'Data unavailable');
  setCoinField('#coin-page-title', 'Token data unavailable');
  setCoinField('#coin-avatar', '?'); setCoinField('#coin-symbol', '—'); setCoinField('#coin-description', message);
  ['#coin-stage','#coin-fee-owner','#coin-metadata-status','#coin-mint-authority','#coin-freeze-authority'].forEach(selector => setCoinFact(selector, 'Unavailable'));
  ['#coin-market-cap','#coin-change','#coin-strip-market-cap','#coin-volume','#coin-liquidity','#coin-holders','#coin-trade-count','#coin-vault-share','#coin-largest-account-share','#coin-top-ten-share','#coin-supply'].forEach(selector => setCoinField(selector, 'Unavailable'));
  setCoinField('#coin-volume-source', 'RPC trade history unavailable'); setCoinField('#coin-trade-breakdown', 'RPC trade history unavailable'); setCoinField('#coin-trade-coverage', 'Trade history unavailable'); setCoinField('#coin-accounts-source', 'Largest-account sample unavailable'); setCoinCurveProgress(null);
  setCoinField('#coin-chart-heading', 'On-chain snapshot');
  setCoinField('#coin-market-cap-label', 'Estimated market cap'); setCoinField('#coin-market-cap-source', 'Confirmed Solana RPC snapshot');
  setCoinField('#coin-liquidity-label', 'Reserve'); setCoinField('#coin-liquidity-source', 'Confirmed on-chain state unavailable');
  const chart = document.querySelector('.coin-chart'); if (chart) chart.innerHTML = `<div class="onchain-snapshot"><div><span>Snapshot</span><strong>Unavailable</strong></div><div><span>Source</span><strong>Solana RPC</strong></div></div>`;
  const footer = document.querySelector('.chart-footer'); if (footer) footer.innerHTML = '<span>On-chain only</span><span>Historical candles not indexed</span>';
  const policyEyebrow = document.querySelector('.coin-policy-card .eyebrow'); if (policyEyebrow) policyEyebrow.textContent = 'On-chain account';
  const policyBadge = document.querySelector('.coin-policy-card .data-badge'); if (policyBadge) policyBadge.textContent = 'RPC only';
  const policyTitle = document.querySelector('.coin-policy-card h2'); if (policyTitle) policyTitle.textContent = 'Curve unavailable';
  renderCoinCreatorRoute('');
  const policySplit = document.querySelector('.policy-split'); if (policySplit) policySplit.innerHTML = '<span><b>—</b><small>Curve state</small></span><span><b>—</b><small>Creator</small></span>';
  const policyBar = document.querySelector('.policy-bar'); if (policyBar) { policyBar.style.display = 'block'; policyBar.innerHTML = '<i style="display:block;height:100%;width:100%;background:#667085"></i>'; }
  const policyLink = document.querySelector('.policy-link'); if (policyLink) policyLink.hidden = true;
}
function resetCoinSurface(mintAddress){
  coinTradeEstimate = null;
  renderTradeAmountEstimate();
  document.querySelector('#coin-launched-by')?.remove();
  ensureCoinChatTab();
  ensureCoinPolicyAccordion();
  const coinLayout = document.querySelector('.coin-layout');
  const transactionPanel = document.querySelector('.coin-tabs-panel');
  if (coinLayout && transactionPanel?.parentElement !== coinLayout) coinLayout.append(transactionPanel);
  ensureCoinCommunityPanel();
  renderCoinCreatorHeader('');
  const snapshotMode = document.querySelector('[data-coin-chart-view="snapshot"]');
  const tradesMode = document.querySelector('[data-coin-chart-view="trades"]');
  if (snapshotMode) snapshotMode.textContent = 'Snapshot';
  if (tradesMode) tradesMode.textContent = 'Chart';
  coinChatMessages = [];
  coinChatState = { loading: true, enabled: false, reason: '' };
  renderCoinCommunityPanel();
  coinActivity = { status: 'loading', collections: [], claims: [], accounts: [] };
  coinSummaryLaunch = null;
  coinSummaryLedgerMint = null;
  renderCoinFeeDashboard();
  renderCoinAccountDistribution(null);
  coinMarketActivity = { status: 'loading', trades: [], coverage: null, decimals: 6 };
  coinSolUsdValues = { spot: NaN, marketCap: NaN, reserve: NaN, virtualQuote: NaN };
  coinTradeFilter = 'all';
  coinPulsePeriod = '24h';
  setCoinChartView('snapshot');
  const walletFilter = document.querySelector('#coin-trade-wallet'); if (walletFilter) walletFilter.value = '';
  const sizeFilter = document.querySelector('#coin-trade-min-sol'); if (sizeFilter) sizeFilter.value = '';
  document.querySelectorAll('[data-coin-tab]').forEach(button => button.classList.toggle('active', button.dataset.coinTab === 'trades'));
  document.querySelectorAll('[data-coin-trade-filter]').forEach(button => { const active = button.dataset.coinTradeFilter === 'all'; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  renderCoinFlow(NaN, NaN); renderCoinPulse();
  const path = document.querySelector('#coin-price-path'); if (path) path.innerHTML = '<div class="empty-state coin-activity-empty"><strong>Reading trade observations…</strong><small>This is not a historical candle chart.</small></div>';
  const tradeMint = document.querySelector('#trade-mint'); if (tradeMint) tradeMint.value = mintAddress || '';
  void refreshTradeBalances();
  invalidateTradePreview();
  queueTradeQuote();
  setCoinTabLabels(); renderCoinActivityTab();
  setCoinField('.coin-live-dot', 'Checking data');
  setCoinField('#coin-avatar', '?'); setCoinField('#coin-symbol', 'TOKEN'); setCoinField('#coin-page-title', 'Loading token…'); setCoinField('#coin-address', shortAddress(mintAddress));
  setCoinFact('#coin-stage', 'Checking curve'); setCoinFact('#coin-fee-owner', 'Checking route'); setCoinFact('#coin-metadata-status', 'Reading mint');
  setCoinFact('#coin-mint-authority', 'Checking…'); setCoinFact('#coin-freeze-authority', 'Checking…');
  const avatar = document.querySelector('#coin-avatar'); if (avatar) avatar.style.backgroundImage = '';
  ['#coin-website-link', '#coin-x-link', '#coin-telegram-link', '#coin-discord-link'].forEach(selector => { const link = document.querySelector(selector); if (link) { link.hidden = true; link.removeAttribute('href'); } });
  compactCoinSocials();
  setCoinField('#coin-description', 'Reading the mint, metadata account, and Pump bonding curve from Solana RPC…');
  setCoinField('#coin-market-cap-label', 'Estimated market cap'); setCoinField('#coin-market-cap-source', 'Reading confirmed Solana RPC state');
  setCoinField('#coin-liquidity-label', 'Reserve'); setCoinField('#coin-liquidity-source', 'Reading confirmed on-chain state');
  const explorerLink = document.querySelector('#coin-explorer-link'); if (explorerLink) { explorerLink.href = exploreExplorer(`address/${encodeURIComponent(mintAddress)}`); explorerLink.hidden = !mintAddress; }
  document.querySelectorAll('.coin-chart-panel .chart-tools button').forEach(button => { button.disabled = true; button.title = 'Historical candles are not indexed for this token.'; });
  ['#coin-market-cap','#coin-change','#coin-strip-market-cap','#coin-volume','#coin-liquidity','#coin-holders','#coin-trade-count','#coin-vault-share','#coin-largest-account-share','#coin-top-ten-share','#coin-supply'].forEach(selector => setCoinField(selector, 'Loading…'));
  setCoinField('#coin-volume-source', 'RPC trade scan if available'); setCoinField('#coin-trade-breakdown', 'Confirmed Pump events'); setCoinField('#coin-trade-coverage', 'Reading confirmed trades…'); setCoinField('#coin-accounts-source', 'Largest-account sample, not holder count'); setCoinCurveProgress(null);
  setCoinField('#coin-chart-heading', 'On-chain snapshot');
  const chart = document.querySelector('.coin-chart'); if (chart) chart.innerHTML = '<div class="onchain-snapshot"><div><span>Snapshot</span><strong>Loading…</strong></div><div><span>Source</span><strong>Solana RPC</strong></div></div>';
  const footer = document.querySelector('.chart-footer'); if (footer) footer.innerHTML = '<span>On-chain only</span><span>Historical candles not indexed</span>';
  const policyBadge = document.querySelector('.coin-policy-card .data-badge'); if (policyBadge) policyBadge.textContent = 'RPC only';
  const policyTitle = document.querySelector('.coin-policy-card h2'); if (policyTitle) policyTitle.textContent = 'Reading Pump curve…';
  renderCoinCreatorRoute('');
  const policySplit = document.querySelector('.policy-split'); if (policySplit) policySplit.innerHTML = '<span><b>—</b><small>Curve state</small></span><span><b>—</b><small>Real tokens</small></span>';
  const policyBar = document.querySelector('.policy-bar'); if (policyBar) { policyBar.style.display = 'block'; policyBar.innerHTML = '<i style="display:block;height:100%;width:100%;background:#667085"></i>'; }
  const policyLink = document.querySelector('.policy-link'); if (policyLink) policyLink.hidden = true;
  setCoinField('#coin-network', `Solana · ${EXPLORE_CLUSTER}`);
}
async function loadCoinMarketActivity(mintAddress, loadId, decimals, graduated){
  if (graduated) {
    coinMarketActivity = { status: 'unavailable', trades: [], coverage: null, decimals, graduated: true };
    renderCoinPricePath(); renderCoinFlow(NaN, NaN); renderCoinPulse();
    setCoinField('#coin-volume', 'Pool activity unindexed'); setCoinField('#coin-volume-source', 'PumpSwap swaps are not indexed yet');
    setCoinField('#coin-change', 'Pool change unindexed'); setCoinField('#coin-trade-count', 'Unindexed');
    setCoinField('#coin-trade-breakdown', 'Pool trades not indexed'); setCoinField('#coin-trade-coverage', 'Post-migration PumpSwap trade history is not indexed yet.');
    setCoinTabLabels(); renderCoinActivityTab();
    renderCoinSummary();
    return;
  }
  const response = await apiRequest(`/api/tokens/${encodeURIComponent(mintAddress)}/market-activity`, { signal: AbortSignal.timeout(12000) }).catch(() => ({ available: false, data: null }));
  if (loadId !== coinLoadId) return;
  const market = response.available && response.data?.cluster === EXPLORE_CLUSTER ? response.data : null;
  if (!market || market.volume24hSol == null || !Number.isFinite(Number(market.volume24hSol))) {
    coinMarketActivity = { status: 'unavailable', trades: [], coverage: null, decimals };
    renderCoinPricePath(); renderCoinFlow(NaN, NaN); renderCoinPulse();
    setCoinField('#coin-volume', 'Unavailable'); setCoinField('#coin-volume-source', 'RPC trade history unavailable');
    setCoinField('#coin-trade-count', 'Unavailable'); setCoinField('#coin-trade-breakdown', 'RPC trade history unavailable'); setCoinField('#coin-trade-coverage', 'Trade history unavailable');
    setCoinTabLabels(); renderCoinActivityTab();
    renderCoinSummary();
    return;
  }
  const hasTradeRows = Array.isArray(market.recentTrades);
  const quote = [market.solUsdPrice, market.nativeUsdPrice, market.solPriceUsd].map(Number).find(Number.isFinite);
  if (Number.isFinite(quote) && quote > 0) {
    coinSolUsdPrice = quote;
    setCoinField('#coin-market-cap', formatCoinUsd(coinSolUsdValues.marketCap));
    setCoinField('#coin-strip-market-cap', formatCoinUsd(coinSolUsdValues.marketCap));
    setCoinField('#coin-liquidity', formatCoinUsd(coinSolUsdValues.reserve));
    renderCoinSnapshotUsd();
  }
  coinMarketActivity = { status: hasTradeRows ? 'ready' : 'summary-only', trades: hasTradeRows ? market.recentTrades : [], activityWindows: market.activityWindows, coverage: market.coverage, decimals, graduated: false, tradeCount: Number(market.tradeCount24h) || 0, volume24hSol: Number(market.volume24hSol), buyVolume24hSol: Number(market.buyVolume24hSol), sellVolume24hSol: Number(market.sellVolume24hSol) };
  renderCoinSummary();
  const partial = market.coverage === 'partial';
  if (hasTradeRows && market.recentTrades.length >= 2) setCoinChartView('trades');
  renderCoinPricePath(); renderCoinPulse();
  renderCoinFlow(market.buyVolume24hSol, market.sellVolume24hSol, partial);
  setCoinField('#coin-trade-count', `${partial ? '≥' : ''}${coinMarketActivity.tradeCount}`);
  const hasSideCounts = Number.isInteger(market.buyCount24h) && Number.isInteger(market.sellCount24h);
  setCoinField('#coin-trade-breakdown', hasSideCounts ? `${partial ? '≥' : ''}${market.buyCount24h} buys · ${partial ? '≥' : ''}${market.sellCount24h} sells` : 'Buy/sell split unavailable');
  setCoinField('#coin-trade-coverage', `Confirmed Pump bonding-curve trades · last 24h${partial ? ' · partial RPC scan' : ''} · ${hasTradeRows ? `latest ${Math.min(20, coinMarketActivity.trades.length)} shown` : 'individual rows not indexed'}${graduated ? ' · post-graduation pool trades excluded' : ''}`);
  setCoinTabLabels(); renderCoinActivityTab();
  const noTrades = market.coverage === 'complete' && Number(market.tradeCount24h) === 0;
  const volume = `${market.coverage === 'partial' ? '≥' : ''}${formatCoinUsd(Number(market.volume24hSol))}`;
  setCoinField('#coin-volume', noTrades ? 'No trades' : market.coverage === 'partial' ? `${volume} · partial` : volume);
  setCoinField('#coin-volume-source', noTrades ? 'Complete Pump curve scan · last 24h' : partial ? 'Partial curve RPC scan' : 'Pump curve RPC scan · 24h');
  const change = Number(market.priceChangePercent);
  const basis = market.priceChangeBasis;
  setCoinField('#coin-change', noTrades ? 'No 24h trades' : market.priceChangePercent != null && Number.isFinite(change) && basis
    ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}% ${basis === '24h' ? '24h' : 'since first trade'}`
    : '24h change unavailable');
}
async function loadCoinOnChain(mintAddress){
  const loadId = ++coinLoadId;
  if (!mintAddress){ renderOnChainUnavailable('A mint address is required. Open a /token/{mint} route to load on-chain data.'); return; }
  void loadCoinChat(mintAddress, loadId);
  setCoinField('#coin-page-title', 'Loading token…'); setCoinField('#coin-symbol', 'RPC'); setCoinField('#coin-address', shortAddress(mintAddress));
  setCoinField('#coin-description', 'Reading the mint, metadata account, and Pump bonding curve from Solana RPC…');
  try {
    const { PublicKey, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } = await getSolana();
    const detailConnection = await getExploreConnection();
    const mint = new PublicKey(mintAddress);
    const metadataProgram = new PublicKey(TOKEN_METADATA_PROGRAM_ID);
    const [metadataPda] = PublicKey.findProgramAddressSync([Buffer.from('metadata'), metadataProgram.toBuffer(), mint.toBuffer()], metadataProgram);
    const rpcRequest = (promise, label) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), 12000))]);
    const [mintResult, metadataResult, curveResult, largestResult, launchesResult] = await Promise.allSettled([
      rpcRequest(detailConnection.getParsedAccountInfo(mint, 'confirmed'), 'Mint RPC request'),
      rpcRequest(detailConnection.getAccountInfo(metadataPda, 'confirmed'), 'Metadata RPC request'),
      rpcRequest(fetchBondingCurveSnapshot({ connection: detailConnection, mint }), 'Pump curve RPC request'),
      rpcRequest(fetchTokenAccountSample(mintAddress, detailConnection, PublicKey), 'Token-account RPC request'),
      apiRequest('/api/launches', { signal: AbortSignal.timeout(5000) }),
    ]);
    if (loadId !== coinLoadId) return;
    if (mintResult.status === 'rejected') throw mintResult.reason;
    const mintInfo = mintResult.value;
    const metadataInfo = metadataResult.status === 'fulfilled' ? metadataResult.value : null;
    const curve = curveResult.status === 'fulfilled' ? curveResult.value : null;
    const largestAccounts = largestResult.status === 'fulfilled' ? largestResult.value.accounts : [];
    const parsedMint = mintInfo.value?.data?.parsed?.info;
    if (!parsedMint) throw new Error('Mint account was not returned by Solana RPC.');
    const decimals = Number(parsedMint.decimals ?? 0);
    const supply = Number(parsedMint.supply) / (10 ** decimals);
    let graduatedPool = null;
    if (curve?.complete) {
      try { graduatedPool = await rpcRequest(fetchGraduatedPoolSnapshot({ connection: detailConnection, mint, tokenDecimals: decimals }), 'PumpSwap pool RPC request'); }
      catch (error) { console.warn('Graduated PumpSwap pool snapshot unavailable', error); }
    }
    if (loadId !== coinLoadId) return;
    const metadata = parseOnChainMetadata(metadataInfo?.data);
    const registeredLaunch = launchesResult.status === 'fulfilled' && launchesResult.value.available
      ? verifiedRegistryLaunch(launchesResult.value.data, mintAddress, EXPLORE_CLUSTER)
      : null;
    coinSummaryLaunch = registeredLaunch;
    const symbol = metadata.symbol || registeredLaunch?.symbol || `${mintAddress.slice(0, 4)}…`;
    const name = metadata.name || registeredLaunch?.name || 'Unnamed on-chain token';
    coinTradeEstimate = { mint: mintAddress, symbol, curve, graduatedPool, decimals };
    updateTradeAmountLabel();
    void refreshTradeBalances();
    renderTradeAmountEstimate();
    const spotPriceSol = graduatedPool?.spotPriceSol ?? (curve && curve.virtualTokenReserves > 0 ? curve.virtualQuoteReservesSol / curve.virtualTokenReserves : NaN);
    const marketCapSol = spotPriceSol * supply;
    const accountAvailable = largestResult.status === 'fulfilled';
    const rawSupply = Number(parsedMint.supply);
    const tokenProgram = mintInfo.value.owner;
    const verifiedTokenProgram = tokenProgram?.equals?.(TOKEN_PROGRAM_ID) || tokenProgram?.equals?.(TOKEN_2022_PROGRAM_ID);
    const curveVaultAddress = graduatedPool?.poolBaseTokenAccount || (curve && verifiedTokenProgram
      ? getAssociatedTokenAddressSync(mint, bondingCurvePda(mint), true, tokenProgram).toBase58() : null);
    const accounts = largestAccounts.filter(item => Number(item.amount) > 0).map(item => {
      const balance = Number(item.uiAmountString == null || item.uiAmountString === '' ? Number(item.amount) / (10 ** decimals) : item.uiAmountString);
      return { address: String(item.address), wallet: item.wallet || null, balance, amount: formatOnChainNumber(balance, 4), share: rawSupply > 0 ? Number(item.amount) / rawSupply * 100 : null };
    });
    const tokenAccounts = accounts.length;
    const distribution = accountAvailable ? summarizeTokenAccounts(accounts, curveVaultAddress) : null;
    const holderAccounts = accounts.filter(item => item.address !== curveVaultAddress);
    const holderWallets = new Set(holderAccounts.map(item => item.wallet).filter(wallet => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet || '')));
    const holderCountPartial = largestResult.value?.coverage !== 'complete-account-list' || holderAccounts.some(item => !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(item.wallet || '')) || !distribution?.vaultAddress;
    const realQuote = graduatedPool?.quoteReservesSol ?? curve?.realQuoteReservesSol;
    const ledger = await apiRequest(`/api/tokens/${encodeURIComponent(mintAddress)}/fee-activity`, { signal: AbortSignal.timeout(8000) }).catch(() => ({ available: false, data: null }));
    if (loadId !== coinLoadId) return;
    const ledgerAvailable = ledger.available && ledger.data?.cluster === EXPLORE_CLUSTER;
    const linkedRouter = ledgerAvailable && curve?.creator === ledger.data?.sharedRouter?.address;
    coinActivity = { status: 'ready', symbol, accounts, accountAvailable, holderCount: holderWallets.size, holderCountPartial, vaultAddress: curveVaultAddress || null, vaultLabel: graduatedPool ? 'PumpSwap pool vault' : 'Pump curve vault', ledgerAvailable, ledgerSource: ledger.data?.source === 'funded.app-postgresql' ? 'app database' : 'file ledger', collections: ledgerAvailable ? ledger.data.collections || [] : [], claims: ledgerAvailable ? ledger.data.claims || [] : [], sharedRouterCollections: linkedRouter ? ledger.data.sharedRouter.collections || [] : [] };
    coinSummaryLedgerMint = ledgerAvailable && ledger.data?.mint === mintAddress ? mintAddress : null;
    renderCoinFeeDashboard(coinSummaryLedgerMint ? ledger.data?.overview : { available:false });
    renderCoinAccountDistribution(distribution, tokenAccounts, graduatedPool ? 'PumpSwap pool vault' : 'Curve vault');
    setCoinTabLabels(); renderCoinActivityTab();
    setCoinField('.coin-live-dot', 'RPC confirmed');
    setCoinField('#coin-avatar', symbol.slice(0, 1).toUpperCase()); setCoinField('#coin-symbol', symbol); setCoinField('#coin-page-title', name);
    setCoinField('#coin-address', shortAddress(mintAddress)); setCoinField('#coin-full-address', mintAddress);
    setCoinField('#coin-description', graduatedPool ? 'On-chain mint and verified PumpSwap pool snapshot. Pool trade history is not yet indexed.' : 'On-chain mint and Pump bonding-curve snapshot. Signed Devnet metadata is checked separately.');
    setCoinFact('#coin-stage', graduatedPool ? 'Migrated · PumpSwap' : curve ? curve.complete ? 'Curve complete · pool unavailable' : 'On Pump curve' : 'Unverified', curve ? 'clear' : 'unknown');
    setCoinFact('#coin-fee-owner', linkedRouter ? 'App router address matched' : curve?.creator ? shortAddress(curve.creator) : 'Unavailable', linkedRouter ? 'clear' : 'unknown');
    setCoinFact('#coin-metadata-status', metadataInfo?.data && (metadata.name || metadata.symbol) ? 'On-chain name / symbol' : registeredLaunch ? 'Pump create event verified' : 'No verified name', metadataInfo?.data && (metadata.name || metadata.symbol) || registeredLaunch ? 'clear' : 'unknown');
    coinSolUsdValues = { spot: spotPriceSol, marketCap: marketCapSol, reserve: realQuote, virtualQuote: curve?.virtualQuoteReservesSol ?? NaN };
    renderCoinSummary();
    setCoinField('#coin-market-cap', formatCoinUsd(marketCapSol)); setCoinField('#coin-change', '24h change unavailable');
    setCoinField('#coin-strip-market-cap', formatCoinUsd(marketCapSol));
    setCoinField('#coin-volume', curve && EXPLORE_CLUSTER === 'devnet' ? 'Reading trades…' : '$—'); setCoinField('#coin-liquidity', formatCoinUsd(realQuote));
    setCoinField('#coin-market-cap-label', graduatedPool ? 'Estimated PumpSwap market cap' : 'Estimated curve market cap');
    setCoinField('#coin-market-cap-source', graduatedPool ? 'PumpSwap vault ratio · indicative RPC snapshot' : 'Confirmed Pump curve RPC snapshot');
    setCoinField('#coin-liquidity-label', graduatedPool ? 'Pool reserve' : 'Real reserve');
    setCoinField('#coin-liquidity-source', graduatedPool ? 'Wrapped SOL in the verified PumpSwap vault' : 'Bonding curve · not DEX liquidity');
    setCoinField('#coin-holders', distribution ? `${formatOnChainNumber(distribution.otherShare, 2)}%` : 'Unavailable');
    setCoinField('#coin-accounts-source', distribution ? `${distribution.otherCount} non-vault token accounts in top ${tokenAccounts} · not unique wallets` : `${graduatedPool ? 'Pool' : 'Curve'} vault not identified in largest-account sample`);
    setCoinField('#coin-vault-share', distribution ? `${formatOnChainNumber(distribution.vaultShare, 2)}% of supply` : curveVaultAddress && accountAvailable ? 'Outside top sample' : 'Unavailable');
    setCoinField('#coin-largest-account-share', distribution ? distribution.otherCount ? `${formatOnChainNumber(distribution.largestOtherShare, 2)}% of supply` : 'None in sample' : 'Unavailable');
    setCoinField('#coin-top-ten-share', distribution ? distribution.otherCount ? `${formatOnChainNumber(distribution.topTenOtherShare, 2)}% of supply` : 'None in sample' : 'Unavailable');
    setCoinAuthority('#coin-mint-authority', parsedMint.mintAuthority); setCoinAuthority('#coin-freeze-authority', parsedMint.freezeAuthority);
    setCoinField('#coin-supply', `${formatOnChainNumber(supply, 6)} ${symbol}`); setCoinCurveProgress(curve?.complete ? 100 : curve?.progressPercent);
    const curveProgress = document.querySelector('.coin-curve-track > span'); if (curveProgress) curveProgress.textContent = graduatedPool ? 'Migration complete' : 'Bonding curve progress';
    setCoinField('#coin-chart-heading', `${symbol} / SOL ${graduatedPool ? 'pool' : 'curve'} snapshot`); setCoinField('#coin-full-address', mintAddress);
    const chart = document.querySelector('.coin-chart');
    if (chart) chart.innerHTML = graduatedPool ? `<div class="onchain-snapshot"><div><span>Pool spot price · USD/token</span><strong id="coin-snapshot-spot-usd">$—</strong><small>${formatCoinSpot(spotPriceSol)} per token</small></div><div><span>Token reserve</span><strong>${formatOnChainNumber(graduatedPool.baseTokenReserves, 4)} ${escapeHtml(symbol)}</strong></div><div><span>SOL reserve</span><strong>${formatCoinSpot(graduatedPool.quoteReservesSol)}</strong></div><div><span>Observed slot</span><strong>${graduatedPool.slot ?? '—'}</strong></div></div>` : curve ? `<div class="onchain-snapshot"><div><span>Spot price · USD/token</span><strong id="coin-snapshot-spot-usd">$—</strong><small>${formatCoinSpot(spotPriceSol)} per token</small></div><div><span>Virtual quote · USD</span><strong id="coin-snapshot-quote-usd">$—</strong><small>${formatCoinSpot(curve.virtualQuoteReservesSol)}</small></div><div><span>Real reserve</span><strong>${formatCoinSpot(realQuote)}</strong></div><div><span>Observed slot</span><strong>${curve.slot ?? '—'}</strong></div></div>` : `<div class="onchain-snapshot"><div><span>Pump curve</span><strong>Unavailable</strong></div><div><span>Cluster</span><strong>${EXPLORE_CLUSTER}</strong></div></div>`;
    const chartFooter = document.querySelector('.coin-chart-panel > .chart-footer'); if (chartFooter) chartFooter.innerHTML = `<span>Mint decimals <b>${decimals}</b></span><span>Supply <b>${formatOnChainNumber(supply, 6)}</b></span>`;
    renderCoinSnapshotUsd();
    const policyEyebrow = document.querySelector('.coin-policy-card .eyebrow'); if (policyEyebrow) policyEyebrow.textContent = 'On-chain account';
    const policyTitle = document.querySelector('.coin-policy-card h2'); if (policyTitle) policyTitle.textContent = graduatedPool ? 'Canonical PumpSwap pool' : curve ? 'Pump bonding curve' : 'Curve unavailable';
    renderCoinCreatorRoute(curve?.creator || '');
    renderCoinCreatorHeader(curve?.creator || '');
    document.querySelector('#coin-launched-by')?.remove();
    if (registeredLaunch?.creatorWallet) {
      const authorLink = document.createElement('a'); authorLink.id = 'coin-launched-by';
      authorLink.href = `/wallet/${encodeURIComponent(registeredLaunch.creatorWallet)}`;
      authorLink.textContent = `Launched by ${shortAddress(registeredLaunch.creatorWallet)}`;
      document.querySelector('.coin-attribution')?.append(authorLink);
    }
    const policySplit = document.querySelector('.policy-split'); if (policySplit) policySplit.innerHTML = graduatedPool ? `<span><b>${formatOnChainNumber(graduatedPool.baseTokenReserves, 0)}</b><small>Pool tokens</small></span><span><b>${formatOnChainNumber(graduatedPool.quoteReservesSol, 6)} SOL</b><small>Pool quote reserve</small></span>` : curve ? `<span><b>${curve.complete ? 'Complete' : 'Active'}</b><small>Curve state</small></span><span><b>${formatOnChainNumber(curve.realTokenReserves, 0)}</b><small>Real tokens</small></span>` : '<span><b>—</b><small>Curve state</small></span><span><b>—</b><small>Creator</small></span>';
    const policyBar = document.querySelector('.policy-bar'); if (policyBar) policyBar.innerHTML = curve ? `<i style="display:block;height:100%;width:${Math.max(0, Math.min(100, Number(curve.progressPercent) || 0))}%;background:#83cbb0"></i>` : '<i style="display:block;height:100%;width:100%;background:#667085"></i>';
     const policyLink = document.querySelector('.policy-link'); if (policyLink) { policyLink.textContent = graduatedPool ? 'View PumpSwap pool on explorer →' : 'View mint on explorer →'; policyLink.href = exploreExplorer(`address/${graduatedPool?.pool || mintAddress}`); policyLink.hidden = false; }
    const explorerLink = document.querySelector('#coin-explorer-link'); if (explorerLink) { explorerLink.href = exploreExplorer(`address/${mintAddress}`); explorerLink.hidden = false; }
    setCoinField('#coin-network', `Solana · ${EXPLORE_CLUSTER}`);
    if (EXPLORE_CLUSTER === 'devnet') void apiRequest(`/devnet-metadata/${encodeURIComponent(mintAddress)}`, { signal: AbortSignal.timeout(5000) }).then(response => {
      if (loadId !== coinLoadId || !response.available || response.data?.name !== name || response.data?.symbol !== symbol) return;
      const details = response.data;
      setCoinField('#coin-description', details.description || 'Signed Devnet metadata is available.');
      setCoinFact('#coin-metadata-status', 'App name / symbol matched', 'clear');
      if (details.image === `https://metadata.funded.vip/devnet-images/${mintAddress}`) {
        const avatar = document.querySelector('#coin-avatar');
        if (avatar) { avatar.textContent = ''; avatar.style.backgroundImage = `url("${details.image}")`; avatar.style.backgroundSize = 'cover'; avatar.style.backgroundPosition = 'center'; }
      }
      for (const [selector, href] of [['#coin-website-link', details.website], ['#coin-x-link', details.twitter], ['#coin-telegram-link', details.telegram], ['#coin-discord-link', details.discord]]) {
        const link = document.querySelector(selector); if (link && typeof href === 'string' && href.startsWith('https://')) { link.href = href; link.hidden = false; }
      }
      compactCoinSocials();
    }).catch(() => {});
    void loadSolUsdQuote();
    if (curve && EXPLORE_CLUSTER === 'devnet') void loadCoinMarketActivity(mintAddress, loadId, decimals, curve.complete === true);
    else { coinMarketActivity = { status: 'unavailable', trades: [], coverage: null, decimals }; renderCoinSummary(); renderCoinPricePath(); renderCoinFlow(NaN, NaN); renderCoinPulse(); setCoinField('#coin-trade-count', 'Unavailable'); setCoinField('#coin-trade-breakdown', 'Pump curve required'); setCoinField('#coin-trade-coverage', 'No Pump curve trade history'); setCoinTabLabels(); renderCoinActivityTab(); }
  } catch (error) {
    if (loadId !== coinLoadId) return;
    console.error('On-chain token detail failed', error);
    const detail = String(error?.message || '');
    renderOnChainUnavailable(/\b429\b|rate limit|too many requests/i.test(detail)
      ? 'Devnet RPC is rate limited. Wait a moment, then select Refresh.'
      : /timed out/i.test(detail)
        ? 'Devnet RPC timed out. Check your connection and select Refresh.'
        : detail || 'Solana RPC could not load this mint.');
  }
}
let coinExitExploreLoad = null;
function showCoinPage(open = true){
  const main = document.querySelector('.main-content');
  const page = document.querySelector('#coin-page');
  const walletPage = document.querySelector('#wallet-page');
  if (!main || !page) return;
  if (!open){
    ++coinLoadId;
    main.classList.remove('coin-view');
    page.hidden = true;
    // Navigation can beat the first token-detail render. A workspace route
    // still needs its first Explore check even if coin-view was never set.
    if (!exploreUpdatedAt && !coinExitExploreLoad) {
      coinExitExploreLoad = loadOnchainExploreData().catch(() => {
        const status = document.querySelector('#home-live-status');
        const note = document.querySelector('#home-verified-launches-note');
        if (status) status.textContent = 'Solana RPC · unavailable';
        if (note) note.textContent = 'Unable to verify live data';
      }).finally(() => { coinExitExploreLoad = null; });
    }
    return;
  }
  const mintAddress = getCoinMintAddress();
  main.classList.remove('wallet-view');
  if (walletPage) walletPage.hidden = true;
  setCoinField('#coin-full-address', mintAddress || 'No mint address');
  const addressButton = document.querySelector('#coin-copy-address');
  if (addressButton) setCoinField('#coin-address', shortAddress(mintAddress));
  resetCoinSurface(mintAddress); renderCoinPromotionBadge(); main.classList.add('coin-view'); page.hidden = false; window.scrollTo({ top: 0, behavior: 'smooth' });
  startCoinLabelSanitizer();
  const watch = document.querySelector('#coin-watch'); if (watch) setWatchButtonState(watch, getWatchlist().includes(mintAddress));
  loadCoinOnChain(mintAddress);
}
function coinRouteRequested(){ const directPath = location.pathname.startsWith('/token/') || location.pathname.startsWith('/launch/coin/'); return location.hash.startsWith('#coin/') || (directPath && !location.hash); }
function walletRouteRequested(){ return location.pathname.startsWith('/wallet/') && !location.hash; }
if (coinRouteRequested()) showCoinPage();
else if (walletRouteRequested()) showWalletPage();
else if (!exploreInitialLoadStarted && !exploreUpdatedAt) showCoinPage(false);
window.addEventListener('hashchange', () => { if (coinRouteRequested()) showCoinPage(); else if (walletRouteRequested()) showWalletPage(); else { showCoinPage(false); showWalletPage(false); } });
window.addEventListener('popstate', () => { if (coinRouteRequested()) showCoinPage(); else if (walletRouteRequested()) showWalletPage(); else { showCoinPage(false); showWalletPage(false); } });
document.querySelector('#asset-grid')?.addEventListener('click', event => { if (event.target.closest('button, a')) return; const card = event.target.closest('.asset-card'); const mint = card?.dataset.mint; if (!mint) return; location.href = `/token/${encodeURIComponent(mint)}`; });
document.querySelector('#coin-page')?.addEventListener('click', async event => {
  const reportMessage = event.target.closest('[data-chat-report]');
  if (reportMessage) {
    const reason = reportMessage.closest('[data-chat-message]')?.querySelector('.coin-chat-report-reason select')?.value || 'other';
    reportMessage.disabled = true;
    try { await tokenChatRequest('report', { messageId: reportMessage.dataset.chatReport, reason }); await refreshCoinChat(); showToast('Report received. Thank you for helping moderate the chat.'); }
    catch (error) { showToast(error.message || 'The report could not be submitted'); reportMessage.disabled = false; }
    return;
  }
  const deleteMessage = event.target.closest('[data-chat-delete]');
  if (deleteMessage) {
    deleteMessage.disabled = true;
    try { await tokenChatRequest('delete', { messageId: deleteMessage.dataset.chatDelete }); await refreshCoinChat(); showToast('Message deleted'); }
    catch (error) { showToast(error.message || 'The message could not be deleted'); deleteMessage.disabled = false; }
    return;
  }
  const creatorLink = event.target.closest('.coin-creator-link, #coin-creator-by');
  if (creatorLink) { event.preventDefault(); history.pushState({}, '', creatorLink.href); showWalletPage(); return; }
  const trade = event.target.closest('#coin-trade-button');
  if (trade) return;
  const chartMode = event.target.closest('[data-coin-chart-view]');
  if (chartMode){ setCoinChartView(chartMode.dataset.coinChartView); return; }
  const pulsePeriod = event.target.closest('[data-coin-pulse-period]');
  if (pulsePeriod){ coinPulsePeriod = pulsePeriod.dataset.coinPulsePeriod; renderCoinPulse(); return; }
  const refresh = event.target.closest('#coin-refresh');
  if (refresh){ const mint = getCoinMintAddress(); resetCoinSurface(mint); loadCoinOnChain(mint); return; }
  const watch = event.target.closest('#coin-watch');
  if (watch){ const mint = getCoinMintAddress(); if (!mint) return; const saved = getWatchlist(); saveWatchlist(saved.includes(mint) ? saved.filter(item => item !== mint) : [...saved, mint]); renderWatchlist(); setWatchButtonState(watch, getWatchlist().includes(mint)); return; }
  const share = event.target.closest('#coin-share-link');
  if (share){ event.preventDefault(); const mint = getCoinMintAddress(); if (!mint) return; const url = new URL(`/token/${encodeURIComponent(mint)}`, location.origin).toString(); try { await navigator.clipboard.writeText(url); showToast('Token link copied'); } catch { showToast(url); } return; }
  const copy = event.target.closest('#coin-copy-address, #coin-copy-full');
  if (copy){ const address = getCoinMintAddress(); if (!address) return showToast('No mint address in this route'); try { await navigator.clipboard.writeText(address); showToast('Token address copied'); } catch { showToast(address); } }
  const clearTradeFilters = event.target.closest('#coin-trade-clear');
  if (clearTradeFilters){ coinTradeFilter = 'all'; document.querySelectorAll('[data-coin-trade-filter]').forEach(button => { const active = button.dataset.coinTradeFilter === 'all'; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); }); document.querySelector('#coin-trade-wallet').value = ''; document.querySelector('#coin-trade-min-sol').value = ''; renderCoinActivityTab(); return; }
  const holderTrades = event.target.closest('[data-coin-holder-trades]');
  if (holderTrades){ const wallet = holderTrades.dataset.coinHolderTrades; if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet || '')) return; document.querySelector('#coin-trade-wallet').value = wallet; coinTradeFilter = 'all'; document.querySelectorAll('[data-coin-trade-filter]').forEach(button => { const active = button.dataset.coinTradeFilter === 'all'; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); }); document.querySelectorAll('[data-coin-tab]').forEach(button => button.classList.toggle('active', button.dataset.coinTab === 'trades')); setCoinTabLabels(); renderCoinActivityTab(); return; }
  const tradeFilter = event.target.closest('[data-coin-trade-filter]');
  if (tradeFilter){ coinTradeFilter = tradeFilter.dataset.coinTradeFilter; document.querySelectorAll('[data-coin-trade-filter]').forEach(button => { const active = button === tradeFilter; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); }); renderCoinActivityTab(); return; }
  const tab = event.target.closest('[data-coin-tab]');
  if (tab){ document.querySelectorAll('[data-coin-tab]').forEach(item => item.classList.toggle('active', item === tab)); setCoinTabLabels(); renderCoinActivityTab(); }
});
document.querySelector('#wallet-page')?.addEventListener('click', async event => {
  const tab = event.target.closest('[data-wallet-tab]');
  if (tab) {
    walletDetailTab = tab.dataset.walletTab;
    renderWalletDetail();
    return;
  }
  const copy = event.target.closest('#wallet-copy-address');
  if (!copy) return;
  const address = getWalletDetailAddress();
  if (!address) return showToast('No wallet address in this route');
  try { await navigator.clipboard.writeText(address); showToast('Wallet address copied'); } catch { showToast(address); }
});
document.querySelector('.wallet-detail-tabs')?.addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = [...document.querySelectorAll('[data-wallet-tab]')];
  const current = tabs.indexOf(document.activeElement);
  if (current < 0) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next].focus(); tabs[next].click();
});
function restoreCoinChatSession(address){
  try {
    const saved = JSON.parse(sessionStorage.getItem(COIN_CHAT_SESSION_KEY) || 'null');
    if (!saved) return;
    const validToken = typeof saved.token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(saved.token);
    if (validToken && saved.address === address && Number.isFinite(saved.expiresAtMs) && saved.expiresAtMs > Date.now() + 5_000) {
      coinChatSession = { address, version: walletVersion, token: saved.token, expiresAtMs: saved.expiresAtMs };
      return;
    }
    sessionStorage.removeItem(COIN_CHAT_SESSION_KEY);
    if (validToken && saved.address !== address) void apiRequest('/api/token-chat/session/revoke', { method: 'POST', headers: { 'x-token-chat-session': saved.token } }).catch(() => {});
  } catch { try { sessionStorage.removeItem(COIN_CHAT_SESSION_KEY); } catch {} }
}
function tokenChatSessionReady(){
  return Boolean(coinChatSession && coinChatSession.address === connectedWalletAddress && coinChatSession.version === walletVersion && coinChatSession.expiresAtMs > Date.now() + 5_000);
}
function updateTokenChatComposerState(){
  const connected = Boolean(connectedWalletAddress);
  const ready = tokenChatSessionReady();
  document.querySelectorAll('#coin-chat-form, #coin-community-form').forEach(form => {
    const button = form.querySelector('button[type="submit"]');
    if (button) button.textContent = !connected ? 'Connect wallet' : ready ? 'Post' : 'Verify once & post';
    const note = form.nextElementSibling;
    if (note?.classList.contains('coin-chat-note')) note.textContent = !connected ? 'Connect a Solana wallet to post' : ready ? `Posting as ${shortAddress(connectedWalletAddress)} · no approval needed for each post` : `Posting as ${shortAddress(connectedWalletAddress)} · one wallet approval starts a 30-minute chat session`;
  });
}
async function ensureTokenChatSession(session){
  assertWalletSessionCurrent(session);
  if (tokenChatSessionReady()) return coinChatSession.token;
  if (coinChatSessionPromise) return coinChatSessionPromise;
  const pending = (async () => {
    if (typeof session.provider.signMessage !== 'function') throw new Error('Connect a wallet that supports message signing.');
    const prepared = await apiRequest('/api/token-chat/session/prepare', { method: 'POST', body: { address: session.address } });
    if (!prepared.available || !prepared.data?.statement) throw new Error('Chat verification is unavailable.');
    assertWalletSessionCurrent(session);
    const signed = await session.provider.signMessage(new TextEncoder().encode(prepared.data.statement));
    assertWalletSessionCurrent(session);
    const verified = await apiRequest('/api/token-chat/session/verify', { method: 'POST', body: { challengeId: prepared.data.challengeId, signature: bs58.encode(signed.signature || signed) } });
    assertWalletSessionCurrent(session);
    if (!verified.available || verified.data?.address !== session.address || !verified.data?.token) throw new Error('Wallet verification could not be completed.');
    coinChatSession = { address: session.address, version: session.version, token: verified.data.token, expiresAtMs: Date.parse(verified.data.expiresAt) };
    try { sessionStorage.setItem(COIN_CHAT_SESSION_KEY, JSON.stringify({ address: session.address, token: coinChatSession.token, expiresAtMs: coinChatSession.expiresAtMs })); } catch {}
    updateTokenChatComposerState();
    return coinChatSession.token;
  })();
  coinChatSessionPromise = pending;
  try { return await pending; }
  finally { if (coinChatSessionPromise === pending) coinChatSessionPromise = null; }
}
async function tokenChatRequest(action, payload){
  if (!wallet) await connectWallet();
  const session = captureWalletSession();
  if (!session) throw new Error('Connect a Solana wallet to post.');
  const mint = getCoinMintAddress();
  if (!mint) throw new Error('Token address is unavailable.');
  const identityField = action === 'report' ? { reporter: session.address } : { author: session.address };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await ensureTokenChatSession(session);
    assertWalletSessionCurrent(session);
    try {
      return await apiRequest(`/api/tokens/${encodeURIComponent(mint)}/chat${action === 'post' ? '' : `/${action}`}`, { method: 'POST', headers: { 'x-token-chat-session': token }, body: { ...payload, ...identityField } });
    } catch (error) {
      if (attempt || !String(error.message).includes('Chat verification expired')) throw error;
      coinChatSession = null;
      try { sessionStorage.removeItem(COIN_CHAT_SESSION_KEY); } catch {}
      updateTokenChatComposerState();
    }
  }
}
async function refreshCoinChat(){
  const mint = getCoinMintAddress();
  if (mint) await loadCoinChat(mint, coinLoadId);
}
document.querySelector('#coin-page')?.addEventListener('submit', async event => {
  const form = event.target.closest('#coin-chat-form, #coin-community-form');
  if (!form) return;
  event.preventDefault();
  const input = form.querySelector('#coin-chat-input, #coin-community-input');
  const text = input?.value.trim();
  const mint = getCoinMintAddress();
  if (!text || !mint) return;
  const button = form.querySelector('button');
  if (button) button.disabled = true;
  try {
    const response = await tokenChatRequest('post', { text: normalizeTokenChatText(text) });
    if (response.available && response.data?.message) coinChatMessages = [...coinChatMessages, response.data.message].slice(-50);
    input.value = '';
    renderCoinChat(document.querySelector('#coin-activity-list'));
    renderCoinCommunityPanel();
    showToast('Wallet-verified message posted');
  } catch (error) { showToast(error.message || 'Chat message could not be sent'); }
  finally { if (button) button.disabled = false; }
});
document.querySelector('#coin-trade-refine')?.addEventListener('input', event => {
  if (event.target.matches('#coin-trade-wallet, #coin-trade-min-sol')) renderCoinActivityTab();
});
document.querySelector('.coin-tabs')?.addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = [...document.querySelectorAll('[data-coin-tab]')];
  const current = tabs.indexOf(document.activeElement);
  if (current < 0) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next].focus(); tabs[next].click();
});

const programPreviewData = {
  standard: { name: 'Standard launch', subtitle: 'A calm, accountable first step', progress: '1 of 3 complete', width: '33%', note: 'Connect a wallet to begin your launch review.' },
  boost: { name: 'Boost launch', subtitle: 'More visibility with a public signal', progress: '2 of 3 complete', width: '66%', note: 'Your route is ready; review the burn receipt before signing.' },
  pro: { name: 'Pro launch', subtitle: 'For teams ready to move with intent', progress: '2 of 3 complete', width: '78%', note: 'Priority review is available after the published route is confirmed.' },
  airdrop: { name: 'Airdrop reserve', subtitle: 'See who is eligible before you claim', progress: '2 of 3 complete', width: '66%', note: 'Review the allocation policy and claim status before connecting.' },
  explore: { name: 'Explore the index', subtitle: 'Find launches with a visible signal', progress: '1 of 3 complete', width: '33%', note: 'Open the explorer to inspect route, tier, and receipt history.' },
  receipts: { name: 'Receipt center', subtitle: 'Follow value after the launch', progress: '3 of 3 complete', width: '100%', note: 'Every verified event stays linked to its on-chain source.' },
};
function programNote(data, tier){
  return tier === 'standard' && canSignTransactions(wallet) ? 'Wallet connected. Review the fee route and launch cost before signing.' : data.note;
}
const programViews = {
  creator: {
    copy: 'Pick a route, understand the rules, then move into the workspace with the same information in view.',
    cta: 'Open creator launch',
    href: '#launch',
    cards: [
      ['standard', 'STANDARD', 'Start here', 'Launch without the guesswork', 'Core Pump launch, public fee route, and a verifiable receipt preview.', '0 $FUNDED', '1 route to review'],
      ['boost', 'BOOST', 'More visibility', 'Put your launch in front of the right eyes', 'Verified badge, Boost directory filter, and a public burn receipt.', '25,000 $FUNDED', 'Featured eligibility'],
      ['pro', 'PRO', 'For serious launches', 'Give the launch a stronger signal', 'All Boost benefits, Pro badge, and featured-review eligibility.', '100,000 $FUNDED', 'Priority review'],
    ],
  },
  community: {
    copy: 'Follow the parts of a launch that matter after the mint: allocations, discovery signals, and verified receipts.',
    cta: 'Open community hub',
    href: '#airdrops',
    cards: [
      ['airdrop', 'AIRDROP', 'Claim with context', 'See your community allocation', 'Check eligibility, reserve size, and claim status before signing anything.', '3% MINIMUM', 'Wallet eligibility'],
      ['explore', 'INDEX', 'Discover with signal', 'Find launches worth a closer look', 'Inspect verified routes, launch tiers, and visible commitment signals.', 'LIVE FEED', 'Route + tier'],
      ['receipts', 'RECEIPTS', 'Track what happened', 'Follow every value movement', 'Review the public record from launch through claims, burns, and payouts.', 'ON-CHAIN', 'Source linked'],
    ],
  },
};
function renderProgramView(view = 'creator') {
  const config = programViews[view] || programViews.creator;
  const list = document.querySelector('#program-option-list');
  const copy = document.querySelector('#program-market-copy');
  const cta = document.querySelector('#program-preview-cta');
  if (!list) return;
  list.innerHTML = config.cards.map(([key, label, hint, title, description, stat, meta], index) => `<button type="button" class="program-option${index === 0 ? ' active' : ''}" data-program-tier="${key}" aria-pressed="${index === 0 ? 'true' : 'false'}"><span class="program-option-top"><b>${label}</b><span>${hint}</span></span><strong>${title}</strong><small>${description}</small><span class="program-option-meta"><i>${stat}</i><i>${meta}</i><em>→</em></span></button>`).join('');
  if (copy) copy.textContent = config.copy;
  if (cta) { cta.textContent = `${config.cta} ↗`; cta.href = config.href; }
  const first = config.cards[0]?.[0];
  const data = programPreviewData[first] || programPreviewData.standard;
  const name = document.querySelector('#program-preview-name');
  const subtitle = document.querySelector('#program-preview-subtitle');
  const progress = document.querySelector('#program-progress-label');
  const bar = document.querySelector('#program-progress-bar');
  const note = document.querySelector('#program-progress-note');
  if (name) name.textContent = data.name;
  if (subtitle) subtitle.textContent = data.subtitle;
  if (progress) progress.textContent = data.progress;
  if (bar) bar.style.width = data.width;
  if (note) note.textContent = programNote(data, first);
}
document.querySelector('.program-market-panel')?.addEventListener('click', event => {
  const tierButton = event.target.closest('[data-program-tier]');
  if (tierButton) {
    const tier = tierButton.dataset.programTier;
    const data = programPreviewData[tier] || programPreviewData.standard;
    document.querySelectorAll('[data-program-tier]').forEach(item => { item.classList.toggle('active', item === tierButton); item.setAttribute('aria-pressed', String(item === tierButton)); });
    const name = document.querySelector('#program-preview-name');
    const subtitle = document.querySelector('#program-preview-subtitle');
    const progress = document.querySelector('#program-progress-label');
    const bar = document.querySelector('#program-progress-bar');
    const note = document.querySelector('#program-progress-note');
    if (name) name.textContent = data.name;
    if (subtitle) subtitle.textContent = data.subtitle;
    if (progress) progress.textContent = data.progress;
    if (bar) bar.style.width = data.width;
    if (note) note.textContent = programNote(data, tier);
  }
  const viewButton = event.target.closest('[data-program-view]');
  if (viewButton) {
    document.querySelectorAll('[data-program-view]').forEach(item => { const active = item === viewButton; item.classList.toggle('active', active); item.setAttribute('aria-selected', String(active)); });
    renderProgramView(viewButton.dataset.programView);
  }
});

function renderXClaimSummary(claims){
  const summary=summarizeXClaims(claims);
  window.dispatchEvent(new Event('funded:reward-identity-change'));
  const labels={total:n=>`${n} collected reward${n===1?'':'s'}`,claimed:n=>`${n} verified payment${n===1?'':'s'}`,unclaimed:n=>`${n} available reward${n===1?'':'s'}`,pending:n=>`${n} claim${n===1?'':'s'} in progress`};
  for(const key of Object.keys(labels)){
    const value=document.querySelector(`#x-claim-${key}-value`);
    const count=document.querySelector(`#x-claim-${key}-count`);
    if(value)value.textContent=summary?formatXClaimSol(summary[key]):'—';
    if(count)count.textContent=summary?labels[key](summary[key].count):'Sign in to view';
  }
  const note=document.querySelector('#x-claim-dashboard-note');
  if(note)note.textContent=summary&&Object.values(summary).some(bucket=>!bucket.complete)?'One or more reward amounts are unavailable, so affected totals are hidden. Claimed amounts still require a verified Devnet payment receipt.':'Totals use collected creator-fee rewards linked to your signed-in X account. Claimed amounts require a verified Devnet payment receipt.';
}
async function loadXIdentity() {
  const button = document.querySelector('#x-sign-in');
  const status = document.querySelector('#x-identity-status');
  if (!button || !status) return;
  try {
    const result = await apiRequest('/api/x/me');
    if (!result.available) { status.textContent = 'X sign-in is temporarily unavailable. Please try again later.'; button.disabled = true; button.dataset.connected = 'false'; renderXClaimSummary(null);syncXClaimFlow(); return; }
    if (result.data?.authenticated) {
      button.disabled = false;
      const user = result.data.user;
      status.textContent = `Connected as @${user.username}`;
      button.textContent = 'Sign out of X';
      button.dataset.connected = 'true';
      const handle = document.querySelector('#sol-claim-x-account');
      if (handle) handle.value = `@${user.username}`;
      await refreshXClaims();
      resetSolClaimStatus();
    } else {
      const configured = result.data?.configured === true;
      status.textContent = configured ? 'Sign in to see rewards linked to your X account.' : 'X sign-in is temporarily unavailable.';
      button.textContent = 'Sign in with X';
      button.dataset.connected = 'false';
      button.disabled = !configured;
      const claimId=document.querySelector('#sol-claim-id');if(claimId)claimId.value='';
      const check=document.querySelector('#claim-binding-agree');if(check)check.checked=false;
      document.querySelector('#sol-claim-list')?.replaceChildren();
      const list=document.querySelector('#sol-claim-list');if(list)list.textContent='Sign in with X to see your rewards.';
      renderXClaimSummary(null);
      resetSolClaimStatus();
    }
  } catch (error) { status.textContent = error.message || 'X identity status is unavailable.'; renderXClaimSummary(null);syncXClaimFlow(); }
}
async function refreshXClaims(){
  const list = document.querySelector('#sol-claim-list');
  if (!list) return;
  list.replaceChildren();
  const clearSelection=()=>{const id=document.querySelector('#sol-claim-id');if(id)id.value='';const check=document.querySelector('#claim-binding-agree');if(check)check.checked=false;};
  try {
    const result = await apiRequest('/api/x-fee/claims');
    if (!result.available) { clearSelection();list.textContent='Rewards are temporarily unavailable. Try again later.';renderXClaimSummary(null); syncXClaimFlow(); return; }
    renderXClaimSummary(result.data.claims);
    if (!result.data.claims.length) { clearSelection();list.textContent = 'No collected creator fees are ready for this X account yet. Check back later.'; syncXClaimFlow(); return; }
    const selectedId=String(document.querySelector('#sol-claim-id')?.value||'').trim();
    if(selectedId&&!result.data.claims.some(claim=>claim.id===selectedId&&claim.canPrepare===true)){
      clearSelection();
    }
    for (const claim of result.data.claims) {
      const row=document.createElement('div');row.className='x-claim-reward';row.dataset.claimId=claim.id;
      if(claim.id===selectedId&&claim.canPrepare===true)row.classList.add('selected');
      const state=document.createElement('span');state.className=`x-claim-reward-state ${claim.receiptVerified?'paid':claim.canPrepare?'ready':'pending'}`;state.textContent=claim.receiptVerified?'Paid':claim.canPrepare?'Ready to claim':'Not ready yet';
      const copy=document.createElement('div');copy.className='x-claim-reward-copy';
      const amount=document.createElement('strong');amount.textContent=claim.amountSol==null?'Amount unavailable':`${claim.amountSol} SOL`;
      const context=document.createElement('small');context.textContent=`Token ${String(claim.mint||'').slice(0,6)}… · ${claim.receiptVerified?'Payment confirmed':claim.canPrepare?'Collected creator fees':claim.explanation||'Waiting for collected fees'}`;
      copy.append(amount,context);row.append(state,copy);
      row.dataset.claimSummary=`${amount.textContent} from token ${String(claim.mint||'').slice(0,6)}…`;
      if (claim.canPrepare === true) {
        const choose = document.createElement('button');
        choose.type = 'button'; choose.className = 'secondary-button'; choose.textContent = 'Choose reward';
        choose.addEventListener('click', () => { document.querySelector('#sol-claim-id').value=claim.id;document.querySelector('#sol-claim-x-account').value=result.data.handle;document.querySelectorAll('#sol-claim-list .x-claim-reward').forEach(item=>item.classList.toggle('selected',item===row));const check=document.querySelector('#claim-binding-agree');if(check)check.checked=false;updateClaimBindingReview();resetSolClaimStatus(); });
        row.append(choose);
      }
      if(claim.receiptVerified&&claim.payoutSignature){const receipt=document.createElement('a');receipt.href=`https://explorer.solana.com/tx/${encodeURIComponent(claim.payoutSignature)}?cluster=devnet`;receipt.textContent='Verify payment';receipt.target='_blank';receipt.rel='noopener noreferrer';row.append(receipt);}
      list.append(row);
    }
    syncXClaimFlow();
  } catch (error) { clearSelection();list.textContent = error.message || 'Rewards are temporarily unavailable.';renderXClaimSummary(null); syncXClaimFlow(); }
}
document.querySelector('#x-sign-in')?.addEventListener('click', async event => {
  const button = event.currentTarget;
  if (button.dataset.connected === 'true') { await apiRequest('/api/x/logout', { method: 'POST' }).catch(() => {}); await loadXIdentity(); return; }
  const apiBase = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '') || window.location.origin;
  window.location.assign(`${apiBase}/api/x/oauth/start`);
});
void loadXIdentity();
updateClaimBindingReview();
