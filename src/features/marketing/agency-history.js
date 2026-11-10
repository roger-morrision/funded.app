import { MARKETING_AGENCY_POLICY as POLICY } from '../../../config/marketing-agency.js';
import { AGENCY_RECEIPT_PROGRAM, AGENCY_RECEIPT_SCOPE } from '../../../config/agency-history.js';

// Same readable UTC style as payment and bonus history: 2026-11-01 05:57 UTC.
export function utcMinute(value) {
  const time = Date.parse(String(value || ''));
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '';
}

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
  const wrapper=document.createElement('div');wrapper.className='data-table-scroll';wrapper.tabIndex=0;
  wrapper.setAttribute('role','region');wrapper.setAttribute('aria-label','Agency receipts, scroll horizontally for all columns');
  const table=document.createElement('table');table.className='record-table';
  const caption=document.createElement('caption');caption.textContent='Verified agency receipt history · UTC';table.append(caption);
  const head=table.createTHead().insertRow();
  for(const label of ['Date & time (UTC)','Agent','Activity','Amount (SOL)','Saved trigger','Transaction']){const th=document.createElement('th');th.scope='col';if(['Amount (SOL)','Saved trigger'].includes(label))th.className='numeric';th.textContent=label;head.append(th);}
  const list=table.createTBody();wrapper.append(table);
  for (const row of data.history) {
    if (row?.status !== 'worker-recorded-finalized' || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(row.signature)
      || !Number.isInteger(row.agent) || !POLICY.agents[row.agent]) continue;
    const item = document.createElement('tr'), link = document.createElement('a'), saved = row.savedMarketCapUsd;
    const trigger = Number.isSafeInteger(saved) && saved >= 1 && saved <= 1_000_000_000
      ? `$${saved.toLocaleString('en-US')}` : '—';
    let amount = 'Unavailable';
    if (/^(0|[1-9]\d{0,19})$/.test(String(row.amountLamports))) {
      const n = BigInt(row.amountLamports), fraction = String(n % 1000000000n).padStart(9, '0').replace(/0+$/, '');
      amount = `${n / 1000000000n}${fraction ? '.' + fraction : ''}`;
    }
    link.href = `https://explorer.solana.com/tx/${encodeURIComponent(row.signature)}${import.meta.env?.VITE_SOLANA_CLUSTER==='mainnet-beta'?'':'?cluster=devnet'}`;
    link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.className='receipt-link';link.textContent='View receipt ↗';link.setAttribute('aria-label',`View agent ${row.agent+1} transaction ${row.signature}`);
    for(const [index,value] of [utcMinute(row.finalizedAt)||'Time unavailable',`Agent ${row.agent+1}`,row.agent===0?POLICY.agents[0].name:'Own-coin buyback',amount,trigger].entries()){
      const cell=document.createElement('td');cell.textContent=value;if(index===3||index===4)cell.className='numeric';item.append(cell);
    }
    const proof=document.createElement('td');proof.append(link);item.append(proof);list.append(item);
  }
  if (list.childElementCount) container.append(wrapper);
  else container.append(document.createTextNode(data.history.length
    ? ' Earlier receipt history is unavailable.' : ' No earlier verified agency receipt has been recorded.'));
}
