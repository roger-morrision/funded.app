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
  root.innerHTML = `<div class="panel-heading"><div><p class="eyebrow">Daily bonus · SOL</p><h2 id="daily-bonus-title">Top 3. Every 24 hours.</h2></div><button type="button" data-bonus-refresh>Refresh</button></div><p>The Daily bonus fee allocation for new launches is split equally across creators, referrers, and traders. Each group awards 50% to 1st, 30% to 2nd, and 20% to 3rd.</p><p class="field-help">Creators rank by collected fees; referrers by their direct referred creators' collected fees; traders by verified buy and sell volume. Each UTC day closes at 00:00 UTC. Ties use wallet address order. Unfilled ranks retain their share in the reserve.</p><p data-bonus-status role="status">Checking daily snapshots…</p><label data-bonus-day-label hidden>Snapshot day (UTC)<select data-bonus-day aria-label="Daily bonus snapshot day"></select></label><div data-bonus-results></div>`;
  parent.append(root);
  const results = root.querySelector('[data-bonus-results]'), status = root.querySelector('[data-bonus-status]');
  const select = root.querySelector('select');
  let data;
  function render() {
    results.replaceChildren();
    const snapshot = data?.snapshots?.find(row => row.day === select.value);
    if (!snapshot) return;
    const intro = document.createElement('p');
    intro.textContent = `${snapshot.day} UTC · ${sol(snapshot.allocatedLamports)} allocated · ${sol(snapshot.retainedLamports)} retained for unfilled ranks. Allocation is not a payment.`;
    results.append(intro);
    for (const [key, label] of Object.entries(GROUPS)) {
      const group = document.createElement('section'), heading = document.createElement('h3'); heading.textContent = label; group.append(heading);
      const table = document.createElement('table'); table.innerHTML = '<thead><tr><th>Rank</th><th>Wallet</th><th>Verified SOL basis</th><th>Allocated bonus</th></tr></thead>';
      const body = document.createElement('tbody');
      for (const winner of snapshot.rankings[key] || []) {
        const row = document.createElement('tr');
        for (const text of [`#${winner.rank} · ${winner.percentOfCategory}%`, short(winner.wallet), sol(winner.scoreLamports), sol(winner.bonusLamports)]) {
          const cell = document.createElement('td'); cell.textContent = text; row.append(cell);
        }
        row.children[1].title = winner.wallet; body.append(row);
      }
      if (!body.children.length) { const row = document.createElement('tr'), cell = document.createElement('td'); cell.colSpan = 4; cell.textContent = 'No eligible wallet in this snapshot.'; row.append(cell); body.append(row); }
      table.append(body); const wrap = document.createElement('div'); wrap.className = 'daily-bonus-table'; wrap.append(table); group.append(wrap); results.append(group);
    }
    const proof = document.createElement('details'), title = document.createElement('summary'); title.textContent = 'Snapshot and payment evidence'; proof.append(title);
    const hash = document.createElement('p'); hash.className = 'daily-bonus-hash'; hash.textContent = `Immutable snapshot: ${snapshot.hash}`; proof.append(hash);
    for (const source of snapshot.sources) {
      const item = document.createElement('p'); item.textContent = `${short(source.mint)} · ${source.status.replaceAll('-', ' ')}`; proof.append(item);
      for (const [wallet, payment] of Object.entries(source.payments || {})) {
        if (payment.finalized !== true || payment.balanceDeltaVerified !== true) continue;
        const signature = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(payment.signature || '') ? payment.signature : null;
        const account = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(payment.payment || '') ? payment.payment : null;
        const link = document.createElement('a'); link.textContent = `${short(wallet)} · ${sol(payment.amount)} · finalized ↗`;
        if (signature || account) link.href = `https://explorer.solana.com/${signature ? 'tx' : 'address'}/${signature || account}?cluster=devnet`;
        link.target = '_blank'; link.rel = 'noopener noreferrer'; proof.append(link);
      }
    }
    results.append(proof);
  }
  async function refresh() {
    try {
      const response = await fetch('/api/daily-bonus', { signal:AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error('Daily snapshot data is unavailable.');
      data = await response.json();
      const previous = select.value; select.replaceChildren();
      for (const row of data.snapshots || []) { const option = document.createElement('option'); option.value = row.day; option.textContent = row.day; select.append(option); }
      if ([...select.options].some(option => option.value === previous)) select.value = previous;
      root.querySelector('[data-bonus-day-label]').hidden = !select.options.length;
      const next = data.nextCutoffAt ? new Date(data.nextCutoffAt).toLocaleString('en-GB', { timeZone:'UTC' }) + ' UTC' : 'unavailable';
      status.textContent = data.snapshotEnabled === false ? 'Daily snapshots and SOL bonus execution are not activated.'
        : data.worker?.status === 'blocked' || data.worker?.status === 'unavailable'
        ? `Snapshot unavailable: ${data.worker.reason}`
        : `${data.snapshots.length ? 'Verified snapshots below.' : 'No completed snapshot yet.'} Next cutoff: ${next}. ${data.payoutEnabled ? 'Payments require verified funding and finalized receipts.' : 'SOL payout execution is not activated.'}`;
      render();
    } catch { status.textContent = 'Daily snapshot data is unavailable. No reward or payment is confirmed here.'; results.replaceChildren(); }
  }
  select.addEventListener('change', render);
  root.querySelector('button').addEventListener('click', () => { void refresh(); });
  void refresh();
  setInterval(() => { if (globalThis.location?.hash === '#capital-flow') void refresh(); }, 60_000);
}
