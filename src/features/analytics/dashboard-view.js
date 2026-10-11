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
    const recentPayouts = Array.isArray(paymentHistoryEvidence?.verifiedPayouts) ? paymentHistoryEvidence.verifiedPayouts : [];
    const count = recipients.querySelector('.panel-count');
    if (count) count.textContent = recentPayouts.length ? `Latest ${Math.min(5, recentPayouts.length)} of ${recentPayouts.length} finalized payments` : receiptEvidenceChecked && !paymentHistoryEvidence ? 'Payment history unavailable' : 'Checking payments';
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
        name.textContent = `${({ 'solana-keeper-referral-claim':'Referral', 'mint-router-settle-mint':'X account', 'automatic-creator':'Creator', 'automatic-holder':'Holder', 'automatic-operations':'Protocol', 'automatic-community':'Community', 'automatic-x':'X account' })[payout.source] || 'Recipient'} · ${xHandle || shortAddress(payout.to)}`;
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

        const amount = document.createElement('span'); amount.className = 'payment-amount'; amount.textContent = `${formatTokenBaseAmount(payout.actualReceivedLamports, 9, 9)} SOL received`;
        identity.append(name, proof, paid); row.append(identity, amount); target.append(row);
      }
    } else if (target && receiptEvidenceChecked && !paymentHistoryEvidence) {
      target.className = 'empty-state';
      target.textContent = 'Payment history is temporarily unavailable.';
    } else if (target && receiptEvidenceChecked) {
      target.className = 'empty-state';
      target.textContent = 'No finalized payout receipts are available yet.';
    }
  }
}
