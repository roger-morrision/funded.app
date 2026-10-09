import { renderHomeLaunchBoard as renderHomeLaunchBoardView } from '../../src/features/home/launch-board-view.js';
import { renderRegistry as renderRegistryView } from '../../src/features/explore/registry-view.js';
import { syncXClaimFlow as syncXClaimFlowFeature } from '../../src/features/rewards/x-claim-view.js';
import { updateClaimBindingReview as updateClaimBindingReviewFeature } from '../../src/features/rewards/x-claim-view.js';
import { renderXClaimSummary as renderXClaimSummaryFeature } from '../../src/features/rewards/x-claim-view.js';
import { resetSolClaimStatus as resetSolClaimStatusFeature } from '../../src/features/rewards/x-claim-view.js';
import { submitSolClaim as submitSolClaimFeature } from '../../src/features/rewards/x-claim-controller.js';
import { loadXIdentity as loadXIdentityFeature } from '../../src/features/rewards/x-claim-controller.js';
import { refreshXClaims as refreshXClaimsFeature } from '../../src/features/rewards/x-claim-controller.js';
import { getLaunchMetadataPreview as getLaunchMetadataPreviewView } from '../../src/features/launch/form-validation.js';
import { getLaunchStepState as getLaunchStepStateView } from '../../src/features/launch/form-validation.js';
import { getLaunchSubmissionState as getLaunchSubmissionStateView } from '../../src/features/launch/form-validation.js';
import { updateLaunchButton as updateLaunchButtonView } from '../../src/features/launch/action-view.js';
import { updateLaunchNavigation as updateLaunchNavigationView } from '../../src/features/launch/action-view.js';
import { updateLaunchIdentityWarnings as updateLaunchIdentityWarningsView } from '../../src/features/launch/action-view.js';
import { renderPendingLaunchReview as renderPendingLaunchReviewView } from '../../src/features/launch/action-view.js';
import { updateCostSummary as updateCostSummaryView } from '../../src/features/launch/cost-view.js';
import { renderLaunchCostDetails as renderLaunchCostDetailsView } from '../../src/features/launch/cost-view.js';
import { renderExplorePulse as renderExplorePulseView } from '../../src/features/explore/status-view.js';
import { exploreEmptyReason as exploreEmptyReasonView } from '../../src/features/explore/status-view.js';
import { compactCoinSocials as compactCoinSocialsView } from '../../src/features/coin/header-view.js';
import { renderCoinSummary as renderCoinSummaryView } from '../../src/features/coin/header-view.js';
import { renderHomeHolderRewardCoins as renderHomeHolderRewardCoinsView } from '../../src/features/home/holder-rewards-view.js';
import { updateLaunchPreview as updateLaunchPreviewView } from '../../src/features/launch/preview-view.js';
import { homeLaunchFeeRouteMarkup as homeLaunchFeeRouteMarkupView } from '../../src/features/home/launch-card-view.js';
import { launchCardVolumeUsd as launchCardVolumeUsdView } from '../../src/features/home/launch-card-view.js';
import { homeLaunchCardMarkup as homeLaunchCardMarkupView } from '../../src/features/home/launch-card-view.js';
import { decorateHomeLaunchCard as decorateHomeLaunchCardView } from '../../src/features/home/launch-card-view.js';
import { portfolioTokenCardMarkup as portfolioTokenCardMarkupView } from '../../src/features/portfolio/token-card-view.js';
import { renderRoundTripAction as renderRoundTripActionView } from '../../src/features/trade/amount-view.js';
import { renderTradeBalances as renderTradeBalancesView } from '../../src/features/trade/amount-view.js';
import { renderTradeAmountEstimate as renderTradeAmountEstimateView } from '../../src/features/trade/amount-view.js';
import { updateTradeAmountLabel as updateTradeAmountLabelView } from '../../src/features/trade/amount-view.js';
import { exploreAssetCardMarkup as exploreAssetCardMarkupView } from '../../src/features/explore/asset-card-view.js';
import { decorateExploreAssetCard as decorateExploreAssetCardView } from '../../src/features/explore/asset-card-view.js';
import { createMobileWalletController } from '../../src/features/wallet/mobile-controller.js';
import { renderPortfolio as renderPortfolioView } from '../../src/features/portfolio/holdings-view.js';
import { renderCreatorLaunches as renderCreatorLaunchesView } from '../../src/features/portfolio/creator-launches-view.js';
import { renderWalletDetail as renderWalletDetailView } from '../../src/features/portfolio/wallet-detail-view.js';
import { renderFundedTokenLanding as renderFundedTokenLandingView } from '../../src/features/funded/landing-view.js';
import { renderBuybackDashboard as renderBuybackDashboardView } from '../../src/features/funded/buyback-view.js';
import { renderCoinPromotionBadge as renderCoinPromotionBadgeView } from '../../src/features/coin/promotion-view.js';
import { renderCoinRewardsPolicy as renderCoinRewardsPolicyView } from '../../src/features/coin/promotion-view.js';
import { renderAirdropProgramDetail as renderAirdropProgramDetailView } from '../../src/features/rewards/airdrop-view.js';
import { renderAirdropAnalytics as renderAirdropAnalyticsView } from '../../src/features/rewards/airdrop-view.js';
import { renderExploreControls as renderExploreControlsView } from '../../src/features/explore/controls-view.js';
import { renderExploreBenefitLeaders as renderExploreBenefitLeadersView } from '../../src/features/explore/controls-view.js';
import { renderExplorePayoutStats as renderExplorePayoutStatsView } from '../../src/features/explore/controls-view.js';
import { renderExploreAssets as renderExploreAssetsView } from '../../src/features/explore/assets-view.js';
import { renderHomeOnchainSnapshot as renderHomeOnchainSnapshotView } from '../../src/features/home/onchain-view.js';
import { renderOnchainReportState as renderOnchainReportStateView } from '../../src/features/home/onchain-view.js';
import { renderWalletBurnersBoard as renderWalletBurnersBoardView } from '../../src/features/leaderboard/board-view.js';
import { renderProjectBurnBoard as renderProjectBurnBoardView } from '../../src/features/leaderboard/board-view.js';
import { renderLeaderboard as renderLeaderboardView } from '../../src/features/leaderboard/board-view.js';
import { renderLaunchBurnSelection as renderLaunchBurnSelectionView } from '../../src/features/launch/burn-selection-view.js';
import { renderCoinActivityTab as renderCoinActivityTabView } from '../../src/features/coin/activity-view.js';
import { renderHomeKpiDashboard as renderHomeKpiDashboardView } from '../../src/features/home/kpi-view.js';
import { escapeHtml, shortAddress, formatOnChainNumber, formatUsd, formatCompactUsd, formatDashboardUsd, setCoinField, setCoinFact } from '../../src/features/shared/display.js';
import { renderVerifiedReceiptEvidence as renderVerifiedReceiptEvidenceView } from '../../src/features/payments/receipt-view.js';
import { renderExtendedAnalyticsDashboard as renderExtendedAnalyticsDashboardView } from '../../src/features/analytics/dashboard-view.js';
import { renderCoinPricePath as renderCoinPricePathView } from '../../src/features/coin/chart-view.js';
import { renderCoinPulse as renderCoinPulseView } from '../../src/features/coin/pulse-view.js';
import { renderCoinAccountDistribution } from '../../src/features/coin/holder-distribution-view.js';
import { createFeeFlowView } from '../../src/features/fees/fee-flow-view.js';
import { initProgramPicker } from '../../src/features/home/program-picker.js';
import { createWatchlistSync } from '../../watchlist-sync.js';
import { boostHistoryRows } from '../../boost-history-view.js';
import { productEvent } from '../../product-events.js';
import { emitPilotSignal, pilotInterruptedSignal, verifiedPilotLaunchRegistration } from '../../pilot-event-signals.js';
import { validateBoostQuote, boostPaymentResolution, readPendingBoost, archiveBoostPayment, archiveVerifiedBoostFromHistory, saveSignedBoostPayment } from '../../boost-checkout-recovery.js';
import { readHiddenChatAuthors, hideChatAuthor, resetHiddenChatAuthors } from '../../token-chat-preferences.js';
import { createRoutePoller } from '../../route-polling.js';
import { Buffer } from 'buffer';
import { icon } from '../../ui-icons.js';
import { summarizeFullHolderDistribution, summarizeHolderWalletSample } from '../../holder-wallet-sample.js';
import { BOOST_MEMO_PROGRAM, BOOST_PACKAGES, activeBoostMultiplier, boostPackage } from '../../boost-offer.js';
import { boostPackageBadgesMarkup, observeSupplementalBoostCards, setCardBoostSnapshot } from '../../boost-card-badges.js';
import { formatTradeAmountInput, parseTradeAmountInput } from '../../trade-amount-input.js';
import { tokenBalancePercentage } from '../../trade-panel-balance.js';
import { buildTradeReview } from '../../trade-review-model.js';
import bs58 from 'bs58';
import { APP_REFERRAL_LEVELS, buildFeeDistributionPolicy, FEE_DISTRIBUTION, validateFeeDistribution } from '../../distribution-policy.js';
import { buildLaunchReservePlan, fundedCommunityAirdropPolicy } from '../../airdrop-policy.js';
import { buildBuybackAccrual, buildBuybackPolicy, buildBuybackReceipt, evaluateBuybackBatch, summarizeBuybackLedger } from '../../buyback-policy.js';
import { buildFeeRouterPolicy, deriveMintFeeRouter, verifyFeeRouterAccount } from '../../fee-router.js';
import { buildMintRouterInitializeInstruction, buildPumpLaunchPlan } from '../../mint-router-launch.js';
import { launchReserveInstructions, quoteAtomicReserveBuy } from '../../launch-community-reserve.js';
import { buildLaunchBurnPolicy, createLaunchBurnTiers, validateLaunchBurnPolicy } from '../../launch-burn-policy.js';
import { LAUNCH_TIER_USD, launchTierQuoteCurrent } from '../../launch-tier-quote.js';
import { burnedSupplyBaseUnits, formatTokenBaseUnits, parseTokenAmount, planTokenAccountBurns, projectBurnMemo, waitForSignatureConfirmation } from '../../funded-burn.js';
import { bindReferralAttribution, captureFirstTouch, createReferralCode, normalizeReferralCode } from '../../referral-program.js';
import { buildSolClaimPolicy, normalizeXHandle } from '../../sol-claim-policy.js';
import { buildTradeTransaction, buildVerifiedPoolTradeTransaction, describeTradeQuote, fetchBondingCurveSnapshot, fetchGraduatedPoolSnapshot, fetchVerifiedPoolSnapshot, submitTrade } from '../../pump-trading.js';
import { PUMP_PROGRAM_ID, PUMP_SDK, bondingCurvePda } from '@pump-fun/pump-sdk';
import { PUMP_AMM_PROGRAM_ID, PUMP_AMM_SDK, canonicalPumpPoolPda } from '@pump-fun/pump-swap-sdk';
import { APP_CLUSTER, APP_EXPLORER_QUERY, APP_MAINNET_READ_ONLY, APP_RPC_URL, DEV_MODE, DEV_WALLET_AUTOCONNECT, DEV_WALLET_ROLE, EXPLORE_CLUSTER, EXPLORE_RPC_URL, TRADE_FEE_BPS, TRADE_FEE_OWNER } from '../../app-config.js';
import { apiRequest, persistLaunchPolicy } from '../../client.js';
import { recordLaunchEvent, readLaunchJournal, policyMatchesJournal } from '../../launch-journal.js';
import { launchReview, freshLaunchReview, launchReviewMarkup, launchReviewNeedsRefresh, initialCurvePremiumBps } from '../../launch-review.js';
import { launchReviewStillCurrent } from '../../launch-review-gate.js';
import '../../launch-accessibility.js';
import { withRpcRetry } from '../../rpc-retry.js';
import { getPreparedImage, prepareLaunchImage, assertImageReady } from '../../launch-image.js';
import { launchPolicyStatement } from '../../launch-policy-auth.js';
import { verifiedPromotionBadge } from '../../promotion-badge.js';
import { initPaidListing } from '../../list-page.js';
import { metadataStatement, devnetMetadataUri, devnetImageUri, isDevnetImageUri } from '../../devnet-metadata.js';
import { canonicalLaunchSocialUrl, normalizeXProfileInput } from '../../launch-social-url.js';
import '../../airdrop-claimers-model.js';
import { airdropClaimState } from '../../airdrop-directory-model.js';
import { communityClaimSummary, communityClaimUnit } from '../../community-claim-summary.js';
import { collectRecentTrades, enrichMarketRecord, filterMarketRecords, withMarketWindow } from '../../market-intelligence.js';
import { emptyHomeLaunchFilters, homeLaunchFilterCount, normalizeHomeLaunchFilters, HOME_FILTER_RANGES } from '../../home-launch-filters.js';
import { exploreSocialLinks } from '../../explore-social-links.js';
import { readCurveMetrics, readPumpSwapMetrics } from '../../explore-onchain-metrics.js';
import { publishVerifiedCurves } from '../../verified-curve-state.js';
import { publishTokenListMarkets, tokenAge } from '../../token-list-market-state.js';
import { summarizeTokenAccounts, verifiedRegistryLaunch } from '../../coin-detail-model.js';
import '../../coin-rewards-policy.js';
import { canSignTransactions, connectWalletProvider, selectRememberedWalletProvider, walletAddress, walletLaunches } from '../../wallet-core.js';
import { chooseWallet } from '../../wallet-onboarding.js';
import { quoteCountdownMarkup, updateQuoteCountdowns } from '../../quote-countdown.js';
import { TOKEN_CHAT_MAX_LENGTH, normalizeTokenChatText } from '../../token-chat.js';
import { initShareComposer, openShareComposer, localShareActions } from '../../share-tools.js';
import { verifiedTradeReceipt } from '../../trade-share-proof.js';
import { assessTradeCompletion } from '../../trade-completion.js';
import { hasBuyBalance } from '../../trade-spend-guard.js';
import { aggregateTokenAccounts } from '../../portfolio-model.js';
import { tokenCardData, tokenCardEvidenceLabel, formatPolicyTokenCount } from '../../token-card-data.js';

export const appDependencies = {
  renderHomeLaunchBoardView,
  renderRegistryView,
  syncXClaimFlowFeature,
  updateClaimBindingReviewFeature,
  renderXClaimSummaryFeature,
  resetSolClaimStatusFeature,
  submitSolClaimFeature,
  loadXIdentityFeature,
  refreshXClaimsFeature,
  getLaunchMetadataPreviewView,
  getLaunchStepStateView,
  getLaunchSubmissionStateView,
  updateLaunchButtonView,
  updateLaunchNavigationView,
  updateLaunchIdentityWarningsView,
  renderPendingLaunchReviewView,
  updateCostSummaryView,
  renderLaunchCostDetailsView,
  renderExplorePulseView,
  exploreEmptyReasonView,
  compactCoinSocialsView,
  renderCoinSummaryView,
  renderHomeHolderRewardCoinsView,
  updateLaunchPreviewView,
  homeLaunchFeeRouteMarkupView,
  launchCardVolumeUsdView,
  homeLaunchCardMarkupView,
  decorateHomeLaunchCardView,
  portfolioTokenCardMarkupView,
  renderRoundTripActionView,
  renderTradeBalancesView,
  renderTradeAmountEstimateView,
  updateTradeAmountLabelView,
  exploreAssetCardMarkupView,
  decorateExploreAssetCardView,
  createMobileWalletController,
  renderPortfolioView,
  renderCreatorLaunchesView,
  renderWalletDetailView,
  renderFundedTokenLandingView,
  renderBuybackDashboardView,
  renderCoinPromotionBadgeView,
  renderCoinRewardsPolicyView,
  renderAirdropProgramDetailView,
  renderAirdropAnalyticsView,
  renderExploreControlsView,
  renderExploreBenefitLeadersView,
  renderExplorePayoutStatsView,
  renderExploreAssetsView,
  renderHomeOnchainSnapshotView,
  renderOnchainReportStateView,
  renderWalletBurnersBoardView,
  renderProjectBurnBoardView,
  renderLeaderboardView,
  renderLaunchBurnSelectionView,
  renderCoinActivityTabView,
  renderHomeKpiDashboardView,
  escapeHtml,
  shortAddress,
  formatOnChainNumber,
  formatUsd,
  formatCompactUsd,
  formatDashboardUsd,
  setCoinField,
  setCoinFact,
  renderVerifiedReceiptEvidenceView,
  renderExtendedAnalyticsDashboardView,
  renderCoinPricePathView,
  renderCoinPulseView,
  renderCoinAccountDistribution,
  createFeeFlowView,
  initProgramPicker,
  createWatchlistSync,
  boostHistoryRows,
  productEvent,
  emitPilotSignal,
  pilotInterruptedSignal,
  verifiedPilotLaunchRegistration,
  validateBoostQuote,
  boostPaymentResolution,
  readPendingBoost,
  archiveBoostPayment,
  archiveVerifiedBoostFromHistory,
  saveSignedBoostPayment,
  readHiddenChatAuthors,
  hideChatAuthor,
  resetHiddenChatAuthors,
  createRoutePoller,
  Buffer,
  icon,
  summarizeFullHolderDistribution,
  summarizeHolderWalletSample,
  BOOST_MEMO_PROGRAM,
  BOOST_PACKAGES,
  activeBoostMultiplier,
  boostPackage,
  boostPackageBadgesMarkup,
  observeSupplementalBoostCards,
  setCardBoostSnapshot,
  formatTradeAmountInput,
  parseTradeAmountInput,
  tokenBalancePercentage,
  buildTradeReview,
  bs58,
  APP_REFERRAL_LEVELS,
  buildFeeDistributionPolicy,
  FEE_DISTRIBUTION,
  validateFeeDistribution,
  buildLaunchReservePlan,
  fundedCommunityAirdropPolicy,
  buildBuybackAccrual,
  buildBuybackPolicy,
  buildBuybackReceipt,
  evaluateBuybackBatch,
  summarizeBuybackLedger,
  buildFeeRouterPolicy,
  deriveMintFeeRouter,
  verifyFeeRouterAccount,
  buildMintRouterInitializeInstruction,
  buildPumpLaunchPlan,
  launchReserveInstructions,
  quoteAtomicReserveBuy,
  buildLaunchBurnPolicy,
  createLaunchBurnTiers,
  validateLaunchBurnPolicy,
  LAUNCH_TIER_USD,
  launchTierQuoteCurrent,
  burnedSupplyBaseUnits,
  formatTokenBaseUnits,
  parseTokenAmount,
  planTokenAccountBurns,
  projectBurnMemo,
  waitForSignatureConfirmation,
  bindReferralAttribution,
  captureFirstTouch,
  createReferralCode,
  normalizeReferralCode,
  buildSolClaimPolicy,
  normalizeXHandle,
  buildTradeTransaction,
  buildVerifiedPoolTradeTransaction,
  describeTradeQuote,
  fetchBondingCurveSnapshot,
  fetchGraduatedPoolSnapshot,
  fetchVerifiedPoolSnapshot,
  submitTrade,
  PUMP_PROGRAM_ID,
  PUMP_SDK,
  bondingCurvePda,
  PUMP_AMM_PROGRAM_ID,
  PUMP_AMM_SDK,
  canonicalPumpPoolPda,
  APP_CLUSTER,
  APP_EXPLORER_QUERY,
  APP_MAINNET_READ_ONLY,
  APP_RPC_URL,
  DEV_MODE,
  DEV_WALLET_AUTOCONNECT,
  DEV_WALLET_ROLE,
  EXPLORE_CLUSTER,
  EXPLORE_RPC_URL,
  TRADE_FEE_BPS,
  TRADE_FEE_OWNER,
  apiRequest,
  persistLaunchPolicy,
  recordLaunchEvent,
  readLaunchJournal,
  policyMatchesJournal,
  launchReview,
  freshLaunchReview,
  launchReviewMarkup,
  launchReviewNeedsRefresh,
  initialCurvePremiumBps,
  launchReviewStillCurrent,
  withRpcRetry,
  getPreparedImage,
  prepareLaunchImage,
  assertImageReady,
  launchPolicyStatement,
  verifiedPromotionBadge,
  initPaidListing,
  metadataStatement,
  devnetMetadataUri,
  devnetImageUri,
  isDevnetImageUri,
  canonicalLaunchSocialUrl,
  normalizeXProfileInput,
  airdropClaimState,
  communityClaimSummary,
  communityClaimUnit,
  collectRecentTrades,
  enrichMarketRecord,
  filterMarketRecords,
  withMarketWindow,
  emptyHomeLaunchFilters,
  homeLaunchFilterCount,
  normalizeHomeLaunchFilters,
  HOME_FILTER_RANGES,
  exploreSocialLinks,
  readCurveMetrics,
  readPumpSwapMetrics,
  publishVerifiedCurves,
  publishTokenListMarkets,
  tokenAge,
  summarizeTokenAccounts,
  verifiedRegistryLaunch,
  canSignTransactions,
  connectWalletProvider,
  selectRememberedWalletProvider,
  walletAddress,
  walletLaunches,
  chooseWallet,
  quoteCountdownMarkup,
  updateQuoteCountdowns,
  TOKEN_CHAT_MAX_LENGTH,
  normalizeTokenChatText,
  initShareComposer,
  openShareComposer,
  localShareActions,
  verifiedTradeReceipt,
  assessTradeCompletion,
  hasBuyBalance,
  aggregateTokenAccounts,
  tokenCardData,
  tokenCardEvidenceLabel,
  formatPolicyTokenCount,
};
