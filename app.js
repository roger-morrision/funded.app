import { exactLamports } from './exact-lamports.js';
import { formatReceiptSol } from './receipt-export.js';
import { emitPilotSignal, pilotInterruptedSignal, verifiedPilotLaunchRegistration } from './pilot-event-signals.js';
import { validateBoostQuote, boostPaymentResolution, readPendingBoost, archiveBoostPayment, archiveVerifiedBoostFromHistory, saveSignedBoostPayment } from './boost-checkout-recovery.js';
import { readHiddenChatAuthors, hideChatAuthor, resetHiddenChatAuthors } from './token-chat-preferences.js';
import { createRoutePoller } from './route-polling.js';
import { Buffer } from 'buffer';
import { icon } from './ui-icons.js';
import { summarizeFullHolderDistribution, summarizeHolderWalletSample } from './holder-wallet-sample.js';
import { BOOST_MEMO_PROGRAM, BOOST_PACKAGES, activeBoostMultiplier, activeBoostPackages, boostPackage } from './boost-offer.js';
import { boostPackageBadgesMarkup, observeSupplementalBoostCards, setCardBoostSnapshot } from './boost-card-badges.js';
import { formatTradeAmountInput, parseTradeAmountInput } from './trade-amount-input.js';
import { formatTokenBaseAmount, tokenBalancePercentage } from './trade-panel-balance.js';
import { buildTradeReview } from './trade-review-model.js';
import bs58 from 'bs58';
import { formatXClaimSol, summarizeXClaims } from './x-claim-summary.js';
import { APP_REFERRAL_LEVELS, buildFeeDistributionPolicy, FEE_DISTRIBUTION, validateFeeDistribution } from './distribution-policy.js';
import { buildLaunchReservePlan, fundedCommunityAirdropPolicy } from './airdrop-policy.js';
import { buildBuybackAccrual, buildBuybackPolicy, buildBuybackReceipt, evaluateBuybackBatch, summarizeBuybackLedger } from './buyback-policy.js';
import { buildFeeRouterPolicy, deriveMintFeeRouter, verifyFeeRouterAccount } from './fee-router.js';
import { buildMintRouterInitializeInstruction, buildPumpLaunchPlan } from './mint-router-launch.js';
import { launchReserveInstructions, quoteAtomicReserveBuy } from './launch-community-reserve.js';
import { buildLaunchBurnPolicy, createLaunchBurnTiers, tokensToBaseUnits, validateLaunchBurnPolicy } from './launch-burn-policy.js';
import { LAUNCH_TIER_USD, launchTierQuoteCurrent } from './launch-tier-quote.js';
import { burnedSupplyBaseUnits, formatTokenBaseUnits, parseTokenAmount, planTokenAccountBurns, projectBurnMemo, waitForSignatureConfirmation } from './funded-burn.js';
import { bindReferralAttribution, captureFirstTouch, createReferralCode, normalizeReferralCode } from './referral-program.js';
  import { buildSolClaimPolicy, normalizeXHandle } from './sol-claim-policy.js';
import { buildTradeTransaction, buildVerifiedPoolTradeTransaction, describeTradeQuote, estimateBuyTokenAmountFromSnapshot, fetchBondingCurveSnapshot, fetchGraduatedPoolSnapshot, fetchVerifiedPoolSnapshot, submitTrade } from './pump-trading.js';
import { PUMP_PROGRAM_ID, PUMP_SDK, bondingCurvePda } from '@pump-fun/pump-sdk';
import { PUMP_AMM_PROGRAM_ID, PUMP_AMM_SDK, canonicalPumpPoolPda } from '@pump-fun/pump-swap-sdk';
import { APP_CLUSTER, APP_ENVIRONMENT_LABEL, APP_EXPLORER_QUERY, APP_MAINNET_READ_ONLY, APP_RPC_URL, DEV_MODE, DEV_WALLET_AUTOCONNECT, DEV_WALLET_ROLE, EXPLORE_CLUSTER, EXPLORE_RPC_URL, TRADE_FEE_BPS, TRADE_FEE_OWNER } from './app-config.js';
import { apiRequest, persistLaunchPolicy } from './client.js';
import { recordLaunchEvent, readLaunchJournal, policyMatchesJournal } from './launch-journal.js';
import { launchReview, freshLaunchReview, launchReviewMarkup, launchReviewNeedsRefresh, initialCurvePremiumBps } from './launch-review.js';
import { launchReviewStillCurrent } from './launch-review-gate.js';
import { confirmedClaimResult } from './reward-discovery.js';
import {focusLaunchStep} from './launch-accessibility.js';
import { withRpcRetry } from './rpc-retry.js';
import { getPreparedImage, prepareLaunchImage, assertImageReady } from './launch-image.js';
import { launchPolicyStatement } from './launch-policy-auth.js';
import { coinDetailPackage, verifiedPromotionBadge } from './promotion-badge.js';
import { initPaidListing } from './list-page.js';
import { metadataStatement, devnetMetadataUri, devnetImageUri, isDevnetImageUri } from './devnet-metadata.js';
import { canonicalLaunchSocialUrl, normalizeXProfileInput } from './launch-social-url.js';
import { claimerRate, sortClaimers, claimantWalletLabel } from './airdrop-claimers-model.js';
import { airdropClaimState } from './airdrop-directory-model.js';
import { collectRecentTrades, enrichMarketRecord, filterMarketRecords, formatSignal, sortMarketRecords, summarizeMarkets, withMarketWindow } from './market-intelligence.js';
import { emptyHomeLaunchFilters, homeLaunchFilterCount, matchesHomeLaunchFilters, normalizeHomeLaunchFilters, HOME_FILTER_RANGES } from './home-launch-filters.js';
import { explorePageNumbers, paginateExploreRows } from './explore-pagination.js';
import { exploreSocialLinks } from './explore-social-links.js';
import { formatSolMetric, readCurveMetrics, readPumpSwapMetrics } from './explore-onchain-metrics.js';
import { publishVerifiedCurves } from './verified-curve-state.js';
import { buildTradePricePath, filterAndSortRecentTrades, selectObservedTradeWindow, summarizeTokenAccounts, verifiedRegistryLaunch } from './coin-detail-model.js';
import { formatPolicyPercent, verifiedCoinRewardsPolicy } from './coin-rewards-policy.js';
import { buildCoinSummary } from './coin-summary-model.js';
import { canSignTransactions, connectWalletProvider, selectRememberedWalletProvider, walletAddress, walletLaunches } from './wallet-core.js';
import { TOKEN_CHAT_MAX_LENGTH, normalizeTokenChatText } from './token-chat.js';
import { initShareComposer, openShareComposer, localShareActions } from './share-tools.js';
import { verifiedTradeReceipt } from './trade-share-proof.js';
import { assessTradeCompletion } from './trade-completion.js';
import { hasBuyBalance } from './trade-spend-guard.js';
import { aggregateTokenAccounts, matchedTradePnl } from './portfolio-model.js';
import { tokenCardData, tokenCardEvidenceLabel, formatPolicyTokenCount } from './token-card-data.js';

globalThis.Buffer ??= Buffer;
const EXPLORE_NETWORK_LABEL = EXPLORE_CLUSTER === 'devnet' ? 'Solana' : EXPLORE_CLUSTER;
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
let walletBalanceRequest = 0;
let walletBalanceFetchedAt = 0;
let estimatedLaunchFeeLamports = null;
let estimatedInitialBuyLamports = 0;
let estimatedInitialBuyTokens = 0;
let launchCostReview = null;
let walletMetricsLoading = false;
let walletEstimateError = '';
let walletDetailTab = 'activity';
let walletDetailFilter = 'all';
let portfolioHoldings = { wallet: '', status: 'idle', accounts: [], coverage: '' };
let portfolioRequest = 0;
let tradePreview = null;
const pendingTradeVerifications = new Map();
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
let launchTierPricing = null;
let launchTierQuote = null;
let fundedBurnRequest = 0;
let fundedBurnState = { status: 'idle', wallet: null, decimals: 0, balanceBaseUnits: 0n, supplyBaseUnits: 0n, burnedBaseUnits: 0n, tokenAccounts: [], receipts: [], message: '' };
let fundedBuyRoute = { status:'checking', snapshot:null, reason:'Checking the verified Solana pool…' };
let fundedBuyPreview = null;
let fundedBuyBusy = false;
const WATCHLIST_KEY = 'funded.app.community.watchlist';
let lastKnownWatchlist = [];
let watchlistUnavailable = false;
let watchlistNotice = '';
let watchlistReadWarning = false;
let watchlistWriteUnconfirmed = false;
const APP_REFERRAL_KEY = 'funded.app.referral.attribution';
const REFERRAL_ANALYTICS_KEY = 'funded.app.referral.analytics';
const REFERRAL_SERVER_KEY_PREFIX = 'funded.app.referral.server.';
const SHARE_VISIT_KEY = 'funded.vip.share-visit.v1';
const TRADE_ROUNDTRIP_KEY = 'funded.vip.trade-roundtrip.v1';
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
const SELECTABLE_LAUNCH_TIERS = new Set(['standard', 'pro', 'premier']);
let feeRouterState = { status: 'checking', verified: false, address: null, programId: FEE_ROUTER_PROGRAM_ID || null, bump: null };
let feeRouterRefreshPromise = null;
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
function currentLaunchTierQuote(){
  if (!connectedWalletAddress) return null;
  return launchTierQuoteCurrent(launchTierQuote, { tier:launchBurnTier, payer:connectedWalletAddress, mint:PROTOCOL_FUNDED_MINT })
    ? launchTierQuote : null;
}
function currentLaunchTierAmounts(){
  return launchTierPricing && Date.now() - Date.parse(launchTierPricing.observedAt) < 120_000
    ? launchTierPricing.amounts : null;
}
function getLaunchBurnPolicy(){
  const quote = currentLaunchTierQuote();
  const amounts = currentLaunchTierAmounts();
  const tiers = LAUNCH_BURN_TIERS.map(tier => Object.hasOwn(LAUNCH_TIER_USD, tier.id)
    ? { ...tier, amountTokens:quote?.tier === tier.id ? quote.amountTokens : amounts?.[tier.id] || 0 } : tier);
  const policy = buildLaunchBurnPolicy({ tierId:launchBurnTier, fundedMint:PROTOCOL_FUNDED_MINT || null, tiers });
  return Object.hasOwn(LAUNCH_TIER_USD, policy.tier)
    ? { ...policy, quoteId:quote?.id || null, usdTarget:LAUNCH_TIER_USD[policy.tier] } : policy;
}
function renderFundedTokenLanding(){
  const set = (id, value) => { const element = document.getElementById(id); if (element) element.textContent = value; };
  const mintReady = validateSolanaMint(PROTOCOL_FUNDED_MINT).valid === true;
  set('funded-token-mint', mintReady ? PROTOCOL_FUNDED_MINT : 'Mint not configured');
  const copy = document.getElementById('funded-token-copy');
  if (copy) { copy.disabled = !mintReady; copy.dataset.mint = mintReady ? PROTOCOL_FUNDED_MINT : ''; }
  const explorer = document.getElementById('funded-token-chart');
  if (explorer) {
    explorer.hidden = !mintReady;
    if (mintReady) { explorer.href = 'https://explorer.solana.com/address/' + encodeURIComponent(PROTOCOL_FUNDED_MINT) + APP_EXPLORER_QUERY; explorer.target = '_blank'; explorer.rel = 'noopener noreferrer'; explorer.textContent = 'VIEW ON SOLANA ↗'; }
  }
  const tierAmounts = currentLaunchTierAmounts();
  for (const tier of LAUNCH_BURN_TIERS.filter(item => item.id !== 'standard'))
    set('funded-token-' + tier.id, Object.hasOwn(LAUNCH_TIER_USD, tier.id)
      ? tierAmounts?.[tier.id]?.toLocaleString() || '—' : tier.amountTokens.toLocaleString());
  const asset = mintReady && exploreUpdatedAt ? assets.find(item => item.address === PROTOCOL_FUNDED_MINT) : null;
  const pool = fundedBuyRoute.status === 'ready' && fundedBuyRoute.snapshot?.mint === PROTOCOL_FUNDED_MINT
    ? fundedBuyRoute.snapshot : null;
  const solUsdReady = Number.isFinite(coinSolUsdPrice) && coinSolUsdPrice > 0;
  const poolSpotSol = Number(pool?.spotPriceSol);
  const poolReady = pool && Number.isFinite(poolSpotSol) && poolSpotSol > 0;
  const poolPriceUsd = poolReady && solUsdReady ? poolSpotSol * coinSolUsdPrice : null;
  const assetPriceUsd = Number(asset?.priceUsd) > 0 ? Number(asset.priceUsd)
    : Number(asset?.curvePriceSol) > 0 && solUsdReady ? Number(asset.curvePriceSol) * coinSolUsdPrice : null;
  const quote = poolReady ? poolPriceUsd : assetPriceUsd;
  for (const tier of LAUNCH_BURN_TIERS.filter(item => item.id !== 'standard'))
    set('funded-token-' + tier.id + '-note', Object.hasOwn(LAUNCH_TIER_USD, tier.id)
      ? `$${LAUNCH_TIER_USD[tier.id]} target · ${tierAmounts?.[tier.id] ? 'current pool quote' : 'quote unavailable'}`
      : Number.isFinite(quote) && quote > 0 ? `≈ ${formatDashboardUsd(tier.amountTokens * quote)} at current spot` : '$FUNDED burn per launch');
  const poolUnavailableNote = fundedBuyRoute.status === 'unavailable'
    ? /rate limit/i.test(fundedBuyRoute.reason || '') ? 'Solana RPC rate limited' : 'Verified Solana pool unavailable'
    : 'Verified quote unavailable';
  set('funded-token-price', Number.isFinite(quote) ? '$' + quote.toLocaleString(undefined, { maximumSignificantDigits: 6 })
    : poolReady ? poolSpotSol.toPrecision(6) + ' SOL' : '$—');
  set('funded-token-price-note', poolReady ? 'Current Solana pool quote' : Number.isFinite(quote) ? 'Current market estimate' : poolUnavailableNote);
  const supplyReady = fundedBurnState.status === 'ready' && mintReady;
  const supplyTokens = supplyReady ? Number(fundedBurnState.supplyBaseUnits) / 10 ** fundedBurnState.decimals : null;
  const poolCapSol = poolReady && Number.isFinite(supplyTokens) ? poolSpotSol * supplyTokens : null;
  const marketCap = Number.isFinite(poolCapSol) && solUsdReady ? formatCompactUsd(poolCapSol * coinSolUsdPrice)
    : Number.isFinite(poolCapSol) ? poolCapSol.toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' SOL'
      : asset ? exploreMarketCapUsd(asset) : '$—';
  set('funded-token-market-cap', marketCap);
  const capValue = document.getElementById('funded-token-market-cap');
  if (capValue) capValue.title = Number.isFinite(poolCapSol) && solUsdReady ? `${formatDashboardUsd(poolCapSol * coinSolUsdPrice)} estimated from the verified pool spot price and live mint supply` : '';
  set('funded-token-market-cap-note', Number.isFinite(poolCapSol) ? 'Pool spot × live mint supply · estimate' : marketCap === '$—' ? poolUnavailableNote : 'Verified market snapshot');
  const burnedTokens = supplyReady ? Number(formatTokenBaseUnits(fundedBurnState.burnedBaseUnits, fundedBurnState.decimals, 2)) : null;
  set('funded-token-burned', Number.isFinite(burnedTokens) ? formatDashboardQuantity(burnedTokens) : '—');
  const burnedValue = document.getElementById('funded-token-burned');
  if (burnedValue) burnedValue.title = Number.isFinite(burnedTokens) ? `${burnedTokens.toLocaleString(undefined, { maximumFractionDigits: 2 })} $FUNDED from the on-chain supply delta` : '';
  set('funded-token-burned-note', supplyReady ? 'Confirmed supply reduction' : fundedBurnState.status === 'error' ? 'Supply total unavailable' : 'Checking supply');
  const tape = document.getElementById('funded-token-tape-items');
  if (tape) {
    const entries = [];
    if (poolReady) entries.push(['$FUNDED', Number.isFinite(quote) ? '$' + quote.toLocaleString(undefined, { maximumSignificantDigits: 4 }) : poolSpotSol.toPrecision(4) + ' SOL', '/funded']);
    if (Number.isFinite(poolCapSol)) entries.push(['FUNDED MC', marketCap, '/funded']);
    if (Number.isFinite(burnedTokens)) entries.push(['BURNED', burnedTokens.toLocaleString(undefined, { maximumFractionDigits: 0 }), '/funded']);
    if (exploreLastVerifiedAt && !exploreProviderStatus.includes('stale')) {
      for (const item of assets) {
        const cap = exploreMarketCapUsd(item);
        if (!item.address || cap === '$—') continue;
        entries.push([`$${item.symbol || 'TOKEN'}`, cap, `/token/${encodeURIComponent(item.address)}`]);
        if (entries.length >= 8) break;
      }
    }
    tape.replaceChildren();
    if (!entries.length) tape.textContent = 'Waiting for verified Solana market data';
    for (const [label, value, href] of entries) {
      const link = document.createElement('a');
      link.href = href;
      const name = document.createElement('span');
      name.textContent = label;
      const figure = document.createElement('strong');
      figure.textContent = value;
      link.append(name, figure);
      tape.append(link);
    }
  }
}
window.addEventListener('funded:token-page-ready', renderFundedTokenLanding);
let launchTierPriceRequest = 0;
async function refreshLaunchTierPricing(){
  const request = ++launchTierPriceRequest;
  const previousAmount = getLaunchBurnPolicy().amountTokens;
  try {
    const response = await apiRequest('/api/launch-tier-quote');
    if (!response.available) throw new Error(response.data?.error || 'The verified $FUNDED price is unavailable.');
    const data = response.data;
    if (data?.fundedMint !== PROTOCOL_FUNDED_MINT || data?.pool !== PROTOCOL_FUNDED_SWAP_POOL
      || !Number.isFinite(Number(data.tokenPriceUsd)) || Number(data.tokenPriceUsd) <= 0
      || !['pro', 'premier'].every(tier => Number.isSafeInteger(data.amounts?.[tier]) && data.amounts[tier] > 0))
      throw new Error('The launch tier quote did not match the configured $FUNDED pool.');
    if (request !== launchTierPriceRequest) return;
    launchTierPricing = data;
  } catch (error) {
    if (request !== launchTierPriceRequest) return;
    launchTierPricing = null;
    const status = document.querySelector('#launch-tier-quote-status');
    if (status) status.textContent = String(error.message || 'The verified $FUNDED price is unavailable.');
  }
  if (launchBurnTier !== 'standard' && !currentLaunchTierQuote() && getLaunchBurnPolicy().amountTokens !== previousAmount) {
    launchBurnReadiness = { ready:false, message:'Refresh the wallet and launch estimate after the $FUNDED quote changes.' };
    launchCostReview = null;
    estimatedLaunchFeeLamports = null;
    if (wallet) scheduleLaunchCostRefresh();
  }
  renderLaunchBurnSelection();
  renderFundedTokenLanding();
  updateCostSummary();
  updateLaunchButton();
}
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
async function getLaunchReserveConfig(){
  const result = await apiRequest('/api/launch-reserve-config');
  const config = result.data;
  if (!result.available || config?.cluster !== 'devnet' || config.programId !== FEE_ROUTER_PROGRAM_ID
    || !validateSolanaMint(config.authority).valid || !validateSolanaMint(config.lookupTable).valid)
    throw new Error('Atomic community reserve custody is unavailable. Coin creation is paused.');
  return config;
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
  const query = new URLSearchParams(window.location.search);
  const code = query.get('ref')?.trim().toUpperCase();
  const attribution = captureFirstTouch(getAppReferralAttribution(), code, { ownCode: getReferralCode() });
  if (!attribution) return getAppReferralAttribution();
  if (!attribution.source && normalizeReferralCode(code) === attribution.code) attribution.source = String(query.get('src') || 'direct').slice(0, 24);
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
      const prepared = await apiRequest('/api/referrals/attribution/prepare', { method: 'POST', body: { wallet: walletAddress, code: attribution.code, source:attribution.source || 'direct' } });
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
let referralSessionWallet = '';
let referralSessionApproval = null;
async function ensureReferralSession(session){
  if (!session?.address || typeof session.provider?.signMessage !== 'function') throw new Error('Connect a wallet that can approve referral dashboard access.');
  if (referralSessionWallet === session.address) return;
  if (referralSessionApproval) return referralSessionApproval;
  referralSessionApproval = (async () => {
    const current = await apiRequest('/api/referrals/session').catch(() => null);
    if (current?.data?.authenticated && current.data.wallet === session.address) { referralSessionWallet = session.address; return; }
    const prepared = await apiRequest('/api/referrals/session/prepare', { method:'POST', body:{ wallet:session.address } });
    assertWalletSessionCurrent(session);
    const signature = await session.provider.signMessage(new TextEncoder().encode(prepared.data.statement));
    assertWalletSessionCurrent(session);
    const verified = await apiRequest('/api/referrals/session/verify', { method:'POST', body:{ challengeId:prepared.data.challengeId, wallet:session.address, signature:bs58.encode(signature) } });
    if (!verified.data?.authenticated || verified.data.wallet !== session.address) throw new Error('Referral dashboard approval failed.');
    referralSessionWallet = session.address;
  })();
  try { await referralSessionApproval; } finally { referralSessionApproval = null; }
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
function renderReferralLedgerEmpty(title, note){
  const ledger = document.querySelector('#referral-ledger-list');
  if (!ledger) return;
  const empty = document.createElement('div'); empty.className = 'empty-state referral-empty-state';
  const heading = document.createElement('strong'); heading.textContent = title;
  const detail = document.createElement('small'); detail.textContent = note;
  empty.append(heading, detail); ledger.replaceChildren(empty);
}
function renderReferralActivityEmpty(title, note){
  const empty = document.querySelector('#referral-activity-list .empty-state');
  if (!empty) return;
  empty.hidden = false;
  const heading = empty.querySelector('strong');
  const detail = empty.querySelector('small');
  if (heading && detail) { heading.textContent = title; detail.textContent = note; }
}
async function refreshReferralClaims(){
  const session = captureWalletSession();
  const walletAddress = session?.address; const dashboard = document.querySelector('#referral-command-center');
  if (!session || !dashboard) return;
  try { await ensureReferralSession(session); }
  catch (error) { if (isWalletSessionCurrent(session)) { renderReferralClaimPrompt('Approve referral dashboard access', error.message || 'Wallet approval is required to load private referral activity.'); renderReferralActivityEmpty('Approval required', 'Approve dashboard access in your wallet to check referral activity.'); renderReferralLedgerEmpty('Approval required', 'Approve dashboard access in your wallet to check claim receipts.'); } return; }
  if (!isWalletSessionCurrent(session)) return;
  const [result, dashboardResult] = await Promise.all([
    apiRequest(`/api/referral-claims?wallet=${encodeURIComponent(walletAddress)}`).catch(() => ({ available: false })),
    apiRequest(`/api/referrals/dashboard?wallet=${encodeURIComponent(walletAddress)}`).catch(() => ({ available: false })),
  ]);
  if (!isWalletSessionCurrent(session)) return;
  renderShareInsights(dashboardResult);
  if (dashboardResult.available) {
    const creators = Number(dashboardResult.data.networkCreators || 0);
    renderReferralActivityEmpty(creators > 0 ? 'Network summary available' : 'No qualified activity yet', creators > 0
      ? `${creators} network creator${creators === 1 ? '' : 's'} reported. Individual activity is not available in this view.`
      : 'Qualified activity appears after verified fee collection is indexed.');
  } else renderReferralActivityEmpty('Activity unavailable', 'The referral dashboard could not be loaded. Try again later.');
  if (!result.available) { renderReferralClaimPrompt('Referral claim service unavailable', 'No reward action is available until the claim service can be verified.'); renderReferralLedgerEmpty('Receipts unavailable', 'The claim service could not be verified. Try again later.'); return; }
  if (dashboardResult.available) { const active = document.querySelector('#referral-active-creators'); if (active) active.textContent = String(dashboardResult.data.networkCreators ?? '—'); const conversion = document.querySelector('#referral-conversion-rate'); if (conversion) conversion.textContent = dashboardResult.data.conversionRate == null ? '—' : `${dashboardResult.data.conversionRate}%`; }
  const claims = Array.isArray(result.data.claims) ? result.data.claims : [];
  const claimable = claims.filter(claim => ['awaiting-wallet-signature', 'wallet-verified'].includes(claim.status)).reduce((sum, claim) => sum + Number(claim.amount || 0), 0);
  const paid = claims.filter(claim => claim.status === 'paid').reduce((sum, claim) => sum + Number(claim.amount || 0), 0);
  const claimableNode = document.querySelector('#referral-total-claimable'); if (claimableNode) claimableNode.textContent = `${claimable.toFixed(4)} SOL`;
  const paidNode = document.querySelector('#referral-paid-total'); if (paidNode) paidNode.textContent = `${paid.toFixed(4)} SOL`;
  const ledger = document.querySelector('#referral-ledger-list');
  if (ledger) { ledger.replaceChildren(); if (!claims.length) renderReferralLedgerEmpty('No receipts yet', 'Finalized referral claims will appear here.'); else claims.slice().reverse().forEach(claim => { const row = document.createElement('div'); row.className = 'referral-ledger-row'; const label = document.createElement('strong'); label.textContent = `Level ${claim.level}`; const status = document.createElement('small'); status.textContent = claim.status; const amount = document.createElement('b'); amount.textContent = `${Number(claim.amount || 0).toFixed(4)} ${claim.asset}`; row.append(label, status, amount); ledger.append(row); }); }
  let panel = document.querySelector('#referral-claim-center');
  if (!panel) { panel = document.createElement('div'); panel.id = 'referral-claim-center'; panel.className = 'referral-dashboard'; panel.setAttribute('aria-live', 'polite'); dashboard.querySelector('.referral-kpi-grid')?.after(panel); }
  panel.replaceChildren();
  const heading = document.createElement('div'); const title = document.createElement('strong'); title.textContent = 'Referral claim center'; const note = document.createElement('small'); note.textContent = claims.length ? 'Rewards require your wallet signature and a separate payout action.' : 'No claimable referral rewards yet.'; heading.append(title, note); panel.append(heading);
  for (const claim of result.data.claims) {
    const row = document.createElement('div'); row.className = 'referral-claim-row'; const label = document.createElement('span'); label.textContent = `Level ${claim.level} · ${claim.amount} ${claim.asset} · ${claim.status}`; row.append(label);
    if (claim.status === 'awaiting-wallet-signature' && session.provider.signMessage) { const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary-button'; button.textContent = 'Sign claim'; button.onclick = async () => { button.disabled = true; try { assertWalletSessionCurrent(session); const signature = await session.provider.signMessage(new TextEncoder().encode(claim.statement)); assertWalletSessionCurrent(session); await apiRequest(`/api/referral-claims/${encodeURIComponent(claim.id)}/verify`, { method: 'POST', body: { publicKey: walletAddress, signature: bs58.encode(signature) } }); if (isWalletSessionCurrent(session)) await refreshReferralClaims(); } catch (error) { if (isWalletSessionCurrent(session)) { showToast(error.message); button.disabled = false; } } }; row.append(button); }
    if (claim.status === 'wallet-verified') { const button = document.createElement('button'); button.type = 'button'; button.className = 'primary-button'; button.textContent = 'Execute payout'; button.onclick = async () => { button.disabled = true; try { assertWalletSessionCurrent(session); await apiRequest(`/api/referral-claims/${encodeURIComponent(claim.id)}/execute`, { method: 'POST' }); if (isWalletSessionCurrent(session)) { showToast('Referral reward paid'); await refreshReferralClaims(); } } catch (error) { if (isWalletSessionCurrent(session)) { showToast(error.message); button.disabled = false; } } }; row.append(button); }
    if (claim.status === 'paid' && claim.payoutSignature) {
      const receipt = document.createElement('small'); receipt.textContent = `Paid · ${claim.payoutSignature}`; row.append(receipt);
      if (claim.asset === 'SOL' && Number(claim.amount) > 0) {
        const sharePaid = document.createElement('button'); sharePaid.type = 'button'; sharePaid.className = 'secondary-button'; sharePaid.textContent = 'Share receipt card';
        sharePaid.addEventListener('click', async () => {
          sharePaid.disabled = true;
          try {
            const { PublicKey } = await getSolana();
            const transaction = await connection.getParsedTransaction(claim.payoutSignature, { commitment:'finalized', maxSupportedTransactionVersion:0 });
            const expectedLamports = Math.floor(Number(claim.amount) * 1_000_000_000);
            const matchingTransfer = transaction?.transaction?.message?.instructions?.some(instruction => instruction.program === 'system'
              && instruction.parsed?.type === 'transfer' && instruction.parsed.info?.destination === walletAddress
              && Number(instruction.parsed.info?.lamports) === expectedLamports);
            if (transaction?.meta?.err !== null || !matchingTransfer || new PublicKey(walletAddress).toBase58() !== walletAddress) throw new Error('The finalized payout transfer is not verified yet.');
            if (!isWalletSessionCurrent(session)) return;
            const code = registeredShareCode();
            openShareComposer({ kind:'result', title:'Finalized referral payout on funded.vip', text:`My ${EXPLORE_NETWORK_LABEL} referral payout of ${Number(claim.amount).toFixed(4)} SOL is finalized. Check the receipt on funded.vip.`, url: code ? buildReferralUrl(code) : new URL('/#referrals', location.origin).toString(),
              result:{ verified:true, amount:Number(claim.amount), asset:'SOL', receipt:claim.payoutSignature, receiptUrl:exploreExplorer(`tx/${encodeURIComponent(claim.payoutSignature)}`), wallet:walletAddress, network:EXPLORE_NETWORK_LABEL, period:'Finalized payout' } });
          } catch (error) { showToast(error.message || 'Finalized payout verification is unavailable.'); }
          finally { sharePaid.disabled = false; }
        });
        row.append(sharePaid);
      }
    }
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
initShareComposer();
function registeredShareCode(){
  if (!connectedWalletAddress) return '';
  try {
    const registered = JSON.parse(localStorage.getItem(`${REFERRAL_SERVER_KEY_PREFIX}${connectedWalletAddress}`) || 'null');
    return normalizeReferralCode(registered?.code);
  } catch { return ''; }
}
function openCoinShare(mint, symbol = 'Coin', name = ''){
  if (!validateSolanaMint(mint).valid) return showToast('A valid token mint is required to share.');
  const url = new URL(`/token/${encodeURIComponent(mint)}`, location.origin);
  const code = registeredShareCode();
  if (code) url.searchParams.set('ref', code);
  const label = String(name || symbol || 'Coin').trim().slice(0, 60);
  const verifiedName = !/^(token data unavailable|loading token)/i.test(label);
  openShareComposer({ kind:'coin', title:`${verifiedName ? label : 'Token'} on funded.vip`, text: verifiedName
    ? `Explore ${label} on funded.vip. Review its ${EXPLORE_NETWORK_LABEL} mint and market facts, then watch it for updates.`
    : `Open this ${EXPLORE_NETWORK_LABEL} token record on funded.vip. Verify its data before relying on it.`, url:url.toString(), network:EXPLORE_NETWORK_LABEL });
}
let lastShareDashboard = null;
function renderShareInsights(dashboard = lastShareDashboard){
  if (dashboard) lastShareDashboard = dashboard;
  const panel = document.querySelector('#referral-command-center .referral-share-panel');
  if (!panel) return;
  let insight = panel.querySelector('.share-insights');
  if (!insight) { insight = document.createElement('div'); insight.className = 'share-insights'; panel.append(insight); }
  insight.replaceChildren();
  const visits = dashboard?.available ? dashboard.data.shareVisits : null;
  const heading = document.createElement('strong'); heading.textContent = 'Share insights';
  const metrics = document.createElement('div'); metrics.className = 'referral-share-metrics';
  const metric = (value, label) => {
    const item = document.createElement('span');
    const count = document.createElement('b'); count.textContent = String(value);
    const caption = document.createElement('small'); caption.textContent = label;
    item.append(count, caption); metrics.append(item);
  };
  metric(localShareActions(), 'Shares on this device');
  metric(dashboard?.available ? Number(dashboard.data.qualifiedCreators || 0) : '—', 'Qualified creators');
  metric(visits ? visits.consentedBrowsers : '—', 'Opted-in browsers');
  const note = document.createElement('small'); note.className = 'referral-share-note';
  note.textContent = visits
    ? `${visits.consentedVisitDays} visit days in the last ${visits.windowDays} days · ${visits.returningBrowsers} returning browsers. Visits count consenting browsers, not people.`
    : 'Visitor and creator counts need wallet access and an available referral service. Share actions are stored on this device.';
  insight.append(heading, metrics, note);
  if (visits && Object.keys(visits.byChannel || {}).length) {
    const channels = document.createElement('small'); channels.className = 'referral-share-source';
    channels.textContent = `Visit days by source: ${Object.entries(visits.byChannel).map(([source, count]) => `${source} ${count}`).join(' · ')}`;
    insight.append(channels);
  }
  if (dashboard?.available && dashboard.data.directCreatorsBySource && Object.keys(dashboard.data.directCreatorsBySource).length) {
    const activations = document.createElement('small'); activations.className = 'referral-share-source';
    activations.textContent = `Signed direct creators by source: ${Object.entries(dashboard.data.directCreatorsBySource).map(([source, count]) => `${source} ${count}`).join(' · ')}`;
    insight.append(activations);
  }
}
document.addEventListener('funded:share-action', () => renderShareInsights());
async function recordConsentedShareVisit(){
  let saved;
  try { saved = JSON.parse(localStorage.getItem(SHARE_VISIT_KEY) || 'null'); } catch { return; }
  if (!saved?.consent || !saved.visitorId) return;
  const query = new URLSearchParams(location.search);
  const incomingCode = normalizeReferralCode(query.get('ref'));
  const code = saved.code || incomingCode;
  if (!code) return;
  const source = saved.source || String(query.get('src') || 'direct').slice(0, 24);
  if (!saved.code) localStorage.setItem(SHARE_VISIT_KEY, JSON.stringify({ ...saved, code, source }));
  try { await apiRequest('/api/shares/visit', { method:'POST', body:{ code, source, visitorId:saved.visitorId } }); } catch { /* Optional analytics never blocks the page. */ }
}
function initShareVisitConsent(){
  const control = document.querySelector('#share-visit-consent');
  if (!control) return;
  let saved;
  try { saved = JSON.parse(localStorage.getItem(SHARE_VISIT_KEY) || 'null'); } catch {}
  control.checked = Boolean(saved?.consent);
  control.addEventListener('change', () => {
    if (control.checked) {
      const query = new URLSearchParams(location.search);
      const code = saved?.code || normalizeReferralCode(query.get('ref')) || getAppReferralAttribution()?.code || '';
      saved = { consent:true, visitorId:saved?.visitorId || crypto.randomUUID(), code,
        source:saved?.source || String(query.get('src') || 'direct').slice(0, 24) };
      localStorage.setItem(SHARE_VISIT_KEY, JSON.stringify(saved));
      void recordConsentedShareVisit();
    } else {
      saved = null;
      localStorage.removeItem(SHARE_VISIT_KEY);
    }
  });
  if (control.checked) void recordConsentedShareVisit();
}
initShareVisitConsent();
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

function refreshFeeRouterConfig(){
  if (feeRouterRefreshPromise) return feeRouterRefreshPromise;
  feeRouterRefreshPromise = checkFeeRouterConfig().finally(() => { feeRouterRefreshPromise = null; });
  return feeRouterRefreshPromise;
}
async function checkFeeRouterConfig(){
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
    const verified = await withRpcRetry(() => verifyFeeRouterAccount({ connection, programId: FEE_ROUTER_PROGRAM_ID }), { attempts: 2, delaysMs: [700] });
    feeRouterState = { status: verified.reason, verified: verified.verified, address: verified.address.toBase58(), programId: verified.programId.toBase58(), bump: verified.bump };
    if (addressNode) addressNode.textContent = `${feeRouterState.address.slice(0, 6)}…${feeRouterState.address.slice(-6)}`;
    if (status) {
      status.textContent = verified.verified ? 'Verified on Solana. This PDA can be assigned as Pump’s fee owner at creation.' : `Launch blocked: ${verified.reason.replaceAll('-', ' ')}.`;
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
    const result = await apiRequest('/api/x-fee/status', { signal: AbortSignal.timeout(8000) });
    xFeeStatus = result.available && result.data?.ready === true ? result.data : { ready: false, reasons: result.data?.reasons || ['X fee service is unavailable'] };
  } catch (error) { xFeeStatus = { ready: false, reasons: [error.message || 'X fee service is unavailable'] }; }
  const help = document.querySelector('#x-share-help');
  if (help) help.textContent = xFeeStatus.ready ? 'Verified X accounts can claim their share after mint-specific creator fees are collected.' : `Unavailable: ${xFeeFailureDetail()}.`;
  updateLaunchPreview();
  updateLaunchButton();
  if (wallet) scheduleLaunchCostRefresh();
}
function xFeeFailureDetail(){
  return xFeeStatus.reasons.join('; ').trim().replace(/[.!?]+$/, '') || 'X fee service is unavailable';
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
function renderPublishedFeeRates(){
  const effective = [APP_ECONOMICS.operationsEffectivePercent, APP_ECONOMICS.appReferralEffectivePercent, APP_ECONOMICS.communityEffectivePercent, APP_ECONOMICS.buybackEffectivePercent];
  const levels = APP_ECONOMICS.appReferralLevels;
  const percent = value => `${value}%`;
  const set = (selector, value) => { const node = document.querySelector(selector); if (node) node.textContent = value; };
  const setAll = (selector, values) => document.querySelectorAll(selector).forEach((node, index) => { if (index < values.length) node.textContent = values[index]; });
  const setWidths = (selector, values) => document.querySelectorAll(selector).forEach((node, index) => { if (index < values.length) node.style.width = percent(values[index]); });
  const levelGross = levels.map(level => level.effectivePercentOfCreatorFees);
  setWidths('.home-receipt-card .receipt-bars span', [80, ...effective]);
  setWidths('.fee-route-bar i', [80, ...effective]);
  setAll('.home-receipt-card .receipt-rows span', [
    '80 SOL Creator-directed', `${effective[0]} SOL Operations`, `${effective[1]} SOL Referral network`,
    `${effective[2]} SOL Community reserve`, `${effective[3]} SOL $FUNDED burn`,
  ]);
  setAll('.audience-referrer li', levelGross.map((rate, index) => `${percent(rate)} ${['direct', 'second', 'third'][index]} level`));
  setAll('.home-referral-levels article strong', levelGross.map(percent));
  setAll('.referral-tier-strip > span b', levelGross.map(percent));
  setAll('.app-revenue-grid > span b', [APP_ECONOMICS.operationsRateOfFundedRevenue, APP_ECONOMICS.appReferralRateOfFundedRevenue, APP_ECONOMICS.communityRateOfFundedRevenue, APP_ECONOMICS.buybackRateOfFundedRevenue].map(percent));
  setAll('.allocation-chips span b', effective.map(percent));
  setAll('.app-revenue-grid > span small', [
    `${percent(effective[0])} of gross fees`, levels.map(level => `L${level.level} ${percent(level.percentOfFundedRevenue)}`).join(' · '),
    `${percent(effective[2])} of gross fees`, `${percent(effective[3])} of gross fees`,
  ]);
  setAll('.fee-output-grid > div small', [
    '80% of gross', `${percent(effective[0])} of gross`,
    `L1 ${percent(levelGross[0])} · L2 ${percent(levelGross[1])} · L3 ${percent(levelGross[2])}`,
    `${percent(effective[2])} of gross`, `${percent(effective[3])} of gross`,
  ]);
  setAll('.referral-level-results span small', levelGross.map((rate, index) => `Level ${index + 1} · ${percent(rate)} of gross`));
  set('.referral-growth-hero p', `A direct creator can earn you ${percent(levelGross[0])} of their gross creator fees, with additional rewards from the next two levels.`);
  set('#referrals .referral-calculator + .field-help', `Example only: the three levels total ${percent(APP_ECONOMICS.appReferralEffectivePercent)} of gross collected fees when all levels qualify. Rewards require collected fees.`);
  set('.home-referral-guide .data-badge', `${percent(APP_ECONOMICS.appReferralEffectivePercent)} total policy`);
  set('#paid .revenue-model > .field-help', `Levels 1–3 receive ${levelGross.map(percent).join(', ')} of gross creator fees. Missing upline levels move to the community reserve. Existing coins keep their recorded split.`);
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
let communityClaimReview = null;
async function loadCommunityReserveStatuses(){
  const response = await apiRequest('/api/airdrops/reserves').catch(() => ({ available:false }));
  communityReserveStatus = response.available && response.data?.cluster === 'devnet' && Array.isArray(response.data.reserves) ? 'ready' : 'unavailable';
  verifiedCommunityReserves = communityReserveStatus === 'ready'
    ? new Map(response.data.reserves.filter(row => row?.mint).map(row => [row.mint, row])) : new Map();
  communityClaimPolicy = communityReserveStatus === 'ready' ? response.data.claimPolicy || null : null;
  renderAirdropClaims();
  renderRegistry();
}
function includeVerifiedRegistryLaunches(marketAssets, feedRecords = []) {
  if (EXPLORE_CLUSTER !== 'devnet') return marketAssets;
  const byMint = new Map(marketAssets.filter(item => !item.registryFallback).map(item => [item.address, item]));
  const feedByMint = new Map(feedRecords.map(item => [item.address, item]));
  for (const launch of verifiedLaunchPolicies) {
    if (!launch.mint || byMint.has(launch.mint)) continue;
    const feed = feedByMint.get(launch.mint);
    byMint.set(launch.mint, {
      address: launch.mint, mint: launch.mint,
      name: launch.name || feed?.name || 'Unnamed token',
      symbol: launch.symbol || feed?.symbol || 'TOKEN',
      icon: String(launch.symbol || feed?.symbol || 'T').slice(0, 1),
      imageUri: launch.imageUri || feed?.imageUri || null,
      website: launch.website || feed?.website || null,
      twitter: launch.twitter || feed?.twitter || null,
      telegram: launch.telegram || feed?.telegram || null,
      discord: launch.discord || feed?.discord || null,
      creator: launch.creatorWallet || launch.feePayer || null,
      description: launch.description || feed?.description || '',
      createdTimestamp: Number(launch.createdTimestamp || launch.blockTime || feed?.createdTimestamp) || null,
      source: 'Verified launch registry', registryFallback: true,
      complete: null, migrated: null, change: '—',
      value: 'MC unavailable', meta: 'Verified launch · market data unavailable',
    });
  }
  return [...byMint.values()];
}
async function loadVerifiedLaunchPolicies(signal){
  const response = await apiRequest('/api/launches', { signal }).catch(() => ({ available: false }));
  signal?.throwIfAborted();
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
  assets = includeVerifiedRegistryLaunches(assets);
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
let verifiedBoosts = {};
let verifiedBoostsAvailable = false;
let boostPurchasesEnabled = false;
let boostExpiryTimer = null;
let boostCheckout = { mint: null, packageId: '10x', quote: null, pendingSignature: null, busy: false, message: '' };
observeSupplementalBoostCards();
function scheduleBoostExpiryRefresh(){
  clearTimeout(boostExpiryTimer);
  const nextExpiry = Math.min(...Object.values(verifiedBoosts).flatMap(item => Array.isArray(item.packages)
    ? item.packages.map(pack => Date.parse(pack.expiresAt)) : [Date.parse(item.nextExpiry || item.expiresAt)])
    .filter(time => Number.isFinite(time) && time > Date.now()));
  if (!Number.isFinite(nextExpiry)) return;
  boostExpiryTimer = setTimeout(() => {
    setCardBoostSnapshot(verifiedBoosts);
    for (const asset of assets) asset.postLaunchBoostMultiplier = activeBoostMultiplier(verifiedBoosts[asset.address]);
    renderExploreAssets();
    renderRegistry();
    renderHomeLaunchBoard();
    renderWatchlist();
    renderCreatorLaunches();
    renderAirdropDirectory();
    renderCoinPromotionBadge();
    scheduleBoostExpiryRefresh();
    if (!document.hidden) void loadVerifiedBoosts();
  }, Math.max(100, nextExpiry - Date.now() + 100));
}
async function loadVerifiedBoosts(signal){
  const response = await apiRequest('/api/boosts', { signal }).catch(() => ({ available:false }));
  signal?.throwIfAborted();
  if (!response.available || response.data?.cluster !== EXPLORE_CLUSTER) {
    verifiedBoostsAvailable = false;
    verifiedBoosts = {};
    setCardBoostSnapshot(verifiedBoosts);
    clearTimeout(boostExpiryTimer);
    for (const asset of assets) asset.postLaunchBoostMultiplier = 0;
    renderExploreAssets();
    renderRegistry();
    renderHomeLaunchBoard();
    renderWatchlist();
    renderCreatorLaunches();
    renderAirdropDirectory();
    renderCoinPromotionBadge();
    return;
  }
  verifiedBoosts = response.data.active || {};
  verifiedBoostsAvailable = true;
  boostPurchasesEnabled = response.data.enabled === true;
  setCardBoostSnapshot(verifiedBoosts);
  for (const asset of assets) asset.postLaunchBoostMultiplier = activeBoostMultiplier(verifiedBoosts[asset.address]);
  scheduleBoostExpiryRefresh();
  renderExploreAssets();
  renderRegistry();
  renderHomeLaunchBoard();
  renderWatchlist();
  renderCreatorLaunches();
  renderAirdropDirectory();
  renderCoinPromotionBadge();
  if (document.querySelector('#explore-boost-dialog')?.open) renderExploreBoostDialog();
}
function exploreBoostStatus(mint){
  const multiplier = activeBoostMultiplier(verifiedBoosts[mint]);
  if (multiplier) return `Sponsored · ${multiplier.toLocaleString()}x`;
  return '';
}
function exploreBoostAmountMarkup(mint){
  return boostPackageBadgesMarkup(verifiedBoosts[mint]);
}
function exploreTierBadgeMarkup(mint){
  const promotion = promotionForMint(mint);
  const info = `<button type="button" class="explore-tier-info" data-tier-info-mint="${escapeHtml(mint)}" aria-label="Explain launch tier for ${escapeHtml(shortAddress(mint))}" title="Explain this launch tier">${icon('info')}</button>`;
  if (promotion) return `<span class="scanner-tier-wrap"><a class="explore-tier-badge" data-tier="${escapeHtml(promotion.tier)}" href="${escapeHtml(exploreExplorer(`tx/${encodeURIComponent(promotion.signature)}`))}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(`${promotion.amountTokens.toLocaleString()} $FUNDED burned with the verified launch · view receipt`)}">${escapeHtml(promotion.tier)}</a>${info}</span>`;
  const verified = Boolean(verifiedLaunchPolicyForMint(mint));
  return `<span class="scanner-tier-wrap"><span class="explore-tier-badge" data-tier="${verified ? 'standard' : 'unavailable'}" title="${verified ? 'Verified launch policy · no paid promotion burn' : 'Launch tier unavailable without a verified policy'}">${verified ? 'Standard' : 'Unavailable'}</span>${info}</span>`;
}
function openExploreTierInfo(mint){
  const asset = assets.find(item => item.address === mint);
  const dialog = document.querySelector('#explore-tier-dialog');
  const details = document.querySelector('#explore-tier-details');
  if (!asset || !dialog || !details) return;
  const policy = verifiedLaunchPolicyForMint(mint);
  const promotion = promotionForMint(mint);
  const symbol = escapeHtml(asset.symbol || shortAddress(mint));
  document.querySelector('#explore-tier-title').textContent = `${asset.symbol || 'Token'} · launch tier`;
  if (!policy) {
    details.innerHTML = `<p class="explore-tier-summary">${symbol} has no verified launch policy in this feed. Its tier and reward allocation are unavailable.</p><a class="explore-tier-detail-link" href="/token/${encodeURIComponent(mint)}">Open token record ↗</a>`;
  } else {
    const allocation = verifiedPolicyPercent(policy.communityAirdrop?.allocationPercent);
    const airdrop = allocation == null ? 'Unavailable' : formatVerifiedPercent(allocation);
    const tier = promotion ? promotion.tier : 'Standard';
    details.innerHTML = `<div class="explore-tier-fact"><span>Verified launch tier</span><strong>${escapeHtml(tier)}</strong><small>${promotion ? `${escapeHtml(Number(promotion.amountTokens).toLocaleString())} $FUNDED burned in the confirmed launch transaction` : 'No verified paid promotion burn'}</small></div>
      <div class="explore-tier-fact"><span>Community allocation</span><strong>${escapeHtml(airdrop)}</strong><small>Share of token supply in the launch policy; vault funding and distribution require separate verification.</small></div>
      ${promotion ? `<a class="explore-tier-detail-link" href="${escapeHtml(exploreExplorer(`tx/${encodeURIComponent(promotion.signature)}`))}" target="_blank" rel="noopener noreferrer">View burn receipt ↗</a>` : ''}
      <a class="explore-tier-detail-link" href="/token/${encodeURIComponent(mint)}">Open token record ↗</a>`;
  }
  if (!dialog.open) dialog.showModal();
}
function exploreAirdropMarkup(record){
  if (record.communityAirdropPercent == null) return '<span class="scanner-airdrop scanner-airdrop--unavailable" title="No verified launch allocation is available"><strong>—</strong><small>Policy unavailable</small></span>';
  const policy = verifiedLaunchPolicyForMint(record.address);
  const reserve = verifiedCommunityReserves.get(record.address);
  const funded = communityReserveStatus === 'ready' && reserve?.verified === true && ['funded', 'drop-active'].includes(reserve.status)
    && Number(reserve.reservedTokens) === Number(policy?.communityAirdrop?.reservedTokens);
  const active = funded && reserve.status === 'drop-active';
  const detail = active ? 'Drop active' : funded ? 'Vault funded' : 'Funding unverified';
  const percent = formatVerifiedPercent(record.communityAirdropPercent);
  const status = active ? 'Reserve vault funded and drop active; check wallet eligibility and claim proof separately.'
    : funded ? 'Reserve vault funding verified; eligibility and distribution remain pending.'
      : 'Reserve vault funding and distribution are not verified.';
  return `<a class="scanner-airdrop" href="#airdrops" title="${escapeHtml(`${percent} of token supply in the verified launch policy. ${status}`)}"><strong>${escapeHtml(percent)}</strong><small>${detail}</small></a>`;
}
function boostAssetForMint(mint){
  const known = assets.find(item => item.address === mint);
  if (known || getCoinMintAddress() !== mint) return known || null;
  const symbol = document.querySelector('#coin-symbol')?.textContent?.trim() || '';
  const name = document.querySelector('#coin-page-title')?.textContent?.trim() || '';
  return { address:mint,
    symbol: /^(?:on-chain|loading.*|unavailable|—|–)$/i.test(symbol) ? shortAddress(mint) : symbol || shortAddress(mint),
    name: /^(?:loading token.*|token.*unavailable|—|–)$/i.test(name) ? shortAddress(mint) : name || shortAddress(mint) };
}
function openExploreBoost(mint){
  if (boostCheckout.busy) { showToast('Finish the current boost payment or verification before opening another checkout.'); return; }
  const asset = boostAssetForMint(mint);
  const dialog = document.querySelector('#explore-boost-dialog');
  if (!asset || !dialog) return;
  boostCheckout = { mint, packageId:'10x', quote:null, pendingSignature:null, busy:false, message:'' };
  try {
    const pending = readPendingBoost(mint);
    if (pending?.quote?.mint === mint && pending?.signature && pending?.quote?.id) {
      boostCheckout = { ...boostCheckout, packageId:pending.quote.packageId, quote:pending.quote,
        pendingSignature:pending.signature, message:'A submitted payment is awaiting proof. Retry verification before paying again.' };
    }
  } catch (error) { boostCheckout.recoveryError = error.message || 'Saved payment details are unavailable. Check device storage before paying again.'; }
  exploreBoostHistory = [];
  renderExploreBoostDialog();
  if (!dialog.open) dialog.showModal();
  void loadExploreBoostHistory(mint);
}
let exploreBoostHistory = [];
async function loadExploreBoostHistory(mint){
  const response = await apiRequest(`/api/boosts?mint=${encodeURIComponent(mint)}`).catch(() => ({ available:false }));
  if (!response.available || boostCheckout.mint !== mint) return;
  exploreBoostHistory = response.data.history || [];
  if (boostCheckout.pendingSignature && !boostCheckout.busy) {
    try {
      if (archiveVerifiedBoostFromHistory(boostCheckout, exploreBoostHistory)) {
        boostCheckout.pendingSignature = null;
        boostCheckout.quote = null;
        boostCheckout.message = 'Previous payment verified. Choose another boost pack or request a new quote.';
      }
    } catch (error) {
      boostCheckout.recoveryError = error.message || 'Saved payment recovery could not be completed. Retry the original payment before paying again.';
    }
  }
  if (response.data.active?.[mint]) verifiedBoosts[mint] = response.data.active[mint];
  else delete verifiedBoosts[mint];
  for (const asset of assets) if (asset.address === mint) asset.postLaunchBoostMultiplier = activeBoostMultiplier(verifiedBoosts[mint]);
  scheduleBoostExpiryRefresh();
  renderExploreAssets();
  renderRegistry();
  renderCoinPromotionBadge();
  renderExploreBoostDialog();
}
function renderExploreBoostDialog(){
  const { mint, packageId, quote, pendingSignature, busy, message, failureProof, recoveryError } = boostCheckout;
  const asset = boostAssetForMint(mint);
  const details = document.querySelector('#explore-boost-details');
  if (!asset || !details) return;
  const promotion = promotionForMint(mint);
  const name = escapeHtml(asset.name || asset.symbol || shortAddress(mint));
  document.querySelector('#explore-boost-title').textContent = `Give ${asset.symbol || asset.name || 'token'} a ⚡ Boost`;
  const active = activeBoostMultiplier(verifiedBoosts[mint]) ? verifiedBoosts[mint] : null;
  const selected = boostPackage(packageId);
  const available = !recoveryError && ((EXPLORE_CLUSTER === 'devnet' && !APP_MAINNET_READ_ONLY && boostPurchasesEnabled) || Boolean(pendingSignature));
  const boostTotal = verifiedBoostsAvailable && active ? Number(active.multiplier) : 0;
  const quotedAmount = quote && quote.mint === mint && quote.packageId === packageId && Date.parse(quote.expiresAt) > Date.now()
    ? (quote.lamports / 1e9).toFixed(9) : null;
  details.innerHTML = `<p class="explore-boost-intro">Showcase your support for ${name} with a timed, clearly labelled paid boost. Active boosts can improve its position in the Boosted view; market cap and trading activity still come from observed data.</p>
    <details class="explore-boost-how"><summary>How does it work?</summary><p>Choose a pack, request a fresh Devnet SOL quote, then review the payment in your wallet. The boost activates only after its payment is finalized and verified. Overlapping packs add together until each expires. A boost does not guarantee a ranking or trading activity.</p></details>
    <h3 class="explore-boost-pack-heading">Choose a boost pack</h3>
    <p class="explore-boost-payment-method"><span>Payment method</span><strong>SOL · Solana Devnet</strong><small>Estimated SOL amounts are shown below. Review the exact amount and recipient before signing.</small></p>
    <div class="explore-boost-packages" role="group" aria-label="Boost packages">${BOOST_PACKAGES.map(item => `<button type="button" data-boost-package="${item.id}" aria-pressed="${item.id === packageId}" ${busy || pendingSignature ? 'disabled' : ''}><span class="boost-pack-bolt" aria-hidden="true">⚡</span><strong>${item.id}</strong><small>${item.hours} hours</small><b>${Number.isFinite(coinSolUsdPrice) && coinSolUsdPrice > 0 ? `≈ ${(item.usd / coinSolUsdPrice).toFixed(4)} SOL` : 'Pay in SOL'}</b><small>$${item.usd.toLocaleString()} package · exact SOL quote at checkout</small></button>`).join('')}</div>
    <div class="explore-boost-golden"><h3>Golden ticker unlocks at 500 active boosts</h3><div class="explore-boost-golden-preview"><span>Verified active boosts</span><strong class="${boostTotal >= 500 ? 'golden-ticker' : ''}">${escapeHtml(asset.symbol || 'TOKEN')}</strong><span>${boostTotal >= 500 ? 'Golden ticker active' : 'Golden ticker preview'}</span></div><p>Boosts active: <strong>${verifiedBoostsAvailable ? boostTotal.toLocaleString() : 'Unavailable'}</strong><span>Boosts needed: <strong>${verifiedBoostsAvailable ? Math.max(0, 500 - boostTotal).toLocaleString() : 'Unavailable'}</strong></span></p></div>
    <div class="explore-boost-current"><span>Active paid boost</span><strong>${verifiedBoostsAvailable ? (active ? `${escapeHtml(active.multiplier)}x${active.golden ? ' · golden ticker' : ''}` : 'None') : 'Unavailable'}</strong><small>${active ? `${active.count} verified payment${active.count === 1 ? '' : 's'} · latest expiry ${escapeHtml(new Date(active.expiresAt).toLocaleString())}` : 'No active verified payment'} · Launch tier: ${escapeHtml(promotion?.label || 'Standard')}</small></div>
    <p class="explore-boost-explainer">Fixed USD package price, paid in Devnet SOL at the fresh checkout rate. Devnet SOL has no intended monetary value. Network fee is additional. Boosting is paid visibility, not an endorsement or trade guarantee.</p>
    ${quotedAmount ? `<div class="explore-boost-quote"><strong>Review exact SOL payment</strong><span>${quotedAmount} SOL</span><small>$${quote.usd} package at $${quote.solUsd}/SOL · network fee additional</small><small>Recipient ${escapeHtml(quote.recipient)} · Quote expires ${escapeHtml(new Date(quote.expiresAt).toLocaleTimeString())}</small></div>` : quote && !pendingSignature ? '<p class="explore-boost-quote-expired">The SOL quote expired. Request a fresh amount before paying.</p>' : ''}
    ${pendingSignature ? `<a class="explore-boost-proof" href="${escapeHtml(exploreExplorer(`tx/${encodeURIComponent(pendingSignature)}`))}" target="_blank" rel="noopener noreferrer">View submitted transaction ↗</a>` : ''}
    <button type="button" class="primary-button explore-boost-pay" ${!available || busy ? 'disabled' : ''}>${busy ? 'Checking payment…' : failureProof ? 'Start a new quote' : pendingSignature ? 'Retry payment verification' : quotedAmount ? `Pay ${quotedAmount} SOL · ${selected.id}` : `Get exact SOL quote · ${selected.id}`}</button>
    <p class="explore-boost-message" role="status">${escapeHtml(recoveryError || message || (available ? 'Connect a Devnet wallet in a wallet-enabled browser to get the exact SOL quote.' : 'New boost purchases are currently unavailable.'))}</p>
    <div class="explore-boost-history"><strong>Payment history</strong>${exploreBoostHistory.filter(row => row.mint === mint).slice(0, 5).map(row => `<p><span>${escapeHtml(row.packageId)} · ${escapeHtml(shortAddress(row.payer))} · ${escapeHtml(new Date(row.expiresAt).toLocaleString())}</span><a href="${escapeHtml(exploreExplorer(`tx/${encodeURIComponent(row.signature)}`))}" target="_blank" rel="noopener noreferrer">Receipt ↗</a></p>`).join('') || '<small>No verified boost payments yet.</small>'}</div>`;
}
async function handleExploreBoostPay(){
  if (boostCheckout.busy || !boostCheckout.mint || boostCheckout.recoveryError) return;
  if (boostCheckout.failureProof) {
    try {
      archiveBoostPayment(boostCheckout, boostCheckout.failureProof);
      boostCheckout.pendingSignature = null;
      boostCheckout.quote = null;
      boostCheckout.failureProof = null;
      boostCheckout.message = 'The failed transaction is saved in device history. Request a new quote when you are ready.';
    } catch (error) { boostCheckout.message = error.message || 'Recovery could not be saved. Keep the original payment and retry.'; }
    renderExploreBoostDialog();
    return;
  }
  if (boostCheckout.pendingSignature) return verifyExploreBoostPayment();
  boostCheckout.busy = true;
  boostCheckout.message = '';
  renderExploreBoostDialog();
  try {
    if (!wallet) await connectWallet();
    const session = captureWalletSession();
    if (!session || !canSignTransactions(session.provider)) throw new Error('Connect a Solana wallet that can sign transactions.');
    if (!boostCheckout.quote || boostCheckout.quote.mint !== boostCheckout.mint || boostCheckout.quote.packageId !== boostCheckout.packageId || boostCheckout.quote.payer !== session.address || Date.parse(boostCheckout.quote.expiresAt) <= Date.now()) {
      const response = await apiRequest('/api/boosts/quote', { method:'POST', body:{ mint:boostCheckout.mint, payer:session.address, packageId:boostCheckout.packageId } });
      assertWalletSessionCurrent(session);
      if (!response.available) throw new Error('Quotes are unavailable. Try again shortly.');
      boostCheckout.quote = validateBoostQuote(response.data, { mint: boostCheckout.mint, payer: session.address, packageId: boostCheckout.packageId });
      boostCheckout.message = 'Review the exact SOL amount and recipient, then select Pay.';
    } else {
      const { PublicKey, SystemProgram, Transaction, TransactionInstruction } = await getSolana();
      assertWalletSessionCurrent(session);
      const rpc = connection;
      const quote = validateBoostQuote(boostCheckout.quote, { mint: boostCheckout.mint, payer: session.address, packageId: boostCheckout.packageId });
      const latest = await rpc.getLatestBlockhash('confirmed');
      assertWalletSessionCurrent(session);
      validateBoostQuote(quote, { mint: boostCheckout.mint, payer: session.address, packageId: boostCheckout.packageId });
      const transaction = new Transaction().add(
        SystemProgram.transfer({ fromPubkey:session.provider.publicKey, toPubkey:new PublicKey(quote.recipient), lamports:quote.lamports }),
        new TransactionInstruction({ keys:[], programId:new PublicKey(BOOST_MEMO_PROGRAM), data:new TextEncoder().encode(quote.memo) }),
      );
      transaction.feePayer = session.provider.publicKey;
      transaction.recentBlockhash = latest.blockhash;
      boostCheckout.message = 'Review the SOL transfer and boost memo in your wallet.';
      renderExploreBoostDialog();
      const signed = await session.provider.signTransaction(transaction);
      assertWalletSessionCurrent(session);
      validateBoostQuote(quote, { mint: boostCheckout.mint, payer: session.address, packageId: boostCheckout.packageId });
      const signedBytes = signed.serialize();
      if (!signed.signature || signed.signature.length !== 64) throw new Error('Wallet returned a transaction without a valid signature. No payment was sent.');
      const signature = bs58.encode(signed.signature);
      // Persist the signed identity BEFORE broadcast. An RPC timeout can occur after acceptance.
      // Recovery remains verification-only until the original signature is resolved.
      try { await saveSignedBoostPayment({ quote, signature, lastValidBlockHeight: latest.lastValidBlockHeight }); }
      catch (error) { throw new Error(`${error.message || 'Device recovery storage is unavailable.'} No payment was sent.`); }
      boostCheckout.pendingSignature = signature;
      boostCheckout.quote = quote;
      const submitted = await rpc.sendRawTransaction(signedBytes, { skipPreflight:false, maxRetries:3 });
      if (submitted !== signature) throw new Error('RPC returned a different signature. Verify the originally signed payment before continuing.');
      boostCheckout.message = 'Transaction submitted. Waiting for finalized Devnet proof.';
      await verifyExploreBoostPayment(true);
      return;
    }
  } catch (error) { boostCheckout.message = boostCheckout.pendingSignature ? `${error.message || 'Submission could not be confirmed.'} Use Retry payment verification for the signed transaction; do not send another payment.` : error.message || 'Boost checkout failed. No boost was activated.'; }
  finally { boostCheckout.busy = false; renderExploreBoostDialog(); }
}
async function verifyExploreBoostPayment(alreadyBusy = false){
  if (!boostCheckout.pendingSignature || !boostCheckout.quote) return;
  if (!alreadyBusy) { boostCheckout.busy = true; renderExploreBoostDialog(); }
  try {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await apiRequest('/api/boosts/confirm', { method:'POST', body:{ quoteId:boostCheckout.quote.id, signature:boostCheckout.pendingSignature } });
      if (!response.available) throw new Error('Payment verification is unavailable. Try again shortly.');
      const resolution = boostPaymentResolution(response.data, boostCheckout);
      if (resolution === 'failed') {
        boostCheckout.failureProof = response.data;
        boostCheckout.message = 'The transaction failed on-chain. The boost payment was not transferred; a network fee may apply. You can start a new quote.';
        return;
      }
      if (resolution === 'finalized') {
        const mint = boostCheckout.mint;
        archiveBoostPayment(boostCheckout, response.data);
        boostCheckout.pendingSignature = null;
        boostCheckout.quote = null;
        boostCheckout.message = 'Boost activated from a finalized Solana payment. View the receipt below.';
        await loadVerifiedBoosts();
        await loadExploreBoostHistory(mint);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    boostCheckout.message = 'The payment outcome is still unconfirmed. Check the original transaction again. An expired quote alone does not mean the payment failed.';
  } catch (error) { boostCheckout.message = `${error.message || 'Payment verification failed.'} Retry this transaction; do not pay again.`; }
  finally { boostCheckout.busy = false; renderExploreBoostDialog(); }
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
  if (!policy) return { ...record, benefitPolicyVerified: false, promotionTier: null, promotionBurnTokens: null, postLaunchBoostMultiplier: activeBoostMultiplier(verifiedBoosts[record.address || record.mint]), communityAirdropPercent: null, holderFeePercent: null, xFeePercent: null, creatorFeePercent: null };
  const paidPromotion = verifiedPromotionBadge(policy);
  const shares = policy.feeDistribution?.creatorDirected?.shares || {};
  return {
    ...record,
    benefitPolicyVerified: true,
    promotionTier: paidPromotion?.tier || 'standard',
    postLaunchBoostMultiplier: activeBoostMultiplier(verifiedBoosts[record.address || record.mint]),
    promotionBurnTokens: paidPromotion && Number.isFinite(Number(paidPromotion.amountTokens)) ? Math.max(0, Number(paidPromotion.amountTokens)) : 0,
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
  const identity = document.querySelector('#coin-page .coin-identity');
  if (!identity) return;
  const main = identity.querySelector(':scope > div:last-of-type');
  main?.classList.add('coin-identity-main');
  let rail = identity.querySelector('.coin-package-rail');
  if (!rail) {
    rail = document.createElement('aside');
    rail.className = 'coin-package-rail';
    rail.setAttribute('aria-label', 'Favorite, boost and launch package');
    const watch = document.querySelector('#coin-watch');
    const boost = document.querySelector('#coin-boost');
    if (watch) rail.append(watch);
    if (boost) {
      boost.className = 'coin-package-chip coin-package-chip--boost';
      boost.innerHTML = `<span class="coin-package-bag" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M4 9h16l-1.3 11H5.3L4 9Z"/><path d="M9 10V7a3 3 0 0 1 6 0v3"/></svg><span>⚡</span></span><span class="coin-package-copy"><small>Paid boost</small><strong id="coin-boost-total">—</strong></span>`;
      rail.append(boost);
    }
    identity.append(rail);
  }
  const mint = getCoinMintAddress();
  const active = verifiedBoosts[mint];
  const activeMultiplier = activeBoostMultiplier(active);
  let packageBadges = identity.querySelector('#coin-boost-packages');
  if (!packageBadges) {
    packageBadges = document.createElement('span');
    packageBadges.id = 'coin-boost-packages';
    identity.querySelector('#coin-symbol')?.after(packageBadges);
  }
  packageBadges.innerHTML = exploreBoostAmountMarkup(mint);
  document.querySelector('#coin-page-title')?.classList.toggle('golden-ticker', verifiedBoostsAvailable && activeMultiplier >= 500);
  const boostTotal = rail.querySelector('#coin-boost-total');
  if (boostTotal) boostTotal.textContent = verifiedBoostsAvailable
    ? (activeMultiplier ? `${activeMultiplier.toLocaleString()}x total` : 'No active boost')
    : 'Status unavailable';
  const boostButton = rail.querySelector('#coin-boost');
  if (boostButton) {
    boostButton.classList.toggle('is-active', verifiedBoostsAvailable && Boolean(activeMultiplier));
    boostButton.title = verifiedBoostsAvailable
      ? (activeMultiplier ? `${activeBoostPackages(active).length} verified boost payment${activeBoostPackages(active).length === 1 ? '' : 's'} · active total ${activeMultiplier}x` : 'No active verified boost · view packages')
      : 'Boost status unavailable · view packages';
    boostButton.setAttribute('aria-label', `View boost packages · ${boostTotal?.textContent || 'status unavailable'}`);
  }
  let holder = document.querySelector('#coin-promotion-badge');
  if (!holder) {
    holder = document.createElement('span');
    holder.id = 'coin-promotion-badge';
    rail.append(holder);
  }
  holder.replaceChildren();
  const presentation = coinDetailPackage(verifiedLaunchPolicyForMint(mint));
  const badge = presentation.badge;
  const hero = document.querySelector('#coin-page .coin-hero-card');
  if (hero) hero.dataset.launchTier = presentation.tier;
  const profile = document.querySelector('#coin-profile');
  const heroAside = hero?.querySelector('.coin-hero-aside');
  const side = document.querySelector('#coin-page .coin-side-column');
  if (profile && heroAside && side) {
    if (presentation.tier === 'standard' || presentation.tier === 'unknown') {
      const market = side.querySelector('.coin-market-aside');
      if (market) market.after(profile);
      else side.append(profile);
    } else {
      heroAside.prepend(profile);
    }
  }
  const artworkLabel = document.querySelector('#coin-artwork-package');
  if (artworkLabel) {
    artworkLabel.hidden = !badge;
    artworkLabel.textContent = badge ? `${presentation.label} launch · ${Number(badge.amountTokens).toLocaleString()} $FUNDED burned` : '';
  }
  const packageElement = document.createElement(badge ? 'a' : 'span');
  packageElement.className = `coin-package-chip coin-package-chip--promotion${badge ? ` is-${badge.tier}` : ''}`;
  if (badge) {
    packageElement.href = exploreExplorer(`tx/${encodeURIComponent(badge.signature)}`);
    packageElement.target = '_blank';
    packageElement.rel = 'noopener noreferrer';
    packageElement.title = `${badge.amountTokens.toLocaleString()} $FUNDED burned in the verified launch · view receipt`;
    packageElement.setAttribute('aria-label', `${badge.tier} launch promotion · view verified burn receipt`);
  } else {
    packageElement.title = presentation.tier === 'standard' ? 'Verified standard launch; no paid promotion burn' : 'Launch package cannot be verified yet';
  }
  const symbol = badge?.tier === 'premier' ? '★' : badge?.tier === 'pro' ? '◆' : '✦';
  packageElement.innerHTML = `<span class="coin-package-bag" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M4 9h16l-1.3 11H5.3L4 9Z"/><path d="M9 10V7a3 3 0 0 1 6 0v3"/></svg><span>${symbol}</span></span><span class="coin-package-copy"><small>Launch package</small><strong>${presentation.label}</strong></span>`;
  holder.append(packageElement);
  renderCoinRegistryIdentity(mint);
  renderCoinRewardsPolicy(verifiedLaunchPolicyForMint(mint), mint);
}
window.fundedRenderCoinPromotionBadge = renderCoinPromotionBadge;
function renderCoinRegistryIdentity(mint){
  if (document.querySelector('#coin-rpc-status')?.textContent?.trim() !== 'Data unavailable') return;
  const launch = verifiedLaunchPolicyForMint(mint);
  if (!launch?.onchainVerified) return;
  const name = typeof launch.name === 'string' ? launch.name.trim() : '';
  const symbol = typeof launch.symbol === 'string' ? launch.symbol.trim() : '';
  if (!name && !symbol) return;
  setCoinField('#coin-page-title', name || 'Verified launch');
  setCoinField('#coin-symbol', symbol || '—');
  setCoinField('#coin-artwork-symbol', symbol || '—');
  setCoinField('#coin-avatar', (symbol || name).slice(0, 1).toUpperCase());
  setCoinField('#coin-description', 'This coin’s name and symbol are confirmed. Current trading and holder details are unavailable.');
  setCoinFact('#coin-metadata-status', 'Verified launch registry', 'clear');
  if (isDevnetImageUri(launch.imageUri, mint)) {
    const avatar = document.querySelector('#coin-avatar');
    if (avatar) {
      avatar.textContent = '';
      avatar.style.backgroundImage = `url("${launch.imageUri}")`;
      avatar.style.backgroundSize = 'cover';
      avatar.style.backgroundPosition = 'center';
    }
  }
}
function getWalletLaunchPolicies(){
  return walletLaunches(verifiedLaunchPolicies, connectedWalletAddress);
}
function portfolioHolderCount(asset){
  const indexed = asset?.holders == null || asset.holders === '' ? NaN : Number(asset.holders);
  if (Number.isFinite(indexed) && indexed >= 0) return indexed.toLocaleString();
  const holders = asset?.holderWalletCount == null || asset.holderWalletCount === '' ? NaN : Number(asset.holderWalletCount);
  if (Number.isFinite(holders) && holders >= 0) return `${asset?.holderWalletCoverage === 'lower-bound' ? '≥' : ''}${holders.toLocaleString()}`;
  const cached = homeHolderCountCache.get(asset?.address);
  if (cached && Date.now() - cached.at < 300_000 && Number.isFinite(cached.count) && cached.count >= 0) {
    return `${cached.coverage === 'lower-bound' ? '≥' : ''}${cached.count.toLocaleString()}`;
  }
  return '—';
}
function loadTokenLogo(avatar, launch, { probeMissing = false } = {}){
  const mint = String(launch?.mint || '');
  if (!avatar || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint) || (!probeMissing && !isDevnetImageUri(launch?.imageUri, mint))) return;
  const sources = [`/devnet-images/${encodeURIComponent(mint)}`, devnetImageUri(mint)];
  let next = 0;
  const trySource = () => {
    if (!avatar.isConnected || next >= sources.length) return;
    const image = new Image();
    image.alt = '';
    image.decoding = 'async';
    image.onload = () => { if (avatar.isConnected) { avatar.replaceChildren(image); avatar.removeAttribute('title'); } };
    image.onerror = trySource;
    image.src = sources[next++];
  };
  trySource();
}
function loadPortfolioLogo(card, launch, options){
  loadTokenLogo(card?.querySelector('.portfolio-token-avatar, .asset-icon, .wallet-activity-icon, .home-token-avatar, .home-holder-reward-avatar, .claim-token-mark, .claim-token > span, .explore-ticker-token > i, .explore-tape-logo, .terminal-signal-logo, .leader-token-logo, .coin-trade-token-avatar'), launch, options);
}
function loadVerifiedTokenLogos(container, options){
  container?.querySelectorAll('[data-logo-mint]').forEach(row => loadPortfolioLogo(row, verifiedLaunchPolicyForMint(row.dataset.logoMint), options));
}
function tokenCardCreatorWallet(mint){
  return tokenCardData({ mint, policy: verifiedLaunchPolicyForMint(mint) }).launchWallet;
}
function tokenCardAddressesMarkup(mint, creatorWallet = tokenCardCreatorWallet(mint)){
  if (!mint) return '';
  const address = (value, kind, label) => `<span title="${escapeHtml(label)}: ${escapeHtml(value)}"><small>${escapeHtml(label)}</small><code>${escapeHtml(value.slice(0, 5))}…${escapeHtml(value.slice(-4))}</code><button type="button" class="token-card-copy-address" data-copy-address="${escapeHtml(value)}" data-copy-kind="${kind}" aria-label="Copy full ${kind === 'creator' ? 'launch wallet' : 'token'} address" title="Copy full ${kind === 'creator' ? 'launch wallet' : 'token'} address">${icon('copy')}</button></span>`;
  return `<div class="token-card-addresses">${address(mint, 'token', 'CA')}${creatorWallet ? address(creatorWallet, 'creator', 'Launch wallet') : ''}</div>`;
}
function tokenCardWatchMarkup(mint, symbol){
  const saved = getWatchlist().includes(mint);
  return `<button type="button" class="watch-button token-card-action-watch${saved ? ' active' : ''}" data-mint="${escapeHtml(mint || '')}" aria-label="${saved ? 'Remove token from watchlist' : `Save ${escapeHtml(symbol || 'token')} to watchlist`}" aria-pressed="${saved}" title="${saved ? 'Remove from watchlist' : 'Save to watchlist'}">${icon(saved ? 'starFilled' : 'star')}</button>`;
}
function tokenCardShareMarkup(mint, symbol, name){
  return `<button type="button" class="share-asset token-card-action-share" data-share-mint="${escapeHtml(mint || '')}" data-share-symbol="${escapeHtml(symbol || 'TOKEN')}" data-share-name="${escapeHtml(name || '')}">Share</button>`;
}
function portfolioTokenCardMarkup({ mint, name, symbol, source, allocationPercent, removable = false }){
  const market = assets.find(item => item.address === mint);
  const cardData = tokenCardData({ mint, market, policy: verifiedLaunchPolicyForMint(mint) });
  const tokenName = market?.name || name || cardData.name;
  const tokenSymbol = market?.symbol || symbol || cardData.symbol;
  const stage = market ? exploreStageLabel(market) : 'Verified launch';
  const volume = market ? formatExploreUsd(market.volume24hSol, { partial: market.volumeCoverage === 'partial' }) : '—';
  const holders = portfolioHolderCount(market);
  const marketValue = market ? formatCoinUsd(market.migrated === true ? market.poolMarketCapSol : market.curveCapSol) : '—';
  const reserve = Number.isFinite(Number(allocationPercent)) ? `${Number(allocationPercent).toFixed(2).replace(/\.00$/, '')}%` : '—';
  const change = market?.change || '—';
  const changeValue = Number.parseFloat(change);
  const changeClass = Number.isFinite(changeValue) ? (changeValue >= 0 ? 'is-positive' : 'is-negative') : '';
  const icon = market?.icon || tokenSymbol.slice(0, 1);
  const freshness = tokenCardEvidenceLabel(cardData);
  const safeMint = escapeHtml(mint || '');
  const socialLinks = exploreSocialLinksMarkup(market || { address: mint, symbol: tokenSymbol });
  const facts = allocationPercent == null
    ? [[market?.migrated === true ? 'Market cap' : 'Curve cap', marketValue], ['24h volume', volume], ['Holders', holders], ['24h change', change, changeClass]]
    : [['Launch stage', stage], ['Community reserve', reserve], ['24h volume', volume], ['Holders', holders]];
  return `<article class="token-card-shell portfolio-token-card${removable ? ' watchlist-token-card' : ' project-token-card'}" data-mint="${safeMint}">
    <div class="portfolio-token-card-top">
      <span class="portfolio-token-avatar">${escapeHtml(icon)}</span>
      <span class="portfolio-token-identity"><strong>${escapeHtml(tokenSymbol)}</strong>${exploreBoostAmountMarkup(mint)}<small>${escapeHtml(tokenName)}</small></span>
      <span class="portfolio-token-stage">${escapeHtml(stage)}</span>
    </div>
    <p class="portfolio-token-source">${escapeHtml(source || 'Solana')}</p>
    ${tokenCardAddressesMarkup(mint)}
    ${socialLinks ? `<div class="portfolio-token-social">${socialLinks}</div>` : ''}
    <div class="portfolio-token-stats">${facts.map(([label, value, className = '']) => `<span class="${className}"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></span>`).join('')}</div>
    <div class="portfolio-token-footer"><span>${escapeHtml(freshness)}</span><div>${tokenCardWatchMarkup(mint, tokenSymbol)}${tokenCardShareMarkup(mint, tokenSymbol, tokenName)}<a href="/token/${encodeURIComponent(mint || '')}">View token ↗</a>${market ? `<button type="button" data-trade-mint="${safeMint}">Trade</button>` : ''}</div></div>
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
    for (const launch of launches) projectSelect.add(new Option(`${launch.name || 'Solana coin'} (${launch.symbol || 'TOKEN'})`, launch.mint));
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
        ? `No verified launches are associated with wallet ${shortAddress(connectedWalletAddress)}. Connect the wallet used to launch your coin to see its projects here.`
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
          name: launch.name || 'Solana coin',
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
function formatVerifiedAirdropAmount(value){ return value == null ? '—' : Number(value).toLocaleString(undefined, { maximumFractionDigits: 6 }); }
const demoAirdropPrograms = Object.freeze([]);
const indexedClaimers = Object.freeze([]); // No verified public claimant receipt feed is wired yet.
const demoUnclaimedWallets = Object.freeze([]);
const demoAirdropNotifications = Object.freeze([]);
const demoAirdropHistory = Object.freeze([]);
function getAirdropPrograms(){
  return verifiedLaunchPolicies.flatMap(launch => {
    const allocationPercent = Number(launch.communityAirdrop?.allocationPercent);
    const reservedTokens = Number(launch.communityAirdrop?.reservedTokens);
    if (!launch.mint || !Number.isFinite(allocationPercent) || !Number.isSafeInteger(reservedTokens) || reservedTokens <= 0) return [];
    const reserve = verifiedCommunityReserves.get(launch.mint);
    const claimState = airdropClaimState(reserve);
    const claimActive = claimState.claimActive;
    const claimedTokens = claimState.published && /^\d+$/.test(String(reserve.claimedBaseUnits)) && /^\d+$/.test(String(reserve.totalBaseUnits))
      && BigInt(reserve.totalBaseUnits) > 0n
      ? Number(BigInt(reserve.claimedBaseUnits) * BigInt(reservedTokens) * 1_000_000n / BigInt(reserve.totalBaseUnits)) / 1_000_000 : null;
    return [{
      id: launch.mint,
      name: launch.name || 'Solana launch',
      symbol: launch.symbol || 'TOKEN',
      allocationPercent,
      reservedTokens,
      creatorWallet: launch.creatorWallet,
      reserveStatus: reserve?.status || 'unverified',
      vaultInitialized: reserve?.vaultInitialized === true,
      vaultForFunding: reserve?.vault || null,
      claimedTokens,
      eligibleWallets: claimState.published ? reserve.leafCount : null,
      claimedWallets: null,
      vaultVerified: reserve?.verified === true && ['funded','drop-active','drop-closed'].includes(reserve.status) && Number(reserve.reservedTokens) === reservedTokens,
      vaultAddress: reserve?.verified === true ? claimState.published ? reserve.drop : reserve.vault : null,
      fundingSignature: reserve?.verified === true ? reserve.fundingSignature : null,
      claimPublished: claimState.published,
      claimActive,
      migrationSlot: claimState.published ? reserve.migrationSlot : null,
      status: claimState.status,
      statusLabel: claimState.label,
      merkleRoot: claimState.published ? reserve.merkleRoot : null,
      snapshotHash: claimState.published ? reserve.snapshotHash : null,
      deadline: claimState.published && reserve.expiresAt ? new Date(reserve.expiresAt * 1000).toLocaleString() : 'After verified migration snapshot',
      snapshot: claimState.published ? `Migration slot ${reserve.migrationSlot}` : 'Migration snapshot · unverified',
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
  const claimPrograms = programs.filter(item => item.claimPublished && item.claimedTokens != null && item.vaultVerified === true);
  const eligibilityPrograms = programs.filter(item => item.claimPublished && item.eligibleWallets != null);
  const claimed = claimPrograms.length ? claimPrograms.reduce((sum, item) => sum + item.claimedTokens, 0) : null;
  const eligible = eligibilityPrograms.length ? eligibilityPrograms.reduce((sum, item) => sum + item.eligibleWallets, 0) : null;
  const fundedCount = programs.filter(item => item.vaultVerified).length;
  const activeCount = programs.filter(item => item.claimActive).length;
  const fundingNote = communityReserveStatus === 'ready'
    ? `${fundedCount} of ${programs.length} airdrops funded · ${activeCount} open for claims`
    : communityReserveStatus === 'loading' ? 'Checking funding' : 'Funding status unavailable';
  node.innerHTML = `<article><span>Published airdrops</span><strong>${programs.length}</strong><small>${activeCount} open for claims</small></article><article><span>Planned tokens</span><strong>${formatTokenAmount(reserved)}</strong><small>${fundingNote}</small></article><article><span>Claimed so far</span><strong>${claimed == null ? '—' : `${claimPrograms.length < programs.length ? '≥' : ''}${formatVerifiedAirdropAmount(claimed)}`}</strong><small>${claimed == null ? 'Claim history unavailable' : `History available for ${claimPrograms.length} of ${programs.length} airdrops`}</small></article><article><span>Eligible wallets</span><strong>${eligible == null ? '—' : `${eligibilityPrograms.length < programs.length ? '≥' : ''}${formatVerifiedAirdropAmount(eligible)}`}</strong><small>${eligible == null ? 'Eligibility details unavailable' : `Eligibility available for ${eligibilityPrograms.length} of ${programs.length} airdrops`}</small></article>`;
}
let airdropDirectoryPage = 1;
let airdropDirectoryStatus = 'upcoming';
const AIRDROP_DIRECTORY_PAGE_SIZE = 10;
function renderAirdropDirectory(programs = getAirdropPrograms()){
  const list = document.querySelector('#airdrop-directory');
  if (!list) return;
  const query = document.querySelector('#airdrop-search')?.value.trim().toLowerCase() || '';
  list.dataset.indexStatus = verifiedLaunchPoliciesStatus;
  list.dataset.upcomingCount = String(programs.filter(item => item.status === 'upcoming').length);
  list.dataset.claimingCount = String(programs.filter(item => item.status === 'claiming').length);
  list.dataset.closedCount = String(programs.filter(item => item.status === 'closed').length);
  const filtered = programs.filter(item => item.status === airdropDirectoryStatus && (!query || `${item.name} ${item.symbol} ${item.id}`.toLowerCase().includes(query)));
  const totalPages = Math.max(1, Math.ceil(filtered.length / AIRDROP_DIRECTORY_PAGE_SIZE));
  airdropDirectoryPage = Math.min(airdropDirectoryPage, totalPages);
  const first = (airdropDirectoryPage - 1) * AIRDROP_DIRECTORY_PAGE_SIZE;
  list.innerHTML = filtered.slice(first, first + AIRDROP_DIRECTORY_PAGE_SIZE).map(program => {
    const safeMint = escapeHtml(program.id);
    const safeSymbol = escapeHtml(program.symbol);
    const snapshotReady = program.eligibleWallets != null;
    const cardData = tokenCardData({ mint: program.id, policy: verifiedLaunchPolicyForMint(program.id), reserve: { mint: program.id, verified: program.vaultVerified } });
    return `<article class="token-card-shell airdrop-directory-card" data-logo-mint="${safeMint}">
      <div class="directory-card-top"><span class="claim-token-mark" aria-hidden="true" title="Project artwork not published for this token">${escapeHtml(program.symbol.slice(0, 2).toUpperCase())}</span><div><span class="directory-token-identity"><strong>${safeSymbol}</strong>${exploreBoostAmountMarkup(program.id)}<a href="/token/${encodeURIComponent(program.id)}">${escapeHtml(program.name)}</a></span><span class="airdrop-status ${program.status}">${escapeHtml(program.statusLabel)}</span></div></div>
      <div class="directory-stats"><span><small>Planned airdrop</small><b>${formatPolicyTokenCount(program.reservedTokens)} $${safeSymbol}</b></span><span><small>Funding</small><b>${cardData.reserveState === 'verified' ? 'Confirmed' : communityReserveStatus === 'loading' ? 'Checking…' : communityReserveStatus === 'unavailable' ? 'Unavailable' : 'Not confirmed'}</b></span><span><small>Eligible wallets</small><b>${snapshotReady ? `${formatPolicyTokenCount(program.eligibleWallets)} wallets` : 'Pending'}</b></span></div>
      <div class="directory-footer"><span><small>Your amount</small><b>${program.walletAllocation == null ? program.claimActive ? 'Connect to check' : 'Check when claims open' : formatTokenAmount(program.walletAllocation)}</b></span><div class="token-card-actions">${tokenCardWatchMarkup(program.id, program.symbol)}${tokenCardShareMarkup(program.id, program.symbol, program.name)}<button type="button" class="secondary-button directory-claim" data-directory-mint="${safeMint}" aria-controls="airdrop-selected-program">View claim status</button></div></div>
      <details class="token-card-more"><summary>Addresses and verification</summary>${tokenCardAddressesMarkup(program.id)}${exploreSocialLinksMarkup({ address: program.id, symbol: program.symbol })}<small>${escapeHtml(tokenCardEvidenceLabel(cardData))}</small></details>
    </article>`;
  }).join('') || `<div class="empty-state">${verifiedLaunchPoliciesStatus === 'loading' ? 'Checking airdrops…' : verifiedLaunchPoliciesStatus === 'unavailable' ? 'Airdrops are temporarily unavailable.' : query ? 'No airdrops match your search.' : airdropDirectoryStatus === 'claiming' ? 'No claims are open yet.' : airdropDirectoryStatus === 'closed' ? 'No closed airdrops yet.' : 'No upcoming airdrops yet.'}</div>`;
  loadVerifiedTokenLogos(list, { probeMissing: true });
  const pagination = document.querySelector('#airdrop-directory-pagination');
  if (pagination) {
    pagination.hidden = filtered.length <= AIRDROP_DIRECTORY_PAGE_SIZE;
    pagination.querySelector('[data-airdrop-page="prev"]').disabled = airdropDirectoryPage <= 1;
    pagination.querySelector('[data-airdrop-page="next"]').disabled = airdropDirectoryPage >= totalPages;
    pagination.querySelector('#airdrop-directory-range').textContent = filtered.length ? `${first + 1}–${Math.min(first + AIRDROP_DIRECTORY_PAGE_SIZE, filtered.length)} of ${filtered.length} · page ${airdropDirectoryPage} / ${totalPages}` : '0 indexed';
  }
}
function renderAirdropProgramDetail(program){
  const panel = document.querySelector('#airdrop-selected-program');
  if (!panel) return;
  const unavailableButton = document.querySelector('#airdrop-claim-unavailable');
  if (unavailableButton) unavailableButton.hidden = program.claimActive;
  const eyebrow = document.querySelector('#airdrop-selected-eyebrow');
  if (eyebrow) eyebrow.textContent = program.vaultVerified ? 'Airdrop funding confirmed' : 'Airdrop funding pending';
  document.querySelector('#airdrop-selected-title').textContent = `${program.name} (${program.symbol})`;
  document.querySelector('#airdrop-selected-stats').innerHTML = `<span><small>Policy reserve</small><strong>${formatTokenAmount(program.reservedTokens)} tokens · ${program.allocationPercent}% of supply</strong></span><span><small>Claimed</small><strong>${formatVerifiedAirdropAmount(program.claimedTokens)}</strong></span><span><small>Snapshot</small><strong>${escapeHtml(program.snapshot)}</strong></span><span><small>Snapshot hash</small><strong class="airdrop-proof-value">${escapeHtml(program.snapshotHash || 'Pending verified snapshot')}</strong></span><span><small>Proof root</small><strong class="airdrop-proof-value">${escapeHtml(program.merkleRoot || 'Pending published proof')}</strong></span><span><small>Eligible wallets</small><strong>${formatVerifiedAirdropAmount(program.eligibleWallets)}</strong></span><span><small>Vesting</small><strong>${program.claimPublished ? 'One full claim during the 90-day window; no staged vesting' : 'No claim schedule active'}</strong></span>`;
  const status = document.querySelector('#airdrop-selected-status');
  status.textContent = program.claimActive
    ? `The claim vault is verified. $FUNDED holders at migration slot ${program.migrationSlot} can check their allocation until ${program.deadline}.`
    : program.status === 'closed'
    ? `The verified claim window ended ${program.deadline}. New claims are unavailable; the indexed claim total and published proof remain visible above.`
    : program.vaultVerified
    ? `The ${formatTokenAmount(program.reservedTokens)} token reserve is verified in vault ${program.vaultAddress}. A migration-time $FUNDED snapshot and published claim proof are still required; claims are closed.`
    : 'Policy allocation is indexed, but vault funding, a finalized eligibility snapshot, and a claim proof are not verified. No wallet claim or token transfer is available.';
  if (program.claimActive) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'secondary-button'; button.dataset.checkCommunityMint = program.id;
    button.textContent = connectedWalletAddress ? 'Check my allocation' : 'Connect wallet to check allocation';
    status.append(document.createElement('br'), button);
  }
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
  if (!program.claimActive && !program.vaultVerified && program.vaultInitialized && program.creatorWallet === connectedWalletAddress && canSignTransactions(wallet)) {
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
async function checkCommunityClaim(mintAddress){
  const status = document.querySelector('#airdrop-selected-status');
  if (!wallet) await connectWallet();
  const session = captureWalletSession();
  if (!session) { status.append(document.createTextNode(' Connect a Solana wallet to check this allocation.')); return; }
  const program = getAirdropPrograms().find(row => row.id === mintAddress);
  if (!program?.claimActive) { status.append(document.createTextNode(' Claims are not open for this token.')); return; }
  const response = await apiRequest(`/api/airdrops/claims/proof?mint=${encodeURIComponent(mintAddress)}&wallet=${encodeURIComponent(session.address)}`);
  const proof = response.data;
  if (!response.available || !proof?.status) { status.append(document.createTextNode(` Claim proof unavailable: ${proof?.error || 'retry later'}.`)); return; }
  if (proof.status === 'claimed') { status.append(document.createTextNode(' This wallet has already claimed its verified allocation.')); return; }
  if (proof.status !== 'claimable') { status.append(document.createTextNode(` ${proof.reason || 'This wallet has no available allocation.'}`)); return; }
  const { PublicKey } = await getSolana();
  const mintInfo = await (await getTradePreviewConnection()).getAccountInfo(new PublicKey(mintAddress), 'finalized');
  if (!mintInfo || mintInfo.data.length < 45) throw new Error('Claim mint is unavailable.');
  const decimals = mintInfo.data[44];
  communityClaimReview = { mint:mintAddress, wallet:session.address, amount:proof.amount, index:proof.index, at:Date.now() };
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'primary-button'; button.dataset.claimCommunityMint = mintAddress;
  button.textContent = `Review claim ${formatTokenBaseUnits(proof.amount, decimals, 4)} ${program.symbol}`;
  status.append(document.createTextNode(' A wallet transaction is required. Your wallet pays network fees and token-account rent if needed.'),
    document.createElement('br'), button);
}
async function submitCommunityClaim(mintAddress){
  const session = captureWalletSession();
  const status = document.querySelector('#airdrop-selected-status');
  const review = communityClaimReview;
  let submittedSignature = null, claimExecutionRequested = false, claimVerified = false;
  if (!session || !canSignTransactions(session.provider) || !review || review.mint !== mintAddress
    || review.wallet !== session.address || Date.now() - review.at > 60_000) {
    status.append(document.createTextNode(' Check the allocation again before signing.'));
    return;
  }
  communityClaimReview = null;
  const button = status.querySelector('[data-claim-community-mint]');
  if (button) button.disabled = true;
  emitPilotSignal('claim-started');
  try {
    const response = await apiRequest('/api/airdrops/claims/claim-instruction', { method:'POST',
      body:{ mint:mintAddress, wallet:session.address } });
    const claim = response.data;
    if (!response.available || !claim?.accounts || String(claim.amount) !== String(review.amount))
      throw new Error(claim?.error || 'A fresh verified claim instruction is unavailable.');
    const { PublicKey, Transaction, TransactionInstruction, getAssociatedTokenAddressSync,
      createAssociatedTokenAccountIdempotentInstruction, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } = await getSolana();
    const rpc = await getTradePreviewConnection();
    const program = new PublicKey(FEE_ROUTER_PROGRAM_ID), mint = new PublicKey(mintAddress);
    const recipient = new PublicKey(session.address);
    const { accounts } = claim;
    if (claim.programId !== program.toBase58() || accounts.length !== 9
      || accounts.filter(row => row.isSigner).length !== 1 || accounts[0].pubkey !== session.address || !accounts[0].isSigner
      || accounts[2].pubkey !== session.address || accounts[3].pubkey !== mintAddress)
      throw new Error('Claim instruction does not match this wallet and token.');
    const mintInfo = await rpc.getAccountInfo(mint, 'finalized');
    if (!mintInfo || ![TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()].includes(mintInfo.owner.toBase58())
      || accounts[7].pubkey !== mintInfo.owner.toBase58()) throw new Error('Claim token program differs from the verified mint.');
    const expectedDrop = verifiedCommunityReserves.get(mintAddress)?.drop;
    const dropInfo = expectedDrop && await rpc.getAccountInfo(new PublicKey(expectedDrop), 'finalized');
    if (!dropInfo?.owner.equals(program) || dropInfo.data.length < 350) throw new Error('Verified claim drop is unavailable.');
    const [drop] = PublicKey.findProgramAddressSync([Buffer.from('community-drop-v1'),
      dropInfo.data.subarray(8, 40), mint.toBuffer()], program);
    if (drop.toBase58() !== expectedDrop || accounts[1].pubkey !== expectedDrop) throw new Error('Claim drop differs from the verified reserve.');
    const vaultToken = getAssociatedTokenAddressSync(mint, drop, true, mintInfo.owner);
    const recipientToken = getAssociatedTokenAddressSync(mint, recipient, false, mintInfo.owner);
    const [payment] = PublicKey.findProgramAddressSync([Buffer.from('community-pay-v1'), drop.toBuffer(), recipient.toBuffer()], program);
    if (accounts[4].pubkey !== vaultToken.toBase58() || accounts[5].pubkey !== recipientToken.toBase58()
      || accounts[6].pubkey !== payment.toBase58() || claim.recipientToken !== recipientToken.toBase58())
      throw new Error('Claim accounts differ from the verified recipient and vault.');
    const data = Buffer.from(claim.data, 'base64');
    const discriminator = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('global:claim_community_drop'))).subarray(0, 8);
    if (!data.subarray(0, 8).equals(discriminator) || data.readBigUInt64LE(8) !== BigInt(review.amount)
      || data.readUInt32LE(16) !== review.index || data.length !== 24 + data.readUInt32LE(20) * 32)
      throw new Error('Claim data differs from the reviewed allocation.');
    const before = await rpc.getTokenAccountBalance(recipientToken, 'finalized').then(row => BigInt(row.value.amount)).catch(() => 0n);
    assertWalletSessionCurrent(session);
    const latest = await rpc.getLatestBlockhash('confirmed');
    const transaction = new Transaction({ feePayer:recipient, recentBlockhash:latest.blockhash });
    if (!await rpc.getAccountInfo(recipientToken, 'finalized')) transaction.add(
      createAssociatedTokenAccountIdempotentInstruction(recipient, recipientToken, recipient, mint, mintInfo.owner));
    transaction.add(new TransactionInstruction({ programId:program, keys:accounts.map(row => ({
      pubkey:new PublicKey(row.pubkey), isSigner:row.isSigner, isWritable:row.isWritable })), data }));
    const signed = await session.provider.signTransaction(transaction);
    assertWalletSessionCurrent(session);
    claimExecutionRequested = true;
    submittedSignature = await rpc.sendRawTransaction(signed.serialize(), { skipPreflight:false, maxRetries:3 });
    const confirmation = await waitForSignatureConfirmation(rpc, { signature:submittedSignature,
      lastValidBlockHeight:latest.lastValidBlockHeight, commitment:'finalized' });
    if (confirmation.value.err) throw new Error(`Claim transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    const after = BigInt((await rpc.getTokenAccountBalance(recipientToken, 'finalized')).value.amount);
    if (after - before !== BigInt(review.amount) || !(await rpc.getAccountInfo(payment, 'finalized'))?.owner.equals(program))
      throw new Error('Claim finalized without the exact token and payment-record deltas.');
    claimVerified = true;
    emitPilotSignal('claim-verified');
    await loadCommunityReserveStatuses();
    renderAirdropProgramDetail(getAirdropPrograms().find(row => row.id === mintAddress));
    showToast('Community tokens claimed and verified on Solana');
  } catch (error) {
    if (!claimVerified) emitPilotSignal(pilotInterruptedSignal('claim', error, claimExecutionRequested));
    status.append(document.createTextNode(submittedSignature
      ? ` Claim ${submittedSignature} was submitted. Check its finalized Solana receipt before retrying: ${String(error.message || error)}`
      : ` Claim stopped: ${String(error.message || error)}`));
  } finally { if (button) button.disabled = false; }
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
    if (!launch || launch.creatorWallet !== session.address || APP_CLUSTER !== 'devnet' || APP_MAINNET_READ_ONLY) throw new Error('Only the verified Solana launch creator can fund this reserve.');
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
    showToast('Community reserve funded and verified on Solana');
  } catch (error) {
    communityFundingPreview = null;
    status.append(document.createTextNode(submittedSignature
      ? ` Funding status is uncertain for ${submittedSignature}. Check the Solana transaction before retrying: ${String(error.message || error)}`
      : ` Funding stopped: ${String(error.message || error)}`));
  } finally { button.disabled = false; }
}
function renderAirdropAnalytics(){
  const claimers = document.querySelector('#airdrop-top-claimers');
  const programs = document.querySelector('#airdrop-top-programs');
  const wallets = document.querySelector('#unclaimed-wallets');
  const leaderboardSort = document.querySelector('#leaderboard-sort')?.value || 'amount';
  const privateMode = document.querySelector('#leaderboard-private')?.checked ?? true;
  const sortControl = document.querySelector('#leaderboard-sort');
  const privacyControl = document.querySelector('#leaderboard-private');
  if (sortControl) sortControl.disabled = indexedClaimers.length === 0;
  if (privacyControl) privacyControl.disabled = indexedClaimers.length === 0;
  const sortedClaimers = sortClaimers(indexedClaimers, leaderboardSort);
  if (claimers) claimers.innerHTML = sortedClaimers.map((item, index) => `<div class="leader-row"><b>${index + 1}</b><span><strong>${escapeHtml(claimantWalletLabel(item.wallet, privateMode))}</strong><small>${escapeHtml(item.symbol)} claimed${claimerRate(item) == null ? '' : ` · ${(claimerRate(item) * 100).toFixed(1)}% of allocation`}</small></span><em>${formatTokenAmount(item.amount)}</em></div>`).join('') || '<div class="empty-state">Verified claimant receipts are not indexed yet. Ranking and privacy controls will appear when verified rows are available.</div>';
  if (programs) programs.innerHTML = getAirdropPrograms().sort((a, b) => b.reservedTokens - a.reservedTokens).slice(0, 5).map((item, index) => {
    const rate = airdropClaimRate(item);
    const claimLabel = rate == null ? 'Snapshot pending' : rate > 0 && rate * 100 < 0.05 ? '<0.1% claimed' : `${(rate * 100).toFixed(1)}% claimed`;
    return `<div class="leader-row" data-logo-mint="${escapeHtml(item.id)}"><b>${index + 1}</b><i class="leader-token-logo" aria-hidden="true">${escapeHtml(String(item.symbol || "T").slice(0, 1))}</i><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.symbol)} · ${escapeHtml(claimLabel)}</small></span><em>${formatTokenAmount(item.reservedTokens)}</em></div>`;
  }).join('');
  loadVerifiedTokenLogos(programs);
  const verifiedWallets = getVerifiedUnclaimedWallets();
  if (wallets) wallets.innerHTML = verifiedWallets.map(item => `<tr><td><strong>${item.wallet}</strong></td><td>${item.program}</td><td>${formatTokenAmount(item.eligible)}</td><td>${formatTokenAmount(item.claimed)}</td><td>${formatTokenAmount(item.eligible - item.claimed)}</td><td><span class="wallet-claim-status">${item.status}</span></td></tr>`).join('');
  const count = document.querySelector('#unclaimed-wallet-count');
  if (count) count.textContent = verifiedWallets.length ? `${verifiedWallets.length} verified wallets`
    : getAirdropPrograms().some(item => item.claimActive) ? 'Unclaimed wallet list unavailable' : 'Eligibility snapshot pending';
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
  const previewClaimed = Boolean(getPreviewClaims()[previewAirdrop.id]);
  const programs = getAirdropPrograms();
  const claims = [
    ...programs.map(program => ({ ...program, state: program.id === previewAirdrop.id && previewClaimed ? 'claimed' : program.claimActive ? 'claimable' : program.status, badge: program.id === previewAirdrop.id ? 'Demo allocation' : 'Policy allocation' })),
  ];
  const filtered = claims.filter(claim => filter === 'all' || claim.state === filter);
  if (list) list.innerHTML = filtered.map(claim => {
    const isPreview = claim.id === previewAirdrop.id;
    const action = claim.state === 'claimable' ? `<button type="button" class="secondary-button claim-action" data-check-community-mint="${escapeHtml(claim.id)}">Check eligibility</button>` : `<button type="button" class="secondary-button claim-action" disabled>${claim.state === 'claimed' ? 'Claim recorded' : claim.vaultVerified ? 'Opens after snapshot' : 'Requires funded vault'}</button>`;
    const amount = claim.walletAllocation == null ? `${formatTokenAmount(claim.reservedTokens)} ${claim.vaultVerified ? 'tokens vaulted' : 'tokens planned'}` : `${formatTokenAmount(claim.walletAllocation)} ${escapeHtml(claim.symbol)}`;
    const detail = isPreview
      ? 'Local interaction preview. No wallet signature or token transfer occurs.'
      : `${claim.allocationPercent}% supply policy allocation · $FUNDED-holder snapshot at migration`;
    return `<article class="token-card-shell claim-card" data-claim-state="${claim.state}" data-logo-mint="${escapeHtml(claim.id)}"><div class="claim-token"><span>${escapeHtml(claim.symbol.slice(0, 1))}</span><div><strong>${escapeHtml(claim.name)}</strong><small>${escapeHtml(claim.symbol)} · ${escapeHtml(claim.badge)}</small></div></div><div class="claim-amount"><span>${claim.state === 'claimed' ? 'Preview result' : claim.walletAllocation == null ? claim.vaultVerified ? 'Verified vault reserve' : 'Policy allocation' : 'Example allocation'}</span><strong>${amount}</strong></div><p>${detail}</p><div class="token-card-actions claim-token-actions">${!isPreview ? `${tokenCardWatchMarkup(claim.id, claim.symbol)}${tokenCardShareMarkup(claim.id, claim.symbol, claim.name)}` : ''}${action}</div></article>`;
  }).join('') || `<div class="empty-state">${verifiedLaunchPoliciesStatus === 'loading' ? 'Checking published allocations…' : verifiedLaunchPoliciesStatus === 'unavailable' ? 'Launch registry unavailable; claim availability cannot be verified.' : 'No claims match this filter.'}</div>`;
  if (list) loadVerifiedTokenLogos(list);
  document.querySelectorAll('[data-airdrop-filter]').forEach(button => button.classList.toggle('active', button.dataset.airdropFilter === filter));
  const state = document.querySelector('#claim-wallet-state');
  if (state) state.textContent = connectedWalletAddress ? `Wallet ${connectedWalletAddress.slice(0, 4)}…${connectedWalletAddress.slice(-4)} connected. Check an open claim for your verified allocation.` : 'Connect your wallet to check open Solana claims.';
  const count = document.querySelector('#claim-program-count');
  if (count) count.textContent = verifiedLaunchPoliciesStatus === 'ready'
    ? `${programs.length} ${programs.length === 1 ? 'airdrop' : 'airdrops'}`
    : verifiedLaunchPoliciesStatus === 'loading' ? 'Checking airdrops…' : 'Airdrops unavailable';
  renderAirdropSummary(programs);
  renderAirdropDirectory(programs);
  renderAirdropAnalytics();
}

function getBuybackPreviewState(){
  return { accruals: [], receipts: [] };
}
let buybackNetworkState = { status:'loading', receipts:[], pending:[] };
async function loadBuybackNetworkState(signal){
  try {
    const response = await apiRequest('/api/buyback/status', { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000) });
    signal?.throwIfAborted();
    if (!response.available || !response.data || response.data.cluster !== 'devnet') throw new Error('Devnet buyback index unavailable.');
    buybackNetworkState = { status:'ready', receipts:Array.isArray(response.data.receipts) ? response.data.receipts : [], pending:Array.isArray(response.data.pending) ? response.data.pending : [] };
  } catch { signal?.throwIfAborted(); buybackNetworkState = { status:'unavailable', receipts:[], pending:[] }; }
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
  return launch ? `${launch.name || 'Solana coin'} (${launch.symbol || 'TOKEN'})` : `${receipt.projectMint.slice(0, 4)}…${receipt.projectMint.slice(-4)}`;
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
  renderLaunchBurnSelection();
}
async function loadFundedBurnState({ force = false } = {}){
  const address = connectedWalletAddress;
  if (!force && fundedBurnState.status === 'loading') return;
  if (!force && fundedBurnState.status === 'ready' && fundedBurnState.wallet === address && Date.now() - (fundedBurnState.loadedAt || 0) < 30_000) return;
  const request = ++fundedBurnRequest;
  fundedBurnState = { ...fundedBurnState, status: 'loading', wallet: address, message: 'Checking your $FUNDED balance and burn history…' };
  renderBuybackDashboard();
  renderWalletFundedBalance();
  try {
    if (!PROTOCOL_FUNDED_MINT) throw new Error('The protocol $FUNDED mint is not configured.');
    const { PublicKey, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getMint, unpackAccount } = await getSolana();
    const mint = new PublicKey(PROTOCOL_FUNDED_MINT);
    const mintAccount = await connection.getAccountInfo(mint, 'confirmed');
    if (!mintAccount || (!mintAccount.owner.equals(TOKEN_PROGRAM_ID) && !mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID))) throw new Error('The configured $FUNDED mint is not a supported SPL mint on Solana.');
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
        ? (indexed.available ? 'Your balance and burn history are ready.' : 'Your balance is ready; burn history is unavailable.')
        : 'Live Solana supply loaded. Connect a wallet to view its balance and burn receipts.',
    };
  } catch (error) {
    if (request !== fundedBurnRequest) return;
    const detail = String(error?.message || '');
    const unavailable = /(?:5\d\d (?:Internal Server Error|Bad Gateway)|returned an invalid response|failed to fetch|networkerror|econnrefused|\b429\b|rate limit|too many requests)/i.test(detail);
    fundedBurnState = { ...fundedBurnState, status: 'error', wallet: address, message: unavailable
      ? 'Solana RPC unavailable; $FUNDED mint and balance could not be verified.'
      : detail || 'Solana burn data is unavailable.' };
  }
  renderBuybackDashboard();
  renderWalletFundedBalance();
  renderFundedTokenLanding();
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
  button.textContent = fundedBuyBusy ? 'Waiting for Solana…' : fundedBuyPreview ? 'Confirm buy' : wallet ? 'Preview buy' : 'Connect wallet to preview';
  badge.textContent = ready ? 'Solana pool live' : fundedBuyRoute.status === 'checking' ? 'Checking' : 'Unavailable';
  badge.classList.toggle('unavailable', !ready);
  if (message != null) status.textContent = message;
  else if (!ready) status.textContent = fundedBuyRoute.reason;
}
async function refreshFundedBuyRoute(signal){
  try {
    if (APP_CLUSTER !== 'devnet' || APP_MAINNET_READ_ONLY || !PROTOCOL_FUNDED_MINT || !PROTOCOL_FUNDED_SWAP_POOL) throw new Error('A Solana $FUNDED mint and pool are required.');
    const snapshot = await withRpcRetry(async attempt => {
      if (attempt > 0) tradePreviewConnection = null;
      const rpc = await getTradePreviewConnection();
      return fetchVerifiedPoolSnapshot({ connection:rpc, mint:PROTOCOL_FUNDED_MINT, poolAddress:PROTOCOL_FUNDED_SWAP_POOL });
    });
    signal?.throwIfAborted();
    if (fundedBuyBusy) return;
    fundedBuyPreview = null;
    fundedBuyRoute = { status:'ready', snapshot, reason:null };
    renderFundedBuyControl(`Verified Solana pool ${snapshot.pool.slice(0, 6)}…${snapshot.pool.slice(-4)} · ${snapshot.quoteReservesSol.toFixed(3)} SOL liquidity.`);
    renderFundedTokenLanding();
  } catch (error) {
    signal?.throwIfAborted();
    if (fundedBuyBusy) return;
    fundedBuyPreview = null;
    const detail = String(error?.message || error);
    const reason = /(?:\b429\b|rate limit|too many requests)/i.test(detail)
      ? 'Buy preview is temporarily unavailable because Solana RPC is rate limited. Try again shortly.'
      : /(?:failed to fetch|networkerror|econnrefused|timed out)/i.test(detail)
        ? 'Buy preview is unavailable while the Solana RPC connection recovers.'
        : `Buy preview is unavailable: ${detail.slice(0, 220)}`;
    fundedBuyRoute = { status:'unavailable', snapshot:null, reason };
    renderFundedBuyControl();
    renderFundedTokenLanding();
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
  if (!session || !canSignTransactions(session.provider)) return renderFundedBuyControl('Open the app in a wallet that can sign Solana transactions.');
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
    showToast('Verified $FUNDED buy finalized on Solana');
    void loadFundedBurnState({ force:true });
  } catch (error) {
    fundedBuyPreview = null;
    renderFundedBuyControl(error.signature || submittedSignature
      ? `Confirmation is uncertain for ${error.signature || submittedSignature}. Check that signature on Solana before trying again.`
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
  const walletBalanceReady = Boolean(connectedWalletAddress && fundedBurnState.wallet === connectedWalletAddress && fundedBurnState.status === 'ready');
  const launchBurns = verifiedLaunchPolicies.filter(launch => launch?.creatorLaunchBurn?.status === 'verified'
    && launch.creatorLaunchBurn.receipt && Number(launch.creatorLaunchBurn.receipt.amountTokens ?? launch.creatorLaunchBurn.amountTokens) > 0);
  const walletLaunchBurns = launchBurns.filter(launch => launch.creatorWallet === connectedWalletAddress);
  const standaloneReceipts = fundedBurnState.wallet === connectedWalletAddress ? fundedBurnState.receipts : [];
  const receiptSignatures = new Set([...walletLaunchBurns.map(launch => launch.creatorLaunchBurn.receipt.signature), ...standaloneReceipts.map(receipt => receipt.signature)].filter(Boolean));
  document.querySelector('#buyback-pending').textContent = walletBalanceReady ? formatTokenBaseUnits(fundedBurnState.balanceBaseUnits, fundedBurnState.decimals, 6) : '—';
  document.querySelector('#buyback-burned').textContent = fundedBurnState.status === 'ready' ? formatTokenBaseUnits(fundedBurnState.burnedBaseUnits, fundedBurnState.decimals, 6) : '—';
  document.querySelector('#buyback-claims').textContent = connectedWalletAddress && fundedBurnState.status === 'ready' ? String(receiptSignatures.size) : '—';
  const feeReceipts = buybackNetworkState.receipts;
  const totalReceiptCount = feeReceipts.length + launchBurns.length + standaloneReceipts.filter(receipt => !launchBurns.some(launch => launch.creatorLaunchBurn.receipt.signature === receipt.signature)).length;
  document.querySelector('#buyback-execution-count').textContent = totalReceiptCount
    ? `${totalReceiptCount} verified receipt${totalReceiptCount === 1 ? '' : 's'}`
    : buybackNetworkState.status === 'unavailable' && verifiedLaunchPoliciesStatus !== 'ready' && !fundedBurnState.receiptIndexAvailable
      ? 'Receipt index unavailable'
      : '0 verified receipts';
  const burnedNote = document.querySelector('#buyback-burned')?.parentElement?.querySelector('em');
  const claimsNote = document.querySelector('#buyback-claims')?.parentElement?.querySelector('em');
  const balanceNote = document.querySelector('#buyback-pending')?.parentElement?.querySelector('em');
  if (balanceNote) balanceNote.textContent = walletBalanceReady ? 'Current wallet balance' : connectedWalletAddress && fundedBurnState.status === 'loading' ? 'Loading from Solana' : connectedWalletAddress ? 'Balance unavailable' : 'Connect wallet to check balance';
  if (burnedNote) burnedNote.textContent = fundedBurnState.status === 'ready' ? 'Confirmed supply reduction' : 'Supply unavailable';
  if (claimsNote) claimsNote.textContent = fundedBurnState.receiptIndexAvailable ? 'Confirmed burn transactions' : 'Burn history unavailable';
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
    return `<div class="buyback-ledger-row burn"><span class="buyback-ledger-icon">♨</span><span><strong>${formatBuybackAmount(receipt.amountTokens ?? burn.amountTokens, 2)} $FUNDED burned</strong><small>${escapeHtml(launch.symbol || 'TOKEN')} launch promotion · ${escapeHtml(burn.label || burn.tier || 'verified tier')}</small><a href="${escapeHtml(exploreExplorer(`tx/${encodeURIComponent(signature)}`))}" target="_blank" rel="noopener noreferrer">Confirmed transaction ↗</a></span><b>Supply ↓</b></div>`;
  }).join('');
  const standaloneRows = standaloneReceipts.filter(receipt => !launchBurns.some(launch => launch.creatorLaunchBurn.receipt.signature === receipt.signature)).map(receipt => `<div class="buyback-ledger-row burn"><span class="buyback-ledger-icon">♨</span><span><strong>${formatBuybackAmount(receipt.amountTokens, 6)} $FUNDED burned</strong><small>${escapeHtml(fundedReceiptProject(receipt))} · confirmed</small><a href="${escapeHtml(exploreExplorer(`tx/${encodeURIComponent(receipt.signature)}`))}" target="_blank" rel="noopener noreferrer">Confirmed transaction ↗</a></span><b>Supply ↓</b></div>`).join('');
  const feeRows = feeReceipts.map(receipt => {
    const baseUnits = BigInt(receipt.boughtAndBurnedBaseUnits || '0');
    const amount = formatTokenBaseUnits(baseUnits, Number(receipt.tokenDecimals ?? 6), 6);
    const spentSol = (BigInt(receipt.settledLamports || '0') - BigInt(receipt.returnedLamports || '0'));
    return `<div class="buyback-ledger-row burn"><span class="buyback-ledger-icon">♨</span><span><strong>${escapeHtml(amount)} $FUNDED bought and burned</strong><small>${escapeHtml(formatTokenBaseUnits(spentSol, 9, 9))} SOL from collected creator fees · unused SOL returned</small><a href="${escapeHtml(exploreExplorer(`tx/${encodeURIComponent(receipt.signature)}`))}" target="_blank" rel="noopener noreferrer">Confirmed buy and burn ↗</a></span><b>Supply ↓</b></div>`;
  }).join('');
  document.querySelector('#buyback-ledger').innerHTML = `${feeRows}${standaloneRows}${launchRows}${previewRows}` || (buybackNetworkState.status === 'unavailable' ? '<div class="empty-state">Burn history is temporarily unavailable. Try again shortly.</div>' : '<div class="empty-state">No confirmed $FUNDED burns yet. Fee-funded buybacks and launch promotions appear here separately.</div>');
  const runButton = document.querySelector('#buyback-run-preview');
  const addButton = document.querySelector('#buyback-add-claim');
  if (addButton) { addButton.disabled = true; addButton.title = 'Recording requires verified fee-claim receipts and a deployed buyback vault.'; }
  if (runButton) { runButton.disabled = true; runButton.title = 'Buybacks execute automatically from verified fee accruals. Manual execution is unavailable.'; }
  renderBuybackExample();
  const burnCard = document.querySelector('.burn-token-card');
  const burnBadge = burnCard?.querySelector('.burn-status');
  const burnStatus = document.querySelector('#funded-burn-status');
  const signingReady = fundedBurnState.status === 'ready' && Boolean(wallet && canSignTransactions(wallet)) && fundedBurnState.balanceBaseUnits > 0n;
  if (burnBadge) { burnBadge.textContent = fundedBurnState.status === 'loading' ? 'Loading' : signingReady ? 'Ready' : fundedBurnState.status === 'ready' ? 'View only' : 'Unavailable'; burnBadge.className = `burn-status ${signingReady ? 'available' : fundedBurnState.status === 'loading' ? 'loading' : 'unavailable'}`; }
  if (burnStatus) burnStatus.textContent = fundedBurnState.message;
  const tierCard = document.querySelector('.burn-tier-card');
  if (tierCard) {
    const paidTiers = LAUNCH_BURN_TIERS.filter(tier => SELECTABLE_LAUNCH_TIERS.has(tier.id) && tier.amountTokens > 0);
    const maximum = paidTiers.at(-1)?.amountTokens || 1;
    paidTiers.forEach(tier => {
      const row = tierCard.querySelector(`[data-burn-tier="${tier.id}"]`);
      if (!row) return;
      row.querySelector('b').textContent = `${tier.amountTokens.toLocaleString('en-US')} $FUNDED`;
      row.querySelector('em').style.width = `${Math.max(8, tier.amountTokens / maximum * 100)}%`;
    });
  }
  updateFundedBurnButton();
  const status = document.querySelector('#buyback-preview-status');
  if (message) status.textContent = message;
  else if (pendingSol >= 0.25) status.textContent = `${formatBuybackAmount(pendingSol)} SOL is ready for a protected batch preview.`;
  else if (pendingSol > 0) status.textContent = `${formatBuybackAmount(pendingSol)} SOL is safely accumulating toward the 0.25 SOL threshold.`;
  else status.textContent = feeReceipts.length > 0
    ? `${feeReceipts.length} verified fee-funded Solana buyback${feeReceipts.length === 1 ? '' : 's'} completed. New batches run automatically from collected fees; this example cannot create a claim.`
    : 'Local calculation only. Live Solana buybacks run automatically from verified fee collections; this example cannot create a claim.';
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
  let burnPlan;
  try { burnPlan = planTokenAccountBurns(fundedBurnState.tokenAccounts, amount); }
  catch (error) { fundedBurnState.message = error.message; renderBuybackDashboard(); return; }
  const button = document.querySelector('#funded-burn-submit');
  const previousSupply = fundedBurnState.supplyBaseUnits;
  fundedBurnState.status = 'submitting';
  fundedBurnState.message = 'Review and approve the permanent burn in your wallet.';
  button.textContent = 'Awaiting approval…';
  renderBuybackDashboard();
  try {
    const { PublicKey, Transaction, TransactionInstruction, createBurnCheckedInstruction, getAccount, getMint } = await getSolana();
    assertWalletSessionCurrent(session);
    const mint = new PublicKey(PROTOCOL_FUNDED_MINT);
    const latest = await connection.getLatestBlockhash('confirmed');
    const transaction = new Transaction({ feePayer: session.provider.publicKey, recentBlockhash: latest.blockhash });
    for (const burn of burnPlan) transaction.add(
      createBurnCheckedInstruction(burn.address, mint, session.provider.publicKey, burn.amount, fundedBurnState.decimals, [], fundedBurnState.tokenProgram),
    );
    if (projectMint) transaction.add(new TransactionInstruction({
      programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'), keys: [], data: Buffer.from(projectBurnMemo(projectMint), 'utf8'),
    }));
    const signed = await session.provider.signTransaction(transaction);
    assertWalletSessionCurrent(session);
    const signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 3 });
    fundedBurnState.message = `Burn submitted (${signature.slice(0, 8)}…). Waiting for Solana confirmation.`;
    renderBuybackDashboard();
    const confirmation = await waitForSignatureConfirmation(connection, { signature, lastValidBlockHeight: latest.lastValidBlockHeight });
    if (confirmation.value.err) throw new Error(`Burn transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    const [accountResults, mintAfter] = await Promise.all([
      Promise.all(burnPlan.map(async burn => ({ burn, account: await getAccount(connection, burn.address, 'confirmed', fundedBurnState.tokenProgram) }))),
      getMint(connection, mint, 'confirmed', fundedBurnState.tokenProgram),
    ]);
    const accountDelta = accountResults.reduce((total, { burn, account }) => {
      const before = fundedBurnState.tokenAccounts.find(item => item.address.equals(burn.address))?.amount;
      return before == null ? total : total + (before - account.amount);
    }, 0n);
    if (accountDelta !== amount || previousSupply - mintAfter.supply !== amount) throw new Error(`Burn confirmed as ${signature}, but the expected balance and supply deltas were not observed.`);
    const indexed = await apiRequest('/api/burn-receipts', { method: 'POST', body: { signature, wallet: session.address, amountBaseUnits: amount.toString(), projectMint } });
    fundedBurnState.message = indexed.available ? `Burn confirmed: ${signature}` : `Burn confirmed on Solana. Burn history is temporarily unavailable: ${signature}`;
    input.value = '';
    showToast('Burn confirmed on Solana');
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
  showToast('Buyback preview completed');
}

let assets = [];
window.fundedVerifiedSearchCandidates = (query = '') => {
  const term = String(query).trim().toLowerCase();
  const capUsd = item => {
    const raw = EXPLORE_CLUSTER === 'devnet'
      ? Number(item.migrated === true ? item.poolMarketCapSol : item.curveCapSol) * coinSolUsdPrice
      : Number(item.marketCapUsd);
    return Number.isFinite(raw) && raw >= 0 ? raw : -1;
  };
  return assets.filter(item => item.address && (!term || [item.name, item.symbol, item.address].some(value => String(value || '').toLowerCase().includes(term))))
    .sort((a, b) => {
      const rank = item => !term ? 0 : String(item.symbol || '').toLowerCase() === term ? 3 : String(item.symbol || '').toLowerCase().startsWith(term) ? 2 : String(item.name || '').toLowerCase().startsWith(term) ? 1 : 0;
      return rank(b) - rank(a) || capUsd(b) - capUsd(a) || String(a.name || '').localeCompare(String(b.name || ''));
    })
    .slice(0, term ? 8 : 5)
    .map(item => ({ name: item.name || item.symbol || 'Token', symbol: item.symbol || 'TOKEN', mint: item.address, stage: exploreStageLabel(item), marketCap: exploreMarketCapUsd(item) }));
};
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
const EXPLORE_VIEW_KEY = 'funded.explore-view';
let exploreView = (() => { try { return localStorage.getItem(EXPLORE_VIEW_KEY) === 'table' ? 'table' : 'grid'; } catch { return 'grid'; } })();
let exploreMaxAgeHours = null;
let exploreMinVolumeUsd = null;
let exploreMinMarketCapUsd = null;
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

function readWatchlist(){
  const raw = localStorage.getItem(WATCHLIST_KEY);
  const saved = raw === null ? [] : JSON.parse(raw);
  if (!Array.isArray(saved) || saved.some(mint => typeof mint !== 'string' || mint !== mint.trim() || !validateSolanaMint(mint).valid)) throw new Error('Invalid saved watchlist');
  return saved;
}
function showWatchlistStatus(message){
  watchlistNotice = message;
  for (const host of [document.querySelector('#watchlist-items')?.parentElement, document.querySelector('#coin-watch')?.closest('.coin-identity')]) {
    if (!host) continue;
    let status = host.querySelector('[data-watchlist-status]');
    if (!status) { status = document.createElement('p'); status.className = 'field-help'; status.dataset.watchlistStatus = ''; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); host.append(status); }
    if (status.textContent !== message) status.textContent = message;
    status.hidden = !message;
  }
}
function getWatchlist(){
  try {
    lastKnownWatchlist = readWatchlist(); watchlistUnavailable = false;
    if (watchlistReadWarning) { watchlistReadWarning = false; showWatchlistStatus('Saved watchlist is available again.'); }
  }
  catch {
    watchlistUnavailable = true;
    if (!watchlistWriteUnconfirmed) {
      watchlistReadWarning = true;
      showWatchlistStatus('Saved watchlist could not be read. Showing the last known selection, if available. Allow browser storage and try again.');
    }
  }
  return [...lastKnownWatchlist];
}
function saveWatchlist(mint, { remove = false } = {}){
  let wrote = false, read = false;
  try {
    if (typeof mint !== 'string' || mint !== mint.trim() || !validateSolanaMint(mint).valid) throw new Error('Invalid watchlist mint');
    const prior = readWatchlist();
    read = true;
    lastKnownWatchlist = prior;
    const saved = remove ? prior.filter(item => item !== mint) : prior.includes(mint) ? prior : [...prior, mint];
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(saved));
    wrote = true;
    const confirmed = readWatchlist();
    if (JSON.stringify(confirmed) !== JSON.stringify(saved)) throw new Error('Watchlist write was not confirmed');
    lastKnownWatchlist = confirmed; watchlistUnavailable = false; watchlistReadWarning = false; watchlistWriteUnconfirmed = false;
    showWatchlistStatus(saved.includes(mint) ? 'Token saved to your watchlist on this device.' : 'Token removed from your watchlist on this device.');
    if (saved.some(item => !prior.includes(item))) window.dispatchEvent(new Event('funded:watchlist-added'));
    return true;
  } catch {
    watchlistUnavailable = true; watchlistReadWarning = false;
    watchlistWriteUnconfirmed = wrote || (!read && watchlistWriteUnconfirmed);
    const message = watchlistWriteUnconfirmed
      ? 'The watchlist update could not be verified. The saved selection may have changed. Allow browser storage and check again before relying on it.'
      : 'Watchlist could not be updated. Your saved data was not replaced. Allow browser storage and try again.';
    showWatchlistStatus(message); showToast(message);
    return false;
  }
}
function setWatchButtonState(button, active){
  if (!button) return;
  button.classList.toggle('active', active);
  button.innerHTML = icon(active ? 'starFilled' : 'star');
  button.setAttribute('aria-pressed', String(active));
  button.setAttribute('aria-label', active ? 'Remove token from watchlist' : 'Save token to watchlist');
}
function renderWatchlist(){
  const saved = getWatchlist();
  const count = document.querySelector('#watch-count');
  const empty = document.querySelector('#watchlist-empty');
  const items = document.querySelector('#watchlist-items');
  if (count) count.textContent = watchlistUnavailable ? 'Saved list unavailable' : `${saved.length} saved`;
  if (empty) empty.hidden = saved.length > 0 || watchlistUnavailable;
  if (items) items.innerHTML = saved.map(mint => {
    const asset = assets.find(item => item.address === mint);
    const policy = verifiedLaunchPolicyForMint(mint);
    return asset ? portfolioTokenCardMarkup({ mint: asset.address, name: asset.name, symbol: asset.symbol, source: 'Saved token · RPC verified', verified: true, removable: true })
      : policy?.onchainVerified ? portfolioTokenCardMarkup({ mint, name: policy.name, symbol: policy.symbol, source: 'Saved token · verified launch', verified: true, removable: true })
        : `<div class="empty-state watchlist-unavailable"><strong>Saved token · verification unavailable</strong><span class="watchlist-unavailable-mint" title="${escapeHtml(mint)}">${escapeHtml(shortAddress(mint))}</span><span>No current market or recorded launch policy could be checked for this mint. Your saved entry remains on this device.</span><div class="watchlist-unavailable-actions"><button type="button" class="secondary-button" data-watch-retry="${escapeHtml(mint)}">Retry check</button><button type="button" class="secondary-button token-card-copy-address" data-copy-address="${escapeHtml(mint)}" data-copy-kind="token" aria-label="Copy full token address">Copy mint</button><button type="button" class="secondary-button" data-remove-watch="${escapeHtml(mint)}" aria-label="Remove saved token">Remove</button></div></div>`;
  }).join('');
  items?.querySelectorAll('.watchlist-token-card').forEach(card => loadPortfolioLogo(card, verifiedLaunchPolicyForMint(card.dataset.mint)));
  document.querySelectorAll('.watch-button').forEach(button => setWatchButtonState(button, saved.includes(button.dataset.mint)));
  showWatchlistStatus(watchlistNotice);
}
function formatFeedAge(timestamp){
  const ms = Date.parse(String(timestamp || ''));
  return Number.isFinite(ms) ? formatOnchainAge(ms) : 'freshness unavailable';
}
function marketUsdFilterToSol(value){
  if (value == null) return null;
  return Number.isFinite(coinSolUsdPrice) && coinSolUsdPrice > 0 ? value / coinSolUsdPrice : Infinity;
}
function exploreFilterOptions(query = exploreQuery, sort = exploreSort){
  const laneStage = exploreNewLane === 'almost' ? 'near' : exploreNewLane === 'migrated' ? 'migrated' : 'launch';
  const maxAgeHours = exploreTab === 'new' && exploreNewLane === 'launch' ? Math.min(24, exploreMaxAgeHours ?? 24) : exploreMaxAgeHours;
  return { query, sort, risk: exploreRisk, stage: exploreTab === 'new' ? laneStage : exploreStage, authority: exploreAuthority,
    promotion: explorePromotion, reward: exploreReward, watchlist: getWatchlist(), maxAgeHours,
    minVolumeSol: EXPLORE_CLUSTER === 'devnet' ? marketUsdFilterToSol(exploreMinVolumeUsd) : null,
    minCurveCapSol: EXPLORE_CLUSTER === 'devnet' ? marketUsdFilterToSol(exploreMinMarketCapUsd) : null,
    minTrades: EXPLORE_CLUSTER === 'devnet' ? exploreMinTrades : null,
    minTraders: EXPLORE_CLUSTER === 'devnet' ? exploreMinTraders : null };
}
function formatExploreTradeCount(value, coverage){
  return value == null || !Number.isInteger(Number(value)) ? '—' : `${coverage === 'partial' ? '≥' : ''}${Number(value).toLocaleString()}`;
}
function verifiedPaidListingPayment(record){
  const payment = record?.listingPayment;
  return EXPLORE_CLUSTER === 'devnet' && payment?.verified !== false
    && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(String(payment?.signature || '')) ? payment : null;
}
function explorePaidListingBagMarkup(record){
  const payment = verifiedPaidListingPayment(record);
  if (!payment) return '';
  const amount = Number(payment.amountTokens);
  const burn = Number.isSafeInteger(amount) && amount > 0 ? `${amount.toLocaleString()} $FUNDED burn` : '$FUNDED burn';
  const label = `Verified paid listing · ${burn} · view transaction receipt`;
  return `<a class="explore-paid-listing-bag" href="${escapeHtml(exploreExplorer(`tx/${encodeURIComponent(payment.signature)}`))}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${icon('listingBag')}</a>`;
}
function exploreStageLabel(record){
  if (verifiedPaidListingPayment(record) && record.complete == null) return 'Paid listing · mint verified';
  return record.migrated === true ? 'Migrated · PumpSwap' : record.complete === true ? 'Curve complete · pool unverified' : record.complete === false ? 'Pump curve' : 'Stage unverified';
}
function exploreDevnetVolumeLabel(record){ return verifiedPaidListingPayment(record) && record.complete == null ? 'Trade activity' : record.migrated === true ? 'Pool activity' : '24h traded'; }
function exploreDevnetVolume(record){ return record.migrated === true ? 'Unindexed' : formatExploreUsd(record.volume24hSol, { partial: record.volumeCoverage === 'partial' }); }
function exploreDevnetReserveLabel(record){ return verifiedPaidListingPayment(record) && record.complete == null ? 'Liquidity' : record.migrated === true ? 'Pool reserve' : 'Curve reserve'; }
function exploreDevnetReserve(record){ return formatCoinUsd(record.migrated === true ? record.poolReserveSol : record.curveReserveSol); }
function exploreMarketCapLabel(record){ return verifiedPaidListingPayment(record) && record.complete == null ? 'Market cap' : EXPLORE_CLUSTER === 'devnet' ? record.migrated === true ? 'Pool MC' : 'Curve MC' : 'Market cap'; }
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
  if ((exploreMinVolumeUsd != null || exploreMinMarketCapUsd != null) && !(Number.isFinite(coinSolUsdPrice) && coinSolUsdPrice > 0)) return ['USD filters are waiting for a conversion quote.', 'SOL/USD is unavailable. Clear the USD minimums to browse verified tokens.'];
  if (exploreQuery) return ['No verified launch matches this search.', 'Try a symbol, name, or full mint address from the current feed.'];
  if (explorePromotion !== 'all') return ['No launch matches this promotion filter.', 'Promoted includes verified launch burns and active finalized SOL boost payments.'];
  if (exploreReward !== 'all') return ['No launch has this verified reward allocation.', 'Choose another route or clear filters. Zero-percent routes are not counted as rewards.'];
  if (exploreMinTraders != null) return ['No launch meets the trading-wallet minimum.', 'Lower the selected-window minimum or clear filters.'];
  if (exploreMinTrades != null || exploreMinVolumeUsd != null) return ['No launch meets these trade-activity minimums.', 'Lower the selected-window minimums or clear filters.'];
  if (exploreMinMarketCapUsd != null || exploreMaxAgeHours != null) return ['No launch meets these advanced filters.', 'Broaden the curve-cap or age limit, or clear filters.'];
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
  const displayUnit = 'USD';
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
  const boostCount = document.querySelector('#explore-boost-sort-count');
  if (boostCount) boostCount.textContent = verifiedBoostsAvailable
    ? String(assets.filter(item => activeBoostMultiplier(verifiedBoosts[item.address]) > 0).length)
    : '—';
  const volumeSortButton = document.querySelector('[data-explore-sort="volume"]');
  if (volumeSortButton) volumeSortButton.textContent = `${exploreWindow} volume`;
  const hasExploreFilters = exploreRisk !== 'all' || exploreStage !== 'all' || exploreAuthority !== 'all'
    || explorePromotion !== 'all' || exploreReward !== 'all'
    || exploreMaxAgeHours != null || exploreMinVolumeUsd != null || exploreMinMarketCapUsd != null
    || exploreMinTrades != null || exploreMinTraders != null;
  document.querySelector('#explore-filter-toggle')?.classList.toggle('has-filters', hasExploreFilters);
  for (const [selector, label] of [
    ['#explore-sort option[value="market-cap"]', `Curve cap (${displayUnit})`],
    ['#explore-sort option[value="volume"]', `${exploreWindow} traded (${displayUnit})`],
    ['#explore-sort option[value="trades"]', `${exploreWindow} trades`],
    ['#explore-sort option[value="liquidity"]', `Curve reserve (${displayUnit})`],
    ['#explore-min-volume-label', `Minimum ${exploreWindow} traded · USD`],
    ['#explore-min-trades-label', `Minimum ${exploreWindow} trades`],
    ['#explore-min-traders-label', `Minimum ${exploreWindow} trading wallets`],
    ['.scanner-head span:nth-child(4)', `Curve cap · ${displayUnit}`],
    ['#scanner-volume-heading', `${exploreWindow} traded · ${displayUnit}`],
    ['#scanner-trades-heading', `${exploreWindow} trades`],
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
      : hasVerifiedField && definition.policy ? 'No matching launch yet' : definition.policy ? 'Details unavailable' : 'Activity unavailable';
    return `<button type="button" class="${definition.sort === exploreSort ? 'active' : ''}" data-explore-leader-sort="${definition.sort}" data-state="${leader ? 'ready' : hasVerifiedField ? 'empty' : 'unavailable'}" aria-pressed="${definition.sort === exploreSort}" ${leader ? '' : 'disabled'}><span>${escapeHtml(definition.label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></button>`;
  }).join('');
}
function formatPayoutSol(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value)) return '—';
  const units = BigInt(value);
  const whole = units / 1_000_000_000n;
  const fraction = String(units % 1_000_000_000n).padStart(9, '0').replace(/0+$/, '');
  return `${whole.toLocaleString()}${fraction ? `.${fraction}` : ''} SOL`;
}
function renderExplorePayoutStats() {
  const container = document.querySelector('#explore-payout-stats');
  if (!container) return;
  const stats = analyticsSummary?.feePayoutStats;
  const ready = stats?.cluster === EXPLORE_CLUSTER && stats.commitment === 'finalized';
  const cards = [
    { label:'Total fee paid to X accounts', kind:'x' },
    { label:'Total fee paid to creators', kind:'creator' },
    { label:'Total fee paid to coin holders', kind:'holder' },
    { label:'Top X account paid', kind:'x', top:true },
    { label:'Top coin holder paid', kind:'holder', top:true },
    { label:'Top $FUNDED holder paid', kind:'fundedHolder', top:true },
    { label:'Top creator paid', kind:'creator', top:true },
  ];
  container.innerHTML = cards.map(card => {
    const group = ready ? stats[card.kind] : null;
    const available = ['verified', 'partial'].includes(group?.status);
    const leader = available && card.top ? group.top : null;
    const amount = card.top ? leader?.paidLamports : group?.paidLamports;
    const count = card.top ? leader?.payoutCount : group?.payoutCount;
    const value = available && (group.status !== 'partial' || count > 0)
      ? `${group.status === 'partial' ? '≥' : ''}${formatPayoutSol(amount)}` : '—';
    const name = leader ? card.kind === 'x'
      ? leader.handle || `X ID ${leader.recipient}` : shortAddress(leader.recipient) : null;
    const profile = card.kind === 'x' && /^@[A-Za-z0-9_]{1,15}$/.test(String(leader?.handle || ''))
      ? `https://x.com/${leader.handle.slice(1)}` : null;
    const detail = group?.status === 'unavailable'
      ? group.reason || 'Finalized payout data unavailable'
      : !available ? 'Checking finalized payout records'
        : group.status === 'partial' && !count ? group.reason || 'Payout verification incomplete'
        : leader ? `${name} · ${leader.payoutCount} payment${leader.payoutCount === 1 ? '' : 's'}`
          : card.top ? 'No verified fee payout yet'
            : `${group.payoutCount} finalized payment${group.payoutCount === 1 ? '' : 's'}`;
    const detailMarkup = profile
      ? `<a href="${escapeHtml(profile)}" target="_blank" rel="noopener noreferrer">${escapeHtml(detail)} ↗</a>`
      : `<small>${escapeHtml(detail)}</small>`;
    return `<article data-state="${group?.status || 'loading'}"><span>${escapeHtml(card.label)}</span><strong>${escapeHtml(value)}</strong>${detailMarkup}${group?.status === 'partial' ? `<em${group.reason ? ` title="${escapeHtml(group.reason)}"` : ''}>Partial coverage</em>` : ''}</article>`;
  }).join('');
}
function exploreSocialLinksMarkup(record) {
  const links = exploreSocialLinks(record, verifiedLaunchPolicyForMint(record.address));
  if (!links.length) return '';
  const symbol = escapeHtml(record.symbol || 'token');
  return `<span class="explore-social-links" role="group" aria-label="Token social links">${links.map(({ icon: iconName, label, href }) => `<a class="explore-social-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${symbol} ${label} link" title="${escapeHtml(label)}">${icon(iconName)}</a>`).join('')}</span>`;
}
function exploreAssetCardMarkup(a){
  const mint = escapeHtml(a.address || '');
  const tokenUrl = `/token/${encodeURIComponent(a.address || '')}`;
  const age = a.createdTimestamp ? escapeHtml(formatOnchainAge(Number(a.createdTimestamp) * 1000)) : 'Age unavailable';
  return `<article class="token-card-shell asset-card signal-${escapeHtml(a.riskLevel)}" data-search="${escapeHtml(a.symbol)} ${escapeHtml(a.name)} ${mint}" data-mint="${mint}">
    <div class="asset-artwork"><a class="asset-artwork-link" href="${tokenUrl}" aria-label="Open ${escapeHtml(a.name)} token"><i class="asset-icon">${escapeHtml(a.icon)}</i></a><span class="asset-artwork-stage">${escapeHtml(exploreStageLabel(a))}</span><span class="asset-artwork-age">${age}</span><button type="button" class="watch-button" data-mint="${mint}" aria-label="Save ${escapeHtml(a.symbol)} to watchlist" aria-pressed="false">${icon('star')}</button>${exploreSocialLinksMarkup(a)}</div>
    <div class="asset-top"><span class="asset-symbol${activeBoostMultiplier(verifiedBoosts[a.address]) >= 500 ? ' golden-ticker' : ''}">${escapeHtml(a.symbol)} ${exploreBoostAmountMarkup(a.address)}</span><p class="asset-name"><a class="asset-title-link" href="${tokenUrl}">${escapeHtml(a.name)}</a></p></div>
    <div class="asset-status"><span class="asset-status-badge">${verifiedPaidListingPayment(a) ? 'Paid listing' : a.promotionTier === 'standard' ? 'Standard launch' : a.promotionTier ? 'Promoted launch' : 'Tier unavailable'}</span>${explorePaidListingBagMarkup(a)}<span class="asset-meta">${escapeHtml(exploreStageLabel(a))} · ${age}</span></div>
    <div class="asset-signal-row"><span>${EXPLORE_CLUSTER === 'devnet' ? exploreDevnetVolumeLabel(a) : '24h volume'} <b>${EXPLORE_CLUSTER === 'devnet' ? exploreDevnetVolume(a) : formatSignal(a.volume24hUsd, ' USD')}</b></span><span>${EXPLORE_CLUSTER === 'devnet' ? exploreDevnetReserveLabel(a) : 'Liquidity'} <b>${EXPLORE_CLUSTER === 'devnet' ? exploreDevnetReserve(a) : formatSignal(a.liquidityUsd, ' USD')}</b></span></div>
    <div class="asset-bottom"><span class="asset-value" title="${verifiedPaidListingPayment(a) && a.complete == null ? 'Market cap unavailable without verified market data' : `Estimated market capitalization from the confirmed ${a.migrated === true ? 'PumpSwap pool' : 'Pump curve'} snapshot`}">${escapeHtml(exploreMarketCapLabel(a))} · ${escapeHtml(exploreMarketCapUsd(a))}</span><span class="asset-change">${escapeHtml(a.migrated === true ? 'Pool change unindexed' : a.change)}</span></div>
    ${tokenCardAddressesMarkup(a.address)}
    <div class="asset-actions"><button type="button" class="share-asset" data-share-symbol="${escapeHtml(a.symbol)}" data-share-name="${escapeHtml(a.name)}" data-share-mint="${mint}">Share</button><button type="button" class="explore-boost-button" data-boost-mint="${mint}" aria-label="Boost options for ${escapeHtml(a.name)}">Boost</button></div>
    ${activeBoostMultiplier(verifiedBoosts[a.address]) ? `<div class="asset-boost-row"><span>BOOST <b>${escapeHtml(exploreBoostStatus(a.address))}</b></span></div>` : ''}
  </article>`;
}
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
function exploreOutageCopy(){
  if (/RPC (?:rate limited|unavailable)/i.test(exploreProviderStatus)) return {
    title: 'Solana verification unavailable.',
    detail: `${exploreProviderStatus}. Retry verification when RPC access recovers; unverified tokens remain hidden.`,
  };
  return {
    title: 'Launch feed unavailable.',
    detail: 'The launch API did not return a verified registry. Retry verification when the service recovers.',
  };
}
function renderExploreAssets({ force = false } = {}){
  const grid = document.querySelector('#asset-grid');
  // Preserve the focused action through background market refreshes.
  if (!force && grid?.contains(document.activeElement)) {
    grid.dataset.refreshPending = 'true';
    return;
  }
  if (grid) delete grid.dataset.refreshPending;
  const status = document.querySelector('#explore-data-status');
  const ticker = document.querySelector('#explore-ticker');
  const clusterLabel = document.querySelector('#explore-cluster-label');
  const scope = document.querySelector('.explore-hero-disclosure');
  const loading = exploreProviderStatus === 'On-chain only · loading' && !exploreLastVerifiedAt;
  const feedUnavailable = !exploreFeedAvailable && !exploreLastVerifiedAt;
  const rpcUnavailable = /RPC (?:rate limited|unavailable)/.test(exploreProviderStatus);
  const outage = exploreOutageCopy();
  if (clusterLabel) clusterLabel.textContent = `${exploreProviderStatus.includes('Verified launch registry') ? 'Verified launch registry' : exploreProviderStatus.includes('stale') ? 'last verified snapshot' : exploreProviderStatus.includes('RPC verified') ? 'RPC verified' : exploreProviderStatus.includes('unavailable') ? 'data unavailable' : 'awaiting verification'}`;
  if (scope && EXPLORE_CLUSTER !== 'devnet') scope.textContent = 'Solana mainnet discovery · Pump.fun listings are shown only after mint verification. Missing market figures stay unavailable.';
  const records = assets.map(item => withVerifiedExploreBenefits(EXPLORE_CLUSTER === 'devnet' ? withMarketWindow(item, exploreWindow) : enrichMarketRecord(item)));
  const visible = filterMarketRecords(records, exploreFilterOptions());
  renderExploreControls();
  renderExplorePulse(records);
  renderExploreBenefitLeaders(visible);
  const summary = summarizeMarkets(records);
  if (status) status.textContent = exploreProviderStatus === 'On-chain only · loading' ? exploreProviderStatus : `${exploreProviderStatus}${assets.length ? ` · ${visible.length} shown` : ''}`;
  const kpis = document.querySelector('#explore-market-kpis');
  if (kpis) kpis.innerHTML = EXPLORE_CLUSTER === 'devnet'
    ? `<span><small>${exploreWindow} curve traded · scanned</small><strong>${formatExploreUsd(records.some(item => item.windowVolumeSol != null) ? records.reduce((sum, item) => sum + (item.windowVolumeSol || 0), 0) : null, { partial: exploreScannedCount < records.length || records.some(item => item.windowCoverage === 'partial') })}</strong></span><span><small>On-chain reserves</small><strong>${formatExploreUsd(records.some(item => (item.migrated === true ? item.poolReserveSol : item.curveReserveSol) != null) ? records.reduce((sum, item) => sum + (item.migrated === true ? item.poolReserveSol : item.curveReserveSol || 0), 0) : null)}</strong></span><span><small>Curve histories scanned</small><strong>${exploreScannedCount} / ${records.length}</strong></span>`
    : `<span><small>24h volume</small><strong>${formatSignal(summary.volume24hUsd, ' USD')}</strong></span><span><small>Liquidity indexed</small><strong>${formatSignal(summary.liquidityUsd, ' USD')}</strong></span><span><small>High-risk signals</small><strong>${summary.highRisk}</strong></span>`;
  if (ticker) {
    const trending = sortMarketRecords(records.filter(asset => EXPLORE_CLUSTER === 'devnet'
      ? asset.windowVolumeSol != null && Number.isFinite(Number(asset.windowVolumeSol))
      : asset.volume24hUsd != null && Number.isFinite(Number(asset.volume24hUsd))), 'volume').slice(0, 8);
    if (trending.length) {
      const tickerItems = trending.map(asset => `<a class="explore-ticker-token" data-logo-mint="${escapeHtml(asset.address || '')}" href="/token/${encodeURIComponent(asset.address || '')}"><i>${escapeHtml(String(asset.symbol || 'T').slice(0, 1))}</i><span><span class="explore-ticker-primary"><strong class="${activeBoostMultiplier(verifiedBoosts[asset.address]) >= 500 ? 'golden-ticker' : ''}">${escapeHtml(asset.symbol || 'TOKEN')}</strong>${exploreBoostAmountMarkup(asset.address)}</span><small>${escapeHtml(asset.name || asset.symbol)} · ${escapeHtml(exploreStageLabel(asset))}</small></span><b>${escapeHtml(EXPLORE_CLUSTER === 'devnet' ? formatExploreUsd(asset.windowVolumeSol, { partial: asset.windowCoverage === 'partial' }) : formatSignal(asset.volume24hUsd, ' USD'))}</b></a>`).join('');
      ticker.innerHTML = `<div class="explore-ticker-heading"><span class="ticker-label"><i></i> Trending</span><button type="button" class="explore-ticker-view-all">View all</button></div><div class="explore-ticker-window" aria-label="Tokens ranked by verified ${escapeHtml(exploreWindow)} traded volume"><div class="explore-ticker-track"><div class="explore-ticker-set">${tickerItems}</div></div></div>`;
      loadVerifiedTokenLogos(ticker);
    } else {
      ticker.innerHTML = `<div class="explore-ticker-heading"><span class="ticker-label"><i></i> Trending</span><button type="button" class="explore-ticker-view-all">View all</button></div><span id="explore-ticker-status">${loading ? 'Loading verified launches…' : feedUnavailable || rpcUnavailable ? escapeHtml(outage.title) : 'No scanned volume yet'}</span>`;
    }
  }
  if (!grid) return;
  grid.innerHTML = visible.length ? visible.map(item => homeLaunchCardMarkup(item, {
    volumeLabel: exploreWindow,
    volumeValue: launchCardVolumeUsd(item, exploreWindow),
    extraClass: ' explore-launch-card',
  })).join('') : loading
    ? '<div class="empty-state onchain-empty"><strong>Loading verified launches…</strong><span>Checking the indexed launch feed and confirming current Solana state.</span></div>'
    : feedUnavailable || rpcUnavailable
      ? `<div class="empty-state onchain-empty"><strong>${escapeHtml(outage.title)}</strong><span>${escapeHtml(outage.detail)}</span></div>`
        : `<div class="empty-state onchain-empty"><strong>${assets.length ? 'No verified launches match these filters.' : exploreProviderStatus.includes('none passed RPC verification') ? 'Indexed launches could not be verified.' : 'No Solana launches are indexed yet.'}</strong><span>${assets.length ? 'Broaden the search or clear the filters.' : exploreProviderStatus.includes('none passed RPC verification') ? 'The indexed mints did not pass current Solana verification. Retry when the RPC is available.' : 'Confirmed funded.vip launches will appear here after they are indexed.'}</span></div>`;
  if (!visible.length && assets.length && !feedUnavailable && !rpcUnavailable) {
    const reason = exploreEmptyReason();
    if (reason) { grid.querySelector('.empty-state strong').textContent = reason[0]; grid.querySelector('.empty-state span').textContent = reason[1]; }
  }
  grid.querySelectorAll('.explore-launch-card').forEach((card, index) => decorateHomeLaunchCard(card, visible[index]?.address));
  loadVerifiedTokenLogos(grid);
  if (!visible.length && !loading) {
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'explore-empty-action';
    action.dataset.exploreEmptyAction = assets.length ? 'clear' : 'retry';
    action.textContent = assets.length ? exploreTab === 'new' ? 'View all tokens' : 'Clear filters' : 'Retry verification';
    grid.querySelector('.empty-state')?.append(action);
  }
  renderWatchlist();
  renderWalletDetail();
}
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-verified-feed-retry]');
  if (!button || button.disabled) return;
  button.disabled = true;
  button.textContent = 'Checking launches…';
  try { await loadOnchainExploreData(); }
  catch { showToast('Verification is unavailable. Please try again shortly.'); }
  finally { button.disabled = false; button.textContent = 'Retry verification'; }
});
document.querySelector('#asset-grid')?.addEventListener('focusout', () => {
  queueMicrotask(() => {
    const grid = document.querySelector('#asset-grid');
    if (grid?.dataset.refreshPending && !grid.contains(document.activeElement)) renderExploreAssets();
  });
});
document.querySelector('#explore-ticker')?.addEventListener('click', event => {
  if (event.target.closest('.explore-ticker-view-all')) document.querySelector('.explore-heading')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
});
function renderStonkEnhancements(){
  const quoteList = document.querySelector('#quote-asset-list');
  const quoteStatus = document.querySelector('#quote-assets-status');
  if (!quoteList) return;
  const quoteLoad = apiRequest('/api/quote-assets').then(result => {
    const verified = result.data?.status === 'onchain-verified-catalog' && result.data?.cluster === EXPLORE_CLUSTER;
    const assets = verified && Array.isArray(result.data?.assets) ? result.data.assets : [];
    if (quoteStatus) quoteStatus.textContent = verified ? 'RPC verified' : 'Unavailable';
    if (quoteList) quoteList.innerHTML = assets.length ? assets.map(item => `<div class="quote-asset-row"><span class="asset-icon">${escapeHtml(item.symbol.slice(0, 1))}</span><span><strong>${escapeHtml(item.symbol)}</strong><small>${escapeHtml(item.name)} · ${escapeHtml(item.category)}</small></span><b>✓</b></div>`).join('') : '<div class="empty-state">No verified quote assets configured.</div>';
  }).catch(() => { if (quoteStatus) quoteStatus.textContent = 'Unavailable'; if (quoteList) quoteList.innerHTML = '<div class="empty-state">Quote catalog unavailable; no unverified assets shown.</div>'; });
  return quoteLoad;
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
  const launchFeedUnavailable = verifiedLaunchPoliciesStatus !== 'ready';
  const launchCard = document.querySelector('#home-kpi-launches-card');
  const launchValue = document.querySelector('#home-pulse-launches');
  const launchNote = document.querySelector('#home-pulse-launches-note');
  if (launchCard) launchCard.dataset.state = launchFeedUnavailable ? 'unavailable' : fundedLaunchRecords.length ? 'available' : 'empty';
  if (launchValue) launchValue.textContent = launchFeedUnavailable ? '—' : fundedLaunchRecords.length.toLocaleString();
  if (launchNote) launchNote.textContent = launchFeedUnavailable ? 'Launch feed unavailable; count not verified' : fundedLaunchRecords.length ? `Funded policy and mint confirmed on Solana` : 'No funded launch policies confirmed';

  const finalizedReady = analyticsSummary?.cluster === EXPLORE_CLUSTER
    && analyticsSummary.receiptCommitment === 'finalized'
    && ['indexed', 'partial', 'no-records'].includes(analyticsSummary.status);
  const finalizedCollectionLamports = Number(analyticsSummary?.collectedLamports);
  const feesFromFinalized = finalizedReady && Number.isSafeInteger(finalizedCollectionLamports)
    && finalizedCollectionLamports >= 0;
  const evidenceReady = ['onchain-indexed', 'partial'].includes(receiptEvidence?.status);
  const collections = evidenceReady && Array.isArray(receiptEvidence?.verifiedCollections) ? receiptEvidence.verifiedCollections : [];
  const collectionSol = feesFromFinalized
    ? finalizedCollectionLamports / 1_000_000_000
    : collections.reduce((sum, item) => sum + Number(item.collectedLamports || 0) / 1_000_000_000, 0);
  const feeCount = feesFromFinalized ? Number(analyticsSummary.collections || 0) : collections.length;
  const recordedCollections = Number(analyticsSummary?.recordedCollections ?? receiptEvidence?.coverage?.recordedCollections ?? 0);
  const feeAvailable = solQuoteReady && (feesFromFinalized || evidenceReady);
  const partialFees = feesFromFinalized
    ? analyticsSummary.status === 'partial' || feeCount < recordedCollections
    : receiptEvidence?.status === 'partial' || feeCount < recordedCollections;
  setHomeDashboardMetric('fees', feeAvailable ? formatDashboardUsd(collectionSol * coinSolUsdPrice, { partial:partialFees }) : '$—',
    feeAvailable ? `${feeCount} verified collection receipt${feeCount === 1 ? '' : 's'}${partialFees ? ' · partial coverage' : ''}`
      : recordedCollections ? `${recordedCollections} recorded claim${recordedCollections === 1 ? '' : 's'} awaiting receipt verification` : 'USD quote or verified receipts unavailable',
    feeAvailable ? partialFees ? 'partial' : 'available' : 'unavailable');

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

  const rewardPaid = analyticsSummary?.rewardPaid;
  const paidEvidenceReady = rewardPaid?.cluster === EXPLORE_CLUSTER && rewardPaid.commitment === 'finalized';
  for (const [key, category, label] of [
    ['holder-paid', 'holder', 'coin holder'],
    ['x-paid', 'x', 'X account'],
  ]) {
    const payout = rewardPaid?.[category];
    const amountText = payout?.paidLamports;
    const paidLamports = typeof amountText === 'string' && /^(?:0|[1-9]\d*)$/.test(amountText) ? Number(amountText) : NaN;
    const count = Number(payout?.payoutCount);
    const evidenceAvailable = paidEvidenceReady && ['verified', 'partial'].includes(payout?.status)
      && Number.isSafeInteger(paidLamports) && paidLamports >= 0
      && Number.isSafeInteger(count) && count >= 0;
    const partial = payout?.status === 'partial';
    const priced = evidenceAvailable && solQuoteReady && (!partial || count > 0);
    setHomeDashboardMetric(key,
      priced ? formatSmallDashboardUsd(paidLamports / 1_000_000_000 * coinSolUsdPrice, { partial }) : '$—',
      !evidenceAvailable ? 'Finalized payout data unavailable'
        : !solQuoteReady ? 'Current SOL/USD quote unavailable'
          : partial ? count ? `${count} verified ${label} payout${count === 1 ? '' : 's'} · more receipts pending` : 'Payout verification incomplete'
            : count ? `${count} finalized ${label} payout${count === 1 ? '' : 's'} · current SOL/USD quote`
              : `No finalized ${label} payouts yet`,
      !evidenceAvailable ? 'unavailable' : partial ? 'partial' : !solQuoteReady ? 'unavailable' : count ? 'available' : 'empty');
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
  const airdropUnit = document.querySelector('#home-kpi-airdrop-unit');
  if (airdropUnit) airdropUnit.textContent = airdropAvailable ? 'USD' : 'ALLOCATIONS';
  setHomeDashboardMetric('airdrop', airdropAvailable ? formatDashboardUsd(airdropUsd, { partial: partialAirdrop }) : launchFeedUnavailable ? '—' : String(reservePrograms.length), launchFeedUnavailable
    ? 'Launch policies unavailable; allocation not verified'
    : airdropAvailable
    ? `${pricedPrograms}/${reservePrograms.length} policy allocation${reservePrograms.length === 1 ? '' : 's'} valued at spot · check vault funding per launch`
    : reservePrograms.length ? `${reservePrograms.length} policy allocation${reservePrograms.length === 1 ? '' : 's'} · USD pricing unavailable · check vault funding per launch` : 'No published community allocations', partialAirdrop ? 'partial' : airdropAvailable ? 'available' : launchFeedUnavailable ? 'unavailable' : 'empty');

  const payoutEvidenceReady = Boolean(receiptEvidence) && Array.isArray(receiptEvidence?.verifiedPayouts);
  const referralPayouts = payoutEvidenceReady ? receiptEvidence.verifiedPayouts.filter(item => item.source === 'solana-keeper-referral-claim') : [];
  const finalizedReferralLamports = Number(analyticsSummary?.referralPaidLamports);
  const referralsFromFinalized = finalizedReady && Number.isSafeInteger(finalizedReferralLamports)
    && finalizedReferralLamports >= 0 && Number.isSafeInteger(Number(analyticsSummary.referralPayoutCount));
  const referralCount = referralsFromFinalized ? Number(analyticsSummary.referralPayoutCount) : referralPayouts.length;
  const referralSol = referralsFromFinalized ? finalizedReferralLamports / 1_000_000_000
    : referralPayouts.reduce((sum, item) => sum + Number(item.amountLamports || 0) / 1_000_000_000, 0);
  const recordedPayouts = Number(analyticsSummary?.recordedPayouts ?? receiptEvidence?.coverage?.recordedPayouts ?? 0);
  const referralAvailable = solQuoteReady && (referralsFromFinalized || payoutEvidenceReady)
    && (referralCount > 0 || recordedPayouts === 0);
  const partialReferrals = referralsFromFinalized ? analyticsSummary.status === 'partial' : receiptEvidence?.status === 'partial';
  setHomeDashboardMetric('referrals', referralAvailable ? formatDashboardUsd(referralSol * coinSolUsdPrice, { partial:partialReferrals }) : '$—',
    referralAvailable ? referralCount ? `${referralCount} verified referral payout${referralCount === 1 ? '' : 's'}${partialReferrals ? ' · partial coverage' : ''}` : 'No verified referral payouts yet'
      : recordedPayouts ? 'Recorded payouts are awaiting receipt verification' : 'USD quote or payout evidence unavailable',
    referralAvailable ? partialReferrals ? 'partial' : referralCount ? 'available' : 'empty' : 'unavailable');

  const volumeRecords = fundedLaunchRecords.filter(item => item.observedVolumeSol != null
    && Number.isFinite(Number(item.observedVolumeSol)) && Number(item.observedVolumeSol) >= 0);
  const totalVolumeSol = volumeRecords.reduce((sum, item) => sum + Number(item.observedVolumeSol), 0);
  const partialVolume = volumeRecords.length < fundedLaunchRecords.length
    || volumeRecords.some(item => item.observedCoverage === 'partial');
  const volumeAvailable = volumeRecords.length > 0 && solQuoteReady;
  const volumeCard = document.querySelector('#home-kpi-volume-card');
  const volumeValue = document.querySelector('#home-pulse-volume');
  const volumeNote = document.querySelector('#home-pulse-volume-note');
  if (volumeCard) volumeCard.dataset.state = volumeAvailable ? (partialVolume ? 'partial' : 'available') : 'unavailable';
  if (volumeValue) volumeValue.textContent = volumeAvailable ? formatDashboardUsd(totalVolumeSol * coinSolUsdPrice, { partial:partialVolume }) : '$—';
  if (volumeNote) volumeNote.textContent = volumeAvailable
    ? `${volumeRecords.length}/${fundedLaunchRecords.length} launches scanned across available trade history${partialVolume ? ' · partial coverage' : ''}`
    : 'Observed trade history or USD quote unavailable';

  const heroLaunches = document.querySelector('#home-hero-launches');
  const heroAirdrop = document.querySelector('#home-hero-airdrop');
  const heroVolume = document.querySelector('#home-hero-volume');
  if (heroLaunches) heroLaunches.textContent = launchValue?.textContent || '—';
  if (heroAirdrop) heroAirdrop.textContent = document.querySelector('#home-kpi-airdrop')?.textContent || '$—';
  if (heroVolume) heroVolume.textContent = volumeValue?.textContent || '$—';

  const status = document.querySelector('#home-dashboard-status');
  const updated = document.querySelector('#home-dashboard-updated');
  if (status) {
    status.hidden = !launchFeedUnavailable && !fundedLaunchRecords.length;
    if (!status.hidden) status.innerHTML = `<i></i> ${launchFeedUnavailable ? `Launch feed unavailable` : `Verified funded launches`}`;
  }
  if (updated) updated.textContent = exploreUpdatedAt ? `Checked ${new Date(exploreUpdatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Waiting for first check';
  renderFundedTokenLanding();
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
  const registeredLaunches = verifiedLaunchPolicies.length;
  status.textContent = verified.length ? 'Solana RPC · confirmed' : 'Verified launch registry';
  if (count) count.textContent = String(registeredLaunches);
  if (countNote) countNote.textContent = registeredLaunches ? 'Verified launch records' : 'No confirmed launches found';
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
  if (pulseStatus) pulseStatus.textContent = `Solana RPC · confirmed`;
  if (pulseNetwork) pulseNetwork.textContent = `Solana`;
  if (pulseLaunches) pulseLaunches.textContent = registeredLaunches ? String(registeredLaunches) : '—';
  if (pulseLaunchesNote) pulseLaunchesNote.textContent = registeredLaunches ? 'Verified launch records' : 'No confirmed launches';
  if (pulseTrades) pulseTrades.textContent = totalTrades == null ? '—' : formatExploreTradeCount(totalTrades, partialTrades ? 'partial' : 'complete');
  if (pulseTradesNote) pulseTradesNote.textContent = totalTrades == null ? 'Not available from current feed' : `${partialTrades ? 'Partial scan · ' : ''}confirmed Pump events`;
  if (pulseVolume) pulseVolume.textContent = totalVolume == null ? '—' : formatExploreUsd(totalVolume, { partial: partialVolume });
  if (pulseVolumeNote) pulseVolumeNote.textContent = totalVolume == null ? 'Not available from current feed' : `${partialVolume ? 'Partial scan · ' : ''}${Number.isFinite(coinSolUsdPrice) ? 'USD equivalent · ' : ''}SOL volume`;
  const graduated = verified.filter(item => item.migrated === true).length;
  if (pulseGraduated) pulseGraduated.textContent = graduated ? String(graduated) : verified.length ? '0' : '—';
  if (pulseGraduatedNote) pulseGraduatedNote.textContent = verified.length ? 'Verified PumpSwap stage' : 'Waiting for verified mints';
  if (policyUpdated) policyUpdated.textContent = `RPC checked ${new Date().toLocaleTimeString()}`;
  renderHomeKpiDashboard(assets);
}
let receiptEvidence = null;
let paymentHistoryEvidence = null;
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
      ? `<b>$FUNDED</b>${burns.length} confirmed launch burn${burns.length === 1 ? '' : 's'}`
      : `<b>$FUNDED</b>${verifiedLaunchPoliciesStatus === 'unavailable' ? 'Launch burn history unavailable' : 'No confirmed launch burns; other burns appear on the Burn page'}`;
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
    airdropCard.querySelector('span').textContent = 'Estimated value of planned airdrops';
    airdropCard.querySelector('strong').textContent = pricedReserves ? formatDashboardUsd(reserveUsd, { partial }) : '—';
    airdropCard.querySelector('small').innerHTML = pricedReserves
      ? `<b>USD</b>Based on prices for ${pricedReserves} of ${reserves.length} airdrops · funding checked separately`
      : `<b>USD</b>${verifiedLaunchPoliciesStatus === 'unavailable' ? 'Airdrop details unavailable' : reserves.length ? 'Current prices unavailable · funding checked separately' : 'No planned community airdrops'}`;
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
      ? `<b>${Number.isFinite(coinSolUsdPrice) ? 'USD' : 'SOL'}</b>${referralPayouts.length} confirmed referral payment${referralPayouts.length === 1 ? '' : 's'}`
      : `<b>USD</b>${receiptEvidenceChecked && !receiptEvidence ? 'Referral payment history unavailable' : 'No confirmed referral payments'}`;
  }

  const recipients = document.querySelector('.recipients-panel');
  if (recipients) {
    const count = recipients.querySelector('.panel-count');
    if (count) count.textContent = verifiedPayouts.length ? `${verifiedPayouts.length} confirmed payment${verifiedPayouts.length === 1 ? '' : 's'}` : receiptEvidenceChecked && !receiptEvidence ? 'Payment history unavailable' : 'Checking payments';
    const target = recipients.querySelector('.payment-list, .empty-state');
    if (target && verifiedPayouts.length) {
      target.className = 'payment-list';
      target.replaceChildren();
      for (const payout of verifiedPayouts) {
        const row = document.createElement('div'); row.className = 'payment-row';
        const identity = document.createElement('span');
        const name = document.createElement('strong'); name.textContent = payout.source === 'solana-keeper-referral-claim' ? `Referral · ${shortAddress(payout.to)}` : `Recipient · ${shortAddress(payout.to)}`;
        const proof = document.createElement('a'); proof.href = exploreExplorer(`tx/${encodeURIComponent(payout.signature)}`); proof.target = '_blank'; proof.rel = 'noopener noreferrer'; proof.textContent = 'Confirmed transaction ↗';
        const amount = document.createElement('span'); amount.className = 'payment-amount'; amount.textContent = `${formatTokenBaseAmount(payout.amountLamports, 9, 9)} SOL`;
        identity.append(name, proof); row.append(identity, amount); target.append(row);
      }
    } else if (target && receiptEvidenceChecked && !receiptEvidence) {
      target.className = 'empty-state';
      target.textContent = 'Payment history is temporarily unavailable.';
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
    let ledgerAmount = '';
    if (analyticsSummary && Object.hasOwn(analyticsSummary, 'recordedCollectedLamports')) {
      try {
        const ledgerLamports = exactLamports(analyticsSummary.exactLamports?.recordedCollectedLamports ?? analyticsSummary.recordedCollectedLamports);
        if (ledgerLamports > 0n) ledgerAmount = `; ${formatReceiptSol(ledgerLamports)} SOL recorded in the ledger`;
      } catch { ledgerAmount = '; recorded amount unavailable'; }
    }
    feeCard.querySelector('span').textContent = 'Fees collected';
    feeCard.querySelector('small').innerHTML = receiptEvidence?.status === 'unverified-records' && recorded
      ? `<b>RECORDS ONLY</b>${recorded} claim${recorded === 1 ? '' : 's'} found${ledgerAmount}; confirmation unavailable`
      : `<b>SOL</b>${!receiptEvidenceChecked ? 'Checking fee history' : !receiptEvidence || receiptEvidence.status === 'unavailable' ? 'Fee history unavailable' : 'No confirmed fee claims in the selected period'}`;
  }
  if (collections.length && feeCard) {
    feeCard.querySelector('span').textContent = 'Fees collected';
    try {
      const lamports = collections.reduce((sum, item) => sum + exactLamports(item.collectedLamports), 0n);
      feeCard.querySelector('strong').textContent = `${formatReceiptSol(lamports)} SOL`;
      feeCard.querySelector('small').innerHTML = `<b>SOL</b>${collections.length} confirmed fee claims · available history`;
    } catch {
      feeCard.querySelector('strong').textContent = '—';
      feeCard.querySelector('small').innerHTML = '<b>SOL</b>Collection total unavailable; inspect individual receipts';
    }
  }
  if (payouts.length && payoutCard) {
    payoutCard.querySelector('span').textContent = 'Confirmed payments';
    payoutCard.querySelector('strong').textContent = String(payouts.length);
    payoutCard.querySelector('small').innerHTML = '<b>COUNT</b>Payments in available history';
  }
  else if (payoutCard) {
    payoutCard.querySelector('span').textContent = 'Confirmed payments';
    payoutCard.querySelector('small').innerHTML = `<b>COUNT</b>${!receiptEvidenceChecked ? 'Checking payment history' : !receiptEvidence || receiptEvidence.status === 'unavailable' ? 'Payment history unavailable' : 'No confirmed payments in available history'}`;
  }
  const historyPayouts = Array.isArray(paymentHistoryEvidence?.verifiedPayouts) ? paymentHistoryEvidence.verifiedPayouts : [];
  const list = document.querySelector('#payment-list');
  const tape = document.querySelector('#payment-dialog-list');
  if (!list || !tape) return;
  list.replaceChildren();
  tape.replaceChildren();
  for (const [index, receipt] of historyPayouts.entries()) {
    const row = document.createElement('div');
    row.className = 'payment-row payment-history-row';
    const identity = document.createElement('span');
    identity.className = 'payment-history-identity';
    const name = document.createElement('strong');
    name.textContent = ({ 'solana-keeper-referral-claim':'Referral reward', 'mint-router-settle-mint':'X account reward',
      'automatic-creator':'Creator fee', 'automatic-holder':'Holder reward', 'automatic-operations':'Operations payout',
      'automatic-community':'Community payout', 'automatic-x':'X account reward' })[receipt.source] || 'SOL payout';
    const recipient = document.createElement('span');
    recipient.className = 'payment-history-receiver';
    const receiverLabel = document.createElement('small');
    receiverLabel.textContent = 'Receiver';
    const receiverWallet = document.createElement('a');
    receiverWallet.className = 'payment-history-wallet';
    receiverWallet.textContent = receipt.to;
    receiverWallet.href = exploreExplorer(`address/${encodeURIComponent(receipt.to)}`);
    receiverWallet.target = '_blank';
    receiverWallet.rel = 'noopener noreferrer';
    receiverWallet.title = `View receiver wallet ${receipt.to} on Solana Explorer`;
    const copyReceiver = document.createElement('button');
    copyReceiver.type = 'button';
    copyReceiver.className = 'payment-copy-receiver';
    copyReceiver.dataset.receiverWallet = receipt.to;
    copyReceiver.setAttribute('aria-label', `Copy receiver wallet ${shortAddress(receipt.to)}`);
    copyReceiver.title = 'Copy receiver wallet';
    copyReceiver.innerHTML = icon('copy');
    recipient.append(receiverLabel, receiverWallet, copyReceiver);
    const paid = document.createElement('small');
    paid.className = 'payment-history-time';
    paid.textContent = Number.isSafeInteger(receipt.blockTime) && receipt.blockTime > 0
      ? `Paid ${new Date(receipt.blockTime * 1000).toLocaleString('en-US', { timeZone:'UTC', year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit', hour12:false })} UTC`
      : 'Payout time unavailable';
    const gross = document.createElement('small');
    gross.className = 'payment-history-gross';
    gross.textContent = `Payout ${formatTokenBaseAmount(receipt.amountLamports, 9, 9)} SOL`;
    const fee = document.createElement('small');
    fee.className = 'payment-history-fee';
    fee.textContent = receipt.feeLamports == null ? 'Transaction fee unavailable'
      : `Transaction fee ${formatTokenBaseAmount(receipt.feeLamports, 9, 9)} SOL · paid by ${receipt.feePayer === receipt.to ? 'receiver' : shortAddress(receipt.feePayer)}`;
    identity.append(name, recipient, paid, gross, fee);
    const actions = document.createElement('span');
    actions.className = 'payment-history-actions';
    const amount = document.createElement('span');
    amount.className = 'payment-amount';
    amount.textContent = `Received ${formatTokenBaseAmount(receipt.actualReceivedLamports, 9, 9)} SOL`;
    const proof = document.createElement('a');
    proof.className = 'payment-receipt-link';
    proof.href = exploreExplorer(`tx/${encodeURIComponent(receipt.signature)}`);
    proof.target = '_blank';
    proof.rel = 'noopener noreferrer';
    proof.innerHTML = icon('external');
    proof.setAttribute('aria-label', `View confirmed payout transaction ${shortAddress(receipt.signature)} on Solana Explorer`);
    proof.title = 'View transaction on Solana Explorer';
    actions.append(amount, proof);
    row.append(identity, actions);
    if (index < 5) list.append(row.cloneNode(true));
    tape.append(row);
  }
  if (!historyPayouts.length) {
    list.innerHTML = '<p class="empty-state">No finalized payout receipts are available yet.</p>';
    tape.innerHTML = '<p class="empty-state">No finalized payout receipts are available yet.</p>';
  }
  const footnote = document.querySelector('#payment-history-footnote');
  if (footnote) footnote.textContent = historyPayouts.length
    ? `Showing ${Math.min(5, historyPayouts.length)} of ${historyPayouts.length} recent finalized payments · transaction fee is paid by the listed fee payer${paymentHistoryEvidence.status === 'partial' ? ' · partial coverage' : ''}`
    : paymentHistoryEvidence?.status === 'partial' || !paymentHistoryEvidence ? 'Payout receipt verification is unavailable or incomplete.'
      : 'No finalized payout receipts are available.';
  renderExtendedAnalyticsDashboard();
}
document.addEventListener('click', async event => {
  const copy = event.target.closest('.payment-copy-receiver');
  if (!copy) return;
  try { await navigator.clipboard.writeText(copy.dataset.receiverWallet); showToast('Receiver wallet copied'); }
  catch { showToast('Could not copy receiver wallet'); }
});
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
  if (feeCard) { feeCard.querySelector('span').textContent = 'Fees collected'; feeCard.querySelector('strong').textContent = '—'; feeCard.querySelector('small').innerHTML = '<b>SOL</b>Checking fee history'; }
  if (launchCard) { launchCard.querySelector('strong').textContent = launchCount ? String(launchCount) : '—'; launchCard.querySelector('small').innerHTML = `<b>COUNT</b>${indexedLaunches != null ? feedChecked && !marketUnavailable && verified.length === indexedLaunches ? 'Confirmed launches' : 'Some launch activity may be missing' : !feedChecked ? 'Checking launches' : marketUnavailable ? 'Launch activity unavailable' : verified.length ? 'Confirmed launches' : 'No confirmed launches'}`; }
  if (payoutCard) { payoutCard.querySelector('span').textContent = 'Confirmed payments'; payoutCard.querySelector('strong').textContent = '—'; payoutCard.querySelector('small').innerHTML = '<b>COUNT</b>Checking payment history'; }
  const volumeSol = verified.reduce((sum, item) => sum + (Number.isFinite(Number(item.volume24hSol)) ? Number(item.volume24hSol) : 0), 0);
  const hasVolume = verified.some(item => item.volume24hSol != null && Number.isFinite(Number(item.volume24hSol)));
  const partialVolume = verified.some(item => item.volumeCoverage === 'partial' || item.volume24hSol == null);
  if (volumeCard) {
    volumeCard.querySelector('strong').textContent = hasVolume && (!partialVolume || volumeSol > 0) && Number.isFinite(coinSolUsdPrice) ? formatDashboardUsd(volumeSol * coinSolUsdPrice, { partial: partialVolume }) : '—';
    volumeCard.querySelector('small').innerHTML = `<b>USD · 24H</b>${!feedChecked ? 'Checking confirmed trades' : hasVolume ? partialVolume && volumeSol === 0 ? 'Some trade history is unavailable' : volumeSol === 0 ? 'No trades in the past 24 hours' : `Confirmed trades${partialVolume ? ' · some history may be missing' : ''}` : marketUnavailable ? 'Market activity unavailable' : 'No confirmed trading volume'}`;
  }
  const observedWallets = verified.reduce((sum, item) => sum + (Number.isFinite(Number(item.traderCount24h)) ? Number(item.traderCount24h) : 0), 0);
  const hasWallets = verified.some(item => item.traderCount24h != null && Number.isFinite(Number(item.traderCount24h)));
  const partialWallets = verified.some(item => item.traderCount24h == null);
  if (walletCard) {
    walletCard.querySelector('strong').textContent = hasWallets && (!partialWallets || observedWallets > 0) ? `${partialWallets ? '≥' : ''}${observedWallets.toLocaleString()}` : '—';
    walletCard.querySelector('small').innerHTML = `<b>COUNT · 24H</b>${!feedChecked ? 'Checking confirmed trades' : hasWallets ? partialWallets && observedWallets === 0 ? 'Some wallet activity is unavailable' : observedWallets === 0 ? 'No trading wallets in the past 24 hours' : `${partialWallets ? 'Partial history · ' : ''}wallet counts across launches` : marketUnavailable ? 'Market activity unavailable' : 'No confirmed wallet activity'}`;
  }
  const strip = document.querySelector('#analytics .strip-stat');
  if (strip) strip.innerHTML = !feedChecked ? '— <small>checking launches</small>' : marketUnavailable ? '— <small>launch activity unavailable</small>' : verified.length ? `${verified.length} <small>confirmed launches</small>` : '— <small>no confirmed launches</small>';
  const chart = document.querySelector('.analytics-chart .mini-chart');
  if (chart) chart.innerHTML = '<div class="empty-state onchain-report-empty"><strong>No fee activity to chart yet.</strong><span>The chart appears when confirmed fee history is available.</span></div>';
  const chartBadge = document.querySelector('.analytics-chart .data-badge');
  if (chartBadge) chartBadge.textContent = 'Confirmed activity';
  const community = document.querySelectorAll('.community-section .signal-list>div b');
  if (community[0]) community[0].textContent = '—';
  if (community[1]) community[1].textContent = verified.length ? String(verified.length) : '—';
  if (community[2]) community[2].textContent = verified.length ? String(verified.filter(item => item.riskLevel === 'high').length) : '—';
  const communityBadge = document.querySelector('.community-section .data-badge');
  if (communityBadge) communityBadge.textContent = 'Current activity';
  renderVerifiedReceiptEvidence();
  renderExtendedAnalyticsDashboard();
  const technical = document.querySelector('#analytics-technical-source');
  if (technical) technical.textContent = analyticsSummary ? `Build: ${analyticsSummary.build || 'unavailable'} · Source: ${analyticsSummary.source || 'unavailable'}` : 'Source details unavailable.';
}
document.addEventListener('funded:analytics-upgraded', () => renderOnchainReportState(assets));
let leaderboardView = 'burners';
let burnBoardState = { status: 'idle', projects: [] };
let burnersBoardState = { status: 'idle', wallets: [] };

function launchBurnersFallback(){
  const wallets = new Map();
  const seen = new Set();
  for (const launch of verifiedLaunchPolicies) {
    const burn = launch?.creatorLaunchBurn;
    const receipt = burn?.receipt;
    const wallet = launch?.creatorWallet || launch?.feePayer;
    const amount = Number(receipt?.amountTokens ?? burn?.amountTokens);
    if (!launch?.onchainVerified || burn?.status !== 'verified' || receipt?.verified !== true
      || receipt.instruction !== 'BurnChecked' || receipt.atomicWithPumpLaunch !== true
      || !receipt.signature || seen.has(receipt.signature) || !wallet
      || !Number.isFinite(amount) || amount <= 0) continue;
    seen.add(receipt.signature);
    const row = wallets.get(wallet) || { wallet, burnedTokens:0, receiptCount:0, firstBurnAt:null, latestSignature:null };
    row.burnedTokens += amount;
    row.receiptCount += 1;
    if (!row.firstBurnAt || String(launch.onchainVerifiedAt || '') < row.firstBurnAt) row.firstBurnAt = launch.onchainVerifiedAt || null;
    row.latestSignature = receipt.signature;
    wallets.set(wallet, row);
  }
  return [...wallets.values()].sort((a,b) => b.burnedTokens - a.burnedTokens || a.wallet.localeCompare(b.wallet));
}

function renderWalletBurnersBoard(){
  const table = document.querySelector('#leaderboard-table');
  if (!table) return;
  const board = burnersBoardState.status === 'unavailable' && verifiedLaunchPoliciesStatus === 'ready'
    ? { status:'partial', wallets:launchBurnersFallback() } : burnersBoardState;
  document.querySelector('#leaderboard-panel')?.setAttribute('aria-labelledby', 'leaderboard-burners-tab');
  setCoinField('#leaderboard-table-kicker', board.status === 'partial' ? 'Confirmed launch burns · limited history' : 'Confirmed $FUNDED burns');
  setCoinField('#leaderboard-table-title', 'Wallet burn leaderboard');
  setCoinField('#leaderboard-hero-description', 'Wallets ranked by confirmed $FUNDED burns.');
  setCoinField('#leaderboard-source-note', board.status === 'partial'
    ? 'Only burns made during a launch are available right now. Other burns will appear when their history is ready.'
    : 'Only confirmed burns on this network count. Each transaction is counted once.');
  const builders = document.querySelector('#leaderboard .leaderboard-grid')?.closest('details');
  if (builders) builders.hidden = true;
  table.setAttribute('aria-label', 'Solana wallet burn leaderboard');
  const header = '<div class="leaderboard-table-head" role="row"><span>Rank</span><span>Wallet</span><span>Burned</span><span>First burn</span><span>Proof</span></div>';
  if (!['ready','partial'].includes(board.status)) {
    table.innerHTML = `${header}<div class="empty-state">${board.status === 'unavailable' ? 'Burn history is temporarily unavailable.' : 'Checking confirmed burns…'}</div>`;
    return;
  }
  if (!board.wallets.length) {
    const detail = board.status === 'partial'
      ? 'No launch burns are available in the current history.'
      : 'Wallets appear after a confirmed $FUNDED burn.';
    table.innerHTML = `${header}<div class="empty-state"><strong>${board.status === 'partial' ? 'No launch burns in this feed.' : 'No verified wallet burns yet.'}</strong><span>${detail}</span></div>`;
    return;
  }
  table.innerHTML = `${header}${board.wallets.slice(0,50).map((item,index) => {
    const amount = Number(item.burnedTokens).toLocaleString(undefined,{maximumFractionDigits:6});
    const firstBurn = item.firstBurnAt ? formatOnchainAge(Date.parse(item.firstBurnAt)) : 'Time unavailable';
    const receiptHref = exploreExplorer(`tx/${encodeURIComponent(item.latestSignature)}`);
    return `<div class="leaderboard-row${index === 0 ? ' featured' : ''}" role="row"><span class="rank-number">${String(index+1).padStart(2,'0')}</span><span class="leader-identity"><span class="leader-avatar">${escapeHtml(String(item.wallet || '').slice(0,2).toUpperCase())}</span><span><a href="/wallet/${encodeURIComponent(item.wallet)}"><strong>${escapeHtml(shortAddress(item.wallet))}</strong></a><small>${item.receiptCount} verified receipt${item.receiptCount === 1 ? '' : 's'}</small></span></span><span><b>${escapeHtml(amount)}</b><small>$FUNDED</small></span><span class="leader-value">${escapeHtml(firstBurn)}</span><span><a class="leaderboard-proof" href="${escapeHtml(receiptHref)}" target="_blank" rel="noopener noreferrer">Receipt ↗</a></span></div>`;
  }).join('')}`;
}

async function loadWalletBurnBoard(){
  burnersBoardState = { status:'loading', wallets:[] };
  if (leaderboardView === 'burners') renderWalletBurnersBoard();
  const response = await apiRequest('/api/leaderboard/burners').catch(() => ({ available:false }));
  burnersBoardState = response.available && response.data?.cluster === EXPLORE_CLUSTER && Array.isArray(response.data.wallets)
    ? { status:'ready', wallets:response.data.wallets } : { status:'unavailable', wallets:[] };
  if (leaderboardView === 'burners') renderWalletBurnersBoard();
}

function launchBurnBoardFallback(){
  return verifiedLaunchPolicies.flatMap(launch => {
    const burn = launch?.creatorLaunchBurn;
    const receipt = burn?.receipt;
    const amount = Number(receipt?.amountTokens ?? burn?.amountTokens);
    if (!launch?.onchainVerified || !launch.mint || burn?.status !== 'verified' || receipt?.verified !== true
      || receipt.instruction !== 'BurnChecked' || receipt.atomicWithPumpLaunch !== true
      || !receipt.signature || !Number.isFinite(amount) || amount <= 0) return [];
    return [{ mint: launch.mint, name: launch.name || 'Verified launch', symbol: launch.symbol || 'TOKEN',
      burnedTokens: amount, receiptCount: 1, burnerCount: Number(Boolean(launch.creatorWallet || launch.feePayer)),
      lastBurnAt: launch.onchainVerifiedAt || null, latestSignature: receipt.signature }];
  }).sort((a, b) => b.burnedTokens - a.burnedTokens || a.mint.localeCompare(b.mint));
}

function renderProjectBurnBoard(){
  const table = document.querySelector('#leaderboard-table');
  if (!table) return;
  const board = burnBoardState.status === 'unavailable' && verifiedLaunchPoliciesStatus === 'ready'
    ? { status: 'partial', projects: launchBurnBoardFallback() } : burnBoardState;
  const projects = board.projects;
  document.querySelector('#leaderboard-panel')?.setAttribute('aria-labelledby', 'leaderboard-burn-board-tab');
  const kicker = document.querySelector('#leaderboard-table-kicker');
  const heading = document.querySelector('#leaderboard-table-title');
  const note = document.querySelector('#leaderboard-source-note');
  const heroDescription = document.querySelector('#leaderboard-hero-description');
  const builders = document.querySelector('#leaderboard .leaderboard-grid')?.closest('details');
  if (kicker) kicker.textContent = board.status === 'partial' ? 'Confirmed launch burns · limited history' : 'Confirmed $FUNDED burns';
  if (heading) heading.textContent = 'Project burn board';
  if (note) note.textContent = board.status === 'partial'
    ? 'Only burns made during a launch are available right now. Other project burns will appear when their history is ready.'
    : 'Projects are ranked by confirmed burns linked to their launches.';
  if (heroDescription) heroDescription.textContent = 'Projects ranked by verified $FUNDED burns attributed to their launches.';
  if (builders) builders.hidden = true;
  table.setAttribute('aria-label', 'Solana project burn board');
  const header = '<div class="leaderboard-table-head" role="row"><span>Rank</span><span>Project</span><span>Burned</span><span>Last burn</span><span>Proof</span></div>';
  if (!['ready', 'partial'].includes(board.status)) {
    const message = board.status === 'unavailable'
      ? 'Project burn history is temporarily unavailable. Try again shortly.'
      : 'Checking confirmed project burns…';
    table.innerHTML = `${header}<div class="empty-state">${message}</div>`;
    return;
  }
  if (!projects.length) {
    const detail = board.status === 'partial'
      ? 'No launch burns are available in the current history.'
      : 'Projects appear here after a confirmed $FUNDED burn is linked to a launch.';
    table.innerHTML = `${header}<div class="empty-state"><strong>No project burns yet.</strong><span>${detail}</span></div>`;
    return;
  }
  table.innerHTML = `${header}${projects.slice(0, 50).map((item, index) => {
    const lastBurn = item.lastBurnAt ? formatOnchainAge(Date.parse(item.lastBurnAt)) : 'Time unavailable';
    const amount = Number(item.burnedTokens).toLocaleString(undefined, { maximumFractionDigits: 6 });
    const tokenHref = `/token/${encodeURIComponent(item.mint)}`;
    const receiptHref = exploreExplorer(`tx/${encodeURIComponent(item.latestSignature)}`);
    return `<div class="leaderboard-row${index === 0 ? ' featured' : ''}" role="row"><span class="rank-number">${String(index + 1).padStart(2, '0')}</span><span class="leader-identity"><span class="leader-avatar mint">${escapeHtml(String(item.symbol || 'T').slice(0, 2))}</span><span><a href="${escapeHtml(tokenHref)}"><strong>${escapeHtml(item.name)}</strong></a><small>${escapeHtml(item.symbol)} · ${item.burnerCount} verified burner${item.burnerCount === 1 ? '' : 's'}</small></span></span><span><b>${escapeHtml(amount)}</b><small>$FUNDED</small></span><span class="leader-value">${escapeHtml(lastBurn)}</span><span><a class="leaderboard-proof" href="${escapeHtml(receiptHref)}" target="_blank" rel="noopener noreferrer">Receipt ↗</a></span></div>`;
  }).join('')}`;
}

async function loadProjectBurnBoard(){
  burnBoardState = { status: 'loading', projects: [] };
  if (leaderboardView === 'burn-board') renderProjectBurnBoard();
  const response = await apiRequest('/api/leaderboard/burn-board').catch(() => ({ available: false }));
  burnBoardState = response.available && response.data?.cluster === EXPLORE_CLUSTER && Array.isArray(response.data.projects)
    ? { status: 'ready', projects: response.data.projects } : { status: 'unavailable', projects: [] };
  if (leaderboardView === 'burn-board') renderProjectBurnBoard();
}

function selectLeaderboardView(view, focus = false){
  if (!['burners', 'creators', 'burn-board', 'traders'].includes(view)) return;
  leaderboardView = view;
  document.querySelectorAll('[data-leaderboard-view]').forEach(button => {
    const selected = button.dataset.leaderboardView === view;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
    if (selected && focus) button.focus();
  });
  renderLeaderboard();
  if (view === 'burn-board') void loadProjectBurnBoard();
  if (view === 'burners' && burnersBoardState.status === 'idle') void loadWalletBurnBoard();
}

document.querySelector('.leaderboard-tabs')?.addEventListener('click', event => {
  const button = event.target.closest('[data-leaderboard-view]');
  if (button) selectLeaderboardView(button.dataset.leaderboardView);
});
document.querySelector('.leaderboard-tabs')?.addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const views = [...document.querySelectorAll('[data-leaderboard-view]')].map(button => button.dataset.leaderboardView);
  const current = views.indexOf(leaderboardView);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? views.length - 1
    : (current + (event.key === 'ArrowRight' ? 1 : -1) + views.length) % views.length;
  event.preventDefault();
  selectLeaderboardView(views[next], true);
});

function renderLeaderboard(){
  const title = document.querySelector('#leaderboard-status-title');
  const note = document.querySelector('#leaderboard-status-note');
  const badge = document.querySelector('#leaderboard-status-badge');
  const table = document.querySelector('#leaderboard-table');
  if (!table) return;
  table.dataset.view = leaderboardView;
  if (leaderboardView === 'burners') {
    if (burnersBoardState.status === 'idle') void loadWalletBurnBoard();
    renderWalletBurnersBoard();
    return;
  }
  if (leaderboardView === 'burn-board') { renderProjectBurnBoard(); return; }
  if (leaderboardView === 'traders') {
    document.querySelector('#leaderboard-panel')?.setAttribute('aria-labelledby', 'leaderboard-traders-tab');
    setCoinField('#leaderboard-table-kicker', 'Confirmed wallet trading · Solana');
    setCoinField('#leaderboard-table-title', 'Trader leaderboard');
    setCoinField('#leaderboard-hero-description', 'Trader rankings require wallet-attributed, confirmed trade history.');
    setCoinField('#leaderboard-source-note', 'Unavailable: the verified wallet activity index is not running. Token trade observations cannot establish a wallet ranking.');
    setCoinField('#leaderboard-status-title', 'Trader ranking unavailable');
    setCoinField('#leaderboard-status-note', 'A wallet-attributed trade index is required before ranks can be shown.');
    setCoinField('#leaderboard-status-badge', 'Unavailable');
    table.setAttribute('aria-label', 'Solana trader leaderboard unavailable');
    table.innerHTML = '<div class="leaderboard-table-head" role="row"><span>Rank</span><span>Wallet</span><span>Trades</span><span>Volume</span><span>Proof</span></div><div class="empty-state"><strong>Trader ranking unavailable</strong><span>Confirmed token trades alone do not prove each trader’s wallet activity. Rankings will appear after that activity is indexed and verified.</span></div>';
    return;
  }
  document.querySelector('#leaderboard-panel')?.setAttribute('aria-labelledby', 'leaderboard-creators-tab');
  const kicker = document.querySelector('#leaderboard-table-kicker');
  const heading = document.querySelector('#leaderboard-table-title');
  const sourceNote = document.querySelector('#leaderboard-source-note');
  const heroDescription = document.querySelector('#leaderboard-hero-description');
  const builders = document.querySelector('#leaderboard .leaderboard-grid')?.closest('details');
  if (kicker) kicker.textContent = 'Verified launches · Solana';
  if (heading) heading.textContent = 'Creator launches';
  if (sourceNote) sourceNote.textContent = 'Only confirmed Solana launches are shown. Market cap uses the verified curve or pool value and an available SOL/USD rate.';
  if (heroDescription) heroDescription.textContent = 'Creators behind confirmed launches, ranked by available market cap.';
  if (builders) builders.hidden = true;
  table.dataset.view = 'creators';
  table.setAttribute('aria-label', 'Solana creator launch leaderboard');
  const launchByMint = new Map((Array.isArray(verifiedLaunchPolicies) ? verifiedLaunchPolicies : []).map(item => [item.mint, item]));
  const verified = EXPLORE_CLUSTER === 'devnet'
    ? assets.flatMap(item => {
      const policy = launchByMint.get(item.address);
      const creator = policy?.onchainVerified ? policy.creatorWallet || policy.feePayer : null;
      return item.address && creator ? [{ ...item, creator }] : [];
    })
    : [];
  const marketCapUsd = item => {
    const capSol = item.migrated === true ? item.poolMarketCapSol : item.curveCapSol;
    if (capSol == null || capSol === '' || !Number.isFinite(coinSolUsdPrice)) return null;
    const cap = Number(capSol) * coinSolUsdPrice;
    return Number.isFinite(cap) && cap >= 0 ? cap : null;
  };
  const ranked = verified.map(item => ({ ...item, capUsd: marketCapUsd(item) }))
    .sort((a, b) => (b.capUsd ?? -1) - (a.capUsd ?? -1)
      || Number(b.createdTimestamp || 0) - Number(a.createdTimestamp || 0)
      || a.address.localeCompare(b.address)).slice(0, 25);
  const header = '<div class="leaderboard-table-head" role="row"><span>Rank</span><span>Creator</span><span>Market cap</span><span>Launched</span></div>';
  const creatorRankingUnavailable = verifiedLaunchPoliciesStatus !== 'ready' || !exploreFeedAvailable;
  const empty = creatorRankingUnavailable
    ? '<div class="empty-state"><strong>Creator ranking unavailable.</strong><span>The verified launch registry or market feed could not be loaded; an empty ranking is not evidence of zero launches.</span></div>'
    : '<div class="empty-state"><strong>No verified creator launches yet.</strong><span>Launches appear after their policy and mint are confirmed on Solana.</span></div>';
  if (!ranked.length) {
    if (title) title.textContent = creatorRankingUnavailable ? 'Creator ranking unavailable' : EXPLORE_CLUSTER === 'devnet' ? 'No verified Solana launches yet' : 'Leaderboard unavailable on this cluster';
    if (note) note.textContent = creatorRankingUnavailable ? 'Launch registry or market feed unavailable; creator count not verified.' : 'No confirmed creator launches are available to rank.';
    if (badge) badge.textContent = 'Unavailable';
    table.innerHTML = `${header}${empty}`;
    return;
  }
  if (title) title.textContent = `${ranked.length} verified launch${ranked.length === 1 ? '' : 'es'} on Solana`;
  if (note) note.textContent = 'Ranked from confirmed launch policies and available market caps. Missing market data is shown as unavailable.';
  if (badge) badge.textContent = 'RPC verified';
  const avatarClass = index => ['mint', 'lavender', 'coral', 'blue'][index % 4];
  table.innerHTML = `${header}${ranked.map((item, index) => `<div class="leaderboard-row${index === 0 ? ' featured' : ''}" role="row"><span class="rank-number">${String(index + 1).padStart(2, '0')}</span><span class="leader-identity"><span class="leader-avatar ${avatarClass(index)}">${escapeHtml(String(item.symbol || 'T').slice(0, 2))}</span><span><a href="/wallet/${encodeURIComponent(item.creator)}"><strong>${escapeHtml(shortAddress(item.creator))}</strong></a><small>· <a href="/token/${encodeURIComponent(item.address)}">${escapeHtml(item.name || item.symbol || 'Verified launch')}</a></small></span></span><span><b>${item.capUsd == null ? '$—' : escapeHtml(formatDashboardUsd(item.capUsd))}</b><small>${item.capUsd == null ? 'Market data unavailable' : item.migrated === true ? 'Pool MC' : 'Curve MC'}</small></span><span class="leader-value">${item.createdTimestamp ? escapeHtml(formatOnchainAge(Number(item.createdTimestamp) * 1000)) : 'Time unavailable'}</span></div>`).join('')}`;
}
let homeLaunchTab = 'all';
let homeLaunchWindow = '24h';
let homeLaunchSort = 'volume';
let homeLaunchView = 'grid';
let homeLaunchFilters = emptyHomeLaunchFilters();
let homeLaunchPaused = false;
let homeFrozenOrder = null;
let homeTickerRenderKey = '';
let homeTickerCount = 0;
let homeTickerCycleWidth = 0;
let homeTickerFrame = 0;
let homeTickerLastFrame = 0;
let homeTickerPauseUntil = 0;
function setHomeLaunchPaused(paused) {
  homeLaunchPaused = paused;
  homeFrozenOrder = null;
  const button = document.querySelector('#home-feed-pause');
  if (!button) return;
  button.classList.toggle('active', paused);
  button.setAttribute('aria-pressed', String(paused));
  button.setAttribute('aria-label', paused ? 'Resume live reordering' : 'Pause live reordering');
  button.title = paused ? 'Resume live reordering' : 'Pause live reordering';
  button.innerHTML = icon(paused ? 'play' : 'pause');
}
function syncHomeTickerArrows() {
  const ticker = document.querySelector('#home-market-ticker-items');
  if (!ticker) return;
  const back = document.querySelector('#home-ticker-back');
  const forward = document.querySelector('#home-ticker-forward');
  if (back) back.disabled = homeTickerCycleWidth ? false : ticker.scrollLeft <= 1;
  if (forward) forward.disabled = homeTickerCycleWidth ? false : ticker.scrollLeft + ticker.clientWidth >= ticker.scrollWidth - 1;
}
function animateHomeTicker(now) {
  const ticker = document.querySelector('#home-market-ticker-items');
  if (ticker && homeTickerCount && !homeTickerCycleWidth && ticker.clientWidth
    && document.body.classList.contains('page-route-overview')) {
    setupHomeTicker(ticker, homeTickerRenderKey, homeTickerCount, true);
  }
  const elapsed = homeTickerLastFrame ? Math.min(now - homeTickerLastFrame, 64) : 0;
  homeTickerLastFrame = now;
  if (ticker && homeTickerCycleWidth && document.body.classList.contains('page-route-overview')
    && document.visibilityState === 'visible' && now >= homeTickerPauseUntil
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    && !ticker.matches(':hover, :focus-within')) {
    ticker.scrollLeft += elapsed * 0.036;
    if (ticker.scrollLeft >= homeTickerCycleWidth) ticker.scrollLeft -= homeTickerCycleWidth;
  }
  homeTickerFrame = requestAnimationFrame(animateHomeTicker);
}
function setupHomeTicker(ticker, markup, count, force = false) {
  if (!force && homeTickerRenderKey === markup) return;
  const previousPosition = homeTickerCycleWidth ? ticker.scrollLeft % homeTickerCycleWidth : 0;
  homeTickerRenderKey = markup;
  homeTickerCount = count;
  ticker.innerHTML = markup;
  homeTickerCycleWidth = 0;
  if (count) {
    const originals = [...ticker.querySelectorAll(':scope > a')];
    const appendCopy = () => {
      const copy = document.createDocumentFragment();
      originals.forEach(link => {
        const clone = link.cloneNode(true);
        clone.setAttribute('aria-hidden', 'true');
        clone.tabIndex = -1;
        copy.append(clone);
      });
      ticker.append(copy);
    };
    appendCopy();
    homeTickerCycleWidth = ticker.children[count].getBoundingClientRect().left - originals[0].getBoundingClientRect().left;
    let copies = 1;
    while (homeTickerCycleWidth && ticker.scrollWidth - ticker.clientWidth < homeTickerCycleWidth + 1 && copies < 20) {
      appendCopy();
      copies++;
    }
    ticker.scrollLeft = homeTickerCycleWidth ? previousPosition % homeTickerCycleWidth : 0;
    if (!homeTickerFrame) homeTickerFrame = requestAnimationFrame(animateHomeTicker);
  } else if (homeTickerFrame) {
    cancelAnimationFrame(homeTickerFrame);
    homeTickerFrame = 0;
    homeTickerLastFrame = 0;
  }
  loadVerifiedTokenLogos(ticker);
  requestAnimationFrame(syncHomeTickerArrows);
}
const homeHolderCountCache = new Map();
let homeFeeAmounts = new Map();
let homeHolderCountLoading = false;
let homeFeeIndexLoading = false;
async function loadHomeFeeIndex(){
  if (homeFeeIndexLoading || EXPLORE_CLUSTER !== 'devnet') return;
  homeFeeIndexLoading = true;
  try {
    const response = await apiRequest('/api/home/launch-filter-fees', { signal: AbortSignal.timeout(8000) });
    if (!response.available || response.data?.cluster !== EXPLORE_CLUSTER
      || response.data?.coverage !== 'mint-verified-collected-creator-fees-only' || !Array.isArray(response.data.items)) return;
    const amounts = new Map(response.data.items.map(row => [row.mint, String(row.collectedLamports ?? '')]));
    homeFeeAmounts = amounts;
    for (const item of assets) {
      const raw = amounts.get(item.address);
      if (!/^\d+$/.test(raw || '')) continue;
      const lamports = Number(raw);
      if (Number.isSafeInteger(lamports)) item.collectedCreatorFeesSol = lamports / 1_000_000_000;
    }
    renderHomeLaunchBoard();
  } catch { /* Keep the fee filter unavailable when verified ledger data cannot be read. */ }
  finally { homeFeeIndexLoading = false; }
}
async function loadHomeHolderCounts(records){
  if (homeHolderCountLoading || EXPLORE_CLUSTER !== 'devnet' || !Array.isArray(records) || !records.length) return;
  const candidates = records.slice(0, 12).filter(item => item?.address && (item.holders == null || item.holders === '' || !Number.isFinite(Number(item.holders)) || item.topTenHolderPercent == null));
  if (!candidates.length) return;
  homeHolderCountLoading = true;
  try {
    const { PublicKey } = await getSolana();
    const rpc = await getExploreConnection();
    await Promise.all(candidates.map(async item => {
      const creatorWallet = verifiedLaunchPolicyForMint(item.address)?.creatorWallet || null;
      const cached = homeHolderCountCache.get(item.address);
      if (cached && cached.creatorWallet === creatorWallet && Date.now() - cached.at < 300_000) {
        item.holderWalletCount = cached.count;
        item.holderWalletCoverage = cached.coverage;
        item.holderWalletSampledAccounts = cached.sampledAccounts;
        item.topTenHolderPercent = cached.topTenHolderPercent;
        item.devHoldingPercent = cached.devHoldingPercent;
        return;
      }
      try {
        const result = await fetchTokenAccountSample(item.address, rpc, PublicKey);
        const vault = item.migrated === true ? item.pumpSwapBaseVault : item.curveTokenVault;
        const summary = summarizeHolderWalletSample(result, vault, { mintSupplyRaw: item.mintSupplyRaw, creatorWallet });
        if (!summary) return;
        item.holderWalletCount = summary.count;
        item.holderWalletCoverage = summary.coverage;
        item.holderWalletSampledAccounts = summary.sampledAccounts;
        item.topTenHolderPercent = summary.topTenHolderPercent;
        item.devHoldingPercent = summary.devHoldingPercent;
        homeHolderCountCache.set(item.address, { ...summary, creatorWallet, at: Date.now() });
      } catch { /* Keep holder count unavailable when verified wallet owners cannot be read. */ }
    }));
  } finally {
    homeHolderCountLoading = false;
    renderHomeLaunchBoard();
    if (document.body.classList.contains('page-route-explore')) renderExploreAssets();
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
      <span class="home-holder-reward-identity"><strong>${escapeHtml(launch.name || launch.symbol || 'Unnamed coin')}</strong><small>${escapeHtml(launch.symbol || 'TOKEN')}</small></span>
      <span class="home-holder-reward-share"><strong>${escapeHtml(share.toLocaleString(undefined, { maximumFractionDigits: 2 }))}%</strong><small>of collected creator fees</small></span>
      <span class="home-holder-reward-link">View coin →</span>
    </a>
  </li>`).join('');
  loadVerifiedTokenLogos(list);
}
function homeLaunchFeeRouteMarkup(policy){
  if (!policy?.onchainVerified) return '';
  const shares = policy.feeDistribution?.creatorDirected?.shares;
  const creator = verifiedPolicyPercent(shares?.creatorWalletPercent);
  const holders = verifiedPolicyPercent(shares?.holderAirdropPercent);
  const x = verifiedPolicyPercent(shares?.solClaimPercent);
  if ([creator, holders, x].some(value => value == null) || Math.abs(creator + holders + x - 80) > 0.001) return '';
  const xHandle = String(policy.feeDistribution?.creatorDirected?.recipients?.xAccount || '');
  const xName = /^@[A-Za-z0-9_]{1,15}$/.test(xHandle) ? xHandle : 'X partner';
  const recipients = [
    creator > 0 ? `Creator ${formatVerifiedPercent(creator)}` : '',
    holders > 0 ? `Holders ${formatVerifiedPercent(holders)}` : '',
    x > 0 ? `${xName} ${formatVerifiedPercent(x)}` : '',
  ].filter(Boolean);
  const summary = recipients.join(' · ');
  return `<div class="home-launch-fee-route" title="${escapeHtml(summary)}" aria-label="${escapeHtml(summary)}"><span>${recipients.map(escapeHtml).join(' · ')}</span></div>`;
}
function launchCardVolumeUsd(item, window){
  if (EXPLORE_CLUSTER === 'devnet') {
    if (item.windowCoverage === 'complete' && item.windowTradeCount != null && Number(item.windowTradeCount) === 0) return 'No trades';
    if (item.windowVolumeSol == null) return '$—';
    return Number.isFinite(coinSolUsdPrice)
      ? formatDashboardUsd(Number(item.windowVolumeSol) * coinSolUsdPrice, { partial: item.windowCoverage === 'partial' })
      : `${Number(item.windowVolumeSol).toLocaleString(undefined, { maximumFractionDigits: 2 })} SOL`;
  }
  return window === '24h' && item.volume24hUsd != null ? formatDashboardUsd(item.volume24hUsd) : '$—';
}
function homeLaunchCardMarkup(item, { volumeLabel, volumeValue, extraClass = '' }){
    const change = item.change || '—';
    const changeValue = Number.parseFloat(change);
    const changeClass = Number.isFinite(changeValue) ? (changeValue >= 0 ? 'is-positive' : 'is-negative') : '';
    const progressValue = item.complete === true ? 100 : Number.isFinite(Number(item.curveProgressPercent)) ? Math.max(0, Math.min(100, Number(item.curveProgressPercent))) : 0;
    const progressLabel = item.complete === true ? 'Migrated' : progressValue > 0 ? `${Math.round(progressValue)}% filled` : 'On curve';
    const capSol = item.migrated === true ? item.poolMarketCapSol : item.curveCapSol;
    const capLabel = item.migrated === true ? 'Market cap' : 'Curve cap';
    const hasNoObservedTrades = item.windowCoverage === 'complete' && item.windowTradeCount != null && Number(item.windowTradeCount) === 0;
    const shownVolume = volumeValue;
    const value = EXPLORE_CLUSTER === 'devnet' ? formatCoinUsd(capSol) : item.marketCapUsd != null ? formatCompactUsd(item.marketCapUsd) : '—';
    const providerHolders = item.holders == null || item.holders === '' ? NaN : Number(item.holders);
    const accountHolders = item.holderWalletCount == null || item.holderWalletCount === '' ? NaN : Number(item.holderWalletCount);
    const holderCount = Number.isFinite(providerHolders) && providerHolders >= 0
      ? providerHolders.toLocaleString()
      : Number.isFinite(accountHolders) && accountHolders >= 0 ? `${item.holderWalletCoverage === 'lower-bound' ? '≥' : ''}${accountHolders.toLocaleString()}` : '—';
    const holderTitle = Number.isFinite(providerHolders)
      ? 'Holder count from the indexed market provider'
      : Number.isFinite(accountHolders) ? `${item.holderWalletCoverage === 'lower-bound' ? 'At least ' : ''}${accountHolders} distinct wallet owner${accountHolders === 1 ? '' : 's'} in confirmed non-vault token accounts${item.holderWalletCoverage === 'lower-bound' ? ' · largest-account sample only' : ''}` : 'Verified holder count unavailable';
    const launchPolicy = verifiedLaunchPolicyForMint(item.address);
    const mintLabel = item.address ? `${item.address.slice(0, 5)}…${item.address.slice(-4)}` : 'Unavailable';
    const creatorWallet = launchPolicy?.onchainVerified && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(launchPolicy.creatorWallet || '')
      ? launchPolicy.creatorWallet : '';
    const creatorLabel = creatorWallet ? `${creatorWallet.slice(0, 5)}…${creatorWallet.slice(-4)}` : '';
    const feeRoute = homeLaunchFeeRouteMarkup(launchPolicy);
    const boost = verifiedBoosts[item.address];
    const boostMultiplier = activeBoostMultiplier(boost);
    const activeBoost = boostMultiplier > 0;
    const boostPaymentCount = activeBoostPackages(boost).length;
    return `<article class="token-card-shell home-launch-card${extraClass}" data-mint="${escapeHtml(item.address || '')}" data-logo-mint="${escapeHtml(item.address || '')}">
      <a class="home-launch-card-link" href="/token/${encodeURIComponent(item.address || '')}" aria-label="Open ${escapeHtml(item.name || item.symbol || 'token')} token details"></a>
      <div class="home-launch-card-media"><span class="home-token-avatar">${escapeHtml(item.icon || String(item.symbol || 'T').slice(0, 1))}</span>${exploreSocialLinksMarkup(item)}${tokenCardWatchMarkup(item.address, item.symbol)}<span class="home-launch-media-stage">${escapeHtml(exploreStageLabel(item))}</span><div class="home-launch-media-badges"><span class="home-launch-media-package"></span>${activeBoost ? `<span class="home-launch-media-boost" title="${escapeHtml(`${boostPaymentCount} verified boost payment${boostPaymentCount === 1 ? '' : 's'} · active until ${new Date(boost.expiresAt).toLocaleString()}`)}">${escapeHtml(String(boostMultiplier))}x · ${escapeHtml(String(boostPaymentCount))} paid${boostMultiplier >= 500 ? ' ★' : ''}</span>` : ''}</div></div>
      <div class="home-launch-card-top">
        <span class="home-token-identity"><strong class="${activeBoost && boostMultiplier >= 500 ? 'golden-ticker' : ''}">${escapeHtml(item.symbol || 'TOKEN')}</strong>${exploreBoostAmountMarkup(item.address)}<small>${escapeHtml(item.name || 'Unnamed token')}</small></span>
        <div class="home-launch-card-addresses"><span title="Token contract: ${escapeHtml(item.address || '')}"><small>CA</small><code>${escapeHtml(mintLabel)}</code><button type="button" class="home-launch-copy-address" data-copy-address="${escapeHtml(item.address || '')}" data-copy-kind="token" aria-label="Copy full token address" title="Copy full token address">${icon('copy')}</button></span>${creatorWallet ? `<span title="Verified launch creator: ${escapeHtml(creatorWallet)}"><small>Creator</small><code>${escapeHtml(creatorLabel)}</code><button type="button" class="home-launch-copy-address" data-copy-address="${escapeHtml(creatorWallet)}" data-copy-kind="creator" aria-label="Copy full creator wallet address" title="Copy full creator wallet address">${icon('copy')}</button></span>` : ''}</div>
        ${feeRoute}
      </div>
      <div class="home-launch-card-stats">
        <span><small>${EXPLORE_CLUSTER === 'devnet' ? capLabel : 'Market cap'}</small><strong>${escapeHtml(value)}</strong></span>
        <span><small>${escapeHtml(volumeLabel)} volume</small><strong>${escapeHtml(shownVolume)}</strong></span>
        <span title="${escapeHtml(holderTitle)}"><small>Holders</small><strong>${escapeHtml(holderCount)}</strong></span>
        <span class="home-launch-change ${changeClass}"><small>24h change</small><strong>${escapeHtml(hasNoObservedTrades ? 'No trades' : change)}</strong></span>
      </div>
      <div class="home-launch-progress" aria-label="${escapeHtml(progressLabel)}"><i style="--launch-progress:${progressValue}%"></i></div>
      <div class="home-launch-meta"><span>${escapeHtml(formatOnchainAge(Number(item.createdTimestamp || 0) * 1000))}</span><span>${escapeHtml(progressLabel)}</span></div>
      <div class="home-launch-card-actions">${tokenCardShareMarkup(item.address, item.symbol, item.name)}<button type="button" data-boost-mint="${escapeHtml(item.address || '')}">Boost</button></div>
    </article>`;
}
function decorateHomeLaunchCard(card, mint){
  const packageBadge = card.querySelector('.home-launch-media-package');
  const promotion = promotionElement(mint, true);
  if (promotion) {
    const launchPromotion = promotionForMint(mint);
    if (launchPromotion?.tier === 'boost') promotion.textContent = `Boost · ${launchPromotion.amountTokens.toLocaleString()} $FUNDED`;
    packageBadge?.append(promotion);
  } else if (verifiedLaunchPolicyForMint(mint)?.onchainVerified) {
    const standard = document.createElement('span');
    standard.className = 'home-launch-package-standard';
    standard.textContent = 'Standard';
    standard.title = 'Standard launch package · verified policy, no paid launch promotion';
    packageBadge?.append(standard);
  } else packageBadge?.remove();
}
function renderHomeLaunchBoard(){
  const grid = document.querySelector('#home-launch-grid');
  if (!grid) return;
  const tableWrap = document.querySelector('#home-launch-table-wrap');
  const tableBody = document.querySelector('#home-launch-table-body');
  grid.hidden = homeLaunchView === 'table';
  if (tableWrap) tableWrap.hidden = homeLaunchView !== 'table';
  const feedState = document.querySelector('#home-feed-state');
  if (feedState) {
    feedState.textContent = exploreFeedAvailable ? `Feed available`
      : exploreLastVerifiedAt ? 'Last verified snapshot' : 'Feed unavailable';
    feedState.dataset.state = exploreFeedAvailable ? 'live' : exploreLastVerifiedAt ? 'snapshot' : 'unavailable';
  }
  const tickerLabel = document.querySelector('#home-market-ticker-label');
  if (tickerLabel) tickerLabel.textContent = 'All verified launches';
  const volumeFilterLabel = document.querySelector('#home-filter-volume-label');
  if (volumeFilterLabel?.firstChild) volumeFilterLabel.firstChild.textContent = `${homeLaunchWindow} Vol `;
  const tradesFilterLabel = document.querySelector('#home-filter-trades-label');
  if (tradesFilterLabel) tradesFilterLabel.textContent = `${homeLaunchWindow} TXs`;
  if (EXPLORE_CLUSTER !== 'devnet') document.querySelectorAll('[data-home-window]').forEach(button => {
    button.disabled = button.dataset.homeWindow !== '24h';
    if (button.disabled) button.title = 'Shorter indexed volume windows are unavailable on this feed';
  });
  const verified = assets.filter(item => verifiedLaunchPolicyForMint(item.address))
    .map(item => {
      const raw = homeFeeAmounts.get(item.address);
      const lamports = /^\d+$/.test(raw || '') ? Number(raw) : NaN;
      if (Number.isSafeInteger(lamports)) item.collectedCreatorFeesSol = lamports / 1_000_000_000;
      return withVerifiedExploreBenefits(EXPLORE_CLUSTER === 'devnet' ? withMarketWindow(item, homeLaunchWindow) : item);
    });
  const volumeRank = item => {
    const observed = EXPLORE_CLUSTER === 'devnet' ? item.windowVolumeSol : homeLaunchWindow === '24h' ? item.volume24hUsd : null;
    if (observed == null || observed === '') return -1;
    const value = Number(observed);
    return Number.isFinite(value) && value >= 0 ? value : -1;
  };
  const capUsd = item => {
    const capSol = item.migrated === true ? item.poolMarketCapSol : item.curveCapSol;
    const observed = EXPLORE_CLUSTER === 'devnet'
      ? capSol == null || !Number.isFinite(coinSolUsdPrice) ? null : Number(capSol) * coinSolUsdPrice
      : item.marketCapUsd;
    const value = observed == null || observed === '' ? NaN : Number(observed);
    return Number.isFinite(value) && value >= 0 ? value : -1;
  };
  const volumeUsd = item => launchCardVolumeUsd(item, homeLaunchWindow);
  const ticker = document.querySelector('#home-market-ticker-items');
  const tableVolumeHeading = document.querySelector('#home-table-volume-heading');
  const tableTxnsHeading = document.querySelector('#home-table-txns-heading');
  const tableMcHeading = document.querySelector('#home-table-mc-heading');
  if (tableMcHeading) tableMcHeading.setAttribute('aria-sort', homeLaunchSort === 'market-cap' ? 'descending' : 'none');
  const pauseButton = document.querySelector('#home-feed-pause');
  if (pauseButton) {
    pauseButton.disabled = homeLaunchSort === 'market-cap';
    if (pauseButton.disabled) pauseButton.title = 'Market-cap order is static';
  }
  if (tableVolumeHeading) {
    tableVolumeHeading.textContent = 'Volume';
    tableVolumeHeading.title = `${homeLaunchWindow} observed volume`;
  }
  if (tableTxnsHeading) {
    tableTxnsHeading.textContent = 'Txns';
    tableTxnsHeading.title = `${homeLaunchWindow} observed transactions`;
  }
  if (ticker) {
    const ranked = [...verified]
      .sort((a, b) => volumeRank(b) - volumeRank(a)).slice(0, 6);
    const tickerMarkup = ranked.length ? ranked.map((item, index) => {
      const currentCap = capUsd(item);
      const marketCap = currentCap >= 0 ? formatCompactUsd(currentCap) : '$—';
      const changeValue = EXPLORE_CLUSTER === 'devnet' ? item.windowPriceChangePercent : item.priceChange24hPercent;
      const hasChange = changeValue != null && Number.isFinite(Number(changeValue));
      const change = hasChange ? `${Number(changeValue) >= 0 ? '+' : ''}${Number(changeValue).toFixed(2)}%` : '—%';
      const trendClass = hasChange ? Number(changeValue) >= 0 ? 'is-positive' : 'is-negative' : '';
      const symbol = item.symbol || 'TOKEN';
      const boostPacks = activeBoostPackages(verifiedBoosts[item.address]).map(pack => pack.packageId);
      const detail = `${symbol}${boostPacks.length ? ` · active boost packs ${boostPacks.join(', ')}` : ''} · ${homeLaunchWindow} market-cap change ${change} · ${item.migrated === true ? 'pool' : 'curve'} MC ${marketCap}`;
      return `<a href="/token/${encodeURIComponent(item.address || '')}" data-logo-mint="${escapeHtml(item.address || '')}" aria-label="${escapeHtml(detail)}" title="${escapeHtml(detail)}"><span class="home-ticker-rank" aria-hidden="true">${index + 1}</span><span class="home-token-avatar" aria-hidden="true">${escapeHtml(item.icon || String(symbol).slice(0, 1))}</span><strong class="${activeBoostMultiplier(verifiedBoosts[item.address]) >= 500 ? 'golden-ticker' : ''}">${escapeHtml(symbol)}</strong>${exploreBoostAmountMarkup(item.address)}<span class="home-ticker-change ${trendClass}" title="${escapeHtml(homeLaunchWindow)} market-cap change">${escapeHtml(change)}</span><small class="home-ticker-mc">MC ${escapeHtml(marketCap)}</small></a>`;
    }).join('') : `<span class="home-ticker-empty">${exploreFeedAvailable ? `No verified ${escapeHtml(homeLaunchWindow)} trades in this feed` : 'Checking verified market activity'}</span>`;
    setupHomeTicker(ticker, tickerMarkup, ranked.length);
  }
  let visible = [...verified];
  if (homeLaunchTab === 'curve') visible = visible.filter(item => item.migrated !== true && item.complete === false);
  else if (homeLaunchTab === 'migrated') visible = visible.filter(item => item.migrated === true);
  else if (homeLaunchTab === 'watchlist') visible = visible.filter(item => getWatchlist().includes(item.address));
  else if (homeLaunchTab === 'promoted') visible = visible.filter(item => Boolean(promotionForMint(item.address) || verifiedBoosts[item.address]));
  else if (homeLaunchTab === 'boost') visible = visible.filter(item => promotionForMint(item.address)?.tier === 'boost' || Boolean(verifiedBoosts[item.address]));
  else if (['standard', 'pro', 'premier'].includes(homeLaunchTab)) visible = visible.filter(item => (promotionForMint(item.address)?.tier || 'standard') === homeLaunchTab && !verifiedBoosts[item.address]);
  visible = visible.filter(item => matchesHomeLaunchFilters(item, homeLaunchFilters, { cluster: EXPLORE_CLUSTER, solUsdPrice: coinSolUsdPrice }));
  visible.sort((a, b) => (homeLaunchSort === 'market-cap' ? capUsd(b) - capUsd(a)
    : (verifiedBoosts[b.address]?.multiplier || 0) - (verifiedBoosts[a.address]?.multiplier || 0) || volumeRank(b) - volumeRank(a))
    || Number(b.createdTimestamp || 0) - Number(a.createdTimestamp || 0));
  if (homeLaunchPaused) {
    if (!homeFrozenOrder) homeFrozenOrder = visible.map(item => item.address);
    const frozenRank = new Map(homeFrozenOrder.map((mint, index) => [mint, index]));
    visible.sort((a, b) => (frozenRank.get(a.address) ?? Infinity) - (frozenRank.get(b.address) ?? Infinity));
  }
  // Show every verified launch; the volume window only changes metrics and ordering.
  const boardCount = document.querySelector('#home-board-count');
  if (boardCount) boardCount.textContent = visible.length ? `Showing ${visible.length} verified coin${visible.length === 1 ? '' : 's'}` : '';
  if (!visible.length) {
    const feedUnavailable = (!exploreFeedAvailable && !exploreLastVerifiedAt)
      || /RPC (?:rate limited|unavailable)/i.test(exploreProviderStatus);
    const title = feedUnavailable ? 'Launch feed unavailable.' : homeLaunchTab === 'watchlist' ? 'No watched launches yet.' : homeLaunchFilterCount(homeLaunchFilters) ? 'No launches match these filters.' : 'No verified launches in this view.';
    const detail = feedUnavailable ? 'Current Solana mint and market checks could not finish. Recorded reward and airdrop policies remain visible in their own sections.' : homeLaunchTab === 'watchlist' ? 'Save a verified mint from Explore to see it here.' : 'Try another view or adjust the filters.';
    grid.innerHTML = `<div class="empty-state"><strong>${title}</strong><span>${detail}</span>${feedUnavailable ? '<button type="button" class="secondary-button" data-verified-feed-retry>Retry verification</button>' : ''}</div>`;
    if (tableBody) tableBody.innerHTML = `<tr><td colspan="7" class="home-table-empty"><strong>${title}</strong><span>${detail}</span>${feedUnavailable ? '<button type="button" class="secondary-button" data-verified-feed-retry>Retry verification</button>' : ''}</td></tr>`;
    return;
  }
  if (tableBody) {
    tableBody.innerHTML = visible.map(item => {
      const capSol = item.migrated === true ? item.poolMarketCapSol : item.curveCapSol;
      const cap = EXPLORE_CLUSTER === 'devnet' ? formatCoinUsd(capSol) : item.marketCapUsd != null ? formatCompactUsd(item.marketCapUsd) : '—';
      const tier = promotionForMint(item.address)?.tier || 'standard';
      const change = item.change || '—';
      const changeValue = Number.parseFloat(change);
      const trendClass = Number.isFinite(changeValue) ? changeValue >= 0 ? 'is-positive' : 'is-negative' : '';
      const observedTrades = EXPLORE_CLUSTER === 'devnet' ? item.windowTradeCount : item.tradeCount24h;
      const trades = observedTrades != null && Number.isInteger(Number(observedTrades)) && Number(observedTrades) >= 0
        ? `${EXPLORE_CLUSTER === 'devnet' && item.windowCoverage === 'partial' ? '≥' : ''}${Number(observedTrades).toLocaleString()}` : '—';
      const progress = item.curveProgressPercent == null ? NaN : Number(item.curveProgressPercent);
      const curve = item.migrated === true ? 'Migrated' : item.complete === true ? 'Graduated'
        : Number.isFinite(progress) ? `${Math.round(Math.max(0, Math.min(100, progress)))}%` : '—';
      const shownChange = change;
      return `<tr><td><a class="home-table-coin" data-logo-mint="${escapeHtml(item.address || '')}" href="/token/${encodeURIComponent(item.address || '')}"><span class="home-token-avatar" aria-hidden="true">${escapeHtml(item.icon || String(item.symbol || 'T').slice(0, 1))}</span><span><strong>${escapeHtml(item.symbol || 'TOKEN')}</strong>${exploreBoostAmountMarkup(item.address)}<small>${escapeHtml(item.name || 'Unnamed token')}</small></span></a></td><td><span class="home-table-tier" data-tier="${tier}">${escapeHtml(tier)}</span></td><td>${escapeHtml(cap)}</td><td>${escapeHtml(volumeUsd(item))}</td><td>${escapeHtml(trades)}</td><td class="${trendClass}">${escapeHtml(shownChange)}</td><td><span class="home-table-curve">${escapeHtml(curve)}</span></td></tr>`;
    }).join('');
    loadVerifiedTokenLogos(tableBody);
  }
  grid.innerHTML = visible.map(item => homeLaunchCardMarkup(item, { volumeLabel: homeLaunchWindow, volumeValue: volumeUsd(item) })).join('');
  grid.querySelectorAll('.home-launch-card').forEach((card, index) => decorateHomeLaunchCard(card, visible[index]?.address));
  loadVerifiedTokenLogos(grid);
}
document.querySelectorAll('[data-home-launch-tab]').forEach(button => button.addEventListener('click', () => {
  homeLaunchTab = button.dataset.homeLaunchTab || 'all';
  homeFrozenOrder = null;
  document.querySelectorAll('[data-home-launch-tab]').forEach(item => { const active = item === button; item.classList.toggle('active', active); item.setAttribute('aria-selected', String(active)); });
  renderHomeLaunchBoard();
}));
for (const [selector, property] of [['[data-home-window]', 'homeWindow'], ['[data-home-sort]', 'homeSort'], ['[data-home-view]', 'homeView']]) {
  document.querySelectorAll(selector).forEach(button => button.addEventListener('click', () => {
    const value = button.dataset[property];
    if (property === 'homeWindow') homeLaunchWindow = value;
    else if (property === 'homeSort') {
      homeLaunchSort = value;
      if (value === 'market-cap') setHomeLaunchPaused(false);
    }
    else homeLaunchView = value;
    if (property !== 'homeView') homeFrozenOrder = null;
    document.querySelectorAll(selector).forEach(item => {
      const active = item === button;
      item.classList.toggle('active', active);
      item.setAttribute('aria-pressed', String(active));
    });
    renderHomeLaunchBoard();
  }));
}
const homeFilterPopup = document.querySelector('.home-feed-settings');
const homeFilterForm = document.querySelector('#home-launch-filter-form');
const HOME_FILTER_PRESETS_KEY = 'funded.home.launch-filters.v1';
function readHomeFilterForm() {
  const ranges = Object.fromEntries(HOME_FILTER_RANGES.map(name => [name, Object.fromEntries(['min', 'max'].map(bound => {
    const raw = homeFilterForm?.querySelector(`[data-home-range="${name}"][data-home-bound="${bound}"]`)?.value;
    return [bound, raw === '' || raw == null ? null : Number(raw)];
  }))]));
  return normalizeHomeLaunchFilters({
    query: document.querySelector('#home-filter-search')?.value || '',
    flags: [...(homeFilterForm?.querySelectorAll('[data-home-filter-flag]:checked') || [])].map(input => input.dataset.homeFilterFlag),
    ranges,
  });
}
function writeHomeFilterForm(value) {
  const filters = normalizeHomeLaunchFilters(value);
  const search = document.querySelector('#home-filter-search');
  if (search) search.value = filters.query;
  homeFilterForm?.querySelectorAll('[data-home-filter-flag]').forEach(input => {
    input.checked = filters.flags.includes(input.dataset.homeFilterFlag);
  });
  for (const name of HOME_FILTER_RANGES) for (const bound of ['min', 'max']) {
    const input = homeFilterForm?.querySelector(`[data-home-range="${name}"][data-home-bound="${bound}"]`);
    if (input) input.value = filters.ranges[name][bound] ?? '';
  }
}
function syncHomeFilterIndicator() {
  const count = homeLaunchFilterCount(homeLaunchFilters);
  homeFilterPopup?.toggleAttribute('data-active-filters', count > 0);
  const badge = document.querySelector('#home-filter-active-count');
  if (badge) badge.textContent = String(count);
}
function applyHomeFilterForm(value) {
  homeLaunchFilters = normalizeHomeLaunchFilters(value);
  homeFrozenOrder = null;
  syncHomeFilterIndicator();
  renderHomeLaunchBoard();
}
function showHomeFilterView(view) {
  const saved = view === 'saved';
  if (homeFilterForm) homeFilterForm.hidden = saved;
  const savedPanel = document.querySelector('#home-filter-saved');
  if (savedPanel) savedPanel.hidden = !saved;
  document.querySelectorAll('[data-home-filter-view]').forEach(button => {
    const active = button.dataset.homeFilterView === view;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
}
function readHomeFilterPresets() {
  try {
    const value = JSON.parse(localStorage.getItem(HOME_FILTER_PRESETS_KEY) || '[]');
    return Array.isArray(value) ? value.filter(item => item && typeof item.name === 'string' && item.name.trim())
      .slice(0, 10).map(item => ({ name: item.name.trim().slice(0, 40), filters: normalizeHomeLaunchFilters(item.filters) })) : [];
  } catch { return []; }
}
function renderHomeFilterPresets() {
  const list = document.querySelector('#home-filter-saved-list');
  if (!list) return;
  const presets = readHomeFilterPresets();
  list.innerHTML = presets.length ? presets.map((item, index) => `<div class="home-filter-preset"><span title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span><div class="home-filter-preset-actions"><button type="button" data-home-preset-load="${index}" aria-label="Apply ${escapeHtml(item.name)}">Apply</button><button type="button" data-home-preset-delete="${index}" aria-label="Delete ${escapeHtml(item.name)}">×</button></div></div>`).join('')
    : '<p class="home-feed-settings-note">No saved filters yet.</p>';
}
homeFilterPopup?.addEventListener('toggle', () => {
  if (homeFilterPopup.open) { writeHomeFilterForm(homeLaunchFilters); showHomeFilterView('current'); }
});
document.querySelector('#home-filter-close')?.addEventListener('click', () => { homeFilterPopup.open = false; });
document.querySelectorAll('[data-home-filter-view]').forEach(button => button.addEventListener('click', () => showHomeFilterView(button.dataset.homeFilterView)));
homeFilterForm?.addEventListener('submit', event => {
  event.preventDefault();
  applyHomeFilterForm(readHomeFilterForm());
  homeFilterPopup.open = false;
});
document.querySelector('#home-filter-reset')?.addEventListener('click', () => {
  writeHomeFilterForm(emptyHomeLaunchFilters());
  applyHomeFilterForm(emptyHomeLaunchFilters());
});
document.querySelector('#home-filter-save-open')?.addEventListener('click', () => {
  showHomeFilterView('saved');
  document.querySelector('#home-filter-preset-name')?.focus();
});
document.querySelector('#home-filter-save')?.addEventListener('click', () => {
  const input = document.querySelector('#home-filter-preset-name');
  const name = input?.value.trim().slice(0, 40);
  if (!name) { input?.focus(); return; }
  const presets = readHomeFilterPresets().filter(item => item.name.toLowerCase() !== name.toLowerCase());
  presets.unshift({ name, filters: readHomeFilterForm() });
  try { localStorage.setItem(HOME_FILTER_PRESETS_KEY, JSON.stringify(presets.slice(0, 10))); } catch {}
  input.value = '';
  renderHomeFilterPresets();
});
document.querySelector('#home-filter-saved-list')?.addEventListener('click', event => {
  const load = event.target.closest('[data-home-preset-load]');
  const remove = event.target.closest('[data-home-preset-delete]');
  if (!load && !remove) return;
  const presets = readHomeFilterPresets();
  const index = Number((load || remove).dataset[load ? 'homePresetLoad' : 'homePresetDelete']);
  if (!Number.isInteger(index) || !presets[index]) return;
  if (load) {
    writeHomeFilterForm(presets[index].filters);
    applyHomeFilterForm(presets[index].filters);
    homeFilterPopup.open = false;
  } else {
    presets.splice(index, 1);
    try { localStorage.setItem(HOME_FILTER_PRESETS_KEY, JSON.stringify(presets)); } catch {}
    renderHomeFilterPresets();
  }
});
document.addEventListener('pointerdown', event => {
  if (homeFilterPopup?.open && !homeFilterPopup.contains(event.target)) homeFilterPopup.open = false;
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && homeFilterPopup?.open) homeFilterPopup.open = false;
});
renderHomeFilterPresets();
syncHomeFilterIndicator();
document.querySelector('#home-feed-pause')?.addEventListener('click', () => {
  setHomeLaunchPaused(!homeLaunchPaused);
  renderHomeLaunchBoard();
});
document.querySelector('#home-table-sort-mc')?.addEventListener('click', () => {
  document.querySelector('[data-home-sort="market-cap"]')?.click();
});
document.querySelector('#home-market-ticker-items')?.addEventListener('scroll', syncHomeTickerArrows, { passive: true });
document.querySelector('#home-market-ticker-items')?.addEventListener('pointerdown', () => {
  homeTickerPauseUntil = performance.now() + 3000;
});
for (const [id, direction] of [['home-ticker-back', -1], ['home-ticker-forward', 1]]) {
  document.querySelector(`#${id}`)?.addEventListener('click', () => {
    const ticker = document.querySelector('#home-market-ticker-items');
    if (!ticker) return;
    homeTickerPauseUntil = performance.now() + 2000;
    const distance = direction * Math.max(180, ticker.clientWidth * .7);
    if (homeTickerCycleWidth) ticker.scrollLeft = ((ticker.scrollLeft + distance) % homeTickerCycleWidth + homeTickerCycleWidth) % homeTickerCycleWidth;
    else ticker.scrollBy({ left: distance, behavior: 'smooth' });
  });
}
window.addEventListener('resize', () => {
  const ticker = document.querySelector('#home-market-ticker-items');
  if (ticker && homeTickerCount) setupHomeTicker(ticker, homeTickerRenderKey, homeTickerCount, true);
  syncHomeTickerArrows();
});
let exploreLoadInFlight = null;
async function loadOnchainExploreData(signal){
  if (exploreLoadInFlight) return exploreLoadInFlight;
  const requestedSort = exploreSort;
  const load = loadOnchainExploreDataOnce(signal, requestedSort);
  exploreLoadInFlight = load;
  try { return await load; }
  finally {
    if (exploreLoadInFlight === load) exploreLoadInFlight = null;
    if (requestedSort !== exploreSort && !signal?.aborted) void loadOnchainExploreData(signal).catch(() => {});
  }
}
async function loadOnchainExploreDataOnce(signal, requestedSort){
    const pumpSort = requestedSort === 'newest' ? 'created_timestamp' : 'last_trade_timestamp';
    const birdeyeSort = requestedSort === 'change' ? 'price_change_24h_percent' : requestedSort === 'market-cap' ? 'market_cap' : 'volume_24h_usd';
    const feeds = [
      Promise.resolve({ available: false, data: null }),
      apiRequest(`/api/pump/explore?limit=40&sort=${encodeURIComponent(pumpSort)}`, { signal }).catch(() => ({ available: false, data: null })),
    ];
    if (EXPLORE_CLUSTER !== 'devnet') feeds[0] = apiRequest(`/api/birdeye/explore?limit=40&sort_by=${encodeURIComponent(birdeyeSort)}`, { signal }).catch(() => ({ available: false, data: null }));
    const [birdeyeFeed, pumpFeed] = await Promise.all(feeds);
    signal?.throwIfAborted();
    if (EXPLORE_CLUSTER === 'devnet' && verifiedLaunchPoliciesStatus !== 'ready') await loadVerifiedLaunchPolicies(signal);
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
        source: verifiedPaidListingPayment(pump) ? 'Paid listing · mint verified' : market ? 'Pump.fun + Birdeye' : EXPLORE_CLUSTER === 'devnet' ? 'Verified Solana registry' : 'Pump.fun',
        fetchedAt: market ? birdeyeFeed.data?.fetchedAt : pumpFeed.data?.fetchedAt,
      };
    });
    const verified = [];
    let exploreVerificationFailed = false;
    let exploreRateLimited = false;
    if (records.length) {
      try {
        const { PublicKey, getAssociatedTokenAddressSync, unpackAccount, unpackMint, NATIVE_MINT, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } = await getSolana();
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
            const curveTokenVault = curve ? getAssociatedTokenAddressSync(mint, bondingCurvePda(mint), true, mintAccount.owner).toBase58() : null;
            verified.push({ mint: record.address, symbol: record.symbol || 'TOKEN', name: record.name || 'Unnamed token', value: EXPLORE_CLUSTER === 'devnet' && curveMetrics.curvePriceSol != null ? `MC · ${formatCoinUsd(curveMetrics.curveCapSol)}` : Number.isFinite(marketCap) ? `MC · ${formatUsd(marketCap)}` : 'MC unavailable', change: Number.isFinite(change) ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}%` : '—', meta: Number.isFinite(marketCap) ? `MC ${formatCompactUsd(marketCap)} · ${record.source || 'Pump.fun'}` : (record.source || 'Pump.fun'), icon: String(record.symbol || 'T').slice(0, 1), source: record.source || 'Pump.fun', listingPayment: record.listingPayment || null, creator: record.creator || null, website: record.website || null, twitter: record.twitter || record.x || null, telegram: record.telegram || null, discord: record.discord || null, complete: curve ? Boolean(curve.complete) : null, migrated: null, pumpSwapPool: null, quoteMint: curve?.quoteMint?.toBase58?.() || null, bondingCurve: curve ? bondingCurvePda(mint).toBase58() : null, curveTokenVault, raydiumPool: record.raydiumPool || null, fetchedAt: record.fetchedAt || null, verifiedAt: new Date().toISOString(), address: record.address, mintSupplyRaw: mintState.supply.toString(), mintDecimals: mintState.decimals, mintAuthorityRevoked: mintState.mintAuthority == null, freezeAuthorityRevoked: mintState.freezeAuthority == null, volume24hUsd: record.volume24hUsd ?? null, liquidityUsd: record.liquidityUsd ?? null, holders: record.holders ?? null, marketCapUsd: Number.isFinite(marketCap) ? marketCap : null, priceChange24hPercent: Number.isFinite(change) ? change : null, createdTimestamp: record.createdTimestamp || null, lastTradeUnixTime: record.lastTradeUnixTime || null, ...curveMetrics });
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
                    if (metrics.poolPriceSol != null) item.value = `MC · ${formatCoinUsd(metrics.poolMarketCapSol)}`;
                  } catch {}
                });
              }
           } catch { /* A failed pool lookup leaves migration unverified. */ }
         }
      } catch (error) { exploreVerificationFailed = true; exploreRateLimited = /429|rate.?limit|too many requests/i.test(String(error?.message || '')); }
    }
    signal?.throwIfAborted();
    if (requestedSort !== exploreSort) return;
    if (exploreRateLimited) exploreBackoffUntil = Date.now() + 60_000;
    else if (!exploreVerificationFailed) exploreBackoffUntil = 0;
    if ((exploreVerificationFailed || !pumpFeed.available) && assets.length && exploreLastVerifiedAt) {
      publishVerifiedCurves([]);
      exploreUpdatedAt = new Date().toISOString();
      const cause = exploreVerificationFailed ? `Solana RPC ${exploreRateLimited ? 'rate limited' : 'unavailable'}` : 'Launch feed unavailable';
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
        const hasBreakdown = data => data && Object.hasOwn(data, 'observedCoverage') && (data.tradeCount24h == null || (data.activityWindows?.['1h']
          && data.activityWindows?.['6h'] && data.activityWindows?.['24h']
          && Number.isInteger(data.buyCount24h) && Number.isInteger(data.sellCount24h)));
        let market = cached && Date.now() - cached.at < 60_000 && hasBreakdown(cached.data) ? cached.data : null;
        if (!market) {
          const response = await apiRequest(`/api/tokens/${encodeURIComponent(item.address)}/market-activity`, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000) }).catch(error => {
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
        const observedVolume = Number(market.observedVolumeSol);
        item.observedVolumeSol = market.observedVolumeSol != null && Number.isFinite(observedVolume) && observedVolume >= 0 ? observedVolume : null;
        item.observedCoverage = market.observedCoverage || 'unavailable';
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
    signal?.throwIfAborted();
    if (requestedSort !== exploreSort) return;
    exploreScannedCount = scannedCount;
    if (marketScanRateLimited) exploreBackoffUntil = Date.now() + 60_000;
  assets = includeVerifiedRegistryLaunches(Array.from(new Map(verified.map(item => [item.address, item])).values()), records);
    publishVerifiedCurves(assets);
    document.dispatchEvent(new Event('funded:verified-search-index'));
    exploreUpdatedAt = new Date().toISOString();
    if (!exploreVerificationFailed && pumpFeed.available && records.length) exploreLastVerifiedAt = exploreUpdatedAt;
    exploreProviderStatus = EXPLORE_CLUSTER === 'devnet' && assets.length && verified.length < assets.length
      ? `Verified launch registry · ${verified.length ? `${verified.length}/${assets.length} live mint checks` : 'live mint checks unavailable'}`
      : exploreVerificationFailed ? `Solana RPC ${exploreRateLimited ? 'rate limited · retry shortly' : 'unavailable'}` : !pumpFeed.available ? 'Launch feed unavailable' : !records.length ? 'No indexed launches · awaiting RPC verification' : !verified.length ? 'Indexed launches · none passed RPC verification' : EXPLORE_CLUSTER === 'devnet' ? `Solana registry · RPC verified${marketScanRateLimited ? ' · trade history rate limited' : ''}` : !birdeyeFeed.available ? `Pump.fun · Birdeye unavailable · RPC verified` : 'Pump.fun + Birdeye · RPC verified';
    const feedStatus = document.querySelector('#explore-data-status');
    renderExploreAssets();
    renderHomeLaunchBoard();
    renderCreatorLaunches();
    renderPortfolio();
    void loadHomeHolderCounts(assets);
    void loadHomeFeeIndex();
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
if (exploreInitialLoadStarted) loadOnchainExploreData().catch(error => {
  console.error('Verified launch feed failed:', error);
  exploreProviderStatus = 'Launch feed unavailable';
  const grid = document.querySelector('#asset-grid');
  if (grid) grid.innerHTML = '<div class="empty-state">Verified launches could not be loaded. Refresh to try again.</div>';
  const status = document.querySelector('#home-live-status');
  const note = document.querySelector('#home-verified-launches-note');
  if (status) status.textContent = 'Solana RPC · unavailable';
  if (note) note.textContent = 'Unable to verify live data';
});
createRoutePoller({ run: signal => loadOnchainExploreData(signal), active: () => !coinRouteRequested() && ['overview', 'explore', 'community', 'leaderboard'].includes(requestedPageRoute()) && exploreAutoRefresh && Date.now() >= exploreBackoffUntil, intervalMs: 30_000 });
createRoutePoller({ run: () => renderStonkEnhancements(), active: () => !coinRouteRequested() && requestedPageRoute() === 'explore' && exploreAutoRefresh, intervalMs: 30_000 });
let receiptEvidenceLoading = false;
async function loadReceiptEvidence(signal){
  if (receiptEvidenceLoading) return;
  receiptEvidenceLoading = true;
  try {
    const [result, summary, history] = await Promise.all([
      apiRequest('/api/evidence/receipts', { signal }).catch(() => null),
      apiRequest('/api/analytics/summary', { signal }).catch(() => null),
      apiRequest('/api/evidence/payment-history', { signal }).catch(() => null),
    ]);
    signal?.throwIfAborted();
    const data = result?.data;
    receiptEvidence = result?.available === true && data?.cluster === EXPLORE_CLUSTER ? data : null;
    paymentHistoryEvidence = history?.available === true && history.data?.cluster === EXPLORE_CLUSTER ? history.data : null;
    receiptEvidenceChecked = true;
    analyticsSummary = summary?.available === true && summary.data?.homeFeeAllocations?.cluster === EXPLORE_CLUSTER
      ? summary.data : null;
    homeFeeAllocations = summary?.available === true && summary.data?.homeFeeAllocations?.cluster === EXPLORE_CLUSTER
      ? summary.data.homeFeeAllocations : null;
    renderExplorePayoutStats();
    renderOnchainReportState(assets);
    renderHomeKpiDashboard(assets);
  } finally { receiptEvidenceLoading = false; }
}
document.querySelector('#payment-list').innerHTML = '<p class="empty-state">Checking finalized payout receipts…</p>';
document.querySelector('#payment-dialog-list').innerHTML = '<p class="empty-state">Checking finalized payout receipts…</p>';
loadReceiptEvidence();
createRoutePoller({ run: signal => loadReceiptEvidence(signal), active: () => coinRouteRequested() || ['overview', 'explore', 'payments', 'analytics-detail', 'buybacks'].includes(requestedPageRoute()), intervalMs: 60_000 });
renderWatchlist();
let registryLaunches = [];
let registryPage = 1;
let registryCriteriaKey = '';
function updateExploreSortAvailability(){
  const select = document.querySelector('#explore-sort');
  if (EXPLORE_CLUSTER !== 'devnet') {
    const labels = { 'market-cap': 'Market cap', volume: '24h volume', boosted: 'Active paid boosts', airdrop: 'Community airdrop allocation', 'tier-burn': 'Verified tier burn', 'holder-fee': 'Creator fees to holders', 'x-fee': 'Creator fees to X account', trades: '24h trades', turnover: 'Volume / cap', liquidity: 'Liquidity', 'recent-trade': 'Recent activity', holders: 'Holders', change: '24h price change', newest: 'Newest' };
    if (select) for (const option of select.options) { option.textContent = labels[option.value]; option.disabled = option.value === 'trades'; }
    document.querySelectorAll('[data-explore-sort]').forEach(button => { button.disabled = false; button.title = ''; });
    const headings = document.querySelectorAll('.scanner-head span');
    if (headings[3]) headings[3].textContent = 'Market cap';
    if (headings[4]) headings[4].textContent = '24h volume';
    if (headings[6]) headings[6].textContent = '24h change';
    const note = document.querySelector('#scanner-note');
    if (note) note.textContent = 'Market figures are provider-indexed estimates. A dash means no verified market value is available.';
    return;
  }
  const benefits = assets.map(withVerifiedExploreBenefits);
  const supported = {
    boosted: true,
    'market-cap': assets.some(item => item.curveCapSol != null),
    volume: exploreScannedCount === assets.length && assets.some(item => withMarketWindow(item, exploreWindow).windowVolumeSol != null),
    airdrop: benefits.some(item => item.benefitPolicyVerified && item.communityAirdropPercent != null),
    'tier-burn': benefits.some(item => item.promotionBurnTokens != null),
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
}
function refreshRegistryLaunches(){
  registryLaunches = assets.filter(item => item.address).map(item => withVerifiedExploreBenefits(EXPLORE_CLUSTER === 'devnet' ? withMarketWindow(item, exploreWindow) : enrichMarketRecord(item)));
}
function renderRegistry(query = exploreQuery){
  refreshRegistryLaunches();
  const criteriaKey = JSON.stringify([query, exploreSort, exploreRisk, exploreStage, exploreAuthority,
    explorePromotion, exploreReward, exploreTab, exploreNewLane, exploreWindow, exploreMaxAgeHours,
    exploreMinVolumeUsd, exploreMinMarketCapUsd, exploreMinTrades, exploreMinTraders, getWatchlist()]);
  if (criteriaKey !== registryCriteriaKey) { registryPage = 1; registryCriteriaKey = criteriaKey; }
  const filtered = filterMarketRecords(registryLaunches, exploreFilterOptions(query));
  const page = paginateExploreRows(filtered, registryPage);
  registryPage = page.page;
  const registryLoading = exploreProviderStatus === 'On-chain only · loading' && !exploreLastVerifiedAt;
  const registryUnavailable = !registryLoading && !assets.length && ((!exploreFeedAvailable && !exploreLastVerifiedAt) || /RPC (?:rate limited|unavailable)/i.test(exploreProviderStatus));
  const outage = exploreOutageCopy();
  const count = document.querySelector('#scanner-count');
  if (count) count.textContent = registryLoading ? 'Checking launches' : registryUnavailable ? outage.title : `${filtered.length} of ${registryLaunches.length} shown`;
  const range = document.querySelector('#scanner-range');
  if (range) range.textContent = registryLoading ? 'Loading' : registryUnavailable ? 'Unavailable' : page.total ? `${page.start + 1}–${page.end} of ${page.total} launches` : '0 launches';
  const pageLabel = document.querySelector('#scanner-page-label');
  if (pageLabel) pageLabel.textContent = `Page ${page.page} of ${page.pages}`;
  const pagination = document.querySelector('#scanner-pagination');
  if (pagination) {
    pagination.hidden = page.pages <= 1;
    pagination.querySelector('[data-registry-page="prev"]').disabled = page.page <= 1;
    pagination.querySelector('[data-registry-page="next"]').disabled = page.page >= page.pages;
    const numbers = pagination.querySelector('#scanner-page-numbers');
    if (numbers) numbers.innerHTML = explorePageNumbers(page.page, page.pages).map(number => `<button type="button" data-registry-page="${number}" aria-label="Page ${number}" ${number === page.page ? 'aria-current="page"' : ''}>${number}</button>`).join('');
  }
  const list = document.querySelector('#launch-list');
  if (!list) return;
  if (!filtered.length) {
    const reason = exploreEmptyReason();
    list.innerHTML = registryLoading
      ? '<div class="empty-state">Checking the verified launch feed…</div>'
      : registryUnavailable
      ? `<div class="empty-state"><strong>${escapeHtml(outage.title)}</strong><span>${escapeHtml(outage.detail)}</span><button type="button" class="secondary-button" data-verified-feed-retry>Retry verification</button><a class="explore-policy-link" href="#airdrops">Browse recorded airdrop policies →</a></div>`
      : `<div class="empty-state">${escapeHtml(reason?.[0] || 'No verified launches match these filters.')} ${escapeHtml(reason?.[1] || 'Try All stages or clear the search.')}</div>`;
    return;
  }
  list.innerHTML = page.rows.map((item, index) => {
    const mint = escapeHtml(item.address);
    const symbol = escapeHtml(item.symbol);
    const stage = exploreStageLabel(item);
    const age = item.createdTimestamp ? escapeHtml(formatOnchainAge(Number(item.createdTimestamp) * 1000)) : 'Age unavailable';
    const change = item.priceChange24hPercent == null ? '—' : `${item.priceChange24hPercent >= 0 ? '+' : ''}${Number(item.priceChange24hPercent).toFixed(2)}%`;
    return `<div class="scanner-row" role="row" data-logo-mint="${mint}">
      <span class="scanner-rank" role="cell">${page.start + index + 1}</span>
      <div class="scanner-token" role="cell"><span class="asset-icon">${escapeHtml(item.icon)}</span><span><span class="scanner-token-heading"><a class="scanner-token-link" href="/token/${encodeURIComponent(item.address)}"><strong class="${activeBoostMultiplier(verifiedBoosts[item.address]) >= 500 ? 'golden-ticker' : ''}">${symbol} <small>${escapeHtml(item.name)}</small></strong></a>${explorePaidListingBagMarkup(item)}${exploreBoostAmountMarkup(item.address)}</span><span class="scanner-actions"><button type="button" class="copy-row scanner-contract" data-mint="${mint}" aria-label="Copy ${symbol} token contract address" title="Copy full contract address: ${mint}"><span>${escapeHtml(`${item.address.slice(0, 4)}…${item.address.slice(-4)}`)}</span>${icon('copy')}</button>${exploreSocialLinksMarkup(item)}<button type="button" class="watch-button scanner-watch" data-mint="${mint}" aria-label="Save ${symbol} to watchlist" aria-pressed="false" title="Save to watchlist">${icon('star')}</button></span></span></div>
      <div class="scanner-tier" role="cell">${exploreTierBadgeMarkup(item.address)}</div>
      <span class="scanner-metric" role="cell">${escapeHtml(EXPLORE_CLUSTER === 'devnet' ? formatCoinUsd(item.curveCapSol) : formatCompactUsd(item.marketCapUsd))}</span>
      <span class="scanner-age" role="cell">${age}</span>
      <span class="scanner-metric" role="cell" title="${item.windowCoverage === 'partial' ? 'Partial confirmed trade-history scan; shown as a lower bound' : 'Confirmed trade history'}">${formatExploreTradeCount(item.windowTradeCount, item.windowCoverage)}</span>
      <span class="scanner-metric" role="cell" title="${item.windowCoverage === 'partial' ? 'Partial confirmed trade-history scan; shown as a lower bound' : 'Confirmed trade history'}">${escapeHtml(EXPLORE_CLUSTER === 'devnet' ? formatExploreUsd(item.windowVolumeSol, { partial: item.windowCoverage === 'partial' }) : formatCompactUsd(item.volume24hUsd))}</span>
      <span class="scanner-metric ${Number(item.priceChange24hPercent) < 0 ? 'negative' : ''}" role="cell" title="Observed 24-hour price change when available">${change}</span>
      <div class="scanner-airdrop-cell" role="cell">${exploreAirdropMarkup(item)}</div>
      <div class="scanner-stage" role="cell"><strong>${stage}</strong><small>${item.complete === false && item.curveProgressPercent != null && Number.isFinite(Number(item.curveProgressPercent)) ? `${Number(item.curveProgressPercent).toFixed(0)}% curve` : ''}</small></div>
      <div class="scanner-boost" role="cell">${activeBoostMultiplier(verifiedBoosts[item.address]) ? `<span class="scanner-boost-total">⚡ ${activeBoostMultiplier(verifiedBoosts[item.address]).toLocaleString()}x active</span>` : ''}<button type="button" class="explore-boost-button" data-boost-mint="${mint}" aria-label="Boost options for ${escapeHtml(item.name)}">Boost ↗</button></div>
    </div>`;
  }).join('');
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
  dialog.querySelector('h2').textContent = phase === 'connect' ? 'Connect Phantom to this desktop' : phase === 'sign-fallback' ? 'Approve the message in Phantom' : phase === 'transaction' ? 'Review the Solana trade in Phantom' : 'Approve the claim in Phantom';
  const steps = dialog.querySelectorAll('.mobile-wallet-steps span');
  if (steps.length === 3) {
    steps[0].textContent = 'Scan this QR with Phantom on your phone';
    steps[1].textContent = phase === 'connect' ? 'Approve the Solana wallet connection' : phase === 'sign-fallback' ? 'Tap Connect and sign the message' : phase === 'transaction' ? 'Tap Connect and review, then approve the transaction' : 'Approve the claim message in Phantom';
    steps[2].textContent = phase === 'connect' ? 'Continue on this desktop; scan again when a claim needs signing' : phase === 'transaction' ? 'Return here for Solana confirmation' : 'Return to this desktop for payout verification';
  }
  mobileWalletLink = link;
  message.textContent = phase === 'connect' ? 'Scan with Phantom and approve this Solana wallet connection. The address will appear in this desktop tab.' : phase === 'sign-fallback' ? 'Scan with Phantom, then tap Connect and sign on the funded.vip signer page. The signature returns to this desktop tab.' : phase === 'transaction' ? 'This QR opens a small funded.vip signer inside Phantom. Review the amount, fee, and token there before approving. Your desktop wallet stays connected and submits the signed transaction.' : 'Scan with Phantom and approve the claim message. The signature will return to this desktop tab.';
  qr.src = `https://quickchart.io/qr?size=320&margin=2&text=${encodeURIComponent(qrLink)}`;
  qr.alt = phase === 'connect' ? 'Scan to connect Phantom mobile wallet to this desktop' : phase === 'sign-fallback' ? 'Scan to open funded.vip signer in Phantom' : phase === 'transaction' ? 'Scan to sign the Solana trade transaction with Phantom mobile wallet' : 'Scan to sign claim message with Phantom mobile wallet';
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
  const { verifyPhantomMobileSession, verifyPhantomMobileSignature, verifyPhantomMobileTransaction } = await import('./phantom-mobile-crypto.js');
  verifyPhantomMobileSession(session, window.location.origin);
  const { PublicKey } = await getSolana();
  let pendingTradeFlow = null;
  const provider = {
    publicKey:new PublicKey(session.publicKey), isConnected:true, remoteMobile:true,
    async signTransaction(transaction){
      if (!provider.isConnected) throw new Error('Reconnect the mobile wallet before trading.');
      const transactionRequest = { publicKey:session.publicKey, transaction:Buffer.from('message' in transaction ? transaction.serialize() : transaction.serialize({ requireAllSignatures:false, verifySignatures:false })).toString('base64'), ...(Number.isSafeInteger(transaction.fundedLastValidBlockHeight) ? { lastValidBlockHeight:transaction.fundedLastValidBlockHeight } : {}), ...(transaction.fundedTradeSummary ? { summary:transaction.fundedTradeSummary } : {}), ...(transaction.fundedLaunchSummary ? { summary:transaction.fundedLaunchSummary } : {}) };
      const flow = await registerMobileWalletFlow(null, transactionRequest);
      pendingTradeFlow = flow;
      const version = ++mobileWalletRequestVersion;
      const signerUrl = `${window.location.origin}/api/mobile-wallet/trade/${flow.id}`;
      const browseLink = `https://phantom.app/ul/browse/${encodeURIComponent(signerUrl)}?ref=${encodeURIComponent(window.location.origin)}`;
      showMobileWalletRequest(browseLink, 'transaction');
      try {
        const result = await waitForMobileWalletFlow(flow, version);
        if (!Number.isSafeInteger(result.lastValidBlockHeight) || result.lastValidBlockHeight <= 0) throw new Error('Phantom returned a trade without a verified Solana expiry. Nothing was submitted.');
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
      throw new Error('Could not update the phone with the Solana transaction signature.');
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
    const [{ default: nacl }, { decryptPhantomMobileResult, verifyPhantomMobileSession }] = await Promise.all([import('tweetnacl'), import('./phantom-mobile-crypto.js')]);
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
  catch { try { sessionStorage.removeItem(MOBILE_WALLET_SESSION_KEY); } catch { /* Storage may also prevent cleanup; no session was restored. */ } return false; }
}
function setTradeStatus(message, error = false){ const node = document.querySelector('#trade-status'); if (node) { node.textContent = message; node.className = `field-help ${error ? 'funded-mint-invalid' : ''}`; } }
function setTradeReceiptStatus(message, signature, error = false) {
  const node = document.querySelector('#trade-receipt-status');
  if (!node) return;
  node.hidden = false;
  node.textContent = message;
  node.className = `field-help ${error ? 'funded-mint-invalid' : ''}`;
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(String(signature || ''))) return;
  const receipt = document.createElement('a');
  receipt.href = exploreExplorer(`tx/${encodeURIComponent(signature)}`);
  receipt.textContent = ' Check transaction ↗';
  receipt.target = '_blank';
  receipt.rel = 'noopener noreferrer';
  node.append(receipt);
}
function tradeBalanceKey(){
  const session = captureWalletSession();
  const mint = document.querySelector('#trade-mint')?.value.trim();
  return session && mint ? `${session.address}:${mint}` : '';
}
function roundTripStorageKey(walletAddress, mint){ return `${TRADE_ROUNDTRIP_KEY}:${walletAddress}:${mint}`; }
function savedRoundTrip(walletAddress, mint){
  try { return JSON.parse(localStorage.getItem(roundTripStorageKey(walletAddress, mint)) || 'null'); } catch { return null; }
}
function rememberRoundTripReceipt({ walletAddress, mint, side, signature, symbol }){
  const prior = savedRoundTrip(walletAddress, mint);
  const next = side === 'buy' ? { buySignature:signature, symbol } : prior?.buySignature
    ? { ...prior, sellSignature:signature, symbol:symbol || prior.symbol } : null;
  if (next) try { localStorage.setItem(roundTripStorageKey(walletAddress, mint), JSON.stringify(next)); } catch { /* Sharing history is optional. */ }
  return next;
}
function renderRoundTripAction(){
  const button = document.querySelector('#trade-roundtrip-share');
  if (!button) return;
  const session = captureWalletSession(), mint = document.querySelector('#trade-mint')?.value.trim();
  const pair = session && mint ? savedRoundTrip(session.address, mint) : null;
  button.hidden = tradeActionBusy || !pair?.buySignature || !pair?.sellSignature;
}
function resetTradeBalances(){
  tradeBalanceRequest++;
  tradeBalanceState = { key:'', solLamports:null, tokenRaw:null, tokenDecimals:0 };
  renderTradeBalances();
}
function renderTradeBalances(){
  renderRoundTripAction();
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
  const inputs = tradeInputs();
  const preview = currentTradePreview(inputs);
  const insufficient = current && Number.isFinite(amount) && amount > 0 && (side === 'buy'
    ? tradeBalanceState.solLamports != null && !hasBuyBalance(tradeBalanceState.solLamports, { amountSol:amount, slippagePercent:inputs.slippagePercent, feeBps:TRADE_FEE_BPS, trade:preview?.trade })
    : tradeBalanceState.tokenRaw != null && amount > Number(tradeBalanceState.tokenRaw) / (10 ** tradeBalanceState.tokenDecimals));
  if (warning) { warning.hidden = !insufficient; warning.textContent = side === 'buy' ? 'Insufficient SOL for maximum spend, app fee, and network/account allowance.' : `Insufficient ${symbol} balance.`; }
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
function currentTradePreview(inputs = tradeInputs()){
  const session = captureWalletSession();
  const key = `${inputs.mint}:${inputs.side}:${inputs.amount}:${inputs.slippagePercent}:${session?.address || ''}`;
  return tradePreview?.inputKey === key && Date.now() - tradePreview.preparedAt < 15_000 ? tradePreview : null;
}
function updateTradeActionState(){
  const submit = document.querySelector('#trade-submit');
  const inputs = tradeInputs();
  const { side, amount, valid } = inputs;
  const current = Boolean(tradeBalanceState.key && tradeBalanceState.key === tradeBalanceKey());
  const preview = currentTradePreview(inputs);
  const sufficient = current && valid && (side === 'buy'
    ? hasBuyBalance(tradeBalanceState.solLamports, { amountSol:amount, slippagePercent:inputs.slippagePercent, feeBps:TRADE_FEE_BPS, trade:preview?.trade })
    : tradeBalanceState.tokenRaw != null && amount <= Number(tradeBalanceState.tokenRaw) / (10 ** tradeBalanceState.tokenDecimals));
  if (submit) submit.disabled = tradeActionBusy || !wallet || !canSignTransactions(wallet) || !valid || !preview || !sufficient;
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
    renderTradeBalances();
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
      renderTradeBalances();
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
  const tradeShare = document.querySelector('#trade-share');
  if (tradeShare) tradeShare.hidden = true;
  tradeActionBusy = true;
  updateTradeActionState();
  let submittedSignature = null;
  try {
    const activeConnection = connection || (await getSolana(), connection);
    assertWalletSessionCurrent(session);
    if (side === 'buy') {
      const latestBalance = await activeConnection.getBalance(session.provider.publicKey, 'confirmed');
      if (!hasBuyBalance(latestBalance, { amountSol:amount, slippagePercent, feeBps:TRADE_FEE_BPS, trade:tradePreview.trade })) throw new Error('Insufficient SOL for maximum spend, app fee, and network/account allowance.');
    }
    assertWalletSessionCurrent(session);
    if (!currentTradePreview()) throw new Error('The trade quote expired during balance verification. Review a fresh quote.');
    const shownCoin = getCoinMintAddress() === mint;
    const result = await submitTrade({ connection: activeConnection, provider: session.provider, side, mint, user: session.provider.publicKey, amount, slippagePercent, feeOwner: TRADE_FEE_OWNER, feeBps: TRADE_FEE_BPS, preparedTrade: tradePreview.trade, tokenName:shownCoin ? document.querySelector('#coin-page-title')?.textContent?.trim() : '', tokenSymbol:shownCoin ? document.querySelector('#coin-symbol')?.textContent?.trim() : '', assertWalletCurrent: () => assertWalletSessionCurrent(session), onStatus: message => { if (isWalletSessionCurrent(session)) setTradeStatus(message); } });
    submittedSignature = result.signature;
    setTradeReceiptStatus('Trade submitted and confirmed. Waiting for finalization before showing it as complete.', submittedSignature);
    const finalization = await waitForSignatureConfirmation(activeConnection, { signature:submittedSignature, commitment:'finalized' });
    if (finalization.value?.err) { const failure = new Error('The submitted transaction failed on-chain.'); failure.finalizedFailure = true; throw failure; }
    if (!isWalletSessionCurrent(session)) return;
    pendingTradeVerifications.set(submittedSignature, { signature:submittedSignature, mint, side, walletAddress:session.address,
      symbol:shownCoin ? (document.querySelector('#coin-symbol')?.textContent?.trim() || 'token') : 'token', feeLamports:result.feeLamports });
    setTradeReceiptStatus(`${side === 'buy' ? 'Buy' : 'Sell'} finalized. Checking token balance change and indexed trade row.`, submittedSignature);
    await verifyPendingTrade(activeConnection, submittedSignature);
    void refreshTradeBalances();
  } catch (error) {
    const signature = submittedSignature || error.signature;
    if (isWalletSessionCurrent(session)) {
      const message = error.finalizedFailure
      ? 'Trade failed on-chain. Review the receipt before making another trade.'
      : signature ? `Trade outcome is uncertain until the signature is checked. ${error.message} Do not retry before reviewing it.`
        : `Trade was not submitted or could not be prepared. ${error.message}`;
      if (signature) setTradeReceiptStatus(message, signature, error.finalizedFailure);
      else setTradeStatus(message, true);
    }
  } finally {
    tradeActionBusy = false;
    renderRoundTripAction();
    if (isWalletSessionCurrent(session)) { invalidateTradePreview(); queueTradeQuote(); }
  }
}
async function verifyPendingTrade(activeConnection = null, targetSignature = null){
  const pending = targetSignature ? pendingTradeVerifications.get(targetSignature) : pendingTradeVerifications.values().next().value;
  if (!pending) return;
  const session = captureWalletSession();
  if (!session || session.address !== pending.walletAddress) return;
  const button = document.querySelector('#trade-verify');
  if (button) { button.hidden = false; button.disabled = true; }
  try {
    const rpc = activeConnection || connection || (await getSolana(), connection);
    const [receipt, market] = await Promise.allSettled([
      rpc.getParsedTransaction(pending.signature, { commitment:'finalized', maxSupportedTransactionVersion:0 }),
      apiRequest(`/api/tokens/${encodeURIComponent(pending.mint)}/market-activity`, { signal:AbortSignal.timeout(12000) }),
    ]);
    if (!isWalletSessionCurrent(session) || pendingTradeVerifications.get(pending.signature) !== pending) return;
    const evidence = assessTradeCompletion({ transaction:receipt.status === 'fulfilled' ? receipt.value : null,
      marketActivity:market.status === 'fulfilled' && market.value.available ? market.value.data : null,
      wallet:pending.walletAddress, mint:pending.mint, side:pending.side, signature:pending.signature });
    if (!evidence.complete) {
      const reason = !evidence.receiptVerified ? 'Finalized token balance change is not verified yet.' : 'Matching trade row is not indexed yet.';
      pendingTradeVerifications.delete(pending.signature);
      pendingTradeVerifications.set(pending.signature, pending);
      setTradeReceiptStatus(`${pending.side === 'buy' ? 'Buy' : 'Sell'} finalized; ${reason} ${pendingTradeVerifications.size} receipt${pendingTradeVerifications.size === 1 ? '' : 's'} pending. Check status again before treating it as complete.`, pending.signature);
      return;
    }
    pendingTradeVerifications.delete(pending.signature);
    if (button) button.hidden = pendingTradeVerifications.size === 0;
    setTradeReceiptStatus(`${pending.side === 'buy' ? 'Buy' : 'Sell'} finalized with verified balance change and indexed trade. App fee: ${(pending.feeLamports / 1_000_000_000).toFixed(6)} SOL.`, pending.signature);
    rememberRoundTripReceipt({ walletAddress:pending.walletAddress, mint:pending.mint, side:pending.side, signature:pending.signature, symbol:pending.symbol });
    renderRoundTripAction();
    const share = document.querySelector('#trade-share');
    if (share) {
      Object.assign(share.dataset, { signature:pending.signature, mint:pending.mint, wallet:pending.walletAddress, side:pending.side, symbol:pending.symbol });
      share.hidden = false;
    }
    if (getCoinMintAddress() === pending.mint) void loadCoinOnChain(pending.mint);
    showToast(`${pending.side === 'buy' ? 'Buy' : 'Sell'} verified on Solana`);
    refreshWalletInfo();
    void refreshPortfolioHoldings();
  } finally { if (button) button.disabled = false; }
}
document.querySelector('#trade-verify')?.addEventListener('click', () => {
  void verifyPendingTrade().catch(error => {
    const pending = pendingTradeVerifications.values().next().value;
    if (pending) setTradeReceiptStatus(`Trade verification is unavailable: ${error.message}. Check status again later.`, pending.signature);
  });
});
document.querySelector('#trade-share')?.addEventListener('click', async event => {
  const button = event.currentTarget;
  const session = captureWalletSession();
  if (!session || session.address !== button.dataset.wallet || !button.dataset.signature) return setTradeStatus('Reconnect the trading wallet to share this receipt.', true);
  button.disabled = true;
  try {
    const activeConnection = connection || (await getSolana(), connection);
    const tx = await activeConnection.getParsedTransaction(button.dataset.signature, { commitment:'finalized', maxSupportedTransactionVersion:0 });
    if (!verifiedTradeReceipt(tx, { wallet:session.address, mint:button.dataset.mint, side:button.dataset.side, signature:button.dataset.signature })) throw new Error('The finalized trade receipt is not available or does not match this wallet and token yet. Try again later.');
    if (!isWalletSessionCurrent(session)) return;
    const url = new URL(`/token/${encodeURIComponent(button.dataset.mint)}`, location.origin);
    const code = registeredShareCode(); if (code) url.searchParams.set('ref', code);
    openShareComposer({ kind:'trade', title:'Finalized Solana trade on funded.vip',
      text:`I ${button.dataset.side === 'buy' ? 'bought' : 'sold'} ${button.dataset.symbol || 'a token'} on Solana. Review the token and finalized receipt. This is not a profit claim.`, url:url.toString(),
      result:{ kind:'trade', verified:true, side:button.dataset.side, mint:button.dataset.mint, tokenSymbol:button.dataset.symbol,
        receipt:button.dataset.signature, receiptUrl:exploreExplorer(`tx/${encodeURIComponent(button.dataset.signature)}`), wallet:session.address, network:EXPLORE_CLUSTER } });
  } catch (error) { setTradeStatus(error.message || 'Trade receipt verification is unavailable.', true); }
  finally { button.disabled = false; }
});
document.querySelector('#trade-roundtrip-share')?.addEventListener('click', async event => {
  const button = event.currentTarget;
  const session = captureWalletSession(), mint = document.querySelector('#trade-mint')?.value.trim();
  const pair = session && mint ? savedRoundTrip(session.address, mint) : null;
  if (!session || !mint || !pair?.buySignature || !pair?.sellSignature) return setTradeStatus('A finalized in-app buy and sell pair is required.', true);
  button.disabled = true;
  try {
    const { formatLamportsAsSol, verifyRoundTripFromSignatures } = await import('./trade-roundtrip.js');
    const activeConnection = connection || (await getSolana(), connection);
    const proof = await verifyRoundTripFromSignatures(activeConnection, { buySignature:pair.buySignature, sellSignature:pair.sellSignature, mint, wallet:session.address });
    if (!proof.positive) throw new Error('The two receipts do not show a positive wallet SOL change. You can still share the individual trade receipt.');
    if (!isWalletSessionCurrent(session) || document.querySelector('#trade-mint')?.value.trim() !== mint) return;
    const netSol = formatLamportsAsSol(proof.netLamports);
    const url = new URL(`/token/${encodeURIComponent(mint)}`, location.origin);
    url.searchParams.set('buy', pair.buySignature);
    url.searchParams.set('sell', pair.sellSignature);
    const code = registeredShareCode(); if (code) url.searchParams.set('ref', code);
    openShareComposer({ kind:'roundtrip', title:'Verified closed Devnet trade on funded.vip',
      publicShareApproval:{ assertCurrent:()=>assertWalletSessionCurrent(session), sign:async statement=>{
        assertWalletSessionCurrent(session);
        if (typeof session.provider.signMessage !== 'function') throw new Error('Use a wallet that supports message signing.');
        const signed=await session.provider.signMessage(new TextEncoder().encode(statement));
        assertWalletSessionCurrent(session);
        return bs58.encode(signed.signature || signed);
      } },
      text:`My closed ${pair.symbol || 'token'} trade changed my wallet SOL balance by +${netSol} SOL across its buy and sell receipts. Includes all SOL movements in those transactions; not wallet-wide profit. Verify both receipts.`, url:url.toString(),
      result:{ kind:'roundtrip', verified:true, accountHistoryVerified:true, netLamports:proof.netLamports, mint,
        buyReceipt:pair.buySignature, buyReceiptUrl:exploreExplorer(`tx/${encodeURIComponent(pair.buySignature)}`),
        receipt:pair.sellSignature, receiptUrl:exploreExplorer(`tx/${encodeURIComponent(pair.sellSignature)}`),
        wallet:session.address, network:EXPLORE_CLUSTER } });
  } catch (error) { setTradeStatus(error.message || 'Closed trade verification is unavailable.', true); }
  finally { button.disabled = false; }
});
const infoDialogRoutes = new Set(['terms', 'disclosures', 'opt-out']);
function openInfoDialog(kind, { routeDriven = false } = {}){
  const content = {
    terms: ['Terms of Use', '<div class="legal-meta"><span>Effective 18 Sep 2026</span><span>Version 1.0</span><span>Applies to funded.vip</span></div><p>You are responsible for reviewing every transaction before signing and for complying with applicable rules.</p><h3>Contents</h3><ul class="legal-list"><li>Wallet connection and signatures</li><li>Token metadata and deployer responsibility</li><li>Network, fees, and transaction confirmation</li><li>Prohibited use and service limitations</li><li>Privacy, disclosures, and support</li></ul><p class="muted-note">This is product information, not legal advice.</p>'],
    disclosures: ['Disclosures', '<div class="legal-meta"><span>Effective 23 Sep 2026</span><span>Version 1.5</span><span>Applies to funded.vip</span></div><p>The Pump launch flow creates the coin with the verified funded.vip router PDA written directly into Pump’s creator field. The paying wallet never receives creator-fee authority, and the app reads the bonding curve back before reporting success.</p><h3>Important limits</h3><ul class="legal-list"><li>The app indexes finalized receipts. Automatic creator and holder SOL delivery requires verified funding and an active healthy distribution worker; holder payouts also require complete finalized indexing. Check the live status on Home before relying on delivery. Referral rewards remain wallet-initiated claims.</li><li>X recipient verification and community-token distribution are not enabled.</li><li>Pump protocol administrators or a future Pump program upgrade remain outside funded.vip’s control.</li><li>funded.vip is not affiliated with X, Phantom, or Pump.fun.</li></ul><p class="muted-note">Verify the Pump creator address in the launch transaction and bonding-curve account on Solana Explorer.</p>'],
    capital: ['Capital flow', '<p>This calculator illustrates the published allocation policy. Confirmed launch, collection, and payout records appear in the verified workspace pages when the receipt indexer has recorded them.</p>'],
  'opt-out': ['Opt out', '<div class="legal-meta"><span>Account controls</span><span>Identity controls</span></div><p>The app indexes launch and reward activity, but account-level discovery exclusions require verified X identity and are not available yet.</p><div class="optout-steps"><div><b>1</b><span><strong>Sign in with X</strong><small>Verify control of the account you want to manage.</small></span></div><div><b>2</b><span><strong>Choose exclusions</strong><small>Request exclusion from future discovery and recipient selection.</small></span></div><div><b>3</b><span><strong>Review status</strong><small>Confirm the effective date; finalized receipts and existing entitlements remain on record.</small></span></div></div><button type="button" class="secondary-button info-action" disabled>Opt-out requests unavailable</button><p class="muted-note">X sign-in and indexed exclusion requests are not connected at this time.</p>'],
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
function readWalletPreference(key){
  try { const value = localStorage.getItem(key); if (value !== null) return value; } catch {}
  try { return sessionStorage.getItem(key); } catch { return null; }
}
function saveWalletPreference(key, value){
  try { localStorage.setItem(key, value); } catch {}
  try { sessionStorage.setItem(key, value); } catch {}
}
function removeWalletPreference(key){
  try { localStorage.removeItem(key); } catch {}
  try { sessionStorage.removeItem(key); } catch {}
}
function rememberedWalletProviderId(){
  return readWalletPreference(WALLET_PROVIDER_KEY);
}
function getProvider(){
  return selectRememberedWalletProvider(injectedWalletProviders(), rememberedWalletProviderId());
}
function phantomProvider(){
  if (window.phantom?.solana?.isPhantom) return window.phantom.solana;
  return window.solana?.isPhantom ? window.solana : null;
}
async function waitForPhantomProvider(){
  const provider = phantomProvider();
  if (provider) return provider;
  return new Promise(resolve => {
    const check = () => { const injected = phantomProvider(); if (injected) finish(injected); };
    const finish = injected => { clearInterval(interval); clearTimeout(timeout); resolve(injected); };
    const interval = setInterval(check, 100);
    const timeout = setTimeout(() => finish(null), 3000);
  });
}
async function restoreTrustedPhantomWallet(){
  const remembered = rememberedWalletProviderId();
  if ((remembered && remembered !== 'phantom' && remembered !== 'legacy') || wasWalletManuallyDisconnected() || wallet) return false;
  const provider = await waitForPhantomProvider();
  if (!provider || (remembered === 'legacy' && window.solana !== provider) || wasWalletManuallyDisconnected() || wallet) return false;
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
  return walletDisconnectRequested || readWalletPreference(WALLET_MANUAL_DISCONNECT_KEY) === '1';
}
function markWalletManuallyDisconnected(){
  walletDisconnectRequested = true;
  saveWalletPreference(WALLET_MANUAL_DISCONNECT_KEY, '1');
}
function allowWalletReconnect(){
  walletDisconnectRequested = false;
  removeWalletPreference(WALLET_MANUAL_DISCONNECT_KEY);
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
  fundedBurnState = { status: 'idle', wallet: null, decimals: 0, balanceBaseUnits: 0n, supplyBaseUnits: 0n, burnedBaseUnits: 0n, tokenAccounts: [], receipts: [], message: 'Connect a wallet to load its Solana balance.' };
  renderWalletFundedBalance();
  clearTimeout(launchCostRefreshTimer);
  launchCostRefreshTimer = null;
  walletBalanceLamports = null;
  walletBalanceRequest++;
  walletBalanceFetchedAt = 0;
  estimatedLaunchFeeLamports = null;
  resetTradeBalances();
  invalidateTradePreview();
  fundedBuyPreview = null;
  if (!boostCheckout.pendingSignature) boostCheckout.quote = null;
  launchCostReview = null;
  document.querySelector('#launch-review-dialog')?.close();
  for (const id of ['fee-route-agree', 'terms-agree']) { const input = document.getElementById(id); if (input) input.checked = false; }
  renderReferralClaimPrompt();
  for (const id of ['referral-active-creators', 'referral-conversion-rate']) {
    const node = document.querySelector(`#${id}`); if (node) node.textContent = '—';
  }
  for (const id of ['referral-total-claimable', 'referral-paid-total']) {
    const node = document.querySelector(`#${id}`); if (node) node.textContent = '— SOL';
  }
  const ledger = document.querySelector('#referral-ledger-list');
  if (ledger) renderReferralLedgerEmpty('No receipts to show', 'Connect your wallet to check finalized referral claims.');
  const claimStatus = document.querySelector('#sol-claim-status');
  if (claimStatus) claimStatus.textContent = '';
}
function observeWalletProvider(provider){
  if (!provider?.on || observedWalletProviders.has(provider)) return;
  observedWalletProviders.add(provider);
  provider.on('connect', () => { if (!wallet && !wasWalletManuallyDisconnected() && provider.isConnected && walletAddress(provider)) activateWallet(provider); });
  provider.on('disconnect', () => { if (wallet === provider) { markWalletManuallyDisconnected(); clearWalletState(); } });
  provider.on('accountChanged', publicKey => handleAccountChanged(provider, publicKey));
  const networkChanged = () => {
    if (wallet !== provider) return;
    walletVersion++;
    resetWalletDependentViews();
    setLaunchStatus('Wallet network changed. Verify the app network and refresh the estimate before signing.');
    void refreshWalletInfo().catch(() => {});
  };
  provider.on('chainChanged', networkChanged);
  provider.on('networkChanged', networkChanged);
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
  if (providerId) saveWalletPreference(WALLET_PROVIDER_KEY, providerId);
  observeWalletProvider(provider);
  setWalletState(message, address, true);
  void refreshPortfolioHoldings();
  void refreshTradeBalances();
  queueTradeQuote();
}
function clearWalletState(message = 'Wallet not connected', detail = 'Connect a wallet to continue'){
  walletConnectRequest++;
  walletVersion++;
  referralSessionWallet = '';
  resetWalletDependentViews();
  try { sessionStorage.removeItem(COIN_CHAT_SESSION_KEY); } catch {}
  wallet = null;
  connectedWalletAddress = null;
  launchTierQuote = null;
  void refreshPortfolioHoldings();
  renderTradeBalances();
  setWalletState(message, detail);
  setLaunchStatus('');
}
function normalizePreviewLabels(){
  const replacements = new Map([
    ['Solana only', 'Preview route'],
    ['Solana claims', 'Claims'],
    ['Open Solana trading ↗', 'Open trading ↗'],
    ['Get 1 SOL', 'Open faucet'],
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
    activateWallet(devProvider, 'Wallet connected');
    setLaunchStatus(`Wallet ready: ${DEV_WALLET_ROLE}`);
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
  const tierSection = document.querySelector('.creator-burn-section');
  if (tierSection) tierSection.dataset.selectedTier = policy.tier;
  const amounts = currentLaunchTierAmounts();
  const walletReady = Boolean(connectedWalletAddress && fundedBurnState.wallet === connectedWalletAddress && fundedBurnState.status === 'ready');
  const walletBalance = walletReady ? formatTokenBaseUnits(fundedBurnState.balanceBaseUnits, fundedBurnState.decimals, 6) : null;
  const walletNode = document.querySelector('#launch-tier-wallet-balance');
  if (walletNode) walletNode.textContent = walletReady ? `${walletBalance} $FUNDED available`
    : !connectedWalletAddress ? 'Connect wallet to check $FUNDED'
      : fundedBurnState.status === 'loading' ? 'Checking Devnet balance…' : 'Balance unavailable';
  const selectionNote = document.querySelector('.launch-tier-selection-note');
  if (selectionNote) selectionNote.textContent = `${policy.label} launch is selected. Your 80% creator-directed fee share goes to your wallet unless you choose a custom split.`;
  document.querySelectorAll('.creator-burn-card[data-burn-tier]').forEach(button => {
    const active = button.dataset.burnTier === policy.tier;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
    const tier = LAUNCH_BURN_TIERS.find(item => item.id === button.dataset.burnTier);
    const action = button.querySelector('b');
    if (action && tier) action.textContent = active ? 'Selected' : tier.id === 'standard' ? 'Included' : `Select ${tier.label}`;
  });
  for (const tier of ['pro', 'premier']) {
    const amount = policy.tier === tier && currentLaunchTierQuote() ? policy.amountTokens : amounts?.[tier];
    const count = document.querySelector(`#${tier}-burn-amount`);
    const progress = document.querySelector(`#${tier}-tier-progress`);
    if (count) count.textContent = amount ? `${formatLaunchBurnAmount(amount)} $FUNDED` : 'Quote unavailable';
    if (progress) {
      progress.textContent = amount && walletReady ? `${walletBalance} / ${formatLaunchBurnAmount(amount)} $FUNDED`
        : amount ? 'Connect wallet to check balance' : 'Waiting for verified price';
      progress.classList.toggle('short', Boolean(amount && walletReady && fundedBurnState.balanceBaseUnits < tokensToBaseUnits(amount, fundedBurnState.decimals)));
    }
  }
  const quoteStatus = document.querySelector('#launch-tier-quote-status');
  if (quoteStatus) quoteStatus.textContent = amounts
    ? `1 $FUNDED ≈ $${Number(launchTierPricing.tokenPriceUsd).toLocaleString(undefined, { maximumSignificantDigits:6 })} · verified pool slot ${launchTierPricing.slot} · exact burn locked at review`
    : currentLaunchTierQuote() ? `Your ${policy.label} quote is locked until ${new Date(launchTierQuote.expiresAt).toLocaleTimeString()}.`
      : 'Verified $FUNDED/USD pool price unavailable. Paid tiers cannot be launched until it refreshes.';
  const status = document.querySelector('#creator-burn-status');
  if (status) {
    const configured = validateLaunchBurnPolicy(policy).valid;
    const ready = !policy.requiresBurn || (configured && launchBurnReadiness.ready);
    status.className = `creator-burn-status ${ready ? 'ready' : 'blocked'}`;
    status.innerHTML = ready
      ? `<span>✓</span><p><strong>${policy.label} selected.</strong> ${policy.requiresBurn ? launchBurnReadiness.message : 'No creator-funded burn is required.'}</p>`
      : `<span>!</span><p><strong>${policy.label} cannot launch yet.</strong> ${configured ? launchBurnReadiness.message : PROTOCOL_FUNDED_MINT ? 'The verified $FUNDED price is unavailable.' : 'The protocol $FUNDED mint is not configured.'}</p>`;
  }
}
function setLaunchBurnTier(tierId){
  launchBurnTier = SELECTABLE_LAUNCH_TIERS.has(tierId) ? tierId : 'standard';
  launchTierQuote = null;
  const policy = getLaunchBurnPolicy();
  launchBurnReadiness = policy.requiresBurn
    ? { ready: false, message: !PROTOCOL_FUNDED_MINT ? 'The fixed $FUNDED mint is not configured.'
      : !policy.amountTokens ? 'The verified $FUNDED price is unavailable. Refresh the quote.'
        : wallet ? 'Checking the connected wallet’s $FUNDED balance…' : 'Connect a wallet to verify its $FUNDED balance.' }
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
    ? `<b>${communityPercent.toFixed(2)}% of supply</b> · bought and locked in the reward vault when launch finalizes`
    : '<b>Enter a valid airdrop amount</b>';
  if (burnNode) burnNode.textContent = burnPolicy.requiresBurn
    ? burnPolicy.amountTokens > 0 ? `${formatLaunchBurnAmount(burnPolicy.amountTokens)} $FUNDED` : 'Quote unavailable'
    : '0 $FUNDED';
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
        ? 'Building and estimating the Solana transaction…'
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
    ? 'SOL total includes network fees, account reserve, and any developer buy. The $FUNDED burn is separate.'
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
function renderWalletBalance({ loading = false } = {}){
  const balance = walletBalanceLamports;
  const display = loading && balance == null ? 'Loading…' : balance == null ? 'Unavailable' : formatSol(balance);
  document.querySelector('#profile-balance').textContent = wallet ? display : 'Connect to load';
  const compactBalance = loading && balance == null ? '…' : balance == null ? '—' : formatSol(balance).replace(/\s*SOL$/i, '');
  const headerBalance = document.querySelector('#header-wallet-balance');
  const headerWallet = document.querySelector('#connect-button');
  if (headerBalance) headerBalance.textContent = compactBalance;
  if (headerWallet?.classList.contains('wallet-pill-connected')) {
    headerWallet.setAttribute('aria-label', `Wallet ${connectedWalletAddress.slice(0, 4)}…${connectedWalletAddress.slice(-4)}, ${balance == null ? 'SOL balance unavailable' : `${compactBalance} SOL`}`);
    headerWallet.title = balance == null && !loading ? 'SOL balance unavailable. Open the wallet menu to retry.' : '';
  }
  const popoverBalance = document.querySelector('#wallet-popover-sol');
  if (popoverBalance) popoverBalance.textContent = compactBalance;
  renderWalletDetail();
  updateLaunchButton();
  updateCostSummary();
}
async function refreshWalletBalance({ force = false } = {}){
  const session = captureWalletSession();
  if (!session || (!force && Date.now() - walletBalanceFetchedAt < 15_000)) return;
  const request = ++walletBalanceRequest;
  renderWalletBalance({ loading: true });
  try {
    await getSolana();
    const balance = await withRpcRetry(() => connection.getBalance(session.provider.publicKey, 'confirmed'), { attempts: 2, delaysMs: [700] });
    if (request !== walletBalanceRequest || !isWalletSessionCurrent(session)) return;
    walletBalanceLamports = balance;
    walletBalanceFetchedAt = Date.now();
  } catch (error) {
    if (request !== walletBalanceRequest || !isWalletSessionCurrent(session)) return;
    walletBalanceFetchedAt = 0;
    console.warn('SOL balance refresh failed:', error);
  }
  renderWalletBalance();
}
function setWalletMetrics({ balance, fee = null, loading = false, error = '' } = {}){
  walletMetricsLoading = loading;
  walletEstimateError = loading || !wallet ? '' : String(error || '');
  if (loading || !wallet || fee == null) { estimatedLaunchFeeLamports = null; estimatedInitialBuyLamports = 0; estimatedInitialBuyTokens = 0; launchCostReview = null; }
  if (!wallet) { walletBalanceLamports = null; estimatedLaunchFeeLamports = null; renderWalletBalance(); return; }
  if (!loading) {
    if (balance !== undefined) {
      walletBalanceLamports = balance;
      if (balance != null) walletBalanceFetchedAt = Date.now();
    }
    estimatedLaunchFeeLamports = fee;
  }
  renderWalletBalance({ loading });
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
  if (descriptionCounter) descriptionCounter.textContent = `${description.length}/280 · shown on your coin page`;
  const tagline = document.querySelector('#token-tagline')?.value.trim() || '';
  const taglinePreview = document.querySelector('#preview-tagline');
  if (taglinePreview) taglinePreview.textContent = tagline || description.trim() || 'Your coin description appears here.';
  const packageExample = document.querySelector('#launch-package-example');
  if (packageExample) packageExample.dataset.tier = launchBurn.tier;
  const packageLabel = document.querySelector('#launch-package-label');
  if (packageLabel) packageLabel.textContent = launchBurn.label;
  const packageArtBadge = document.querySelector('#launch-package-art-badge');
  if (packageArtBadge) packageArtBadge.textContent = `${launchBurn.label.toUpperCase()} PROMOTION`;
  const cleanedXLabel = (name || symbol || 'Token name').normalize('NFKC')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/[^\p{L}\p{N}\p{M} _-]/gu, ' ').replace(/\s+/g, ' ').trim() || 'Unnamed token';
  let xLabel = '', xLabelWeight = 0;
  for (const character of cleanedXLabel) {
    const weight = character.codePointAt(0) <= 0x7f ? 1 : 2;
    if (xLabelWeight + weight > 32) break;
    xLabel += character;
    xLabelWeight += weight;
  }
  xLabel = xLabel.trim() || 'Token';
  const xPrefix = EXPLORE_CLUSTER === 'devnet' ? '[Devnet test] ' : '[Mainnet] ';
  const xLink = 'https://funded.vip/token/{mint-after-launch}';
  const xLaunch = launchBurn.tier === 'standard'
    ? `New project on funded.vip: “${xLabel}”. Token creation finalized.`
    : `${launchBurn.tier === 'premier' ? 'Premier' : 'Pro'} launch: “${xLabel}”. Creation and $FUNDED tier burn finalized.`;
  const xPost = document.querySelector('#launch-x-post-preview');
  if (xPost) xPost.textContent = `${xPrefix}${xLaunch}\n${xLink}`;
  const xPostCount = document.querySelector('#launch-x-post-count');
  if (xPostCount) xPostCount.textContent = launchBurn.tier === 'premier' ? '2 posts' : '1 post';
  const xFollowup = document.querySelector('#launch-x-followup');
  if (xFollowup) xFollowup.hidden = launchBurn.tier !== 'premier';
  const xFollowupText = document.querySelector('#launch-x-followup-preview');
  if (xFollowupText) xFollowupText.textContent = `${xPrefix}Premier project follow-up: “${xLabel}”. Explore the verified launch and public token page.\n${xLink}`;
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
        ? xFeeStatus.ready ? 'X rewards use an isolated per-coin fee router and verified X + wallet claim.' : `X account rewards unavailable: ${xFeeFailureDetail()}.`
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
    x: normalizeXProfileInput(document.querySelector('#token-x')?.value),
    telegram: document.querySelector('#token-telegram')?.value.trim() || '',
    discord: document.querySelector('#token-discord')?.value.trim() || '',
    imageName: image?.name || '',
    imageType: image?.type || '',
  };
}
async function prepareLaunchMetadata({ mint, name, symbol }, session = captureWalletSession()){
  assertWalletSessionCurrent(session);
  if (typeof session.provider.signMessage !== 'function') throw new Error('This wallet must sign a metadata message before the Solana transaction.');
  const preview = getLaunchMetadataPreview();
  assertImageReady();
  const image = getPreparedImage();
  if (image && (!['image/png', 'image/jpeg', 'image/webp'].includes(image.type) || image.size > 600_000)) throw new Error('Choose a PNG, JPG, or WEBP image under 600 KB.');
  const imageBytes = image ? new Uint8Array(await image.arrayBuffer()) : null;
  const imageSha256 = imageBytes ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', imageBytes)), byte => byte.toString(16).padStart(2, '0')).join('') : '';
  const imageBase64 = imageBytes ? Buffer.from(imageBytes).toString('base64') : '';
  const record = {
    mint, creatorWallet: session.address, name, symbol,
    description: preview.description, tagline: preview.tagline, roadmap: preview.roadmap,
    website: canonicalLaunchSocialUrl(preview.website, 'website'), x: canonicalLaunchSocialUrl(preview.x, 'x'),
    telegram: canonicalLaunchSocialUrl(preview.telegram, 'telegram'), discord: canonicalLaunchSocialUrl(preview.discord, 'discord'), imageSha256,
  };
  assertWalletSessionCurrent(session);
  const signed = await session.provider.signMessage(new TextEncoder().encode(metadataStatement(record)));
  assertWalletSessionCurrent(session);
  const response = await apiRequest('/api/devnet-metadata', { method: 'POST', body: { ...record, imageBase64, imageType: image?.type || '', signature: bs58.encode(signed.signature || signed) } });
  assertWalletSessionCurrent(session);
  if (!response.available || response.data?.uri !== devnetMetadataUri(mint)) throw new Error('Solana metadata could not be published. No token transaction was sent.');
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
const LAUNCH_SOCIAL_KINDS = { 'token-website': 'website', 'token-x': 'x', 'token-telegram': 'telegram', 'token-discord': 'discord' };
function normalizeLaunchSocialField(field){
  if (field?.id === 'token-x') field.value = normalizeXProfileInput(field.value);
}
function launchSocialValue(field){
  return field.id === 'token-x' ? normalizeXProfileInput(field.value) : field.value;
}
function validPublicUrl(value, fieldId){
  try { canonicalLaunchSocialUrl(value, LAUNCH_SOCIAL_KINDS[fieldId]); return true; } catch { return false; }
}
function invalidLaunchSocial(){
  return LAUNCH_SOCIAL_FIELDS.map(id => document.getElementById(id)).find(field => {
    if (!field) return false;
    updateLaunchSocialValidity(field);
    return !validPublicUrl(launchSocialValue(field), field.id);
  }) || null;
}
function updateLaunchSocialValidity(field){
  if (!field) return;
  try { canonicalLaunchSocialUrl(launchSocialValue(field), LAUNCH_SOCIAL_KINDS[field.id]); field.setCustomValidity(''); }
  catch (error) { field.setCustomValidity(error.message); }
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
  const connectReady = !wallet && !APP_MAINNET_READ_ONLY && identityValid && feeDistribution.valid && xRouteReady && burnConfigured && buyValid && communityValid;
  button.disabled = !(ready || estimateRefreshReady || connectReady);
  button.dataset.launchAction = connectReady ? 'connect-wallet' : estimateRefreshReady ? 'refresh-estimate' : 'launch';
  button.textContent = !communityValid ? 'Airdrop must be 30M–500M' : !identityValid ? 'Fix coin details' : !feeDistribution.valid ? 'Fix fee distribution' : !xRouteReady ? 'X account rewards unavailable' : !feeRouterState.verified ? 'Fee router required' : !buyValid ? 'Enter a valid developer buy' : !burnConfigured ? (PROTOCOL_FUNDED_MINT ? '$FUNDED price unavailable' : '$FUNDED mint required') : launchBurn.requiresBurn && !burnReady ? 'Verify $FUNDED balance' : !wallet ? 'Connect wallet to launch' : !canSignTransactions(wallet) ? 'Open in wallet to sign' : walletMetricsLoading ? 'Calculating launch cost' : walletBalanceLamports == null ? 'Refresh wallet balance' : insufficientDeveloperBuy ? 'Insufficient SOL for developer buy' : estimatedLaunchFeeLamports == null ? 'Refresh launch estimate' : insufficient ? 'Insufficient SOL for launch' : !document.querySelector('#fee-route-agree')?.checked ? 'Confirm the fee route' : !document.querySelector('#terms-agree')?.checked ? 'Agree to terms to launch' : !policyValid ? 'Complete launch policy' : ready ? (launchBurn.requiresBurn ? `Review launch · ${launchBurn.label}` : 'Review launch') : 'Add name and ticker';
  if (connectReady) button.textContent = 'Connect wallet to create coin';
  updateLaunchNavigation();
}
function handleLaunchAction(event){
  if (event.currentTarget?.dataset.launchAction === 'connect-wallet') {
    void connectWallet();
    return;
  }
  if (event.currentTarget?.dataset.launchAction === 'refresh-estimate') {
    void refreshWalletInfo();
    return;
  }
  void openLaunchReview();
}
let pendingLaunchReview = null;
function currentLaunchReviewState(){
  return {
    reviewedCost: launchCostReview,
    tierQuoteId: currentLaunchTierQuote()?.id || null,
    tierBurnAmount: getLaunchBurnPolicy().amountTokens,
    wallet: connectedWalletAddress,
    router: feeRouterState.address,
    form: JSON.stringify(launchFormSnapshot()),
    image: getPreparedImage(),
    feeConsent: document.querySelector('#fee-route-agree').checked,
    termsConsent: document.querySelector('#terms-agree').checked,
  };
}
function renderPendingLaunchReview(){
  const dialog = document.querySelector('#launch-review-dialog');
  if (!dialog?.open) return;
  const pending = pendingLaunchReview;
  const current = launchReviewStillCurrent(pending, currentLaunchReviewState());
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
async function openLaunchReview(){
  const reviewedCost = launchCostReview;
  const session = captureWalletSession();
  if (!session || !freshLaunchReview(reviewedCost) || document.querySelector('#launch-button')?.disabled) {
    setLaunchStatus('Refresh the launch estimate and complete all checks before reviewing.', true);
    return;
  }
  normalizeLaunchSocialField(document.querySelector('#token-x'));
  const name = document.querySelector('#token-name').value.trim();
  const symbol = document.querySelector('#token-symbol').value.trim().toUpperCase();
  const shares = getFeeDistributionInputs();
  let burn = getLaunchBurnPolicy();
  const estimatedBurnAmount = burn.amountTokens;
  if (burn.requiresBurn) {
    try {
      const reusable = currentLaunchTierQuote();
      const quote = reusable && Date.parse(reusable.expiresAt) - Date.now() > 120_000
        ? reusable
        : (await apiRequest('/api/launch-tier-quote', { method:'POST', body:{ tier:burn.tier, payer:session.address } })).data;
      if (!launchTierQuoteCurrent(quote, { tier:burn.tier, payer:session.address, mint:PROTOCOL_FUNDED_MINT }))
        throw new Error('The paid tier quote could not be verified.');
      assertWalletSessionCurrent(session);
      if (launchBurnTier !== burn.tier) throw new Error('Launch tier changed while getting the quote. Review again.');
      launchTierQuote = quote;
      burn = getLaunchBurnPolicy();
      renderLaunchBurnSelection();
      if (estimatedBurnAmount !== burn.amountTokens) {
        launchCostReview = null;
        launchBurnReadiness = { ready:false, message:'The $FUNDED price changed. Refresh the launch estimate, then review the new burn amount.' };
        await refreshWalletInfo();
        setLaunchStatus('The $FUNDED quote changed. Check the new amount and review the refreshed estimate.', true);
        return;
      }
    } catch (error) {
      setLaunchStatus(String(error.message || 'The $FUNDED quote is unavailable.'), true);
      return;
    }
  }
  if (!freshLaunchReview(reviewedCost) || !isWalletSessionCurrent(session) || launchCostReview !== reviewedCost) {
    setLaunchStatus('Refresh the launch estimate and review again.', true);
    return;
  }
  pendingLaunchReview = { ...currentLaunchReviewState(), wallet: session.address };
  document.querySelector('#launch-review-token').textContent = `${name} (${symbol})`;
  document.querySelector('#launch-review-tier').textContent = burn.requiresBurn
    ? `${burn.label} · ${formatLaunchBurnAmount(burn.amountTokens)} $FUNDED (≈$${burn.usdTarget})`
    : `${burn.label} tier`;
  document.querySelector('#launch-review-wallet').textContent = session.address;
  document.querySelector('#launch-review-reserve').textContent = `${getCommunityAirdropTokens().toLocaleString()} tokens`;
  document.querySelector('#launch-review-buy').textContent = getCreatorBuySol() ? `${getCreatorBuySol()} SOL` : 'None';
  document.querySelector('#launch-review-route-short').textContent = `${feeRouterState.address.slice(0, 7)}…${feeRouterState.address.slice(-6)}`;
  document.querySelector('#launch-review-route-address').textContent = feeRouterState.address;
  document.querySelector('#launch-review-route-split').textContent = `${shares.creatorWalletPercent}% wallet · ${shares.holderAirdropPercent}% holders · ${shares.solClaimPercent}% X · 20% protocol`;
  document.querySelector('#launch-review-details').innerHTML = launchReviewMarkup(reviewedCost);
  document.querySelector('#launch-review-dialog').showModal();
  renderPendingLaunchReview();
  emitPilotSignal('launch-review-opened');
}
function closeLaunchReview({ confirmed = false } = {}){
  if (pendingLaunchReview && !confirmed) emitPilotSignal('launch-review-cancelled');
  pendingLaunchReview = null;
  document.querySelector('#launch-review-dialog')?.close();
}
function confirmLaunchReview(){
  const pending = pendingLaunchReview;
  closeLaunchReview({ confirmed: true });
  if (!launchReviewStillCurrent(pending, currentLaunchReviewState())) {
    setLaunchStatus('Launch review changed or expired. Refresh the estimate and review again; no transaction was sent.', true);
    return;
  }
  void launchToken();
}
function updateLaunchIdentityWarnings(){
  const name = document.querySelector('#token-name');
  const symbol = document.querySelector('#token-symbol');
  const entries = [
    [name, document.querySelector('#token-name-warning'), !name?.value.trim() ? 'Enter a token name.' : name.value.trim().length > 32 ? 'Use 32 characters or fewer.' : ''],
    [symbol, document.querySelector('#token-symbol-warning'), !symbol?.value.trim() ? 'Enter a ticker.' : !/^[A-Z0-9]{1,10}$/.test(symbol.value.trim().toUpperCase()) ? 'Use 1–10 letters or numbers.' : ''],
  ];
  for (const [input, warning, message] of entries) {
    if (!input || !warning) continue;
    const show = input.dataset.launchTouched === 'true' && Boolean(message);
    warning.textContent = message;
    warning.hidden = !show;
    if (show) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }
}
function getLaunchStepState(step){
  const name = document.querySelector('#token-name').value.trim();
  const symbol = document.querySelector('#token-symbol').value.trim().toUpperCase();
  if (step === 1) {
    try{assertImageReady();}catch(error){return {valid:false,message:error.message};}
    if (!name) return { valid: false, field: '#token-name', message: 'Enter the token name to continue.' };
    if (name.length > 32) return { valid: false, field: '#token-name', message: 'Use 32 characters or fewer for the token name.' };
    if (!symbol) return { valid: false, field: '#token-symbol', message: 'Enter a ticker to continue.' };
    if (!/^[A-Z0-9]{1,10}$/.test(symbol)) return { valid: false, field: '#token-symbol', message: 'Use 1–10 letters or numbers for the ticker.' };
    const invalidSocial = invalidLaunchSocial();
    if (invalidSocial) return { valid: false, field: `#${invalidSocial.id}`, message: invalidSocial.validationMessage };
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
    if (distribution.shares.solClaimPercent > 0 && !xFeeStatus.ready) return { valid: false, message: `X account rewards unavailable: ${xFeeFailureDetail()}.` };
    const launchBurn = getLaunchBurnPolicy();
    const burnValidation = validateLaunchBurnPolicy(launchBurn);
    if (!burnValidation.valid) return { valid: false, message: 'The protocol $FUNDED mint must be configured before a paid burn tier can launch.' };
    return { valid: true, message: launchBurn.requiresBurn ? `${launchBurn.label} selected: ${formatLaunchBurnAmount(launchBurn.amountTokens)} $FUNDED burn; atomicity depends on transaction size.` : launchMode === 'quick' ? 'Recommended distribution selected.' : 'Custom distribution is balanced.' };
  }
  if (step === 3) {
    if (!feeRouterState.verified) return { valid: false, message: feeRouterState.status === 'checking'
      ? 'Checking the Solana fee router…'
      : feeRouterState.status === 'router-verification-unavailable'
        ? 'Fee-router verification could not reach Solana. Retry checks before signing.'
        : feeRouterState.status === 'program-id-not-configured'
          ? 'The fee-router program is not configured for this site.'
          : 'The fee-router policy is not verified on Solana. Retry checks before signing.' };
    if (!wallet) return { valid: false, message: 'Connect a wallet to continue to signing.' };
    if (!canSignTransactions(wallet)) return { valid: false, message: 'Open this app inside your wallet to sign.' };
    if (walletMetricsLoading) return { valid: false, message: 'Wait while the launch cost is calculated.' };
    if (creatorBuyExceedsWalletBalance()) return { valid: false, message: 'Reduce the developer buy or add SOL before continuing.' };
    if (!freshLaunchReview(launchCostReview)) return { valid:false, message:'Refresh the launch estimate before continuing; quotes expire after one minute.' };
    if (walletBalanceLamports == null || estimatedLaunchFeeLamports == null) return { valid: false, message: walletEstimateError ? `Launch estimate unavailable: ${walletEstimateError}` : 'Refresh the wallet balance and launch estimate.' };
    if (walletBalanceLamports < estimatedLaunchFeeLamports) return { valid: false, message: 'Add SOL before continuing.' };
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
  const retry = document.querySelector('#launch-review-retry');
  const hint = document.querySelector('#wizard-hint');
  if (!next || !back || !hint) return;
  const state = getLaunchStepState(launchStep);
  back.hidden = launchStep === 1;
  next.hidden = launchStep === 3;
  next.disabled = false;
  next.textContent = launchStep === 2 ? 'Review settings' : 'Continue to settings';
  if (retry) {
    retry.hidden = launchStep !== 3 || (feeRouterState.verified && (!wallet || (estimatedLaunchFeeLamports != null && freshLaunchReview(launchCostReview))));
    retry.disabled = feeRouterState.status === 'checking' || walletMetricsLoading;
    retry.textContent = retry.disabled ? 'Checking…' : 'Retry checks';
  }
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
        for (let details = invalid?.closest('details'); details; details = details.parentElement?.closest('details')) details.open = true;
        if (invalid && invalid.getClientRects().length) {
          if (invalid.matches('#token-name, #token-symbol')) {
            invalid.dataset.launchTouched = 'true';
            updateLaunchIdentityWarnings();
          } else {
            invalid.setAttribute('aria-invalid','true');
            const described = new Set((invalid.getAttribute('aria-describedby') || '').split(' ').filter(Boolean));
            described.add('wizard-hint'); invalid.setAttribute('aria-describedby',[...described].join(' '));
            invalid.addEventListener('input',()=>invalid.removeAttribute('aria-invalid'),{once:true});
          }
          invalid.focus();
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
  setLaunchProfile(custom ? 'community' : 'fast');
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
function launchFormSnapshot(){
  const value = id => document.getElementById(id)?.value || '';
  return {
    profile: launchProfile, mode: launchMode, tier: launchBurnTier,
    name: value('token-name').trim(), symbol: value('token-symbol').trim().toUpperCase(),
    description: value('token-description'), tagline: value('token-tagline'), roadmap: value('token-roadmap'),
    website: value('token-website').trim(), x: value('token-x').trim(), telegram: value('token-telegram').trim(), discord: value('token-discord').trim(),
    communityTokens: Number(value('community-airdrop-tokens')), creatorBuySol: Number(value('creator-buy-sol')),
    creatorWalletPercent: Number(value('creator-wallet-share')), holderAirdropPercent: Number(value('holder-airdrop-share')),
    solClaimPercent: Number(value('x-share')), xRecipient: normalizeXHandle(value('x-recipient')),
  };
}
function setLaunchProfile(profile){
  launchProfile = profile === 'fast' ? 'fast' : 'community';
  document.querySelectorAll('[data-launch-profile]').forEach(card => {
    const active = card.dataset.launchProfile === launchProfile;
    card.classList.toggle('active', active);
    card.setAttribute('aria-pressed', String(active));
  });
  const pageDetails = document.querySelector('.launch-page-details');
  if (launchProfile === 'community') {
    if (pageDetails) pageDetails.open = true;
    const story = document.querySelector('.launch-optional-story');
    if (story) story.open = true;
    const advanced = document.querySelector('#launch-advanced-options, .launch-fee-options');
    if (advanced) advanced.open = true;
  }
  const hint = document.querySelector('#wizard-hint');
  if (hint && launchStep === 1 && !document.querySelector('#token-name')?.value.trim()) {
    hint.textContent = launchProfile === 'fast' ? 'Quick setup: your 80% creator share goes to your wallet. Add a name and ticker.' : 'Community setup: choose holder and X rewards in Launch settings.';
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
    walletBalanceLamports = balance;
    walletBalanceFetchedAt = Date.now();
    renderWalletBalance();
    if (!feeRouterState.verified || !feeRouterState.address) throw new Error(feeRouterState.status === 'router-verification-unavailable'
      ? 'Fee-router check could not reach Solana. Retry checks.'
      : 'Fee-router policy is not verified on Solana.');
    const creatorBuySol = getCreatorBuySol();
    if (creatorBuySol > 0 && Math.ceil(creatorBuySol * 1_000_000_000) >= balance) throw new Error('Insufficient SOL for the developer buy and network costs. Reduce the buy amount or add SOL.');
    const [{ PUMP_SDK, OnlinePumpSdk }, { normalizeLaunchInput }, { getInitialBuyQuote, prepareFundedLaunchBurn }] = await Promise.all([import('@pump-fun/pump-sdk'), import('./launch-core.js'), import('./launch-flow.js')]);
    const { Keypair, PublicKey } = await getSolana();
    const name = document.querySelector('#token-name').value.trim() || 'Solana Coin';
    const symbol = document.querySelector('#token-symbol').value.trim().toUpperCase() || 'COIN';
    const input = normalizeLaunchInput({ name, symbol, supply: LAUNCH_TOKEN_SUPPLY, decimals: 6 });
    const reserveConfig = await getLaunchReserveConfig();
    const developerBuy = await getInitialBuyQuote({ connection, input: { ...input, initialBuySol: getCreatorBuySol() } });
    const initialBuy = await quoteAtomicReserveBuy({ connection, supply:input.supply, decimals:input.decimals,
      reserveTokens:getCommunityAirdropTokens(), developerBaseUnits:developerBuy.amountBaseUnits });
    initialBuy.curvePremiumBps = initialCurvePremiumBps(initialBuy.amountBaseUnits, initialBuy.global.initialVirtualTokenReserves.toString());
    const mint = Keypair.generate();
    const xLinked = getFeeDistributionInputs().solClaimPercent > 0;
    if (xLinked && !xFeeStatus.ready) throw new Error('Mint-specific X fee claims are not ready on Solana.');
    const mintRouter = buildMintRouterInitializeInstruction({ programId: FEE_ROUTER_PROGRAM_ID, mint: mint.publicKey, payer });
    const router = mintRouter.router.address;
    const launchInstructions = initialBuy.amountBaseUnits > 0n
      ? await PUMP_SDK.createV2AndBuyInstructions({ global:initialBuy.global, mint: mint.publicKey, name: input.name, symbol: input.symbol, uri: `https://funded.vip/devnet-metadata/${mint.publicKey.toBase58()}`, creator: router, user: payer, amount: new (await import('bn.js')).default(initialBuy.amountBaseUnits.toString()), solAmount: new (await import('bn.js')).default(initialBuy.solAmountLamports.toString()), mayhemMode: false, cashback: false, holderReward: false })
      : [await PUMP_SDK.createV2Instruction({ mint: mint.publicKey, name: input.name, symbol: input.symbol, uri: `https://funded.vip/devnet-metadata/${mint.publicKey.toBase58()}`, creator: router, user: payer, mayhemMode: false, holderReward: false })];
    const launchBurn = getLaunchBurnPolicy();
    const burnPlan = launchBurn.requiresBurn
      ? await prepareFundedLaunchBurn({ connection, payer, fundedMint: launchBurn.fundedMint, amountTokens: launchBurn.amountTokens })
      : null;
    const lookupTable = (await connection.getAddressLookupTable(new PublicKey(reserveConfig.lookupTable), { commitment:'finalized' })).value;
    const reserve = launchReserveInstructions({ mint:mint.publicKey, payer, programId:FEE_ROUTER_PROGRAM_ID,
      authority:reserveConfig.authority, reserveTokens:getCommunityAirdropTokens(), decimals:input.decimals });
    let plan;
    let estimates;
    for (let blockhashAttempt = 0; blockhashAttempt < 2; blockhashAttempt += 1) {
      // A finalized hash is visible across every backend in a load-balanced
      // Solana RPC pool. Retry once after the proxy cache window if a backend
      // still reports that it has not observed the hash.
      if (blockhashAttempt > 0) await new Promise(resolve => setTimeout(resolve, 1100));
      const latest = await connection.getLatestBlockhash('finalized');
      plan = buildPumpLaunchPlan({ payer, mint, blockhash: latest.blockhash, launchInstructions, burnInstruction: burnPlan?.instruction,
        mintRouterInstruction: mintRouter?.instruction, reserveInstructions:reserve.instructions, lookupTable });
      const estimateTransactions = plan.steps.map(step => step.transaction);
      try {
        // The split path still simulates every transaction; the legacy path is the original full launch simulation: connection.simulateTransaction(launchTransaction, undefined, [payer]).
        estimates = await Promise.all(estimateTransactions.map(async transaction => {
          const versioned = 'message' in transaction;
          const transactionFee = await connection.getFeeForMessage(versioned ? transaction.message : transaction.compileMessage(), 'confirmed');
          if(transactionFee.value==null)throw new Error('Network fee quote is unavailable. Refresh before signing.');
          const transactionSimulation = versioned
            ? await connection.simulateTransaction(transaction, { sigVerify:false, accounts:{ encoding:'base64', addresses:[payer.toBase58()] } })
            : await connection.simulateTransaction(transaction, undefined, [payer]);
          if (transactionSimulation.value.err) {
            const reason = JSON.stringify(transactionSimulation.value.err);
            throw new Error(`The launch transaction could not be simulated on Solana: ${reason}.`);
          }
          const simulatedPayerBalance = transactionSimulation.value.accounts?.[0]?.lamports;
          const fee = Number(transactionFee.value);
          const estimatedSpend = balance - simulatedPayerBalance;
          if (!Number.isSafeInteger(simulatedPayerBalance) || !Number.isSafeInteger(fee) || !Number.isSafeInteger(estimatedSpend) || estimatedSpend < fee) throw new Error('The full Solana launch cost could not be verified.');
          return { fee, spend: estimatedSpend };
        }));
        break;
      } catch (error) {
        const blockhashMissing = /BlockhashNotFound|blockhash not found/i.test(String(error?.message || error));
        if (!blockhashMissing || blockhashAttempt > 0) throw error;
      }
    }
    if (!plan || !estimates) throw new Error('The Solana blockhash could not be refreshed for launch estimation.');
    const fee = estimates.reduce((total, item) => total + item.fee, 0);
    const estimatedSpend = estimates.reduce((total, item) => total + item.spend, 0);
    if (!Number.isSafeInteger(fee)
      || !Number.isSafeInteger(estimatedSpend) || estimatedSpend < fee) {
      throw new Error('The full Solana launch cost could not be verified.');
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
    estimatedInitialBuyTokens=Number(developerBuy.amountTokens);
    updateLaunchPreview();
    setWalletMetrics({ balance, fee: Number(launchCostReview.budget) });
  } catch (error) {
    if (request === metricsRequest && isWalletSessionCurrent(session)) {
      const rawReason = String(error?.message || 'The exact Solana launch cost could not be verified.');
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
        ? 'Solana RPC is rate limited. Wait a moment, then refresh the estimate.'
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
    if (opening) void refreshWalletBalance({ force: true });
  } : connectWallet;
  const popoverAddress = document.querySelector('#wallet-popover-address');
  const popoverNetwork = document.querySelector('#wallet-popover-network');
  const popoverDetailLink = document.querySelector('#wallet-popover-detail-link');
  if (popoverAddress) popoverAddress.textContent = connected ? `${connectedWalletAddress.slice(0, 4)}…${connectedWalletAddress.slice(-4)}` : 'Wallet';
  if (popoverNetwork) popoverNetwork.textContent = connected ? 'Solana' : 'Not connected';
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
  if (leaderboardLink) { leaderboardLink.href = connected ? '#docs' : '#profile'; leaderboardLink.textContent = connected ? 'View Solana status →' : 'Connect wallet →'; }
  const profileName = document.querySelector('#profile-wallet-name');
  const profileAddress = document.querySelector('#profile-wallet-address');
  const profileAvatar = document.querySelector('#profile-wallet-avatar');
  const profileConnect = document.querySelector('#profile-connect');
  if (profileName) profileName.textContent = connected ? 'Wallet connected' : 'Wallet not connected';
  if (profileAddress) profileAddress.textContent = connected ? `${connectedWalletAddress.slice(0, 4)}…${connectedWalletAddress.slice(-4)}` : 'Connect to review signing';
  if (profileAvatar) profileAvatar.textContent = connected ? '✓' : '◎';
  if (profileConnect) profileConnect.textContent = connected ? 'View wallet details' : 'Connect wallet';
  renderCreatorLaunches();
  renderPortfolio();
  document.querySelector('#profile-address').textContent = connected ? connectedWalletAddress : 'Not connected';
  const profileCopyAddress = document.querySelector('#profile-copy-address');
  if (profileCopyAddress) {
    profileCopyAddress.disabled = !connected;
    profileCopyAddress.title = connected ? 'Copy wallet address' : 'Connect a wallet before copying its address';
  }
  const profileDisconnect = document.querySelector('#profile-disconnect');
  if (profileDisconnect) profileDisconnect.disabled = !connected;
  document.querySelector('#profile-status').textContent = connected ? wallet.remoteMobile ? 'Phantom mobile wallet connected. Scan a new QR to approve each claim or trade on your phone.' : wallet.readOnly ? 'Address linked for viewing. Open this app inside Phantom to sign transactions.' : wallet.devMode ? 'Local signing wallet connected. The local API signs; private keys do not enter this browser app.' : 'Connected locally. Your wallet remains the signer; private keys do not enter this app.' : 'This profile is local to the demo workspace.';
  const launchPathWallet = document.querySelector('#launch-path-wallet');
  if (launchPathWallet) { launchPathWallet.querySelector('strong').textContent = connected ? 'Wallet connected' : 'Connect wallet'; launchPathWallet.querySelector('small').textContent = signingReady ? 'Ready for Solana review.' : connected ? 'Review before signing.' : 'Connect to review signing.'; launchPathWallet.classList.toggle('complete', signingReady); }
  const onboardingWallet = document.querySelector('[data-onboarding-step="creator"]');
  if (onboardingWallet) { onboardingWallet.querySelector('strong').textContent = connected ? 'Wallet connected' : 'Connect your wallet'; onboardingWallet.querySelector('small').textContent = signingReady ? 'Ready to review a launch.' : connected ? 'Review before signing.' : 'Connect to unlock your workspace.'; }
  const claimButton = document.querySelector('#sol-claim-submit');
  if (claimButton) claimButton.textContent = connected && typeof wallet.signMessage === 'function' && !wallet.readOnly ? 'Verify linked wallet' : connected ? 'Open in wallet to verify' : 'Connect wallet to verify';
  updateClaimBindingReview();
  const referralActivity = document.querySelector('#referral-activity-list .empty-state');
  if (referralActivity) {
    renderReferralActivityEmpty(connected ? 'Checking referral activity' : 'Activity appears here', connected
      ? 'Loading your private referral dashboard.' : 'Connect your wallet to see qualified referral activity.');
  }
  const tradeQuote = document.querySelector('#trade-quote');
  if (tradeQuote && (!connected || !signingReady || tradeQuote.textContent.startsWith('Connect your wallet'))) tradeQuote.textContent = signingReady ? 'The current quote appears automatically when you enter an amount.' : connected ? 'Open this app inside your wallet to calculate and approve a trade.' : 'Connect a signing wallet to calculate an exact trade quote.';
  const selectedProgram = document.querySelector('[data-program-tier="standard"].active');
  const programNote = document.querySelector('#program-progress-note');
  if (selectedProgram && programNote) programNote.textContent = signingReady ? 'Wallet connected. Review the fee route and launch cost before signing.' : connected ? 'Address linked. Open inside your wallet before signing.' : 'Enter the name and ticker first. Connect only when you are ready to sign.';
  updatePreviewStatusDrawer(connected);
  if (connected) { bindAppReferralToWallet(); void refreshReferralClaims().catch(() => {}); }
  updateReferralLink();
  updateOnboardingProgress();
  renderAirdropClaims();
  updateLaunchButton();
  if (connected) { setWalletMetrics({ loading: true }); void refreshWalletBalance(); if (feeRouterState.status !== 'checking') refreshWalletInfo(); }
  else setWalletMetrics();
  renderWalletDetail();
  void loadFundedBurnState({ force: true });
  updateTokenChatComposerState();
  if (currentCoinFeeOverview) renderCoinFeeDashboard(currentCoinFeeOverview);
}
async function connectWallet(){
  if (APP_MAINNET_READ_ONLY) {
    setLaunchStatus('This workspace is read-only. Wallet connection and signing are disabled.', true);
    showToast('This workspace is read-only. Wallet actions are disabled.');
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
  if(destination)destination.textContent=address?`Solana · ${address}`:'Connect the wallet that should receive this claim.';
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
  let claimExecutionRequested = false, claimVerified = false;
  emitPilotSignal('claim-started');
  try {
    const identity = await apiRequest('/api/x/me');
    assertWalletSessionCurrent(session);
    if (!identity.data?.authenticated || `@${identity.data.user.username}`.toLowerCase() !== handle.toLowerCase()) throw new Error('Sign in with the X account named in this claim first.');
    if (status) status.textContent = 'Preparing claim…';
    const prepared = await apiRequest(`/api/sol-claims/${encodeURIComponent(claimId)}/prepare`, { method: 'POST', body: { xHandle: handle } });
    assertWalletSessionCurrent(session);
    if(!prepared.available||!prepared.data?.statement)throw new Error('Claim preparation unavailable. No wallet signature requested.');
    if(prepared.data.boundWallet&&prepared.data.boundWallet!==session.address)throw new Error(`This claim is already bound to ${prepared.data.boundWallet}. Connect that wallet; redirection is not supported.`);
    if (status) status.textContent = 'Verifying X identity…';
    await apiRequest(`/api/sol-claims/${encodeURIComponent(claimId)}/attest`, { method: 'POST', body: { xHandle: handle } });
    assertWalletSessionCurrent(session);
    if (status) status.textContent = 'Requesting wallet signature…';
    const message = new TextEncoder().encode(prepared.data.statement);
    const signed = await session.provider.signMessage(message);
    assertWalletSessionCurrent(session);
    const publicKey = session.address;
    const verified = await apiRequest(`/api/sol-claims/${encodeURIComponent(claimId)}/verify`, { method: 'POST', body: { xHandle: handle, publicKey, signature: bs58.encode(signed.signature || signed) } });
    if (!isWalletSessionCurrent(session)) return { verified };
    if (verified.data?.automaticStatus) {
      const claims = await refreshXClaims();
      if (!isWalletSessionCurrent(session)) return { verified };
      const paidClaim = claims?.find(claim => claim.id === claimId && claim.receiptVerified === true && claim.payoutWallet === publicKey);
      claimVerified = Boolean(paidClaim);
      emitPilotSignal(claimVerified ? 'claim-verified' : 'claim-pending');
      if (status) status.textContent = claimVerified
        ? `Verified payment of ${paidClaim.amountSol} SOL to ${publicKey}. Transaction: ${paidClaim.payoutSignature}`
        : 'Wallet verified. Automatic SOL delivery is in progress; check this reward for its payment receipt.';
      return { verified };
    }
    if (status) status.textContent = 'Settling the mint-specific claim on Devnet…';
    claimExecutionRequested = true;
    const paid = await apiRequest(`/api/sol-claims/${encodeURIComponent(claimId)}/execute`, { method: 'POST' });
    if (!isWalletSessionCurrent(session)) return { verified, paid };
    if(!paid.available||!paid.data?.signature)throw new Error('Payout outcome is uncertain. Refresh rewards; do not submit another payout.');
    const checked=await apiRequest('/api/x-fee/claims').catch(()=>null);
    if(!isWalletSessionCurrent(session))return {verified,paid};
    const confirmed=confirmedClaimResult(checked?.data?.claims,claimId,paid.data.signature);
    claimVerified = Boolean(confirmed);
    emitPilotSignal(claimVerified ? 'claim-verified' : 'claim-pending');
    if (status) status.textContent = confirmed?`Verified payment of ${confirmed.amountSol} SOL to ${publicKey}. Transaction: ${confirmed.payoutSignature}`:'Settlement response received. Payment verification is pending; refresh rewards later. Do not submit another payout.';
    showToast(confirmed?'Payment receipt verified':'Payment verification pending');
    await refreshXClaims();
    return { verified, paid };
  } catch (error) { if (!claimVerified) emitPilotSignal(pilotInterruptedSignal('claim', error, claimExecutionRequested)); if (isWalletSessionCurrent(session)) { if (status) status.textContent = error.message || 'Claim failed.'; showToast(error.message || 'Claim failed'); } }
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
    else void refreshWalletBalance();
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
  if (mint) {
    const page = document.querySelector('#buybacks');
    if (page) {
      let prompt = page.querySelector('#launch-share-prompt');
      if (!prompt) { prompt = document.createElement('div'); prompt.id = 'launch-share-prompt'; prompt.className = 'share-insights'; page.prepend(prompt); }
      prompt.replaceChildren();
      const title = document.createElement('strong'); title.textContent = `${launchPolicy.name || launchPolicy.symbol || 'Coin'} launched on Solana`;
      const note = document.createElement('small'); note.textContent = 'Your confirmed coin has a link visitors can open and watch. Share it when ready.';
      const button = document.createElement('button'); button.type = 'button'; button.className = 'primary-button'; button.textContent = 'Share launch';
      button.addEventListener('click', () => openCoinShare(mint, launchPolicy.symbol, launchPolicy.name));
      prompt.append(title, note, button);
    }
  }
  if (location.hash !== '#buybacks') location.hash = '#buybacks';
  else syncPageRoute();
}
let airdropRequestInFlight = false;
async function requestAirdrop(){
  if (APP_CLUSTER !== 'devnet') { setLaunchStatus('Test SOL is available only on Devnet. No faucet request was sent.', true); return; }
  if (airdropRequestInFlight) return;
  airdropRequestInFlight = true;
  const button = document.querySelector('#airdrop-button'); button.disabled = true;
  let session = null, signature = '', requestStarted = false;
  const transactionLinks = () => [{ label: 'View airdrop transaction on Explorer', href: explorer(`tx/${encodeURIComponent(signature)}`) }];
  const walletLinks = () => [{ label: 'View Devnet wallet on Explorer', href: explorer(`address/${encodeURIComponent(session.address)}`) }];
  try {
    if (!wallet) { await connectWallet(); if (!wallet) return; }
    session = captureWalletSession();
    if (!session) return;
    const { LAMPORTS_PER_SOL } = await getSolana();
    assertWalletSessionCurrent(session);
    setLaunchStatus('Requesting 1 Devnet SOL…');
    requestStarted = true;
    const receipt = await connection.requestAirdrop(session.provider.publicKey, LAMPORTS_PER_SOL);
    if (!isWalletSessionCurrent(session)) return;
    let validSignature = false;
    if (typeof receipt === 'string' && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(receipt)) {
      try { validSignature = bs58.decode(receipt).length === 64; } catch { /* Unknown receipt; never build a transaction link from it. */ }
    }
    if (!validSignature) {
      setLaunchLinks('The faucet request outcome is unknown; no valid transaction signature was returned. Check this Devnet wallet on Explorer before requesting more test SOL.', walletLinks(), true);
      return;
    }
    signature = receipt;
    const confirmation = await connection.confirmTransaction(signature, 'confirmed');
    if (!isWalletSessionCurrent(session)) return;
    if (confirmation?.value?.err === null) {
      setLaunchLinks('Airdrop confirmed.', transactionLinks());
      // Refresh failures concern the displayed balance, not the confirmed receipt.
      try { await refreshWalletInfo(); }
      catch { if (isWalletSessionCurrent(session)) setLaunchLinks('Airdrop confirmed. The wallet balance could not be refreshed; check the transaction on Explorer.', transactionLinks()); }
    } else if (confirmation?.value?.err !== undefined) {
      setLaunchLinks('The airdrop transaction failed on Devnet. Review its result on Explorer before requesting more test SOL.', transactionLinks(), true);
    } else {
      setLaunchLinks('Airdrop outcome is unknown because confirmation was incomplete. Check this transaction on Explorer before requesting more test SOL.', transactionLinks(), true);
    }
  } catch (error) {
    if (!session || !isWalletSessionCurrent(session)) return;
    if (signature) {
      setLaunchLinks('Airdrop outcome is unknown. Confirmation could not be completed. Check this transaction on Explorer before requesting more test SOL.', transactionLinks(), true);
    } else if (!requestStarted) {
      setLaunchStatus('The Devnet airdrop could not be prepared. Check your wallet connection and try again.', true);
    } else {
      const message = String(error?.message || error).toLowerCase();
      const uncertain = /timed?\s*out|timeout|network|failed to fetch|disconnect|socket|abort|internal error|service unavailable/.test(message);
      const faucetIssue = /429|rate limit|faucet|unsupported solana rpc request|not allowed|disabled/.test(message);
      if (faucetIssue && !uncertain) {
        setLaunchLinks('The API faucet did not confirm this request. Check your Devnet wallet balance before using the Solana Faucet.', [{ label: 'Open Solana Faucet', href: 'https://faucet.solana.com/' }], true);
      } else {
        setLaunchLinks('The faucet request outcome is unknown; no transaction signature was returned. Check this Devnet wallet on Explorer before requesting more test SOL.', walletLinks(), true);
      }
    }
  } finally { airdropRequestInFlight = false; button.disabled = false; }
}

async function launchToken(){
  if (APP_CLUSTER !== 'devnet') {
    setLaunchStatus('Coin launching is unavailable in this workspace.', true);
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
  if (invalidSocial) { const details = invalidSocial.closest('details'); if (details) details.open = true; invalidSocial.reportValidity(); setLaunchStatus(invalidSocial.validationMessage, true); return; }
  if (!Number.isSafeInteger(communityTokens) || communityTokens < MIN_COMMUNITY_AIRDROP_TOKENS || communityTokens > MAX_COMMUNITY_AIRDROP_TOKENS || !Number.isFinite(communityAllocation)) { setLaunchStatus('Community airdrop must be between 30,000,000 and 500,000,000 tokens.', true); return; }
   if (feeDistributionInput.solClaimPercent > 0 && !/^@[A-Za-z0-9_]{1,15}$/.test(xRecipient)) { setLaunchStatus('Enter a valid X handle such as @account when X account rewards are above 0%.', true); return; }
  if (feeDistributionInput.solClaimPercent > 0 && !xFeeStatus.ready) { setLaunchStatus(`X account rewards unavailable: ${xFeeFailureDetail()}.`, true); return; }
  if (!feeDistribution.valid) { setLaunchStatus('Creator fee shares must total exactly 80%. Check the wallet, holder, and X percentages.', true); return; }
  if (!launchBurnValidation.valid) { setLaunchStatus('The fixed $FUNDED mint must be configured before a paid launch tier can be used.', true); return; }
  if (launchBurn.requiresBurn && (!currentLaunchTierQuote() || launchBurn.quoteId !== currentLaunchTierQuote().id)) {
    setLaunchStatus('The $FUNDED tier quote expired or changed. Review the launch again.', true); return;
  }
  if (launchBurn.requiresBurn && !launchBurnReadiness.ready) { setLaunchStatus(launchBurnReadiness.message, true); return; }
  if (!feeRouterState.verified || !feeRouterState.address) { setLaunchStatus('Launch blocked until the funded.vip fee-router PDA is deployed and verified on Solana.', true); return; }
  const reviewedCost=launchCostReview;
  if(!freshLaunchReview(reviewedCost)){setLaunchStatus('Estimate expired. Refresh the launch estimate before signing.',true);return;}
  if (walletBalanceLamports == null || estimatedLaunchFeeLamports == null) { setLaunchStatus('Wallet balance and launch cost could not be verified. Refresh the estimate before signing.', true); return; }
  if (walletBalanceLamports != null && estimatedLaunchFeeLamports != null && walletBalanceLamports < estimatedLaunchFeeLamports) { setLaunchStatus('Insufficient SOL for this launch. Fund the wallet, then refresh the balance and fee estimate before signing.', true); return; }
  document.querySelector('#launch-button').disabled = true;
  let journalId, pilotLaunchVerified = false;
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
    if (launchBurn.requiresBurn && (!currentLaunchTierQuote() || launchBurn.quoteId !== currentLaunchTierQuote().id || launchBurn.amountTokens !== currentLaunchTierQuote().amountTokens))
      throw new Error('The $FUNDED tier quote expired before signing. Review the launch again.');
    const reserveConfig = await getLaunchReserveConfig();
    assertWalletSessionCurrent(session);
    if (launchBurn.requiresBurn && (!currentLaunchTierQuote() || launchBurn.quoteId !== currentLaunchTierQuote().id))
      throw new Error('The $FUNDED tier quote expired before signing. Review the launch again.');
    journalId=crypto.randomUUID();recordLaunchEvent(journalId,{state:'prepared',name,symbol,payer:session.address,cluster:'devnet'});
    emitPilotSignal('launch-submission-started');
    const result = await submitPumpDevnetLaunch({ cluster: APP_CLUSTER, connection, provider: session.provider, payer: session.provider.publicKey, input: { name, symbol, supply, decimals, initialBuySol: creatorBuySol, reserveTokens:communityTokens, maxInitialBuyLamports:reviewedCost.buyMaximum }, prepareMetadata: input => prepareLaunchMetadata(input, session), feeRouterAddress: feeRouterState.address, feeRouterProgramId: FEE_ROUTER_PROGRAM_ID, useMintRouter: true, launchBurn, reserveConfig, assertWalletCurrent: () => assertWalletSessionCurrent(session), onJournal:event=>recordLaunchEvent(journalId,event), onStatus: message => { if (isWalletSessionCurrent(session)) setLaunchStatus(message); } });
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
      initialBuy: result.initialBuy ? { percent: result.initialBuy.percent, amountTokens: result.initialBuy.amountTokens, developerAmountTokens:result.initialBuy.developerAmountTokens,
        amountBaseUnits: result.initialBuy.amountBaseUnits.toString(), solAmountLamports: result.initialBuy.solAmountLamports.toString() } : null,
      communityAllocation,
      communityAirdrop: fundedCommunityAirdropPolicy({ allocationPercent: communityAllocation, supply, receipt:result.reserveReceipt }),
      launchReserve: { ...buildLaunchReservePlan({ allocationPercent: communityAllocation, supply, mintAddress: result.mint.publicKey.toBase58() }),
        atomic:true, instructions:['Pump createV2', 'Pump buy', 'Create vault token account', 'TransferChecked'],
        onChainStatus:'funded', fundingSignature:result.signature, vault:result.reserveReceipt.vault },
      reserveReceipt:result.reserveReceipt,
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
      pilotLaunchVerified = verifiedPilotLaunchRegistration(persistedLaunch, launchPolicy.mint);
      if (pilotLaunchVerified) emitPilotSignal('launch-confirmed');
      if(persistedLaunch.available){
        recordLaunchEvent(journalId,{state:'completed'});
        localStorage.removeItem(`funded.launch.${launchPolicy.mint}`);
      }
    } catch (policyError) {
      if (isWalletSessionCurrent(session)) setLaunchStatus(`Coin confirmed on Solana, but policy registration is pending: ${policyError.message}`, true);
    }
    if (!verifiedPilotLaunchRegistration(persistedLaunch, launchPolicy.mint)) emitPilotSignal('launch-registration-pending');
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
    setLaunchLinks(`Launch verified ✓\n${result.name} (${result.symbol}) is confirmed on Solana.\nMint: ${result.mint.publicKey.toBase58()}\nLaunch tier: ${launchBurn.label}${burnSummary}\nPump creator-fee owner: funded.vip router\nYour wallet has no creator-fee authority.\nCommunity reserve funded: ${communityAllocation}% (${launchPolicy.communityAirdrop.reservedTokens.toLocaleString()} tokens)\nReward vault: ${result.reserveReceipt.vault}\nClaims open after a verified migration snapshot.\nSettlement policy: 80% creator-directed / 20% app protocol${feeDistributionInput.solClaimPercent > 0 ? `\nSOL claim recipient: ${xRecipient}` : ''}`, launchLinks);
    document.querySelector('#launch-status').classList.add('launch-complete');
    showToast(persistedLaunch.available ? `${result.symbol} launched and listed in Explore` : `${result.symbol} launched on-chain; Explore listing is pending API verification`); renderAirdropClaims(); refreshWalletInfo(); openBurnPageAfterLaunch(launchPolicy);
  } catch (error) {
    let saved=readLaunchJournal().find(row=>row.id===journalId);
    if(journalId&&saved?.state==='prepared')saved=recordLaunchEvent(journalId,{state:'failed',message:error.message});
    const needsRecovery=Boolean(saved&&(saved.signature||saved.events?.some(event=>event.signature||['broadcasting','submitted','confirmed','verification-pending','registration-pending','unknown'].includes(event.state))));
    if (!pilotLaunchVerified) emitPilotSignal(pilotInterruptedSignal('launch', error, needsRecovery));
    if (isWalletSessionCurrent(session)) {
      const message = `Launch stopped: ${error.message}${needsRecovery ? ' A transaction may have reached Solana. Check its receipt before attempting another launch.' : ' No transaction was sent; correct the issue and retry.'}`;
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
    if(!row||row.cluster!=='devnet')throw new Error('No pending Solana registration matches this request.');
    const policy=JSON.parse(localStorage.getItem(`funded.launch.${mint}`)||'null');if(!policyMatchesJournal(policy,row))throw new Error('Saved policy does not match this launch. Do not recreate the coin.');
    const session=captureWalletSession();if(!session||session.address!==row.payer)throw new Error('Connect the original launch wallet before registration.');assertWalletSessionCurrent(session);
    if(!policy.policySignature){if(typeof session.provider.signMessage!=='function')throw new Error('This wallet must support message signing.');const signed=await session.provider.signMessage(new TextEncoder().encode(launchPolicyStatement(policy)));assertWalletSessionCurrent(session);policy.policySignature=bs58.encode(signed.signature||signed);localStorage.setItem(`funded.launch.${mint}`,JSON.stringify(policy));}
    report('Checking the original launch and policy with the API. No coin transaction is being sent.');
    const result=await apiRequest('/api/launches',{method:'POST',body:policy});if(!result.available||result.data?.mint!==mint||!result.data?.onchainVerified)throw new Error('Registration is still pending verified API evidence.');
    if (verifiedPilotLaunchRegistration(result, mint)) emitPilotSignal('launch-confirmed');
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
document.querySelector('#launch-review-retry')?.addEventListener('click', async () => {
  if (!feeRouterState.verified) await refreshFeeRouterConfig();
  else if (wallet) await refreshWalletInfo();
  updateLaunchNavigation();
});
document.querySelectorAll('#token-name, #token-symbol, #token-description, #token-tagline, #token-roadmap, #token-website, #token-x, #token-telegram, #token-discord, #x-recipient, #community-airdrop-tokens, #creator-buy-sol').forEach(input => input.addEventListener('input', () => {
  if (input.matches('#token-name, #token-symbol')) { input.dataset.launchTouched = 'true'; updateLaunchIdentityWarnings(); }
  if (LAUNCH_SOCIAL_FIELDS.includes(input.id)) updateLaunchSocialValidity(input);
  if (input.matches('#community-airdrop-tokens')) syncCommunityAirdropPresets();
  updateLaunchPreview();
  updateCostSummary();
  updateLaunchButton();
  if (input.matches('#token-name, #token-symbol, #creator-buy-sol')) scheduleLaunchCostRefresh();
}));
document.querySelectorAll('#token-name, #token-symbol').forEach(input => input.addEventListener('blur', () => {
  input.dataset.launchTouched = 'true';
  updateLaunchIdentityWarnings();
}));
document.querySelector('#token-x')?.addEventListener('change', event => {
  normalizeLaunchSocialField(event.currentTarget);
  updateLaunchSocialValidity(event.currentTarget);
  updateLaunchPreview();
  updateLaunchButton();
});
document.querySelectorAll('[data-airdrop-tokens]').forEach(button => button.addEventListener('click', () => {
  const input = document.querySelector('#community-airdrop-tokens');
  if (!input) return;
  input.value = button.dataset.airdropTokens;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}));
let imagePreparationRevision = 0;
document.querySelector('#token-image')?.addEventListener('change', async event => {
  const revision = ++imagePreparationRevision;
  const file = event.target.files?.[0];
  const preview = document.querySelector('#token-image-preview');
  const cardPreview = document.querySelector('#preview-token-image');
  const cardPlaceholder = document.querySelector('#preview-token-image-placeholder');
  const packageArtwork = document.querySelector('#launch-package-example-art');
  if (!preview) return;
  const status=document.querySelector('#image-preparation-status');
  const removeButton=document.querySelector('#image-remove');
  if(removeButton)removeButton.disabled=!file;
  preview.style.backgroundImage='';preview.textContent=file?'…':'⌁';if(cardPreview){cardPreview.style.backgroundImage='';cardPreview.classList.remove('has-image');}if(packageArtwork){packageArtwork.style.backgroundImage='';packageArtwork.classList.remove('has-image');}if(cardPlaceholder)cardPlaceholder.hidden=false;if(status)status.textContent=file?'Preparing locally. Nothing is uploaded yet.':'No image selected.';
  try{const image=await prepareLaunchImage(file,{crop:document.querySelector('#image-square-crop')?.checked});if(revision!==imagePreparationRevision||file!==event.target.files?.[0])return;if(image){preview.textContent='';preview.style.backgroundImage=`url(${image.url})`;if(cardPreview){cardPreview.style.backgroundImage=`url(${image.url})`;cardPreview.classList.add('has-image');}if(packageArtwork){packageArtwork.style.backgroundImage=`url(${image.url})`;packageArtwork.classList.add('has-image');}if(cardPlaceholder)cardPlaceholder.hidden=true;if(status)status.textContent=`Ready: ${image.width} × ${image.height}, ${Math.ceil(image.file.size/1000)} KB. Review the preview before signing.`;}}
  catch(error){if(revision!==imagePreparationRevision||file!==event.target.files?.[0])return;await prepareLaunchImage(null);event.target.value='';if(removeButton)removeButton.disabled=true;if(status)status.textContent=error.message;preview.textContent='!';}
  updateLaunchPreview();updateLaunchButton();
});
document.querySelector('#terms-agree').addEventListener('change', updateLaunchButton);
document.querySelector('#fee-route-agree').addEventListener('change', updateLaunchButton);
document.querySelector('#launch-next').addEventListener('click', () => setLaunchStep(launchStep + 1));
document.querySelector('#launch-back').addEventListener('click', () => setLaunchStep(launchStep - 1));
document.querySelector('#launch-mode-quick').addEventListener('click', () => setLaunchMode('quick'));
document.querySelector('#launch-mode-custom').addEventListener('click', () => setLaunchMode('custom'));
document.querySelectorAll('[data-launch-profile]').forEach(card => card.addEventListener('click', () => setLaunchMode(card.dataset.launchProfile === 'community' ? 'custom' : 'quick')));
setLaunchProfile('fast');
document.querySelectorAll('.creator-burn-card[data-burn-tier]').forEach(button => button.addEventListener('click', () => setLaunchBurnTier(button.dataset.burnTier)));
document.querySelector('#launch-tier-refresh')?.addEventListener('click', async () => {
  await Promise.allSettled([refreshLaunchTierPricing(), loadFundedBurnState({ force:true })]);
  if (wallet) scheduleLaunchCostRefresh();
});
document.querySelectorAll('[data-launch-step-target]').forEach(button => button.addEventListener('click', () => { const target = Number(button.dataset.launchStepTarget); setLaunchStep(target); }));
document.querySelectorAll('[data-copy-referral-link]').forEach(button => button.addEventListener('click', async () => { const code = await referralCodeForShare(); if (!code) return; const link = buildReferralUrl(code); try { await navigator.clipboard.writeText(link); trackReferralEvent('invite_link_copied'); showToast('Invite link copied'); } catch { showToast(link); } }));
document.querySelector('#referral-share-native')?.addEventListener('click', async () => { const code = await referralCodeForShare(); if (!code) return; openShareComposer({ kind:'referral', title:'Join funded.vip', text:'Explore verified launches and published fee routes with me on funded.vip.', url:buildReferralUrl(code) }); });
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
    openShareComposer({ kind:'referral', title:'Join funded.vip', text:'Explore verified launches and published fee routes with me on funded.vip.', url:buildReferralUrl(code) });
  });
  const messageButton = document.createElement('button');
  messageButton.type = 'button'; messageButton.className = 'secondary-button'; messageButton.textContent = 'Copy message';
  messageButton.addEventListener('click', async () => {
    const code = await referralCodeForShare();
    if (!code) return;
    const link = buildReferralUrl(code);
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
document.querySelector('#info-dialog').addEventListener('cancel', event => {
  event.preventDefault();
  closeInfoDialog();
});
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
  walletDetailFilter = 'all';
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
document.querySelector('#launch-review-dialog')?.addEventListener('close', () => { if (pendingLaunchReview) emitPilotSignal('launch-review-cancelled'); pendingLaunchReview = null; });
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
const coinQuickAmountDefaults = ['0.1', '0.25', '0.5', '1', '2', '5'];
const coinQuickAmountKey = 'funded.coin-quick-buy-amounts.v1';
const coinQuickAmountButtons = [...document.querySelectorAll('[data-coin-buy-amount]')];
function validCoinQuickAmount(value) {
  return /^\d+(?:\.\d{1,9})?$/.test(String(value)) && Number(value) > 0 && Number(value) <= 100;
}
function applyCoinQuickAmounts(values) {
  coinQuickAmountButtons.forEach((button, index) => {
    button.dataset.coinBuyAmount = String(values[index]);
    button.textContent = `${values[index]} SOL`;
  });
}
try {
  const saved = JSON.parse(localStorage.getItem(coinQuickAmountKey) || 'null');
  applyCoinQuickAmounts(Array.isArray(saved) && saved.length === coinQuickAmountButtons.length && saved.every(validCoinQuickAmount) ? saved : coinQuickAmountDefaults);
} catch { applyCoinQuickAmounts(coinQuickAmountDefaults); }
const coinQuickDialog = document.querySelector('#coin-quick-edit-dialog');
const coinQuickFields = document.querySelector('#coin-quick-edit-fields');
if (coinQuickFields) coinQuickFields.innerHTML = coinQuickAmountButtons.map((_, index) => `<label>Amount ${index + 1}<span><input type="text" inputmode="decimal" aria-label="Quick amount ${index + 1} in SOL" required /> SOL</span></label>`).join('');
document.querySelector('#coin-quick-edit-trigger')?.addEventListener('click', () => {
  const inputs = [...coinQuickFields.querySelectorAll('input')];
  inputs.forEach((input, index) => { input.value = coinQuickAmountButtons[index].dataset.coinBuyAmount; });
  document.querySelector('#coin-quick-edit-error').textContent = '';
  coinQuickDialog.showModal();
  inputs[0]?.focus();
});
document.querySelector('#coin-quick-edit-reset')?.addEventListener('click', () => {
  coinQuickFields.querySelectorAll('input').forEach((input, index) => { input.value = coinQuickAmountDefaults[index]; });
  document.querySelector('#coin-quick-edit-error').textContent = '';
});
document.querySelector('#coin-quick-edit-cancel')?.addEventListener('click', () => coinQuickDialog.close());
document.querySelector('#coin-quick-edit-form')?.addEventListener('submit', event => {
  event.preventDefault();
  const values = [...coinQuickFields.querySelectorAll('input')].map(input => input.value.trim());
  if (values.length !== coinQuickAmountButtons.length || !values.every(validCoinQuickAmount)) {
    document.querySelector('#coin-quick-edit-error').textContent = 'Enter six SOL amounts above 0 and at most 100, with up to nine decimal places.';
    return;
  }
  applyCoinQuickAmounts(values);
  try { localStorage.setItem(coinQuickAmountKey, JSON.stringify(values)); } catch {}
  coinQuickDialog.close();
});
coinQuickDialog?.addEventListener('close', () => document.querySelector('#coin-quick-edit-trigger')?.focus());
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
let pendingTradeMint = null;
try {
  const storedMint = sessionStorage.getItem('funded.pendingTradeMint');
  if (storedMint) {
    sessionStorage.removeItem('funded.pendingTradeMint');
    pendingTradeMint = storedMint;
  }
} catch { /* This optional handoff must not block startup or replay an unconsumed hint. */ }
const requestedTradeMint = getCoinMintAddress();
if (pendingTradeMint && (!requestedTradeMint || pendingTradeMint === requestedTradeMint) && document.querySelector('#trade-mint')) {
  document.querySelector('#trade-mint').value = pendingTradeMint;
  void refreshTradeBalances();
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
  exploreMinVolumeUsd = null;
  exploreMinMarketCapUsd = null;
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
  try { sessionStorage.setItem('funded.pendingTradeMint', mint); } catch { /* The destination URL already carries the selected mint. */ }
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
    const search = document.querySelector('#global-search');
    if (search.getClientRects().length) {
      search.focus();
      search.select();
    } else {
      const dialog = document.querySelector('#header-search-dialog');
      if (!dialog?.open) document.querySelector('#header-search-trigger')?.click();
      else { document.querySelector('#header-search-input')?.focus(); document.querySelector('#header-search-input')?.select(); }
    }
  }
});
document.querySelector('#explore-search')?.addEventListener('input', event => {
  exploreQuery = event.target.value;
  const field = document.querySelector('#global-search');
  if (field && field.value !== exploreQuery) field.value = exploreQuery;
  updateExploreViews();
});
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
document.querySelector('#explore-min-volume-sol')?.addEventListener('input', () => { exploreMinVolumeUsd = readOptionalSolFilter('#explore-min-volume-sol'); updateExploreViews(); });
document.querySelector('#explore-min-cap-sol')?.addEventListener('input', () => { exploreMinMarketCapUsd = readOptionalSolFilter('#explore-min-cap-sol'); updateExploreViews(); });
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
document.querySelectorAll('[data-explore-view]').forEach(button => button.addEventListener('click', () => { exploreView = button.dataset.exploreView; try { localStorage.setItem(EXPLORE_VIEW_KEY, exploreView); } catch {} renderExploreControls(); }));
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
document.querySelector('#scanner-pagination')?.addEventListener('click', event => {
  const button = event.target.closest('[data-registry-page]');
  if (!button || button.disabled) return;
  const requested = button.dataset.registryPage;
  registryPage = requested === 'next' ? registryPage + 1 : requested === 'prev' ? registryPage - 1 : Number(requested);
  renderRegistry();
  document.querySelector('.scanner-scroll')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
});
document.querySelector('#asset-grid').addEventListener('click', async event => {
  const boost = event.target.closest('[data-boost-mint]');
  if (boost) { openExploreBoost(boost.dataset.boostMint); return; }
  const button = event.target.closest('.watch-button');
  const share = event.target.closest('.share-asset');
  const emptyAction = event.target.closest('[data-explore-empty-action]');
  if (emptyAction) { if (emptyAction.dataset.exploreEmptyAction === 'clear') clearExploreFilters(); else loadOnchainExploreData().catch(() => showToast('Retry could not verify Devnet data.')); return; }
  if (share) { openCoinShare(share.dataset.shareMint || '', share.dataset.shareSymbol || 'Coin', share.dataset.shareName || ''); return; }
 if (!button) return;
  toggleExploreWatch(button.dataset.mint, button);
});
function toggleExploreWatch(mint, button){
  const asset = assets.find(item => item.address === mint);
  const symbol = asset?.symbol || verifiedLaunchPolicyForMint(mint)?.symbol || 'TOKEN';
  if (!saveWatchlist(mint, { remove: button?.getAttribute('aria-pressed') === 'true' })) return;
  renderWatchlist();
  // Keep the current cards mounted so a follow-up action on the same card
  // cannot lose its click while the watchlist changes.
  if (exploreRisk === 'watchlist') updateExploreViews();
  else renderRegistry();
  if (homeLaunchTab === 'watchlist') renderHomeLaunchBoard();
  showToast(lastKnownWatchlist.includes(mint) ? `${symbol} saved to your watchlist` : `${symbol} removed from your watchlist`);
}
document.addEventListener('click', event => {
  const watch = event.target.closest('.token-card-action-watch');
  if (watch) {
    event.preventDefault();
    event.stopPropagation();
    if (watch.dataset.mint) toggleExploreWatch(watch.dataset.mint, watch);
    return;
  }
  const share = event.target.closest('.token-card-action-share');
  if (share) {
    event.preventDefault();
    event.stopPropagation();
    openCoinShare(share.dataset.shareMint || '', share.dataset.shareSymbol || 'Coin', share.dataset.shareName || '');
  }
}, true);
document.querySelector('#watchlist-items').addEventListener('click', event => {
  const trade = event.target.closest('[data-trade-mint]');
  if (trade) { openExploreTrade(trade.dataset.tradeMint); return; }
  const retry = event.target.closest('[data-watch-retry]');
  if (retry) { retry.disabled = true; void Promise.allSettled([loadVerifiedLaunchPolicies(), loadOnchainExploreData()]).then(() => renderWatchlist()); return; }
  const button = event.target.closest('[data-remove-watch]');
  if (!button) return;
  if (!saveWatchlist(button.dataset.removeWatch, { remove: true })) return;
  updateExploreViews();
});
document.querySelector('#creator-launch-empty')?.addEventListener('click', event => {
  const watch = event.target.closest('.watch-button');
  if (watch) { toggleExploreWatch(watch.dataset.mint, watch); return; }
  const share = event.target.closest('.share-asset');
  if (share) { openCoinShare(share.dataset.shareMint || '', share.dataset.shareSymbol || 'Coin', share.dataset.shareName || ''); return; }
  const trade = event.target.closest('[data-trade-mint]');
  if (trade) { openExploreTrade(trade.dataset.tradeMint); return; }
  if (event.target.closest('button, a')) return;
  const mint = event.target.closest('.asset-card')?.dataset.mint;
  if (mint) location.href = `/token/${encodeURIComponent(mint)}`;
});
document.querySelector('#home-launch-grid')?.addEventListener('click', async event => {
  const copy = event.target.closest('.home-launch-copy-address');
  if (copy) {
    event.preventDefault();
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(copy.dataset.copyAddress);
      showToast(copy.dataset.copyKind === 'creator' ? 'Creator wallet address copied' : 'Token address copied');
    } catch {
      showToast('Could not copy address');
    }
    return;
  }
  const boost = event.target.closest('[data-boost-mint]');
  if (boost) { openExploreBoost(boost.dataset.boostMint); return; }
  const trade = event.target.closest('[data-trade-mint]');
  if (trade) openExploreTrade(trade.dataset.tradeMint);
});
document.addEventListener('click', async event => {
  const copy = event.target.closest('.token-card-copy-address, .home-launch-copy-address');
  if (!copy) return;
  event.preventDefault();
  event.stopPropagation();
  try {
    await navigator.clipboard.writeText(copy.dataset.copyAddress);
    showToast(copy.dataset.copyKind === 'creator' ? 'Creator wallet address copied' : 'Token address copied');
  } catch {
    showToast('Could not copy address');
  }
}, true);
document.querySelector('#airdrop-claim-list')?.addEventListener('click', event => {
  const live = event.target.closest('[data-check-community-mint]');
  if (live) {
    const program = getAirdropPrograms().find(row => row.id === live.dataset.checkCommunityMint);
    if (program) { renderAirdropProgramDetail(program); void checkCommunityClaim(program.id).catch(error => showToast(String(error.message || error))); }
    return;
  }
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
  airdropDirectoryPage = 1;
  renderAirdropDirectory();
});
document.addEventListener('funded:airdrop-directory-status', event => {
  if (!['upcoming','claiming','closed'].includes(event.detail?.status)) return;
  airdropDirectoryStatus = event.detail.status;
  airdropDirectoryPage = 1;
  document.querySelector('#airdrop-selected-program').hidden = true;
  renderAirdropDirectory();
});
document.querySelector('#airdrop-directory-pagination')?.addEventListener('click', event => {
  const button = event.target.closest('[data-airdrop-page]');
  if (!button || button.disabled) return;
  airdropDirectoryPage += button.dataset.airdropPage === 'next' ? 1 : -1;
  document.querySelector('#airdrop-selected-program').hidden = true;
  renderAirdropDirectory();
});
document.querySelector('#airdrop-directory')?.addEventListener('click', event => {
  const button = event.target.closest('[data-directory-mint]');
  if (!button) return;
  const program = getAirdropPrograms().find(item => item.id === button.dataset.directoryMint);
  if (!program) return;
  renderAirdropProgramDetail(program);
  document.querySelector('#airdrop-selected-program')?.scrollIntoView({ block: 'start' });
});
document.querySelector('#airdrop-detail-close')?.addEventListener('click', () => { document.querySelector('#airdrop-selected-program').hidden = true; });
document.querySelector('#airdrop-selected-status')?.addEventListener('click', event => {
  const button = event.target.closest('[data-fund-community-mint]');
  if (button) void fundCommunityReserve(button.dataset.fundCommunityMint);
  const check = event.target.closest('[data-check-community-mint]');
  if (check) void checkCommunityClaim(check.dataset.checkCommunityMint).catch(error => showToast(String(error.message || error)));
  const claim = event.target.closest('[data-claim-community-mint]');
  if (claim) void submitCommunityClaim(claim.dataset.claimCommunityMint);
});
document.querySelector('#leaderboard-sort')?.addEventListener('change', () => renderAirdropAnalytics());
document.querySelector('#leaderboard-private')?.addEventListener('change', () => renderAirdropAnalytics());
document.querySelector('#airdrop-export-csv')?.addEventListener('click', exportAirdropCsv);
document.querySelector('#buyback-add-claim')?.addEventListener('click', recordBuybackPreviewClaim);
document.querySelector('#buyback-run-preview')?.addEventListener('click', runBuybackPreview);
document.querySelector('#buyback-example-fees')?.addEventListener('input', renderBuybackExample);
document.querySelector('#funded-burn-amount')?.addEventListener('input', updateFundedBurnButton);
document.querySelector('#funded-burn-submit')?.addEventListener('click', submitFundedBurn);
document.querySelector('#funded-buy-amount')?.addEventListener('input', () => { fundedBuyPreview = null; renderFundedBuyControl('Preview the current Solana pool quote before signing.'); });
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
  const tierInfo = event.target.closest('[data-tier-info-mint]');
  if (tierInfo) { openExploreTierInfo(tierInfo.dataset.tierInfoMint); return; }
  const boost = event.target.closest('[data-boost-mint]');
  if (boost) { openExploreBoost(boost.dataset.boostMint); return; }
  const watch = event.target.closest('.scanner-watch');
  if (watch) { toggleExploreWatch(watch.dataset.mint, watch); return; }
  const copy = event.target.closest('.copy-row');
  if (copy) {
    try { await navigator.clipboard.writeText(copy.dataset.mint); showToast('Mint address copied'); } catch { showToast(copy.dataset.mint); }
    return;
  }
});
document.querySelector('#explore-tier-close')?.addEventListener('click', () => document.querySelector('#explore-tier-dialog')?.close());
document.querySelector('#explore-boost-close')?.addEventListener('click', () => document.querySelector('#explore-boost-dialog')?.close());
document.querySelector('#explore-boost-dialog')?.addEventListener('click', event => {
  const option = event.target.closest('[data-boost-package]');
  if (option && !boostCheckout.busy && !boostCheckout.pendingSignature) {
    boostCheckout.packageId = option.dataset.boostPackage;
    boostCheckout.quote = null;
    boostCheckout.message = '';
    renderExploreBoostDialog();
    return;
  }
  if (event.target.closest('.explore-boost-pay')) void handleExploreBoostPay();
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
    desktopSidebarToggle.querySelector('span').innerHTML = icon(isCollapsed ? 'chevronRight' : 'chevronLeft');
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
  list: '#list',
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
const mergedPageRoutes = { community: 'my-launches', 'capital-flow': 'analytics-detail', buybacks: 'paid' };
let pageRouteFocusRequested = false;
function requestPageRouteFocus(){
  pageRouteFocusRequested = true;
}
function focusCurrentPageRoute(){
  const route = requestedPageRoute();
  const routeTarget = pageRouteTargets[location.hash.slice(1)] || pageRouteTargets[route];
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
  if (/^\/pilot\/?$/.test(location.pathname) && !location.hash) return 'launch';
  if (/^\/funded\/?$/.test(location.pathname) && !location.hash) return 'paid';
  if (/^\/list\/?$/.test(location.pathname) && !location.hash) return 'list';
  if (/^\/explore\/?$/.test(location.pathname)) return 'explore';
  const hash = location.hash.replace(/^#/, '');
  if (hash === 'pilot') return 'launch';
  if (hash === 'overview' || hash === '') return 'overview';
  if (hash.startsWith('coin/')) return 'overview';
  if (hash === 'referral-faq') return 'referrals';
  if (hash.startsWith('docs/')) return 'docs';
  if (hash === 'funded-holder-token-rewards') return 'payments';
  return pageRouteTargets[hash] ? mergedPageRoutes[hash] || hash : 'overview';
}
const routeGuideCopy = {
  payments: { group: 'Workspace', state: 'Confirmed payments', description: 'See rewards linked to your wallet and check what is ready to claim.', primary: ['View analytics', '#analytics-detail'], secondary: ['How claims work', '#docs'] },
  'analytics-detail': { group: 'Workspace', state: 'Platform activity', description: 'Explore launches, fees, payments, trades, airdrops, referrals, and burns.', primary: ['See capital flow', '#capital-flow'], secondary: ['Explore launches', '#explore'] },
  'my-launches': { group: 'Build', state: 'Your portfolio', description: 'See your launches, market activity, and token actions together.', primary: ['Launch a project', '#launch'], secondary: ['Launch guide', '#docs'] },
  referrals: { group: 'Growth', state: 'Connect wallet to claim', description: 'Share your invite link and follow creator activity and rewards.', primary: ['How rewards work', '#referral-faq'], secondary: ['Explore launches', '#explore'] },
  community: { group: 'Growth', state: 'Saved on this device', description: 'Save launches to compare their latest available market activity.', primary: ['Find launches', '#explore'], secondary: ['See airdrops', '#airdrops'] },
  leaderboard: { group: 'Growth', state: 'Confirmed activity', description: 'Explore creator and $FUNDED burn rankings.', primary: ['Explore launches', '#explore'], secondary: ['View service status', '#docs'] },
  airdrops: { group: 'Growth', state: 'Claim status', description: 'Check planned airdrops, eligibility, and claims for each launch.', primary: ['Explore launches', '#explore'], secondary: ['Claim guide', '#docs'] },
  buybacks: { group: 'Protocol', state: 'Buy and burn', description: 'Buy or burn $FUNDED and check confirmed transactions.', primary: ['View my projects', '#my-launches'], secondary: ['Read the guide', '#docs'] },
  'capital-flow': { group: 'Protocol', state: 'Example calculator', description: 'Enter any creator-fee amount to see how every destination is calculated. This preview never moves funds.', primary: ['View payments', '#payments'], secondary: ['Read the policy', '#docs'] },
  docs: { group: 'Protocol', state: 'Help and guides', description: 'Learn how launches, rewards, and wallet approvals work.', primary: ['Open launch', '#launch'], secondary: ['See capital flow', '#capital-flow'] },
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
  document.body.classList.remove('page-route', ...Object.keys(pageRouteTargets).map(key => `page-route-${key}`), 'page-route-overview', 'page-route-coin', 'page-route-wallet');
  document.body.classList.add('page-route', `page-route-${route}`);
  if (requestedHash === 'community') document.body.classList.add('page-route-community');
  if (requestedHash === 'capital-flow') document.body.classList.add('page-route-capital-flow');
  if (requestedHash === 'buybacks') document.body.classList.add('page-route-buybacks');
  if (coinRouteRequested()) { document.body.classList.remove('page-route-overview'); document.body.classList.add('page-route-coin'); }
  if (walletRouteRequested()) { document.body.classList.remove('page-route-overview'); document.body.classList.add('page-route-wallet'); }
  if (route === 'explore') document.body.classList.add('explore-route');
  else document.body.classList.remove('explore-route');
  document.querySelectorAll('.nav-item').forEach(item => {
    const hrefRoute = item.getAttribute('href') === '/funded' ? 'paid' : item.getAttribute('href')?.replace(/^#/, '');
    item.classList.toggle('active', hrefRoute === route || (route === 'referrals' && hrefRoute === 'referrals'));
    if (hrefRoute === route) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
  });
  let copy = {
    overview: ['Overview', 'Verified activity and next steps'],
    explore: ['Explore', 'Verified launches and market signals'],
    list: ['Get listed', 'Listing status and token mint check'],
    payments: ['Rewards', 'Claims and payout receipts'],
    'analytics-detail': ['Analytics', 'Protocol flow and indexed activity'],
    launch: ['Create a coin', 'Create and review a Devnet coin'],
    'my-launches': ['Portfolio', 'Launches and saved tokens'],
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
  if (requestedHash === 'community') copy = ['Watchlist', 'Saved launches and updates'];
  if (requestedHash === 'capital-flow') copy = ['Capital flow', 'Published fee allocation'];
  if (requestedHash === 'buybacks') copy = ['Buy & burn', '$FUNDED actions and receipts'];
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
  if (route === 'buybacks' || route === 'paid') void loadFundedBurnState();
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
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
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
  banner.textContent = 'Read-only workspace · wallet signing and financial actions disabled';
  document.body.prepend(banner);
} else {
  const phantomAvailableAtStartup = Boolean(phantomProvider());
  if (existingProvider?.isConnected && walletAddress(existingProvider) && !wasWalletManuallyDisconnected()) activateWallet(existingProvider);
  if (!wallet && phantomAvailableAtStartup) await restoreTrustedPhantomWallet();
  if (!wallet) await restoreMobileWallet();
  if (!wallet && !phantomAvailableAtStartup) void restoreTrustedPhantomWallet();
  if (!wallet) await connectDevWallet();
}
captureAppReferral();
bindAppReferralToWallet();
updateReferralLink();
updateOnboardingProgress();
renderAirdropClaims();
renderCreatorLaunches();
loadVerifiedLaunchPolicies().catch(() => {});
void loadVerifiedBoosts();
createRoutePoller({ run: signal => loadVerifiedLaunchPolicies(signal), active: () => coinRouteRequested() || ['overview', 'explore', 'my-launches', 'payments', 'airdrops', 'community'].includes(requestedPageRoute()), intervalMs: 60_000 });
createRoutePoller({ run: signal => loadVerifiedBoosts(signal), active: () => coinRouteRequested() || ['overview', 'explore', 'list'].includes(requestedPageRoute()), intervalMs: 60_000 });
renderBuybackDashboard();
void loadBuybackNetworkState();
createRoutePoller({ run: signal => loadBuybackNetworkState(signal), active: () => ['buybacks', 'paid', 'payments'].includes(requestedPageRoute()), intervalMs: 60_000 });
void refreshFundedBuyRoute();
void refreshLaunchTierPricing();
createRoutePoller({ run: signal => refreshFundedBuyRoute(signal), active: () => !fundedBuyBusy && ['buybacks', 'paid'].includes(requestedPageRoute()), intervalMs: 60_000 });
createRoutePoller({ run: () => refreshLaunchTierPricing(), active: () => requestedPageRoute() === 'launch', intervalMs: 60_000 });
renderPublishedFeeRates();
renderFeeFlowCalculator();
// Launch controls stay gated by their verified state while the workspace renders.
void Promise.allSettled([refreshFeeRouterConfig(), refreshXFeeStatus()]);
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
  if (source) source.textContent = `Verified launch`;
  grid.innerHTML = summary.cards.filter(item => item.id !== 'volume').map(item => {
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
  if (stage) stage.textContent = `Fees are accruing in Pump. The Solana collector checks the vault automatically and records allocations once at least ${coinFeeSol(minimum)} is available.`;
  const how = root.querySelector('.coin-fee-how');
  if (how) how.innerHTML = `<strong>How the coin creator receives fees</strong><ol><li>Pump accrues fees in this coin’s vault.</li><li>The Solana collector moves fees into this coin’s router and records the allocation automatically.</li><li>Once allocated creator fees reach ${escapeHtml(coinFeeSol(minimum))}, connect launch wallet ${walletLink} and select Claim creator fees. The payout worker sends SOL to that wallet; a paid receipt appears after confirmation.</li></ol><small>Only the verified launch wallet can request payment. Amounts still in Pump are estimates until collected and allocated.</small>`;
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
let coinSolUsdValues = { spot: NaN, marketCap: NaN, reserve: NaN, virtualQuote: NaN, supply: NaN };
let coinChatMessages = [];
let coinChatState = { loading: true, enabled: false, reason: '' };
let coinTradeFilter = 'all';
let coinTradeSort = { key: 'date', direction: 'desc' };
let coinTradeOpenFilter = null;
let coinChartMetric = 'mcap';
let coinChartUnit = 'usd';
let coinChartPeriod = '24h';
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
  route.innerHTML = `<strong>Pump fee recipient</strong><a class="coin-creator-link" href="/wallet/${encodeURIComponent(address)}">${safe}</a><button type="button" class="copy-creator-wallet" id="coin-copy-creator" aria-label="Copy fee recipient">${icon('copy')}</button><small>Curve fee authority; may be a program/router, not the human creator.</small>`;
}
function renderCoinCreatorHeader(address){
  const link = document.querySelector('#coin-creator-by');
  if (!link) return;
  if (!address) { link.hidden = true; link.removeAttribute('href'); return; }
  link.textContent = `Fee owner ${shortAddress(address)}`;
  link.href = `/wallet/${encodeURIComponent(address)}`;
  link.hidden = false;
}
function renderCoinRewardsPolicy(policy, mint = getCoinMintAddress()){
  const summary = document.querySelector('#coin-fee-route');
  const value = document.querySelector('#coin-fee-route-value');
  if (!summary || !value) return;
  const verified = verifiedCoinRewardsPolicy(policy, mint, EXPLORE_CLUSTER)
    || verifiedCoinRewardsPolicy(coinSummaryLaunch, mint, EXPLORE_CLUSTER)
    || verifiedCoinRewardsPolicy(verifiedLaunchPolicyForMint(mint), mint, EXPLORE_CLUSTER);
  summary.hidden = !verified;
  summary.parentElement?.classList.toggle('has-fee-allocation', Boolean(verified));
  value.replaceChildren();
  if (!verified) return;
  const shares = [];
  if (verified.creator > 0) shares.push(document.createTextNode(`Creator ${formatPolicyPercent(verified.creator)}`));
  if (verified.holders > 0) shares.push(document.createTextNode(`Holders ${formatPolicyPercent(verified.holders)}`));
  if (verified.x > 0 && verified.xAccount) {
    const xShare = document.createElement('span');
    const xLink = document.createElement('a');
    xLink.href = `https://x.com/${verified.xAccount.slice(1)}`;
    xLink.target = '_blank';
    xLink.rel = 'noopener noreferrer';
    xLink.textContent = verified.xAccount;
    xLink.setAttribute('aria-label', `Open ${verified.xAccount} on X (opens in a new tab)`);
    xShare.append('X account ', xLink, ` ${formatPolicyPercent(verified.x)}`);
    shares.push(xShare);
  }
  shares.forEach((share, index) => {
    if (index) value.append(' · ');
    value.append(share);
  });
}
function compactCoinSocials(){
  const labels = {
    '#coin-explorer-link': ['external', 'Open token on Solana Explorer', 'Explorer unavailable'],
    '#coin-website-link': ['website', 'Open token website', 'Website not provided'],
    '#coin-x-link': ['socialX', 'Open token X profile', 'X profile not provided'],
    '#coin-telegram-link': ['telegram', 'Open token Telegram', 'Telegram not provided'],
    '#coin-discord-link': ['discord', 'Open token Discord', 'Discord not provided'],
    '#coin-share-link': ['share', 'Share token'],
    '#coin-refresh': ['refresh', 'Refresh token data'],
  };
  const socials = document.querySelector('.coin-socials');
  if (!socials) return;
  socials.classList.add('is-compact');
  for (const [selector, [iconName, title, unavailableTitle]] of Object.entries(labels)) {
    const element = socials.querySelector(selector);
    if (!element) continue;
    element.innerHTML = icon(iconName);
    if (element.tagName === 'A' && selector !== '#coin-share-link' && !element.getAttribute('href')) {
      element.hidden = false;
      element.classList.add('is-unavailable');
      element.setAttribute('aria-disabled', 'true');
      element.title = unavailableTitle;
      element.setAttribute('aria-label', unavailableTitle);
    } else if (element.tagName === 'A' && element.getAttribute('href')) {
      element.hidden = false;
      element.classList.remove('is-unavailable');
      element.removeAttribute('aria-disabled');
      element.title = title;
      element.setAttribute('aria-label', title);
    } else {
      element.title = title;
      element.setAttribute('aria-label', title);
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
    [/RPC only/gi, 'Solana data'],
    [/Solana RPC/gi, 'Solana'],
    [/from the current RPC scan/gi, 'from the current scan'],
    [/partial RPC scan/gi, 'partial scan'],
    [/Complete RPC scan/gi, 'Complete scan'],
    [/RPC coverage/gi, 'data coverage'],
    [/from Solana RPC/gi, 'from Solana'],
    [/\bRPC\b/gi, 'Solana data'],
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
  return collectRecentTrades(assets, { limit: 1000, since: Math.floor(Date.now() / 1000) - 86400 }).filter(trade => trade.trader === address).slice(0, 100);
}
async function refreshPortfolioHoldings(){
  const address = connectedWalletAddress;
  const request = ++portfolioRequest;
  portfolioHoldings = { wallet: address || '', status: address ? 'loading' : 'idle', accounts: [], coverage: '' };
  renderPortfolio();
  if (!address) return;
  try {
    const { PublicKey, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } = await getSolana();
    const rpc = await getExploreConnection();
    const owner = new PublicKey(address);
    const results = await Promise.allSettled([
      rpc.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }, 'confirmed'),
      rpc.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }, 'confirmed'),
    ]);
    if (request !== portfolioRequest || address !== connectedWalletAddress) return;
    const success = results.filter(result => result.status === 'fulfilled');
    portfolioHoldings = {
      wallet: address,
      status: success.length ? 'ready' : 'unavailable',
      accounts: aggregateTokenAccounts(success.flatMap(result => result.value?.value || [])),
      coverage: success.length === 2 ? 'SPL Token and Token-2022' : success.length ? 'Partial token-program coverage' : 'RPC unavailable',
    };
  } catch {
    if (request !== portfolioRequest || address !== connectedWalletAddress) return;
    portfolioHoldings = { wallet: address, status: 'unavailable', accounts: [], coverage: 'RPC unavailable' };
  }
  renderPortfolio();
}
function portfolioUnitPriceUsd(asset){
  const priceSol = asset?.migrated ? Number(asset.poolPriceSol) : Number(asset?.curvePriceSol);
  if (Number.isFinite(priceSol) && priceSol > 0 && Number.isFinite(coinSolUsdPrice) && coinSolUsdPrice > 0) return priceSol * coinSolUsdPrice;
  return null;
}
function renderPortfolio(){
  const status = document.querySelector('#portfolio-holdings-status');
  const rows = document.querySelector('#portfolio-holding-rows');
  const value = document.querySelector('#portfolio-total-value');
  const pnl = document.querySelector('#portfolio-observed-pnl');
  const txRows = document.querySelector('#portfolio-trade-rows');
  const txNote = document.querySelector('#portfolio-trade-note');
  if (!status || !rows || !value || !pnl || !txRows || !txNote) return;
  const address = connectedWalletAddress;
  const current = portfolioHoldings.wallet === address && portfolioHoldings.status === 'ready';
  const holdings = current ? portfolioHoldings.accounts : [];
  const assetByMint = new Map(assets.map(asset => [asset.address, asset]));
  const decimalsByMint = new Map(assets.filter(asset => Number.isInteger(asset.mintDecimals)).map(asset => [asset.address, asset.mintDecimals]));
  for (const holding of holdings) decimalsByMint.set(holding.mint, holding.decimals);
  let pricedCount = 0;
  let total = 0;
  rows.innerHTML = holdings.map(holding => {
    const asset = assetByMint.get(holding.mint);
    const unitUsd = portfolioUnitPriceUsd(asset);
    const holdingValue = unitUsd == null ? null : holding.quantity * unitUsd;
    if (holdingValue != null) { pricedCount += 1; total += holdingValue; }
    const label = asset?.symbol || shortAddress(holding.mint);
    return `<a class="portfolio-holding-row" href="/token/${encodeURIComponent(holding.mint)}"><span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(asset?.name || shortAddress(holding.mint))}</small></span><span>${escapeHtml(formatOnChainNumber(holding.quantity, 6))}</span><span>${holdingValue == null ? '—' : escapeHtml(formatDashboardUsd(holdingValue))}</span><span title="Complete cost basis unavailable">—</span></a>`;
  }).join('') || `<div class="empty-state">${!address ? 'Connect a wallet to see token holdings.' : portfolioHoldings.status === 'loading' ? 'Checking live Solana balances…' : portfolioHoldings.status === 'unavailable' ? 'Token balances are unavailable from Solana RPC.' : 'No SPL token holdings in this wallet.'}</div>`;
  status.textContent = !address ? 'Connect wallet' : current ? `${holdings.length} tokens · ${portfolioHoldings.coverage}${pricedCount < holdings.length ? ' · some values unavailable' : ''}` : portfolioHoldings.status === 'loading' ? 'Checking Solana balances' : 'Balance lookup unavailable';
  value.textContent = pricedCount ? `${pricedCount < holdings.length ? '≥' : ''}${formatDashboardUsd(total)}` : holdings.length ? '—' : current ? '$0.00' : '—';
  const trades = address ? walletDetailTrades(address) : [];
  const observed = matchedTradePnl(trades, decimalsByMint);
  pnl.textContent = observed.matchedSales ? `${observed.pnlSol >= 0 ? '+' : ''}${formatOnChainNumber(observed.pnlSol, 5)} SOL` : '—';
  pnl.title = observed.matchedSales ? `${observed.matchedSales} sale${observed.matchedSales === 1 ? '' : 's'} matched to buys observed in the last 24 hours. Excludes fees, unmatched trades and open positions.` : 'Cost basis is unavailable for older holdings and unmatched trades.';
  txRows.innerHTML = trades.map(trade => {
    const timestamp = Number(trade.blockTime) * 1000;
    const decimals = decimalsByMint.get(trade.mint);
    const raw = String(trade.tokenAmountRaw ?? '');
    const quantity = Number.isInteger(decimals) && /^\d+$/.test(raw) ? Number(raw) / 10 ** decimals : NaN;
    const tokenAmount = Number.isFinite(quantity) ? formatOnChainNumber(quantity, 6) : '—';
    const receiptUrl = exploreExplorer(`tx/${encodeURIComponent(trade.signature)}`);
    return `<tr class="portfolio-trade-row"><td><time datetime="${escapeHtml(new Date(timestamp).toISOString())}" title="${escapeHtml(new Date(timestamp).toLocaleString())}">${escapeHtml(formatOnchainAge(timestamp))}</time></td><td><span class="portfolio-trade-side ${trade.side}">${trade.side === 'buy' ? 'Buy' : 'Sell'}</span></td><td><a href="/token/${encodeURIComponent(trade.mint)}">${escapeHtml(trade.symbol || shortAddress(trade.mint))}</a></td><td class="numeric">${escapeHtml(tokenAmount)}</td><td class="numeric">${escapeHtml(formatOnChainNumber(trade.solAmount, 5))}</td><td><a href="${escapeHtml(receiptUrl)}" target="_blank" rel="noopener noreferrer" aria-label="View transaction ${escapeHtml(shortAddress(trade.signature))} on Solana Explorer">${escapeHtml(shortAddress(trade.signature))} ↗</a></td></tr>`;
  }).join('') || `<tr><td class="portfolio-trade-empty" colspan="6"><span>${!address ? 'Connect a wallet to see trade transactions.' : 'No trades found in the available 24-hour coin scan.'}</span></td></tr>`;
  txNote.textContent = !address ? 'Connect a wallet for Solana trade history.' : `Last 24 hours · ${exploreScannedCount} of ${assets.length} listed coins scanned · up to 20 trades per coin, 100 wallet rows. Older or unscanned transactions may be missing.`;
}
function activatePortfolioTab(name, focus = false){
  const tabs = document.querySelectorAll('[data-portfolio-tab]');
  for (const button of tabs) {
    const active = button.dataset.portfolioTab === name;
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
    const panel = document.querySelector(`#portfolio-${button.dataset.portfolioTab}-panel`);
    if (panel) panel.hidden = !active;
    if (active && focus) button.focus();
  }
}
document.querySelector('.portfolio-view-tabs')?.addEventListener('click', event => {
  const button = event.target.closest('[data-portfolio-tab]');
  if (button) activatePortfolioTab(button.dataset.portfolioTab);
});
document.querySelector('.portfolio-view-tabs')?.addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = [...event.currentTarget.querySelectorAll('[data-portfolio-tab]')];
  const current = tabs.indexOf(document.activeElement);
  if (current < 0) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  activatePortfolioTab(tabs[next].dataset.portfolioTab, true);
});
document.querySelector('#portfolio-refresh')?.addEventListener('click', () => { void refreshPortfolioHoldings(); });
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
  const registryReady = verifiedLaunchPoliciesStatus === 'ready';
  const tradeScanReady = exploreScannedCount > 0 && assets.length > 0;
  const tradeScanStale = exploreProviderStatus.includes('stale');
  const scanNote = tradeScanReady ? `Trades shown for ${exploreScannedCount} of ${assets.length} listed coins${tradeScanStale ? ' (last available update)' : ''}` : 'Recent trades are unavailable';
  setCoinField('#wallet-registry-state', registryReady ? 'Confirmed' : verifiedLaunchPoliciesStatus === 'loading' ? 'Checking' : 'Unavailable');
  setCoinField('#wallet-trade-state', tradeScanReady ? `${exploreScannedCount} of ${assets.length} coins${tradeScanStale ? ' · last update' : ''}` : exploreFeedAvailable ? 'No recent trades' : 'Unavailable');
  const launchTimes = launches.map(item => Date.parse(item.createdAt || '')).filter(Number.isFinite);
  const tradeTimes = trades.map(item => Number(item.blockTime) * 1000).filter(Number.isFinite);
  const lastActivity = Math.max(0, ...launchTimes, ...tradeTimes);
  const volume = trades.reduce((sum, trade) => sum + Number(trade.solAmount || 0), 0);
  const title = document.querySelector('#wallet-page-title');
  const addressNode = document.querySelector('#wallet-page-address');
  const selfBadge = document.querySelector('#wallet-self-badge');
  const edit = document.querySelector('#wallet-edit-profile');
  if (title) title.textContent = isSelf ? 'Your wallet' : address ? shortAddress(address) : 'Wallet';
  if (addressNode) addressNode.textContent = address || 'Wallet address unavailable';
  if (selfBadge) selfBadge.hidden = !isSelf;
  if (edit) edit.hidden = !isSelf;
  const statSol = document.querySelector('#wallet-stat-sol');
  const statSolNote = document.querySelector('#wallet-stat-sol-note');
  if (statSol) statSol.textContent = isSelf && walletBalanceLamports != null ? formatSol(walletBalanceLamports) : '—';
  if (statSolNote) statSolNote.textContent = isSelf ? (walletBalanceLamports == null ? 'Balance currently unavailable' : 'Connected wallet balance') : 'Connect this wallet to view balance';
  setCoinField('#wallet-stat-launches', registryReady ? String(launches.length) : '—');
  setCoinField('#wallet-stat-trades', tradeScanReady ? String(trades.length) : '—');
  setCoinField('#wallet-stat-trades-note', scanNote);
  const hasSolUsdQuote = Number.isFinite(coinSolUsdPrice) && coinSolUsdPrice > 0;
  setCoinField('#wallet-stat-volume', !tradeScanReady ? '$—' : !trades.length ? '$0.00' : hasSolUsdQuote ? formatDashboardUsd(volume * coinSolUsdPrice) : '$—');
  setCoinField('#wallet-stat-volume-note', !tradeScanReady ? scanNote : !trades.length ? 'No recent trades found' : hasSolUsdQuote ? 'Estimated USD at the current SOL price' : 'SOL price unavailable');
  setCoinField('#wallet-stat-burned', !registryReady ? '—' : burned > 0 ? formatOnChainNumber(burned, 2) : launches.length ? '0' : '—');
  setCoinField('#wallet-stat-last', lastActivity ? formatOnchainAge(lastActivity) : '—');
  document.querySelectorAll('[data-wallet-tab]').forEach(button => { const active = button.dataset.walletTab === walletDetailTab; button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1; });
  const description = document.querySelector('#wallet-detail-description');
  const content = document.querySelector('#wallet-detail-content');
  const filters = document.querySelector('#wallet-detail-filters');
  if (filters) {
    filters.hidden = walletDetailTab !== 'activity';
    filters.querySelectorAll('[data-wallet-filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.walletFilter === walletDetailFilter)));
  }
  if (!content || !description) return;
  if (walletDetailTab === 'balances') {
    description.textContent = 'Balances are shown when current information is available.';
    const fundedBalance = isSelf && fundedBurnState.wallet === address && fundedBurnState.status === 'ready'
      ? formatTokenBaseUnits(fundedBurnState.balanceBaseUnits, fundedBurnState.decimals, 6)
      : isSelf && fundedBurnState.wallet === address && fundedBurnState.status === 'loading' ? 'Checking Solana…' : 'Unavailable';
    content.innerHTML = `<div class="wallet-balance-grid"><article><span class="header-solana-mark" aria-hidden="true"></span><div><strong>${escapeHtml(isSelf && walletBalanceLamports != null ? formatSol(walletBalanceLamports) : 'Unavailable')}</strong><small>Native SOL</small></div></article><article><span class="wallet-funded-mark" aria-hidden="true">f</span><div><strong>${escapeHtml(fundedBalance)}</strong><small>$FUNDED token balance${fundedBalance !== 'Unavailable' && fundedBalance !== 'Checking Solana…' ? ' · live' : ''}</small></div></article></div>`;
    return;
  }
  const launchRows = launches.map(launch => ({ type:'launch', time:Date.parse(launch.createdAt || '') || 0, mint:launch.mint, html:`<a class="wallet-activity-row" data-token-mint="${escapeHtml(launch.mint)}" href="/token/${encodeURIComponent(launch.mint)}"><span class="wallet-activity-icon">✦</span><span><strong>Created ${escapeHtml(launch.name || launch.symbol || 'token')}</strong><small>${escapeHtml(launch.symbol || 'TOKEN')} · ${escapeHtml(shortAddress(launch.mint))}</small></span><b>Verified<small>${launch.createdAt ? escapeHtml(formatOnchainAge(Date.parse(launch.createdAt))) : 'Time unavailable'}</small></b></a>` }));
  if (walletDetailTab === 'created') {
    description.textContent = registryReady ? 'Confirmed coins created by this wallet.' : 'Created coins are unavailable right now.';
    content.innerHTML = launchRows.map(row => row.html).join('') || (registryReady ? walletDetailEmpty('No created coins found', 'No confirmed launch was found for this wallet.') : walletDetailEmpty('Created coins unavailable', 'Please check again later.'));
    loadWalletRowLogos(content, launches);
    return;
  }
  description.textContent = `Confirmed launches and burns, plus recent trades from the last 24 hours. ${scanNote}.`;
  const tradeRows = trades.map(trade => ({ type:trade.side, time:Number(trade.blockTime) * 1000 || 0, html:`<a class="wallet-activity-row" data-token-mint="${escapeHtml(trade.mint)}" href="${escapeHtml(exploreExplorer(`tx/${encodeURIComponent(trade.signature)}`))}" target="_blank" rel="noopener noreferrer"><span class="wallet-activity-icon ${trade.side}">${trade.side === 'buy' ? '↗' : '↘'}</span><span><strong>${trade.side === 'buy' ? 'Bought' : 'Sold'} ${escapeHtml(trade.symbol || 'token')}</strong><small>${escapeHtml(shortAddress(trade.mint))}</small></span><b>${escapeHtml(formatOnChainNumber(trade.solAmount, 4))} SOL<small>${escapeHtml(formatOnchainAge(Number(trade.blockTime) * 1000))}</small></b></a>` }));
  const seenBurns = new Set();
  const burnRows = launches.flatMap(launch => {
    const burn = launch.creatorLaunchBurn;
    const receipt = burn?.receipt;
    if (burn?.status !== 'verified' || !receipt?.signature || seenBurns.has(receipt.signature)) return [];
    seenBurns.add(receipt.signature);
    const amount = Number(receipt.amountTokens ?? burn.amountTokens);
    return [{ type:'burn', time:Date.parse(launch.onchainVerifiedAt || launch.createdAt || '') || 0, html:`<a class="wallet-activity-row" href="${escapeHtml(exploreExplorer(`tx/${encodeURIComponent(receipt.signature)}`))}" target="_blank" rel="noopener noreferrer"><span class="wallet-activity-icon burn">♨</span><span><strong>Burned $FUNDED</strong><small>${escapeHtml(launch.symbol || 'TOKEN')} launch · confirmed</small></span><b>${Number.isFinite(amount) ? escapeHtml(formatOnChainNumber(amount, 2)) : '—'} $FUNDED<small>View transaction ↗</small></b></a>` }];
  });
  const rows = [...tradeRows, ...launchRows, ...burnRows].filter(row => walletDetailFilter === 'all' || row.type === walletDetailFilter).sort((a,b) => b.time - a.time);
  const coverageIncomplete = (['all', 'launch', 'burn'].includes(walletDetailFilter) && !registryReady)
    || (['all', 'buy', 'sell'].includes(walletDetailFilter) && !tradeScanReady);
  content.innerHTML = rows.map(row => row.html).join('') || walletDetailEmpty(coverageIncomplete ? 'Activity unavailable' : 'No matching activity', coverageIncomplete ? 'Some activity cannot be shown right now. Please check again later.' : walletDetailFilter === 'all' ? 'No confirmed launches, burns, or recent trades were found for this wallet.' : `No ${walletDetailFilter} activity was found for this wallet.`);
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
  return Number.isFinite(usd) && coinSolUsdPrice > 0 && sol >= 0 ? formatUsd(usd) : '$—';
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
function formatExploreUsd(value, options = {}){
  const prefix = options.partial ? '≥' : '';
  return `${prefix}${formatCoinUsd(value)}`;
}
async function loadSolUsdQuote(){
  const response = await apiRequest('/api/market/sol-usd').catch(() => ({ available: false, data: null }));
  const quote = Number(response.data?.priceUsd);
  if (!response.available || !Number.isFinite(quote) || quote <= 0) return;
  coinSolUsdPrice = quote;
  renderFundedTokenLanding();
  setCoinField('#coin-market-cap', formatCoinUsd(coinSolUsdValues.marketCap));
  setCoinField('#coin-strip-market-cap', formatCoinUsd(coinSolUsdValues.marketCap));
  setCoinField('#coin-liquidity', formatCoinUsd(coinSolUsdValues.reserve));
  renderCoinSummary();
  if (coinMarketActivity.graduated && coinMarketActivity.status === 'unavailable') setCoinField('#coin-volume', 'Pool activity unavailable');
  else if (coinMarketActivity.coverage === 'complete' && coinMarketActivity.tradeCount === 0) setCoinField('#coin-volume', 'No trades');
  else if (Number.isFinite(Number(coinMarketActivity.volume24hSol))) setCoinField('#coin-volume', `${formatExploreUsd(coinMarketActivity.volume24hSol, { partial: coinMarketActivity.coverage === 'partial' })}${coinMarketActivity.coverage === 'partial' ? ' · partial' : ''}`);
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
function renderCoinAccountDistribution(distribution, decimals = 6, symbol = 'Token', vaultLabel = 'Curve vault'){
  const panel = document.querySelector('#coin-account-distribution');
  if (!panel) return;
  panel.hidden = !distribution;
  const status = document.querySelector('#coin-holder-distribution-status');
  if (status) {
    status.hidden = Boolean(distribution);
    if (!distribution) status.textContent = 'Full holder distribution unavailable: token-account owners and balances could not be reconciled to minted supply.';
  }
  if (!distribution) return;
  const vaultBar = document.querySelector('#coin-distribution-vault');
  const otherBar = document.querySelector('#coin-distribution-other');
  if (vaultBar) vaultBar.style.width = `${Math.max(0, Math.min(100, distribution.vaultShare))}%`;
  if (otherBar) otherBar.style.width = `${Math.max(0, Math.min(100 - distribution.vaultShare, distribution.holderShare))}%`;
  setCoinField('#coin-distribution-vault-label', `${formatOnChainNumber(distribution.vaultShare, 2)}%`);
  setCoinField('#coin-distribution-other-label', `${formatOnChainNumber(distribution.holderShare, 2)}%`);
  setCoinField('#coin-distribution-vault-name', vaultLabel);
  setCoinField('#coin-vault-fact-label', `${vaultLabel} balance`);
  setCoinField('#coin-distribution-other-name', `${distribution.walletCount} holder wallet${distribution.walletCount === 1 ? '' : 's'}`);
  setCoinField('#coin-distribution-note', `All ${distribution.accountCount} non-zero token accounts reconcile to minted supply. Wallet balances are aggregated across accounts.`);
  const list = document.querySelector('#coin-distribution-wallets');
  if (list) {
    list.replaceChildren();
    for (const holder of distribution.holders.slice(0, 3)) {
      const row = document.createElement('li');
      const link = document.createElement('a');
      link.href = `/wallet/${encodeURIComponent(holder.wallet)}`;
      link.title = holder.wallet;
      link.textContent = shortAddress(holder.wallet);
      const amount = document.createElement('span');
      amount.textContent = `${formatTradeAmountInput(formatTokenBaseAmount(holder.amountRaw, decimals, Math.min(decimals, 6)))} ${symbol}`;
      const share = document.createElement('b');
      share.textContent = `${formatOnChainNumber(holder.share, 2)}%`;
      row.append(link, amount, share);
      list.append(row);
    }
  }
}
function setCoinCurveProgress(progress){
  const value = Number(progress);
  const valid = progress != null && Number.isFinite(value);
  setCoinField('#coin-curve-progress', valid ? `${formatOnChainNumber(value, 2)}%` : 'Unavailable');
  const fill = document.querySelector('#coin-curve-fill');
  if (fill) fill.style.width = `${valid ? Math.max(0, Math.min(100, value)) : 0}%`;
}
function renderCoinPricePath(){
  const panel = document.querySelector('#coin-price-path');
  if (!panel) return;
  document.querySelectorAll('[data-coin-chart-period]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.coinChartPeriod === coinChartPeriod)));
  document.querySelectorAll('[data-coin-chart-metric]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.coinChartMetric === coinChartMetric)));
  document.querySelectorAll('[data-coin-chart-unit]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.coinChartUnit === coinChartUnit)));
  const measure = coinChartMetric === 'price' ? 'Price' : 'Market cap';
  const unit = coinChartUnit.toUpperCase();
  setCoinField('#coin-chart-heading', `${document.querySelector('#coin-symbol')?.textContent?.trim() || 'Token'} · ${measure} in ${unit}`);
  const observedTrades = selectObservedTradeWindow(coinMarketActivity.trades, coinChartPeriod);
  const path = buildTradePricePath(observedTrades, coinMarketActivity.decimals);
  if (path.count < 2) {
    panel.innerHTML = `<div class="empty-state coin-activity-empty"><strong>${path.count ? 'One recent price' : 'No recent prices'} · ${escapeHtml(coinChartPeriod)}</strong><small>${path.count ? 'At least two confirmed trades are needed to draw a chart.' : 'No confirmed trades were found in this time range.'} Some trade history may be missing.</small></div>`;
    return;
  }
  const supply = coinSolUsdValues.supply;
  if ((coinChartMetric === 'mcap' && (!Number.isFinite(supply) || supply <= 0)) || (coinChartUnit === 'usd' && (!Number.isFinite(coinSolUsdPrice) || coinSolUsdPrice <= 0))) {
    panel.innerHTML = `<div class="empty-state"><strong>${escapeHtml(measure)} in ${escapeHtml(unit)} unavailable</strong><small>${coinChartMetric === 'mcap' && (!Number.isFinite(supply) || supply <= 0) ? 'A verified token supply is required.' : 'A current SOL/USD quote is required. Select SOL to view the on-chain price.'}</small></div>`;
    return;
  }
  const timeLabel = value => Number.isFinite(Number(value)) ? new Date(Number(value) * 1000).toLocaleString() : 'Time unavailable';
  const scale = coinChartMetric === 'mcap' ? supply : 1;
  const formatChartValue = value => coinChartUnit === 'usd' ? formatCoinSnapshotUsd(value * scale) : formatCoinSpot(value * scale);
  const label = coinChartMetric === 'mcap' ? 'Estimated market cap' : 'Estimated token price';
  const observations = path.points.map(point => `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="2.6"/>`).join('');
  panel.innerHTML = `<div class="coin-price-path-head"><span>${label} · ${unit} · observed ${escapeHtml(coinChartPeriod)}</span><strong>${escapeHtml(formatChartValue(path.latest))}</strong></div><svg viewBox="0 0 600 190" role="img" aria-label="${label} in ${unit} from ${path.count} confirmed on-chain trade observations in the last ${coinChartPeriod}" preserveAspectRatio="none"><path class="coin-path-area" d="${path.area}"/><path class="coin-path-line" d="${path.line}"/><g class="coin-path-observations">${observations}</g><circle cx="${path.lastPoint.x.toFixed(1)}" cy="${path.lastPoint.y.toFixed(1)}" r="4"/></svg><div class="coin-price-path-range"><span>Low <b>${escapeHtml(formatChartValue(path.low))}</b></span><span>High <b>${escapeHtml(formatChartValue(path.high))}</b></span></div><div class="coin-price-path-times"><span>${escapeHtml(timeLabel(path.firstBlockTime))}</span><span>${escapeHtml(timeLabel(path.lastBlockTime))}</span></div>`;
}
function renderCoinFlow(buy, sell, partial = false){
  const buyBar = document.querySelector('#coin-flow-buy');
  const sellBar = document.querySelector('#coin-flow-sell');
  const note = document.querySelector('#coin-flow .coin-flow-heading small');
  setCoinField('#coin-flow .coin-flow-heading > span', coinMarketActivity.graduated ? 'Observed 24h curve + pool volume' : 'Observed 24h curve volume');
  const valid = Number.isFinite(buy) && Number.isFinite(sell) && buy >= 0 && sell >= 0;
  const total = valid ? buy + sell : 0;
  if (buyBar) buyBar.style.width = `${total ? buy / total * 100 : 0}%`;
  if (sellBar) sellBar.style.width = `${total ? sell / total * 100 : 0}%`;
  setCoinField('#coin-flow-buy-label', valid ? `Buy ${formatExploreUsd(buy, { partial })}` : 'Buy —');
  setCoinField('#coin-flow-sell-label', valid ? `Sell ${formatExploreUsd(sell, { partial })}` : 'Sell —');
  if (note) note.textContent = valid ? total ? `${partial ? 'Partial' : 'Confirmed'} ${coinMarketActivity.graduated ? 'curve and pool' : 'curve'} trade scan` : 'No observed trade volume' : 'Buy/sell volume unavailable';
}
function observedFiveMinutePulse(trades){
  const cutoff = Math.floor(Date.now() / 1000) - 5 * 60;
  const recent = trades.filter(item => Number(item.blockTime) >= cutoff);
  const buys = recent.filter(item => item.side === 'buy');
  const sells = recent.filter(item => item.side === 'sell');
  const volume = rows => rows.reduce((sum, item) => sum + Number(item.solLamports || 0) / 1_000_000_000, 0);
  return {
    tradeCount: recent.length, buyCount: buys.length, sellCount: sells.length,
    volumeSol: volume(recent), buyVolumeSol: volume(buys), sellVolumeSol: volume(sells),
    traderCount: new Set(recent.map(item => item.trader).filter(Boolean)).size,
    largestTradeSol: Math.max(0, ...recent.map(item => Number(item.solLamports || 0) / 1_000_000_000)),
    coverage: 'partial',
  };
}
function renderCoinPulse(){
  setCoinField('.coin-pulse-grid > div:nth-child(3) > span', coinMarketActivity.graduated ? 'Trade volume' : 'Curve volume');
  document.querySelectorAll('[data-coin-pulse-period]').forEach(button => {
    const active = button.dataset.coinPulsePeriod === coinPulsePeriod;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const pulse = coinMarketActivity.activityWindows?.[coinPulsePeriod]
    || (coinPulsePeriod === '5m' && coinMarketActivity.status === 'ready' && Array.isArray(coinMarketActivity.trades)
      ? observedFiveMinutePulse(coinMarketActivity.trades) : null);
  const note = document.querySelector('#coin-pulse-note');
  const buyBar = document.querySelector('#coin-pulse-buy-bar');
  const sellBar = document.querySelector('#coin-pulse-sell-bar');
  if (!pulse) {
    const label = coinMarketActivity.status === 'loading' ? 'Loading…' : 'Unavailable';
    ['#coin-pulse-trades','#coin-pulse-traders','#coin-pulse-volume','#coin-pulse-buy-volume','#coin-pulse-sell-volume','#coin-pulse-largest'].forEach(selector => setCoinField(selector, label));
    setCoinField('#coin-pulse-buy-count', 'Buys —'); setCoinField('#coin-pulse-sell-count', 'Sells —');
    if (buyBar) buyBar.style.width = '0%'; if (sellBar) sellBar.style.width = '0%';
    if (note) {
      note.hidden = false;
      note.textContent = coinMarketActivity.status === 'loading' ? 'Reading confirmed Pump trades from Solana RPC…' : 'Activity windows unavailable from the current RPC scan.';
    }
    return;
  }
  const partial = pulse.coverage === 'partial';
  const count = value => `${partial && value > 0 ? '≥' : ''}${formatOnChainNumber(value, 0)}`;
  const usd = value => formatExploreUsd(value, { partial: partial && Number(value) > 0 });
  setCoinField('#coin-pulse-trades', count(pulse.tradeCount));
  setCoinField('#coin-pulse-traders', count(pulse.traderCount));
  setCoinField('#coin-pulse-volume', usd(pulse.volumeSol));
  setCoinField('#coin-pulse-buy-volume', usd(pulse.buyVolumeSol));
  setCoinField('#coin-pulse-sell-volume', usd(pulse.sellVolumeSol));
  setCoinField('#coin-pulse-largest', usd(pulse.largestTradeSol));
  setCoinField('#coin-pulse-buy-count', `Buys ${count(pulse.buyCount)}`);
  setCoinField('#coin-pulse-sell-count', `Sells ${count(pulse.sellCount)}`);
  const volume = Number(pulse.buyVolumeSol) + Number(pulse.sellVolumeSol);
  if (buyBar) buyBar.style.width = `${volume > 0 ? Number(pulse.buyVolumeSol) / volume * 100 : 0}%`;
  if (sellBar) sellBar.style.width = `${volume > 0 ? Number(pulse.sellVolumeSol) / volume * 100 : 0}%`;
  if (note) {
    note.hidden = !partial;
    note.textContent = partial ? 'Partial scan · values are observed lower bounds.' : '';
  }
}
function coinAuthorityLabel(value){ return value === null ? 'Disabled' : value ? shortAddress(value) : 'Unavailable'; }
function setCoinAuthority(selector, value){ setCoinFact(selector, coinAuthorityLabel(value), value === null ? 'clear' : value ? 'caution' : 'unknown'); }
function setCoinTabLabels(){
  const labels = {
    trades: `Trades ${['ready', 'summary-only'].includes(coinMarketActivity.status) ? coinMarketActivity.tradeCount : '—'}`,
    chat: 'Chat',
    payments: `Fee claims ${coinActivity.status === 'ready' && coinActivity.ledgerAvailable ? coinActivity.collections.length : '—'}`,
    claims: `Allocations ${coinActivity.status === 'ready' && coinActivity.ledgerAvailable ? coinActivity.claims.length : '—'}`,
    holders: `Holders ${coinActivity.holderDistribution ? coinActivity.holderCount : '—'}`,
  };
  document.querySelectorAll('[data-coin-tab]').forEach(item => {
    item.textContent = labels[item.dataset.coinTab] || item.textContent;
    item.setAttribute('aria-selected', String(item.classList.contains('active')));
    item.tabIndex = item.classList.contains('active') ? 0 : -1;
  });
}
function renderCoinChat(activity){
  const messages = visibleCoinChatMessages();
  const rows = messages.length ? messages.map(tokenChatMessageMarkup).join('') : tokenChatEmptyMarkup();
  activity.innerHTML = `<div class="coin-chat"><div class="coin-chat-intro"><div><strong>${escapeHtml(coinActivity.symbol || 'Token')} chat</strong><small>Wallet-verified community messages</small></div><span>${messages.length} message${messages.length === 1 ? '' : 's'}</span></div><div class="coin-chat-messages">${rows}</div>${tokenChatComposerMarkup('coin-chat')}</div>`;
}
function visibleCoinChatMessages(){
  const hidden = readHiddenChatAuthors(EXPLORE_CLUSTER);
  return coinChatMessages.filter(message => !hidden.has(message.author));
}
function tokenChatAuthorLabel(author){ return author ? shortAddress(author) : 'Unknown wallet'; }
function tokenChatEmptyMarkup(){
  if (coinChatState.loading) return '<div class="empty-state coin-activity-empty"><strong>Loading chat…</strong><small>Reading wallet-verified messages.</small></div>';
  if (!coinChatState.enabled) return `<div class="empty-state coin-activity-empty"><strong>Chat unavailable</strong><small>${escapeHtml(coinChatState.reason || 'The chat service could not be reached.')}</small></div>`;
  return '';
}
function tokenChatMessageMarkup(item){
  const own = Boolean(connectedWalletAddress && item.author === connectedWalletAddress);
  const action = own ? `<footer><button type="button" data-chat-delete="${escapeHtml(item.id)}">Delete</button></footer>` : `<footer><button type="button" data-chat-report="${escapeHtml(item.id)}" title="Report spam or a scam for moderation review">Report spam or scam</button><button type="button" data-chat-hide="${escapeHtml(item.author)}">Hide this wallet</button></footer>`;
  return `<article class="coin-community-message" data-chat-message="${escapeHtml(item.id)}"><div><strong>${escapeHtml(tokenChatAuthorLabel(item.author))}<small class="verified-author">✓ wallet</small></strong><time>${escapeHtml(new Date(item.createdAt).toLocaleString())}</time></div><p>${escapeHtml(item.text)}</p>${action}</article>`;
}
function tokenChatComposerMarkup(prefix = 'coin-community'){
  if (!coinChatState.enabled) return '';
  const connected = Boolean(connectedWalletAddress);
  const ready = tokenChatSessionReady();
  const buttonLabel = !connected ? 'Connect wallet' : ready ? 'Post' : 'Verify once & post';
  const note = !connected ? 'Connect a Solana wallet to post' : ready ? `Posting as ${escapeHtml(shortAddress(connectedWalletAddress))} · no approval needed for each post` : `Posting as ${escapeHtml(shortAddress(connectedWalletAddress))} · one wallet approval starts a 30-minute chat session`;
  const hidden = readHiddenChatAuthors(EXPLORE_CLUSTER);
  const unhide = hidden.size ? `<button type="button" data-chat-unhide>Show ${hidden.size} hidden wallet${hidden.size === 1 ? '' : 's'}</button>` : '';
  return `<form class="coin-chat-form coin-community-form" id="${prefix}-form"><label><span class="sr-only">Message</span><input id="${prefix}-input" maxlength="${TOKEN_CHAT_MAX_LENGTH}" autocomplete="off" placeholder="Share a useful observation…" required /></label><button class="primary-button" type="submit">${buttonLabel}</button></form><small class="coin-chat-note">${note}. Wallet verification confirms authorship, not trust. ${unhide}</small>`;
}
function renderCoinCommunityPanel(){
  const feed = document.querySelector('#coin-community-feed');
  if (!feed) return;
  const messages = visibleCoinChatMessages();
  feed.innerHTML = messages.length ? messages.slice(-12).map(tokenChatMessageMarkup).join('') : coinChatMessages.length ? '<p role="status">Messages from hidden wallets are hidden on this device.</p>' : tokenChatEmptyMarkup();
  const panel = feed.closest('.coin-community-panel');
  const badge = panel?.querySelector('.data-badge');
  if (badge) { badge.textContent = coinChatState.loading ? 'LOADING' : coinChatState.enabled ? 'LIVE' : 'OFFLINE'; badge.classList.toggle('is-live', coinChatState.enabled); }
  panel?.querySelector('.coin-community-form')?.remove();
  panel?.querySelector('.coin-chat-note')?.remove();
  panel?.insertAdjacentHTML('beforeend', tokenChatComposerMarkup('coin-community'));
}
function ensureCoinCommunityPanel(){
  const page = document.querySelector('#coin-page');
  if (!page) return;
  const existing = page.querySelector('.coin-community-panel');
  if (existing) {
    if (existing !== page.lastElementChild) page.append(existing);
    return;
  }
  const panel = document.createElement('aside');
  panel.className = 'panel coin-community-panel';
  panel.innerHTML = '<div class="coin-community-head"><div><p class="eyebrow">Community</p><h2>Chat</h2></div><span class="data-badge">LOADING</span></div><div id="coin-community-feed" class="coin-community-feed"></div>';
  page.append(panel);
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
const COIN_TRADE_COLUMNS = [
  ['date', 'Date'], ['type', 'Type'], ['usd', 'USD est.'], ['token', 'Token'],
  ['sol', 'SOL'], ['price', 'Price est.'], ['trader', 'Trader'], ['txn', 'Txn'],
];
function ensureCoinTradeFilterPanel(){
  const panel = document.querySelector('#coin-trade-refine');
  if (!panel || panel.dataset.ready) return panel;
  const range = (label, minKey, maxKey, step = 'any') => `<div class="coin-column-range"><label>Min ${label}<input data-coin-trade-input="${minKey}" type="number" min="0" step="${step}" inputmode="decimal" placeholder="Any" /></label><label>Max ${label}<input data-coin-trade-input="${maxKey}" type="number" min="0" step="${step}" inputmode="decimal" placeholder="Any" /></label></div>`;
  panel.innerHTML = `<div class="coin-column-filter-heading"><strong id="coin-column-filter-title">Filter trades</strong><button type="button" id="coin-trade-clear">Clear all</button></div>
    <div data-coin-filter-panel="date" hidden><div class="coin-column-range"><label>From date<input data-coin-trade-input="dateFrom" type="date" /></label><label>Through date<input data-coin-trade-input="dateTo" type="date" /></label></div></div>
    <div data-coin-filter-panel="type" hidden><label>Trade type<select data-coin-trade-input="side"><option value="all">All trades</option><option value="buy">Buys</option><option value="sell">Sells</option></select></label></div>
    <div data-coin-filter-panel="usd" hidden>${range('USD', 'minUsd', 'maxUsd', '0.01')}</div>
    <div data-coin-filter-panel="token" hidden>${range('tokens', 'minToken', 'maxToken')}</div>
    <div data-coin-filter-panel="sol" hidden>${range('SOL', 'minSol', 'maxSol')}</div>
    <div data-coin-filter-panel="price" hidden>${range('USD per token', 'minPrice', 'maxPrice')}</div>
    <div data-coin-filter-panel="txn" hidden><label>Transaction signature<input data-coin-trade-input="signature" type="search" placeholder="Signature or prefix" autocomplete="off" /></label></div>
    <small>Filters and sorting apply to the latest 20 loaded trades. USD estimates use the current SOL quote.</small>`;
  panel.dataset.ready = 'true';
  return panel;
}
function coinTradeFilterValues(){
  const values = { side: coinTradeFilter, wallet: document.querySelector('#coin-trade-wallet')?.value || '', decimals: coinMarketActivity.decimals, solUsd: coinSolUsdPrice, sortKey: coinTradeSort.key, sortDirection: coinTradeSort.direction };
  document.querySelectorAll('#coin-trade-refine [data-coin-trade-input]').forEach(input => {
    if (input.dataset.coinTradeInput !== 'side') values[input.dataset.coinTradeInput] = input.value;
  });
  return values;
}
function updateCoinTradeFilterPanel(){
  const panel = ensureCoinTradeFilterPanel();
  if (!panel) return;
  panel.hidden = !coinTradeOpenFilter;
  panel.querySelectorAll('[data-coin-filter-panel]').forEach(section => { section.hidden = section.dataset.coinFilterPanel !== coinTradeOpenFilter; });
  const title = panel.querySelector('#coin-column-filter-title');
  if (title) title.textContent = `Filter ${COIN_TRADE_COLUMNS.find(([key]) => key === coinTradeOpenFilter)?.[1] || 'trades'}`;
}
function renderCoinActivityTab(){
  const activity = document.querySelector('#coin-activity-list');
  if (!activity) return;
  const tab = document.querySelector('[data-coin-tab].active')?.dataset.coinTab || 'trades';
  const tradeToolbar = document.querySelector('#coin-trade-toolbar');
  if (tradeToolbar) tradeToolbar.hidden = tab !== 'trades';
  if (tab === 'trades') updateCoinTradeFilterPanel();
  else { const tradeRefine = document.querySelector('#coin-trade-refine'); if (tradeRefine) tradeRefine.hidden = true; }
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
    const filters = coinTradeFilterValues();
    const trades = filterAndSortRecentTrades(coinMarketActivity.trades, filters);
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
    const headers = COIN_TRADE_COLUMNS.map(([key, label]) => {
      const active = coinTradeSort.key === key;
      const direction = active ? coinTradeSort.direction : 'none';
      const fieldNames = { date: ['dateFrom', 'dateTo'], type: ['side'], usd: ['minUsd', 'maxUsd'], token: ['minToken', 'maxToken'], sol: ['minSol', 'maxSol'], price: ['minPrice', 'maxPrice'], trader: ['wallet'], txn: ['signature'] };
      const filtered = key === 'type' ? coinTradeFilter !== 'all' : fieldNames[key].some(name => filters[name] !== '' && filters[name] != null);
      const filterTarget = key === 'trader' ? 'coin-trade-wallet' : 'coin-trade-refine';
      const expanded = key === 'trader' ? '' : ` aria-expanded="${coinTradeOpenFilter === key}"`;
      return `<th scope="col" aria-sort="${direction === 'none' ? 'none' : direction === 'asc' ? 'ascending' : 'descending'}"><div class="coin-trade-column-head"><button type="button" class="coin-trade-sort" data-coin-trade-sort="${key}" aria-label="Sort ${label} ${active && direction === 'asc' ? 'descending' : 'ascending'}">${label}<span aria-hidden="true">${active ? direction === 'asc' ? '↑' : '↓' : '↕'}</span></button><button type="button" class="coin-trade-column-filter${filtered ? ' is-active' : ''}" data-coin-column-filter="${key}" aria-label="Filter ${label}"${expanded} aria-controls="${filterTarget}" title="Filter ${label}">⌕</button></div></th>`;
    }).join('');
    const empty = !trades.length ? `<tr><td colspan="8" class="coin-trade-no-results">${coinMarketActivity.trades.length ? 'No trades match these filters.' : 'No confirmed trade was found in the scanned 24-hour window.'}${coinMarketActivity.coverage === 'partial' ? ' RPC coverage is partial.' : ''}</td></tr>` : '';
    activity.innerHTML = `<div class="coin-transactions-scroll" role="region" aria-label="${escapeHtml(symbol)} transactions" tabindex="0"><table class="coin-transactions-table coin-trades-table"><thead><tr>${headers}</tr></thead><tbody>${rows || empty}</tbody></table></div>`;
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
    if (!coinActivity.holderDistribution) { activity.innerHTML = '<div class="empty-state coin-activity-empty"><strong>Full holder list unavailable</strong><small>Verified wallet owners and token-account balances must reconcile to the minted supply before holders are shown.</small></div>'; return; }
    const holderAccounts = coinActivity.holderDistribution.holders;
    const explorerIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 4h14l-3 3H3z" fill="#78e7b4"/><path d="M4 10h14l3 3H7z" fill="#ab91ff"/><path d="M6 16h14l-3 3H3z" fill="#78e7b4"/></svg>';
    const rows = holderAccounts.map((item, index) => {
      const share = Number.isFinite(item.share) ? Math.max(0, Math.min(100, item.share)) : null;
      const wallet = item.wallet;
      const balance = Number(item.amountRaw) / (10 ** coinActivity.tokenDecimals);
      const value = Number.isFinite(balance) && Number.isFinite(coinSolUsdValues.spot) && coinSolUsdValues.spot > 0 && Number.isFinite(coinSolUsdPrice) && coinSolUsdPrice > 0 ? formatUsd(balance * coinSolUsdValues.spot * coinSolUsdPrice) : '$—';
      const profile = `/wallet/${encodeURIComponent(wallet)}`;
      const tradeAction = `<button type="button" class="coin-holder-trades" data-coin-holder-trades="${escapeHtml(wallet)}" aria-label="Show recent trades by ${escapeHtml(wallet)}" title="Filter recent trades by this wallet">⌕</button>`;
      const amount = formatTradeAmountInput(formatTokenBaseAmount(item.amountRaw, coinActivity.tokenDecimals, Math.min(coinActivity.tokenDecimals, 6)));
      return `<tr><td class="coin-holder-rank">#${index + 1}</td><td><a class="coin-holder-address" href="${escapeHtml(profile)}" title="${escapeHtml(wallet)}">${escapeHtml(shortAddress(wallet))}</a></td><td class="coin-holder-percent">${escapeHtml(formatOnChainNumber(share, 2))}%</td><td><div class="coin-holder-amount"><strong>${escapeHtml(amount)} <small>${escapeHtml(coinActivity.symbol)}</small></strong><span class="coin-holder-bar" aria-hidden="true"><i style="width:${Math.max(0, Math.min(100, share))}%"></i></span></div></td><td class="coin-holder-value">${escapeHtml(value)}</td><td class="coin-holder-action">${tradeAction}</td><td class="coin-holder-action"><a class="coin-trade-explorer" href="${escapeHtml(exploreExplorer(`address/${encodeURIComponent(wallet)}`))}" target="_blank" rel="noopener noreferrer" aria-label="View wallet ${escapeHtml(wallet)} on Solana Explorer" title="View wallet on Solana Explorer">${explorerIcon}</a></td></tr>`;
    }).join('');
    activity.innerHTML = rows ? `<div class="coin-transactions-scroll coin-holders-scroll" role="region" aria-label="${escapeHtml(coinActivity.symbol)} complete holder wallets" tabindex="0"><table class="coin-transactions-table coin-holders-table"><thead><tr><th scope="col">Rank</th><th scope="col">Wallet</th><th scope="col">% supply</th><th scope="col">Amount</th><th scope="col" title="Spot token price at the current SOL/USD quote">Value est.</th><th scope="col">Txns</th><th scope="col">Explore</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty-state coin-activity-empty"><strong>No holder wallets</strong><small>The reconciled token supply is entirely in the protocol vault.</small></div>';
    return;
  }
  if (!coinActivity.ledgerAvailable) {
    activity.innerHTML = '<div class="empty-state coin-activity-empty"><strong>Fee activity unavailable</strong><small>No mint-attributed claim or allocation count can be confirmed.</small></div>';
    return;
  }
  const feeExplorerIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 4h14l-3 3H3z" fill="#78e7b4"/><path d="M4 10h14l3 3H7z" fill="#ab91ff"/><path d="M6 16h14l-3 3H3z" fill="#78e7b4"/></svg>';
  const feeDate = value => {
    const timestamp = Date.parse(value || '');
    return Number.isFinite(timestamp) ? `<time datetime="${new Date(timestamp).toISOString()}" title="${escapeHtml(new Date(timestamp).toLocaleString())}">${escapeHtml(formatOnchainAge(timestamp))}</time>` : '—';
  };
  const feeExplorer = (signature, label = 'View collection transaction on Solana Explorer') => /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature || '')
    ? `<a class="coin-trade-explorer" href="${escapeHtml(exploreExplorer(`tx/${encodeURIComponent(signature)}`))}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${feeExplorerIcon}</a>` : '—';
  if (tab === 'claims') {
    const rows = coinActivity.claims.map(item => {
      const gross = item.grossCreatorFees == null ? NaN : Number(item.grossCreatorFees);
      const status = String(item.status || 'recorded').replace(/[-_]/g, ' ');
      const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
      return `<tr><td>${feeDate(item.claimedAt)}</td><td><strong class="coin-fee-event">Fee split recorded</strong><small class="coin-fee-detail">Linked to collection ${escapeHtml(shortAddress(item.claimSignature || ''))}</small></td><td class="coin-fee-amount">${Number.isFinite(gross) ? `${escapeHtml(formatOnChainNumber(gross, 9))} ${escapeHtml(item.asset || 'SOL')}` : '—'}</td><td><span class="coin-fee-status">${escapeHtml(statusLabel)}</span></td><td class="coin-fee-action">${feeExplorer(item.claimSignature, 'View related fee collection on Solana Explorer')}</td></tr>`;
    }).join('');
    activity.innerHTML = rows ? `<p class="coin-activity-scope">Recorded fee allocations from this coin’s collections. An allocation is an obligation, not proof of recipient payment.</p><div class="coin-transactions-scroll" role="region" aria-label="${escapeHtml(coinActivity.symbol)} fee allocations" tabindex="0"><table class="coin-transactions-table coin-fee-table coin-fee-allocations-table"><thead><tr><th scope="col">Date</th><th scope="col">Event</th><th scope="col">Gross fees</th><th scope="col">Status</th><th scope="col">Txn</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty-state coin-activity-empty"><strong>No allocation attributed to this mint</strong><small>Shared-router claims are excluded from per-coin totals.</small></div>';
    return;
  }
  const mintRows = coinActivity.collections.map(item => {
    const sol = item.collectedLamports == null ? NaN : Number(item.collectedLamports) / 1_000_000_000;
    return `<tr><td>${feeDate(item.recordedAt)}</td><td><strong class="coin-fee-event">Creator fees collected</strong><small class="coin-fee-detail">Mint-attributed collection</small></td><td class="coin-fee-amount">${Number.isFinite(sol) ? `${escapeHtml(formatOnChainNumber(sol, 9))} SOL` : '—'}</td><td class="coin-fee-amount">${Number.isFinite(sol) ? escapeHtml(formatCoinUsd(sol)) : '$—'}</td><td class="coin-fee-action">${feeExplorer(item.signature)}</td></tr>`;
  }).join('');
  const routerRows = (coinActivity.sharedRouterCollections || []).map(item => {
    const sol = Number(item.collectedLamports) / 1_000_000_000;
    return `<tr><td>${feeDate(item.recordedAt)}</td><td><strong class="coin-fee-event">Shared-router collection</strong><small class="coin-fee-detail">Not attributable to this coin</small></td><td class="coin-fee-amount">${Number.isFinite(sol) ? `${escapeHtml(formatOnChainNumber(sol, 9))} SOL` : '—'}</td><td class="coin-fee-amount">${Number.isFinite(sol) ? escapeHtml(formatCoinUsd(sol)) : '$—'}</td><td class="coin-fee-action">${feeExplorer(item.signature)}</td></tr>`;
  }).join('');
  const table = (rows, label) => `<div class="coin-transactions-scroll" role="region" aria-label="${escapeHtml(label)}" tabindex="0"><table class="coin-transactions-table coin-fee-table coin-fee-collections-table"><thead><tr><th scope="col">Date</th><th scope="col">Event</th><th scope="col">Amount</th><th scope="col" title="At the current SOL/USD quote">USD est.</th><th scope="col">Txn</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  activity.innerHTML = (mintRows ? `<p class="coin-activity-scope">Creator fees collected for this mint. Collection does not confirm recipient payout.</p>${table(mintRows, `${coinActivity.symbol} fee collections`)}` : '<div class="empty-state coin-activity-empty"><strong>No fee claim attributed to this mint</strong><small>Only mint-verified collections appear in this ledger.</small></div>') + (routerRows ? `<div class="coin-activity-context"><strong>Shared-router collections</strong><span>These may include other coins and are excluded from this mint’s totals.</span></div>${table(routerRows, 'Shared-router fee collections')}` : '');
}
function renderOnChainUnavailable(message){
  const detail = String(message || '');
  const displayMessage = /(?:5\d\d (?:Internal Server Error|Bad Gateway)|returned an invalid response)/i.test(detail)
    ? 'Solana Devnet RPC is unavailable. Retry when network access recovers.'
    : detail;
  coinTradeEstimate = null;
  renderTradeAmountEstimate();
  coinActivity = { status: 'unavailable', message: displayMessage, collections: [], claims: [], accounts: [] };
  coinSummaryLaunch = null;
  coinSummaryLedgerMint = null;
  renderCoinFeeDashboard({ available:false });
  renderCoinAccountDistribution(null);
  coinMarketActivity = { status: 'unavailable', trades: [], coverage: null, decimals: 6 };
  renderCoinPricePath(); renderCoinFlow(NaN, NaN); renderCoinPulse();
  setCoinTabLabels(); renderCoinActivityTab();
  setCoinField('.coin-live-dot', 'Data unavailable');
  setCoinField('#coin-page-title', 'Token data unavailable');
  setCoinField('#coin-avatar', '?'); setCoinField('#coin-symbol', '—'); setCoinField('#coin-description', displayMessage);
  ['#coin-stage','#coin-fee-owner','#coin-metadata-status','#coin-mint-authority','#coin-freeze-authority'].forEach(selector => setCoinFact(selector, 'Unavailable'));
  ['#coin-market-cap','#coin-change','#coin-strip-market-cap','#coin-volume','#coin-liquidity','#coin-holders','#coin-trade-count','#coin-holder-count','#coin-vault-share','#coin-largest-account-share','#coin-top-ten-share','#coin-supply'].forEach(selector => setCoinField(selector, 'Unavailable'));
  setCoinField('#coin-volume-source', 'RPC trade history unavailable'); setCoinField('#coin-trade-breakdown', 'RPC trade history unavailable'); setCoinField('#coin-accounts-source', 'Largest-account sample unavailable'); setCoinCurveProgress(null);
  setCoinField('#coin-chart-heading', 'Chart unavailable');
  setCoinField('#coin-market-cap-label', 'Estimated market cap'); setCoinField('#coin-market-cap-source', 'Confirmed Solana RPC snapshot');
  setCoinField('#coin-liquidity-label', 'Reserve');
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
  document.querySelector('#coin-profile-about-tab')?.click();
  document.querySelector('#coin-launched-by')?.remove();
  ensureCoinChatTab();
  ensureCoinPolicyAccordion();
  const coinMainColumn = document.querySelector('.coin-main-column');
  const transactionPanel = document.querySelector('.coin-tabs-panel');
  if (coinMainColumn && transactionPanel?.parentElement !== coinMainColumn) coinMainColumn.append(transactionPanel);
  ensureCoinCommunityPanel();
  renderCoinCreatorHeader('');
  coinChatMessages = [];
  coinChatState = { loading: true, enabled: false, reason: '' };
  renderCoinCommunityPanel();
  coinActivity = { status: 'loading', collections: [], claims: [], accounts: [] };
  coinSummaryLaunch = null;
  coinSummaryLedgerMint = null;
  renderCoinFeeDashboard();
  renderCoinAccountDistribution(null);
  coinMarketActivity = { status: 'loading', trades: [], coverage: null, decimals: 6 };
  coinSolUsdValues = { spot: NaN, marketCap: NaN, reserve: NaN, virtualQuote: NaN, supply: NaN };
  coinTradeFilter = 'all';
  coinTradeSort = { key: 'date', direction: 'desc' };
  coinTradeOpenFilter = null;
  coinPulsePeriod = '24h';
  coinChartPeriod = '24h';
  document.querySelectorAll('#coin-page [data-coin-trade-input]').forEach(input => { input.value = input.dataset.coinTradeInput === 'side' ? 'all' : ''; });
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
  setCoinField('#coin-avatar', '?'); setCoinField('#coin-symbol', 'TOKEN'); setCoinField('#coin-artwork-symbol', 'TOKEN'); setCoinField('#coin-page-title', 'Loading token…'); setCoinField('#coin-address', shortAddress(mintAddress));
  setCoinFact('#coin-stage', 'Checking curve'); setCoinFact('#coin-fee-owner', 'Checking route'); setCoinFact('#coin-metadata-status', 'Reading mint');
  setCoinFact('#coin-mint-authority', 'Checking…'); setCoinFact('#coin-freeze-authority', 'Checking…');
  const avatar = document.querySelector('#coin-avatar'); if (avatar) avatar.style.backgroundImage = '';
  const artwork = document.querySelector('.coin-artwork'); if (artwork) { artwork.style.backgroundImage = ''; artwork.classList.remove('has-image'); }
  const tagline = document.querySelector('#coin-profile-tagline'); if (tagline) { tagline.textContent = ''; tagline.hidden = true; }
  window.fundedSetCoinProfileMetadata?.({});
  ['#coin-website-link', '#coin-x-link', '#coin-telegram-link', '#coin-discord-link'].forEach(selector => { const link = document.querySelector(selector); if (link) { link.hidden = true; link.removeAttribute('href'); } });
  compactCoinSocials();
  setCoinField('#coin-description', 'Checking coin details on Solana…');
  setCoinField('#coin-market-cap-label', 'Estimated market cap'); setCoinField('#coin-market-cap-source', 'Reading confirmed Solana RPC state');
  setCoinField('#coin-liquidity-label', 'Reserve');
  const explorerLink = document.querySelector('#coin-explorer-link'); if (explorerLink) { explorerLink.href = exploreExplorer(`address/${encodeURIComponent(mintAddress)}`); explorerLink.hidden = !mintAddress; }
  document.querySelectorAll('.coin-chart-panel .chart-tools button').forEach(button => { button.disabled = true; button.title = 'Historical candles are not indexed for this token.'; });
  ['#coin-market-cap','#coin-change','#coin-strip-market-cap','#coin-volume','#coin-liquidity','#coin-holders','#coin-trade-count','#coin-holder-count','#coin-vault-share','#coin-largest-account-share','#coin-top-ten-share','#coin-supply'].forEach(selector => setCoinField(selector, 'Loading…'));
  setCoinField('#coin-volume-source', 'RPC trade scan if available'); setCoinField('#coin-trade-breakdown', 'Confirmed Pump events'); setCoinField('#coin-accounts-source', 'Largest-account sample, not holder count'); setCoinCurveProgress(null);
  setCoinField('#coin-chart-heading', 'Reading trade observations…');
  const footer = document.querySelector('.chart-footer'); if (footer) footer.innerHTML = '<span>On-chain only</span><span>Historical candles not indexed</span>';
  const policyBadge = document.querySelector('.coin-policy-card .data-badge'); if (policyBadge) policyBadge.textContent = 'RPC only';
  const policyTitle = document.querySelector('.coin-policy-card h2'); if (policyTitle) policyTitle.textContent = 'Reading Pump curve…';
  renderCoinCreatorRoute('');
  const policySplit = document.querySelector('.policy-split'); if (policySplit) policySplit.innerHTML = '<span><b>—</b><small>Curve state</small></span><span><b>—</b><small>Real tokens</small></span>';
  const policyBar = document.querySelector('.policy-bar'); if (policyBar) { policyBar.style.display = 'block'; policyBar.innerHTML = '<i style="display:block;height:100%;width:100%;background:#667085"></i>'; }
  const policyLink = document.querySelector('.policy-link'); if (policyLink) policyLink.hidden = true;
  setCoinField('#coin-network', `Solana`);
}
async function loadCoinMarketActivity(mintAddress, loadId, decimals, graduated){
  const response = await apiRequest(`/api/tokens/${encodeURIComponent(mintAddress)}/market-activity`, { signal: AbortSignal.timeout(12000) }).catch(() => ({ available: false, data: null }));
  if (loadId !== coinLoadId) return;
  const market = response.available && response.data?.cluster === EXPLORE_CLUSTER ? response.data : null;
  const hasPoolTradeCount = Number.isInteger(market?.poolTradeCount24h);
  if (graduated && !(hasPoolTradeCount && market.poolTradeCount24h > 0
    && ['complete', 'partial'].includes(market.coverage) && Number.isFinite(Number(market.volume24hSol)))) {
    const poolScanNote = !market ? 'PumpSwap trade history is unavailable from RPC.'
      : !hasPoolTradeCount ? 'This API response does not include PumpSwap swaps.'
        : market.coverage === 'partial' ? 'No pool swaps were found in this partial RPC scan.'
          : 'No verified PumpSwap swaps were found in the last 24h.';
    coinMarketActivity = { status: 'unavailable', trades: [], coverage: market?.coverage || null, decimals, graduated: true };
    renderCoinPricePath(); renderCoinFlow(NaN, NaN); renderCoinPulse();
    setCoinField('#coin-volume', 'Pool activity unavailable'); setCoinField('#coin-volume-source', poolScanNote);
    setCoinField('#coin-change', 'Pool change unavailable'); setCoinField('#coin-trade-count', 'Unavailable');
    setCoinField('#coin-trade-breakdown', hasPoolTradeCount ? 'No pool swaps observed' : 'Pool trades unavailable');
    setCoinField('#coin-description', 'Trading pool confirmed. Recent trade history is unavailable.');
    setCoinTabLabels(); renderCoinActivityTab(); renderCoinSummary();
    return;
  }
  if (!market || market.volume24hSol == null || !Number.isFinite(Number(market.volume24hSol))) {
    coinMarketActivity = { status: 'unavailable', trades: [], coverage: null, decimals };
    renderCoinPricePath(); renderCoinFlow(NaN, NaN); renderCoinPulse();
    setCoinField('#coin-volume', 'Unavailable'); setCoinField('#coin-volume-source', 'RPC trade history unavailable');
    setCoinField('#coin-trade-count', 'Unavailable'); setCoinField('#coin-trade-breakdown', 'RPC trade history unavailable');
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
  }
  coinMarketActivity = { status: hasTradeRows ? 'ready' : 'summary-only', trades: hasTradeRows ? market.recentTrades : [], activityWindows: market.activityWindows, coverage: market.coverage, decimals, graduated: Boolean(graduated), poolTradeCount24h: Number(market.poolTradeCount24h) || 0, tradeCount: Number(market.tradeCount24h) || 0, volume24hSol: Number(market.volume24hSol), buyVolume24hSol: Number(market.buyVolume24hSol), sellVolume24hSol: Number(market.sellVolume24hSol) };
  renderCoinSummary();
  const partial = market.coverage === 'partial';
  renderCoinPricePath(); renderCoinPulse();
  renderCoinFlow(market.buyVolume24hSol, market.sellVolume24hSol, partial);
  setCoinField('#coin-trade-count', `${partial ? '≥' : ''}${coinMarketActivity.tradeCount}`);
  const hasSideCounts = Number.isInteger(market.buyCount24h) && Number.isInteger(market.sellCount24h);
  setCoinField('#coin-trade-breakdown', hasSideCounts ? `${partial ? '≥' : ''}${market.buyCount24h} buys · ${partial ? '≥' : ''}${market.sellCount24h} sells` : 'Buy/sell split unavailable');
  setCoinTabLabels(); renderCoinActivityTab();
  const noTrades = market.coverage === 'complete' && Number(market.tradeCount24h) === 0;
  const volume = `${market.coverage === 'partial' ? '≥' : ''}${formatCoinUsd(Number(market.volume24hSol))}`;
  setCoinField('#coin-volume', noTrades ? 'No trades' : market.coverage === 'partial' ? `${volume} · partial` : volume);
  setCoinField('#coin-volume-source', noTrades ? 'Complete Pump curve scan · last 24h' : partial ? `Partial ${graduated ? 'curve + pool' : 'curve'} RPC scan` : `${graduated ? 'Pump curve + PumpSwap pool' : 'Pump curve'} RPC scan · 24h`);
  if (graduated) setCoinField('#coin-description', `Trading pool confirmed. Recent trades are shown below${partial ? ', though some history may be missing' : ''}.`);
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
  setCoinField('#coin-page-title', 'Loading token…'); setCoinField('#coin-symbol', 'TOKEN'); setCoinField('#coin-address', shortAddress(mintAddress));
  setCoinField('#coin-description', 'Checking coin details on Solana…');
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
    renderCoinRewardsPolicy(registeredLaunch, mintAddress);
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
    const fullHolderDistribution = accountAvailable
      ? summarizeFullHolderDistribution(largestAccounts, curveVaultAddress, parsedMint.supply) : null;
    const realQuote = graduatedPool?.quoteReservesSol ?? curve?.realQuoteReservesSol;
    const ledger = await apiRequest(`/api/tokens/${encodeURIComponent(mintAddress)}/fee-activity`, { signal: AbortSignal.timeout(8000) }).catch(() => ({ available: false, data: null }));
    if (loadId !== coinLoadId) return;
    const ledgerAvailable = ledger.available && ledger.data?.cluster === EXPLORE_CLUSTER;
    const linkedRouter = ledgerAvailable && curve?.creator === ledger.data?.sharedRouter?.address;
    coinActivity = { status: 'ready', symbol, accounts, accountAvailable, holderDistribution: fullHolderDistribution, holderCount: fullHolderDistribution?.walletCount ?? 0, holderCountPartial: false, tokenDecimals: decimals, vaultAddress: curveVaultAddress || null, vaultLabel: graduatedPool ? 'PumpSwap pool vault' : 'Pump curve vault', ledgerAvailable, ledgerSource: ledger.data?.source === 'funded.app-postgresql' ? 'app database' : 'file ledger', collections: ledgerAvailable ? ledger.data.collections || [] : [], claims: ledgerAvailable ? ledger.data.claims || [] : [], sharedRouterCollections: linkedRouter ? ledger.data.sharedRouter.collections || [] : [] };
    coinSummaryLedgerMint = ledgerAvailable && ledger.data?.mint === mintAddress ? mintAddress : null;
    renderCoinFeeDashboard(coinSummaryLedgerMint ? ledger.data?.overview : { available:false });
    renderCoinAccountDistribution(fullHolderDistribution, decimals, symbol, graduatedPool ? 'PumpSwap pool vault' : 'Curve vault');
    setCoinTabLabels(); renderCoinActivityTab();
    setCoinField('.coin-live-dot', graduatedPool ? 'Trading pool confirmed' : curve ? 'Trading route confirmed' : 'Token confirmed');
    setCoinField('#coin-avatar', symbol.slice(0, 1).toUpperCase()); setCoinField('#coin-symbol', symbol); setCoinField('#coin-artwork-symbol', symbol); setCoinField('#coin-page-title', name);
    setCoinField('#coin-address', shortAddress(mintAddress)); setCoinField('#coin-full-address', mintAddress);
    setCoinField('#coin-description', graduatedPool ? 'Trading pool confirmed. Checking recent trades…' : 'Coin details confirmed on Solana. Checking recent trades…');
    setCoinFact('#coin-stage', graduatedPool ? 'Migrated · PumpSwap' : curve ? curve.complete ? 'Curve complete · pool unavailable' : 'On Pump curve' : 'Unverified', curve ? 'clear' : 'unknown');
    setCoinFact('#coin-fee-owner', linkedRouter ? 'App router address matched' : curve?.creator ? shortAddress(curve.creator) : 'Unavailable', linkedRouter ? 'clear' : 'unknown');
    setCoinFact('#coin-metadata-status', metadataInfo?.data && (metadata.name || metadata.symbol) ? 'On-chain name / symbol' : registeredLaunch ? 'Pump create event verified' : 'No verified name', metadataInfo?.data && (metadata.name || metadata.symbol) || registeredLaunch ? 'clear' : 'unknown');
    coinSolUsdValues = { spot: spotPriceSol, marketCap: marketCapSol, reserve: realQuote, virtualQuote: curve?.virtualQuoteReservesSol ?? NaN, supply };
    renderCoinSummary();
    setCoinField('#coin-market-cap', formatCoinUsd(marketCapSol)); setCoinField('#coin-change', '24h change unavailable');
    setCoinField('#coin-strip-market-cap', formatCoinUsd(marketCapSol));
    setCoinField('#coin-volume', curve && EXPLORE_CLUSTER === 'devnet' ? 'Reading trades…' : '$—'); setCoinField('#coin-liquidity', formatCoinUsd(realQuote));
    setCoinField('#coin-market-cap-label', graduatedPool ? 'Estimated PumpSwap market cap' : 'Estimated curve market cap');
    setCoinField('#coin-market-cap-source', graduatedPool ? 'PumpSwap vault ratio · indicative RPC snapshot' : 'Confirmed Pump curve RPC snapshot');
    setCoinField('#coin-liquidity-label', graduatedPool ? 'Pool reserve' : 'Real reserve');
    setCoinField('#coin-holders', fullHolderDistribution ? `${formatOnChainNumber(fullHolderDistribution.holderShare, 2)}%` : 'Unavailable');
    setCoinField('#coin-holder-count', fullHolderDistribution ? `${fullHolderDistribution.walletCount}` : 'Unavailable');
    setCoinField('#coin-accounts-source', fullHolderDistribution ? `${fullHolderDistribution.accountCount} non-zero token accounts · full minted supply reconciled` : distribution ? `${distribution.otherCount} non-vault token accounts in top ${tokenAccounts} · partial sample` : `${graduatedPool ? 'Pool' : 'Curve'} vault not identified in largest-account sample`);
    setCoinField('#coin-vault-share', distribution ? `${formatOnChainNumber(distribution.vaultShare, 2)}% of supply` : curveVaultAddress && accountAvailable ? 'Outside top sample' : 'Unavailable');
    setCoinField('#coin-largest-account-share', distribution ? distribution.otherCount ? `${formatOnChainNumber(distribution.largestOtherShare, 2)}% of supply` : 'None in sample' : 'Unavailable');
    setCoinField('#coin-top-ten-share', distribution ? distribution.otherCount ? `${formatOnChainNumber(distribution.topTenOtherShare, 2)}% of supply` : 'None in sample' : 'Unavailable');
    setCoinAuthority('#coin-mint-authority', parsedMint.mintAuthority); setCoinAuthority('#coin-freeze-authority', parsedMint.freezeAuthority);
    setCoinField('#coin-supply', `${formatOnChainNumber(supply, 6)} ${symbol}`); setCoinCurveProgress(curve?.complete ? 100 : curve?.progressPercent);
    const curveProgress = document.querySelector('.coin-curve-track > span'); if (curveProgress) curveProgress.textContent = graduatedPool ? 'Migration complete' : 'Bonding curve progress';
    setCoinField('#coin-chart-heading', `${symbol} · market cap in USD`); setCoinField('#coin-full-address', mintAddress);
    const chartFooter = document.querySelector('.coin-chart-panel > .chart-footer'); if (chartFooter) chartFooter.innerHTML = `<span>Mint decimals <b>${decimals}</b></span><span>Supply <b>${formatOnChainNumber(supply, 6)}</b></span>`;
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
    setCoinField('#coin-network', `Solana`);
    if (EXPLORE_CLUSTER === 'devnet') void apiRequest(`/devnet-metadata/${encodeURIComponent(mintAddress)}`, { signal: AbortSignal.timeout(5000) }).then(response => {
      if (loadId !== coinLoadId || !response.available || response.data?.name !== name || response.data?.symbol !== symbol) return;
      const details = response.data;
      setCoinField('#coin-description', details.description || 'Signed Solana metadata is available.');
      const tagline = document.querySelector('#coin-profile-tagline');
      if (tagline) { tagline.textContent = details.tagline || ''; tagline.hidden = !details.tagline; }
      window.fundedSetCoinProfileMetadata?.(details);
      setCoinFact('#coin-metadata-status', 'App name / symbol matched', 'clear');
      if (isDevnetImageUri(details.image, mintAddress)) {
        const avatar = document.querySelector('#coin-avatar');
        if (avatar) { avatar.textContent = ''; avatar.style.backgroundImage = `url("${details.image}")`; avatar.style.backgroundSize = 'cover'; avatar.style.backgroundPosition = 'center'; }
        const artwork = document.querySelector('.coin-artwork');
        if (artwork) { artwork.style.backgroundImage = `linear-gradient(0deg, #07130dc9, #07130d66), url("${details.image}")`; artwork.classList.add('has-image'); }
      }
      for (const [selector, href] of [['#coin-website-link', details.website], ['#coin-x-link', details.twitter], ['#coin-telegram-link', details.telegram], ['#coin-discord-link', details.discord]]) {
        const link = document.querySelector(selector); if (link && typeof href === 'string' && href.startsWith('https://')) { link.href = href; link.hidden = false; }
      }
      compactCoinSocials();
    }).catch(() => {});
    void loadSolUsdQuote();
    if (curve && EXPLORE_CLUSTER === 'devnet') void loadCoinMarketActivity(mintAddress, loadId, decimals, curve.complete === true);
    else { coinMarketActivity = { status: 'unavailable', trades: [], coverage: null, decimals }; renderCoinSummary(); renderCoinPricePath(); renderCoinFlow(NaN, NaN); renderCoinPulse(); setCoinField('#coin-trade-count', 'Unavailable'); setCoinField('#coin-trade-breakdown', 'Pump curve required'); setCoinTabLabels(); renderCoinActivityTab(); }
  } catch (error) {
    if (loadId !== coinLoadId) return;
    console.error('On-chain token detail failed', error);
    const detail = String(error?.message || '');
    renderOnChainUnavailable(/\b429\b|rate limit|too many requests/i.test(detail)
      ? 'Solana RPC is rate limited. Wait a moment, then select Refresh.'
      : /timed out/i.test(detail)
        ? 'Solana RPC timed out. Check your connection and select Refresh.'
        : detail || 'Solana RPC could not load this mint.');
    renderCoinRegistryIdentity(mintAddress);
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
  const sharedEntry = new URLSearchParams(location.search);
  const buyReceipt = sharedEntry.get('buy'), sellReceipt = sharedEntry.get('sell');
  const sharedTradeReceipts = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(String(buyReceipt || ''))
    && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(String(sellReceipt || ''));
  let callout = page.querySelector('#shared-coin-callout');
  if (sharedEntry.has('src') || sharedEntry.has('ref') || sharedTradeReceipts) {
    if (!callout) { callout = document.createElement('div'); callout.id = 'shared-coin-callout'; callout.className = 'share-insights'; page.querySelector('.coin-hero-card')?.after(callout); }
    if (callout) {
      callout.replaceChildren();
      const title = document.createElement('strong'); title.textContent = 'Opened a shared coin link';
      const detail = document.createElement('small'); detail.textContent = 'Save this coin to your watchlist on this device so you can find it again. Check the live data before acting.';
      const save = document.createElement('button'); save.type = 'button'; save.className = 'secondary-button'; save.textContent = getWatchlist().includes(mintAddress) ? 'Saved to watchlist' : 'Save to watchlist';
      save.setAttribute('aria-pressed', String(lastKnownWatchlist.includes(mintAddress)));
      save.addEventListener('click', () => {
        if (!saveWatchlist(mintAddress, { remove: save.getAttribute('aria-pressed') === 'true' })) return;
        renderWatchlist();
        setWatchButtonState(watch, lastKnownWatchlist.includes(mintAddress));
        save.setAttribute('aria-pressed', String(lastKnownWatchlist.includes(mintAddress)));
        save.textContent = lastKnownWatchlist.includes(mintAddress) ? 'Saved to watchlist' : 'Save to watchlist';
      });
      callout.append(title, detail, save);
      if (sharedTradeReceipts && validateSolanaMint(mintAddress).valid) {
        const tradeTitle = document.createElement('strong'); tradeTitle.textContent = 'Check the shared closed trade';
        const tradeNote = document.createElement('small'); tradeNote.textContent = 'The two full receipts are public. Verify the same wallet bought and sold an exact token-account position with no intervening activity.';
        const buyLink = document.createElement('a'); buyLink.href = exploreExplorer(`tx/${encodeURIComponent(buyReceipt)}`); buyLink.textContent = 'Open buy receipt ↗'; buyLink.target = '_blank'; buyLink.rel = 'noopener noreferrer';
        const sellLink = document.createElement('a'); sellLink.href = exploreExplorer(`tx/${encodeURIComponent(sellReceipt)}`); sellLink.textContent = 'Open sell receipt ↗'; sellLink.target = '_blank'; sellLink.rel = 'noopener noreferrer';
        const verify = document.createElement('button'); verify.type = 'button'; verify.className = 'secondary-button'; verify.textContent = 'Verify closed trade result';
        const outcome = document.createElement('small'); outcome.setAttribute('role', 'status');
        verify.addEventListener('click', async () => {
          verify.disabled = true; outcome.textContent = 'Checking finalized receipts and token-account history…';
          try {
            const { formatLamportsAsSol, verifyRoundTripFromSignatures } = await import('./trade-roundtrip.js');
            const activeConnection = connection || (await getSolana(), connection);
            const proof = await verifyRoundTripFromSignatures(activeConnection, { buySignature:buyReceipt, sellSignature:sellReceipt, mint:mintAddress });
            outcome.textContent = `Verified closed position. Wallet SOL change in the two receipts: ${proof.positive ? '+' : ''}${formatLamportsAsSol(proof.netLamports)} SOL. This includes all SOL movements in those transactions; it is not wallet-wide profit.`;
          } catch (error) { outcome.textContent = `Unable to verify this result: ${error.message}`; }
          finally { verify.disabled = false; }
        });
        callout.append(tradeTitle, tradeNote, buyLink, sellLink, verify, outcome);
      }
      if (normalizeReferralCode(sharedEntry.get('ref'))) {
        const consent = document.createElement('label'); consent.className = 'share-visit-consent';
        const checkbox = document.createElement('input'); checkbox.type = 'checkbox';
        checkbox.checked = Boolean(document.querySelector('#share-visit-consent')?.checked);
        checkbox.addEventListener('change', () => {
          const privacyControl = document.querySelector('#share-visit-consent');
          if (!privacyControl) return;
          privacyControl.checked = checkbox.checked;
          privacyControl.dispatchEvent(new Event('change'));
        });
        consent.append(checkbox, document.createTextNode(' Count visits from this browser for the inviter (optional)'));
        const privacy = document.createElement('small'); privacy.textContent = 'A random browser ID and visit day are kept for 30 days. Change this any time in Privacy.';
        callout.append(consent, privacy);
      }
    }
  } else if (callout) callout.remove();
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
  const hideAuthor = event.target.closest('[data-chat-hide]');
  const unhideAuthors = event.target.closest('[data-chat-unhide]');
  if (hideAuthor || unhideAuthors) {
    try {
      if (hideAuthor) hideChatAuthor(EXPLORE_CLUSTER, hideAuthor.dataset.chatHide);
      else resetHiddenChatAuthors(EXPLORE_CLUSTER);
      renderCoinCommunityPanel();
      if (document.querySelector('[data-coin-tab="chat"].active')) renderCoinActivityTab();
      showToast(hideAuthor ? 'Wallet hidden on this device.' : 'Hidden wallets are visible again.');
    } catch { showToast('Device storage is unavailable. Your chat preferences could not be saved.'); }
    return;
  }
  const reportMessage = event.target.closest('[data-chat-report]');
  if (reportMessage) {
    reportMessage.disabled = true;
    try { await tokenChatRequest('report', { messageId: reportMessage.dataset.chatReport, reason: 'spam-or-scam' }); showToast('Report recorded for moderation review.'); }
    catch (error) { showToast(error.message || 'Report could not be recorded.'); }
    finally { reportMessage.disabled = false; }
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
  const chartMetric = event.target.closest('[data-coin-chart-metric]');
  if (chartMetric){ coinChartMetric = chartMetric.dataset.coinChartMetric; renderCoinPricePath(); return; }
  const chartPeriod = event.target.closest('[data-coin-chart-period]');
  if (chartPeriod){ coinChartPeriod = chartPeriod.dataset.coinChartPeriod; renderCoinPricePath(); return; }
  const chartUnit = event.target.closest('[data-coin-chart-unit]');
  if (chartUnit){ coinChartUnit = chartUnit.dataset.coinChartUnit; renderCoinPricePath(); return; }
  const pulsePeriod = event.target.closest('[data-coin-pulse-period]');
  if (pulsePeriod){ coinPulsePeriod = pulsePeriod.dataset.coinPulsePeriod; renderCoinPulse(); return; }
  const refresh = event.target.closest('#coin-refresh');
  if (refresh){ const mint = getCoinMintAddress(); resetCoinSurface(mint); loadCoinOnChain(mint); return; }
  const watch = event.target.closest('#coin-watch');
  if (watch){ const mint = getCoinMintAddress(); if (!mint || !saveWatchlist(mint, { remove: watch.getAttribute('aria-pressed') === 'true' })) return; renderWatchlist(); setWatchButtonState(watch, lastKnownWatchlist.includes(mint)); return; }
  const share = event.target.closest('#coin-share-link');
   if (share){ event.preventDefault(); openCoinShare(getCoinMintAddress(), document.querySelector('#coin-symbol')?.textContent?.trim() || 'Coin', document.querySelector('#coin-page-title')?.textContent?.trim() || ''); return; }
  const boost = event.target.closest('#coin-boost');
  if (boost) { const mint = getCoinMintAddress(); if (mint) openExploreBoost(mint); return; }
  const copy = event.target.closest('#coin-copy-address, #coin-copy-full');
  if (copy){ const address = getCoinMintAddress(); if (!address) return showToast('No mint address in this route'); try { await navigator.clipboard.writeText(address); showToast('Token address copied'); } catch { showToast(address); } }
  const clearTradeFilters = event.target.closest('#coin-trade-clear');
  if (clearTradeFilters){ coinTradeFilter = 'all'; coinTradeSort = { key: 'date', direction: 'desc' }; document.querySelectorAll('[data-coin-trade-filter]').forEach(button => { const active = button.dataset.coinTradeFilter === 'all'; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); }); document.querySelectorAll('#coin-page [data-coin-trade-input]').forEach(input => { input.value = input.dataset.coinTradeInput === 'side' ? 'all' : ''; }); renderCoinActivityTab(); return; }
  const tradeSort = event.target.closest('[data-coin-trade-sort]');
  if (tradeSort){ const key = tradeSort.dataset.coinTradeSort; coinTradeSort = { key, direction: coinTradeSort.key === key && coinTradeSort.direction === 'asc' ? 'desc' : 'asc' }; renderCoinActivityTab(); document.querySelector(`[data-coin-trade-sort="${key}"]`)?.focus(); return; }
  const columnFilter = event.target.closest('[data-coin-column-filter]');
  if (columnFilter){ const key = columnFilter.dataset.coinColumnFilter; if (key === 'trader') { coinTradeOpenFilter = null; renderCoinActivityTab(); document.querySelector('#coin-trade-wallet')?.focus(); return; } coinTradeOpenFilter = coinTradeOpenFilter === key ? null : key; renderCoinActivityTab(); if (coinTradeOpenFilter) document.querySelector(`#coin-trade-refine [data-coin-filter-panel="${key}"] input, #coin-trade-refine [data-coin-filter-panel="${key}"] select`)?.focus(); else document.querySelector(`[data-coin-column-filter="${key}"]`)?.focus(); return; }
  const holderTrades = event.target.closest('[data-coin-holder-trades]');
  if (holderTrades){ const wallet = holderTrades.dataset.coinHolderTrades; if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet || '')) return; document.querySelector('#coin-trade-wallet').value = wallet; coinTradeFilter = 'all'; coinTradeOpenFilter = null; const typeInput = document.querySelector('[data-coin-trade-input="side"]'); if (typeInput) typeInput.value = 'all'; document.querySelectorAll('[data-coin-trade-filter]').forEach(button => { const active = button.dataset.coinTradeFilter === 'all'; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); }); document.querySelectorAll('[data-coin-tab]').forEach(button => button.classList.toggle('active', button.dataset.coinTab === 'trades')); setCoinTabLabels(); renderCoinActivityTab(); document.querySelector('#coin-trade-wallet')?.focus(); return; }
  const tradeFilter = event.target.closest('[data-coin-trade-filter]');
  if (tradeFilter){ coinTradeFilter = tradeFilter.dataset.coinTradeFilter; const typeInput = document.querySelector('[data-coin-trade-input="side"]'); if (typeInput) typeInput.value = coinTradeFilter; document.querySelectorAll('[data-coin-trade-filter]').forEach(button => { const active = button === tradeFilter; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); }); renderCoinActivityTab(); return; }
  const tab = event.target.closest('[data-coin-tab]');
  if (tab){ document.querySelectorAll('[data-coin-tab]').forEach(item => item.classList.toggle('active', item === tab)); setCoinTabLabels(); renderCoinActivityTab(); }
});
document.querySelector('#wallet-page')?.addEventListener('click', async event => {
  const filter = event.target.closest('[data-wallet-filter]');
  if (filter) { walletDetailFilter = filter.dataset.walletFilter; renderWalletDetail(); return; }
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
    if (note?.classList.contains('coin-chat-note')) note.textContent = !connected
      ? 'Connect a Solana wallet to post. A wallet address does not prove project affiliation.'
      : ready ? `Posting as ${shortAddress(connectedWalletAddress)} · wallet control does not prove project affiliation. Report impersonation.`
        : `Posting as ${shortAddress(connectedWalletAddress)} · one wallet approval starts a 30-minute chat session. This does not verify project affiliation.`;
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
  const identityField = { author: session.address };
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
  if (!event.target.matches('[data-coin-trade-input]')) return;
  if (event.target.dataset.coinTradeInput === 'side') {
    coinTradeFilter = event.target.value;
    document.querySelectorAll('[data-coin-trade-filter]').forEach(button => { const active = button.dataset.coinTradeFilter === coinTradeFilter; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  }
  renderCoinActivityTab();
});
document.querySelector('#coin-trade-wallet')?.addEventListener('input', renderCoinActivityTab);
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
  pro: { name: 'Pro launch', subtitle: 'For teams ready to move with intent', progress: '2 of 3 complete', width: '78%', note: 'Priority review is available after the published route is confirmed.' },
  premier: { name: 'Premier launch', subtitle: 'Largest project showcase', progress: '2 of 3 complete', width: '88%', note: 'Spotlight review is available after the published route is confirmed.' },
  airdrop: { name: 'Airdrop reserve', subtitle: 'See who is eligible before you claim', progress: '2 of 3 complete', width: '66%', note: 'Review the allocation policy and claim status before connecting.' },
  explore: { name: 'Browse Launch Directory', subtitle: 'Find launches with a visible signal', progress: '1 of 3 complete', width: '33%', note: 'Open the explorer to inspect route, tier, and receipt history.' },
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
      ['standard', 'STANDARD', 'Start here', 'Launch without the guesswork', 'Core Pump launch, public fee route, and a basic funded.vip X announcement when publishing is active.', '0 $FUNDED', 'Basic X post'],
      ['pro', 'PRO', 'For serious launches', 'Give the launch a stronger signal', 'Pro badge, public burn receipt, and a featured funded.vip X launch post after verification when publishing is active.', '$100 in $FUNDED', 'Featured X post'],
      ['premier', 'PREMIER', 'Largest showcase', 'Put your launch in the spotlight', 'Premier badge, public burn receipt, one funded.vip X launch post and a follow-up after 24 hours when publishing is active.', '$200 in $FUNDED', 'Two X posts'],
    ],
  },
  community: {
    copy: 'Follow the parts of a launch that matter after the mint: allocations, discovery signals, and verified receipts.',
    cta: 'Open community hub',
    href: '#airdrops',
    cards: [
      ['airdrop', 'AIRDROP', 'Claim with context', 'See your community allocation', 'Check eligibility, reserve size, and claim status before signing anything.', '3% MINIMUM', 'Wallet eligibility'],
      ['explore', 'DIRECTORY', 'Discover with signal', 'Find launches worth a closer look', 'Inspect verified routes, launch tiers, and visible commitment signals.', 'LIVE FEED', 'Route + tier'],
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
  if(note)note.textContent=summary&&Object.values(summary).some(bucket=>!bucket.complete)?'One or more reward amounts are unavailable, so affected totals are hidden. Claimed amounts still require a verified Solana payment receipt.':'Totals use collected creator-fee rewards linked to your signed-in X account. Claimed amounts require a verified Solana payment receipt.';
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
    const claimsByAction = [...result.data.claims].sort((a, b) =>
      Number(b.canPrepare === true) - Number(a.canPrepare === true)
      || Number(a.receiptVerified === true) - Number(b.receiptVerified === true));
    for (const claim of claimsByAction) {
      const row=document.createElement('div');row.className='x-claim-reward';row.dataset.claimId=claim.id;
      if(claim.id===selectedId&&claim.canPrepare===true)row.classList.add('selected');
      const state=document.createElement('span');state.className=`x-claim-reward-state ${claim.receiptVerified?'paid':claim.canPrepare?'ready':'pending'}`;state.textContent=claim.receiptVerified?'Paid':claim.canPrepare?'Ready to claim':String(claim.status).startsWith('automatic-')?'Processing payout':'Not ready yet';
      const copy=document.createElement('div');copy.className='x-claim-reward-copy';
      const launch=verifiedLaunchPolicyForMint(claim.mint);
      const coinLabel=launch?[launch.symbol,launch.name].filter(Boolean).join(' · '):`Coin ${String(claim.mint||'').slice(0,6)}…`;
      const coin=document.createElement('a');coin.className='x-claim-coin';coin.href=`/token/${encodeURIComponent(claim.mint)}`;coin.textContent=coinLabel;
      const amount=document.createElement('strong');amount.textContent=claim.amountSol==null?'Amount unavailable':`${claim.amountSol} SOL`;
      const context=document.createElement('small');context.textContent=claim.receiptVerified?`Paid to ${claim.payoutWallet||'verified wallet'}`:claim.canPrepare?'Collected creator fees · ready for your wallet verification':claim.explanation||'Waiting for collected fees';
      copy.append(coin,amount,context);row.append(state,copy);
      row.dataset.claimSummary=`${amount.textContent} from ${coinLabel}`;
      if (claim.canPrepare === true) {
        const choose = document.createElement('button');
        choose.type = 'button'; choose.className = 'secondary-button'; choose.textContent = 'Select reward';
        choose.addEventListener('click', () => { document.querySelector('#sol-claim-id').value=claim.id;document.querySelector('#sol-claim-x-account').value=result.data.handle;document.querySelectorAll('#sol-claim-list .x-claim-reward').forEach(item=>item.classList.toggle('selected',item===row));const check=document.querySelector('#claim-binding-agree');if(check)check.checked=false;updateClaimBindingReview();resetSolClaimStatus(); });
        row.append(choose);
      }
      if(claim.receiptVerified&&claim.payoutSignature){const receipt=document.createElement('a');receipt.href=`https://explorer.solana.com/tx/${encodeURIComponent(claim.payoutSignature)}?cluster=devnet`;receipt.textContent='Verify payment';receipt.target='_blank';receipt.rel='noopener noreferrer';row.append(receipt);}
      list.append(row);
    }
    syncXClaimFlow();
    return result.data.claims;
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
initPaidListing({ getSolana, getConnection: () => connection, getSession: captureWalletSession,
  assertSession: assertWalletSessionCurrent, connectWallet, cluster: APP_CLUSTER,
  fundedMint: PROTOCOL_FUNDED_MINT, mainnetReadOnly: APP_MAINNET_READ_ONLY });
