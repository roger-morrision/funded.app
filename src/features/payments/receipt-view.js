import { paginateHistory } from '../../../history-pagination.js';
import { exactLamports } from '../../../exact-lamports.js';
import { formatReceiptSol } from '../../../receipt-export.js';
import { formatTokenBaseAmount } from '../../../trade-panel-balance.js';
import { icon } from '../../../ui-icons.js';
import { shortAddress } from '../shared/display.js';

// Presentation only: callers own state, requests, and transaction lifecycles.
export function renderVerifiedReceiptEvidence({ receiptEvidence, analyticsSummary, receiptEvidenceChecked, paymentHistoryEvidence }, { exploreExplorer, renderExtendedAnalyticsDashboard, document = globalThis.document } = {}){
  const verifiedStatus = ['onchain-indexed', 'partial'].includes(receiptEvidence?.status);
  const collections = verifiedStatus && Array.isArray(receiptEvidence.verifiedCollections) ? receiptEvidence.verifiedCollections : [];
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
  const historyPayouts = Array.isArray(paymentHistoryEvidence?.verifiedPayouts) ? paymentHistoryEvidence.verifiedPayouts : [];
  if (payoutCard) {
    payoutCard.querySelector('span').textContent = 'Recent finalized payments';
    payoutCard.querySelector('strong').textContent = paymentHistoryEvidence ? String(historyPayouts.length) : '—';
    payoutCard.querySelector('small').innerHTML = `<b>COUNT</b>${!receiptEvidenceChecked ? 'Checking payment history' : !paymentHistoryEvidence ? 'Payment history unavailable' : historyPayouts.length ? `Latest ${historyPayouts.length} receipts across payout sources` : 'No finalized payments in available history'}`;
  }
  const list = document.querySelector('#payment-list');
  const tape = document.querySelector('#payment-dialog-list');
  if (!list || !tape) return;
  // Live receipt refreshes must not interrupt an expanded fee breakdown.
  const openDetails = container => new Set(Array.from(container.querySelectorAll('details[open]'), details => details.dataset.receiptKey));
  const listOpenDetails = openDetails(list);
  const tapeOpenDetails = openDetails(tape);
  list.replaceChildren();
  tape.replaceChildren();
  for (const [index, receipt] of historyPayouts.entries()) {
    const row = document.createElement('div');
    row.className = 'payment-row payment-history-row';
    const identity = document.createElement('span');
    identity.className = 'payment-history-identity';
    const name = document.createElement('strong');
    name.textContent = ({ 'solana-keeper-referral-claim':'Referral reward', 'mint-router-settle-mint':'X account reward',
      'automatic-creator':'Creator fee', 'automatic-holder':'Holder reward', 'automatic-operations':'Protocol payout',
      'automatic-community':'Community payout', 'automatic-x':'X account reward' })[receipt.source] || 'SOL payout';
    if (['mint-router-settle-mint', 'automatic-x'].includes(receipt.source)
      && /^@[A-Za-z0-9_]{1,15}$/.test(receipt.xHandle || '')) name.textContent += ` · ${receipt.xHandle}`;
    const recipient = document.createElement('span');
    recipient.className = 'payment-history-receiver';
    const receiverLabel = document.createElement('small');
    receiverLabel.textContent = 'To';
    const receiverWallet = document.createElement('a');
    receiverWallet.className = 'payment-history-wallet';
    receiverWallet.textContent = shortAddress(receipt.to);
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
    gross.textContent = `Gross payout ${formatTokenBaseAmount(receipt.amountLamports, 9, 9)} SOL`;
    const fee = document.createElement('small');
    fee.className = 'payment-history-fee';
    fee.textContent = receipt.feeLamports == null ? 'Transaction fee unavailable'
      : `Transaction fee ${formatTokenBaseAmount(receipt.feeLamports, 9, 9)} SOL · paid by ${receipt.feePayer === receipt.to ? 'receiver' : shortAddress(receipt.feePayer)}`;
    identity.append(name, recipient, paid);
    const details = document.createElement('details');
    details.className = 'payment-history-details';
    const receiptKey = `${receipt.signature}:${receipt.to}:${receipt.source}`;
    details.dataset.receiptKey = receiptKey;
    const detailsSummary = document.createElement('summary');
    detailsSummary.textContent = 'Details';
    const fullReceiver = document.createElement('small');
    fullReceiver.textContent = `Receiver ${receipt.to}`;
    details.append(detailsSummary, fullReceiver, gross, fee);
    const actions = document.createElement('span');
    actions.className = 'payment-history-actions';
    const amount = document.createElement('span');
    amount.className = 'payment-amount';
    const amountValue = document.createElement('strong');
    amountValue.textContent = formatTokenBaseAmount(receipt.actualReceivedLamports, 9, 9);
    const amountUnit = document.createElement('small');
    amountUnit.textContent = 'SOL received';
    amount.append(amountValue, amountUnit);
    const proof = document.createElement('a');
    proof.className = 'payment-receipt-link';
    proof.href = exploreExplorer(`tx/${encodeURIComponent(receipt.signature)}`);
    proof.target = '_blank';
    proof.rel = 'noopener noreferrer';
    proof.innerHTML = icon('external');
    proof.setAttribute('aria-label', `View confirmed payout transaction ${shortAddress(receipt.signature)} on Solana Explorer`);
    proof.title = 'View transaction on Solana Explorer';
    actions.append(amount, proof);
    row.append(identity, actions, details);
    if (index < 5) {
      const previewRow = row.cloneNode(true);
      previewRow.querySelector('details').open = listOpenDetails.has(receiptKey);
      list.append(previewRow);
    }
    details.open = tapeOpenDetails.has(receiptKey);
    tape.append(row);
  }
  if (!historyPayouts.length) {
    list.innerHTML = '<p class="empty-state">No confirmed payments are available to show yet.</p>';
    tape.innerHTML = '<p class="empty-state">No confirmed payments are available to show yet.</p>';
  }
  paginateHistory(tape, {label:'Payment history', selector:'.payment-history-row'});
  const footnote = document.querySelector('#payment-history-footnote');
  if (footnote) footnote.textContent = historyPayouts.length
    ? `Latest ${Math.min(5, historyPayouts.length)} of ${historyPayouts.length} confirmed payments · fees in details${paymentHistoryEvidence.status === 'partial' ? ' · some history is missing' : ''}`
    : paymentHistoryEvidence?.status === 'partial' || !paymentHistoryEvidence ? 'Payment history could not be fully checked. Try again shortly.'
      : 'No confirmed payments are available.';
  renderExtendedAnalyticsDashboard();
}
