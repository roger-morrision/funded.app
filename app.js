import { Buffer } from 'buffer';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { APP_REFERRAL_LEVELS, buildFeeDistributionPolicy, FEE_DISTRIBUTION, validateFeeDistribution } from './distribution-policy.js';
import { buildCommunityAirdropPolicy, buildLaunchReservePlan } from './airdrop-policy.js';
import { buildBuybackAccrual, buildBuybackPolicy, buildBuybackReceipt, evaluateBuybackBatch, summarizeBuybackLedger } from './buyback-policy.js';
import { buildFeeRouterPolicy, deriveMintFeeRouter, verifyFeeRouterAccount } from './fee-router.js';
import { buildMintRouterInitializeInstruction, buildPumpLaunchPlan } from './mint-router-launch.js';
import { buildLaunchBurnPolicy, createLaunchBurnTiers, validateLaunchBurnPolicy } from './launch-burn-policy.js';
import { bindReferralAttribution, captureFirstTouch, createReferralCode, normalizeReferralCode } from './referral-program.js';
  import { buildSolClaimPolicy, normalizeXHandle } from './sol-claim-policy.js';
import { buildTradeTransaction, describeTradeQuote, fetchBondingCurveSnapshot, submitTrade } from './pump-trading.js';
import { PUMP_PROGRAM_ID, PUMP_SDK, bondingCurvePda } from '@pump-fun/pump-sdk';
import { PUMP_AMM_PROGRAM_ID, PUMP_AMM_SDK, canonicalPumpPoolPda } from '@pump-fun/pump-swap-sdk';
import { APP_CLUSTER, APP_EXPLORER_QUERY, APP_RPC_URL, DEV_MODE, DEV_WALLET_AUTOCONNECT, DEV_WALLET_ROLE, EXPLORE_CLUSTER, EXPLORE_RPC_URL, TRADE_FEE_BPS, TRADE_FEE_OWNER } from './app-config.js';
import { apiRequest, persistLaunchPolicy } from './client.js';
import { launchPolicyStatement } from './launch-policy-auth.js';
import { verifiedPromotionBadge } from './promotion-badge.js';
import { metadataStatement, devnetMetadataUri } from './devnet-metadata.js';
import { collectRecentTrades, enrichMarketRecord, filterMarketRecords, formatSignal, summarizeMarkets, withMarketWindow } from './market-intelligence.js';
import { formatSolMetric, readCurveMetrics } from './explore-onchain-metrics.js';
import { buildTradePricePath, selectRecentTrades, summarizeTokenAccounts } from './coin-detail-model.js';
import { canSignTransactions, connectWalletProvider, selectRememberedWalletProvider, walletAddress, walletLaunches } from './wallet-core.js';

globalThis.Buffer ??= Buffer;
let solanaModules;
let connection;
let exploreConnection;
let tradePreviewConnection;
async function getSolana(){
  if (!solanaModules) {
    const [web3, spl] = await Promise.all([import('@solana/web3.js'), import('@solana/spl-token')]);
    connection = new web3.Connection(APP_RPC_URL || web3.clusterApiUrl(APP_CLUSTER), {
      commitment: 'confirmed',
      disableRetryOnRateLimit: true,
    });
    solanaModules = { ...web3, ...spl };
  }
  return solanaModules;
}
async function getExploreConnection(){
  const { Connection } = await getSolana();
  if (!exploreConnection) exploreConnection = new Connection(EXPLORE_RPC_URL || (solanaModules.clusterApiUrl ? solanaModules.clusterApiUrl(EXPLORE_CLUSTER) : `https://api.${EXPLORE_CLUSTER}.solana.com`), { commitment: 'confirmed', disableRetryOnRateLimit: true });
  return exploreConnection;
}
async function getTradePreviewConnection(){
  const { Connection, clusterApiUrl } = await getSolana();
  if (!tradePreviewConnection) tradePreviewConnection = new Connection(APP_RPC_URL ? `${APP_RPC_URL}?purpose=trade-preview` : clusterApiUrl(APP_CLUSTER), {
    commitment: 'confirmed',
    disableRetryOnRateLimit: true,
  });
  return tradePreviewConnection;
}
const explorer = (path) => `https://explorer.solana.com/${path}${APP_EXPLORER_QUERY}`;
const exploreExplorer = (path) => `https://explorer.solana.com/${path}${EXPLORE_CLUSTER === 'mainnet-beta' ? '' : `?cluster=${EXPLORE_CLUSTER}`}`;
let wallet = null;
let connectedWalletAddress = null;
let walletVersion = 0;
let walletConnectRequest = 0;
const observedWalletProviders = new WeakSet();
const disconnectingWalletProviders = new WeakSet();
const WALLET_MANUAL_DISCONNECT_KEY = 'funded.app.wallet.manual-disconnect';
const WALLET_PROVIDER_KEY = 'funded.app.wallet.provider';
let walletDisconnectRequested = false;
let mobileWalletSession = null;
let metricsRequest = 0;
let launchCostRefreshTimer = null;
let walletBalanceLamports = null;
let estimatedLaunchFeeLamports = null;
let estimatedInitialBuyLamports = 0;
let walletMetricsLoading = false;
let walletEstimateError = '';
let tradePreview = null;
let launchStep = 1;
let launchMode = 'quick';
let launchProfile = 'community';
let launchBurnTier = 'standard';
let launchBurnReadiness = { ready: true, message: 'No creator-funded burn is required.' };
const WATCHLIST_KEY = 'funded.app.community.watchlist';
const APP_REFERRAL_KEY = 'funded.app.referral.attribution';
const REFERRAL_ANALYTICS_KEY = 'funded.app.referral.analytics';
const REFERRAL_SERVER_KEY_PREFIX = 'funded.app.referral.server.';
const AIRDROP_PREVIEW_CLAIM_KEY = 'funded.app.airdrop.preview-claims';
const BUYBACK_PREVIEW_KEY = 'funded.app.buyback.preview-ledger';
const LAUNCH_DRAFT_KEY = 'funded.app.launch.draft';
const FEE_ROUTER_PROGRAM_ID = String(import.meta.env.VITE_FUNDED_FEE_ROUTER_PROGRAM_ID || '').trim();
const PROTOCOL_FUNDED_MINT = String(import.meta.env.VITE_FUNDED_TOKEN_MINT || '').trim();
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
function getCreatorBuyPercent(){
  const value = Number(document.querySelector('#creator-buy-percent')?.value || 0);
  return Number.isFinite(value) ? value : 0;
}
function getCreatorBuySummary(){
  const percent = getCreatorBuyPercent();
  const tokens = percent > 0 ? 1_000_000_000 * percent / 100 : 0;
  return { percent, tokens };
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
async function syncServerReferralState(){
  const session = captureWalletSession();
  const walletAddress = session?.address;
  if (!session || typeof session.provider.signMessage !== 'function') return;
  try {
    const registrationKey = `${REFERRAL_SERVER_KEY_PREFIX}${walletAddress}`;
    let registered = null;
    try { registered = JSON.parse(localStorage.getItem(registrationKey) || 'null'); } catch {}
    if (!registered?.code) {
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
  } catch (error) { trackReferralEvent('server_referral_sync_failed', { reason: error.message }); }
}
async function refreshReferralClaims(){
  const session = captureWalletSession();
  const walletAddress = session?.address; const dashboard = document.querySelector('.referral-dashboard');
  if (!session || !dashboard) return;
  const [result, dashboardResult] = await Promise.all([
    apiRequest(`/api/referral-claims?wallet=${encodeURIComponent(walletAddress)}`).catch(() => ({ available: false })),
    apiRequest(`/api/referrals/dashboard?wallet=${encodeURIComponent(walletAddress)}`).catch(() => ({ available: false })),
  ]);
  if (!isWalletSessionCurrent(session)) return;
  if (!result.available) return;
  if (dashboardResult.available) { const active = document.querySelector('#referral-active-creators'); if (active) active.textContent = String(dashboardResult.data.networkCreators ?? '—'); const conversion = document.querySelector('#referral-conversion-rate'); if (conversion) conversion.textContent = dashboardResult.data.conversionRate == null ? '—' : `${dashboardResult.data.conversionRate}%`; }
  const claims = Array.isArray(result.data.claims) ? result.data.claims : [];
  const claimable = claims.filter(claim => ['awaiting-wallet-signature', 'wallet-verified'].includes(claim.status)).reduce((sum, claim) => sum + Number(claim.amount || 0), 0);
  const paid = claims.filter(claim => claim.status === 'paid').reduce((sum, claim) => sum + Number(claim.amount || 0), 0);
  const claimableNode = document.querySelector('#referral-total-claimable'); if (claimableNode) claimableNode.textContent = `${claimable.toFixed(4)} SOL`;
  const paidNode = document.querySelector('#referral-paid-total'); if (paidNode) paidNode.textContent = `${paid.toFixed(4)} SOL`;
  const ledger = document.querySelector('#referral-ledger-list');
  if (ledger) { ledger.replaceChildren(); if (!claims.length) { const empty = document.createElement('div'); empty.className = 'empty-state'; empty.textContent = 'No referral claim receipts yet.'; ledger.append(empty); } else claims.slice().reverse().forEach(claim => { const row = document.createElement('div'); row.className = 'referral-ledger-row'; const label = document.createElement('strong'); label.textContent = `Level ${claim.level}`; const status = document.createElement('small'); status.textContent = claim.status; const amount = document.createElement('b'); amount.textContent = `${Number(claim.amount || 0).toFixed(4)} ${claim.asset}`; row.append(label, status, amount); ledger.append(row); }); }
  let panel = document.querySelector('#referral-claim-center');
  if (!panel) { panel = document.createElement('div'); panel.id = 'referral-claim-center'; panel.className = 'referral-dashboard'; dashboard.after(panel); }
  panel.replaceChildren();
  const heading = document.createElement('div'); const title = document.createElement('strong'); title.textContent = 'Referral claim center'; const note = document.createElement('small'); note.textContent = result.data.claims.length ? 'Rewards require your wallet signature and a separate payout action.' : 'No claimable referral rewards yet.'; heading.append(title, note); panel.append(heading);
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
  const status = document.querySelector('#referral-link-status'); if (status) status.textContent = code ? 'Ready to share' : 'Connect wallet';
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
    feeRouterState = { status: 'invalid-router-configuration', verified: false, address: null, programId: FEE_ROUTER_PROGRAM_ID, bump: null };
    if (status) { status.textContent = `Launch blocked: ${error.message}`; status.className = 'field-help funded-mint-invalid'; }
    if (addressNode) addressNode.textContent = 'Invalid configuration';
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
  return `${amount.toLocaleString(undefined, { minimumFractionDigits: amount > 0 && amount < 1 ? 3 : 0, maximumFractionDigits: 4 })} SOL`;
}
function renderFeeFlowCalculator(){
  const input = document.querySelector('#fee-flow-input');
  if (!input) return;
  const gross = Math.max(0, Number(input.value) || 0);
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
  const note = document.querySelector('#fee-flow-note');
  if (note) note.textContent = `A ${formatFlowAmount(gross)} claim allocates exactly ${formatFlowAmount(allocated)} under the published policy.`;
}
function getPreviewClaims(){ try { return JSON.parse(localStorage.getItem(AIRDROP_PREVIEW_CLAIM_KEY) || '{}'); } catch { return {}; } }
function getLocalLaunchPolicies(){
  const launches = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith('funded.launch.')) continue;
    try {
      const launch = JSON.parse(localStorage.getItem(key));
      if (launch?.communityAirdrop) launches.push(launch);
    } catch {}
  }
  return launches.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}
let verifiedLaunchPolicies = [];
async function loadVerifiedLaunchPolicies(){
  const response = await apiRequest('/api/launches').catch(() => ({ available: false }));
  if (!response.available || !Array.isArray(response.data)) return;
  verifiedLaunchPolicies = response.data.filter(launch => launch.onchainVerified && launch.cluster === EXPLORE_CLUSTER);
  renderCreatorLaunches();
  renderExploreAssets();
  renderRegistry();
  renderHomeLaunchBoard();
  renderCoinPromotionBadge();
}
function promotionForMint(mint){
  return verifiedPromotionBadge(verifiedLaunchPolicies.find(launch => launch.mint === mint));
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
  const combined = new Map(getLocalLaunchPolicies().map(launch => [launch.mint, launch]));
  for (const launch of verifiedLaunchPolicies) combined.set(launch.mint, launch);
  return walletLaunches([...combined.values()], connectedWalletAddress);
}
function renderCreatorLaunches(){
  const list = document.querySelector('#creator-launch-empty');
  if (!list) return;
  const sourceLabel = document.querySelector('#my-launches .section-state');
  if (sourceLabel) sourceLabel.textContent = 'local + verified registry';
  const sourceBadge = document.querySelector('#my-launches .data-badge');
  if (sourceBadge) sourceBadge.textContent = 'Mixed sources';
  const launches = getWalletLaunchPolicies();
  const count = document.querySelector('#my-launches .role-stats b');
  if (count) count.textContent = String(launches.length);
  list.replaceChildren();
  list.classList.toggle('empty-state', !launches.length);
  list.classList.toggle('compact-empty', !launches.length);
  list.classList.toggle('creator-launch-list', launches.length > 0);
  if (!launches.length) {
    list.textContent = connectedWalletAddress
      ? 'No local or verified registry launch records for this wallet yet.'
      : 'Connect a wallet to see launch records associated with it.';
    return;
  }
  for (const launch of launches) {
    const link = document.createElement('a');
    link.className = 'creator-launch-link';
    link.href = `/token/${encodeURIComponent(launch.mint)}`;
    const title = document.createElement('strong');
    title.textContent = `${launch.name || 'Devnet coin'} (${launch.symbol || 'TOKEN'})`;
    const address = document.createElement('small');
    address.textContent = `${launch.mint.slice(0, 4)}…${launch.mint.slice(-4)}`;
    const source = document.createElement('small');
    source.className = 'creator-launch-source';
    source.textContent = launch.onchainVerified && launch.cluster === EXPLORE_CLUSTER ? 'Verified registry · Devnet' : 'Local launch record · verify on Explorer';
    link.append(title, address, source);
    const promotion = promotionElement(launch.mint);
    if (promotion) link.append(promotion);
    list.append(link);
    const pending = getLocalLaunchPolicies().find(item => item.mint === launch.mint);
    if (!launch.onchainVerified && pending?.policySignature) {
      const retry = document.createElement('button');
      retry.type = 'button'; retry.className = 'secondary-button'; retry.textContent = 'Retry policy registration';
      retry.addEventListener('click', async () => {
        retry.disabled = true;
        try {
          const policy = JSON.parse(localStorage.getItem(`funded.launch.${launch.mint}`) || 'null');
          if (!policy?.policySignature || policy.creatorWallet !== connectedWalletAddress) throw new Error('Reconnect the launch wallet to retry this signed policy.');
          await apiRequest('/api/launches', { method: 'POST', body: policy });
          await loadVerifiedLaunchPolicies();
          showToast('Launch policy registered and verified');
        } catch (error) { showToast(`Registration remains pending: ${error.message}`); retry.disabled = false; }
      });
      list.append(retry);
    }
  }
}
function formatTokenAmount(value){ return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }); }
const demoAirdropPrograms = Object.freeze([]);
const demoClaimers = Object.freeze([]);
const demoUnclaimedWallets = Object.freeze([]);
const demoAirdropNotifications = Object.freeze([]);
const demoAirdropHistory = Object.freeze([]);
function getAirdropPrograms(){
  const localPrograms = getLocalLaunchPolicies().map(launch => ({
    id: launch.mint,
    name: launch.name || 'Devnet launch',
    symbol: launch.symbol || 'TOKEN',
    allocationPercent: launch.communityAirdrop.allocationPercent,
    reservedTokens: launch.communityAirdrop.reservedTokens,
    claimedTokens: 0,
    eligibleWallets: 0,
    claimedWallets: 0,
    status: 'upcoming',
    deadline: 'After migration · 90 days',
    snapshot: 'Migration · pending',
    walletAllocation: null,
  }));
  return [];
}
function airdropClaimRate(program){ return program.reservedTokens ? program.claimedTokens / program.reservedTokens : 0; }
function renderAirdropSummary(programs){
  const node = document.querySelector('#airdrop-summary-kpis');
  if (!node) return;
  const reserved = programs.reduce((sum, item) => sum + item.reservedTokens, 0);
  const claimed = programs.reduce((sum, item) => sum + item.claimedTokens, 0);
  const eligible = programs.reduce((sum, item) => sum + item.eligibleWallets, 0);
  node.innerHTML = `<article><span>Published programs</span><strong>${programs.length}</strong><small>Across upcoming and live distributions</small></article><article><span>Total reserved</span><strong>${formatTokenAmount(reserved)}</strong><small>Tokens committed to community wallets</small></article><article><span>Claimed so far</span><strong>${formatTokenAmount(claimed)}</strong><small>${reserved ? `${(claimed / reserved * 100).toFixed(1)}% of indexed reserve` : 'Waiting for indexer'}</small></article><article><span>Eligible wallets</span><strong>${formatTokenAmount(eligible)}</strong><small>Published snapshot participants</small></article>`;
}
function renderAirdropDirectory(programs = getAirdropPrograms()){
  const list = document.querySelector('#airdrop-directory');
  if (!list) return;
  const query = document.querySelector('#airdrop-search')?.value.trim().toLowerCase() || '';
  const sort = document.querySelector('#airdrop-sort')?.value || 'largest';
  const filtered = programs.filter(item => !query || `${item.name} ${item.symbol}`.toLowerCase().includes(query)).sort((a, b) => {
    if (sort === 'claim-rate') return airdropClaimRate(b) - airdropClaimRate(a);
    if (sort === 'unclaimed') return (b.reservedTokens - b.claimedTokens) - (a.reservedTokens - a.claimedTokens);
    if (sort === 'ending') return String(a.deadline).localeCompare(String(b.deadline));
    return b.reservedTokens - a.reservedTokens;
  });
  list.innerHTML = filtered.map(program => {
    const rate = airdropClaimRate(program);
    const unclaimed = program.reservedTokens - program.claimedTokens;
    return `<article class="airdrop-directory-card"><div class="directory-card-top"><span class="claim-token-mark">${escapeHtml(program.symbol.slice(0, 1))}</span><div><strong>${escapeHtml(program.name)}</strong><small>${escapeHtml(program.symbol)} · ${escapeHtml(program.snapshot)}</small></div><span class="airdrop-status ${program.status}">${program.status === 'claimable' ? 'Claimable now' : program.status === 'claimed' ? 'Closed' : 'Upcoming'}</span></div><div class="directory-stats"><span><small>Reserved</small><b>${formatTokenAmount(program.reservedTokens)}</b></span><span><small>Claimed</small><b>${formatTokenAmount(program.claimedTokens)}</b></span><span><small>Unclaimed</small><b>${formatTokenAmount(unclaimed)}</b></span><span><small>Wallets</small><b>${formatTokenAmount(program.eligibleWallets)}</b></span></div><div class="directory-progress"><i style="width:${Math.min(100, rate * 100)}%"></i></div><div class="directory-footer"><span>${(rate * 100).toFixed(1)}% claimed · ${escapeHtml(program.deadline)}</span><button type="button" class="secondary-button directory-claim" data-directory-symbol="${escapeHtml(program.symbol)}">${program.status === 'claimable' ? 'Check my wallet' : 'View details'}</button></div></article>`;
  }).join('') || '<div class="empty-state">No airdrops match your search.</div>';
}
function renderAirdropAnalytics(){
  const claimers = document.querySelector('#airdrop-top-claimers');
  const programs = document.querySelector('#airdrop-top-programs');
  const wallets = document.querySelector('#unclaimed-wallets');
  const leaderboardSort = document.querySelector('#leaderboard-sort')?.value || 'amount';
  const privateMode = document.querySelector('#leaderboard-private')?.checked ?? true;
  const sortedClaimers = [...demoClaimers].sort((a, b) => leaderboardSort === 'rate' ? (b.amount / 1_000_000) - (a.amount / 1_000_000) : b.amount - a.amount);
  if (claimers) claimers.innerHTML = sortedClaimers.map((item, index) => `<div class="leader-row"><b>${index + 1}</b><span><strong>${privateMode ? item.wallet : item.wallet.replace('…', '…')}</strong><small>${item.symbol} claimed${leaderboardSort === 'rate' ? ' · 85.0% of allocation' : ''}</small></span><em>${formatTokenAmount(item.amount)}</em></div>`).join('');
  if (programs) programs.innerHTML = getAirdropPrograms().sort((a, b) => b.reservedTokens - a.reservedTokens).slice(0, 5).map((item, index) => `<div class="leader-row"><b>${index + 1}</b><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.symbol)} · ${(airdropClaimRate(item) * 100).toFixed(1)}% claimed</small></span><em>${formatTokenAmount(item.reservedTokens)}</em></div>`).join('');
  if (wallets) wallets.innerHTML = demoUnclaimedWallets.map(item => `<tr><td><strong>${item.wallet}</strong></td><td>${item.program}</td><td>${formatTokenAmount(item.eligible)}</td><td>${formatTokenAmount(item.claimed)}</td><td>${formatTokenAmount(item.eligible - item.claimed)}</td><td><span class="wallet-claim-status">${item.status}</span></td></tr>`).join('');
  const count = document.querySelector('#unclaimed-wallet-count');
  if (count) count.textContent = `${demoUnclaimedWallets.length} wallets`;
  const notificationNode = document.querySelector('#airdrop-notifications');
  if (notificationNode) notificationNode.innerHTML = demoAirdropNotifications.map(item => `<div class="notification-row ${item.tone}"><b>${item.icon}</b><span><strong>${item.title}</strong><small>${item.detail}</small></span></div>`).join('');
  const historyNode = document.querySelector('#airdrop-history');
  if (historyNode) historyNode.innerHTML = `<p class="history-label">Recent activity</p>${demoAirdropHistory.map(item => `<div class="history-row"><span><strong>${item.token} · ${item.event}</strong><small>${item.date} · ${item.status}</small></span><em>${item.amount}</em></div>`).join('')}`;
}
function exportAirdropCsv(){
  const rows = [['wallet', 'program', 'eligible', 'claimed', 'unclaimed', 'status'], ...demoUnclaimedWallets.map(item => [item.wallet, item.program, item.eligible, item.claimed, item.eligible - item.claimed, item.status])];
  const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = 'funded-airdrop-unclaimed-wallets.csv'; link.click(); URL.revokeObjectURL(url);
  showToast('Unclaimed wallet CSV exported');
}
function renderAirdropClaims(filter = activeAirdropFilter){
  activeAirdropFilter = filter;
  const list = document.querySelector('#airdrop-claim-list');
  if (!list) return;
  const previewClaimed = Boolean(getPreviewClaims()[previewAirdrop.id]);
  const programs = getAirdropPrograms();
  const claims = [
    ...programs.map(program => ({ ...program, state: program.id === previewAirdrop.id && previewClaimed ? 'claimed' : program.status, badge: program.id === previewAirdrop.id ? 'Demo allocation' : 'Indexed preview' })),
  ];
  const filtered = claims.filter(claim => filter === 'all' || claim.state === filter);
  list.innerHTML = filtered.map(claim => {
    const isPreview = claim.id === previewAirdrop.id;
    const action = claim.state === 'claimable' ? `<button type="button" class="secondary-button claim-action" data-preview-claim="${escapeHtml(claim.id)}" ${claim.state === 'claimed' ? 'disabled' : ''}>${claim.state === 'claimed' ? 'Already claimed' : isPreview ? 'Test claim flow' : 'Check eligibility'}</button>` : `<button type="button" class="secondary-button claim-action" disabled>${claim.state === 'claimed' ? 'Claim recorded' : 'Opens after snapshot'}</button>`;
    const amount = claim.walletAllocation == null ? `${formatTokenAmount(claim.reservedTokens)} reserved` : `${formatTokenAmount(claim.walletAllocation)} ${escapeHtml(claim.symbol)}`;
    const detail = isPreview
      ? 'Local interaction preview. No wallet signature or token transfer occurs.'
      : `${claim.allocationPercent}% supply reserve · $FUNDED-holder snapshot at migration`;
    return `<article class="claim-card" data-claim-state="${claim.state}"><div class="claim-token"><span>${escapeHtml(claim.symbol.slice(0, 1))}</span><div><strong>${escapeHtml(claim.name)}</strong><small>${escapeHtml(claim.symbol)} · ${escapeHtml(claim.badge)}</small></div></div><div class="claim-amount"><span>${claim.state === 'claimed' ? 'Preview result' : claim.walletAllocation == null ? 'Community reserve' : 'Example allocation'}</span><strong>${amount}</strong></div><p>${detail}</p>${action}</article>`;
  }).join('') || '<div class="empty-state">No claims match this filter.</div>';
  document.querySelectorAll('[data-airdrop-filter]').forEach(button => button.classList.toggle('active', button.dataset.airdropFilter === filter));
  const state = document.querySelector('#claim-wallet-state');
  if (state) state.textContent = connectedWalletAddress ? `Wallet ${connectedWalletAddress.slice(0, 4)}…${connectedWalletAddress.slice(-4)} connected. Eligibility appears only after a verified Devnet snapshot is indexed.` : 'Connect your wallet to check eligibility. No claim data is shown until confirmed Devnet receipts or an indexed proof is available.';
  const count = document.querySelector('#claim-program-count');
  if (count) count.textContent = `${programs.length} indexed ${programs.length === 1 ? 'program' : 'programs'}`;
  renderAirdropSummary(programs);
  renderAirdropDirectory(programs);
  renderAirdropAnalytics();
}

function getBuybackPreviewState(){
  return { accruals: [], receipts: [] };
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
function renderBuybackDashboard(message = ''){
  const state = getBuybackPreviewState();
  const summary = summarizeBuybackLedger(state.accruals, state.receipts);
  const pendingSol = summary.pendingByAsset.SOL || 0;
  document.querySelector('#buyback-pending').textContent = '—';
  document.querySelector('#buyback-burned').textContent = '—';
  document.querySelector('#buyback-claims').textContent = '—';
  document.querySelector('#buyback-execution-count').textContent = '0 verified executions';
  const executedIds = new Set(state.receipts.flatMap(receipt => receipt.accrualIds || []));
  const events = [
    ...state.accruals.map(accrual => ({ type: 'accrual', at: accrual.claimedAt, data: accrual })),
    ...state.receipts.map(receipt => ({ type: 'receipt', at: receipt.executedAt, data: receipt })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  document.querySelector('#buyback-ledger').innerHTML = events.map(event => {
    if (event.type === 'receipt') {
      const receipt = event.data;
      return `<div class="buyback-ledger-row burn"><span class="buyback-ledger-icon">♨</span><span><strong>${formatBuybackAmount(receipt.tokensBurned, 2)} $FUNDED burned</strong><small>${formatBuybackAmount(receipt.inputAmount)} ${escapeHtml(receipt.asset)} · ${escapeHtml(receipt.burnInstruction)} · local preview</small></span><b>Supply ↓</b></div>`;
    }
    const accrual = event.data;
    const executed = executedIds.has(accrual.id);
    return `<div class="buyback-ledger-row"><span class="buyback-ledger-icon">↗</span><span><strong>${formatBuybackAmount(accrual.buybackAmount)} ${escapeHtml(accrual.asset)} allocated</strong><small>${formatBuybackAmount(accrual.grossCreatorFees)} ${escapeHtml(accrual.asset)} gross fees · claim ${escapeHtml(accrual.claimSignature.slice(-8))}</small></span><b>${executed ? 'Burned' : 'Pending'}</b></div>`;
  }).join('') || '<div class="empty-state">No verified on-chain buyback receipts are indexed on Devnet yet.</div>';
  const runButton = document.querySelector('#buyback-run-preview');
  const addButton = document.querySelector('#buyback-add-claim');
  if (addButton) { addButton.disabled = true; addButton.title = 'Recording requires verified fee-claim receipts and a deployed buyback vault.'; }
  if (runButton) { runButton.disabled = true; runButton.title = 'Burn execution requires a verified route, funded vault, and on-chain receipt infrastructure.'; }
  renderBuybackExample();
  const status = document.querySelector('#buyback-preview-status');
  if (message) status.textContent = message;
  else if (pendingSol >= 0.25) status.textContent = `${formatBuybackAmount(pendingSol)} SOL is ready for a protected batch preview.`;
  else if (pendingSol > 0) status.textContent = `${formatBuybackAmount(pendingSol)} SOL is safely accumulating toward the 0.25 SOL threshold.`;
  else status.textContent = 'Local calculation only. Recording and protected burns are unavailable until verified claims, vault, route, and receipts are deployed.';
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
let exploreQuery = '';
let exploreSort = 'volume';
let exploreRisk = 'all';
let exploreStage = 'all';
let exploreAuthority = 'all';
let exploreWindow = '24h';
let exploreCompareMints = [];
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
let exploreProviderStatus = 'On-chain only · loading';
const exploreActivityCache = new Map();
let exploreScannedCount = 0;
const payments = [];

function getWatchlist(){ try { return JSON.parse(localStorage.getItem(WATCHLIST_KEY) || '[]'); } catch { return []; } }
function saveWatchlist(list){ localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list)); }
function renderWatchlist(){
  const saved = getWatchlist();
  const count = document.querySelector('#watch-count');
  const empty = document.querySelector('#watchlist-empty');
  const items = document.querySelector('#watchlist-items');
  if (count) count.textContent = `${saved.length} saved`;
  if (empty) empty.hidden = saved.length > 0;
  if (items) items.innerHTML = saved.map(mint => { const asset = assets.find(item => item.address === mint); return asset ? `<div class="watch-item"><span class="asset-icon">${asset.icon}</span><span><strong>${asset.name}</strong><small>${asset.symbol} · on-chain record</small></span><button type="button" data-remove-watch="${escapeHtml(asset.address)}" aria-label="Remove ${escapeHtml(asset.symbol)} from watchlist">×</button></div>` : ''; }).join('');
  document.querySelectorAll('.watch-button').forEach(button => { const active = saved.includes(button.dataset.mint); button.classList.toggle('active', active); button.textContent = active ? '★' : '☆'; button.setAttribute('aria-pressed', String(active)); });
}
function formatFeedAge(timestamp){
  const ms = Date.parse(String(timestamp || ''));
  return Number.isFinite(ms) ? formatOnchainAge(ms) : 'freshness unavailable';
}
function exploreFilterOptions(query = exploreQuery, sort = exploreSort){
  const laneStage = exploreNewLane === 'almost' ? 'near' : exploreNewLane === 'migrated' ? 'migrated' : 'launch';
  const maxAgeHours = exploreTab === 'new' && exploreNewLane === 'launch' ? Math.min(24, exploreMaxAgeHours ?? 24) : exploreMaxAgeHours;
  return { query, sort, risk: exploreRisk, stage: exploreTab === 'new' ? laneStage : exploreStage, authority: exploreAuthority, watchlist: getWatchlist(), maxAgeHours,
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
  if (exploreMinTraders != null) return ['No launch meets the trading-wallet minimum.', 'Lower the selected-window minimum or clear filters.'];
  if (exploreMinTrades != null || exploreMinVolumeSol != null) return ['No launch meets these trade-activity minimums.', 'Lower the selected-window minimums or clear filters.'];
  if (exploreMinCurveCapSol != null || exploreMaxAgeHours != null) return ['No launch meets these advanced filters.', 'Broaden the curve-cap or age limit, or clear filters.'];
  if (exploreAuthority !== 'all') return ['No verified mint matches this authority filter.', 'Choose Any authority or clear filters to see all verified launches.'];
  if (exploreRisk === 'watchlist') return ['No watched launches in this feed.', 'Use the star on a verified token to save it here.'];
  if (exploreTab === 'new' && exploreNewLane === 'almost') return ['No launch is Almost Born yet.', 'This view requires an active Pump curve at least 80% filled.'];
  if (exploreTab === 'new' && exploreNewLane === 'migrated') return ['No RPC-verified migrated pools in this feed.', 'A completed curve alone is not migration proof. A PumpSwap pool must also exist on this network.'];
  if (exploreTab === 'new') return ['No verified New Launch in the last 24 hours.', 'Older confirmed launches remain available under Trending.'];
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
function renderExploreAssets(){
  const grid = document.querySelector('#asset-grid');
  const count = document.querySelector('#explore-launch-count');
  const status = document.querySelector('#explore-data-status');
  const ticker = document.querySelector('#explore-ticker');
  const clusterLabel = document.querySelector('#explore-cluster-label');
  const networkLock = document.querySelector('#explore .network-lock');
  if (networkLock) networkLock.innerHTML = `<b>◎</b> ${EXPLORE_CLUSTER === 'mainnet-beta' ? 'Mainnet' : 'Devnet'}`;
  if (clusterLabel) clusterLabel.textContent = `Solana ${EXPLORE_CLUSTER === 'mainnet-beta' ? 'mainnet' : EXPLORE_CLUSTER} · ${exploreProviderStatus.includes('stale') ? 'last verified snapshot' : exploreProviderStatus.includes('RPC verified') ? 'RPC verified' : exploreProviderStatus.includes('unavailable') ? 'data unavailable' : 'awaiting verification'}`;
  const records = assets.map(item => EXPLORE_CLUSTER === 'devnet' ? withMarketWindow(item, exploreWindow) : enrichMarketRecord(item));
  const visible = filterMarketRecords(records, exploreFilterOptions());
  renderExploreControls();
  renderExplorePulse(records);
  const summary = summarizeMarkets(records);
  if (count) count.textContent = String(visible.length).padStart(2, '0');
  if (status) status.textContent = exploreProviderStatus === 'On-chain only · loading' ? exploreProviderStatus : `${exploreProviderStatus}${assets.length ? ` · ${visible.length} shown` : ''}`;
  const kpis = document.querySelector('#explore-market-kpis');
  if (kpis) kpis.innerHTML = EXPLORE_CLUSTER === 'devnet'
    ? `<span><small>${exploreWindow} traded · scanned</small><strong>${formatExploreUsd(records.some(item => item.windowVolumeSol != null) ? records.reduce((sum, item) => sum + (item.windowVolumeSol || 0), 0) : null, { partial: exploreScannedCount < records.length || records.some(item => item.windowCoverage === 'partial') })}</strong></span><span><small>Curve reserves</small><strong>${formatExploreUsd(records.some(item => item.curveReserveSol != null) ? records.reduce((sum, item) => sum + (item.curveReserveSol || 0), 0) : null)}</strong></span><span><small>Trade histories scanned</small><strong>${exploreScannedCount} / ${records.length}</strong></span>`
    : `<span><small>24h volume</small><strong>${formatSignal(summary.volume24hUsd, ' USD')}</strong></span><span><small>Liquidity indexed</small><strong>${formatSignal(summary.liquidityUsd, ' USD')}</strong></span><span><small>High-risk signals</small><strong>${summary.highRisk}</strong></span>`;
  if (ticker) ticker.innerHTML = visible.length ? `<span class="ticker-label"><i></i> On-chain activity · ${EXPLORE_CLUSTER === 'devnet' ? exploreWindow : '24h'}</span>${visible.slice(0, 6).map(asset => `<span>${escapeHtml(asset.symbol)} <b>${escapeHtml(EXPLORE_CLUSTER === 'devnet' ? formatExploreUsd(asset.windowVolumeSol, { partial: asset.windowCoverage === 'partial' }) : asset.change)}</b></span>`).join('')}<span class="ticker-note">Verified from on-chain data · provider fields may be unavailable</span>` : '<span class="ticker-label"><i></i> On-chain activity</span><span id="explore-ticker-status">No verified launches match these filters</span>';
  if (!grid) return;
  grid.innerHTML = visible.length ? visible.map(a => `<article class="asset-card signal-${escapeHtml(a.riskLevel)}" data-search="${escapeHtml(a.symbol)} ${escapeHtml(a.name)} ${escapeHtml(a.address || '')}" data-mint="${escapeHtml(a.address || '')}"><div class="asset-top"><span class="asset-symbol"><i class="asset-icon">${escapeHtml(a.icon)}</i>${escapeHtml(a.symbol)}</span><button type="button" class="watch-button" data-mint="${escapeHtml(a.address || '')}" aria-label="Save ${escapeHtml(a.symbol)} to watchlist" aria-pressed="false">☆</button></div><div class="asset-status"><span class="asset-meta">${exploreStageLabel(a)} · ${a.createdTimestamp ? escapeHtml(formatOnchainAge(Number(a.createdTimestamp) * 1000)) : 'age unavailable'}</span><span class="asset-status-badge">RPC verified</span></div><p class="asset-name">${escapeHtml(a.name)}</p><div class="asset-signal-row"><span>${EXPLORE_CLUSTER === 'devnet' ? '24h traded' : '24h volume'} <b>${EXPLORE_CLUSTER === 'devnet' ? formatExploreUsd(a.volume24hSol, { partial: a.volumeCoverage === 'partial' }) : formatSignal(a.volume24hUsd, ' USD')}</b></span><span>${EXPLORE_CLUSTER === 'devnet' ? 'Curve reserve' : 'Liquidity'} <b>${EXPLORE_CLUSTER === 'devnet' ? formatCoinUsd(a.curveReserveSol) : formatSignal(a.liquidityUsd, ' USD')}</b></span></div><div class="asset-bottom"><span class="asset-value">${escapeHtml(a.value === 'Price unavailable' ? 'Price unavailable' : a.value)}</span><span class="asset-change">${escapeHtml(a.change)}</span></div><div class="asset-risk"><span>${escapeHtml(a.source || 'Solana RPC')} · ${escapeHtml(formatFeedAge(a.fetchedAt))}</span><button type="button" class="share-asset" data-share-symbol="${escapeHtml(a.symbol)}" data-share-mint="${escapeHtml(a.address || '')}">Share</button></div><div class="asset-actions"><a href="/token/${encodeURIComponent(a.address || '')}">Inspect ↗</a><button type="button" data-trade-mint="${escapeHtml(a.address || '')}">Trade</button></div></article>`).join('') : `<div class="empty-state onchain-empty"><strong>${assets.length ? 'No verified launches match these filters.' : 'No verified on-chain launches yet.'}</strong><span>${assets.length ? 'Broaden the search or wait for a confirmed Solana indexer response.' : 'Explore will populate after a confirmed Solana RPC response.'}</span></div>`;
  if (!visible.length && /RPC (?:rate limited|unavailable)/.test(exploreProviderStatus)) grid.innerHTML = `<div class="empty-state onchain-empty"><strong>On-chain verification is temporarily unavailable.</strong><span>${escapeHtml(exploreProviderStatus)}. Retry with Refresh shortly; no unverified tokens are shown.</span></div>`;
  if (!visible.length && assets.length) {
    const reason = exploreEmptyReason();
    if (reason) { grid.querySelector('.empty-state strong').textContent = reason[0]; grid.querySelector('.empty-state span').textContent = reason[1]; }
  }
  for (const card of grid.querySelectorAll('.asset-card')) {
    const asset = visible.find(item => item.address === card.dataset.mint);
    if (!asset) continue;
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
      const compare = document.createElement('button');
      compare.type = 'button';
      compare.className = 'asset-compare-toggle';
      compare.dataset.compareMint = asset.address;
      card.querySelector('.watch-button')?.before(compare);
    }
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
    if (asset.complete !== false || asset.curveProgressPercent == null || !Number.isFinite(Number(asset.curveProgressPercent))) continue;
    const percent = Math.max(0, Math.min(100, Number(asset.curveProgressPercent)));
    const progress = document.createElement('div');
    progress.className = 'asset-curve-progress';
    progress.innerHTML = `<span>Curve filled <b>${percent.toFixed(0)}%</b></span><i><em></em></i>`;
    progress.querySelector('em').style.width = `${percent}%`;
    card.querySelector('.asset-bottom')?.before(progress);
  }
  if (!visible.length) {
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'explore-empty-action';
    action.dataset.exploreEmptyAction = assets.length ? 'clear' : 'retry';
    action.textContent = assets.length ? exploreTab === 'new' ? 'View Trending' : 'Clear filters' : 'Retry verification';
    grid.querySelector('.empty-state')?.append(action);
  }
  renderWatchlist();
  if (EXPLORE_CLUSTER === 'devnet') renderVerifiedTradeFlow();
  renderExploreTradeTape();
  renderExploreComparison();
}
function renderExploreComparison(){
  const panel = document.querySelector('#explore-compare');
  const count = document.querySelector('#explore-compare-count');
  const clear = document.querySelector('#explore-compare-clear');
  const content = document.querySelector('#explore-compare-content');
  if (!panel || !count || !clear || !content) return;
  panel.hidden = EXPLORE_CLUSTER !== 'devnet';
  if (panel.hidden) return;
  exploreCompareMints = exploreCompareMints.filter(mint => assets.some(item => item.address === mint));
  const selected = exploreCompareMints.map(mint => withMarketWindow(assets.find(item => item.address === mint), exploreWindow));
  count.textContent = `${selected.length} / 3 selected${exploreProviderStatus.includes('stale') ? ' · last verified snapshot' : ''}`;
  clear.hidden = !selected.length;
  document.querySelectorAll('[data-compare-mint]').forEach(button => {
    const active = exploreCompareMints.includes(button.dataset.compareMint);
    const asset = assets.find(item => item.address === button.dataset.compareMint);
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute('aria-label', `${active ? 'Remove' : 'Add'} ${asset?.symbol || 'token'} ${active ? 'from' : 'to'} comparison`);
    button.textContent = button.classList.contains('asset-compare-toggle') ? active ? '✓ Added' : '+ Compare' : active ? '✓ Added' : 'Compare';
  });
  if (!selected.length) { content.innerHTML = '<p class="explore-compare-empty">Use Compare on a card or scanner row to inspect tokens side by side.</p>'; return; }
  const metricRows = [
    [`${exploreWindow} traded`, item => formatExploreUsd(item.windowVolumeSol, { partial: item.windowCoverage === 'partial' })],
    [`${exploreWindow} trades`, item => formatExploreTradeCount(item.windowTradeCount, item.windowCoverage)],
    ['Buys / sells', item => item.windowBuyCount == null || item.windowSellCount == null ? '—' : `${formatExploreTradeCount(item.windowBuyCount, item.windowCoverage)} / ${formatExploreTradeCount(item.windowSellCount, item.windowCoverage)}`],
    ['Trading wallets', item => formatExploreTradeCount(item.windowTraderCount, item.windowCoverage)],
    ['Curve cap', item => formatCoinUsd(item.curveCapSol)],
    ['Curve reserve', item => formatCoinUsd(item.curveReserveSol)],
    ['Curve progress', item => item.complete === true ? 'Graduated' : item.complete === false && item.curveProgressPercent != null && Number.isFinite(Number(item.curveProgressPercent)) ? `${Number(item.curveProgressPercent).toFixed(0)}%` : '—'],
    ['Mint authority', item => item.mintAuthorityRevoked === true ? 'Revoked' : item.mintAuthorityRevoked === false ? 'Active' : '—'],
    ['Freeze authority', item => item.freezeAuthorityRevoked === true ? 'Revoked' : item.freezeAuthorityRevoked === false ? 'Active' : '—'],
  ];
  content.innerHTML = `<div class="explore-compare-scroll"><table class="explore-compare-table"><thead><tr><th scope="col">Verified metric</th>${selected.map(item => `<th scope="col"><span class="compare-token"><strong>${escapeHtml(item.symbol)}</strong><small title="${escapeHtml(item.address)}">${escapeHtml(shortAddress(item.address))}</small></span><span class="compare-token-actions"><a href="/token/${encodeURIComponent(item.address)}">Inspect ↗</a><button type="button" data-compare-remove="${escapeHtml(item.address)}" aria-label="Remove ${escapeHtml(item.symbol)} from comparison">×</button></span></th>`).join('')}</tr></thead><tbody>${metricRows.map(([label, value]) => `<tr><th scope="row">${escapeHtml(label)}</th>${selected.map(item => `<td>${escapeHtml(value(item))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${selected.length === 1 ? '<p class="explore-compare-hint">Add another verified token for a side-by-side view.</p>' : ''}`;
}
function toggleExploreComparison(mint){
  if (EXPLORE_CLUSTER !== 'devnet' || !assets.some(item => item.address === mint)) return;
  const removing = exploreCompareMints.includes(mint);
  if (removing) exploreCompareMints = exploreCompareMints.filter(item => item !== mint);
  else if (exploreCompareMints.length < 3) exploreCompareMints = [...exploreCompareMints, mint];
  else { showToast('Compare up to three verified tokens. Remove one first.'); return; }
  renderExploreComparison();
  showToast(`${assets.find(item => item.address === mint)?.symbol || 'Token'} ${removing ? 'removed from' : 'added to'} comparison`);
}
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
  list.innerHTML = trades.length ? trades.map(trade => `<div class="explore-tape-row"><span class="explore-tape-side ${trade.side}">${trade.side === 'buy' ? 'Buy' : 'Sell'}</span><span class="explore-tape-token"><a href="/token/${encodeURIComponent(trade.mint)}">${escapeHtml(trade.symbol || shortAddress(trade.mint))}</a><small>${escapeHtml(shortAddress(trade.mint))}</small></span><strong>${escapeHtml(formatCoinUsd(trade.solAmount))}</strong><time title="${escapeHtml(new Date(trade.blockTime * 1000).toLocaleString())}">${escapeHtml(formatOnchainAge(trade.blockTime * 1000))}</time><a class="explore-tape-proof" href="${escapeHtml(exploreExplorer(`tx/${encodeURIComponent(trade.signature)}`))}" target="_blank" rel="noopener noreferrer" aria-label="Inspect ${escapeHtml(trade.side)} transaction for ${escapeHtml(trade.symbol || 'token')} on Solana Explorer">Tx ↗</a></div>`).join('') : `<div class="empty-state">${assets.length ? `No confirmed Pump trades in the scanned ${exploreWindow} window.${exploreScannedCount < assets.length || partial ? ' History may be incomplete.' : ''}` : 'Waiting for RPC-verified Devnet launches and trade history.'}</div>`;
}
function renderVerifiedTradeFlow(){
  const list = document.querySelector('#terminal-signal-list');
  const status = document.querySelector('#terminal-signals-status');
  if (!list || !status) return;
  const scanned = assets.map(item => withMarketWindow(item, exploreWindow)).filter(item => item.windowTradeCount != null)
    .sort((a, b) => b.windowTradeCount - a.windowTradeCount).slice(0, 5);
  status.textContent = exploreProviderStatus.includes('stale') ? 'Last verified · stale' : `${exploreScannedCount} / ${assets.length} scanned`;
  list.innerHTML = scanned.length ? scanned.map(item => `<div class="terminal-signal-row"><span><strong>${escapeHtml(item.symbol)}</strong><small>${exploreWindow} · ${item.windowBuyCount != null && item.windowSellCount != null ? `${formatExploreTradeCount(item.windowBuyCount, item.windowCoverage)} ${item.windowBuyCount === 1 ? 'buy' : 'buys'} · ${formatExploreTradeCount(item.windowSellCount, item.windowCoverage)} ${item.windowSellCount === 1 ? 'sell' : 'sells'}` : 'Buy/sell split unavailable'} · confirmed Pump events</small></span><b>${formatExploreTradeCount(item.windowTradeCount, item.windowCoverage)} ${item.windowTradeCount === 1 ? 'trade' : 'trades'}</b></div>`).join('') : '<div class="empty-state">No confirmed Pump trade events have been scanned for this feed.</div>';
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
  return `${Math.floor(minutes / 60)}h ago`;
}
function formatUsd(value){
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
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
function renderHomeOnchainSnapshot(verified){
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
  if (pulseStatus) pulseStatus.textContent = `Solana RPC · ${EXPLORE_CLUSTER} confirmed`;
  if (pulseNetwork) pulseNetwork.textContent = `Solana ${EXPLORE_CLUSTER === 'devnet' ? 'Devnet' : EXPLORE_CLUSTER}`;
  if (pulseLaunches) pulseLaunches.textContent = verified.length ? String(verified.length) : '—';
  if (pulseLaunchesNote) pulseLaunchesNote.textContent = verified.length ? `Confirmed on ${EXPLORE_CLUSTER}` : 'No confirmed launches';
  if (pulseTrades) pulseTrades.textContent = totalTrades == null ? '—' : formatExploreTradeCount(totalTrades, partialTrades ? 'partial' : 'complete');
  if (pulseTradesNote) pulseTradesNote.textContent = totalTrades == null ? 'Not available from current feed' : `${partialTrades ? 'Partial scan · ' : ''}confirmed Pump events`;
  if (pulseVolume) pulseVolume.textContent = totalVolume == null ? '—' : formatExploreUsd(totalVolume, { partial: partialTrades });
  if (pulseVolumeNote) pulseVolumeNote.textContent = totalVolume == null ? 'Not available from current feed' : `${partialTrades ? 'Partial scan · ' : ''}SOL volume`;
  const graduated = verified.filter(item => item.migrated === true).length;
  if (pulseGraduated) pulseGraduated.textContent = graduated ? String(graduated) : verified.length ? '0' : '—';
  if (pulseGraduatedNote) pulseGraduatedNote.textContent = verified.length ? 'Verified PumpSwap stage' : 'Waiting for verified mints';
  if (policyUpdated) policyUpdated.textContent = `RPC checked ${new Date().toLocaleTimeString()} · ${EXPLORE_CLUSTER}`;
}
let receiptEvidence = null;
function renderVerifiedReceiptEvidence(){
  if (!receiptEvidence || !['onchain-indexed', 'partial'].includes(receiptEvidence.status)) return;
  const collections = Array.isArray(receiptEvidence.verifiedCollections) ? receiptEvidence.verifiedCollections : [];
  const payouts = Array.isArray(receiptEvidence.verifiedPayouts) ? receiptEvidence.verifiedPayouts : [];
  const cards = document.querySelectorAll('.analytics-kpis article');
  if (collections.length && cards[0]) {
    cards[0].querySelector('span').textContent = 'Verified fees claimed';
    const lamports = collections.reduce((sum, item) => sum + Number(item.collectedLamports || 0), 0);
    cards[0].querySelector('strong').textContent = `${(lamports / 1_000_000_000).toFixed(6)} SOL`;
    cards[0].querySelector('small').textContent = `${collections.length} confirmed fee claims · verified subset`;
  }
  if (payouts.length && cards[2]) {
    cards[2].querySelector('span').textContent = 'Verified payouts';
    cards[2].querySelector('strong').textContent = `${payouts.length} verified`;
    cards[2].querySelector('small').textContent = 'Confirmed recipient balance deltas · checked window';
  }
  if (!payouts.length) return;
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
  tape.replaceChildren(...[...list.children].map(row => row.cloneNode(true)));
  const footnote = document.querySelector('#payments .panel-footnote');
  if (footnote && payouts.length) footnote.textContent = `${payouts.length} confirmed payout receipt${payouts.length === 1 ? '' : 's'} in the checked window${receiptEvidence.status === 'partial' ? ' · other records remain unverified' : ''}.`;
}
function renderOnchainReportState(verified){
  const cards = document.querySelectorAll('.analytics-kpis article');
  if (cards[0]) { cards[0].querySelector('strong').textContent = '—'; cards[0].querySelector('small').textContent = 'No on-chain router claim events indexed'; }
  if (cards[1]) { cards[1].querySelector('strong').textContent = verified.length ? String(verified.length) : '—'; cards[1].querySelector('small').textContent = verified.length ? `Confirmed mints · ${EXPLORE_CLUSTER}` : `No confirmed mints · ${EXPLORE_CLUSTER}`; }
  if (cards[2]) { cards[2].querySelector('strong').textContent = '—'; cards[2].querySelector('small').textContent = 'No on-chain payout receipts indexed'; }
  const strip = document.querySelector('#analytics .strip-stat');
  if (strip) strip.innerHTML = verified.length ? `${verified.length} <small>confirmed mints · ${EXPLORE_CLUSTER}</small>` : '— <small>no confirmed mints</small>';
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
}
let homeLaunchTab = 'trending';
function renderHomeLaunchBoard(){
  const grid = document.querySelector('#home-launch-grid');
  if (!grid) return;
  let visible = [...assets];
  if (homeLaunchTab === 'new') visible.sort((a, b) => Number(b.createdTimestamp || 0) - Number(a.createdTimestamp || 0));
  else if (homeLaunchTab === 'watchlist') visible = visible.filter(item => getWatchlist().includes(item.address));
  else visible.sort((a, b) => EXPLORE_CLUSTER === 'devnet'
    ? Number(b.curveCapSol || 0) - Number(a.curveCapSol || 0)
    : Number(b.marketCapUsd || 0) - Number(a.marketCapUsd || 0));
  visible = visible.slice(0, 3);
  if (!visible.length) {
    grid.innerHTML = `<div class="empty-state"><strong>${homeLaunchTab === 'watchlist' ? 'No watched launches yet.' : 'No verified launches yet.'}</strong><span>${homeLaunchTab === 'watchlist' ? 'Save a verified mint from Explore to see it here.' : 'This board populates after Solana RPC confirms a Devnet mint.'}</span></div>`;
    return;
  }
  grid.innerHTML = visible.map(item => `<article class="home-launch-card"><div class="home-launch-card-top"><span class="asset-symbol"><i class="asset-icon">${escapeHtml(item.icon || 'T')}</i>${escapeHtml(item.symbol || 'TOKEN')}</span><span class="asset-status-badge">RPC verified</span></div><strong>${escapeHtml(item.name || 'Unnamed token')}</strong><small>${escapeHtml(exploreStageLabel(item))} · ${escapeHtml(formatOnchainAge(Number(item.createdTimestamp || 0) * 1000))}</small><div class="home-launch-card-stats"><span>${EXPLORE_CLUSTER === 'devnet' ? 'Curve cap' : 'Market cap'} <b>${escapeHtml(EXPLORE_CLUSTER === 'devnet' ? formatCoinUsd(item.curveCapSol) : item.marketCapUsd != null ? formatCompactUsd(item.marketCapUsd) : 'Unavailable')}</b></span><span>24h <b>${escapeHtml(item.change || '—')}</b></span></div><div class="home-launch-card-actions"><a href="/token/${encodeURIComponent(item.address || '')}">Inspect ↗</a><button type="button" data-trade-mint="${escapeHtml(item.address || '')}">Trade</button></div></article>`).join('');
  grid.querySelectorAll('.home-launch-card').forEach((card, index) => {
    const promotion = promotionElement(visible[index]?.address, true);
    if (promotion) card.querySelector('.home-launch-card-top')?.append(promotion);
  });
}
document.querySelectorAll('[data-home-launch-tab]').forEach(button => button.addEventListener('click', () => {
  homeLaunchTab = button.dataset.homeLaunchTab || 'trending';
  document.querySelectorAll('[data-home-launch-tab]').forEach(item => { const active = item === button; item.classList.toggle('active', active); item.setAttribute('aria-selected', String(active)); });
  renderHomeLaunchBoard();
}));
async function loadOnchainExploreData(){
    const pumpSort = exploreSort === 'newest' ? 'created_timestamp' : 'last_trade_timestamp';
    const birdeyeSort = exploreSort === 'change' ? 'price_change_24h_percent' : exploreSort === 'market-cap' ? 'market_cap' : 'volume_24h_usd';
    const feeds = [
      Promise.resolve({ available: false, data: null }),
      apiRequest(`/api/pump/explore?limit=40&sort=${encodeURIComponent(pumpSort)}`).catch(() => ({ available: false, data: null })),
    ];
    if (EXPLORE_CLUSTER !== 'devnet') feeds[0] = apiRequest(`/api/birdeye/explore?limit=40&sort_by=${encodeURIComponent(birdeyeSort)}`).catch(() => ({ available: false, data: null }));
    const [birdeyeFeed, pumpFeed] = await Promise.all(feeds);
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
        const { PublicKey, unpackMint, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } = await getSolana();
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
            verified.push({ mint: record.address, symbol: record.symbol || 'TOKEN', name: record.name || 'Unnamed token', value: EXPLORE_CLUSTER === 'devnet' && curveMetrics.curvePriceSol != null ? `Curve spot · ${formatCoinUsd(curveMetrics.curvePriceSol)}` : Number.isFinite(price) ? formatUsd(price) : 'Price unavailable', change: Number.isFinite(change) ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}%` : '—', meta: Number.isFinite(marketCap) ? `MC ${formatCompactUsd(marketCap)} · ${record.source || 'Pump.fun'}` : (record.source || 'Pump.fun'), icon: String(record.symbol || 'T').slice(0, 1), source: record.source || 'Pump.fun', creator: record.creator || null, complete: curve ? Boolean(curve.complete) : null, migrated: null, pumpSwapPool: null, quoteMint: curve?.quoteMint?.toBase58?.() || null, bondingCurve: curve ? bondingCurvePda(mint).toBase58() : null, raydiumPool: record.raydiumPool || null, fetchedAt: record.fetchedAt || null, address: record.address, mintAuthorityRevoked: mintState.mintAuthority == null, freezeAuthorityRevoked: mintState.freezeAuthority == null, volume24hUsd: record.volume24hUsd ?? null, liquidityUsd: record.liquidityUsd ?? null, holders: record.holders ?? null, marketCapUsd: Number.isFinite(marketCap) ? marketCap : null, priceChange24hPercent: Number.isFinite(change) ? change : null, createdTimestamp: record.createdTimestamp || null, lastTradeUnixTime: record.lastTradeUnixTime || null, ...curveMetrics });
         } catch {}
         }
         const completed = verified.filter(item => item.complete === true);
         if (completed.length) {
           try {
             const poolKeys = completed.map(item => canonicalPumpPoolPda(new PublicKey(item.address), item.quoteMint ? new PublicKey(item.quoteMint) : undefined));
             const poolAccounts = await exploreRpc.getMultipleAccountsInfo(poolKeys, 'confirmed');
             completed.forEach((item, index) => {
               const account = poolAccounts[index];
               item.migrated = false;
               if (!account?.owner?.equals(PUMP_AMM_PROGRAM_ID)) return;
               try {
                 const pool = PUMP_AMM_SDK.decodePool(account);
                 if (!pool.baseMint?.equals(new PublicKey(item.address))) return;
                 item.migrated = true;
                 item.pumpSwapPool = poolKeys[index].toBase58();
               } catch {}
             });
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
    exploreScannedCount = 0;
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
        exploreScannedCount += 1;
        const volume = Number(market.volume24hSol);
        item.volume24hSol = market.volume24hSol != null && Number.isFinite(volume) && volume >= 0 ? volume : null;
        item.volumeCoverage = market.coverage;
        for (const key of ['tradeCount24h', 'buyCount24h', 'sellCount24h']) {
          const count = Number(market[key]);
          item[key] = market[key] != null && Number.isInteger(count) && count >= 0 ? count : null;
        }
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
    if (marketScanRateLimited) exploreBackoffUntil = Date.now() + 60_000;
  assets = Array.from(new Map(verified.map(item => [item.address, item])).values());
    exploreUpdatedAt = new Date().toISOString();
    if (!exploreVerificationFailed && pumpFeed.available && records.length) exploreLastVerifiedAt = exploreUpdatedAt;
    exploreProviderStatus = exploreVerificationFailed ? `Solana ${EXPLORE_CLUSTER} RPC ${exploreRateLimited ? 'rate limited · retry shortly' : 'unavailable'}` : !pumpFeed.available ? 'Launch feed unavailable' : !records.length ? 'No indexed launches · awaiting RPC verification' : EXPLORE_CLUSTER === 'devnet' ? `Devnet registry · RPC verified${marketScanRateLimited ? ' · trade history rate limited' : ''}` : !birdeyeFeed.available ? `Pump.fun · Birdeye unavailable · RPC verified` : 'Pump.fun + Birdeye · RPC verified';
    const feedStatus = document.querySelector('#explore-data-status');
    renderExploreAssets();
    renderHomeLaunchBoard();
    if (feedStatus) {
      feedStatus.textContent = exploreProviderStatus;
    }
    renderRegistry();
    updateExploreSortAvailability();
  renderOnchainReportState(verified);
  renderHomeOnchainSnapshot(verified);
}
loadOnchainExploreData().catch(() => {
  const status = document.querySelector('#home-live-status');
  const note = document.querySelector('#home-verified-launches-note');
  if (status) status.textContent = 'Solana RPC · unavailable';
  if (note) note.textContent = 'Unable to verify live data';
});
setInterval(() => { if (!document.hidden && exploreAutoRefresh && Date.now() >= exploreBackoffUntil) loadOnchainExploreData().catch(() => {}); }, 30000);
setInterval(() => { if (!document.hidden && exploreAutoRefresh) renderStonkEnhancements(); }, 30000);
const analyticsLaunchMetric = document.querySelector('.analytics-kpis article:nth-child(2)');
if (analyticsLaunchMetric) {
  const metric = analyticsLaunchMetric.querySelector('strong');
  const note = analyticsLaunchMetric.querySelector('small');
  if (metric) metric.textContent = '—';
  if (note) note.textContent = 'Awaiting verified indexer';
}
async function loadReceiptEvidence(){
  const result = await apiRequest('/api/evidence/receipts').catch(() => null);
  const data = result?.data;
  if (result?.available !== true || data?.cluster !== EXPLORE_CLUSTER) return;
  receiptEvidence = data;
  renderOnchainReportState(assets);
}
document.querySelector('#payment-list').innerHTML = payments.map(p => `<div class="payment-row"><span class="payment-avatar">${p[0]}</span><span><strong>${p[1]}</strong><small>${p[2]}</small></span><span class="payment-amount">${p[3]}<small> sample</small></span></div>`).join('');
document.querySelector('#payment-dialog-list').innerHTML = payments.length
  ? document.querySelector('#payment-list').innerHTML
  : '<p class="empty-state">No verified payout receipts are available on Devnet yet. The payment tape will populate only after on-chain receipts are indexed.</p>';
loadReceiptEvidence();
renderWatchlist();
let registryLaunches = [];
let registrySort = 'recent';
function updateExploreSortAvailability(){
  const select = document.querySelector('#explore-sort');
  if (EXPLORE_CLUSTER !== 'devnet') {
    const labels = { 'market-cap': 'Market cap', volume: '24h volume', trades: '24h trades', turnover: 'Volume / cap', liquidity: 'Liquidity', 'recent-trade': 'Recent activity', holders: 'Holders', change: '24h price change', newest: 'Newest' };
    if (select) for (const option of select.options) { option.textContent = labels[option.value]; option.disabled = option.value === 'trades'; }
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
  const supported = {
    'market-cap': assets.some(item => item.curveCapSol != null),
    volume: exploreScannedCount === assets.length && assets.some(item => withMarketWindow(item, exploreWindow).windowVolumeSol != null),
    trades: exploreScannedCount === assets.length && assets.some(item => withMarketWindow(item, exploreWindow).windowTradeCount != null),
    turnover: exploreScannedCount === assets.length && assets.some(item => { const metric = withMarketWindow(item, exploreWindow); return metric.windowVolumeSol != null && metric.curveCapSol > 0; }),
    liquidity: assets.some(item => item.curveReserveSol != null),
    'recent-trade': true,
    holders: false,
    change: assets.some(item => item.priceChange24hPercent != null),
    newest: true,
  };
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
    return `<div class="scanner-row" role="listitem">
      <div class="scanner-token"><span class="asset-icon">${escapeHtml(item.icon)}</span><span><strong>${symbol} <small>${escapeHtml(item.name)}</small></strong><small title="${mint}">${escapeHtml(shortAddress(item.address))} · RPC mint</small><small class="scanner-authorities">Mint ${item.mintAuthorityRevoked ? 'revoked' : 'active'} · Freeze ${item.freezeAuthorityRevoked ? 'revoked' : 'active'}</small></span></div>
      <div class="scanner-stage"><strong>${stage}</strong><small>${age}${item.complete === false && item.curveProgressPercent != null && Number.isFinite(Number(item.curveProgressPercent)) ? ` · ${Number(item.curveProgressPercent).toFixed(0)}% curve` : ''}</small></div>
      <span class="scanner-metric">${escapeHtml(EXPLORE_CLUSTER === 'devnet' ? formatCoinUsd(item.curveCapSol) : formatCompactUsd(item.marketCapUsd))}</span>
      <span class="scanner-metric" title="${item.windowCoverage === 'partial' ? 'Partial confirmed trade-history scan; shown as a lower bound' : 'Confirmed trade history'}">${escapeHtml(EXPLORE_CLUSTER === 'devnet' ? formatExploreUsd(item.windowVolumeSol, { partial: item.windowCoverage === 'partial' }) : formatCompactUsd(item.volume24hUsd))}</span>
      <span class="scanner-metric">${escapeHtml(EXPLORE_CLUSTER === 'devnet' ? formatCoinUsd(item.curveReserveSol) : formatCompactUsd(item.liquidityUsd))}</span>
      <span class="scanner-metric ${EXPLORE_CLUSTER !== 'devnet' && Number(item.priceChange24hPercent) < 0 ? 'negative' : ''}">${EXPLORE_CLUSTER === 'devnet' ? `<strong>${formatExploreTradeCount(item.windowTradeCount, item.windowCoverage)}</strong><small>${item.windowBuyCount != null && item.windowSellCount != null ? `${formatExploreTradeCount(item.windowBuyCount, item.windowCoverage)} B · ${formatExploreTradeCount(item.windowSellCount, item.windowCoverage)} S` : 'Split unavailable'}${item.windowTraderCount != null ? ` · ${formatExploreTradeCount(item.windowTraderCount, item.windowCoverage)} wallets` : ''}</small>` : change}</span>
      <div class="scanner-actions"><button type="button" class="watch-button scanner-watch" data-mint="${mint}" aria-label="Save ${symbol} to watchlist" aria-pressed="false">☆</button>${EXPLORE_CLUSTER === 'devnet' ? `<button type="button" class="scanner-compare" data-compare-mint="${mint}" aria-pressed="false">Compare</button>` : ''}<a href="/token/${encodeURIComponent(item.address)}" aria-label="Inspect ${symbol}">Inspect</a><button type="button" data-trade-mint="${mint}">Trade</button><button type="button" class="copy-row" data-mint="${mint}" aria-label="Copy ${symbol} mint address">⧉</button></div>
    </div>`;
  }).join('');
  list.querySelectorAll('.scanner-row').forEach((row, index) => {
    const promotion = promotionElement(filtered[index]?.address);
    if (promotion) row.querySelector('.scanner-token strong')?.append(' ', promotion);
  });
  renderWatchlist();
  renderExploreComparison();
}
renderRegistry();

const toast = document.querySelector('#toast');
let toastTimer;
function showToast(message){ toast.textContent = message; toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 2600); }
function getPhantomBrowseUrl(){
  const appUrl = window.location.href;
  return `https://phantom.app/ul/browse/${encodeURIComponent(appUrl)}?ref=${encodeURIComponent(window.location.origin)}`;
}
function buildPhantomConnectRequest(){
  const keyPair = nacl.box.keyPair();
  const current = new URL(window.location.href);
  const redirect = new URL(current.origin + current.pathname);
  redirect.searchParams.set('phantom', 'connect');
  const appUrl = `${current.origin}${current.pathname}`;
  const requestUrl = new URL('https://phantom.app/ul/v1/connect');
  requestUrl.search = new URLSearchParams({ app_url: appUrl, dapp_encryption_public_key: bs58.encode(keyPair.publicKey), redirect_link: redirect.toString(), cluster: 'devnet' }).toString();
  sessionStorage.setItem('funded.app.phantom.mobile.connect', JSON.stringify({ secretKey: bs58.encode(keyPair.secretKey), redirect: redirect.toString(), returnHash: current.hash }));
  return requestUrl.toString();
}
async function handlePhantomMobileCallback(){
  const params = new URLSearchParams(window.location.search);
  if (params.get('phantom') !== 'connect') return false;
  const raw = sessionStorage.getItem('funded.app.phantom.mobile.connect');
  if (params.get('errorCode') || !raw) { showToast(params.get('errorMessage') || 'Phantom mobile connection was cancelled'); return false; }
  try {
    const state = JSON.parse(raw);
    const sharedSecret = nacl.box.before(bs58.decode(params.get('phantom_encryption_public_key')), bs58.decode(state.secretKey));
    const opened = nacl.box.open(bs58.decode(params.get('data')), bs58.decode(params.get('nonce')), sharedSecret);
    if (!opened) throw new Error('Could not decrypt the Phantom response.');
    const response = JSON.parse(new TextDecoder().decode(opened));
    const { PublicKey } = await getSolana();
    const publicKey = new PublicKey(response.public_key);
    mobileWalletSession = { session: response.session, sharedSecret: bs58.encode(sharedSecret), publicKey: publicKey.toBase58() };
    const mobileProvider = { publicKey, isConnected: true, readOnly: true, signTransaction: async () => { throw new Error('Open this app inside Phantom to approve transactions.'); }, disconnect: async () => {} };
    sessionStorage.removeItem('funded.app.phantom.mobile.connect');
    history.replaceState({}, document.title, `${window.location.pathname}${state.returnHash || ''}`);
    allowWalletReconnect();
    activateWallet(mobileProvider, 'Mobile wallet linked');
    showToast('Phantom address linked. Open inside Phantom to sign.');
    return true;
  } catch (error) { showToast(`Phantom connection failed: ${error.message}`); return false; }
}
function openMobileWalletDialog(){
  const dialog = document.querySelector('#mobile-wallet-dialog');
  const message = document.querySelector('#mobile-wallet-message');
  const openButton = document.querySelector('#mobile-wallet-open');
  const qr = document.querySelector('#mobile-wallet-qr');
  const qrLabel = document.querySelector('#mobile-wallet-qr-label');
  const localHost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
  if (localHost) {
    message.textContent = 'This local URL is only reachable on this computer. Run the dev server on your LAN or use a hosted HTTPS URL, then open that URL on your phone.';
    openButton.disabled = true;
    openButton.title = 'Use a LAN or hosted URL before opening Phantom on your phone.';
    qr.hidden = true;
    qrLabel.textContent = 'QR becomes available on a LAN or hosted URL.';
  } else {
    message.textContent = 'Scan the QR code with your phone. Phantom will open the request, then return the approved wallet address to this browser.';
    openButton.disabled = false;
    openButton.title = '';
    const requestUrl = buildPhantomConnectRequest();
    qr.src = `https://quickchart.io/qr?size=220&margin=2&text=${encodeURIComponent(requestUrl)}`;
    qr.alt = 'Scan to connect Phantom mobile wallet';
    qr.hidden = false;
    qrLabel.textContent = 'Scan with your phone camera or Phantom app.';
  }
  if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
}
function openPhantomMobileBrowser(){
  if (['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)) return;
  window.location.href = buildPhantomConnectRequest();
}
function setTradeStatus(message, error = false){ const node = document.querySelector('#trade-status'); if (node) { node.textContent = message; node.className = `field-help ${error ? 'funded-mint-invalid' : ''}`; } }
function updateTradeAmountLabel(){
  const side = document.querySelector('#trade-side')?.value;
  const label = document.querySelector('#trade-amount-label');
  if (label) label.firstChild.textContent = side === 'sell' ? 'Token amount' : 'SOL amount';
  const amount = document.querySelector('#trade-amount');
  if (amount) amount.placeholder = side === 'sell' ? '1000' : '0.10';
  const presets = document.querySelector('#coin-quick-amounts');
  if (presets) presets.hidden = side === 'sell';
  document.querySelectorAll('[data-coin-trade-side]').forEach(button => {
    const active = button.dataset.coinTradeSide === side;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}
function invalidateTradePreview(){
  tradePreview = null;
  const quote = document.querySelector('#trade-quote');
  const submit = document.querySelector('#trade-submit');
  if (quote) quote.textContent = 'Preview the current mint, amount, and slippage before signing.';
  if (submit) submit.disabled = true;
}
async function previewTrade(){
  if (!wallet) { await connectWallet(); if (!wallet) return; }
  const session = captureWalletSession();
  if (!session || !canSignTransactions(session.provider)) return setTradeStatus('Open this app in a signing wallet to trade.', true);
  const mint = document.querySelector('#trade-mint').value.trim();
  const side = document.querySelector('#trade-side').value;
  const amount = Number(document.querySelector('#trade-amount').value);
  const slippagePercent = Number(document.querySelector('#trade-slippage').value);
  if (!mint || !Number.isFinite(amount) || amount <= 0) return setTradeStatus('Enter a mint and a positive amount to preview.', true);
  const button = document.querySelector('#trade-preview'); button.disabled = true;
  invalidateTradePreview();
  try {
    const previewConnection = await getTradePreviewConnection();
    assertWalletSessionCurrent(session);
    const trade = await buildTradeTransaction({ connection: previewConnection, side, mint, user: session.provider.publicKey, amount, slippagePercent, feeOwner: TRADE_FEE_OWNER, feeBps: TRADE_FEE_BPS });
    assertWalletSessionCurrent(session);
    const quote = describeTradeQuote(trade, slippagePercent);
    const inputKey = `${mint}:${side}:${amount}:${slippagePercent}:${session.address}`;
    tradePreview = { trade, inputKey, preparedAt: Date.now() };
    document.querySelector('#trade-quote').textContent = `${quote.route === 'graduated-pool' ? 'Graduated pool' : 'Pump curve'} · Estimated receive: ${quote.expected.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${quote.outputSymbol}. Slippage floor: ${quote.minimum.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${quote.outputSymbol}. App fee: ${quote.appFeeSol.toFixed(6)} SOL, plus network and Pump fees. Quote expires in 15 seconds.`;
    document.querySelector('#trade-submit').disabled = false;
    setTradeStatus('Review this quote and the transaction in your wallet before signing.');
  } catch (error) { if (isWalletSessionCurrent(session)) setTradeStatus(`Quote unavailable: ${error.message}`, true); }
  finally { button.disabled = false; }
}
async function executeTrade(){
  if (!wallet) return setTradeStatus('Connect a wallet and preview the trade first.', true);
  const session = captureWalletSession();
  if (!session || !canSignTransactions(session.provider)) return setTradeStatus('Open this app in a signing wallet to trade.', true);
  const mint = document.querySelector('#trade-mint').value.trim(); const side = document.querySelector('#trade-side').value;
  const amount = Number(document.querySelector('#trade-amount').value); const slippagePercent = Number(document.querySelector('#trade-slippage').value);
  if (!mint || !Number.isFinite(amount) || amount <= 0) { setTradeStatus('Enter a valid mint and positive trade amount.', true); return; }
  if (!TRADE_FEE_OWNER) { setTradeStatus('Trading is disabled: configure VITE_FUNDED_TRADE_FEE_OWNER for the app owner.', true); return; }
  const inputKey = `${mint}:${side}:${amount}:${slippagePercent}:${session.address}`;
  if (!tradePreview || tradePreview.inputKey !== inputKey || Date.now() - tradePreview.preparedAt > 15_000) { invalidateTradePreview(); setTradeStatus('Quote changed or expired. Preview again before signing.', true); return; }
  const button = document.querySelector('#trade-submit'); button.disabled = true;
  try {
    const activeConnection = connection || (await getSolana(), connection);
    assertWalletSessionCurrent(session);
    const result = await submitTrade({ connection: activeConnection, provider: session.provider, side, mint, user: session.provider.publicKey, amount, slippagePercent, feeOwner: TRADE_FEE_OWNER, feeBps: TRADE_FEE_BPS, preparedTrade: tradePreview.trade, assertWalletCurrent: () => assertWalletSessionCurrent(session), onStatus: message => { if (isWalletSessionCurrent(session)) setTradeStatus(message); } });
    if (!isWalletSessionCurrent(session)) return;
    setTradeStatus(`${side === 'buy' ? 'Buy' : 'Sell'} confirmed: ${result.signature}. App fee: ${(result.feeLamports / 1_000_000_000).toFixed(6)} SOL.`);
    if (getCoinMintAddress() === mint) void loadCoinOnChain(mint);
    showToast(`${side === 'buy' ? 'Buy' : 'Sell'} confirmed on Devnet`); refreshWalletInfo();
  } catch (error) { if (isWalletSessionCurrent(session)) setTradeStatus(`Trade failed or confirmation unavailable: ${error.message}`, true); } finally { if (isWalletSessionCurrent(session)) invalidateTradePreview(); }
}
function openInfoDialog(kind){
  const content = {
    terms: ['Terms of Use', '<div class="legal-meta"><span>Effective 18 Sep 2026</span><span>Version 1.0</span><span>Applies to funded.vip Devnet tools</span></div><p>Use the Devnet launcher for testing only. You are responsible for reviewing every transaction before signing and for complying with applicable rules.</p><h3>Contents</h3><ul class="legal-list"><li>Wallet connection and signatures</li><li>Token metadata and deployer responsibility</li><li>Network, fees, and transaction confirmation</li><li>Prohibited use and service limitations</li><li>Privacy, disclosures, and support</li></ul><p class="muted-note">This is a product disclosure for the local build, not legal advice or a production agreement.</p>'],
  disclosures: ['Disclosures', '<div class="legal-meta"><span>Effective 19 Sep 2026</span><span>Version 1.3</span><span>Applies to the Devnet preview</span></div><p>The Pump Devnet flow creates the coin with the verified funded.vip router PDA written directly into Pump’s creator field. The paying wallet never receives creator-fee authority, and the app reads the bonding curve back before reporting success.</p><h3>Important limits</h3><ul class="legal-list"><li>Devnet SOL has no intended monetary value.</li><li>The production router program, claim worker, settlement services, payout rails, and treasury controls are not deployed by this frontend.</li><li>Permanent token metadata, community-vault funding, X recipient verification, and payout execution require production services that are not connected.</li><li>Pump protocol administrators or a future Pump program upgrade remain outside funded.vip’s control.</li><li>funded.vip is not affiliated with X, Phantom, or Pump.fun.</li></ul><p class="muted-note">Verify the Pump creator address in the launch transaction and bonding-curve account on Solana Explorer.</p>'],
    capital: ['Capital flow', '<p>This chart shows the flow model. Connect a data source to replace the example series with indexed activity.</p>'],
  'opt-out': ['Opt out', '<div class="legal-meta"><span>Account controls</span><span>Devnet preview</span></div><p>Request that an account or project be excluded from future indexed activity feeds. This local build does not run a payout or indexing backend yet.</p><div class="optout-steps"><div><b>1</b><span><strong>Sign in with X</strong><small>Verify control of the account you want to manage.</small></span></div><div><b>2</b><span><strong>Choose exclusions</strong><small>Hide the account from discovery and stop new recipient selections.</small></span></div><div><b>3</b><span><strong>Review status</strong><small>Confirm the effective date and any unpaid-fee handling.</small></span></div></div><button type="button" class="secondary-button info-action" disabled>Opt-out requests unavailable</button><p class="muted-note">X sign-in, indexed exclusions, and payout handling are not connected in this Devnet build.</p>'],
  }[kind] || ['Information', '<p>Explore the funded.vip workspace and review each transaction before signing.</p>'];
  document.querySelector('#info-title').textContent = content[0];
  document.querySelector('#info-content').innerHTML = content[1];
  document.querySelector('#info-dialog').showModal();
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
function closeDialog(id){ document.querySelector(`#${id}`)?.close(); }
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
  metricsRequest++;
  clearTimeout(launchCostRefreshTimer);
  launchCostRefreshTimer = null;
  walletBalanceLamports = null;
  estimatedLaunchFeeLamports = null;
  invalidateTradePreview();
  document.querySelector('#referral-claim-center')?.remove();
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
  const address = walletAddress(provider);
  if (!address) throw new Error('Wallet did not provide an account address.');
  if (wallet === provider && connectedWalletAddress === address) return;
  walletConnectRequest++;
  walletVersion++;
  resetWalletDependentViews();
  wallet = provider;
  connectedWalletAddress = address;
  const providerId = injectedWalletProviders().find(entry => entry.provider === provider)?.id;
  if (providerId) { try { sessionStorage.setItem(WALLET_PROVIDER_KEY, providerId); } catch {} }
  observeWalletProvider(provider);
  setWalletState(message, address, true);
}
function clearWalletState(message = 'Wallet not connected', detail = 'Connect a wallet to continue'){
  walletConnectRequest++;
  walletVersion++;
  resetWalletDependentViews();
  wallet = null;
  connectedWalletAddress = null;
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
  const launchNode = document.querySelector('#cost-launch');
  const totalNode = document.querySelector('#cost-total-enabled');
  const headlineNode = document.querySelector('#cost-total');
  const noteNode = document.querySelector('#cost-note');
  const previewLaunchNode = document.querySelector('#preview-launch-cost');
  const burnNode = document.querySelector('#cost-burn');
  const creatorBuyNode = document.querySelector('#cost-creator-buy');
  const burnPolicy = getLaunchBurnPolicy();
  const creatorBuyPercent = Number(document.querySelector('#creator-buy-percent')?.value || 0);
  const creatorBuy = { percent: Number.isFinite(creatorBuyPercent) ? creatorBuyPercent : 0, tokens: Number.isFinite(creatorBuyPercent) && creatorBuyPercent > 0 ? 1_000_000_000 * creatorBuyPercent / 100 : 0 };
  if (burnNode) burnNode.textContent = burnPolicy.requiresBurn ? `${formatLaunchBurnAmount(burnPolicy.amountTokens)} $FUNDED · irreversible` : 'None';
  if (creatorBuyNode) creatorBuyNode.textContent = creatorBuy.percent > 0
    ? `${creatorBuy.tokens.toLocaleString()} tokens · ${estimatedInitialBuyLamports > 0 ? formatLaunchCost(estimatedInitialBuyLamports) : 'quote pending'}`
    : 'None';
  if (!launchNode || !totalNode || !headlineNode || !noteNode) return;
  if (estimatedLaunchFeeLamports == null) {
    const pending = !wallet ? 'Connect wallet to estimate' : walletMetricsLoading ? 'Calculating…' : 'Estimate unavailable';
    launchNode.textContent = pending;
    totalNode.textContent = '—';
    headlineNode.textContent = '—';
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
  launchNode.textContent = launchCost;
  totalNode.textContent = launchCost;
  headlineNode.textContent = `${launchCost} now`;
  if (previewLaunchNode) previewLaunchNode.textContent = launchCost;
  noteNode.textContent = 'This is the Pump creation transaction estimate. No separate funded.vip launch fee is charged.';
}
function updatePreviewStatusDrawer(connected){
  const drawer = document.querySelector('.preview-status-drawer');
  const detail = drawer?.querySelector('small');
  if (detail) detail.textContent = `Indexer pending · Wallet ${connected ? 'connected' : 'not connected'}`;
}
function setWalletMetrics({ balance = null, fee = null, loading = false, error = '' } = {}){
  const panel = document.querySelector('#wallet-metrics');
  const note = document.querySelector('#fee-note');
  walletMetricsLoading = loading;
  walletEstimateError = loading || !wallet ? '' : String(error || '');
  if (loading) estimatedLaunchFeeLamports = null;
  if (!wallet) { walletBalanceLamports = null; estimatedLaunchFeeLamports = null; panel.hidden = true; note.hidden = true; document.querySelector('#profile-balance').textContent = 'Connect to load'; updateCostSummary(); updateLaunchButton(); return; }
  panel.hidden = false;
  note.hidden = false;
  if (!loading) { walletBalanceLamports = balance; estimatedLaunchFeeLamports = fee; }
  document.querySelector('#wallet-balance').textContent = loading ? 'Loading…' : balance == null ? 'Unavailable' : formatSol(balance);
  document.querySelector('#launch-fee').textContent = loading ? 'Calculating…' : fee == null ? 'Unavailable' : `≈ ${formatLaunchCost(fee)}`;
  document.querySelector('#profile-balance').textContent = loading ? 'Loading…' : balance == null ? 'Unavailable' : formatSol(balance);
  const headerBalance = document.querySelector('#header-wallet-balance');
  if (headerBalance) headerBalance.textContent = loading ? '… SOL' : balance == null ? '— SOL' : formatSol(balance);
  note.textContent = loading
    ? 'Checking wallet balance and estimated launch cost…'
    : balance == null || fee == null
      ? walletEstimateError
        ? `Launch estimate unavailable: ${walletEstimateError} Refresh the estimate before launching.`
        : 'Unable to verify the wallet balance and launch cost. Refresh the estimate before launching.'
      : balance < fee
        ? 'Insufficient Devnet SOL for the estimated launch cost. Use Airdrop 1 SOL or fund this wallet before launching.'
        : 'Estimate includes mint rent, token-account rent, and the current Devnet transaction fee.';
  updateLaunchButton();
  updateCostSummary();
}
function updateLaunchPreview(){
  const name = document.querySelector('#token-name').value.trim();
  const symbol = document.querySelector('#token-symbol').value.trim().toUpperCase();
  const recipient = normalizeXHandle(document.querySelector('#x-recipient').value);
  const allocation = Number(document.querySelector('#community-allocation')?.value) || 0;
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
  const buyLabel = creatorBuy.percent > 0 ? `${creatorBuy.percent.toFixed(1).replace('.0','')}% · ${creatorBuy.tokens.toLocaleString()} tokens` : 'Creation only';
  const previewBuy = document.querySelector('#preview-creator-buy');
  const reviewBuy = document.querySelector('#review-creator-buy');
  if (previewBuy) previewBuy.textContent = buyLabel;
  if (reviewBuy) reviewBuy.textContent = buyLabel;
  const buyTokensNode = document.querySelector('#creator-buy-token-amount');
  const buySolNode = document.querySelector('#creator-buy-sol-amount');
  if (buyTokensNode) buyTokensNode.textContent = creatorBuy.percent > 0 ? `${creatorBuy.tokens.toLocaleString()} tokens` : 'None';
  if (buySolNode) buySolNode.textContent = creatorBuy.percent > 0 ? 'SOL quote calculated before signing' : 'No additional SOL buy';
  const image = document.querySelector('#token-image')?.files?.[0];
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
  document.querySelector('#preview-community').textContent = allocation ? `${allocation}%` : '—';
  document.querySelector('#preview-creator-wallet-share').textContent = `${feeDistribution.creatorWalletPercent}%`;
  document.querySelector('#preview-holder-share').textContent = `${feeDistribution.holderAirdropPercent}%`;
   document.querySelector('#preview-x-share').textContent = `${feeDistribution.solClaimPercent}%`;
  document.querySelector('#preview-funded-share').textContent = `${FEE_DISTRIBUTION.fundedPercent}%`;
  const previewBurnTier = document.querySelector('#preview-burn-tier');
  if (previewBurnTier) { previewBurnTier.textContent = launchBurn.label.toUpperCase(); previewBurnTier.className = `tier-badge ${launchBurn.tier}`; }
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
        : 'Creator-directed policy totals 80%.'
      : !validation.sharesValid
        ? 'Each creator destination must be between 0% and 80%.'
        : !validation.xRecipientValid
          ? 'Enter a valid X account for the planned SOL reward.'
          : `Creator-directed allocation totals ${validation.total.toFixed(1)}%; it must equal 80%.`;
    feeStatus.className = `field-help ${validation.valid && (feeDistribution.solClaimPercent === 0 || xFeeStatus.ready) ? 'funded-mint-valid' : 'funded-mint-invalid'}`;
  }
  document.querySelector('#review-coin').textContent = name && symbol ? `${name} (${symbol})` : 'Add name and ticker';
  document.querySelector('#review-community').textContent = `${allocation}% of supply`;
  document.querySelector('#review-creator-share').textContent = `${feeDistribution.creatorWalletPercent}% of gross fees`;
  document.querySelector('#review-holder-share').textContent = `${feeDistribution.holderAirdropPercent}% of gross fees`;
   document.querySelector('#review-x-share').textContent = feeDistribution.solClaimPercent > 0 ? `${feeDistribution.solClaimPercent}% planned for ${recipient || 'missing account'} · ${xFeeStatus.ready ? 'mint-specific router' : 'unavailable'}` : 'Not selected';
  document.querySelector('#review-burn-tier').textContent = `${launchBurn.label}${launchBurn.requiresBurn ? ' · verified badge' : ' · no burn'}`;
  document.querySelector('#review-burn-amount').textContent = launchBurn.requiresBurn ? `${formatLaunchBurnAmount(launchBurn.amountTokens)} $FUNDED · atomic if it fits` : 'None';
  renderLaunchBurnSelection();
  updateLaunchNavigation();
}
function getLaunchMetadataPreview(){
  const image = document.querySelector('#token-image')?.files?.[0];
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
  const image = document.querySelector('#token-image')?.files?.[0];
  if (image && (!['image/png', 'image/jpeg', 'image/webp'].includes(image.type) || image.size > 600_000)) throw new Error('Choose a PNG, JPG, or WEBP image under 600 KB.');
  const imageBytes = image ? new Uint8Array(await image.arrayBuffer()) : null;
  const imageSha256 = imageBytes ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', imageBytes)), byte => byte.toString(16).padStart(2, '0')).join('') : '';
  const imageBase64 = imageBytes ? Buffer.from(imageBytes).toString('base64') : '';
  const canonicalUrl = value => value ? new URL(value).href : '';
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
function updateLaunchButton(){
  const button = document.querySelector('#launch-button');
  const insufficient = walletBalanceLamports != null && estimatedLaunchFeeLamports != null && walletBalanceLamports < estimatedLaunchFeeLamports;
  const balanceUnknown = wallet && (walletBalanceLamports == null || estimatedLaunchFeeLamports == null);
  const allocation = Number(document.querySelector('#community-allocation')?.value);
  const feeDistribution = validateFeeDistribution(getFeeDistributionInputs());
  const launchBurn = getLaunchBurnPolicy();
  const creatorBuyPercent = getCreatorBuyPercent();
  const buyValid = Number.isFinite(creatorBuyPercent) && creatorBuyPercent >= 0 && creatorBuyPercent <= 20;
  const burnConfigured = validateLaunchBurnPolicy(launchBurn).valid;
  const burnReady = !launchBurn.requiresBurn || launchBurnReadiness.ready;
  const xRouteReady = feeDistribution.shares.solClaimPercent === 0 || xFeeStatus.ready;
  const policyValid = Number.isFinite(allocation) && allocation >= 3 && allocation <= 50 && feeDistribution.valid && xRouteReady && feeRouterState.verified && burnConfigured && burnReady && buyValid;
  const ready = Boolean(canSignTransactions(wallet) && !walletMetricsLoading && !balanceUnknown && !insufficient && policyValid && document.querySelector('#terms-agree')?.checked && document.querySelector('#fee-route-agree')?.checked && document.querySelector('#token-name').value.trim() && document.querySelector('#token-symbol').value.trim());
  button.disabled = !ready;
  button.textContent = !xRouteReady ? 'X account rewards unavailable' : !feeRouterState.verified ? 'Fee router required' : !buyValid ? 'Creator buy must be 0–20%' : !burnConfigured ? '$FUNDED mint required' : launchBurn.requiresBurn && !burnReady ? 'Verify $FUNDED balance' : !wallet ? 'Connect wallet to launch' : !canSignTransactions(wallet) ? 'Open in wallet to sign' : walletMetricsLoading ? 'Calculating launch cost' : walletBalanceLamports == null ? 'Refresh wallet balance' : estimatedLaunchFeeLamports == null ? 'Refresh launch estimate' : insufficient ? 'Insufficient SOL for launch' : !document.querySelector('#fee-route-agree')?.checked ? 'Confirm the fee route' : !document.querySelector('#terms-agree')?.checked ? 'Agree to terms to launch' : !policyValid ? 'Complete launch policy' : ready ? 'Launch and verify' : 'Add name and ticker';
  updateLaunchNavigation();
}
function getLaunchStepState(step){
  const name = document.querySelector('#token-name').value.trim();
  const symbol = document.querySelector('#token-symbol').value.trim().toUpperCase();
  if (step === 1) {
    if (!name) return { valid: false, message: 'Enter the token name to continue.' };
    if (!/^[A-Z0-9]{1,10}$/.test(symbol)) return { valid: false, message: 'Use 1–10 letters or numbers for the ticker.' };
    return { valid: true, message: 'Coin identity is ready.' };
  }
  const allocation = Number(document.querySelector('#community-allocation').value);
  const distribution = validateFeeDistribution(getFeeDistributionInputs());
  if (step === 2) {
    if (!Number.isFinite(allocation) || allocation < 3 || allocation > 50) return { valid: false, message: 'Community allocation must be between 3% and 50%.' };
    if (!distribution.valid) {
      if (!distribution.sharesValid) return { valid: false, message: 'Each creator destination must be between 0% and 80%.' };
      if (!distribution.xRecipientValid) return { valid: false, message: 'Enter a valid X account for the planned SOL reward.' };
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
  next.hidden = launchStep === 4;
  next.disabled = !state.valid;
  next.textContent = launchStep === 3 ? 'Continue to sign' : 'Continue';
  hint.textContent = state.message;
  hint.classList.toggle('ready', state.valid);
}
function setLaunchStep(step){
  launchStep = Math.min(4, Math.max(1, Number(step) || 1));
  document.querySelectorAll('[data-launch-step]').forEach(panel => {
    const active = Number(panel.dataset.launchStep) === launchStep;
    panel.hidden = !active;
    panel.classList.toggle('active', active);
  });
  document.querySelectorAll('[data-launch-step-target]').forEach(button => {
    const target = Number(button.dataset.launchStepTarget);
    button.classList.toggle('active', target === launchStep);
    button.classList.toggle('complete', target < launchStep);
    button.setAttribute('aria-current', target === launchStep ? 'step' : 'false');
  });
  updateLaunchPreview();
  updateLaunchButton();
  document.querySelector('#launch-dialog').scrollTo({ top: 0, behavior: 'smooth' });
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
    document.querySelector('#community-allocation').value = '3';
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
function saveLaunchDraft(){
  const ids = ['token-name','token-symbol','token-description','token-tagline','token-roadmap','token-website','token-x','token-telegram','token-discord','community-allocation','creator-wallet-share','holder-airdrop-share','x-share','x-recipient','creator-buy-percent'];
  const draft = Object.fromEntries(ids.map(id => [id, document.querySelector(`#${id}`)?.value ?? '']));
  draft.profile = launchProfile;
  draft.mode = launchMode;
  try { localStorage.setItem(LAUNCH_DRAFT_KEY, JSON.stringify({ savedAt: new Date().toISOString(), ...draft })); } catch {}
  const status = document.querySelector('#draft-status');
  if (status) status.textContent = 'Draft saved locally · never sent to the chain';
}
function restoreLaunchDraft(){
  let draft = null;
  try { draft = JSON.parse(localStorage.getItem(LAUNCH_DRAFT_KEY) || 'null'); } catch {}
  if (!draft) return;
  const ids = ['token-name','token-symbol','token-description','token-tagline','token-roadmap','token-website','token-x','token-telegram','token-discord','community-allocation','creator-wallet-share','holder-airdrop-share','x-share','x-recipient','creator-buy-percent'];
  ids.forEach(id => { const node = document.querySelector(`#${id}`); if (node && typeof draft[id] === 'string') node.value = draft[id]; });
  if (draft.profile) setLaunchProfile(draft.profile);
  if (draft.mode) setLaunchMode(draft.mode);
  const status = document.querySelector('#draft-status');
  if (status) status.textContent = draft.savedAt ? `Draft restored · ${new Date(draft.savedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}` : 'Draft restored';
  updateLaunchPreview();
}
async function refreshWalletInfo(){
  clearTimeout(launchCostRefreshTimer);
  launchCostRefreshTimer = null;
  if (!wallet) { setWalletMetrics(); return; }
  const session = captureWalletSession();
  if (!session) { setWalletMetrics(); return; }
  const payer = session.provider.publicKey;
  const request = ++metricsRequest;
  setWalletMetrics({ loading: true });
  try {
    await getSolana();
    const balance = await connection.getBalance(payer, 'confirmed');
    if (request !== metricsRequest || !isWalletSessionCurrent(session)) return;
    if (!feeRouterState.verified || !feeRouterState.address) throw new Error('Fee router is not ready.');
    const [{ PUMP_SDK, OnlinePumpSdk }, { normalizeLaunchInput }, { getInitialBuyQuote, prepareFundedLaunchBurn }] = await Promise.all([import('@pump-fun/pump-sdk'), import('./launch-core.js'), import('./launch-flow.js')]);
    const { Keypair, PublicKey } = await getSolana();
    const name = document.querySelector('#token-name').value.trim() || 'Devnet Coin';
    const symbol = document.querySelector('#token-symbol').value.trim().toUpperCase() || 'COIN';
    const input = normalizeLaunchInput({ name, symbol, supply: 1_000_000_000, decimals: 6 });
    const initialBuy = await getInitialBuyQuote({ connection, input: { ...input, initialBuyPercent: getCreatorBuyPercent() } });
    estimatedInitialBuyLamports = Number(initialBuy.solAmountLamports);
    const mint = Keypair.generate();
    const isolated = getFeeDistributionInputs().solClaimPercent > 0;
    if (isolated && !xFeeStatus.ready) throw new Error('Mint-specific X fee claims are not ready on Devnet.');
    const mintRouter = isolated ? buildMintRouterInitializeInstruction({ programId: FEE_ROUTER_PROGRAM_ID, mint: mint.publicKey, payer }) : null;
    const router = mintRouter?.router.address || new PublicKey(feeRouterState.address);
    const launchInstructions = initialBuy.amountBaseUnits > 0n
      ? await PUMP_SDK.createV2AndBuyInstructions({ global: await new OnlinePumpSdk(connection).fetchGlobal(), mint: mint.publicKey, name: input.name, symbol: input.symbol, uri: `https://funded.vip/devnet-metadata/${mint.publicKey.toBase58()}`, creator: router, user: payer, amount: new (await import('bn.js')).default(initialBuy.amountBaseUnits.toString()), solAmount: new (await import('bn.js')).default(initialBuy.solAmountLamports.toString()), mayhemMode: false, cashback: false, holderReward: false })
      : [await PUMP_SDK.createV2Instruction({ mint: mint.publicKey, name: input.name, symbol: input.symbol, uri: `https://funded.vip/devnet-metadata/${mint.publicKey.toBase58()}`, creator: router, user: payer, mayhemMode: false, holderReward: false })];
    const launchBurn = getLaunchBurnPolicy();
    const burnPlan = launchBurn.requiresBurn
      ? await prepareFundedLaunchBurn({ connection, payer, fundedMint: launchBurn.fundedMint, amountTokens: launchBurn.amountTokens })
      : null;
    const latest = await connection.getLatestBlockhash('confirmed');
    const plan = buildPumpLaunchPlan({ payer, mint, blockhash: latest.blockhash, launchInstructions, burnInstruction: burnPlan?.instruction, mintRouterInstruction: mintRouter?.instruction });
    const estimateTransactions = plan.steps.map(step => step.transaction);
    // The split path still simulates every transaction; the legacy path is the original full launch simulation: connection.simulateTransaction(launchTransaction, undefined, [payer]).
    const estimates = await Promise.all(estimateTransactions.map(async transaction => {
      const transactionFee = await connection.getFeeForMessage(transaction.compileMessage(), 'confirmed');
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
    setWalletMetrics({ balance, fee: estimatedSpend });
  } catch (error) {
    if (request === metricsRequest && isWalletSessionCurrent(session)) {
      console.warn('Launch cost estimate failed:', error);
      const reason = String(error?.message || 'The exact Devnet launch cost could not be verified.').slice(0, 180);
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
  const signingReady = connected && canSignTransactions(wallet);
  const status = document.querySelector('#wallet-status');
  status.innerHTML = '<span class="status-ring"></span><span><strong></strong><small></small></span><button type="button" class="small-button" id="dialog-connect"></button>';
  status.querySelector('.status-ring').textContent = connected ? '✓' : '?';
  status.querySelector('strong').textContent = message;
  status.querySelector('small').textContent = detail;
  status.querySelector('button').textContent = connected ? 'Disconnect' : 'Connect';
  document.querySelector('#dialog-connect').addEventListener('click', connected ? disconnectWallet : connectWallet);
  const header = document.querySelector('#connect-button');
  if (connected) {
    const balance = document.createElement('span'); balance.className = 'header-wallet-balance'; balance.id = 'header-wallet-balance'; balance.textContent = '— SOL';
    const check = document.createElement('span'); check.textContent = '✓';
    header.replaceChildren(document.createTextNode(`Wallet ${connectedWalletAddress.slice(0, 4)}…${connectedWalletAddress.slice(-4)} `), balance, document.createTextNode(' '), check);
  } else {
    const arrow = document.createElement('span'); arrow.textContent = '↗';
    header.replaceChildren(document.createTextNode('Connect wallet '), arrow);
  }
  header.removeAttribute('title'); header.removeAttribute('aria-label');
  header.onclick = connected ? () => document.querySelector('#profile-dialog').showModal() : connectWallet;
  const sidebarName = document.querySelector('#sidebar-wallet-name');
  const sidebarAddress = document.querySelector('#sidebar-wallet-address');
  const sidebarAvatar = document.querySelector('#sidebar-wallet-avatar');
  if (sidebarName) sidebarName.textContent = connected ? 'Wallet connected' : 'Wallet not connected';
  if (sidebarAddress) sidebarAddress.textContent = connected ? `${connectedWalletAddress.slice(0, 4)}…${connectedWalletAddress.slice(-4)}` : 'Your wallet signs locally';
  if (sidebarAvatar) sidebarAvatar.textContent = connected ? '✓' : '◎';
  const leaderboardBadge = document.querySelector('#leaderboard-wallet-badge');
  const leaderboardTitle = document.querySelector('#leaderboard-wallet-title');
  const leaderboardDetail = document.querySelector('#leaderboard-wallet-detail');
  const leaderboardLink = document.querySelector('#leaderboard-wallet-link');
  if (leaderboardBadge) leaderboardBadge.textContent = connected ? 'Indexer pending' : 'Wallet required';
  if (leaderboardTitle) leaderboardTitle.textContent = connected ? 'Rank unavailable until activity is indexed' : 'Connect to see your rank';
  if (leaderboardDetail) leaderboardDetail.textContent = connected
    ? `Wallet ${connectedWalletAddress.slice(0, 4)}…${connectedWalletAddress.slice(-4)} connected. Verified launch, trade, and settlement activity is not indexed for rankings yet.`
    : 'Qualifying activity includes launches, verified trades, and settled referral rewards.';
  if (leaderboardLink) { leaderboardLink.href = connected ? '#docs' : '#profile'; leaderboardLink.textContent = connected ? 'View Devnet status →' : 'Connect wallet →'; }
  const profileName = document.querySelector('#profile-wallet-name');
  const profileAddress = document.querySelector('#profile-wallet-address');
  const profileAvatar = document.querySelector('#profile-wallet-avatar');
  const profileConnect = document.querySelector('#profile-connect');
  if (profileName) profileName.textContent = connected ? 'Wallet connected' : 'Wallet not connected';
  if (profileAddress) profileAddress.textContent = connected ? `${connectedWalletAddress.slice(0, 4)}…${connectedWalletAddress.slice(-4)}` : 'Your wallet signs locally';
  if (profileAvatar) profileAvatar.textContent = connected ? '✓' : '◎';
  if (profileConnect) profileConnect.textContent = connected ? 'Wallet connected' : 'Connect wallet';
  renderCreatorLaunches();
  document.querySelector('#profile-address').textContent = connected ? connectedWalletAddress : 'Not connected';
  const profileDisconnect = document.querySelector('#profile-disconnect');
  if (profileDisconnect) profileDisconnect.disabled = !connected;
  document.querySelector('#profile-status').textContent = connected ? wallet.readOnly ? 'Address linked for viewing. Open this app inside Phantom to sign transactions.' : 'Connected locally. Your wallet remains the signer; private keys do not enter this app.' : 'This profile is local to the demo workspace.';
  const profileHint = document.querySelector('#profile-wallet-hint');
  if (profileHint) profileHint.textContent = connected ? 'Connected on Solana Devnet. Review your address and balance below.' : 'Connect a wallet to show your address and Devnet balance.';
  const reviewIntro = document.querySelector('#review-wallet-intro');
  if (reviewIntro) reviewIntro.textContent = signingReady ? 'Wallet connected. Verify the launch cost and fee route before signing.' : connected ? 'Address linked for viewing. Open this app inside your wallet to sign.' : 'Connect a wallet, verify the cost, and confirm the fee route before signing.';
  const launchPathWallet = document.querySelector('#launch-path-wallet');
  if (launchPathWallet) { launchPathWallet.querySelector('strong').textContent = connected ? 'Wallet connected' : 'Connect wallet'; launchPathWallet.querySelector('small').textContent = signingReady ? 'Ready for Devnet review.' : connected ? 'Open in your wallet to sign.' : 'Your wallet signs locally.'; launchPathWallet.classList.toggle('complete', signingReady); }
  const onboardingWallet = document.querySelector('[data-onboarding-step="creator"]');
  if (onboardingWallet) { onboardingWallet.querySelector('strong').textContent = connected ? 'Wallet connected' : 'Connect your wallet'; onboardingWallet.querySelector('small').textContent = signingReady ? 'Ready to review a launch.' : connected ? 'Open in your wallet to sign.' : 'Connect to unlock your workspace.'; }
  const claimButton = document.querySelector('#sol-claim-submit');
  if (claimButton) claimButton.textContent = signingReady ? 'Verify linked wallet' : connected ? 'Open in wallet to verify' : 'Connect wallet to verify';
  const referralActivity = document.querySelector('#referral-activity-list .empty-state');
  if (referralActivity) referralActivity.textContent = connected ? 'Wallet connected. Qualified referral activity will appear when verified data is indexed.' : 'Connect a wallet to load qualified referral activity.';
  const tradeQuote = document.querySelector('#trade-quote');
  if (tradeQuote && (!connected || !signingReady || tradeQuote.textContent.startsWith('Connect your wallet'))) tradeQuote.textContent = signingReady ? 'Preview a trade to see estimated output, slippage, and fees.' : connected ? 'Open this app inside your wallet to preview and sign a trade.' : 'Connect your wallet and preview a trade to see estimated output, slippage, and fees.';
  const selectedProgram = document.querySelector('[data-program-tier="standard"].active');
  const programNote = document.querySelector('#program-progress-note');
  if (selectedProgram && programNote) programNote.textContent = signingReady ? 'Wallet connected. Review the fee route and launch cost before signing.' : connected ? 'Address linked. Open inside your wallet before signing.' : 'Connect a wallet to begin your launch review.';
  updatePreviewStatusDrawer(connected);
  if (connected) { const session = captureWalletSession(); bindAppReferralToWallet(); void syncServerReferralState().then(() => { if (isWalletSessionCurrent(session)) { updateReferralLink(); return refreshReferralClaims(); } }); }
  updateReferralLink();
  updateOnboardingProgress();
  renderAirdropClaims();
  updateLaunchButton();
  if (connected) { setWalletMetrics({ loading: true }); if (feeRouterState.status !== 'checking') refreshWalletInfo(); }
  else setWalletMetrics();
}
async function connectWallet(){
  const provider = getProvider();
  if (!provider) {
    const message = 'No injected wallet was found. Open funded.vip in Chrome or Edge with Phantom, Backpack, or Solflare installed.';
    if (!wallet) setWalletState('Wallet unavailable', message);
    setLaunchStatus('No injected Solana wallet was detected in this browser.', true);
    const header = document.querySelector('#connect-button');
    if (header) { header.title = message; header.setAttribute('aria-label', message); }
    openMobileWalletDialog();
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
async function submitSolClaim(){
  const status = document.querySelector('#sol-claim-status');
  const handle = normalizeXHandle(document.querySelector('#sol-claim-x-account')?.value);
  const claimId = String(document.querySelector('#sol-claim-id')?.value || '').trim();
  if (!handle || !claimId) { if (status) status.textContent = 'Enter an X handle and claim ID.'; return; }
  if (!wallet) { await connectWallet(); if (!wallet) return; }
  const session = captureWalletSession();
  if (!session || session.provider.readOnly || typeof session.provider.signMessage !== 'function') { if (status) status.textContent = 'This wallet cannot sign claim messages here.'; return; }
  const button = document.querySelector('#sol-claim-submit'); if (button) button.disabled = true;
  try {
    const identity = await apiRequest('/api/x/me');
    if (!identity.data?.authenticated || `@${identity.data.user.username}`.toLowerCase() !== handle.toLowerCase()) throw new Error('Sign in with the X account named in this claim first.');
    if (status) status.textContent = 'Preparing claim…';
    const prepared = await apiRequest(`/api/sol-claims/${encodeURIComponent(claimId)}/prepare`, { method: 'POST', body: { xHandle: handle } });
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
    if (status) status.textContent = `Paid ${paid.data.amountSol} SOL to ${publicKey}. Transaction: ${paid.data.signature}`;
    showToast('X creator fee claim paid');
    await refreshXClaims();
    return { verified, paid };
  } catch (error) { if (isWalletSessionCurrent(session)) { if (status) status.textContent = error.message || 'Claim failed.'; showToast(error.message || 'Claim failed'); } }
  finally { if (button) button.disabled = false; }
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
function openLaunchDialog(event){
  event?.preventDefault();
  if (location.hash !== '#launch') history.replaceState({}, document.title, `${location.pathname}${location.search}#launch`);
  syncPageRoute();
  const dialog = document.querySelector('#launch-dialog');
  if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal(); else dialog.setAttribute('open', '');
  setLaunchStep(1);
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
  if (!wallet) { await connectWallet(); if (!wallet) return; }
  const session = captureWalletSession();
  if (!session || !canSignTransactions(session.provider)) { setLaunchStatus('Open this app inside a signing wallet to launch.', true); return; }
  const name = document.querySelector('#token-name').value.trim(); const symbol = document.querySelector('#token-symbol').value.trim().toUpperCase(); const supply = Number(document.querySelector('#token-supply').value); const decimals = Number(document.querySelector('#token-decimals').value);
  const metadataPreview = getLaunchMetadataPreview();
  const communityAllocation = Number(document.querySelector('#community-allocation').value);
  const xRecipient = normalizeXHandle(document.querySelector('#x-recipient').value);
  const fundedMint = getFundedMintAddress();
  const launchBurn = getLaunchBurnPolicy();
  const launchBurnValidation = validateLaunchBurnPolicy(launchBurn);
  const feeDistributionInput = getFeeDistributionInputs();
  const feeDistribution = validateFeeDistribution(feeDistributionInput);
  if (!document.querySelector('#fee-route-agree').checked) { setLaunchStatus('Confirm the funded.vip creator-fee route before launching.', true); return; }
  if (!document.querySelector('#terms-agree').checked) { setLaunchStatus('Agree to the Terms of Use before launching.', true); return; }
  if (!name || !symbol || !Number.isFinite(supply) || supply < 1 || decimals < 0 || decimals > 9) { setLaunchStatus('Enter a valid name, ticker, supply, and decimals.', true); return; }
  if (!Number.isFinite(communityAllocation) || communityAllocation < 3 || communityAllocation > 50) { setLaunchStatus('Community allocation must be between 3% and 50%.', true); return; }
   if (feeDistributionInput.solClaimPercent > 0 && !/^@[A-Za-z0-9_]{1,15}$/.test(xRecipient)) { setLaunchStatus('Enter a valid X handle such as @account when X account rewards are above 0%.', true); return; }
  if (feeDistributionInput.solClaimPercent > 0 && !xFeeStatus.ready) { setLaunchStatus(`X account rewards unavailable: ${xFeeStatus.reasons.join('; ')}.`, true); return; }
  if (!feeDistribution.valid) { setLaunchStatus('Creator fee shares must total exactly 80%. Check the wallet, holder, and X percentages.', true); return; }
  if (!launchBurnValidation.valid) { setLaunchStatus('The fixed $FUNDED mint must be configured before a paid launch tier can be used.', true); return; }
  if (launchBurn.requiresBurn && !launchBurnReadiness.ready) { setLaunchStatus(launchBurnReadiness.message, true); return; }
  if (!feeRouterState.verified || !feeRouterState.address) { setLaunchStatus('Launch blocked until the funded.vip fee-router PDA is deployed and verified on Devnet.', true); return; }
  if (walletBalanceLamports == null || estimatedLaunchFeeLamports == null) { setLaunchStatus('Wallet balance and launch cost could not be verified. Refresh the estimate before signing.', true); return; }
  if (walletBalanceLamports != null && estimatedLaunchFeeLamports != null && walletBalanceLamports < estimatedLaunchFeeLamports) { setLaunchStatus('Insufficient Devnet SOL for this launch. Fund the wallet, then refresh the balance and fee estimate before signing.', true); return; }
  const launchButton = document.querySelector('#launch-button'); launchButton.disabled = true;
  try {
    const [{ submitPumpDevnetLaunch }, { devnetExplorer }] = await Promise.all([import('./launch-flow.js'), import('./launch-core.js')]);
    assertWalletSessionCurrent(session);
    const creatorBuyPercent = getCreatorBuyPercent();
    if (!Number.isFinite(creatorBuyPercent) || creatorBuyPercent < 0 || creatorBuyPercent > 20) { setLaunchStatus('Creator buy must be between 0% and 20% of supply.', true); return; }
    const isolated = feeDistributionInput.solClaimPercent > 0;
    let xUserId = null;
    if (isolated) {
      setLaunchStatus('Resolving the X account to its stable user ID before signing…');
      const resolved = await apiRequest(`/api/x/resolve?handle=${encodeURIComponent(xRecipient)}`);
      assertWalletSessionCurrent(session);
      if (!resolved.available || !/^\d{1,24}$/.test(String(resolved.data?.id || '')) || resolved.data.handle.toLowerCase() !== xRecipient.toLowerCase()) throw new Error('X account identity could not be verified before launch. No coin transaction was sent.');
      xUserId = resolved.data.id;
    }
    const result = await submitPumpDevnetLaunch({ connection, provider: session.provider, payer: session.provider.publicKey, input: { name, symbol, supply, decimals, initialBuyPercent: creatorBuyPercent }, prepareMetadata: input => prepareLaunchMetadata(input, session), feeRouterAddress: feeRouterState.address, feeRouterProgramId: FEE_ROUTER_PROGRAM_ID, useMintRouter: isolated, launchBurn, assertWalletCurrent: () => assertWalletSessionCurrent(session), onStatus: message => { if (isWalletSessionCurrent(session)) setLaunchStatus(message); } });
    const routeAddress = result.feeRouter.toBase58();
    const routeState = isolated ? { ...feeRouterState, ...deriveMintFeeRouter(FEE_ROUTER_PROGRAM_ID, result.mint.publicKey), address: routeAddress, scope: 'per-mint-v2' } : feeRouterState;
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
      ...(isolated ? { xUserId } : {}),
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
        scope: isolated ? 'per-mint-v2' : 'shared-legacy',
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
    try {
      assertWalletSessionCurrent(session);
      if (typeof session.provider.signMessage !== 'function') throw new Error('Wallet message signing is required to register the immutable launch policy.');
      const policySignature = await session.provider.signMessage(new TextEncoder().encode(launchPolicyStatement(launchPolicy)));
      assertWalletSessionCurrent(session);
      launchPolicy.policySignature = bs58.encode(policySignature.signature || policySignature);
      localStorage.setItem(`funded.launch.${launchPolicy.mint}`, JSON.stringify(launchPolicy));
      persistedLaunch = await persistLaunchPolicy(launchPolicy);
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
    showToast(persistedLaunch.available ? `${result.symbol} launched and listed in Explore` : `${result.symbol} launched on-chain; Explore listing is pending API verification`); renderAirdropClaims(); refreshWalletInfo();
  } catch (error) { if (isWalletSessionCurrent(session)) setLaunchStatus(`Launch failed: ${error.message}`, true); } finally { updateLaunchButton(); }
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

document.querySelector('#connect-button').onclick = connectWallet;
document.querySelector('#profile-connect')?.addEventListener('click', connectWallet);
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || !/^connect wallet/i.test(button.textContent.trim())) return;
  if (['connect-button', 'dialog-connect', 'coin-trade-button', 'trade-submit', 'launch-button', 'airdrop-button'].includes(button.id)) return;
  event.preventDefault();
  connectWallet();
});
document.querySelector('#mobile-wallet-close')?.addEventListener('click', () => closeDialog('mobile-wallet-dialog'));
document.querySelector('#mobile-wallet-open')?.addEventListener('click', openPhantomMobileBrowser);
document.querySelector('#mobile-wallet-copy')?.addEventListener('click', async () => { const link = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname) ? window.location.href : buildPhantomConnectRequest(); try { await navigator.clipboard.writeText(link); showToast('Phantom connection link copied'); } catch { showToast(link); } });
document.querySelector('#launch-close').addEventListener('click', () => {
  closeDialog('launch-dialog');
  if (location.hash === '#launch') {
    history.replaceState({}, document.title, `${location.pathname}${location.search}#overview`);
    syncPageRoute();
  }
});
document.querySelector('#dialog-connect').addEventListener('click', connectWallet);
document.querySelector('#airdrop-button').addEventListener('click', requestAirdrop);
document.querySelector('#refresh-wallet').addEventListener('click', refreshWalletInfo);
document.querySelectorAll('#token-name, #token-symbol, #token-description, #token-tagline, #token-roadmap, #token-website, #token-x, #token-telegram, #token-discord, #x-recipient, #creator-buy-percent').forEach(input => input.addEventListener('input', () => { updateLaunchPreview(); updateLaunchButton(); if (input.matches('#token-name, #token-symbol')) scheduleLaunchCostRefresh(); if (input.matches('#creator-buy-percent')) scheduleLaunchCostRefresh(); }));
document.querySelector('#token-image')?.addEventListener('change', event => {
  const file = event.target.files?.[0];
  const preview = document.querySelector('#token-image-preview');
  if (!preview) return;
  if (!file) { preview.textContent = '⌁'; preview.style.backgroundImage = ''; return; }
  const reader = new FileReader();
  reader.addEventListener('load', () => { preview.textContent = ''; preview.style.backgroundImage = `url(${reader.result})`; });
  reader.readAsDataURL(file);
});
document.querySelector('#terms-agree').addEventListener('change', updateLaunchButton);
document.querySelector('#fee-route-agree').addEventListener('change', updateLaunchButton);
document.querySelector('#launch-next').addEventListener('click', () => { const state = getLaunchStepState(launchStep); if (state.valid && launchStep < 4) setLaunchStep(launchStep + 1); });
document.querySelector('#launch-back').addEventListener('click', () => setLaunchStep(launchStep - 1));
document.querySelector('#launch-mode-quick').addEventListener('click', () => setLaunchMode('quick'));
document.querySelector('#launch-mode-custom').addEventListener('click', () => setLaunchMode('custom'));
document.querySelectorAll('[data-launch-profile]').forEach(card => card.addEventListener('click', () => setLaunchProfile(card.dataset.launchProfile)));
setLaunchProfile('community');
document.querySelector('#save-launch-draft')?.addEventListener('click', saveLaunchDraft);
restoreLaunchDraft();
document.querySelectorAll('[data-burn-tier]').forEach(button => button.addEventListener('click', () => setLaunchBurnTier(button.dataset.burnTier)));
document.querySelectorAll('[data-launch-step-target]').forEach(button => button.addEventListener('click', () => { const target = Number(button.dataset.launchStepTarget); if (target < launchStep) setLaunchStep(target); else if (target === launchStep + 1 && getLaunchStepState(launchStep).valid) setLaunchStep(target); }));
document.querySelectorAll('[data-copy-referral-link]').forEach(button => button.addEventListener('click', async () => { const code = getReferralCode(); if (!code) { showToast('Connect your wallet to generate your invite link'); await connectWallet(); return; } const link = buildReferralUrl(code); try { await navigator.clipboard.writeText(link); trackReferralEvent('invite_link_copied'); showToast('Invite link copied'); } catch { showToast(link); } }));
document.querySelector('#referral-share-native')?.addEventListener('click', async () => { const code = getReferralCode(); if (!code) { await connectWallet(); return; } const link = buildReferralUrl(code); if (navigator.share) { try { await navigator.share({ title: 'Join funded.app', text: 'Launch with a transparent creator-fee route.', url: link }); trackReferralEvent('referral_command_center_shared'); } catch {} } else { try { await navigator.clipboard.writeText(link); showToast('Invite link copied'); } catch { showToast(link); } } });
document.querySelector('#referral-copy-code')?.addEventListener('click', async () => { const code = getReferralCode(); if (!code) { await connectWallet(); return; } try { await navigator.clipboard.writeText(code); showToast('Referral code copied'); } catch { showToast(code); } });
document.querySelectorAll('[data-referral-campaign]').forEach(button => button.addEventListener('click', async () => { const code = getReferralCode(); if (!code) { await connectWallet(); return; } const channel = button.dataset.referralCampaign; const link = buildReferralUrl(code, channel); try { await navigator.clipboard.writeText(link); trackReferralEvent('campaign_link_copied', { channel }); showToast(`${channel} campaign link copied`); } catch { showToast(link); } }));
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
    const code = getReferralCode();
    if (!code) { showToast('Connect your wallet to share an invite'); return; }
    const link = `${window.location.origin}${window.location.pathname}?ref=${code}`;
    const text = 'Launch a coin on funded.vip and grow with a transparent creator-fee model.';
    if (navigator.share) { try { await navigator.share({ title: 'Join funded.vip', text, url: link }); trackReferralEvent('invite_shared'); } catch {} }
    else { trackReferralEvent('invite_shared_x'); window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(link)}`, '_blank', 'noopener,noreferrer'); }
  });
  const messageButton = document.createElement('button');
  messageButton.type = 'button'; messageButton.className = 'secondary-button'; messageButton.textContent = 'Copy message';
  messageButton.addEventListener('click', async () => {
    const code = getReferralCode();
    if (!code) { showToast('Connect your wallet to create an invite message'); return; }
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
document.querySelector('#community-allocation').addEventListener('input', updateLaunchPolicyControls);
document.querySelectorAll('#creator-wallet-share, #holder-airdrop-share, #x-share, #x-recipient').forEach(input => input.addEventListener('input', updateLaunchPolicyControls));
document.querySelectorAll('[data-info]').forEach(link => link.addEventListener('click', event => { event.preventDefault(); openInfoDialog(link.dataset.info); }));
document.querySelector('#info-close').addEventListener('click', () => closeDialog('info-dialog'));
document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => closeDialog(button.dataset.closeDialog)));
document.querySelector('#open-tape').addEventListener('click', () => document.querySelector('#payment-dialog').showModal());
document.querySelector('.notification').addEventListener('click', () => document.querySelector('#notification-dialog').showModal());
document.querySelector('.profile-row').addEventListener('click', event => { event.preventDefault(); document.querySelector('#profile-dialog').showModal(); });
document.querySelector('#profile-disconnect')?.addEventListener('click', async () => {
  await disconnectWallet();
  document.querySelector('#profile-dialog')?.close();
});
document.querySelector('#profile-copy-address')?.addEventListener('click', async () => {
  const address = connectedWalletAddress;
  if (!address) return showToast('Connect your wallet to copy its address');
  try { await navigator.clipboard.writeText(address); showToast('Wallet address copied'); } catch { showToast(address); }
});
document.querySelector('#launch-button').addEventListener('click', launchToken);
document.querySelector('#simulate-button').addEventListener('click', simulateLaunch);
document.querySelector('#trade-preview')?.addEventListener('click', previewTrade);
document.querySelector('#trade-submit')?.addEventListener('click', executeTrade);
document.querySelector('#sol-claim-submit')?.addEventListener('click', submitSolClaim);
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
  setTradeStatus(`Enter a ${side === 'buy' ? 'SOL' : 'token'} amount, then preview a fresh quote.`);
}));
document.querySelectorAll('[data-coin-buy-amount]').forEach(button => button.addEventListener('click', () => {
  if (document.querySelector('#trade-side')?.value !== 'buy') return;
  const amount = document.querySelector('#trade-amount');
  if (!amount) return;
  amount.value = button.dataset.coinBuyAmount;
  amount.dispatchEvent(new Event('input', { bubbles: true }));
  setTradeStatus('Quick amount selected. Preview a fresh quote before signing.');
}));
document.querySelector('#trade-mint')?.addEventListener('change', () => setTradeStatus('Mint selected. Preview a trade for a fresh route and quote.'));
document.querySelectorAll('#trade-mint, #trade-amount, #trade-slippage, #trade-side').forEach(input => input.addEventListener('input', invalidateTradePreview));
updateTradeAmountLabel();
normalizePreviewLabels();
const pendingTradeMint = sessionStorage.getItem('funded.pendingTradeMint');
if (pendingTradeMint && document.querySelector('#trade-mint')) {
  document.querySelector('#trade-mint').value = pendingTradeMint;
  sessionStorage.removeItem('funded.pendingTradeMint');
  setTradeStatus('Mint selected. Preview a trade for a fresh route and quote.');
  setTimeout(() => document.querySelector('#trade-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
}
document.querySelectorAll('a[href="#launch"]').forEach(link => link.addEventListener('click', openLaunchDialog));
document.querySelector('#launch-form').addEventListener('submit', event => event.preventDefault());
function updateExploreViews(){ renderExploreAssets(); renderRegistry(); }
function clearExploreFilters(){
  exploreQuery = '';
  exploreRisk = 'all';
  exploreStage = 'all';
  exploreAuthority = 'all';
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
  document.querySelector('#explore-sort').value = exploreSort;
  document.querySelectorAll('[data-explore-stage]').forEach(button => { const active = button.dataset.exploreStage === exploreStage; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  document.querySelectorAll('.explore-tabs [data-explore-tab]').forEach(button => { const active = button.dataset.exploreTab === exploreTab; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  updateExploreViews();
  refreshExploreFeedForSort();
}
function refreshExploreFeedForSort(){
  const required = exploreSort === 'newest' ? 'created_timestamp' : 'last_trade_timestamp';
  if (exploreFeedSort !== required) loadOnchainExploreData().catch(() => showToast('Launch feed could not refresh.'));
}
function readOptionalSolFilter(selector){
  const value = document.querySelector(selector)?.value.trim();
  if (!value) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
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
document.querySelector('#explore-search')?.addEventListener('input', event => { exploreQuery = event.target.value; updateExploreViews(); });
document.querySelector('#explore-refresh')?.addEventListener('click', async event => { const button = event.currentTarget; button.disabled = true; try { await loadOnchainExploreData(); await renderStonkEnhancements(); } catch { showToast('Refresh could not verify Devnet data.'); } finally { button.disabled = false; } });
document.querySelector('#explore-sort')?.addEventListener('change', event => { exploreSort = event.target.value; updateExploreViews(); refreshExploreFeedForSort(); });
document.querySelector('#explore-risk-filter')?.addEventListener('change', event => { exploreRisk = event.target.value; updateExploreViews(); });
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
  const value = readOptionalSolFilter('#explore-min-trades');
  exploreMinTrades = value != null && Number.isInteger(value) ? value : null;
  updateExploreViews();
});
document.querySelector('#explore-min-traders')?.addEventListener('input', () => {
  const value = readOptionalSolFilter('#explore-min-traders');
  exploreMinTraders = value != null && Number.isInteger(value) ? value : null;
  updateExploreViews();
});
document.querySelector('#explore-clear-filters')?.addEventListener('click', () => clearExploreFilters());
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
  const compare = event.target.closest('[data-compare-mint]');
  const share = event.target.closest('.share-asset');
  const trade = event.target.closest('[data-trade-mint]');
  const emptyAction = event.target.closest('[data-explore-empty-action]');
  if (emptyAction) { if (emptyAction.dataset.exploreEmptyAction === 'clear') clearExploreFilters(); else document.querySelector('#explore-refresh')?.click(); return; }
  if (compare) { toggleExploreComparison(compare.dataset.compareMint); return; }
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
  const button = event.target.closest('[data-remove-watch]');
  if (!button) return;
  saveWatchlist(getWatchlist().filter(item => item !== button.dataset.removeWatch));
  updateExploreViews();
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
document.querySelector('#airdrop-search')?.addEventListener('input', () => renderAirdropDirectory());
document.querySelector('#airdrop-sort')?.addEventListener('change', () => renderAirdropDirectory());
document.querySelector('#airdrop-directory')?.addEventListener('click', event => {
  const button = event.target.closest('[data-directory-symbol]');
  if (!button) return;
  const symbol = button.dataset.directorySymbol;
  document.querySelector('#airdrop-search').value = symbol;
  renderAirdropDirectory();
  document.querySelector('#airdrops').scrollIntoView({ behavior: 'smooth', block: 'start' });
  showToast(wallet ? `${symbol} selected — checking eligibility for your connected wallet` : `${symbol} selected — connect your wallet to verify eligibility`);
});
document.querySelector('#leaderboard-sort')?.addEventListener('change', () => renderAirdropAnalytics());
document.querySelector('#leaderboard-private')?.addEventListener('change', () => renderAirdropAnalytics());
document.querySelector('#airdrop-export-csv')?.addEventListener('click', exportAirdropCsv);
document.querySelector('#toggle-airdrop-wizard')?.addEventListener('click', event => {
  const wizard = document.querySelector('#airdrop-wizard');
  if (!wizard) return;
  wizard.hidden = !wizard.hidden;
  event.currentTarget.textContent = wizard.hidden ? 'Open wizard' : 'Close wizard';
});
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
  if (!draft.name || !draft.symbol || draft.allocationPercent < 3 || draft.allocationPercent > 50) {
    document.querySelector('#wizard-status').textContent = 'Add a token name, symbol, and allocation between 3% and 50%.';
    return;
  }
  localStorage.setItem('funded.airdrop.draft', JSON.stringify(draft));
  document.querySelector('#wizard-status').textContent = `Draft saved locally for ${draft.name} (${draft.symbol}). Production publishing is not connected.`;
  showToast('Airdrop draft saved locally');
});
document.querySelector('#buyback-add-claim')?.addEventListener('click', recordBuybackPreviewClaim);
document.querySelector('#buyback-run-preview')?.addEventListener('click', runBuybackPreview);
document.querySelector('#buyback-example-fees')?.addEventListener('input', renderBuybackExample);
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
  const compare = event.target.closest('[data-compare-mint]');
  if (compare) { toggleExploreComparison(compare.dataset.compareMint); return; }
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
document.querySelector('#explore-compare')?.addEventListener('click', event => {
  const remove = event.target.closest('[data-compare-remove]');
  if (remove) { toggleExploreComparison(remove.dataset.compareRemove); return; }
  if (event.target.closest('#explore-compare-clear')) { exploreCompareMints = []; renderExploreComparison(); }
});
document.querySelectorAll('.quick-card, .text-button').forEach(el => el.addEventListener('click', () => { if (el.classList.contains('text-button')) showToast('View updated.'); }));
document.querySelectorAll('.segmented button:not(.explore-tabs button):not(.registry-order button):not(.explore-timeframe button):not(.explore-view-switch button)').forEach(button => button.addEventListener('click', () => { button.parentElement.querySelector('.active')?.classList.remove('active'); button.classList.add('active'); showToast(`${button.textContent} view selected`); }));
  document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => openFilterDialog(button)));
  document.querySelectorAll('.recipient-chip').forEach(button => button.addEventListener('click', () => { button.parentElement.querySelector('.active')?.classList.remove('active'); button.classList.add('active'); showToast(`${button.textContent} recipients selected`); }));
document.querySelector('#filter-close').addEventListener('click', () => closeDialog('filter-dialog'));
document.querySelector('#notifications-button').addEventListener('click', () => document.querySelector('#notification-dialog').showModal());
document.querySelector('#capital-flow .icon-button')?.addEventListener('click', () => openInfoDialog('capital'));
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
function requestedPageRoute(){
  if (/^\/explore\/?$/.test(location.pathname)) return 'explore';
  const hash = location.hash.replace(/^#/, '');
  if (hash === 'overview' || hash === '') return 'overview';
  if (hash.startsWith('coin/')) return 'overview';
  if (hash === 'referral-faq') return 'referrals';
  return pageRouteTargets[hash] ? hash : 'overview';
}
const routeGuideCopy = {
  payments: { group: 'Workspace', state: 'Verified receipts only', description: 'Follow claims from fee collection to recipient payout. Amounts stay unavailable until a confirmed receipt is indexed.', primary: ['View analytics', '#analytics-detail'], secondary: ['How claims work', '#docs'] },
  'analytics-detail': { group: 'Workspace', state: 'Indexer pending', description: 'Separate published policy from measured activity. Unverified totals are intentionally left blank.', primary: ['See capital flow', '#capital-flow'], secondary: ['Explore launches', '#explore'] },
  'my-launches': { group: 'Build', state: 'Local workspace', description: 'Review launches associated with this wallet and return to the launch console when you are ready.', primary: ['Create a coin', '#launch'], secondary: ['Launch guide', '#docs'] },
  referrals: { group: 'Growth', state: 'Preview attribution', description: 'Share an invite, inspect qualified activity, and distinguish example rewards from verified payouts.', primary: ['How rewards work', '#referral-faq'], secondary: ['Explore launches', '#explore'] },
  community: { group: 'Growth', state: 'Watchlist saved locally', description: 'Keep a focused list of verified launches. Alerts wait for indexed on-chain events.', primary: ['Find launches', '#explore'], secondary: ['See airdrops', '#airdrops'] },
  leaderboard: { group: 'Growth', state: 'Indexer pending', description: 'Future rankings will use confirmed Devnet activity. The current rows are examples until the ranking index is live.', primary: ['Explore launches', '#explore'], secondary: ['View Devnet status', '#docs'] },
  airdrops: { group: 'Growth', state: 'Proof required', description: 'Check distribution status and wallet eligibility before any claim. A snapshot alone is not a payout.', primary: ['Explore launches', '#explore'], secondary: ['Claim guide', '#docs'] },
  buybacks: { group: 'Growth', state: 'Policy preview', description: 'Review the planned allocation and burn trail. Execution remains unavailable without verified receipts.', primary: ['Follow capital flow', '#capital-flow'], secondary: ['Protocol guide', '#docs'] },
  'capital-flow': { group: 'Protocol', state: 'Example calculator', description: 'Trace the published split for an example claim. The calculator does not represent settled funds.', primary: ['View payments', '#payments'], secondary: ['Read the policy', '#docs'] },
  docs: { group: 'Protocol', state: 'Devnet guide', description: 'Start with the launch, wallet, and fee-route guides, then inspect the related workspace page.', primary: ['Open launch', '#launch'], secondary: ['See capital flow', '#capital-flow'] },
  privacy: { group: 'Protocol', state: 'Information', description: 'Review how this preview handles wallet and browser data.', primary: ['Wallet profile', '#profile'], secondary: ['Back to overview', '#overview'] },
  paid: { group: 'Protocol', state: 'Policy preview', description: 'Understand $FUNDED utility and what is available in the current Devnet preview.', primary: ['See buybacks', '#buybacks'], secondary: ['Read the docs', '#docs'] },
};
function syncPageRoute(){
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
  const copy = {
    overview: ['Overview', 'Verified activity and next steps'],
    explore: ['Explore', 'Verified launches and market signals'],
    payments: ['Payments', 'Claims and payout receipts'],
    'analytics-detail': ['Analytics', 'Protocol flow and indexed activity'],
    launch: ['Launch', 'Create and review a Devnet coin'],
    'my-launches': ['My launches', 'Creator workspace'],
    referrals: ['Referrals', 'Track qualified growth'],
    community: ['Community', 'Watchlist and verified signals'],
    leaderboard: ['Leaderboard', 'Ranked community contribution'],
    airdrops: ['Airdrops', 'Eligibility and claim records'],
    buybacks: ['Buybacks', 'Policy preview and burn receipts'],
    'capital-flow': ['Capital flow', 'Follow the published allocation'],
    docs: ['Docs', 'Guides, safety, and disclosures'],
    profile: ['Profile', 'Wallet and signing safety'],
    privacy: ['Privacy', 'Wallet and browser data'],
    paid: ['$FUNDED', 'Token policy and availability'],
  }[route] || ['Overview', 'Verified activity and next steps'];
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
  if (location.hash === '#referral-faq') requestAnimationFrame(() => {
    const faq = document.querySelector('#referral-faq');
    if (faq) faq.tabIndex = -1;
    faq?.scrollIntoView({ block: 'start', behavior: 'auto' });
    faq?.focus({ preventScroll: true });
  });
  else if (route !== 'overview') window.scrollTo({ top: 0, behavior: 'auto' });
}
document.querySelectorAll('.nav-item, .profile-row').forEach(item => item.addEventListener('click', () => setMenuOpen(false)));
syncPageRoute();
document.querySelectorAll('a[href^="#"]').forEach(link => link.addEventListener('click', () => { if (link.getAttribute('href') !== '#launch' && !link.dataset.info) closeDialog('launch-dialog'); }));
window.addEventListener('hashchange', () => { if (location.hash !== '#launch') closeDialog('launch-dialog'); syncPageRoute(); });
const existingProvider = getProvider();
if (existingProvider?.isConnected && walletAddress(existingProvider) && !wasWalletManuallyDisconnected()) activateWallet(existingProvider);
if (!wallet) await restoreTrustedPhantomWallet();
if (!wallet) await connectDevWallet();
await handlePhantomMobileCallback();
captureAppReferral();
bindAppReferralToWallet();
updateReferralLink();
updateOnboardingProgress();
renderAirdropClaims();
renderCreatorLaunches();
loadVerifiedLaunchPolicies().catch(() => {});
setInterval(() => { if (!document.hidden) loadVerifiedLaunchPolicies().catch(() => {}); }, 60_000);
renderBuybackDashboard();
renderFeeFlowCalculator();
await refreshFeeRouterConfig();
await refreshXFeeStatus();
renderLaunchBurnSelection();
updateLaunchPreview();
updateCostSummary();
updateLaunchButton();
observeWalletProvider(getProvider());
window.addEventListener('focus', reconcileWalletState);
document.addEventListener('visibilitychange', () => { if (!document.hidden) reconcileWalletState(); });
if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') document.querySelector('#simulate-button').hidden = true;

// Token detail route. Every displayed value comes from Solana RPC or the Pump
// bonding-curve account. Values that require an off-chain indexer stay explicit.
const TOKEN_METADATA_PROGRAM_ID = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';
let coinActivity = { status: 'loading', collections: [], claims: [], accounts: [] };
let coinMarketActivity = { status: 'loading', trades: [], coverage: null, decimals: 6 };
let coinSolUsdPrice = null;
renderExploreAssets();
renderStonkEnhancements();
let coinSolUsdValues = { spot: NaN, marketCap: NaN, reserve: NaN };
let coinChatMessages = [];
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
  if (!address) { route.innerHTML = '<strong>No Pump curve creator</strong><small>Creator wallet unavailable from this RPC snapshot</small>'; return; }
  const safe = escapeHtml(address);
  route.innerHTML = `<strong>Creator wallet</strong><a class="coin-creator-link" href="/wallet/${encodeURIComponent(address)}">${safe}</a><button type="button" class="copy-creator-wallet" id="coin-copy-creator" aria-label="Copy creator wallet">⧉</button><small>Derived from the bonding-curve account</small>`;
}
function renderCoinCreatorHeader(address){
  const link = document.querySelector('#coin-creator-by');
  if (!link) return;
  if (!address) { link.hidden = true; link.removeAttribute('href'); return; }
  link.textContent = `by ${shortAddress(address)}`;
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
  setCoinField('#wallet-page-address', address || 'Wallet address unavailable');
  const explorer = document.querySelector('#wallet-explorer-link');
  if (explorer) { explorer.href = address ? exploreExplorer(`address/${encodeURIComponent(address)}`) : '#'; explorer.hidden = !address; }
  window.scrollTo({ top: 0, behavior: 'smooth' });
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
  setCoinField('#coin-spot-price', formatCoinUsd(coinSolUsdValues.spot));
  setCoinField('#coin-liquidity', formatCoinUsd(coinSolUsdValues.reserve));
  if (Number.isFinite(Number(coinMarketActivity.volume24hSol))) setCoinField('#coin-volume', formatExploreUsd(coinMarketActivity.volume24hSol, { partial: coinMarketActivity.coverage === 'partial' }));
  renderCoinPricePath(); renderCoinPulse(); renderCoinActivityTab();
  renderExploreAssets(); renderRegistry(); renderHomeLaunchBoard();
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
function renderCoinAccountDistribution(distribution, sampleCount = 0){
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
  setCoinField('#coin-distribution-note', `Top ${sampleCount} token accounts only · ${formatOnChainNumber(distribution.outsideSampleShare, 2)}% outside sample. Pool accounts after graduation are not classified.`);
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
  panel.innerHTML = `<div class="coin-price-path-head"><span>Observed ${Number.isFinite(coinSolUsdPrice) ? 'USD' : 'SOL'} per token</span><strong>${escapeHtml(formatCoinUsd(path.latest))}</strong></div><svg viewBox="0 0 600 190" role="img" aria-label="Price path from ${path.count} confirmed Pump bonding-curve trade observations" preserveAspectRatio="none"><path class="coin-path-area" d="${path.area}"/><path class="coin-path-line" d="${path.line}"/><circle cx="${path.lastPoint.x.toFixed(1)}" cy="${path.lastPoint.y.toFixed(1)}" r="4"/></svg><div class="coin-price-path-range"><span>Low <b>${escapeHtml(formatCoinUsd(path.low))}</b></span><span>High <b>${escapeHtml(formatCoinUsd(path.high))}</b></span></div><div class="coin-price-path-times"><span>${escapeHtml(timeLabel(path.firstBlockTime))}</span><span>${escapeHtml(timeLabel(path.lastBlockTime))}</span></div><p>Latest ${path.count} confirmed Pump curve trades only · not candles or continuous history${coinMarketActivity.coverage === 'partial' ? ' · partial RPC coverage' : ''}.</p>`;
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
    holders: `Top holders ${coinActivity.accountAvailable ? coinActivity.accounts.length : '—'}`,
  };
  document.querySelectorAll('[data-coin-tab]').forEach(item => {
    item.textContent = labels[item.dataset.coinTab] || item.textContent;
    item.setAttribute('aria-selected', String(item.classList.contains('active')));
    item.tabIndex = item.classList.contains('active') ? 0 : -1;
  });
}
function renderCoinChat(activity){
  const messages = coinChatMessages;
  const identity = connectedWalletAddress || 'Guest';
  const chatAuthorLabel = author => author === 'Guest' || !author ? 'Guest' : shortAddress(author);
  const rows = messages.length ? messages.map(item => `<div class="coin-chat-message"><div class="coin-chat-message-head"><strong>${escapeHtml(chatAuthorLabel(item.author))}</strong><time>${escapeHtml(new Date(item.createdAt).toLocaleString())}</time></div><p>${escapeHtml(item.text)}</p></div>`).join('') : '<div class="empty-state coin-activity-empty"><strong>Start the conversation</strong><small>Discuss the chart, the launch, or what you are watching. Messages are saved in this browser for this token.</small></div>';
  activity.innerHTML = `<div class="coin-chat"><div class="coin-chat-intro"><div><strong>${escapeHtml(coinActivity.symbol || 'Token')} chat</strong><small>Community notes for this token</small></div><span>${messages.length} message${messages.length === 1 ? '' : 's'}</span></div><div class="coin-chat-messages">${rows}</div><form class="coin-chat-form" id="coin-chat-form"><label><span class="sr-only">Message</span><input id="coin-chat-input" maxlength="280" autocomplete="off" placeholder="Say something about this token…" required /></label><button class="primary-button" type="submit">Send</button></form><small class="coin-chat-note">Posting as ${escapeHtml(identity === 'Guest' ? 'Guest' : shortAddress(identity))} · server-backed chat</small></div>`;
}
function renderCoinCommunityPanel(){
  const feed = document.querySelector('#coin-community-feed');
  if (!feed) return;
  const authorLabel = author => author === 'Guest' || !author ? 'Guest' : shortAddress(author);
  feed.innerHTML = coinChatMessages.length
    ? coinChatMessages.slice(-12).map(item => `<article class="coin-community-message"><div><strong>${escapeHtml(authorLabel(item.author))}</strong><time>${escapeHtml(new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</time></div><p>${escapeHtml(item.text)}</p></article>`).join('')
    : '<div class="empty-state coin-activity-empty"><strong>No community messages yet</strong><small>Start the conversation around this token.</small></div>';
}
function ensureCoinCommunityPanel(){
  const layout = document.querySelector('.coin-layout');
  if (!layout || layout.querySelector('.coin-community-panel')) return;
  const panel = document.createElement('aside');
  panel.className = 'panel coin-community-panel';
  panel.innerHTML = '<div class="coin-community-head"><div><p class="eyebrow">Community</p><h2>Chat</h2></div><span class="data-badge">LIVE</span></div><div id="coin-community-feed" class="coin-community-feed"></div><form class="coin-chat-form coin-community-form" id="coin-community-form"><label><span class="sr-only">Message</span><input id="coin-community-input" maxlength="280" autocomplete="off" placeholder="Write a message…" required /></label><button class="primary-button" type="submit">Send</button></form><small class="coin-chat-note">Server-backed token chat</small>';
  layout.prepend(panel);
  renderCoinCommunityPanel();
}
async function loadCoinChat(mintAddress, loadId = coinLoadId){
  coinChatMessages = [];
  const response = await apiRequest(`/api/tokens/${encodeURIComponent(mintAddress)}/chat`, { signal: AbortSignal.timeout(5000) }).catch(() => ({ available: false, data: null }));
  if (loadId !== coinLoadId) return;
  coinChatMessages = response.available && Array.isArray(response.data?.messages) ? response.data.messages : [];
  renderCoinCommunityPanel();
  if (document.querySelector('[data-coin-tab="chat"].active')) renderCoinActivityTab();
}
function ensureCoinChatTab(){
  document.querySelector('.coin-tabs [data-coin-tab="chat"]')?.remove();
  const holders = document.querySelector('.coin-tabs [data-coin-tab="holders"]');
  if (holders) holders.textContent = 'Top holders —';
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
    activity.innerHTML = trades.length ? trades.map(item => {
      const time = Number.isFinite(Number(item.blockTime)) ? new Date(Number(item.blockTime) * 1000).toLocaleString() : 'Time unavailable';
      const sol = Number(item.solLamports) / 1_000_000_000;
      const tokens = Number(item.tokenAmountRaw) / (10 ** coinMarketActivity.decimals);
      const side = item.side === 'buy' ? 'Buy' : 'Sell';
      return `<div class="coin-activity-row coin-trade-row ${item.side === 'buy' ? 'is-buy' : 'is-sell'}"><span class="activity-icon">${item.side === 'buy' ? '↗' : '↘'}</span><span><strong>${side} <a href="${escapeHtml(exploreExplorer(`tx/${encodeURIComponent(item.signature)}`))}" target="_blank" rel="noopener noreferrer">${escapeHtml(shortAddress(item.signature))} ↗</a></strong><small>Trader <a href="${escapeHtml(exploreExplorer(`address/${encodeURIComponent(item.trader)}`))}" target="_blank" rel="noopener noreferrer">${escapeHtml(shortAddress(item.trader))}</a></small></span><b class="activity-amount">${Number.isFinite(sol) ? escapeHtml(formatCoinUsd(sol)) : '$—'}<small>${Number.isFinite(tokens) ? escapeHtml(formatOnChainNumber(tokens, 2)) : '—'} ${escapeHtml(coinActivity.symbol || 'tokens')}</small><time class="activity-time">${escapeHtml(time)}</time></b></div>`;
    }).join('') : `<div class="empty-state coin-activity-empty"><strong>No matching trades in this view</strong><small>${coinMarketActivity.coverage === 'partial' ? 'RPC coverage is partial; more activity may exist.' : coinTradeFilter !== 'all' || walletQuery || minSol ? 'Filters apply to the latest 20 shown. The 24-hour totals include all scanned trades.' : 'No confirmed Pump bonding-curve trade was found in the scanned 24-hour window.'}</small></div>`;
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
    if (!coinActivity.accountAvailable) { activity.innerHTML = '<div class="empty-state coin-activity-empty"><strong>Top holders unavailable</strong><small>Solana RPC did not return a token-account sample.</small></div>'; return; }
    activity.innerHTML = '<div class="coin-holder-heading"><span>Holder / token account</span><span>Balance</span><span>Supply share</span></div>' + (coinActivity.accounts.length ? coinActivity.accounts.map((item, index) => {
      const isVault = item.address === coinActivity.curveVaultAddress;
      const share = Number.isFinite(item.share) ? Math.max(0, Math.min(100, item.share)) : 0;
      return `<div class="coin-activity-row coin-account-row ${isVault ? 'is-curve-vault' : ''}"><span class="activity-icon">${index + 1}</span><span><strong><a href="${escapeHtml(exploreExplorer(`address/${item.address}`))}" target="_blank" rel="noopener noreferrer">${escapeHtml(shortAddress(item.address))} ↗</a></strong><small>${isVault ? 'Pump curve vault · excluded from holder count' : 'Token account · wallet owner not classified'}</small><i class="coin-account-share-track"><i style="width:${share}%"></i></i></span><b class="activity-amount">${escapeHtml(item.amount)} ${escapeHtml(coinActivity.symbol)}${item.share == null ? '' : `<small>${escapeHtml(formatOnChainNumber(item.share, 2))}% of supply</small>`}</b><span class="activity-time">RPC</span></div>`;
    }).join('') : '<div class="empty-state coin-activity-empty"><strong>No token accounts returned</strong><small>Solana RPC returned an empty account sample.</small></div>');
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
  coinActivity = { status: 'unavailable', message, collections: [], claims: [], accounts: [] };
  renderCoinAccountDistribution(null);
  coinMarketActivity = { status: 'unavailable', trades: [], coverage: null, decimals: 6 };
  renderCoinPricePath(); renderCoinFlow(NaN, NaN); renderCoinPulse();
  setCoinTabLabels(); renderCoinActivityTab();
  setCoinField('.coin-live-dot', 'Data unavailable');
  setCoinField('#coin-page-title', 'Token data unavailable');
  setCoinField('#coin-avatar', '?'); setCoinField('#coin-symbol', '—'); setCoinField('#coin-description', message);
  ['#coin-stage','#coin-fee-owner','#coin-metadata-status','#coin-mint-authority','#coin-freeze-authority'].forEach(selector => setCoinFact(selector, 'Unavailable'));
  ['#coin-market-cap','#coin-change','#coin-spot-price','#coin-volume','#coin-liquidity','#coin-holders','#coin-trade-count','#coin-vault-share','#coin-largest-account-share','#coin-top-ten-share','#coin-supply'].forEach(selector => setCoinField(selector, 'Unavailable'));
  setCoinField('#coin-volume-source', 'RPC trade history unavailable'); setCoinField('#coin-trade-breakdown', 'RPC trade history unavailable'); setCoinField('#coin-trade-coverage', 'Trade history unavailable'); setCoinField('#coin-accounts-source', 'Largest-account sample unavailable'); setCoinCurveProgress(null);
  setCoinField('#coin-chart-heading', 'On-chain snapshot');
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
  ensureCoinChatTab();
  ensureCoinPolicyAccordion();
  ensureCoinCommunityPanel();
  renderCoinCreatorHeader('');
  const snapshotMode = document.querySelector('[data-coin-chart-view="snapshot"]');
  const tradesMode = document.querySelector('[data-coin-chart-view="trades"]');
  if (snapshotMode) snapshotMode.textContent = 'Snapshot';
  if (tradesMode) tradesMode.textContent = 'Chart';
  coinChatMessages = [];
  renderCoinCommunityPanel();
  coinActivity = { status: 'loading', collections: [], claims: [], accounts: [] };
  renderCoinAccountDistribution(null);
  coinMarketActivity = { status: 'loading', trades: [], coverage: null, decimals: 6 };
  coinSolUsdValues = { spot: NaN, marketCap: NaN, reserve: NaN };
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
  invalidateTradePreview();
  setCoinTabLabels(); renderCoinActivityTab();
  setCoinField('.coin-live-dot', 'Checking data');
  setCoinField('#coin-avatar', '?'); setCoinField('#coin-symbol', 'TOKEN'); setCoinField('#coin-page-title', 'Loading token…'); setCoinField('#coin-address', shortAddress(mintAddress));
  setCoinFact('#coin-stage', 'Checking curve'); setCoinFact('#coin-fee-owner', 'Checking route'); setCoinFact('#coin-metadata-status', 'Reading mint');
  setCoinFact('#coin-mint-authority', 'Checking…'); setCoinFact('#coin-freeze-authority', 'Checking…');
  const avatar = document.querySelector('#coin-avatar'); if (avatar) avatar.style.backgroundImage = '';
  ['#coin-website-link', '#coin-x-link', '#coin-telegram-link', '#coin-discord-link'].forEach(selector => { const link = document.querySelector(selector); if (link) { link.hidden = true; link.removeAttribute('href'); } });
  compactCoinSocials();
  setCoinField('#coin-description', 'Reading the mint, metadata account, and Pump bonding curve from Solana RPC…');
  const explorerLink = document.querySelector('#coin-explorer-link'); if (explorerLink) { explorerLink.href = exploreExplorer(`address/${encodeURIComponent(mintAddress)}`); explorerLink.hidden = !mintAddress; }
  document.querySelectorAll('.coin-chart-panel .chart-tools button').forEach(button => { button.disabled = true; button.title = 'Historical candles are not indexed for this token.'; });
  ['#coin-market-cap','#coin-change','#coin-spot-price','#coin-volume','#coin-liquidity','#coin-holders','#coin-trade-count','#coin-vault-share','#coin-largest-account-share','#coin-top-ten-share','#coin-supply'].forEach(selector => setCoinField(selector, 'Loading…'));
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
  const response = await apiRequest(`/api/tokens/${encodeURIComponent(mintAddress)}/market-activity`, { signal: AbortSignal.timeout(12000) }).catch(() => ({ available: false, data: null }));
  if (loadId !== coinLoadId) return;
  const market = response.available && response.data?.cluster === EXPLORE_CLUSTER ? response.data : null;
  if (!market || market.volume24hSol == null || !Number.isFinite(Number(market.volume24hSol))) {
    coinMarketActivity = { status: 'unavailable', trades: [], coverage: null, decimals };
    renderCoinPricePath(); renderCoinFlow(NaN, NaN); renderCoinPulse();
    setCoinField('#coin-volume', 'Unavailable'); setCoinField('#coin-volume-source', 'RPC trade history unavailable');
    setCoinField('#coin-trade-count', 'Unavailable'); setCoinField('#coin-trade-breakdown', 'RPC trade history unavailable'); setCoinField('#coin-trade-coverage', 'Trade history unavailable');
    setCoinTabLabels(); renderCoinActivityTab();
    return;
  }
  const hasTradeRows = Array.isArray(market.recentTrades);
  const quote = [market.solUsdPrice, market.nativeUsdPrice, market.solPriceUsd].map(Number).find(Number.isFinite);
  if (Number.isFinite(quote) && quote > 0) {
    coinSolUsdPrice = quote;
    setCoinField('#coin-market-cap', formatCoinUsd(coinSolUsdValues.marketCap));
    setCoinField('#coin-spot-price', formatCoinUsd(coinSolUsdValues.spot));
    setCoinField('#coin-liquidity', formatCoinUsd(coinSolUsdValues.reserve));
  }
  coinMarketActivity = { status: hasTradeRows ? 'ready' : 'summary-only', trades: hasTradeRows ? market.recentTrades : [], activityWindows: market.activityWindows, coverage: market.coverage, decimals, tradeCount: Number(market.tradeCount24h) || 0, volume24hSol: Number(market.volume24hSol), buyVolume24hSol: Number(market.buyVolume24hSol), sellVolume24hSol: Number(market.sellVolume24hSol) };
  const partial = market.coverage === 'partial';
  if (hasTradeRows && market.recentTrades.length >= 2) setCoinChartView('trades');
  renderCoinPricePath(); renderCoinPulse();
  renderCoinFlow(market.buyVolume24hSol, market.sellVolume24hSol, partial);
  setCoinField('#coin-trade-count', `${partial ? '≥' : ''}${coinMarketActivity.tradeCount}`);
  const hasSideCounts = Number.isInteger(market.buyCount24h) && Number.isInteger(market.sellCount24h);
  setCoinField('#coin-trade-breakdown', hasSideCounts ? `${partial ? '≥' : ''}${market.buyCount24h} buys · ${partial ? '≥' : ''}${market.sellCount24h} sells` : 'Buy/sell split unavailable');
  setCoinField('#coin-trade-coverage', `Confirmed Pump bonding-curve trades · last 24h${partial ? ' · partial RPC scan' : ''} · ${hasTradeRows ? `latest ${Math.min(20, coinMarketActivity.trades.length)} shown` : 'individual rows not indexed'}${graduated ? ' · post-graduation pool trades excluded' : ''}`);
  setCoinTabLabels(); renderCoinActivityTab();
  const volume = `${market.coverage === 'partial' ? '≥' : ''}${formatCoinUsd(Number(market.volume24hSol))}`;
  setCoinField('#coin-volume', market.coverage === 'partial' ? `${volume} · partial` : volume);
  setCoinField('#coin-volume-source', graduated ? 'Curve trades only · pool excluded' : partial ? 'Partial curve RPC scan' : 'Pump curve RPC scan · 24h');
  const change = Number(market.priceChangePercent);
  const basis = market.priceChangeBasis;
  setCoinField('#coin-change', market.priceChangePercent != null && Number.isFinite(change) && basis
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
      rpcRequest(detailConnection.getTokenLargestAccounts(mint, 'confirmed'), 'Token-account RPC request'),
      apiRequest('/api/launches', { signal: AbortSignal.timeout(5000) }),
    ]);
    if (loadId !== coinLoadId) return;
    if (mintResult.status === 'rejected') throw mintResult.reason;
    const mintInfo = mintResult.value;
    const metadataInfo = metadataResult.status === 'fulfilled' ? metadataResult.value : null;
    const curve = curveResult.status === 'fulfilled' ? curveResult.value : null;
    const largestAccounts = largestResult.status === 'fulfilled' ? largestResult.value : { value: [] };
    const parsedMint = mintInfo.value?.data?.parsed?.info;
    if (!parsedMint) throw new Error('Mint account was not returned by Solana RPC.');
    const decimals = Number(parsedMint.decimals ?? 0);
    const supply = Number(parsedMint.supply) / (10 ** decimals);
    const metadata = parseOnChainMetadata(metadataInfo?.data);
    const registeredLaunch = launchesResult.status === 'fulfilled' && launchesResult.value.available
      ? launchesResult.value.data?.find?.(item => item.mint === mintAddress && item.cluster === EXPLORE_CLUSTER && item.onchainVerified && item.metadataUri === devnetMetadataUri(mintAddress))
      : null;
    const symbol = metadata.symbol || registeredLaunch?.symbol || `${mintAddress.slice(0, 4)}…`;
    const name = metadata.name || registeredLaunch?.name || 'Unnamed on-chain token';
    const spotPriceSol = curve && curve.virtualTokenReserves > 0 ? curve.virtualQuoteReservesSol / curve.virtualTokenReserves : NaN;
    const marketCapSol = spotPriceSol * supply;
    const accountAvailable = largestResult.status === 'fulfilled';
    const rawSupply = Number(parsedMint.supply);
    const tokenProgram = mintInfo.value.owner;
    const verifiedTokenProgram = tokenProgram?.equals?.(TOKEN_PROGRAM_ID) || tokenProgram?.equals?.(TOKEN_2022_PROGRAM_ID);
    const curveVaultAddress = curve && verifiedTokenProgram
      ? getAssociatedTokenAddressSync(mint, bondingCurvePda(mint), true, tokenProgram).toBase58() : null;
    const accounts = (largestAccounts.value || []).map(item => ({
      address: item.address.toBase58(),
      amount: formatOnChainNumber(Number(item.uiAmountString ?? Number(item.amount) / (10 ** decimals)), 4),
      share: rawSupply > 0 ? Number(item.amount) / rawSupply * 100 : null,
    }));
    const tokenAccounts = accounts.length;
    const distribution = accountAvailable ? summarizeTokenAccounts(accounts, curveVaultAddress) : null;
    const realQuote = curve?.realQuoteReservesSol;
    const ledger = await apiRequest(`/api/tokens/${encodeURIComponent(mintAddress)}/fee-activity`, { signal: AbortSignal.timeout(3500) }).catch(() => ({ available: false, data: null }));
    if (loadId !== coinLoadId) return;
    const ledgerAvailable = ledger.available && ledger.data?.cluster === EXPLORE_CLUSTER;
    const linkedRouter = ledgerAvailable && curve?.creator === ledger.data?.sharedRouter?.address;
    coinActivity = { status: 'ready', symbol, accounts, accountAvailable, curveVaultAddress: distribution?.vaultAddress || null, ledgerAvailable, ledgerSource: ledger.data?.source === 'funded.app-postgresql' ? 'app database' : 'file ledger', collections: ledgerAvailable ? ledger.data.collections || [] : [], claims: ledgerAvailable ? ledger.data.claims || [] : [], sharedRouterCollections: linkedRouter ? ledger.data.sharedRouter.collections || [] : [] };
    renderCoinAccountDistribution(distribution, tokenAccounts);
    setCoinTabLabels(); renderCoinActivityTab();
    setCoinField('.coin-live-dot', 'RPC confirmed');
    setCoinField('#coin-avatar', symbol.slice(0, 1).toUpperCase()); setCoinField('#coin-symbol', symbol); setCoinField('#coin-page-title', name);
    setCoinField('#coin-address', shortAddress(mintAddress)); setCoinField('#coin-full-address', mintAddress);
    setCoinField('#coin-description', 'On-chain mint and Pump bonding-curve snapshot. Signed Devnet metadata is checked separately.');
    setCoinFact('#coin-stage', curve ? curve.complete ? 'Graduated' : 'On Pump curve' : 'Unverified', curve ? 'clear' : 'unknown');
    setCoinFact('#coin-fee-owner', linkedRouter ? 'App router address matched' : curve?.creator ? shortAddress(curve.creator) : 'Unavailable', linkedRouter ? 'clear' : 'unknown');
    setCoinFact('#coin-metadata-status', metadataInfo?.data && (metadata.name || metadata.symbol) ? 'On-chain name / symbol' : registeredLaunch ? 'Pump create event verified' : 'No verified name', metadataInfo?.data && (metadata.name || metadata.symbol) || registeredLaunch ? 'clear' : 'unknown');
    coinSolUsdValues = { spot: spotPriceSol, marketCap: marketCapSol, reserve: realQuote };
    setCoinField('#coin-market-cap', formatCoinUsd(marketCapSol)); setCoinField('#coin-change', '24h change unavailable');
    setCoinField('#coin-spot-price', formatCoinUsd(spotPriceSol));
    setCoinField('#coin-volume', curve && EXPLORE_CLUSTER === 'devnet' ? 'Reading trades…' : '$—'); setCoinField('#coin-liquidity', formatCoinUsd(realQuote));
    setCoinField('#coin-holders', distribution ? `${formatOnChainNumber(distribution.otherShare, 2)}%` : 'Unavailable');
    setCoinField('#coin-accounts-source', distribution ? `${distribution.otherCount} other token accounts in top ${tokenAccounts} · not wallets` : 'Curve vault not identified in largest-account sample');
    setCoinField('#coin-vault-share', distribution ? `${formatOnChainNumber(distribution.vaultShare, 2)}% of supply` : curveVaultAddress && accountAvailable ? 'Outside top sample' : 'Unavailable');
    setCoinField('#coin-largest-account-share', distribution ? distribution.otherCount ? `${formatOnChainNumber(distribution.largestOtherShare, 2)}% of supply` : 'None in sample' : 'Unavailable');
    setCoinField('#coin-top-ten-share', distribution ? distribution.otherCount ? `${formatOnChainNumber(distribution.topTenOtherShare, 2)}% of supply` : 'None in sample' : 'Unavailable');
    setCoinAuthority('#coin-mint-authority', parsedMint.mintAuthority); setCoinAuthority('#coin-freeze-authority', parsedMint.freezeAuthority);
    setCoinField('#coin-supply', `${formatOnChainNumber(supply, 6)} ${symbol}`); setCoinCurveProgress(curve?.progressPercent);
    setCoinField('#coin-chart-heading', `${symbol} / SOL snapshot`); setCoinField('#coin-full-address', mintAddress);
    const chart = document.querySelector('.coin-chart');
    if (chart) chart.innerHTML = curve ? `<div class="onchain-snapshot"><div><span>Spot price</span><strong>${formatCoinSpot(spotPriceSol)}</strong></div><div><span>Virtual quote</span><strong>${formatCoinSpot(curve.virtualQuoteReservesSol)}</strong></div><div><span>Real reserve</span><strong>${formatCoinSpot(realQuote)}</strong></div><div><span>Observed slot</span><strong>${curve.slot ?? '—'}</strong></div></div>` : `<div class="onchain-snapshot"><div><span>Pump curve</span><strong>Unavailable</strong></div><div><span>Cluster</span><strong>${EXPLORE_CLUSTER}</strong></div></div>`;
    const chartFooter = document.querySelector('.coin-chart-panel > .chart-footer'); if (chartFooter) chartFooter.innerHTML = `<span>Mint decimals <b>${decimals}</b></span><span>Supply <b>${formatOnChainNumber(supply, 6)}</b></span><span>Confirmed RPC snapshot · ${escapeHtml(EXPLORE_CLUSTER)}</span>`;
    const policyEyebrow = document.querySelector('.coin-policy-card .eyebrow'); if (policyEyebrow) policyEyebrow.textContent = 'On-chain account';
    const policyTitle = document.querySelector('.coin-policy-card h2'); if (policyTitle) policyTitle.textContent = curve ? 'Pump bonding curve' : 'Curve unavailable';
    renderCoinCreatorRoute(curve?.creator || '');
    renderCoinCreatorHeader(curve?.creator || '');
    const policySplit = document.querySelector('.policy-split'); if (policySplit) policySplit.innerHTML = curve ? `<span><b>${curve.complete ? 'Complete' : 'Active'}</b><small>Curve state</small></span><span><b>${formatOnChainNumber(curve.realTokenReserves, 0)}</b><small>Real tokens</small></span>` : '<span><b>—</b><small>Curve state</small></span><span><b>—</b><small>Creator</small></span>';
    const policyBar = document.querySelector('.policy-bar'); if (policyBar) policyBar.innerHTML = curve ? `<i style="display:block;height:100%;width:${Math.max(0, Math.min(100, Number(curve.progressPercent) || 0))}%;background:#83cbb0"></i>` : '<i style="display:block;height:100%;width:100%;background:#667085"></i>';
     const policyLink = document.querySelector('.policy-link'); if (policyLink) { policyLink.textContent = 'View mint on explorer →'; policyLink.href = exploreExplorer(`address/${mintAddress}`); policyLink.hidden = false; }
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
    if (curve && EXPLORE_CLUSTER === 'devnet') void loadCoinMarketActivity(mintAddress, loadId, decimals, curve.complete === true);
    else { coinMarketActivity = { status: 'unavailable', trades: [], coverage: null, decimals }; renderCoinPricePath(); renderCoinFlow(NaN, NaN); renderCoinPulse(); setCoinField('#coin-trade-count', 'Unavailable'); setCoinField('#coin-trade-breakdown', 'Pump curve required'); setCoinField('#coin-trade-coverage', 'No Pump curve trade history'); setCoinTabLabels(); renderCoinActivityTab(); }
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
function showCoinPage(open = true){
  const main = document.querySelector('.main-content');
  const page = document.querySelector('#coin-page');
  const walletPage = document.querySelector('#wallet-page');
  if (!main || !page) return;
  if (!open){ ++coinLoadId; main.classList.remove('coin-view'); page.hidden = true; return; }
  const mintAddress = getCoinMintAddress();
  main.classList.remove('wallet-view');
  if (walletPage) walletPage.hidden = true;
  setCoinField('#coin-full-address', mintAddress || 'No mint address');
  const addressButton = document.querySelector('#coin-copy-address');
  if (addressButton) setCoinField('#coin-address', shortAddress(mintAddress));
  resetCoinSurface(mintAddress); renderCoinPromotionBadge(); main.classList.add('coin-view'); page.hidden = false; window.scrollTo({ top: 0, behavior: 'smooth' });
  startCoinLabelSanitizer();
  const watch = document.querySelector('#coin-watch'); if (watch) { const saved = getWatchlist().includes(mintAddress); watch.textContent = saved ? '★' : '☆'; watch.classList.toggle('active', saved); watch.setAttribute('aria-pressed', String(saved)); }
  loadCoinOnChain(mintAddress);
}
function coinRouteRequested(){ const directPath = location.pathname.startsWith('/token/') || location.pathname.startsWith('/launch/coin/'); return location.hash.startsWith('#coin/') || (directPath && !location.hash); }
function walletRouteRequested(){ return location.pathname.startsWith('/wallet/') && !location.hash; }
if (coinRouteRequested()) showCoinPage(); else if (walletRouteRequested()) showWalletPage();
window.addEventListener('hashchange', () => { if (coinRouteRequested()) showCoinPage(); else if (walletRouteRequested()) showWalletPage(); else { showCoinPage(false); showWalletPage(false); } });
window.addEventListener('popstate', () => { if (coinRouteRequested()) showCoinPage(); else if (walletRouteRequested()) showWalletPage(); else { showCoinPage(false); showWalletPage(false); } });
document.querySelector('#asset-grid')?.addEventListener('click', event => { if (event.target.closest('button, a')) return; const card = event.target.closest('.asset-card'); const mint = card?.dataset.mint; if (!mint) return; location.href = `/token/${encodeURIComponent(mint)}`; });
document.querySelector('#coin-page')?.addEventListener('click', async event => {
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
  if (watch){ const mint = getCoinMintAddress(); if (!mint) return; const saved = getWatchlist(); saveWatchlist(saved.includes(mint) ? saved.filter(item => item !== mint) : [...saved, mint]); renderWatchlist(); const active = getWatchlist().includes(mint); watch.textContent = active ? '★' : '☆'; watch.classList.toggle('active', active); watch.setAttribute('aria-pressed', String(active)); return; }
  const share = event.target.closest('#coin-share-link');
  if (share){ event.preventDefault(); const mint = getCoinMintAddress(); if (!mint) return; const url = new URL(`/token/${encodeURIComponent(mint)}`, location.origin).toString(); try { await navigator.clipboard.writeText(url); showToast('Token link copied'); } catch { showToast(url); } return; }
  const copy = event.target.closest('#coin-copy-address, #coin-copy-full');
  if (copy){ const address = getCoinMintAddress(); if (!address) return showToast('No mint address in this route'); try { await navigator.clipboard.writeText(address); showToast('Token address copied'); } catch { showToast(address); } }
  const clearTradeFilters = event.target.closest('#coin-trade-clear');
  if (clearTradeFilters){ coinTradeFilter = 'all'; document.querySelectorAll('[data-coin-trade-filter]').forEach(button => { const active = button.dataset.coinTradeFilter === 'all'; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); }); document.querySelector('#coin-trade-wallet').value = ''; document.querySelector('#coin-trade-min-sol').value = ''; renderCoinActivityTab(); return; }
  const tradeFilter = event.target.closest('[data-coin-trade-filter]');
  if (tradeFilter){ coinTradeFilter = tradeFilter.dataset.coinTradeFilter; document.querySelectorAll('[data-coin-trade-filter]').forEach(button => { const active = button === tradeFilter; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); }); renderCoinActivityTab(); return; }
  const tab = event.target.closest('[data-coin-tab]');
  if (tab){ document.querySelectorAll('[data-coin-tab]').forEach(item => item.classList.toggle('active', item === tab)); setCoinTabLabels(); renderCoinActivityTab(); }
});
document.querySelector('#wallet-page')?.addEventListener('click', async event => {
  const copy = event.target.closest('#wallet-copy-address');
  if (!copy) return;
  const address = getWalletDetailAddress();
  if (!address) return showToast('No wallet address in this route');
  try { await navigator.clipboard.writeText(address); showToast('Wallet address copied'); } catch { showToast(address); }
});
document.querySelector('#coin-page')?.addEventListener('submit', async event => {
  const form = event.target.closest('#coin-chat-form, #coin-community-form');
  if (!form) return;
  event.preventDefault();
  const input = form.querySelector('#coin-chat-input, #coin-community-input');
  const text = input?.value.trim();
  const mint = getCoinMintAddress();
  if (!text || !mint) return;
  const author = connectedWalletAddress || 'Guest';
  const button = form.querySelector('button');
  if (button) button.disabled = true;
  try {
    const response = await apiRequest(`/api/tokens/${encodeURIComponent(mint)}/chat`, { method: 'POST', body: { author, text } });
    if (response.available && response.data?.message) coinChatMessages = [...coinChatMessages, response.data.message].slice(-50);
    input.value = '';
    renderCoinChat(document.querySelector('#coin-activity-list'));
    renderCoinCommunityPanel();
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
  explore: { name: 'Explore the index', subtitle: 'Find launches with a visible signal', progress: '1 of 3 complete', width: '33%', note: 'Open the explorer to compare route, tier, and receipt history.' },
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
      ['explore', 'INDEX', 'Discover with signal', 'Find launches worth a closer look', 'Compare verified routes, launch tiers, and visible commitment signals.', 'LIVE FEED', 'Route + tier'],
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

async function loadXIdentity() {
  const button = document.querySelector('#x-sign-in');
  const status = document.querySelector('#x-identity-status');
  if (!button || !status) return;
  try {
    const result = await apiRequest('/api/x/me');
    if (!result.available) { status.textContent = 'Start the funded.app API to enable X sign-in.'; return; }
    if (result.data?.authenticated) {
      const user = result.data.user;
      status.textContent = `Connected as @${user.username}`;
      button.textContent = 'Sign out of X';
      button.dataset.connected = 'true';
      const handle = document.querySelector('#sol-claim-x-account');
      if (handle) handle.value = `@${user.username}`;
      await refreshXClaims();
    } else {
      status.textContent = 'Connect the X account that matches the reward handle.';
      button.textContent = 'Sign in with X';
      button.dataset.connected = 'false';
      document.querySelector('#sol-claim-list')?.replaceChildren();
    }
  } catch (error) { status.textContent = error.message || 'X identity status is unavailable.'; }
}
async function refreshXClaims(){
  const list = document.querySelector('#sol-claim-list');
  if (!list) return;
  list.replaceChildren();
  try {
    const result = await apiRequest('/api/x-fee/claims');
    if (!result.available) return;
    if (!result.data.claims.length) { list.textContent = 'No mint-specific creator fees have been collected for this X account yet.'; return; }
    for (const claim of result.data.claims) {
      const row = document.createElement('div');
      row.className = 'referral-claim-row';
      const label = document.createElement('span');
      label.textContent = `${claim.amountSol} SOL · ${claim.mint.slice(0, 6)}… · ${claim.status}`;
      row.append(label);
      if (claim.status !== 'paid') {
        const choose = document.createElement('button');
        choose.type = 'button'; choose.className = 'secondary-button'; choose.textContent = 'Choose claim';
        choose.addEventListener('click', () => { document.querySelector('#sol-claim-id').value = claim.id; document.querySelector('#sol-claim-x-account').value = result.data.handle; });
        row.append(choose);
      }
      list.append(row);
    }
  } catch (error) { list.textContent = error.message || 'Claim list is unavailable.'; }
}
document.querySelector('#x-sign-in')?.addEventListener('click', async event => {
  const button = event.currentTarget;
  if (button.dataset.connected === 'true') { await apiRequest('/api/x/logout', { method: 'POST' }).catch(() => {}); await loadXIdentity(); return; }
  const apiBase = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '') || window.location.origin;
  window.location.assign(`${apiBase}/api/x/oauth/start`);
});
void loadXIdentity();
