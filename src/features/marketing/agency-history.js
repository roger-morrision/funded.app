import { MARKETING_AGENCY_POLICY as POLICY } from '../../../config/marketing-agency.js';
import { AGENCY_RECEIPT_PROGRAM, AGENCY_RECEIPT_SCOPE } from '../../../config/agency-history.js';

export function renderAgencyHistory(container, data, { currentVerified = false } = {}) {
  const document = container.ownerDocument, proof = data?.historyVerification;
  const trusted = currentVerified || (proof?.scope === AGENCY_RECEIPT_SCOPE
    && proof.programId === AGENCY_RECEIPT_PROGRAM
    && /^[a-f0-9]{64}$/.test(proof.approvedHash));
  container.replaceChildren();
  if (!trusted || data?.historyStatus !== 'worker-recorded-finalized' || !Array.isArray(data.history)) {
    container.textContent = 'Earlier receipt history is unavailable.';
    return;
  }
  const note = document.createElement('span');
  note.textContent = `${currentVerified ? 'Budgets are timestamped finalized worker snapshots. ' : ''}Earlier worker-recorded verified receipts do not establish current execution readiness, available funds or a new payment.`;
  container.append(note);
  const list = document.createElement('ul');
  for (const row of data.history) {
    if (row?.status !== 'worker-recorded-finalized' || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(row.signature)
      || !Number.isInteger(row.agent) || !POLICY.agents[row.agent]) continue;
    const item = document.createElement('li'), link = document.createElement('a'), saved = row.savedMarketCapUsd;
    const trigger = Number.isSafeInteger(saved) && saved >= 1 && saved <= 1_000_000_000
      ? ` · Saved trigger $${saved.toLocaleString('en-US')}` : '';
    const caption = row.agent === 0 ? POLICY.agents[0].name : `Agent ${row.agent + 1} · Own-coin buyback${trigger}`;
    let amount = 'Unavailable';
    if (/^(0|[1-9]\d{0,19})$/.test(String(row.amountLamports))) {
      const n = BigInt(row.amountLamports), fraction = String(n % 1000000000n).padStart(9, '0').replace(/0+$/, '');
      amount = `${n / 1000000000n}${fraction ? '.' + fraction : ''} SOL`;
    }
    link.href = `https://explorer.solana.com/tx/${encodeURIComponent(row.signature)}?cluster=devnet`;
    link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.textContent = `${caption} · ${amount} · ${row.finalizedAt || 'Finalized'} ↗`;
    item.append(link); list.append(item);
  }
  if (list.childElementCount) container.append(list);
  else container.append(document.createTextNode(data.history.length
    ? ' Earlier receipt history is unavailable.' : ' No earlier verified agency receipt has been recorded.'));
}
