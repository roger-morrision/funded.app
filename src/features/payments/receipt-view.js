import { paginateHistory } from '../../../history-pagination.js';
import { exactLamports } from '../../../exact-lamports.js';
import { formatReceiptSol } from '../../../receipt-export.js';
import { formatTokenBaseAmount } from '../../../trade-panel-balance.js';
import { icon } from '../../../ui-icons.js';
import { shortAddress } from '../shared/display.js';

export function payoutType(source) {
  return ({ 'solana-keeper-referral-claim':'referral', 'mint-router-settle-mint':'x',
    'automatic-creator':'creator', 'v3-creator-wallet':'creator',
    'automatic-holder':'holder', 'automatic-operations':'operations', 'v3-operations':'operations',
    'automatic-community':'community', 'daily-bonus':'community', 'automatic-x':'x' })[source] || 'other';
}

export function filterPaymentHistory(rows, { type = 'all', from = '', to = '', query = '' } = {}) {
  const search = query.trim();
  return rows.filter(row => {
    if (type !== 'all' && payoutType(row.source) !== type) return false;
    if (search && ![row.to, row.signature].some(id => typeof id === 'string' && id.includes(search))) return false;
    if (!from && !to) return true;
    if (!Number.isSafeInteger(row.blockTime) || row.blockTime <= 0) return false;
    const day = new Date(row.blockTime * 1000).toISOString().slice(0, 10);
    return (!from || day >= from) && (!to || day <= to);
  });
}

// Presentation validity only: existing UTC row filtering remains unchanged.
export function isPaymentHistoryRangeInverted({from='',to='',fromValid=false,toValid=false,fromTime=NaN,toTime=NaN}={}) {
  return Boolean(from && to && fromValid && toValid && Number.isFinite(fromTime)
    && Number.isFinite(toTime) && fromTime > toTime);
}
const rangeAttributes = new WeakMap();
function presentPaymentHistoryDateRange(document) {
  const from=document.querySelector('#payment-history-from'),to=document.querySelector('#payment-history-to');
  const conflict=isPaymentHistoryRangeInverted({from:from?.value,to:to?.value,
    fromValid:from?.validity.valid,toValid:to?.validity.valid,fromTime:from?.valueAsNumber,toTime:to?.valueAsNumber});
  const error=document.querySelector('#payment-history-range-error');
  if(!error)return conflict;
  for(const input of [from,to].filter(Boolean)) {
    if(conflict) {
      if(!rangeAttributes.has(input))rangeAttributes.set(input,{invalid:input.getAttribute('aria-invalid'),description:input.getAttribute('aria-describedby')});
      const before=rangeAttributes.get(input),tokens=(input.getAttribute('aria-describedby')||'').split(/\s+/).filter(Boolean);
      if(!tokens.includes(error.id)) {
        before.writtenDescription=[...tokens,error.id].join(' ');
        input.setAttribute('aria-describedby',before.writtenDescription);
      }
      if(input.getAttribute('aria-invalid')!=='true')input.setAttribute('aria-invalid','true');
    } else if(rangeAttributes.has(input)) {
      const before=rangeAttributes.get(input),current=input.getAttribute('aria-describedby');
      if(current===before.writtenDescription) {
        if(before.description===null)input.removeAttribute('aria-describedby');else input.setAttribute('aria-describedby',before.description);
      } else {
        const remaining=(current||'').split(/\s+/).filter(token=>token&&token!==error.id).join(' ');
        if(remaining)input.setAttribute('aria-describedby',remaining);else input.removeAttribute('aria-describedby');
      }
      if(before.invalid===null)input.removeAttribute('aria-invalid');else input.setAttribute('aria-invalid',before.invalid);
      rangeAttributes.delete(input);
    }
  }
  const text=conflict?'Choose a From date on or before the To date.':'';
  if(error.textContent!==text)error.textContent=text;
  if(error.hidden===conflict)error.hidden=!conflict;
  return conflict;
}

function preserveReceiptFocus(list, document) {
  const active = document.activeElement;
  if (!active || !list.contains(active) || !active.getClientRects().length) return () => {};
  const selectors = ['summary', '.payment-history-wallet', '.payment-copy-receiver', '.payment-receipt-link'];
  const selector = selectors.find(value => active.matches(value));
  const key = active.closest('.payment-history-row')?.querySelector('details')?.dataset.receiptKey;
  if (!selector || !key) return () => {};
  const scroll = [];
  for (let parent = active.parentElement; parent; parent = parent.parentElement) {
    if (parent === document.scrollingElement || parent.scrollHeight > parent.clientHeight || parent.scrollWidth > parent.clientWidth) {
      scroll.push({element:parent, top:parent.scrollTop, left:parent.scrollLeft});
    }
  }
  return () => {
    // Do not override another focus owner, including synchronous focus handlers.
    if (document.activeElement !== document.body && document.activeElement !== active) return;
    const details = [...list.querySelectorAll('.payment-history-details')].find(item => item.dataset.receiptKey === key);
    const target = details?.closest('.payment-history-row')?.querySelector(selector);
    const retained = target && target.getClientRects().length;
    // The stable filter button is the explicit fallback only when the receipt
    // has actually disappeared from the current filtered/paginated view.
    const next = retained ? target : document.querySelector('#payment-history-clear');
    if (!next?.getClientRects().length) return;
    next.focus({preventScroll:true});
    for (const position of scroll) if (position.element.isConnected) {
      position.element.scrollTo({top:position.top, left:position.left, behavior:'instant'});
    }
    const box = next.getBoundingClientRect(), style = getComputedStyle(next);
    const outline = (parseFloat(style.outlineWidth) || 0) + Math.max(0, parseFloat(style.outlineOffset) || 0);
    const header = document.querySelector('.topbar'), nav = document.querySelector('.mobile-workspace-nav');
    const top = header?.getClientRects().length ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
    const bottom = nav?.getClientRects().length ? nav.getBoundingClientRect().top : innerHeight;
    // Stable rows stay stationary. Only reveal a moved/removed control when
    // keeping the old scroll position would hide its focus cue.
    if (box.top - outline < top || box.bottom + outline > bottom) {
      next.scrollIntoView({behavior:'instant', block:'center', inline:'nearest'});
    }
  };
}

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
      const recorded = Number(receiptEvidence?.coverage?.recordedCollections || collections.length);
      const checkedAt = Date.parse(receiptEvidence?.generatedAt || '');
      const freshness = Number.isFinite(checkedAt)
        ? ` · checked ${new Date(checkedAt).toISOString().slice(11, 16)} UTC` : '';
      feeCard.querySelector('small').innerHTML = `<b>SOL</b>${collections.length}/${recorded} confirmed fee claims · finalized history${freshness}`;
    } catch {
      feeCard.querySelector('strong').textContent = '—';
      feeCard.querySelector('small').innerHTML = '<b>SOL</b>Collection total unavailable; inspect individual receipts';
    }
  }
  const historyPayouts = Array.isArray(paymentHistoryEvidence?.verifiedPayouts) ? paymentHistoryEvidence.verifiedPayouts : [];
  if (payoutCard) {
    payoutCard.querySelector('span').textContent = 'Finalized payments';
    payoutCard.querySelector('strong').textContent = paymentHistoryEvidence ? String(historyPayouts.length) : '—';
    const recorded = Number(paymentHistoryEvidence?.checkedAutomatic || 0)
      + Number(paymentHistoryEvidence?.checkedCreator || 0) + Number(paymentHistoryEvidence?.checkedDaily || 0)
      + Number(paymentHistoryEvidence?.checkedOperations || 0);
    const checkedAt = Date.parse(paymentHistoryEvidence?.generatedAt || '');
    const freshness = Number.isFinite(checkedAt)
      ? ` · checked ${new Date(checkedAt).toISOString().slice(11, 16)} UTC` : '';
    payoutCard.querySelector('small').innerHTML = `<b>COUNT</b>${!receiptEvidenceChecked ? 'Checking payment history' : !paymentHistoryEvidence ? 'Payment history unavailable' : recorded ? `${historyPayouts.length}/${recorded} finalized payouts indexed${freshness}` : historyPayouts.length ? `${historyPayouts.length} finalized payouts indexed${freshness}` : 'No finalized payments in available history'}`;
  }
  const list = document.querySelector('#payment-list');
  if (!list) return;
  const filters = {
    query:document.querySelector('#payment-history-search')?.value.trim() || '',
    type:document.querySelector('#payment-history-type')?.value || 'all',
    from:document.querySelector('#payment-history-from')?.value || '',
    to:document.querySelector('#payment-history-to')?.value || '',
  };
  const coverage = paymentHistoryEvidence?.payoutCoverage?.status;
  const unavailable = receiptEvidenceChecked && (!paymentHistoryEvidence || paymentHistoryEvidence.status === 'unavailable' || coverage === 'unavailable');
  const partial = paymentHistoryEvidence?.status === 'partial' || coverage === 'partial';
  const complete = paymentHistoryEvidence?.status === 'onchain-indexed'
    && (!Object.hasOwn(paymentHistoryEvidence, 'payoutCoverage') || coverage === 'verified');
  const historyState = !receiptEvidenceChecked ? 'loading' : unavailable ? 'unavailable' : partial ? 'partial' : complete ? 'complete' : 'unavailable';
  const emptyMessages = {
    loading:'Checking finalized payout receipts.',
    unavailable:'Payment history is temporarily unavailable.',
    partial:'Verification coverage is incomplete. Confirmed payments are not available in this response.',
    complete:'No confirmed payments are available to show yet.',
  };
  const rangeConflict = presentPaymentHistoryDateRange(document);
  const filtered = rangeConflict ? [] : filterPaymentHistory(historyPayouts, filters);
  // Live receipt refreshes must not interrupt an expanded fee breakdown.
  const openDetails = container => new Set(Array.from(container.querySelectorAll('details[open]'), details => details.dataset.receiptKey));
  const listOpenDetails = openDetails(list);
  const restoreFocus = preserveReceiptFocus(list, document);
  list.replaceChildren();
  for (const receipt of filtered) {
    const row = document.createElement('div');
    row.className = 'payment-row payment-history-row';
    const identity = document.createElement('span');
    identity.className = 'payment-history-identity';
    const name = document.createElement('strong');
    name.textContent = ({ 'solana-keeper-referral-claim':'Referral reward', 'mint-router-settle-mint':'X account reward',
      'automatic-creator':'Creator fee', 'v3-creator-wallet':'Creator fee',
      'automatic-holder':'Holder reward', 'automatic-operations':'Protocol payout', 'v3-operations':'Operations & marketing',
      'automatic-community':'Community payout', 'daily-bonus':'Daily bonus', 'automatic-x':'X account reward' })[receipt.source] || 'SOL payout';
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
    detailsSummary.textContent = 'Amount and fees';
    const fullReceiver = document.createElement('small');
    fullReceiver.textContent = `Receiver ${receipt.to}`;
    details.append(detailsSummary, fullReceiver, gross, fee);
    if (receipt.recipientRentLamports > 0) {
      const rent = document.createElement('small');
      rent.textContent = `Payment account rent ${formatTokenBaseAmount(receipt.recipientRentLamports, 9, 9)} SOL · paid by receiver`;
      details.append(rent);
    }
    const actions = document.createElement('span');
    actions.className = 'payment-history-actions';
    const amount = document.createElement('span');
    amount.className = 'payment-amount';
    const amountValue = document.createElement('strong');
    amountValue.textContent = `${receipt.actualReceivedLamports < 0 ? '-' : ''}${formatTokenBaseAmount(Math.abs(receipt.actualReceivedLamports), 9, 9)}`;
    const amountUnit = document.createElement('small');
    amountUnit.textContent = receipt.recipientRentLamports > 0 ? 'SOL net change' : 'SOL received';
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
    details.open = listOpenDetails.has(receiptKey);
    list.append(row);
  }
  if (!filtered.length) {
    const noMatch = filters.query ? 'No confirmed payments match this search and these filters.' : 'No confirmed payments match these filters.';
    list.innerHTML = `<p class="empty-state">${rangeConflict ? 'Correct the date range to view matching payments.' : historyPayouts.length ? noMatch : emptyMessages[historyState]}</p>`;
  }
  paginateHistory(list, {label:'Payment history', selector:'.payment-history-row', key:JSON.stringify(filters), pageSize:10});
  const footnote = document.querySelector('#payment-history-footnote');
  const footnoteMessage = rangeConflict
    ? ({ loading:'Waiting for the current payment history check to finish.',
      unavailable:'Payment history could not be fully checked. Try again shortly.',
      partial:'Available history is incomplete.', complete:'Payment history check is complete.' })[historyState]
    : historyPayouts.length
    ? `${filtered.length} of ${historyPayouts.length} confirmed payments${filters.from || filters.to ? ' · dates in UTC' : ''} · fees in details${historyState === 'partial' ? ' · some history is missing' : historyState === 'unavailable' ? ' · coverage unavailable' : historyState === 'loading' ? ' · checking payment history' : ''}`
    : ({ loading:'Waiting for the current payment history check to finish.',
      unavailable:'Payment history could not be fully checked. Try again shortly.',
      partial:'Available history is incomplete. No confirmed payments are available in this response.',
      complete:'No confirmed payments are available.' })[historyState];
  if (footnote && footnote.textContent !== footnoteMessage) footnote.textContent = footnoteMessage;
  renderExtendedAnalyticsDashboard();
  restoreFocus();
}
