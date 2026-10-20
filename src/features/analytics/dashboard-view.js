import { icon } from '../../../ui-icons.js';
import { formatTokenBaseAmount } from '../../../trade-panel-balance.js';
import { shortAddress, formatDashboardQuantity, formatDashboardUsd } from '../shared/display.js';

// Presentation only: callers own state, requests, and transaction lifecycles.
export function renderExtendedAnalyticsDashboard({ assets, verifiedLaunchPolicies, verifiedLaunchPoliciesStatus, coinSolUsdPrice, receiptEvidence, receiptEvidenceChecked, paymentHistoryEvidence }, { verifiedLaunchBurns, exploreExplorer, document = globalThis.document } = {}){
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
  const aggregate = paymentHistoryEvidence?.referralSummary;
  const aggregateReady = ['verified','partial'].includes(aggregate?.status)
    && Number.isSafeInteger(aggregate.payoutCount) && aggregate.payoutCount >= 0
    && /^(0|[1-9]\d*)$/.test(String(aggregate.paidLamports))
    && Number.isSafeInteger(Number(aggregate.paidLamports));
  const referralCount = aggregateReady ? aggregate.payoutCount : referralPayouts.length;
  const referralSol = aggregateReady ? Number(aggregate.paidLamports) / 1_000_000_000
    : referralPayouts.reduce((sum, item) => sum + Number(item.amountLamports || 0) / 1_000_000_000, 0);
  const partialReferrals = aggregate?.status === 'partial';
  const referralCard = document.querySelector('[data-analytics-metric="referrals"]');
  if (referralCard) {
    referralCard.querySelector('strong').textContent = referralCount && Number.isFinite(coinSolUsdPrice)
      ? formatDashboardUsd(referralSol * coinSolUsdPrice, { partial:partialReferrals })
      : referralCount ? `${referralSol.toFixed(6)} SOL` : '—';
    referralCard.querySelector('small').innerHTML = referralCount
      ? `<b>${Number.isFinite(coinSolUsdPrice) ? 'USD' : 'SOL'}</b>${referralCount} confirmed referral payment${referralCount === 1 ? '' : 's'}${partialReferrals ? ' · partial coverage' : ''}`
      : `<b>USD</b>${!aggregateReady && !referralPayouts.length || partialReferrals ? 'Referral payment history unavailable' : 'No confirmed referral payments'}`;
  }

  const recipients = document.querySelector('.recipients-panel');
  if (recipients) {
    let scope = recipients.querySelector('[data-payment-scope]');
    if (!scope) {
      scope = document.createElement('p'); scope.dataset.paymentScope = ''; scope.className = 'field-help';
      scope.append('Independently verified Daily bonus receipts are included in payment history totals. View rankings in ');
      const link = document.createElement('a'); link.href = '#bonuses'; link.textContent = 'Daily bonuses';
      scope.append(link,'.'); recipients.append(scope);
    }
    const recentPayouts = Array.isArray(paymentHistoryEvidence?.verifiedPayouts) ? paymentHistoryEvidence.verifiedPayouts : [];
    const coverage = paymentHistoryEvidence?.payoutCoverage?.status;
    const unavailable = receiptEvidenceChecked && (!paymentHistoryEvidence || paymentHistoryEvidence.status === 'unavailable' || coverage === 'unavailable');
    const partial = paymentHistoryEvidence?.status === 'partial' || coverage === 'partial';
    const complete = paymentHistoryEvidence?.status === 'onchain-indexed'
      && (!Object.hasOwn(paymentHistoryEvidence, 'payoutCoverage') || coverage === 'verified');
    const state = !receiptEvidenceChecked ? 'loading' : unavailable ? 'unavailable' : partial ? 'partial' : complete ? 'complete' : 'unavailable';
    const labels = { loading:'Checking payments', unavailable:'Payment history unavailable', partial:'Partial payment history', complete:'No finalized payments' };
    const messages = { loading:'Checking finalized payment history.', unavailable:'Payment history is temporarily unavailable.', partial:'Verification coverage is incomplete. Verified recipient rows are not available in this response.', complete:'No finalized payout receipts are available yet.' };
    const count = recipients.querySelector('.panel-count');
    if (count) count.textContent = recentPayouts.length
      ? `Latest ${Math.min(5, recentPayouts.length)} of ${recentPayouts.length} finalized payments${state === 'partial' ? ' · partial coverage' : state === 'unavailable' ? ' · coverage unavailable' : ''}`
      : labels[state];
    const target = recipients.querySelector('.payment-list, .empty-state');
    if (target && recentPayouts.length) {
      target.className = 'payment-list';
      target.replaceChildren();
      for (const payout of recentPayouts.slice(0, 5)) {
        const row = document.createElement('div'); row.className = 'payment-row';
        const identity = document.createElement('span');
        const name = document.createElement('strong');
        const xHandle = ['mint-router-settle-mint', 'automatic-x'].includes(payout.source)
          && /^@[A-Za-z0-9_]{1,15}$/.test(payout.xHandle || '') ? payout.xHandle : null;
        name.textContent = `${({ 'solana-keeper-referral-claim':'Referral', 'mint-router-settle-mint':'X account', 'automatic-creator':'Creator', 'v3-creator-wallet':'Creator', 'automatic-holder':'Holder', 'automatic-operations':'Protocol', 'v3-operations':'Operations & marketing', 'automatic-community':'Community', 'daily-bonus':'Daily bonus', 'automatic-x':'X account' })[payout.source] || 'Recipient'} · ${xHandle || shortAddress(payout.to)}`;
        const proof = document.createElement('a'); proof.href = exploreExplorer(`tx/${encodeURIComponent(payout.signature)}`); proof.target = '_blank'; proof.rel = 'noopener noreferrer';
        proof.className = 'payment-receipt-link solana-explorer-link';
        proof.innerHTML = icon('solana');
        proof.title = 'View transaction on Solana Explorer';
        proof.setAttribute('aria-label', `View transaction ${shortAddress(payout.signature)} on Solana Explorer (opens in a new tab)`);
        const paid = document.createElement('time'); paid.className = 'recent-payout-time';
        const payoutDate = Number.isSafeInteger(payout.blockTime) && payout.blockTime > 0
          ? new Date(payout.blockTime * 1000) : null;
        if (payoutDate && Number.isFinite(payoutDate.getTime())) {
          paid.dateTime = payoutDate.toISOString();
          paid.textContent = `Paid ${payoutDate.toLocaleString('en-US', { timeZone:'UTC', year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit', hour12:false })} UTC`;
        } else {
          paid.textContent = 'Payout time unavailable';
        }

        const amount = document.createElement('span'); amount.className = 'payment-amount';
        amount.textContent = `${payout.actualReceivedLamports < 0 ? '-' : ''}${formatTokenBaseAmount(Math.abs(payout.actualReceivedLamports), 9, 9)} SOL ${payout.recipientRentLamports > 0 ? 'net change' : 'received'}`;
        identity.append(name, proof, paid); row.append(identity, amount); target.append(row);
      }
    } else if (target) {
      target.className = 'empty-state';
      target.textContent = messages[state];
    }
  }
}
