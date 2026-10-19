import { dailyBonusPayments, dailyBonusStatus } from './daily-bonus-payments.js';
import { currentFeePolicyCopy } from './fee-policy-copy.js';
import { bonusSnapshotLabel } from './bonus-labels.js';
const GROUPS = { creators:'Top creators', referrals:'Top referrers', traders:'Top traders' };
const sol = value => {
  const n = BigInt(value || '0');
  return `${n / 1_000_000_000n}.${String(n % 1_000_000_000n).padStart(9, '0').replace(/0+$/, '') || '0'} SOL`;
};
const short = value => `${value.slice(0, 5)}…${value.slice(-5)}`;
export function initDailyBonusView(document = globalThis.document) {
  const parent = document?.getElementById?.('capital-flow');
  if (!parent || document.getElementById('daily-bonus-dashboard')) return;
  const root = document.createElement('section');
  root.id = 'daily-bonus-dashboard'; root.className = 'panel daily-bonus-dashboard';
  root.setAttribute('aria-labelledby', 'daily-bonus-title');
  root.innerHTML = `<div class="panel-heading"><div><p class="eyebrow">Daily bonus · SOL</p><h2 id="daily-bonus-title">Top 3. Every 24 hours.</h2></div><button type="button" data-bonus-refresh>Refresh</button></div><p>${currentFeePolicyCopy().bonus}</p><p class="field-help">${currentFeePolicyCopy().bonusFunding}</p><p data-bonus-status role="status">Checking daily snapshots…</p><label data-bonus-day-label hidden>Snapshot day (UTC)<select data-bonus-day aria-label="Daily bonus snapshot day"></select></label><div data-bonus-results></div>`;
  parent.append(root);
  const results = root.querySelector('[data-bonus-results]'), status = root.querySelector('[data-bonus-status]');
  const select = root.querySelector('select');
  let data, serial = 0;
  function render() {
    const qa = data?.schedule?.mode === 'devnet-qa-5m' && data.schedule.periodSeconds === 300;
    root.querySelector('h2').textContent = qa ? 'Top 3. Every 5 minutes · Devnet QA.' : 'Top 3. Every 24 hours.';
    results.replaceChildren();
    const snapshot = data?.snapshots?.find(row => row.day === select.value);
    const nextTime = Date.parse(data?.nextCutoffAt || '');
    const next = Number.isFinite(nextTime) ? new Date(nextTime).toLocaleString('en-GB', { timeZone:'UTC' }) + ' UTC' : 'unavailable';
    status.textContent = dailyBonusStatus(data || {}, snapshot, next);
    if(data?.pendingSettlementSources?.length){
      status.textContent+=` ${data.pendingSettlementSources.length} source(s) await finalized settlement and are not eligible yet.`;
    }
    if (!snapshot) return;
    const payments = dailyBonusPayments(snapshot);
    const intro = document.createElement('p');
    intro.textContent = `${bonusSnapshotLabel(snapshot.day)} · ${sol(snapshot.allocatedLamports)} allocated · ${sol(snapshot.retainedLamports)} retained for unfilled ranks. Allocation is not a payment.`;
    results.append(intro);
    const eligibility=document.createElement('p');eligibility.className='field-help';
    eligibility.textContent=snapshot.eligibilityBasis==='settlement-time-v1'
      ?'Fee eligibility uses finalized settlement time. Later settlements enter their applicable later window.'
      :'Historical snapshot: fee eligibility uses its original collection-time rules.';
    if(snapshot.reconciliation?.kind==='append-only-frozen-rankings-v1')eligibility.textContent+=' Audited added funding uses the original frozen ranks and scores; previous payments are preserved.';
    results.append(eligibility);
    const paidNote = document.createElement('p'); paidNote.className = 'field-help';
    paidNote.textContent = 'Finalized received totals combine all bonus categories for this wallet and snapshot window. Repeated wallets show the same total; allocations are shown per ranking group. Five-minute test windows are marked QA. Global payment history includes these receipts after independent chain verification.';
    results.append(paidNote);
    for (const [key, label] of Object.entries(GROUPS)) {
      const group = document.createElement('section'), heading = document.createElement('h3'); heading.textContent = label; group.append(heading);
      const table = document.createElement('table'); table.innerHTML = '<thead><tr><th>Rank · % of category</th><th>Wallet</th><th>Verified SOL basis</th><th>Recorded allocation</th><th>Wallet received · all groups</th></tr></thead>';
      const body = document.createElement('tbody');
      for (const winner of snapshot.rankings[key] || []) {
        const row = document.createElement('tr');
        for (const text of [`#${winner.rank} · ${winner.percentOfCategory}%`, short(winner.wallet), sol(winner.scoreLamports), sol(winner.bonusLamports), !payments.has(winner.wallet) ? 'No finalized receipt' : payments.get(winner.wallet).receivedLamports == null ? 'Received amount unavailable' : sol(payments.get(winner.wallet).receivedLamports)]) {
          const cell = document.createElement('td'); cell.textContent = text; row.append(cell);
        }
        row.children[1].title = winner.wallet; body.append(row);
      }
      if (!body.children.length) { const row = document.createElement('tr'), cell = document.createElement('td'); cell.colSpan = 5; cell.textContent = 'No eligible wallet in this snapshot.'; row.append(cell); body.append(row); }
      table.append(body); const wrap = document.createElement('div'); wrap.className = 'daily-bonus-table'; wrap.append(table); group.append(wrap); results.append(group);
    }
    const proof = document.createElement('details'), title = document.createElement('summary'); title.textContent = 'Snapshot and payment evidence'; proof.append(title);
    const hash = document.createElement('p'); hash.className = 'daily-bonus-hash'; hash.textContent = `Immutable snapshot: ${snapshot.hash}`; proof.append(hash);
    for (const source of snapshot.sources) {
      const item = document.createElement('p'); item.textContent = `${short(source.mint)} · ${source.status.replaceAll('-', ' ')}`; proof.append(item);
    }
    for (const [wallet, row] of payments) {
      for (const receipt of row.receipts) {
        const link = document.createElement('a');
        link.textContent = `${short(wallet)} · ${receipt.receivedLamports == null ? 'received amount unavailable' : `${sol(receipt.receivedLamports)} received`} · finalized ↗`;
        link.href = receipt.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; proof.append(link);
      }
    }
    results.append(proof);
  }
  async function refresh() {
    const request = ++serial;
    try {
      const response = await fetch('/api/daily-bonus', { signal:AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error('Daily snapshot data is unavailable.');
      const nextData = await response.json();
      if (request !== serial) return;
      if (nextData.cluster !== 'devnet' || !Array.isArray(nextData.snapshots)) throw new Error('Unexpected snapshot network or schema.');
      data = nextData;
      const previous = select.value; select.replaceChildren();
      for (const row of data.snapshots || []) { const option = document.createElement('option'); option.value = row.day; option.textContent = bonusSnapshotLabel(row.day); option.title = row.day; select.append(option); }
      if ([...select.options].some(option => option.value === previous)) select.value = previous;
      root.querySelector('[data-bonus-day-label]').hidden = !select.options.length;
      render();
    } catch {
      if (request !== serial) return;
      data = null; select.replaceChildren(); root.querySelector('[data-bonus-day-label]').hidden = true; status.textContent = 'Daily snapshot data is unavailable. No reward or payment is confirmed here.'; results.replaceChildren();
    }
  }
  select.addEventListener('change', render);
  root.querySelector('button').addEventListener('click', () => { void refresh(); });
  void refresh();
  const refreshActive = () => { if (!document.hidden && globalThis.location?.hash === '#capital-flow') void refresh(); };
  globalThis.addEventListener('hashchange', refreshActive);
  document.addEventListener('visibilitychange', refreshActive);
  const timer = setInterval(refreshActive, 60_000);
  return () => {
    ++serial; clearInterval(timer);
    globalThis.removeEventListener('hashchange', refreshActive);
    document.removeEventListener('visibilitychange', refreshActive);
  };
}
