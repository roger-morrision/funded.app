import { initializeAppState } from '../runtime.js';

// Startup runs in the order declared in start.js.
export function initializeConnections(appState) {
  // app-source: 140
  const explorer = (path) => `https://explorer.solana.com/${path}${appState.APP_EXPLORER_QUERY}`;
  initializeAppState(appState, 'explorer', explorer);
  // app-source-end

  // app-source: 141
  const exploreExplorer = (path) => `https://explorer.solana.com/${path}${appState.EXPLORE_CLUSTER === 'mainnet-beta' ? '' : `?cluster=${appState.EXPLORE_CLUSTER}`}`;
  initializeAppState(appState, 'exploreExplorer', exploreExplorer);
  // app-source-end

  // app-source: 142
  let wallet = null;
  initializeAppState(appState, 'wallet', wallet);
  // app-source-end

  // app-source: 143
  let connectedWalletAddress = null;
  initializeAppState(appState, 'connectedWalletAddress', connectedWalletAddress);
  // app-source-end

  // app-source: 144
  let walletVersion = 0;
  initializeAppState(appState, 'walletVersion', walletVersion);
  // app-source-end

  // app-source: 145
  let coinChatSession = null;
  initializeAppState(appState, 'coinChatSession', coinChatSession);
  // app-source-end

  // app-source: 146
  let coinChatSessionPromise = null;
  initializeAppState(appState, 'coinChatSessionPromise', coinChatSessionPromise);
  // app-source-end

  // app-source: 147
  let walletConnectRequest = 0;
  initializeAppState(appState, 'walletConnectRequest', walletConnectRequest);
  // app-source-end

  // app-source: 148
  const observedWalletProviders = new WeakSet();
  initializeAppState(appState, 'observedWalletProviders', observedWalletProviders);
  // app-source-end

  // app-source: 149
  const disconnectingWalletProviders = new WeakSet();
  initializeAppState(appState, 'disconnectingWalletProviders', disconnectingWalletProviders);
  // app-source-end

  // app-source: 150
  const WALLET_MANUAL_DISCONNECT_KEY = 'funded.app.wallet.manual-disconnect';
  initializeAppState(appState, 'WALLET_MANUAL_DISCONNECT_KEY', WALLET_MANUAL_DISCONNECT_KEY);
  // app-source-end

  // app-source: 151
  const WALLET_PROVIDER_KEY = 'funded.app.wallet.provider';
  initializeAppState(appState, 'WALLET_PROVIDER_KEY', WALLET_PROVIDER_KEY);
  // app-source-end

  // app-source: 152
  const COIN_CHAT_SESSION_KEY = 'funded.app.token-chat.session.v1';
  initializeAppState(appState, 'COIN_CHAT_SESSION_KEY', COIN_CHAT_SESSION_KEY);
  // app-source-end

  // app-source: 153
  let walletDisconnectRequested = false;
  initializeAppState(appState, 'walletDisconnectRequested', walletDisconnectRequested);
  // app-source-end

  // app-source: 154
  let metricsRequest = 0;
  initializeAppState(appState, 'metricsRequest', metricsRequest);
  // app-source-end

  // app-source: 155
  let launchCostRefreshTimer = null;
  initializeAppState(appState, 'launchCostRefreshTimer', launchCostRefreshTimer);
  // app-source-end

  // app-source: 156
  let walletBalanceLamports = null;
  initializeAppState(appState, 'walletBalanceLamports', walletBalanceLamports);
  // app-source-end

  // app-source: 157
  let walletBalanceRequest = 0;
  initializeAppState(appState, 'walletBalanceRequest', walletBalanceRequest);
  // app-source-end

  // app-source: 158
  let walletBalanceFetchedAt = 0;
  initializeAppState(appState, 'walletBalanceFetchedAt', walletBalanceFetchedAt);
  // app-source-end

  // app-source: 159
  let estimatedLaunchFeeLamports = null;
  initializeAppState(appState, 'estimatedLaunchFeeLamports', estimatedLaunchFeeLamports);
  // app-source-end

  // app-source: 160
  let estimatedInitialBuyLamports = 0;
  initializeAppState(appState, 'estimatedInitialBuyLamports', estimatedInitialBuyLamports);
  // app-source-end

  // app-source: 161
  let estimatedInitialBuyTokens = 0;
  initializeAppState(appState, 'estimatedInitialBuyTokens', estimatedInitialBuyTokens);
  // app-source-end

  // app-source: 162
  let launchCostReview = null;
  initializeAppState(appState, 'launchCostReview', launchCostReview);
  // app-source-end

  // app-source: 163
  let walletMetricsLoading = false;
  initializeAppState(appState, 'walletMetricsLoading', walletMetricsLoading);
  // app-source-end

  // app-source: 164
  let walletEstimateError = '';
  initializeAppState(appState, 'walletEstimateError', walletEstimateError);
  // app-source-end

  // app-source: 165
  let walletDetailTab = 'activity';
  initializeAppState(appState, 'walletDetailTab', walletDetailTab);
  // app-source-end

  // app-source: 166
  let walletDetailFilter = 'all';
  initializeAppState(appState, 'walletDetailFilter', walletDetailFilter);
  // app-source-end

  // app-source: 167
  let portfolioHoldings = { wallet: '', status: 'idle', accounts: [], coverage: '' };
  initializeAppState(appState, 'portfolioHoldings', portfolioHoldings);
  // app-source-end

  // app-source: 168
  let portfolioRequest = 0;
  initializeAppState(appState, 'portfolioRequest', portfolioRequest);
  // app-source-end

  // app-source: 169
  let tradePreview = null;
  initializeAppState(appState, 'tradePreview', tradePreview);
  // app-source-end

  // app-source: 170
  const pendingTradeVerifications = new Map();
  initializeAppState(appState, 'pendingTradeVerifications', pendingTradeVerifications);
  // app-source-end

  // app-source: 171
  let tradeQuoteVersion = 0;
  initializeAppState(appState, 'tradeQuoteVersion', tradeQuoteVersion);
  // app-source-end

  // app-source: 172
  let tradeQuoteTimer = null;
  initializeAppState(appState, 'tradeQuoteTimer', tradeQuoteTimer);
  // app-source-end

  // app-source: 173
  let tradeQuoteInFlight = null;
  initializeAppState(appState, 'tradeQuoteInFlight', tradeQuoteInFlight);
  // app-source-end

  // app-source: 174
  let tradeActionBusy = false;
  initializeAppState(appState, 'tradeActionBusy', tradeActionBusy);
  // app-source-end

  // app-source: 175
  let coinTradeEstimate = null;
  initializeAppState(appState, 'coinTradeEstimate', coinTradeEstimate);
  // app-source-end

  // app-source: 176
  let tradeBalanceRequest = 0;
  initializeAppState(appState, 'tradeBalanceRequest', tradeBalanceRequest);
  // app-source-end

  // app-source: 177
  let tradeBalanceState = { key:'', solLamports:null, tokenRaw:null, tokenDecimals:0 };
  initializeAppState(appState, 'tradeBalanceState', tradeBalanceState);
  // app-source-end

  // app-source: 178
  let launchStep = 1;
  initializeAppState(appState, 'launchStep', launchStep);
  // app-source-end

  // app-source: 179
  let launchMode = 'quick';
  initializeAppState(appState, 'launchMode', launchMode);
  // app-source-end

  // app-source: 180
  let launchProfile = 'fast';
  initializeAppState(appState, 'launchProfile', launchProfile);
  // app-source-end

  // app-source: 181
  let launchBurnTier = 'standard';
  initializeAppState(appState, 'launchBurnTier', launchBurnTier);
  // app-source-end

  // app-source: 182
  let launchBurnReadiness = { ready: true, message: 'No creator-funded burn is required.' };
  initializeAppState(appState, 'launchBurnReadiness', launchBurnReadiness);
  // app-source-end

  // app-source: 183
  let launchTierPricing = null;
  initializeAppState(appState, 'launchTierPricing', launchTierPricing);
  // app-source-end

  // app-source: 184
  let launchTierQuote = null;
  initializeAppState(appState, 'launchTierQuote', launchTierQuote);
  // app-source-end

  // app-source: 185
  let fundedBurnRequest = 0;
  initializeAppState(appState, 'fundedBurnRequest', fundedBurnRequest);
  // app-source-end

  // app-source: 186
  let fundedBurnState = { status: 'idle', wallet: null, decimals: 0, balanceBaseUnits: 0n, supplyBaseUnits: 0n, burnedBaseUnits: 0n, tokenAccounts: [], receipts: [], message: '' };
  initializeAppState(appState, 'fundedBurnState', fundedBurnState);
  // app-source-end

  // app-source: 187
  let fundedBuyRoute = { status:'checking', snapshot:null, reason:'Checking the verified Solana pool…' };
  initializeAppState(appState, 'fundedBuyRoute', fundedBuyRoute);
  // app-source-end

  // app-source: 188
  let fundedBuyPreview = null;
  initializeAppState(appState, 'fundedBuyPreview', fundedBuyPreview);
  // app-source-end

  // app-source: 189
  let fundedBuyBusy = false;
  initializeAppState(appState, 'fundedBuyBusy', fundedBuyBusy);
  // app-source-end

  // app-source: 190
  const FOLLOWED_WALLETS_KEY = 'funded.app.followed.wallets.v1';
  initializeAppState(appState, 'FOLLOWED_WALLETS_KEY', FOLLOWED_WALLETS_KEY);
  // app-source-end

  // app-source: 191
  let lastKnownFollowedWallets = [];
  initializeAppState(appState, 'lastKnownFollowedWallets', lastKnownFollowedWallets);
  // app-source-end

  // app-source: 192
  let lastKnownWatchlist = [];
  initializeAppState(appState, 'lastKnownWatchlist', lastKnownWatchlist);
  // app-source-end

  // app-source: 193
  let watchlistUnavailable = false;
  initializeAppState(appState, 'watchlistUnavailable', watchlistUnavailable);
  // app-source-end

  // app-source: 194
  let watchlistNotice = '';
  initializeAppState(appState, 'watchlistNotice', watchlistNotice);
  // app-source-end

  // app-source: 195
  const APP_REFERRAL_KEY = 'funded.app.referral.attribution';
  initializeAppState(appState, 'APP_REFERRAL_KEY', APP_REFERRAL_KEY);
  // app-source-end

  // app-source: 196
  const REFERRAL_ANALYTICS_KEY = 'funded.app.referral.analytics';
  initializeAppState(appState, 'REFERRAL_ANALYTICS_KEY', REFERRAL_ANALYTICS_KEY);
  // app-source-end

  // app-source: 197
  const REFERRAL_SERVER_KEY_PREFIX = 'funded.app.referral.server.';
  initializeAppState(appState, 'REFERRAL_SERVER_KEY_PREFIX', REFERRAL_SERVER_KEY_PREFIX);
  // app-source-end

  // app-source: 198
  const SHARE_VISIT_KEY = 'funded.vip.share-visit.v1';
  initializeAppState(appState, 'SHARE_VISIT_KEY', SHARE_VISIT_KEY);
  // app-source-end

  // app-source: 199
  const TRADE_ROUNDTRIP_KEY = 'funded.vip.trade-roundtrip.v1';
  initializeAppState(appState, 'TRADE_ROUNDTRIP_KEY', TRADE_ROUNDTRIP_KEY);
  // app-source-end

  // app-source: 200
  const AIRDROP_PREVIEW_CLAIM_KEY = 'funded.app.airdrop.preview-claims';
  initializeAppState(appState, 'AIRDROP_PREVIEW_CLAIM_KEY', AIRDROP_PREVIEW_CLAIM_KEY);
  // app-source-end

  // app-source: 201
  const BUYBACK_PREVIEW_KEY = 'funded.app.buyback.preview-ledger';
  initializeAppState(appState, 'BUYBACK_PREVIEW_KEY', BUYBACK_PREVIEW_KEY);
  // app-source-end

  // app-source: 202
  const LAUNCH_TOKEN_SUPPLY = 1_000_000_000;
  initializeAppState(appState, 'LAUNCH_TOKEN_SUPPLY', LAUNCH_TOKEN_SUPPLY);
  // app-source-end

  // app-source: 203
  const MIN_COMMUNITY_AIRDROP_TOKENS = 30_000_000;
  initializeAppState(appState, 'MIN_COMMUNITY_AIRDROP_TOKENS', MIN_COMMUNITY_AIRDROP_TOKENS);
  // app-source-end

  // app-source: 204
  const MAX_COMMUNITY_AIRDROP_TOKENS = 500_000_000;
  initializeAppState(appState, 'MAX_COMMUNITY_AIRDROP_TOKENS', MAX_COMMUNITY_AIRDROP_TOKENS);
  // app-source-end

  // app-source: 205
  const FEE_ROUTER_PROGRAM_ID = String(import.meta.env.VITE_FUNDED_FEE_ROUTER_PROGRAM_ID || '').trim();
  initializeAppState(appState, 'FEE_ROUTER_PROGRAM_ID', FEE_ROUTER_PROGRAM_ID);
  // app-source-end

  // app-source: 206
  const PROTOCOL_FUNDED_MINT = String(import.meta.env.VITE_FUNDED_TOKEN_MINT || '').trim();
  initializeAppState(appState, 'PROTOCOL_FUNDED_MINT', PROTOCOL_FUNDED_MINT);
  // app-source-end

  // app-source: 207
  const PROTOCOL_FUNDED_SWAP_POOL = String(import.meta.env.VITE_FUNDED_SWAP_POOL || '').trim();
  initializeAppState(appState, 'PROTOCOL_FUNDED_SWAP_POOL', PROTOCOL_FUNDED_SWAP_POOL);
  // app-source-end

  // app-source: 208
  const LAUNCH_BURN_TIERS = appState.createLaunchBurnTiers({
    boostAmount: Number(import.meta.env.VITE_FUNDED_BOOST_BURN_AMOUNT || 25_000),
    proAmount: Number(import.meta.env.VITE_FUNDED_PRO_BURN_AMOUNT || 100_000),
    premierAmount: Number(import.meta.env.VITE_FUNDED_PREMIER_BURN_AMOUNT || 250_000),
  });
  initializeAppState(appState, 'LAUNCH_BURN_TIERS', LAUNCH_BURN_TIERS);
  // app-source-end

  // app-source: 209
  const SELECTABLE_LAUNCH_TIERS = new Set(['standard', 'pro', 'premier']);
  initializeAppState(appState, 'SELECTABLE_LAUNCH_TIERS', SELECTABLE_LAUNCH_TIERS);
  // app-source-end

  // app-source: 210
  let feeRouterState = { status: 'checking', verified: false, address: null, programId: appState.FEE_ROUTER_PROGRAM_ID || null, bump: null };
  initializeAppState(appState, 'feeRouterState', feeRouterState);
  // app-source-end

  // app-source: 211
  let feeRouterRefreshPromise = null;
  initializeAppState(appState, 'feeRouterRefreshPromise', feeRouterRefreshPromise);
  // app-source-end

  // app-source: 212
  let xFeeStatus = { ready: false, reasons: ['X fee service has not been verified'] };
  initializeAppState(appState, 'xFeeStatus', xFeeStatus);
  // app-source-end

  // app-source: 213
  const APP_ECONOMICS = Object.freeze({
    fundedSharePercent: appState.FEE_DISTRIBUTION.fundedPercent,
    creatorSharePercent: appState.FEE_DISTRIBUTION.creatorPercent,
    appReferralRateOfFundedRevenue: appState.FEE_DISTRIBUTION.appReferralRateOfFundedRevenue,
    appReferralEffectivePercent: appState.FEE_DISTRIBUTION.appReferralEffectivePercent,
    appReferralLevels: appState.APP_REFERRAL_LEVELS,
    operationsRateOfFundedRevenue: appState.FEE_DISTRIBUTION.operationsRateOfFundedRevenue,
    operationsEffectivePercent: appState.FEE_DISTRIBUTION.operationsEffectivePercent,
    communityRateOfFundedRevenue: appState.FEE_DISTRIBUTION.communityRateOfFundedRevenue,
    communityEffectivePercent: appState.FEE_DISTRIBUTION.communityEffectivePercent,
    buybackRateOfFundedRevenue: appState.FEE_DISTRIBUTION.buybackRateOfFundedRevenue,
    buybackEffectivePercent: appState.FEE_DISTRIBUTION.buybackEffectivePercent,
  });
  initializeAppState(appState, 'APP_ECONOMICS', APP_ECONOMICS);
  // app-source-end

  // app-source: 214
  const { renderPublishedFeeRates, renderFeeFlowCalculator } = appState.createFeeFlowView(appState.APP_ECONOMICS);
  initializeAppState(appState, 'renderPublishedFeeRates', renderPublishedFeeRates);
  initializeAppState(appState, 'renderFeeFlowCalculator', renderFeeFlowCalculator);
  // app-source-end

}
