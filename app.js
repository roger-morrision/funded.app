import { Buffer } from 'buffer';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { APP_REFERRAL_LEVELS, buildFeeDistributionPolicy, FEE_DISTRIBUTION, validateFeeDistribution } from './distribution-policy.js';
import { buildCommunityAirdropPolicy, buildLaunchReservePlan } from './airdrop-policy.js';
import { buildBuybackAccrual, buildBuybackPolicy, buildBuybackReceipt, evaluateBuybackBatch, summarizeBuybackLedger } from './buyback-policy.js';
import { buildFeeRouterPolicy, verifyFeeRouterAccount } from './fee-router.js';
import { buildLaunchBurnPolicy, createLaunchBurnTiers, validateLaunchBurnPolicy } from './launch-burn-policy.js';
import { bindReferralAttribution, captureFirstTouch, createReferralCode, normalizeReferralCode } from './referral-program.js';
  import { buildSolClaimPolicy, normalizeXHandle } from './sol-claim-policy.js';
import { buildTradeTransaction, describeTradeQuote, fetchBondingCurveSnapshot, submitTrade } from './pump-trading.js';
import { APP_CLUSTER, APP_EXPLORER_QUERY, APP_RPC_URL, EXPLORE_CLUSTER, EXPLORE_RPC_URL, TRADE_FEE_BPS, TRADE_FEE_OWNER } from './app-config.js';
import { apiRequest, persistLaunchPolicy } from './api-client.js';
import { launchPolicyStatement } from './launch-policy-auth.js';
import { enrichMarketRecord, filterMarketRecords, formatSignal, summarizeMarkets } from './market-intelligence.js';

globalThis.Buffer ??= Buffer;
let solanaModules;
let connection;
let exploreConnection;
async function getSolana(){
  if (!solanaModules) {
    const [web3, spl] = await Promise.all([import('@solana/web3.js'), import('@solana/spl-token')]);
    connection = new web3.Connection(APP_RPC_URL || web3.clusterApiUrl(APP_CLUSTER), 'confirmed');
    solanaModules = { ...web3, ...spl };
  }
  return solanaModules;
}
async function getExploreConnection(){
  const { Connection } = await getSolana();
  if (!exploreConnection) exploreConnection = new Connection(EXPLORE_RPC_URL || (solanaModules.clusterApiUrl ? solanaModules.clusterApiUrl(EXPLORE_CLUSTER) : `https://api.${EXPLORE_CLUSTER}.solana.com`), 'confirmed');
  return exploreConnection;
}
const explorer = (path) => `https://explorer.solana.com/${path}${APP_EXPLORER_QUERY}`;
const exploreExplorer = (path) => `https://explorer.solana.com/${path}${EXPLORE_CLUSTER === 'mainnet-beta' ? '' : `?cluster=${EXPLORE_CLUSTER}`}`;
let wallet = null;
let mobileWalletSession = null;
let metricsRequest = 0;
let walletBalanceLamports = null;
let estimatedLaunchFeeLamports = null;
let walletMetricsLoading = false;
let curveMonitorTimer = null;
let tradePreview = null;
let launchStep = 1;
let launchMode = 'quick';
let launchBurnTier = 'standard';
let launchBurnReadiness = { ready: true, message: 'No creator-funded burn is required.' };
const WATCHLIST_KEY = 'funded.app.community.watchlist';
const APP_REFERRAL_KEY = 'funded.app.referral.attribution';
const REFERRAL_ANALYTICS_KEY = 'funded.app.referral.analytics';
const REFERRAL_SERVER_KEY_PREFIX = 'funded.app.referral.server.';
const AIRDROP_PREVIEW_CLAIM_KEY = 'funded.app.airdrop.preview-claims';
const BUYBACK_PREVIEW_KEY = 'funded.app.buyback.preview-ledger';
const FEE_ROUTER_PROGRAM_ID = String(import.meta.env.VITE_FUNDED_FEE_ROUTER_PROGRAM_ID || '').trim();
const PROTOCOL_FUNDED_MINT = String(import.meta.env.VITE_FUNDED_TOKEN_MINT || '').trim();
const LAUNCH_BURN_TIERS = createLaunchBurnTiers({
  boostAmount: Number(import.meta.env.VITE_FUNDED_BOOST_BURN_AMOUNT || 25_000),
  proAmount: Number(import.meta.env.VITE_FUNDED_PRO_BURN_AMOUNT || 100_000),
  premierAmount: Number(import.meta.env.VITE_FUNDED_PREMIER_BURN_AMOUNT || 250_000),
});
let feeRouterState = { status: 'checking', verified: false, address: null, programId: FEE_ROUTER_PROGRAM_ID || null, bump: null };
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
function validateSolanaMint(value){
  const address = String(value || '').trim();
  if (!address) return { valid: false, empty: true };
  try { return { valid: bs58.decode(address).length === 32, address }; } catch { return { valid: false, address }; }
}
function getAppReferralAttribution(){
  try {
    const attribution = JSON.parse(localStorage.getItem(APP_REFERRAL_KEY) || 'null');
    const walletAddress = wallet?.publicKey?.toBase58();
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
  const walletAddress = wallet?.publicKey?.toBase58();
  if (!attribution || !walletAddress) return;
  const bound = bindReferralAttribution(attribution, walletAddress, getReferralCode());
  if (bound) { localStorage.setItem(APP_REFERRAL_KEY, JSON.stringify(bound)); trackReferralEvent('wallet_bound'); }
  else localStorage.removeItem(APP_REFERRAL_KEY);
}
async function syncServerReferralState(){
  const walletAddress = wallet?.publicKey?.toBase58();
  if (!walletAddress || typeof wallet.signMessage !== 'function') return;
  try {
    const registrationKey = `${REFERRAL_SERVER_KEY_PREFIX}${walletAddress}`;
    let registered = null;
    try { registered = JSON.parse(localStorage.getItem(registrationKey) || 'null'); } catch {}
    if (!registered?.code) {
      const prepared = await apiRequest('/api/referrals/registration/prepare', { method: 'POST', body: { wallet: walletAddress } });
      if (!prepared.available) return;
      const signature = await wallet.signMessage(new TextEncoder().encode(prepared.data.statement));
      const verified = await apiRequest('/api/referrals/registration/verify', { method: 'POST', body: { challengeId: prepared.data.challengeId, wallet: walletAddress, signature: bs58.encode(signature) } });
      if (verified.data?.code) { registered = verified.data; localStorage.setItem(registrationKey, JSON.stringify(registered)); localStorage.setItem(`funded.app.referral.code.${walletAddress}`, registered.code); }
    }
    const attribution = getAppReferralAttribution();
    if (attribution?.code && attribution.wallet === walletAddress && !attribution.serverVerified) {
      const prepared = await apiRequest('/api/referrals/attribution/prepare', { method: 'POST', body: { wallet: walletAddress, code: attribution.code } });
      if (!prepared.available) return;
      const signature = await wallet.signMessage(new TextEncoder().encode(prepared.data.statement));
      await apiRequest('/api/referrals/attribution/verify', { method: 'POST', body: { challengeId: prepared.data.challengeId, wallet: walletAddress, signature: bs58.encode(signature) } });
      localStorage.setItem(APP_REFERRAL_KEY, JSON.stringify({ ...attribution, serverVerified: true }));
      trackReferralEvent('server_attribution_verified');
    }
  } catch (error) { trackReferralEvent('server_referral_sync_failed', { reason: error.message }); }
}
async function refreshReferralClaims(){
  const walletAddress = wallet?.publicKey?.toBase58(); const dashboard = document.querySelector('.referral-dashboard');
  if (!walletAddress || !dashboard) return;
  const result = await apiRequest(`/api/referral-claims?wallet=${encodeURIComponent(walletAddress)}`).catch(() => ({ available: false }));
  if (!result.available) return;
  let panel = document.querySelector('#referral-claim-center');
  if (!panel) { panel = document.createElement('div'); panel.id = 'referral-claim-center'; panel.className = 'referral-dashboard'; dashboard.after(panel); }
  panel.replaceChildren();
  const heading = document.createElement('div'); const title = document.createElement('strong'); title.textContent = 'Referral claim center'; const note = document.createElement('small'); note.textContent = result.data.claims.length ? 'Rewards require your wallet signature and a separate payout action.' : 'No claimable referral rewards yet.'; heading.append(title, note); panel.append(heading);
  for (const claim of result.data.claims) {
    const row = document.createElement('div'); row.className = 'referral-claim-row'; const label = document.createElement('span'); label.textContent = `Level ${claim.level} · ${claim.amount} ${claim.asset} · ${claim.status}`; row.append(label);
    if (claim.status === 'awaiting-wallet-signature' && wallet.signMessage) { const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary-button'; button.textContent = 'Sign claim'; button.onclick = async () => { button.disabled = true; try { const signature = await wallet.signMessage(new TextEncoder().encode(claim.statement)); await apiRequest(`/api/referral-claims/${encodeURIComponent(claim.id)}/verify`, { method: 'POST', body: { publicKey: walletAddress, signature: bs58.encode(signature) } }); await refreshReferralClaims(); } catch (error) { showToast(error.message); button.disabled = false; } }; row.append(button); }
    if (claim.status === 'wallet-verified') { const button = document.createElement('button'); button.type = 'button'; button.className = 'primary-button'; button.textContent = 'Execute payout'; button.onclick = async () => { button.disabled = true; try { await apiRequest(`/api/referral-claims/${encodeURIComponent(claim.id)}/execute`, { method: 'POST' }); showToast('Referral reward paid'); await refreshReferralClaims(); } catch (error) { showToast(error.message); button.disabled = false; } }; row.append(button); }
    if (claim.status === 'paid' && claim.payoutSignature) { const receipt = document.createElement('small'); receipt.textContent = `Paid · ${claim.payoutSignature}`; row.append(receipt); }
    panel.append(row);
  }
}
function getReferralCode(){
  const walletAddress = wallet?.publicKey?.toBase58();
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
  const value = code ? `${window.location.origin}${window.location.pathname}?ref=${code}` : 'Connect wallet to generate';
  document.querySelectorAll('[data-referral-link]').forEach(node => { node.textContent = value; });
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
  if (state) state.textContent = wallet ? `Wallet ${wallet.publicKey.toBase58().slice(0, 4)}…${wallet.publicKey.toBase58().slice(-4)} connected. Eligibility appears only after a verified Devnet snapshot is indexed.` : 'Connect your wallet to check eligibility. No claim data is shown until confirmed Devnet receipts or an indexed proof is available.';
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
  }).join('') || '<div class="empty-state">No local buyback events yet.</div>';
  const runButton = document.querySelector('#buyback-run-preview');
  const addButton = document.querySelector('#buyback-add-claim');
  if (addButton) addButton.disabled = true;
  runButton.disabled = true;
  const status = document.querySelector('#buyback-preview-status');
  if (message) status.textContent = message;
  else if (pendingSol >= 0.25) status.textContent = `${formatBuybackAmount(pendingSol)} SOL is ready for a protected batch preview.`;
  else if (pendingSol > 0) status.textContent = `${formatBuybackAmount(pendingSol)} SOL is safely accumulating toward the 0.25 SOL threshold.`;
  else status.textContent = 'No verified on-chain buyback receipts are available.';
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
let exploreSort = 'market-cap';
let exploreRisk = 'all';
let exploreUpdatedAt = null;
let exploreProviderStatus = 'On-chain only · loading';
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
function renderExploreAssets(){
  const grid = document.querySelector('#asset-grid');
  const count = document.querySelector('#explore-launch-count');
  const status = document.querySelector('#explore-data-status');
  const ticker = document.querySelector('#explore-ticker');
  const clusterLabel = document.querySelector('#explore-cluster-label');
  if (clusterLabel) clusterLabel.textContent = `Solana ${EXPLORE_CLUSTER === 'mainnet-beta' ? 'mainnet' : EXPLORE_CLUSTER} · ${exploreProviderStatus.includes('RPC verified') ? 'RPC verified' : exploreProviderStatus.includes('unavailable') ? 'data unavailable' : 'awaiting verification'}`;
  const records = assets.map(enrichMarketRecord);
  const visible = filterMarketRecords(records, { query: exploreQuery, sort: exploreSort, risk: exploreRisk, watchlist: getWatchlist() });
  const summary = summarizeMarkets(records);
  if (count) count.textContent = String(visible.length).padStart(2, '0');
  if (status) status.textContent = exploreProviderStatus === 'On-chain only · loading' ? exploreProviderStatus : `${exploreProviderStatus}${assets.length ? ` · ${visible.length} shown` : ''}`;
  const kpis = document.querySelector('#explore-market-kpis');
  if (kpis) kpis.innerHTML = `<span><small>24h volume</small><strong>${formatSignal(summary.volume24hUsd, ' USD')}</strong></span><span><small>Liquidity indexed</small><strong>${formatSignal(summary.liquidityUsd, ' USD')}</strong></span><span><small>High-risk signals</small><strong>${summary.highRisk}</strong></span>`;
  if (ticker) ticker.innerHTML = visible.length ? `<span class="ticker-label"><i></i> On-chain activity</span>${visible.slice(0, 6).map(asset => `<span>${escapeHtml(asset.symbol)} <b>${escapeHtml(asset.change)}</b></span>`).join('')}<span class="ticker-note">Verified from Solana RPC · provider fields may be unavailable</span>` : '<span class="ticker-label"><i></i> On-chain activity</span><span id="explore-ticker-status">No verified launches match these filters</span>';
  if (!grid) return;
  grid.innerHTML = visible.length ? visible.map(a => `<article class="asset-card signal-${escapeHtml(a.riskLevel)}" data-search="${escapeHtml(a.symbol)} ${escapeHtml(a.name)} ${escapeHtml(a.address || '')}" data-mint="${escapeHtml(a.address || '')}"><div class="asset-top"><span class="asset-symbol"><i class="asset-icon">${escapeHtml(a.icon)}</i>${escapeHtml(a.symbol)}</span><span class="asset-meta">${escapeHtml(a.meta)}</span><button type="button" class="watch-button" data-mint="${escapeHtml(a.address || '')}" aria-label="Save ${escapeHtml(a.symbol)} to watchlist" aria-pressed="false">☆</button></div><p class="asset-name">${escapeHtml(a.name)}</p><div class="asset-signal-row"><span>24h vol <b>${formatSignal(a.volume24hUsd, ' USD')}</b></span><span>Liquidity <b>${formatSignal(a.liquidityUsd, ' USD')}</b></span></div><div class="asset-bottom"><span class="asset-value">${escapeHtml(a.value)}</span><span class="asset-change">${escapeHtml(a.change)}</span></div><div class="asset-risk"><span>${a.riskLevel === 'normal' ? 'Signal clear' : a.riskLevel === 'high' ? 'Review risk signals' : 'Review data'} · ${escapeHtml(a.source || 'RPC')} · ${escapeHtml(formatFeedAge(a.fetchedAt))}</span><button type="button" class="share-asset" data-share-symbol="${escapeHtml(a.symbol)}" data-share-mint="${escapeHtml(a.address || '')}">Share</button></div></article>`).join('') : `<div class="empty-state onchain-empty"><strong>${assets.length ? 'No verified launches match these filters.' : 'No verified on-chain launches yet.'}</strong><span>${assets.length ? 'Broaden the search or wait for a confirmed Solana indexer response.' : 'Explore will populate after a confirmed Solana RPC response.'}</span></div>`;
  renderWatchlist();
}
function renderStonkEnhancements(){
  const quoteList = document.querySelector('#quote-asset-list');
  const quoteStatus = document.querySelector('#quote-assets-status');
  const signalList = document.querySelector('#terminal-signal-list');
  const signalStatus = document.querySelector('#terminal-signals-status');
  if (!quoteList && !signalList) return;
  apiRequest('/api/quote-assets').then(result => {
    const verified = result.data?.status === 'onchain-verified-catalog' && result.data?.cluster === EXPLORE_CLUSTER;
    const assets = verified && Array.isArray(result.data?.assets) ? result.data.assets : [];
    if (quoteStatus) quoteStatus.textContent = verified ? 'RPC verified' : 'Unavailable';
    if (quoteList) quoteList.innerHTML = assets.length ? assets.map(item => `<div class="quote-asset-row"><span class="asset-icon">${escapeHtml(item.symbol.slice(0, 1))}</span><span><strong>${escapeHtml(item.symbol)}</strong><small>${escapeHtml(item.name)} · ${escapeHtml(item.category)}</small></span><b>✓</b></div>`).join('') : '<div class="empty-state">No verified quote assets configured.</div>';
  }).catch(() => { if (quoteStatus) quoteStatus.textContent = 'Unavailable'; if (quoteList) quoteList.innerHTML = '<div class="empty-state">Quote catalog unavailable; no unverified assets shown.</div>'; });
  apiRequest('/api/terminal/signals').then(result => {
    const verified = result.data?.status === 'ready' && result.data?.cluster === EXPLORE_CLUSTER;
    const items = verified && Array.isArray(result.data?.items) ? result.data.items.slice(0, 5) : [];
    if (signalStatus) signalStatus.textContent = verified ? 'Verified launch signals' : 'Waiting for indexer';
    if (signalList) signalList.innerHTML = items.length ? items.map(item => `<div class="terminal-signal-row"><span><strong>${escapeHtml(item.symbol || item.name || 'Launch')}</strong><small>${escapeHtml(item.riskLevel || 'watch')} · score ${Number(item.signalScore || 0)}/100</small></span><b>${item.graduationProgress == null ? '—' : `${Number(item.graduationProgress).toFixed(0)}%`}</b></div>`).join('') : '<div class="empty-state">Signals appear after the server indexer records launches.</div>';
  }).catch(() => { if (signalStatus) signalStatus.textContent = 'Unavailable'; if (signalList) signalList.innerHTML = '<div class="empty-state">Terminal signals unavailable.</div>'; });
}
renderExploreAssets();
renderStonkEnhancements();
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
  return `$${amount.toPrecision(4)}`;
}
function formatCompactUsd(value){
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return '—';
  return `$${Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 }).format(amount)}`;
}
async function renderHomeOnchainSnapshot(verified){
  const status = document.querySelector('#home-live-status');
  const count = document.querySelector('#home-verified-launches');
  const countNote = document.querySelector('#home-verified-launches-note');
  const policyUpdated = document.querySelector('#home-policy-updated');
  const activity = document.querySelector('#home-activity-list');
  if (!status || !count || !activity) return;
  status.textContent = `Solana RPC · ${EXPLORE_CLUSTER} confirmed`;
  count.textContent = String(verified.length);
  countNote.textContent = verified.length ? `Confirmed on ${EXPLORE_CLUSTER}` : 'No confirmed launches found';
  if (policyUpdated) policyUpdated.textContent = `RPC checked ${new Date().toLocaleTimeString()} · ${EXPLORE_CLUSTER}`;
  if (!verified.length) {
    activity.innerHTML = '<div class="onchain-empty-row"><span class="activity-avatar blue">◎</span><span><strong>No verified launch activity yet</strong><small>Live Solana RPC returned no confirmed funded.vip mints</small></span><b>—</b></div>';
    return;
  }
  const { PublicKey } = await getSolana();
  const exploreRpc = await getExploreConnection();
  const rows = await Promise.all(verified.slice(0, 5).map(async item => {
    try {
        const signatures = await exploreRpc.getSignaturesForAddress(new PublicKey(item.mint), { limit: 1 }, 'confirmed');
      const latest = signatures[0];
      return { ...item, signature: latest?.signature || null, blockTime: latest?.blockTime ? latest.blockTime * 1000 : null };
    } catch { return { ...item, signature: null, blockTime: null }; }
  }));
  rows.sort((a, b) => (b.blockTime || 0) - (a.blockTime || 0));
    activity.innerHTML = rows.map(item => `<div><span class="activity-avatar ${item.icon === 'N' ? 'mint' : item.icon === 'T' ? 'yellow' : 'blue'}">${escapeHtml(item.icon)}</span><span><strong>${escapeHtml(item.name)} · ${escapeHtml(item.symbol)}</strong><small>${item.signature ? `Launch confirmed · ${formatOnchainAge(item.blockTime)}` : 'Mint account confirmed on-chain'}</small></span><b>${item.signature ? `<a class="onchain-receipt-link" href="${exploreExplorer(`tx/${item.signature}`)}" target="_blank" rel="noreferrer">View ↗</a>` : 'LIVE'}</b></div>`).join('');
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
  const splitHeading = document.querySelector('.split-panel h2');
  if (splitHeading) splitHeading.textContent = 'Policy route · 100% in / 80 · 20 out';
  const community = document.querySelectorAll('.community-section .signal-list>div b');
  if (community[0]) community[0].textContent = '—';
  if (community[1]) community[1].textContent = verified.length ? String(verified.length) : '—';
  if (community[2]) community[2].textContent = verified.length ? String(verified.filter(item => item.riskLevel === 'high').length) : '—';
  const communityBadge = document.querySelector('.community-section .data-badge');
  if (communityBadge) communityBadge.textContent = 'RPC state';
}
async function loadOnchainExploreData(){
    const pumpSort = exploreSort === 'newest' ? 'created_timestamp' : 'last_trade_timestamp';
    const birdeyeSort = exploreSort === 'change' ? 'price_change_24h_percent' : exploreSort === 'market-cap' ? 'market_cap' : 'volume_24h_usd';
    const [birdeyeFeed, pumpFeed] = await Promise.all([
      apiRequest(`/api/birdeye/explore?limit=40&sort_by=${encodeURIComponent(birdeyeSort)}`).catch(() => ({ available: false, data: null })),
      apiRequest(`/api/pump/explore?limit=40&sort=${encodeURIComponent(pumpSort)}`).catch(() => ({ available: false, data: null })),
    ]);
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
    if (records.length) {
      try {
        const { PublicKey, unpackMint, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } = await getSolana();
        const exploreRpc = await getExploreConnection();
        const candidates = records.flatMap(record => { try { return [{ record, mint: new PublicKey(record.address) }]; } catch { return []; } });
        const accounts = candidates.length ? await exploreRpc.getMultipleAccountsInfo(candidates.map(item => item.mint), 'confirmed') : [];
        for (let index = 0; index < candidates.length; index += 1) {
          const { record, mint } = candidates[index];
          try {
            const mintAccount = accounts[index];
            if (!mintAccount || (!mintAccount.owner.equals(TOKEN_PROGRAM_ID) && !mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID))) continue;
            unpackMint(mint, mintAccount, mintAccount.owner);
            const numeric = value => value == null || value === '' ? NaN : Number(value);
            const price = numeric(record.priceUsd);
            const change = numeric(record.priceChange24hPercent);
            const marketCap = numeric(record.marketCapUsd);
            verified.push({ mint: record.address, symbol: record.symbol || 'TOKEN', name: record.name || 'Unnamed token', value: Number.isFinite(price) ? formatUsd(price) : 'Price unavailable', change: Number.isFinite(change) ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}%` : '—', meta: `MC ${formatCompactUsd(marketCap)} · ${record.source || 'Pump.fun'}`, icon: String(record.symbol || 'T').slice(0, 1), source: record.source || 'Pump.fun', creator: record.creator || null, complete: record.complete, bondingCurve: record.bondingCurve || null, raydiumPool: record.raydiumPool || null, fetchedAt: record.fetchedAt || null, address: record.address, volume24hUsd: record.volume24hUsd ?? null, liquidityUsd: record.liquidityUsd ?? null, holders: record.holders ?? null, marketCapUsd: Number.isFinite(marketCap) ? marketCap : null, priceChange24hPercent: Number.isFinite(change) ? change : null, createdTimestamp: record.createdTimestamp || null, lastTradeUnixTime: record.lastTradeUnixTime || null });
        } catch {}
        }
      } catch { exploreVerificationFailed = true; }
    }
  assets = Array.from(new Map(verified.map(item => [item.address, item])).values());
    exploreUpdatedAt = new Date().toISOString();
    exploreProviderStatus = exploreVerificationFailed ? `Solana ${EXPLORE_CLUSTER} RPC unavailable` : !pumpFeed.available ? 'Launch feed unavailable' : !records.length ? 'No indexed launches · awaiting RPC verification' : EXPLORE_CLUSTER === 'devnet' ? 'Devnet registry · RPC verified' : !birdeyeFeed.available ? `Pump.fun · Birdeye unavailable · RPC verified` : 'Pump.fun + Birdeye · RPC verified';
    const feedStatus = document.querySelector('#explore-data-status');
    renderExploreAssets();
    if (feedStatus) {
      feedStatus.textContent = exploreProviderStatus;
    }
    renderRegistry();
  renderOnchainReportState(verified);
  await renderHomeOnchainSnapshot(verified);
}
loadOnchainExploreData().catch(() => {
  const status = document.querySelector('#home-live-status');
  const note = document.querySelector('#home-verified-launches-note');
  if (status) status.textContent = 'Solana RPC · unavailable';
  if (note) note.textContent = 'Unable to verify live data';
});
setInterval(() => { if (!document.hidden) loadOnchainExploreData().catch(() => {}); }, 30000);
setInterval(() => { if (!document.hidden) renderStonkEnhancements(); }, 30000);
const analyticsLaunchMetric = document.querySelector('.analytics-kpis article:nth-child(2)');
if (analyticsLaunchMetric) {
  const metric = analyticsLaunchMetric.querySelector('strong');
  const note = analyticsLaunchMetric.querySelector('small');
  if (metric) metric.textContent = '—';
  if (note) note.textContent = 'Awaiting verified indexer';
}
async function loadProtocolAnalytics(){
  const result = await apiRequest('/api/analytics/summary').catch(() => null);
  const data = result?.data;
  const isVerifiedOnchain = result?.available === true
    && data?.status === 'onchain-indexed'
    && String(data?.cluster || '').toLowerCase() === String(EXPLORE_CLUSTER).toLowerCase();
  if (!isVerifiedOnchain) {
    renderOnchainReportState(assets);
    return;
  }
  const cards = document.querySelectorAll('.analytics-kpis article');
  if (cards[0]) { cards[0].querySelector('strong').textContent = Number(data.grossCreatorFees || 0).toFixed(4); cards[0].querySelector('small').textContent = `${data.collections || 0} on-chain fee claims`; }
  if (cards[1]) { cards[1].querySelector('strong').textContent = String(data.launches || 0); cards[1].querySelector('small').textContent = `On-chain indexed · ${data.freshness || 'freshness unavailable'}`; }
  if (cards[2]) { cards[2].querySelector('strong').textContent = String(data.settlements || 0); cards[2].querySelector('small').textContent = `${Number(data.buybackAccrued || 0).toFixed(4)} on-chain buyback accrual`; }
}
loadProtocolAnalytics();
document.querySelector('#payment-list').innerHTML = payments.map(p => `<div class="payment-row"><span class="payment-avatar">${p[0]}</span><span><strong>${p[1]}</strong><small>${p[2]}</small></span><span class="payment-amount">${p[3]}<small> sample</small></span></div>`).join('');
document.querySelector('#payment-dialog-list').innerHTML = document.querySelector('#payment-list').innerHTML;
renderWatchlist();
let registryLaunches = [];
let registryTierFilter = 'all';
let registrySort = 'recent';
function refreshRegistryLaunches(){
  const indexed = assets.filter(item => item.address).map(item => ({
    ...item,
    tier: 'onchain',
    mint: item.address,
    sent: formatCompactUsd(item.marketCapUsd),
    owed: item.change,
    local: false,
  }));
  registryLaunches = indexed;
}
function renderRegistry(query = ''){
  refreshRegistryLaunches();
  const normalized = query.trim().toLowerCase();
  const filtered = registryLaunches.filter(item => (registryTierFilter === 'all' || item.tier === registryTierFilter) && `${item.name} ${item.symbol} ${item.mint}`.toLowerCase().includes(normalized));
  filtered.sort((a, b) => registrySort === 'recent' ? Number(b.createdTimestamp || 0) - Number(a.createdTimestamp || 0) : registrySort === 'market-cap' ? Number(b.marketCapUsd || 0) - Number(a.marketCapUsd || 0) : Number(b.priceChange24hPercent || 0) - Number(a.priceChange24hPercent || 0));
  document.querySelector('#launch-list').innerHTML = filtered.map(item => `<div class="launch-row"><span class="launch-row-icon asset-icon">${escapeHtml(item.icon)}</span><span class="launch-row-main"><strong>${escapeHtml(item.name)} <small>(${escapeHtml(item.symbol)})</small> <em class="tier-badge ${escapeHtml(item.tier)}">${escapeHtml(item.tier.toUpperCase())}</em></strong><small>${escapeHtml(item.mint)}</small></span><span class="launch-row-stats"><b>${escapeHtml(item.sent)}</b><small>Market cap</small><b>${escapeHtml(item.owed)}</b><small>24h</small></span><button type="button" class="copy-row" data-mint="${escapeHtml(item.mint)}" aria-label="Copy ${escapeHtml(item.symbol)} mint address">⧉</button><button type="button" class="trade-row" data-trade-mint="${escapeHtml(item.mint)}">Trade</button></div>`).join('') || '<div class="empty-state">No launches match this search and tier.</div>';
}
renderRegistry();
const registryTierFilters = document.querySelector('.launch-tier-filters');
if (registryTierFilters && !registryTierFilters.querySelector('[data-registry-tier="premier"]')) {
  const premierFilter = document.createElement('button');
  premierFilter.type = 'button';
  premierFilter.dataset.registryTier = 'premier';
  premierFilter.textContent = 'Premier';
  registryTierFilters.insertBefore(premierFilter, registryTierFilters.querySelector('small'));
}

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
    wallet = { publicKey, isConnected: true, signTransaction: async () => { throw new Error('Mobile wallet connected. Open this app inside Phantom to approve transactions.'); }, disconnect: async () => {} };
    sessionStorage.removeItem('funded.app.phantom.mobile.connect');
    history.replaceState({}, document.title, `${window.location.pathname}${state.returnHash || ''}`);
    setWalletState('Wallet connected', publicKey.toBase58(), true);
    showToast('Phantom wallet connected from phone');
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
function setCurveMonitor(snapshot){
  const state = document.querySelector('#curve-monitor-state'); const progress = document.querySelector('#curve-progress-bar');
  const progressValue = document.querySelector('#curve-progress-value'); const virtualSol = document.querySelector('#curve-virtual-sol');
  const realTokens = document.querySelector('#curve-real-tokens'); const updated = document.querySelector('#curve-updated');
  if (!snapshot) { if (state) state.textContent = 'Not loaded'; return; }
  if (state) { state.textContent = snapshot.complete ? 'Graduated' : 'Live'; state.className = snapshot.complete ? 'funded-mint-invalid' : 'funded-mint-valid'; }
  if (progress) progress.style.width = `${snapshot.progressPercent.toFixed(2)}%`;
  if (progressValue) progressValue.textContent = `${snapshot.progressPercent.toFixed(2)}%`;
  if (virtualSol) virtualSol.textContent = `${snapshot.virtualQuoteReservesSol.toFixed(4)} SOL`;
  if (realTokens) realTokens.textContent = snapshot.realTokenReserves.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (updated) updated.textContent = new Date(snapshot.observedAt).toLocaleTimeString();
}
async function refreshCurveMonitor({ quiet = false } = {}){
  const mint = document.querySelector('#trade-mint')?.value.trim();
  if (!mint) { setCurveMonitor(null); if (!quiet) setTradeStatus('Paste a created coin mint to monitor its bonding curve.'); return; }
  try {
    const snapshot = await fetchBondingCurveSnapshot({ connection: connection || (await getSolana(), connection), mint });
    setCurveMonitor(snapshot);
    setTradeStatus(snapshot.complete ? 'Curve complete. Preview a trade to verify the canonical graduated SOL pool.' : 'Curve is fresh and tradeable on Devnet.');
  } catch (error) { setCurveMonitor(null); setTradeStatus(`Curve monitor failed: ${error.message}`, true); }
}
function updateTradeAmountLabel(){ const side = document.querySelector('#trade-side')?.value; const label = document.querySelector('#trade-amount-label'); if (label) label.firstChild.textContent = side === 'sell' ? 'Token amount' : 'SOL amount'; }
function invalidateTradePreview(){
  tradePreview = null;
  const quote = document.querySelector('#trade-quote');
  const submit = document.querySelector('#trade-submit');
  if (quote) quote.textContent = 'Preview the current mint, amount, and slippage before signing.';
  if (submit) submit.disabled = true;
}
async function previewTrade(){
  if (!wallet) { await connectWallet(); if (!wallet) return; }
  const mint = document.querySelector('#trade-mint').value.trim();
  const side = document.querySelector('#trade-side').value;
  const amount = Number(document.querySelector('#trade-amount').value);
  const slippagePercent = Number(document.querySelector('#trade-slippage').value);
  if (!mint || !Number.isFinite(amount) || amount <= 0) return setTradeStatus('Enter a mint and a positive amount to preview.', true);
  const button = document.querySelector('#trade-preview'); button.disabled = true;
  invalidateTradePreview();
  try {
    await getSolana();
    const trade = await buildTradeTransaction({ connection, side, mint, user: wallet.publicKey, amount, slippagePercent, feeOwner: TRADE_FEE_OWNER, feeBps: TRADE_FEE_BPS });
    const quote = describeTradeQuote(trade, slippagePercent);
    const inputKey = `${mint}:${side}:${amount}:${slippagePercent}:${wallet.publicKey.toBase58()}`;
    tradePreview = { trade, inputKey, preparedAt: Date.now() };
    document.querySelector('#trade-quote').textContent = `${quote.route === 'graduated-pool' ? 'Graduated pool' : 'Pump curve'} · Estimated receive: ${quote.expected.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${quote.outputSymbol}. Slippage floor: ${quote.minimum.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${quote.outputSymbol}. App fee: ${quote.appFeeSol.toFixed(6)} SOL, plus network and Pump fees. Quote expires in 15 seconds.`;
    document.querySelector('#trade-submit').disabled = false;
    setTradeStatus('Review this quote and the transaction in your wallet before signing.');
  } catch (error) { setTradeStatus(`Quote unavailable: ${error.message}`, true); }
  finally { button.disabled = false; }
}
async function executeTrade(){
  if (!wallet) return setTradeStatus('Connect a wallet and preview the trade first.', true);
  const mint = document.querySelector('#trade-mint').value.trim(); const side = document.querySelector('#trade-side').value;
  const amount = Number(document.querySelector('#trade-amount').value); const slippagePercent = Number(document.querySelector('#trade-slippage').value);
  if (!mint || !Number.isFinite(amount) || amount <= 0) { setTradeStatus('Enter a valid mint and positive trade amount.', true); return; }
  if (!TRADE_FEE_OWNER) { setTradeStatus('Trading is disabled: configure VITE_FUNDED_TRADE_FEE_OWNER for the app owner.', true); return; }
  const inputKey = `${mint}:${side}:${amount}:${slippagePercent}:${wallet.publicKey.toBase58()}`;
  if (!tradePreview || tradePreview.inputKey !== inputKey || Date.now() - tradePreview.preparedAt > 15_000) { invalidateTradePreview(); setTradeStatus('Quote changed or expired. Preview again before signing.', true); return; }
  const button = document.querySelector('#trade-submit'); button.disabled = true;
  try {
    const result = await submitTrade({ connection: connection || (await getSolana(), connection), provider: wallet, side, mint, user: wallet.publicKey, amount, slippagePercent, feeOwner: TRADE_FEE_OWNER, feeBps: TRADE_FEE_BPS, preparedTrade: tradePreview.trade, onStatus: setTradeStatus });
    setCurveMonitor(result.snapshot); setTradeStatus(`${side === 'buy' ? 'Buy' : 'Sell'} confirmed: ${result.signature}. App fee: ${(result.feeLamports / 1_000_000_000).toFixed(6)} SOL.`);
    showToast(`${side === 'buy' ? 'Buy' : 'Sell'} confirmed on Devnet`); refreshWalletInfo();
  } catch (error) { setTradeStatus(`Trade failed or confirmation unavailable: ${error.message}`, true); } finally { invalidateTradePreview(); }
}
function openInfoDialog(kind){
  const content = {
    terms: ['Terms of Use', '<div class="legal-meta"><span>Effective 18 Sep 2026</span><span>Version 1.0</span><span>Applies to funded.vip Devnet tools</span></div><p>Use the Devnet launcher for testing only. You are responsible for reviewing every transaction before signing and for complying with applicable rules.</p><h3>Contents</h3><ul class="legal-list"><li>Wallet connection and signatures</li><li>Token metadata and deployer responsibility</li><li>Network, fees, and transaction confirmation</li><li>Prohibited use and service limitations</li><li>Privacy, disclosures, and support</li></ul><p class="muted-note">This is a product disclosure for the local build, not legal advice or a production agreement.</p>'],
  disclosures: ['Disclosures', '<div class="legal-meta"><span>Effective 19 Sep 2026</span><span>Version 1.3</span><span>Applies to the Devnet preview</span></div><p>The Pump Devnet flow creates the coin with the verified funded.vip router PDA written directly into Pump’s creator field. The paying wallet never receives creator-fee authority, and the app reads the bonding curve back before reporting success.</p><h3>Important limits</h3><ul class="legal-list"><li>Devnet SOL has no intended monetary value.</li><li>The production router program, claim worker, settlement services, payout rails, and treasury controls are not deployed by this frontend.</li><li>Permanent token metadata, community-vault funding, X recipient verification, and payout execution require production services that are not connected.</li><li>Pump protocol administrators or a future Pump program upgrade remain outside funded.vip’s control.</li><li>funded.vip is not affiliated with X, Phantom, or Pump.fun.</li></ul><p class="muted-note">Verify the Pump creator address in the launch transaction and bonding-curve account on Solana Explorer.</p>'],
    capital: ['Capital flow', '<p>This chart shows the flow model. Connect a data source to replace the example series with indexed activity.</p>'],
    'opt-out': ['Opt out', '<div class="legal-meta"><span>Account controls</span><span>Devnet preview</span></div><p>Request that an account or project be excluded from future indexed activity feeds. This local build does not run a payout or indexing backend yet.</p><div class="optout-steps"><div><b>1</b><span><strong>Sign in with X</strong><small>Verify control of the account you want to manage.</small></span></div><div><b>2</b><span><strong>Choose exclusions</strong><small>Hide the account from discovery and stop new recipient selections.</small></span></div><div><b>3</b><span><strong>Review status</strong><small>Confirm the effective date and any unpaid-fee handling.</small></span></div></div><button type="button" class="secondary-button info-action" disabled>Checking account status…</button><p class="muted-note">X sign-in, indexed exclusions, and payout handling are not connected in this Devnet build.</p>'],
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
function getProvider(){
  const candidates = [window.phantom?.solana, window.solana, window.backpack?.solana, window.solflare];
  return candidates.find(provider => provider && typeof provider.connect === 'function' && typeof provider.signTransaction === 'function') || null;
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
    ? { ready: false, message: PROTOCOL_FUNDED_MINT ? 'Connect a wallet to verify its $FUNDED balance.' : 'The fixed $FUNDED mint is not configured.' }
    : { ready: true, message: 'No creator-funded burn is required.' };
  estimatedLaunchFeeLamports = null;
  renderLaunchBurnSelection();
  updateLaunchPreview();
  updateCostSummary();
  updateLaunchButton();
  if (wallet && policy.requiresBurn && PROTOCOL_FUNDED_MINT) refreshWalletInfo();
}
function updateCostSummary(){
  const launchNode = document.querySelector('#cost-launch');
  const totalNode = document.querySelector('#cost-total-enabled');
  const headlineNode = document.querySelector('#cost-total');
  const noteNode = document.querySelector('#cost-note');
  const previewLaunchNode = document.querySelector('#preview-launch-cost');
  const burnNode = document.querySelector('#cost-burn');
  const burnPolicy = getLaunchBurnPolicy();
  if (burnNode) burnNode.textContent = burnPolicy.requiresBurn ? `${formatLaunchBurnAmount(burnPolicy.amountTokens)} $FUNDED · irreversible` : 'None';
  if (!launchNode || !totalNode || !headlineNode || !noteNode) return;
  if (estimatedLaunchFeeLamports == null) {
    launchNode.textContent = walletMetricsLoading ? 'Calculating…' : 'Connect wallet to estimate';
    totalNode.textContent = '—';
    headlineNode.textContent = '—';
    if (previewLaunchNode) previewLaunchNode.textContent = walletMetricsLoading ? 'Calculating…' : 'Connect wallet';
    noteNode.textContent = 'Connect Phantom to build and estimate the exact transaction.';
    return;
  }
  const launchSol = Number(estimatedLaunchFeeLamports) / 1_000_000_000;
  launchNode.textContent = `${launchSol.toFixed(4)} SOL`;
  totalNode.textContent = `${launchSol.toFixed(4)} SOL`;
  headlineNode.textContent = `${launchSol.toFixed(4)} SOL now`;
  if (previewLaunchNode) previewLaunchNode.textContent = `${launchSol.toFixed(4)} SOL`;
  noteNode.textContent = 'This is the Pump creation transaction estimate. No separate funded.vip launch fee is charged.';
}
function setWalletMetrics({ balance = null, fee = null, loading = false } = {}){
  const panel = document.querySelector('#wallet-metrics');
  const note = document.querySelector('#fee-note');
  walletMetricsLoading = loading;
  if (!wallet) { walletBalanceLamports = null; estimatedLaunchFeeLamports = null; panel.hidden = true; note.hidden = true; document.querySelector('#profile-balance').textContent = 'Connect to load'; updateCostSummary(); updateLaunchButton(); return; }
  panel.hidden = false;
  note.hidden = false;
  if (!loading) { walletBalanceLamports = balance; estimatedLaunchFeeLamports = fee; }
  document.querySelector('#wallet-balance').textContent = loading ? 'Loading…' : balance == null ? 'Unavailable' : formatSol(balance);
  document.querySelector('#launch-fee').textContent = loading ? 'Calculating…' : fee == null ? 'Unavailable' : `≈ ${formatSol(fee)}`;
  document.querySelector('#profile-balance').textContent = loading ? 'Loading…' : balance == null ? 'Unavailable' : formatSol(balance);
  const headerBalance = document.querySelector('#header-wallet-balance');
  if (headerBalance) headerBalance.textContent = loading ? '… SOL' : balance == null ? '— SOL' : formatSol(balance);
  note.textContent = loading
    ? 'Checking wallet balance and estimated launch cost…'
    : balance == null || fee == null
      ? 'Unable to verify the wallet balance and launch cost. Refresh the estimate before launching.'
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
  document.querySelector('#preview-name').textContent = name || 'Token name';
  document.querySelector('#preview-symbol').textContent = symbol || 'TICKER';
  const description = document.querySelector('#token-description')?.value || '';
  const descriptionCounter = document.querySelector('#token-description-counter');
  if (descriptionCounter) descriptionCounter.textContent = `${description.length}/280 · stored in this launch draft only`;
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
      ? 'Creator-directed policy totals 80%.'
      : !validation.sharesValid
        ? 'Each creator destination must be between 0% and 80%.'
        : !validation.xRecipientValid
          ? 'Enter a valid X account for SOL claim rewards.'
          : `Creator-directed allocation totals ${validation.total.toFixed(1)}%; it must equal 80%.`;
    feeStatus.className = `field-help ${validation.valid ? 'funded-mint-valid' : 'funded-mint-invalid'}`;
  }
  document.querySelector('#review-coin').textContent = name && symbol ? `${name} (${symbol})` : 'Add name and ticker';
  document.querySelector('#review-community').textContent = `${allocation}% of supply`;
  document.querySelector('#review-creator-share').textContent = `${feeDistribution.creatorWalletPercent}% of gross fees`;
  document.querySelector('#review-holder-share').textContent = `${feeDistribution.holderAirdropPercent}% of gross fees`;
   document.querySelector('#review-x-share').textContent = feeDistribution.solClaimPercent > 0 ? `${feeDistribution.solClaimPercent}% claimable by ${recipient || 'missing account'}` : 'Not selected';
  document.querySelector('#review-burn-tier').textContent = `${launchBurn.label}${launchBurn.requiresBurn ? ' · verified badge' : ' · no burn'}`;
  document.querySelector('#review-burn-amount').textContent = launchBurn.requiresBurn ? `${formatLaunchBurnAmount(launchBurn.amountTokens)} $FUNDED · atomic` : 'None';
  renderLaunchBurnSelection();
  updateLaunchNavigation();
}
function getLaunchMetadataPreview(){
  const image = document.querySelector('#token-image')?.files?.[0];
  return {
    description: document.querySelector('#token-description')?.value.trim() || '',
    website: document.querySelector('#token-website')?.value.trim() || '',
    x: document.querySelector('#token-x')?.value.trim() || '',
    telegram: document.querySelector('#token-telegram')?.value.trim() || '',
    discord: document.querySelector('#token-discord')?.value.trim() || '',
    imageName: image?.name || '',
    imageType: image?.type || '',
  };
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
  const burnConfigured = validateLaunchBurnPolicy(launchBurn).valid;
  const burnReady = !launchBurn.requiresBurn || launchBurnReadiness.ready;
  const xRouteReady = feeDistribution.shares.solClaimPercent === 0;
  const policyValid = Number.isFinite(allocation) && allocation >= 3 && allocation <= 50 && feeDistribution.valid && xRouteReady && feeRouterState.verified && burnConfigured && burnReady;
  const ready = Boolean(wallet && !walletMetricsLoading && !balanceUnknown && !insufficient && policyValid && document.querySelector('#terms-agree')?.checked && document.querySelector('#fee-route-agree')?.checked && document.querySelector('#token-name').value.trim() && document.querySelector('#token-symbol').value.trim());
  button.disabled = !ready;
  button.textContent = !xRouteReady ? 'X fee router not deployed' : !feeRouterState.verified ? 'Fee router required' : !burnConfigured ? '$FUNDED mint required' : launchBurn.requiresBurn && !burnReady ? 'Verify $FUNDED balance' : !wallet ? 'Connect wallet to launch' : walletMetricsLoading ? 'Calculating launch cost' : balanceUnknown ? 'Verify wallet balance first' : insufficient ? 'Insufficient SOL for launch' : !document.querySelector('#fee-route-agree')?.checked ? 'Confirm the fee route' : !document.querySelector('#terms-agree')?.checked ? 'Agree to terms to launch' : !policyValid ? 'Complete launch policy' : ready ? 'Launch and verify' : 'Add name and ticker';
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
      if (!distribution.xRecipientValid) return { valid: false, message: 'Enter a valid X account for SOL claim rewards.' };
      return { valid: false, message: 'Creator wallet, holder rewards, and SOL claim must total exactly 80%.' };
    }
    if (distribution.shares.solClaimPercent > 0) return { valid: false, message: 'X fee forwarding requires a deployed per-coin router and verified claim keeper. This route is not live yet.' };
    const launchBurn = getLaunchBurnPolicy();
    const burnValidation = validateLaunchBurnPolicy(launchBurn);
    if (!burnValidation.valid) return { valid: false, message: 'The protocol $FUNDED mint must be configured before a paid burn tier can launch.' };
    return { valid: true, message: launchBurn.requiresBurn ? `${launchBurn.label} selected: ${formatLaunchBurnAmount(launchBurn.amountTokens)} $FUNDED will burn atomically.` : launchMode === 'quick' ? 'Recommended distribution selected.' : 'Custom distribution is balanced.' };
  }
  if (step === 3) {
    if (!feeRouterState.verified) return { valid: false, message: 'The verified fee-router PDA is required before signing.' };
    if (!wallet) return { valid: false, message: 'Connect Phantom to continue to signing.' };
    if (walletMetricsLoading) return { valid: false, message: 'Wait while the launch cost is calculated.' };
    if (walletBalanceLamports == null || estimatedLaunchFeeLamports == null) return { valid: false, message: 'Refresh the wallet balance and launch estimate.' };
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
async function refreshWalletInfo(){
  if (!wallet) { setWalletMetrics(); return; }
  const request = ++metricsRequest;
  setWalletMetrics({ loading: true });
  try {
    if (!feeRouterState.verified || !feeRouterState.address) throw new Error('Fee router is not ready.');
    const [{ PUMP_SDK }, { normalizeLaunchInput }, { prepareFundedLaunchBurn }] = await Promise.all([import('@pump-fun/pump-sdk'), import('./launch-core.js'), import('./launch-flow.js')]);
    const { Keypair, PublicKey, Transaction } = await getSolana();
    const balancePromise = connection.getBalance(wallet.publicKey, 'confirmed');
    const name = document.querySelector('#token-name').value.trim() || 'Devnet Coin';
    const symbol = document.querySelector('#token-symbol').value.trim().toUpperCase() || 'COIN';
    const input = normalizeLaunchInput({ name, symbol, supply: 1_000_000_000, decimals: 6 });
    const mint = Keypair.generate();
    const router = new PublicKey(feeRouterState.address);
    const createInstruction = await PUMP_SDK.createV2Instruction({ mint: mint.publicKey, name: input.name, symbol: input.symbol, uri: `https://funded.vip/devnet-metadata/${mint.publicKey.toBase58()}`, creator: router, user: wallet.publicKey, mayhemMode: false, holderReward: false });
    const launchBurn = getLaunchBurnPolicy();
    const burnPlan = launchBurn.requiresBurn
      ? await prepareFundedLaunchBurn({ connection, payer: wallet.publicKey, fundedMint: launchBurn.fundedMint, amountTokens: launchBurn.amountTokens })
      : null;
    const launchTransaction = new Transaction();
    if (burnPlan) launchTransaction.add(burnPlan.instruction);
    launchTransaction.add(createInstruction);
    const latest = await connection.getLatestBlockhash('confirmed');
    launchTransaction.recentBlockhash = latest.blockhash;
    launchTransaction.feePayer = wallet.publicKey;
    const launchFee = await connection.getFeeForMessage(launchTransaction.compileMessage(), 'confirmed');
    const fee = launchFee.value ?? 5_000;
    const balance = await balancePromise;
    if (request !== metricsRequest) return;
    launchBurnReadiness = burnPlan
      ? { ready: true, message: `Wallet verified for an atomic ${formatLaunchBurnAmount(launchBurn.amountTokens)} $FUNDED burn.` }
      : { ready: true, message: 'No creator-funded burn is required.' };
    renderLaunchBurnSelection();
    setWalletMetrics({ balance, fee });
  } catch (error) {
    if (request === metricsRequest) {
      const launchBurn = getLaunchBurnPolicy();
      if (launchBurn.requiresBurn) {
        launchBurnReadiness = { ready: false, message: error?.message || 'The $FUNDED burn could not be prepared.' };
        renderLaunchBurnSelection();
      }
      setWalletMetrics({ balance: null, fee: null });
    }
  }
}
function setWalletState(message, detail = '', connected = false){
  const status = document.querySelector('#wallet-status');
  status.innerHTML = `<span class="status-ring">${connected ? '✓' : '?'}</span><span><strong>${message}</strong><small>${detail}</small></span><button type="button" class="small-button" id="dialog-connect">${connected ? 'Disconnect' : 'Connect'}</button>`;
  document.querySelector('#dialog-connect').addEventListener('click', connected ? disconnectWallet : connectWallet);
  const header = document.querySelector('#connect-button');
  header.innerHTML = connected ? `Wallet ${wallet.publicKey.toBase58().slice(0, 4)}…${wallet.publicKey.toBase58().slice(-4)} <span class="header-wallet-balance" id="header-wallet-balance">— SOL</span> <span>✓</span>` : 'Connect wallet <span>↗</span>';
  header.onclick = connected ? disconnectWallet : connectWallet;
  const sidebarName = document.querySelector('#sidebar-wallet-name');
  const sidebarAddress = document.querySelector('#sidebar-wallet-address');
  const sidebarAvatar = document.querySelector('#sidebar-wallet-avatar');
  if (sidebarName) sidebarName.textContent = connected ? 'Wallet connected' : 'Wallet not connected';
  if (sidebarAddress) sidebarAddress.textContent = connected ? `${detail.slice(0, 4)}…${detail.slice(-4)}` : 'Phantom signs locally';
  if (sidebarAvatar) sidebarAvatar.textContent = connected ? '✓' : '◎';
  document.querySelector('#profile-address').textContent = connected ? `${detail.slice(0, 6)}…${detail.slice(-6)}` : 'Not connected';
  document.querySelector('#profile-status').textContent = connected ? 'Connected locally. Phantom remains the only signer and private keys never enter this app.' : 'This profile is local to the demo workspace.';
  if (connected) { bindAppReferralToWallet(); void syncServerReferralState().then(() => { updateReferralLink(); return refreshReferralClaims(); }); }
  updateReferralLink();
  updateOnboardingProgress();
  renderAirdropClaims();
  updateLaunchButton();
  if (connected) refreshWalletInfo(); else setWalletMetrics();
}
async function connectWallet(){
  const provider = getProvider();
  if (!provider) {
    const message = 'No injected wallet was found. Open funded.vip in Chrome or Edge with Phantom, Backpack, or Solflare installed.';
    setWalletState('Wallet unavailable', message);
    setLaunchStatus('No injected Solana wallet was detected in this browser.', true);
    const header = document.querySelector('#connect-button');
    if (header) { header.title = message; header.setAttribute('aria-label', message); }
    openMobileWalletDialog();
    return;
  }
  try { const { connectWalletProvider } = await import('./wallet-core.js'); const connected = await connectWalletProvider(provider); wallet = connected.provider; setWalletState('Wallet connected', connected.publicKey.toBase58(), true); setLaunchStatus(`Ready to sign with ${connected.publicKey.toBase58()}`); }
  catch (error) {
    const message = `Connection failed: ${error.message}`;
    setWalletState('Connection failed', 'Check Phantom and try again.');
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
  if (typeof wallet.signMessage !== 'function') { if (status) status.textContent = 'This wallet cannot sign claim messages.'; return; }
  const button = document.querySelector('#sol-claim-submit'); if (button) button.disabled = true;
  try {
    if (status) status.textContent = 'Preparing claim…';
    const prepared = await apiRequest(`/api/sol-claims/${encodeURIComponent(claimId)}/prepare`, { method: 'POST', body: { xHandle: handle } });
    if (status) status.textContent = 'Requesting wallet signature…';
    const message = new TextEncoder().encode(prepared.data.statement);
    const signed = await wallet.signMessage(message);
    const publicKey = wallet.publicKey.toBase58();
    const verified = await apiRequest(`/api/sol-claims/${encodeURIComponent(claimId)}/verify`, { method: 'POST', body: { xHandle: handle, publicKey, signature: bs58.encode(signed.signature || signed) } });
    if (status) status.textContent = 'Wallet verified. A trusted X identity attestation and router-backed keeper payout are still required; no SOL was sent.';
    showToast('Wallet verified; X payout is pending');
    return { verified };
  } catch (error) { if (status) status.textContent = error.message || 'Claim failed.'; showToast(error.message || 'Claim failed'); }
  finally { if (button) button.disabled = false; }
}
async function disconnectWallet(){ try { await getProvider()?.disconnect(); } catch {} wallet = null; metricsRequest++; invalidateTradePreview(); setWalletState('Wallet not connected', 'Connect Phantom to continue'); setLaunchStatus(''); }
function handleAccountChanged(publicKey){
  if (!publicKey) { disconnectWallet(); return; }
  const provider = getProvider();
  if (!provider || !wallet) return;
  wallet = provider;
  setWalletState('Wallet connected', publicKey.toBase58(), true);
  setLaunchStatus(`Wallet changed. Ready to sign with ${publicKey.toBase58()}`);
}
function openLaunchDialog(event){ event?.preventDefault(); const dialog = document.querySelector('#launch-dialog'); if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal(); else dialog.setAttribute('open', ''); setLaunchStep(1); if (wallet) setWalletState('Wallet connected', wallet.publicKey.toBase58(), true); }
async function requestAirdrop(){
  if (!wallet) { await connectWallet(); if (!wallet) return; }
  const button = document.querySelector('#airdrop-button'); button.disabled = true;
  try { const { LAMPORTS_PER_SOL } = await getSolana(); setLaunchStatus('Requesting 1 Devnet SOL…'); const signature = await connection.requestAirdrop(wallet.publicKey, LAMPORTS_PER_SOL); await connection.confirmTransaction(signature, 'confirmed'); setLaunchLinks('Airdrop confirmed.', [{ label: 'View airdrop transaction on Explorer', href: explorer(`tx/${signature}`) }]); refreshWalletInfo(); }
  catch (error) { const message = String(error?.message || error); const lower = message.toLowerCase(); const faucetIssue = message.includes('429') || lower.includes('rate limit') || lower.includes('faucet') || lower.includes('internal error') || lower.includes('service unavailable') || lower.includes('timed out'); if (faucetIssue) setLaunchLinks('Devnet faucet is unavailable or rate-limited. Fund this wallet manually, then retry.', [{ label: 'Open Solana Faucet', href: 'https://faucet.solana.com/' }], true); else setLaunchStatus(`Airdrop failed: ${message}`, true); } finally { button.disabled = false; }
}
async function launchToken(){
  if (!wallet) { await connectWallet(); if (!wallet) return; }
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
   if (feeDistributionInput.solClaimPercent > 0 && !/^@[A-Za-z0-9_]{1,15}$/.test(xRecipient)) { setLaunchStatus('Enter a valid X handle such as @account when SOL claim rewards are above 0%.', true); return; }
  if (feeDistributionInput.solClaimPercent > 0) { setLaunchStatus('X fee forwarding is blocked until the isolated per-coin router and verified claim keeper are deployed.', true); return; }
  if (!feeDistribution.valid) { setLaunchStatus('Creator fee shares must total exactly 80%. Check the wallet, holder, and X percentages.', true); return; }
  if (!launchBurnValidation.valid) { setLaunchStatus('The fixed $FUNDED mint must be configured before a paid launch tier can be used.', true); return; }
  if (launchBurn.requiresBurn && !launchBurnReadiness.ready) { setLaunchStatus(launchBurnReadiness.message, true); return; }
  if (!feeRouterState.verified || !feeRouterState.address) { setLaunchStatus('Launch blocked until the funded.vip fee-router PDA is deployed and verified on Devnet.', true); return; }
  if (walletBalanceLamports == null || estimatedLaunchFeeLamports == null) { setLaunchStatus('Wallet balance and launch cost could not be verified. Refresh the estimate before signing.', true); return; }
  if (walletBalanceLamports != null && estimatedLaunchFeeLamports != null && walletBalanceLamports < estimatedLaunchFeeLamports) { setLaunchStatus('Insufficient Devnet SOL for this launch. Fund the wallet, then refresh the balance and fee estimate before signing.', true); return; }
  const launchButton = document.querySelector('#launch-button'); launchButton.disabled = true;
  try {
    const [{ submitPumpDevnetLaunch }, { devnetExplorer }] = await Promise.all([import('./launch-flow.js'), import('./launch-core.js')]);
    const result = await submitPumpDevnetLaunch({ connection, provider: wallet, payer: wallet.publicKey, input: { name, symbol, supply, decimals }, feeRouterAddress: feeRouterState.address, launchBurn, onStatus: setLaunchStatus });
    const launchPolicy = {
      chain: 'solana',
      cluster: 'devnet',
      launchpad: 'pump',
      mint: result.mint.publicKey.toBase58(),
      creatorWallet: wallet.publicKey.toBase58(),
      name: result.name,
      symbol: result.symbol,
      metadataPreview,
      supply,
      decimals,
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
      feeRouter: buildFeeRouterPolicy(feeRouterState),
      feeDistribution: buildFeeDistributionPolicy({ ...feeDistributionInput, feeRouterAddress: feeRouterState.address }),
       solClaim: buildSolClaimPolicy({ handle: xRecipient, percent: feeDistributionInput.solClaimPercent, feeRouterAddress: feeRouterState.address }),
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
        router: feeRouterState.address,
        pumpCreator: result.feeRoute.creator,
        userHasCreatorFeeAuthority: result.feeRoute.userHasCreatorFeeAuthority,
        verified: result.feeRoute.verified,
        transaction: result.signature,
      },
      createdAt: new Date().toISOString(),
    };
    localStorage.setItem(`funded.launch.${launchPolicy.mint}`, JSON.stringify(launchPolicy));
    let persistedLaunch = { available: false };
    try {
      if (typeof wallet.signMessage !== 'function') throw new Error('Wallet message signing is required to register the immutable launch policy.');
      const policySignature = await wallet.signMessage(new TextEncoder().encode(launchPolicyStatement(launchPolicy)));
      launchPolicy.policySignature = bs58.encode(policySignature.signature || policySignature);
      persistedLaunch = await persistLaunchPolicy(launchPolicy);
    } catch (policyError) {
      setLaunchStatus(`Coin confirmed on Devnet, but policy registration is pending: ${policyError.message}`, true);
    }
    const tradeMint = document.querySelector('#trade-mint');
    if (tradeMint) tradeMint.value = launchPolicy.mint;
    refreshCurveMonitor({ quiet: true });
    if (persistedLaunch.available) await loadOnchainExploreData(); else renderRegistry();
    updateOnboardingProgress();
     setLaunchLinks(`Launch verified ✓\n${result.name} (${result.symbol}) is confirmed on Solana Devnet.\nMint: ${result.mint.publicKey.toBase58()}\nLaunch tier: ${launchBurn.label}${result.launchBurnReceipt ? ` · ${formatLaunchBurnAmount(result.launchBurnReceipt.amountTokens)} $FUNDED burned atomically` : ''}\nPump creator-fee owner: funded.vip router\nYour wallet has no creator-fee authority.\nCommunity policy: ${communityAllocation}% (${launchPolicy.communityAirdrop.reservedTokens.toLocaleString()} tokens)\nSettlement policy: 80% creator-directed / 20% app protocol${feeDistributionInput.solClaimPercent > 0 ? `\nSOL claim recipient: ${xRecipient}` : ''}`, [{ label: result.launchBurnReceipt ? 'Verify launch and burn on Explorer ↗' : 'Verify fee owner on Explorer ↗', href: devnetExplorer(`tx/${result.signature}`) }, { label: 'View mint on Explorer ↗', href: devnetExplorer(`address/${result.mint.publicKey.toBase58()}`) }, { label: 'Open My launches →', href: '#my-launches' }, { label: 'Publish community airdrop →', href: '#airdrops' }]);
    document.querySelector('#launch-status').classList.add('launch-complete');
    showToast(persistedLaunch.available ? `${result.symbol} launched and listed in Explore` : `${result.symbol} launched on-chain; Explore listing is pending API verification`); renderAirdropClaims(); refreshWalletInfo();
  } catch (error) { setLaunchStatus(`Launch failed: ${error.message}`, true); } finally { launchButton.disabled = false; }
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
document.querySelector('#launch-close').addEventListener('click', () => closeDialog('launch-dialog'));
document.querySelector('#dialog-connect').addEventListener('click', connectWallet);
document.querySelector('#airdrop-button').addEventListener('click', requestAirdrop);
document.querySelector('#refresh-wallet').addEventListener('click', refreshWalletInfo);
document.querySelectorAll('#token-name, #token-symbol, #token-description, #token-website, #token-x, #token-telegram, #token-discord, #x-recipient').forEach(input => input.addEventListener('input', () => { updateLaunchPreview(); updateLaunchButton(); }));
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
document.querySelectorAll('[data-burn-tier]').forEach(button => button.addEventListener('click', () => setLaunchBurnTier(button.dataset.burnTier)));
document.querySelectorAll('[data-launch-step-target]').forEach(button => button.addEventListener('click', () => { const target = Number(button.dataset.launchStepTarget); if (target < launchStep) setLaunchStep(target); else if (target === launchStep + 1 && getLaunchStepState(launchStep).valid) setLaunchStep(target); }));
document.querySelectorAll('[data-copy-referral-link]').forEach(button => button.addEventListener('click', async () => { const code = getReferralCode(); if (!code) { showToast('Connect your wallet to generate your invite link'); await connectWallet(); return; } const link = `${window.location.origin}${window.location.pathname}?ref=${code}`; try { await navigator.clipboard.writeText(link); trackReferralEvent('invite_link_copied'); showToast('Invite link copied'); } catch { showToast(link); } }));
function updateOnboardingProgress(){
  const steps = document.querySelectorAll('[data-onboarding-step]');
  if (!steps.length) return;
  const complete = { creator: Boolean(wallet), launch: getLocalLaunchPolicies().length > 0, share: Boolean(getReferralCode()) };
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
document.querySelector('#launch-button').addEventListener('click', launchToken);
document.querySelector('#simulate-button').addEventListener('click', simulateLaunch);
document.querySelector('#trade-refresh')?.addEventListener('click', () => refreshCurveMonitor());
document.querySelector('#trade-preview')?.addEventListener('click', previewTrade);
document.querySelector('#trade-submit')?.addEventListener('click', executeTrade);
document.querySelector('#sol-claim-submit')?.addEventListener('click', submitSolClaim);
document.querySelector('#trade-side')?.addEventListener('change', updateTradeAmountLabel);
document.querySelector('#trade-mint')?.addEventListener('change', () => { clearInterval(curveMonitorTimer); refreshCurveMonitor(); curveMonitorTimer = setInterval(() => refreshCurveMonitor({ quiet: true }), 15000); });
document.querySelectorAll('#trade-mint, #trade-amount, #trade-slippage, #trade-side').forEach(input => input.addEventListener('input', invalidateTradePreview));
updateTradeAmountLabel();
const pendingTradeMint = sessionStorage.getItem('funded.pendingTradeMint');
if (pendingTradeMint && document.querySelector('#trade-mint')) {
  document.querySelector('#trade-mint').value = pendingTradeMint;
  sessionStorage.removeItem('funded.pendingTradeMint');
  refreshCurveMonitor({ quiet: true });
  setTimeout(() => document.querySelector('#trade-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
}
document.querySelectorAll('a[href="#launch"]').forEach(link => link.addEventListener('click', openLaunchDialog));
document.querySelector('#launch-form').addEventListener('submit', event => event.preventDefault());
document.querySelector('#global-search').addEventListener('input', event => { exploreQuery = event.target.value; renderExploreAssets(); });
document.querySelector('#explore-sort')?.addEventListener('change', event => { exploreSort = event.target.value; renderExploreAssets(); loadOnchainExploreData().catch(() => {}); });
document.querySelector('#explore-risk-filter')?.addEventListener('change', event => { exploreRisk = event.target.value; renderExploreAssets(); });
document.querySelectorAll('[data-explore-tab]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-explore-tab]').forEach(item => item.classList.toggle('active', item === button));
  const tab = button.dataset.exploreTab;
  if (tab === 'new') { exploreSort = 'newest'; document.querySelector('#explore-sort').value = 'newest'; exploreRisk = 'all'; document.querySelector('#explore-risk-filter').value = 'all'; }
  else if (tab === 'watchlist') { exploreRisk = 'watchlist'; document.querySelector('#explore-risk-filter').value = 'watchlist'; }
  else { exploreSort = 'volume'; document.querySelector('#explore-sort').value = 'volume'; exploreRisk = 'all'; document.querySelector('#explore-risk-filter').value = 'all'; }
  renderExploreAssets();
  loadOnchainExploreData().catch(() => {});
}));
document.querySelectorAll('.registry-order button').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.registry-order button').forEach(item => item.classList.toggle('active', item === button));
  registrySort = button.textContent.trim() === 'Recent' ? 'recent' : button.textContent.trim() === 'Market cap' ? 'market-cap' : 'change';
  renderRegistry(document.querySelector('#registry-search').value);
}));
document.querySelector('#registry-search').addEventListener('input', event => renderRegistry(event.target.value));
document.querySelectorAll('[data-registry-tier]').forEach(button => button.addEventListener('click', () => {
  registryTierFilter = button.dataset.registryTier;
  document.querySelectorAll('[data-registry-tier]').forEach(item => item.classList.toggle('active', item === button));
  renderRegistry(document.querySelector('#registry-search').value);
}));
document.querySelector('#asset-grid').addEventListener('click', event => {
  const button = event.target.closest('.watch-button');
  const share = event.target.closest('.share-asset');
  if (share) {
    const symbol = share.dataset.shareSymbol;
    const url = `${window.location.origin}/token/${encodeURIComponent(share.dataset.shareMint || '')}`;
    if (navigator.share) navigator.share({ title: `${symbol} on funded.vip`, text: `Inspect ${symbol} on funded.vip`, url }).catch(() => {});
    else navigator.clipboard?.writeText(url).then(() => showToast(`${symbol} link copied`)).catch(() => showToast(url));
    return;
  }
 if (!button) return;
  const mint = button.dataset.mint;
  const asset = assets.find(item => item.address === mint);
  const symbol = asset?.symbol || 'TOKEN';
  const saved = getWatchlist();
  const next = saved.includes(mint) ? saved.filter(item => item !== mint) : [...saved, mint];
  saveWatchlist(next);
  renderExploreAssets();
  showToast(next.includes(symbol) ? `${symbol} saved to your watchlist` : `${symbol} removed from your watchlist`);
});
document.querySelector('#watchlist-items').addEventListener('click', event => {
  const button = event.target.closest('[data-remove-watch]');
  if (!button) return;
  saveWatchlist(getWatchlist().filter(item => item !== button.dataset.removeWatch));
  renderExploreAssets();
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
  showToast(`${symbol} selected — connect your wallet to verify eligibility`);
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
document.querySelector('#referral-example-input').addEventListener('input', event => {
  const fees = Math.max(0, Number(event.target.value) || 0);
  const fundedRevenue = fees * APP_ECONOMICS.fundedSharePercent / 100;
  APP_ECONOMICS.appReferralLevels.forEach(level => {
    const output = document.querySelector(`#referral-level-${level.level}-output`);
    if (output) output.textContent = `$${(fundedRevenue * level.percentOfFundedRevenue / 100).toFixed(2)}`;
  });
});
document.querySelector('#fee-flow-input')?.addEventListener('input', renderFeeFlowCalculator);
document.querySelectorAll('[data-proof-filter]').forEach(button => button.addEventListener('click', () => {
  const filter = button.dataset.proofFilter;
  document.querySelectorAll('[data-proof-filter]').forEach(item => item.classList.toggle('active', item === button));
  document.querySelectorAll('[data-proof-type]').forEach(row => { row.hidden = filter !== 'all' && row.dataset.proofType !== filter; });
}));
document.querySelector('#manage-alerts').addEventListener('click', () => showToast('Alerts are ready for the indexed-data phase.'));
document.querySelector('#launch-list').addEventListener('click', async event => {
  const copy = event.target.closest('.copy-row');
  if (copy) {
    try { await navigator.clipboard.writeText(copy.dataset.mint); showToast('Mint address copied'); } catch { showToast(copy.dataset.mint); }
    return;
  }
  const trade = event.target.closest('[data-trade-mint]');
  if (trade) {
    document.querySelector('#trade-mint').value = trade.dataset.tradeMint;
    document.querySelector('#trade-panel').scrollIntoView({ behavior: 'smooth', block: 'center' });
    refreshCurveMonitor();
  }
});
document.querySelectorAll('.quick-card, .text-button').forEach(el => el.addEventListener('click', () => { if (el.classList.contains('text-button')) showToast('View updated.'); }));
document.querySelectorAll('.segmented button').forEach(button => button.addEventListener('click', () => { button.parentElement.querySelector('.active').classList.remove('active'); button.classList.add('active'); showToast(`${button.textContent} view selected`); }));
  document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => openFilterDialog(button)));
  document.querySelectorAll('.recipient-chip').forEach(button => button.addEventListener('click', () => { button.parentElement.querySelector('.active')?.classList.remove('active'); button.classList.add('active'); showToast(`${button.textContent} recipients selected`); }));
document.querySelector('#filter-close').addEventListener('click', () => closeDialog('filter-dialog'));
document.querySelector('#notifications-button').addEventListener('click', () => document.querySelector('#notification-dialog').showModal());
document.querySelector('#capital-flow .icon-button')?.addEventListener('click', () => openInfoDialog('capital'));
document.querySelector('#open-menu').addEventListener('click', () => document.querySelector('#sidebar').classList.add('open'));
document.querySelector('#close-menu').addEventListener('click', () => document.querySelector('#sidebar').classList.remove('open'));
document.querySelectorAll('.nav-item').forEach(item => item.addEventListener('click', () => { document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active')); item.classList.add('active'); document.querySelector('#sidebar').classList.remove('open'); }));
if (location.pathname === '/explore') {
  document.body.classList.add('explore-route');
  const count = document.querySelector('#explore-launch-count');
  if (count) count.textContent = String(assets.length).padStart(2, '0');
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.getAttribute('href') === '#explore'));
}
document.querySelectorAll('a[href^="#"]').forEach(link => link.addEventListener('click', () => { if (link.getAttribute('href') !== '#launch' && !link.dataset.info) closeDialog('launch-dialog'); }));
window.addEventListener('hashchange', () => { if (location.hash !== '#launch') closeDialog('launch-dialog'); });
const existingProvider = getProvider();
if (existingProvider?.isConnected && existingProvider.publicKey && typeof existingProvider.signTransaction === 'function') { wallet = existingProvider; setWalletState('Wallet connected', wallet.publicKey.toBase58(), true); }
await handlePhantomMobileCallback();
captureAppReferral();
bindAppReferralToWallet();
updateReferralLink();
updateOnboardingProgress();
renderAirdropClaims();
renderBuybackDashboard();
renderFeeFlowCalculator();
await refreshFeeRouterConfig();
renderLaunchBurnSelection();
updateLaunchPreview();
updateCostSummary();
updateLaunchButton();
getProvider()?.on?.('disconnect', disconnectWallet);
getProvider()?.on?.('accountChanged', handleAccountChanged);
if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') document.querySelector('#simulate-button').hidden = true;

// Token detail route. Every displayed value comes from Solana RPC or the Pump
// bonding-curve account. Values that require an off-chain indexer stay explicit.
const TOKEN_METADATA_PROGRAM_ID = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';
let coinActivity = { status: 'loading', collections: [], claims: [], accounts: [] };
let coinLoadId = 0;
function getCoinMintAddress(){
  const pathMatch = location.pathname.match(/\/(?:token|launch\/coin)\/([^/?#]+)/i);
  if (pathMatch?.[1]) return decodeURIComponent(pathMatch[1]);
  const hashMatch = location.hash.match(/^#coin\/([^/?#]+)/i);
  const hashValue = hashMatch?.[1] ? decodeURIComponent(hashMatch[1]) : '';
  return hashValue.length > 20 ? hashValue : '';
}
function shortAddress(address){ return address ? `${address.slice(0, 6)}…${address.slice(-6)}` : '—'; }
function formatOnChainNumber(value, digits = 4){
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}
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
function setCoinTabLabels(){
  const labels = {
    payments: `Mint fee claims ${coinActivity.status === 'ready' && coinActivity.ledgerAvailable ? coinActivity.collections.length : '—'}`,
    claims: `Allocations ${coinActivity.status === 'ready' && coinActivity.ledgerAvailable ? coinActivity.claims.length : '—'}`,
    holders: `Largest accounts ${coinActivity.accountAvailable ? coinActivity.accounts.length : '—'}`,
  };
  document.querySelectorAll('[data-coin-tab]').forEach(item => { item.textContent = labels[item.dataset.coinTab] || item.textContent; });
}
function renderCoinActivityTab(){
  const activity = document.querySelector('#coin-activity-list');
  if (!activity) return;
  const tab = document.querySelector('[data-coin-tab].active')?.dataset.coinTab || 'payments';
  if (coinActivity.status === 'loading') {
    activity.innerHTML = '<div class="coin-activity-row"><span class="activity-icon">◎</span><span><strong>Reading token records</strong><small>Confirmed Solana RPC request in progress</small></span><b class="activity-amount">—</b><span class="activity-time">RPC</span></div>';
    return;
  }
  if (coinActivity.status === 'unavailable') {
    activity.innerHTML = `<div class="coin-activity-row"><span class="activity-icon">!</span><span><strong>Token data unavailable</strong><small>${escapeHtml(coinActivity.message || 'Solana RPC could not load this mint.')}</small></span><b class="activity-amount">—</b><span class="activity-time">RPC</span></div>`;
    return;
  }
  if (tab === 'holders') {
    if (!coinActivity.accountAvailable) { activity.innerHTML = '<div class="empty-state">Largest token accounts could not be read from Solana RPC.</div>'; return; }
    activity.innerHTML = coinActivity.accounts.length ? coinActivity.accounts.map(item => `<div class="coin-activity-row"><span class="activity-icon">◎</span><span><strong>${escapeHtml(shortAddress(item.address))}</strong><small>Token account · largest accounts sample</small></span><b class="activity-amount">${escapeHtml(item.amount)}</b><span class="activity-time">RPC</span></div>`).join('') : '<div class="empty-state">No token accounts were returned by Solana RPC.</div>';
    return;
  }
  if (!coinActivity.ledgerAvailable) {
    activity.innerHTML = '<div class="empty-state">Fee database is unavailable. No mint-attributed claim or allocation count can be confirmed.</div>';
    return;
  }
  if (tab === 'claims') {
    activity.innerHTML = coinActivity.claims.length ? coinActivity.claims.map(item => `<div class="coin-activity-row"><span class="activity-icon">◌</span><span><strong>Fee allocation ${escapeHtml(item.status)}</strong><small>Claim ${escapeHtml(shortAddress(item.claimSignature))} · ${escapeHtml(coinActivity.ledgerSource)}</small></span><b class="activity-amount">${item.grossCreatorFees == null ? '—' : escapeHtml(formatOnChainNumber(Number(item.grossCreatorFees), 6))} ${escapeHtml(item.asset)}</b><span class="activity-time">${escapeHtml(item.claimedAt ? new Date(item.claimedAt).toLocaleDateString() : 'recorded')}</span></div>`).join('') : '<div class="empty-state">No verified allocation is attributed to this mint. Shared-router claims are not counted per coin.</div>';
    return;
  }
  const mintRows = coinActivity.collections.map(item => `<div class="coin-activity-row"><span class="activity-icon">↗</span><span><strong>Mint-attributed fee claim</strong><small><a href="${escapeHtml(exploreExplorer(`tx/${item.signature}`))}" target="_blank" rel="noreferrer">View ${escapeHtml(shortAddress(item.signature))} on Explorer ↗</a> · ${escapeHtml(coinActivity.ledgerSource)}</small></span><b class="activity-amount">${item.collectedLamports == null ? '—' : escapeHtml(formatOnChainNumber(Number(item.collectedLamports) / 1_000_000_000, 6))} SOL</b><span class="activity-time">${escapeHtml(item.recordedAt ? new Date(item.recordedAt).toLocaleDateString() : 'recorded')}</span></div>`).join('');
  const routerRows = (coinActivity.sharedRouterCollections || []).map(item => `<div class="coin-activity-row"><span class="activity-icon">↗</span><span><strong>Shared-router fee collection</strong><small><a href="${escapeHtml(exploreExplorer(`tx/${item.signature}`))}" target="_blank" rel="noreferrer">View ${escapeHtml(shortAddress(item.signature))} on Explorer ↗</a> · not attributable to this coin</small></span><b class="activity-amount">${escapeHtml(formatOnChainNumber(Number(item.collectedLamports) / 1_000_000_000, 6))} SOL</b><span class="activity-time">${escapeHtml(item.recordedAt ? new Date(item.recordedAt).toLocaleDateString() : 'recorded')}</span></div>`).join('');
  activity.innerHTML = (mintRows || '<div class="empty-state">No verified fee claim is attributed to this mint.</div>') + (routerRows ? '<div class="empty-state">The on-chain creator is the shared router. Its collections below may include other coins and are excluded from this coin’s count.</div>' + routerRows : '');
}
function renderOnChainUnavailable(message){
  coinActivity = { status: 'unavailable', message, collections: [], claims: [], accounts: [] };
  setCoinTabLabels(); renderCoinActivityTab();
  setCoinField('.coin-live-dot', 'RPC unavailable');
  setCoinField('#coin-page-title', 'Token unavailable');
  setCoinField('#coin-avatar', '?'); setCoinField('#coin-symbol', '—'); setCoinField('#coin-description', message);
  ['#coin-market-cap','#coin-change','#coin-volume','#coin-liquidity','#coin-holders','#coin-payment-count','#coin-launch-date'].forEach(selector => setCoinField(selector, 'Unavailable'));
  setCoinField('#coin-chart-heading', 'On-chain snapshot');
  const chart = document.querySelector('.coin-chart'); if (chart) chart.innerHTML = `<div class="onchain-snapshot"><div><span>Snapshot</span><strong>Unavailable</strong></div><div><span>Source</span><strong>Solana RPC</strong></div></div>`;
  const footer = document.querySelector('.chart-footer'); if (footer) footer.innerHTML = '<span>On-chain only</span><span>Historical candles not indexed</span>';
  const policyEyebrow = document.querySelector('.coin-policy-card .eyebrow'); if (policyEyebrow) policyEyebrow.textContent = 'On-chain account';
  const policyBadge = document.querySelector('.coin-policy-card .data-badge'); if (policyBadge) policyBadge.textContent = 'RPC only';
  const policyTitle = document.querySelector('.coin-policy-card h2'); if (policyTitle) policyTitle.textContent = 'Curve unavailable';
  const policyRoute = document.querySelector('.policy-route'); if (policyRoute) policyRoute.innerHTML = '<strong>No Pump curve account</strong><small>Not inferred from off-chain data</small>';
  const policySplit = document.querySelector('.policy-split'); if (policySplit) policySplit.innerHTML = '<span><b>—</b><small>Curve state</small></span><span><b>—</b><small>Creator</small></span>';
  const policyBar = document.querySelector('.policy-bar'); if (policyBar) { policyBar.style.display = 'block'; policyBar.innerHTML = '<i style="display:block;height:100%;width:100%;background:#667085"></i>'; }
  const supplyLabel = document.querySelector('.policy-facts div:nth-child(2) strong'); if (supplyLabel) supplyLabel.textContent = 'Unavailable';
  const policyLink = document.querySelector('.policy-link'); if (policyLink) policyLink.hidden = true;
}
function resetCoinSurface(mintAddress){
  coinActivity = { status: 'loading', collections: [], claims: [], accounts: [] };
  setCoinTabLabels(); renderCoinActivityTab();
  setCoinField('.coin-live-dot', 'Checking RPC');
  setCoinField('#coin-avatar', '?'); setCoinField('#coin-symbol', 'RPC'); setCoinField('#coin-page-title', 'Loading token…'); setCoinField('#coin-address', shortAddress(mintAddress));
  setCoinField('#coin-description', 'Reading the mint, metadata account, and Pump bonding curve from Solana RPC…');
  const explorerLink = document.querySelector('#coin-explorer-link'); if (explorerLink) explorerLink.hidden = true;
  document.querySelectorAll('.coin-chart-panel .chart-tools button').forEach(button => { button.disabled = true; button.title = 'Historical candles are not indexed for this token.'; });
  ['#coin-market-cap','#coin-change','#coin-volume','#coin-liquidity','#coin-holders','#coin-payment-count','#coin-launch-date'].forEach(selector => setCoinField(selector, 'Loading…'));
  setCoinField('#coin-chart-heading', 'On-chain snapshot');
  const chart = document.querySelector('.coin-chart'); if (chart) chart.innerHTML = '<div class="onchain-snapshot"><div><span>Snapshot</span><strong>Loading…</strong></div><div><span>Source</span><strong>Solana RPC</strong></div></div>';
  const footer = document.querySelector('.chart-footer'); if (footer) footer.innerHTML = '<span>On-chain only</span><span>Historical candles not indexed</span>';
  const policyBadge = document.querySelector('.coin-policy-card .data-badge'); if (policyBadge) policyBadge.textContent = 'RPC only';
  const policyTitle = document.querySelector('.coin-policy-card h2'); if (policyTitle) policyTitle.textContent = 'Reading Pump curve…';
  const policyRoute = document.querySelector('.policy-route'); if (policyRoute) policyRoute.innerHTML = '<strong>Reading creator address</strong><small>Waiting for confirmed bonding-curve account</small>';
  const policySplit = document.querySelector('.policy-split'); if (policySplit) policySplit.innerHTML = '<span><b>—</b><small>Curve state</small></span><span><b>—</b><small>Real tokens</small></span>';
  const policyBar = document.querySelector('.policy-bar'); if (policyBar) { policyBar.style.display = 'block'; policyBar.innerHTML = '<i style="display:block;height:100%;width:100%;background:#667085"></i>'; }
  const policyLink = document.querySelector('.policy-link'); if (policyLink) policyLink.hidden = true;
  const networkLabel = document.querySelector('.coin-policy-card .policy-facts div:nth-child(3) strong'); if (networkLabel) networkLabel.textContent = `Solana · ${EXPLORE_CLUSTER}`;
  const supplyLabel = document.querySelector('.policy-facts div:nth-child(2) strong'); if (supplyLabel) supplyLabel.textContent = 'Loading…';
}
async function loadCoinMarketActivity(mintAddress, loadId){
  const response = await apiRequest(`/api/tokens/${encodeURIComponent(mintAddress)}/market-activity`, { signal: AbortSignal.timeout(12000) }).catch(() => ({ available: false, data: null }));
  if (loadId !== coinLoadId) return;
  const market = response.available && response.data?.cluster === EXPLORE_CLUSTER ? response.data : null;
  if (!market || market.volume24hSol == null || !Number.isFinite(Number(market.volume24hSol))) { setCoinField('#coin-volume', 'Unavailable'); return; }
  const volume = `${market.coverage === 'partial' ? '≥' : ''}${formatOnChainNumber(Number(market.volume24hSol), 6)} SOL`;
  setCoinField('#coin-volume', market.coverage === 'partial' ? `${volume} · partial` : volume);
  const change = Number(market.priceChangePercent);
  const basis = market.priceChangeBasis;
  setCoinField('#coin-change', market.priceChangePercent != null && Number.isFinite(change) && basis
    ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}% ${basis === '24h' ? '24h' : 'since first trade'}`
    : '24h change unavailable');
}
async function loadCoinOnChain(mintAddress){
  const loadId = ++coinLoadId;
  if (!mintAddress){ renderOnChainUnavailable('A mint address is required. Open a /token/{mint} route to load on-chain data.'); return; }
  setCoinField('#coin-page-title', 'Loading token…'); setCoinField('#coin-symbol', 'RPC'); setCoinField('#coin-address', shortAddress(mintAddress));
  setCoinField('#coin-description', 'Reading the mint, metadata account, and Pump bonding curve from Solana RPC…');
  try {
    const { PublicKey } = await getSolana();
    const detailConnection = await getExploreConnection();
    const mint = new PublicKey(mintAddress);
    const metadataProgram = new PublicKey(TOKEN_METADATA_PROGRAM_ID);
    const [metadataPda] = PublicKey.findProgramAddressSync([Buffer.from('metadata'), metadataProgram.toBuffer(), mint.toBuffer()], metadataProgram);
    const rpcRequest = (promise, label) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), 12000))]);
    const [mintResult, metadataResult, curveResult, largestResult] = await Promise.allSettled([
      rpcRequest(detailConnection.getParsedAccountInfo(mint, 'confirmed'), 'Mint RPC request'),
      rpcRequest(detailConnection.getAccountInfo(metadataPda, 'confirmed'), 'Metadata RPC request'),
      rpcRequest(fetchBondingCurveSnapshot({ connection: detailConnection, mint }), 'Pump curve RPC request'),
      rpcRequest(detailConnection.getTokenLargestAccounts(mint, 'confirmed'), 'Token-account RPC request'),
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
    const symbol = metadata.symbol || `${mintAddress.slice(0, 4)}…`;
    const name = metadata.name || 'Unnamed on-chain token';
    const spotPriceSol = curve && curve.virtualTokenReserves > 0 ? curve.virtualQuoteReservesSol / curve.virtualTokenReserves : NaN;
    const marketCapSol = spotPriceSol * supply;
    const accountAvailable = largestResult.status === 'fulfilled';
    const accounts = (largestAccounts.value || []).map(item => ({ address: item.address.toBase58(), amount: item.uiAmountString ?? formatOnChainNumber(Number(item.amount) / (10 ** decimals), 6) }));
    const tokenAccounts = accounts.length;
    const realQuote = curve?.realQuoteReservesSol;
    const ledger = await apiRequest(`/api/tokens/${encodeURIComponent(mintAddress)}/fee-activity`, { signal: AbortSignal.timeout(3500) }).catch(() => ({ available: false, data: null }));
    if (loadId !== coinLoadId) return;
    const ledgerAvailable = ledger.available && ledger.data?.cluster === EXPLORE_CLUSTER;
    const linkedRouter = ledgerAvailable && curve?.creator === ledger.data?.sharedRouter?.address;
    coinActivity = { status: 'ready', accounts, accountAvailable, ledgerAvailable, ledgerSource: ledger.data?.source === 'funded.app-postgresql' ? 'app database' : 'file ledger', collections: ledgerAvailable ? ledger.data.collections || [] : [], claims: ledgerAvailable ? ledger.data.claims || [] : [], sharedRouterCollections: linkedRouter ? ledger.data.sharedRouter.collections || [] : [] };
    setCoinTabLabels(); renderCoinActivityTab();
    setCoinField('.coin-live-dot', 'RPC confirmed');
    setCoinField('#coin-avatar', symbol.slice(0, 1).toUpperCase()); setCoinField('#coin-symbol', symbol); setCoinField('#coin-page-title', name);
    setCoinField('#coin-address', shortAddress(mintAddress)); setCoinField('#coin-full-address', mintAddress);
    setCoinField('#coin-description', 'On-chain mint and Pump bonding-curve snapshot. Metadata URI is intentionally not fetched.');
    setCoinField('#coin-market-cap', Number.isFinite(marketCapSol) ? `${formatOnChainNumber(marketCapSol, 4)} SOL` : 'Unavailable'); setCoinField('#coin-change', '24h change unavailable');
    setCoinField('#coin-volume', curve && EXPLORE_CLUSTER === 'devnet' ? 'Reading trades…' : 'Unavailable'); setCoinField('#coin-liquidity', curve ? `${formatOnChainNumber(realQuote, 4)} SOL` : 'Unavailable');
    setCoinField('#coin-holders', accountAvailable ? `${tokenAccounts} accounts` : 'Unavailable'); setCoinField('#coin-payment-count', coinActivity.ledgerAvailable ? `${coinActivity.collections.length} attributed` : 'Unavailable'); setCoinField('#coin-launch-date', 'Unavailable');
    setCoinField('#coin-chart-heading', `${symbol} / SOL spot`); setCoinField('#coin-full-address', mintAddress);
    const supplyLabel = document.querySelector('.policy-facts div:nth-child(2) strong'); if (supplyLabel) supplyLabel.textContent = `${formatOnChainNumber(supply, 6)} ${symbol}`;
    const chart = document.querySelector('.coin-chart');
    if (chart) chart.innerHTML = curve ? `<div class="onchain-snapshot"><div><span>Spot price</span><strong>${formatOnChainNumber(spotPriceSol, 9)} SOL</strong></div><div><span>Curve progress</span><strong>${formatOnChainNumber(curve.progressPercent, 2)}%</strong></div><div><span>Virtual quote</span><strong>${formatOnChainNumber(curve.virtualQuoteReservesSol, 4)} SOL</strong></div><div><span>Observed slot</span><strong>${curve.slot ?? '—'}</strong></div></div>` : `<div class="onchain-snapshot"><div><span>Pump curve</span><strong>Unavailable</strong></div><div><span>Cluster</span><strong>${EXPLORE_CLUSTER}</strong></div></div>`;
    const chartFooter = document.querySelector('.coin-chart-panel > .chart-footer'); if (chartFooter) chartFooter.innerHTML = `<span>Mint decimals <b>${decimals}</b></span><span>Supply <b>${formatOnChainNumber(supply, 6)}</b></span><span>Confirmed RPC snapshot · ${escapeHtml(EXPLORE_CLUSTER)}</span>`;
    const policyEyebrow = document.querySelector('.coin-policy-card .eyebrow'); if (policyEyebrow) policyEyebrow.textContent = 'On-chain account';
    const policyTitle = document.querySelector('.coin-policy-card h2'); if (policyTitle) policyTitle.textContent = curve ? 'Pump bonding curve' : 'Curve unavailable';
    const policyRoute = document.querySelector('.policy-route'); if (policyRoute) policyRoute.innerHTML = curve ? `<strong>Creator ${shortAddress(curve.creator)}</strong><small>Derived from the bonding-curve account</small>` : '<strong>No Pump curve account</strong><small>Mint account is on-chain; curve is not on this cluster</small>';
    const policySplit = document.querySelector('.policy-split'); if (policySplit) policySplit.innerHTML = curve ? `<span><b>${curve.complete ? 'Complete' : 'Active'}</b><small>Curve state</small></span><span><b>${formatOnChainNumber(curve.realTokenReserves, 0)}</b><small>Real tokens</small></span>` : '<span><b>—</b><small>Curve state</small></span><span><b>—</b><small>Creator</small></span>';
    const policyBar = document.querySelector('.policy-bar'); if (policyBar) policyBar.innerHTML = curve ? `<i style="display:block;height:100%;width:${Math.max(0, Math.min(100, Number(curve.progressPercent) || 0))}%;background:#83cbb0"></i>` : '<i style="display:block;height:100%;width:100%;background:#667085"></i>';
     const policyLink = document.querySelector('.policy-link'); if (policyLink) { policyLink.textContent = 'View mint on explorer →'; policyLink.href = exploreExplorer(`address/${mintAddress}`); policyLink.hidden = false; }
    const explorerLink = document.querySelector('#coin-explorer-link'); if (explorerLink) { explorerLink.href = exploreExplorer(`address/${mintAddress}`); explorerLink.hidden = false; }
    const networkLabel = document.querySelector('.coin-policy-card .policy-facts div:nth-child(3) strong'); if (networkLabel) networkLabel.textContent = `Solana · ${EXPLORE_CLUSTER}`;
    if (curve && EXPLORE_CLUSTER === 'devnet') void loadCoinMarketActivity(mintAddress, loadId);
  } catch (error) { if (loadId !== coinLoadId) return; console.error('On-chain token detail failed', error); renderOnChainUnavailable(error?.message || 'Solana RPC could not load this mint.'); }
}
function showCoinPage(open = true){
  const main = document.querySelector('.main-content');
  const page = document.querySelector('#coin-page');
  if (!main || !page) return;
  if (!open){ ++coinLoadId; main.classList.remove('coin-view'); page.hidden = true; return; }
  const mintAddress = getCoinMintAddress();
  setCoinField('#coin-full-address', mintAddress || 'No mint address');
  const addressButton = document.querySelector('#coin-copy-address');
  if (addressButton) addressButton.parentElement.firstChild.textContent = `${shortAddress(mintAddress)} `;
  resetCoinSurface(mintAddress); main.classList.add('coin-view'); page.hidden = false; window.scrollTo({ top: 0, behavior: 'smooth' });
  const watch = document.querySelector('#coin-watch'); if (watch) { const saved = getWatchlist().includes(mintAddress); watch.textContent = saved ? '★' : '☆'; watch.classList.toggle('active', saved); watch.setAttribute('aria-pressed', String(saved)); }
  loadCoinOnChain(mintAddress);
}
function coinRouteRequested(){ const directPath = location.pathname.startsWith('/token/') || location.pathname.startsWith('/launch/coin/'); return location.hash.startsWith('#coin/') || (directPath && !location.hash); }
if (coinRouteRequested()) showCoinPage();
window.addEventListener('hashchange', () => { if (coinRouteRequested()) showCoinPage(); else showCoinPage(false); });
document.querySelector('#asset-grid')?.addEventListener('click', event => { if (event.target.closest('button')) return; const card = event.target.closest('.asset-card'); const mint = card?.dataset.mint; if (!mint) return; location.href = `/token/${encodeURIComponent(mint)}`; });
document.querySelector('#coin-page')?.addEventListener('click', async event => {
  const trade = event.target.closest('#coin-trade-button');
  if (trade){
    const mint = getCoinMintAddress();
    if (!mint) return;
    sessionStorage.setItem('funded.pendingTradeMint', mint);
    window.location.href = '/explore#trade-panel';
    return;
  }
  const watch = event.target.closest('#coin-watch');
  if (watch){ const mint = getCoinMintAddress(); if (!mint) return; const saved = getWatchlist(); saveWatchlist(saved.includes(mint) ? saved.filter(item => item !== mint) : [...saved, mint]); renderWatchlist(); const active = getWatchlist().includes(mint); watch.textContent = active ? '★' : '☆'; watch.classList.toggle('active', active); watch.setAttribute('aria-pressed', String(active)); return; }
  const share = event.target.closest('#coin-share-link');
  if (share){ event.preventDefault(); const mint = getCoinMintAddress(); if (!mint) return; const url = new URL(`/token/${encodeURIComponent(mint)}`, location.origin).toString(); try { await navigator.clipboard.writeText(url); showToast('Token link copied'); } catch { showToast(url); } return; }
  const copy = event.target.closest('#coin-copy-address, #coin-copy-full');
  if (copy){ const address = getCoinMintAddress(); if (!address) return showToast('No mint address in this route'); try { await navigator.clipboard.writeText(address); showToast('Token address copied'); } catch { showToast(address); } }
  const tab = event.target.closest('[data-coin-tab]');
  if (tab){ document.querySelectorAll('[data-coin-tab]').forEach(item => item.classList.toggle('active', item === tab)); renderCoinActivityTab(); }
});
