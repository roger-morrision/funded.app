import { communityClaimUnit } from '../../../community-claim-summary.js';
import { formatDashboardUsd, formatSmallDashboardUsd, formatDashboardQuantity } from '../shared/display.js';

// Presentation only: callers own state, requests, and transaction lifecycles.
export function renderHomeKpiDashboard(verified = assets, { assets, exploreUpdatedAt, coinSolUsdPrice, verifiedLaunchPoliciesStatus, analyticsSummary, EXPLORE_CLUSTER, receiptEvidence, PROTOCOL_FUNDED_MINT }, { verifiedLaunchPolicyForMint, setHomeDashboardMetric, homeFeeAllocations, currentCommunityClaimSummary, renderFundedTokenLanding, document = globalThis.document } = {}){
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

  const airdropClaims = currentCommunityClaimSummary();
  const airdropUnit = document.querySelector('#home-kpi-airdrop-unit');
  if (airdropUnit) airdropUnit.textContent = communityClaimUnit(airdropClaims);
  setHomeDashboardMetric('airdrop', airdropClaims.amount, airdropClaims.note, airdropClaims.state);
  document.querySelector('#home-kpi-airdrop-card')?.setAttribute('title', airdropClaims.note);

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
    status.hidden = !launchFeedUnavailable;
    if (!status.hidden) status.innerHTML = `<i></i> ${launchFeedUnavailable ? `Launch feed unavailable` : `Verified funded launches`}`;
  }
  if (updated) updated.hidden = !launchFeedUnavailable;
  if (updated) updated.textContent = exploreUpdatedAt ? `Checked ${new Date(exploreUpdatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Waiting for first check';
  renderFundedTokenLanding();
}
