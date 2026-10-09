import { withMarketWindow } from '../../../market-intelligence.js';
import { formatDashboardUsd } from '../shared/display.js';

// Receive current state on every render; the application owns data and wallet lifecycles.
export function renderHomeOnchainSnapshot(
  verified,
  {
    verifiedLaunchPolicies,
    coinSolUsdPrice,
    assets,
  },
  {
    verifiedLaunchPolicyForMint,
    formatExploreTradeCount,
    formatExploreUsd,
    renderHomeKpiDashboard,
    document = globalThis.document,
  } = {}
) {
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

export function renderOnchainReportState(
  verified,
  {
    exploreUpdatedAt,
    verifiedLaunchPoliciesStatus,
    verifiedLaunchPolicies,
    exploreProviderStatus,
    coinSolUsdPrice,
    analyticsSummary,
  },
  {
    verifiedLaunchPolicyForMint,
    renderVerifiedReceiptEvidence,
    renderExtendedAnalyticsDashboard,
    document = globalThis.document,
  } = {}
) {
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
  if (payoutCard) { payoutCard.querySelector('span').textContent = 'Recent finalized payments'; payoutCard.querySelector('strong').textContent = '—'; payoutCard.querySelector('small').innerHTML = '<b>COUNT</b>Checking payment history'; }
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
