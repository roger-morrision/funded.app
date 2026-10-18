export function initAdminDailyBonus({ document, api, post, show, refreshAudit }) {
  const $ = selector => document.querySelector(selector);
  const form = $('#daily-bonus-recovery'), day = $('#bonus-recovery-day'), hash = $('#bonus-recovery-hash');
  const reviewButton = $('#bonus-recovery-review'), applyButton = $('#bonus-recovery-apply');
  const preview = $('#bonus-recovery-preview'), status = $('#bonus-recovery-status');
  let snapshots = [], reviewed = null, busy = false, generation = 0;
  const started = row => row?.sources?.some(source => ['prepared','distributing','paid'].includes(source.status));
  const clear = () => { generation++; reviewed = null; applyButton.disabled = true; };
  function render() {
    const row = snapshots.find(row => row.day === day.value);
    const blocked = started(row);
    reviewButton.disabled = busy || blocked || !/^[a-f0-9]{64}$/.test(hash.value.trim());
    applyButton.disabled = busy || blocked || !reviewed;
    $('#bonus-recovery-index').disabled = busy;
    status.textContent = blocked
      ? 'Payments have started for this day. Replacement is unavailable; existing receipts must be preserved. Operator review is required for remaining awards.'
      : row ? 'No prepared or paid records are listed. Review the replacement before applying it; the server also checks on-chain reservations.'
        : 'Choose a completed UTC day to index it. For older snapshots, enter its current hash to request a review.';
  }
  function selectDay() {
    clear(); const row = snapshots.find(row => row.day === day.value);
    hash.value = row?.hash || ''; preview.textContent = ''; render();
  }
  async function refresh() {
    try {
      const data = await api('/api/daily-bonus');
      if (data.cluster !== 'devnet' || !Array.isArray(data.snapshots)) throw new Error();
      const qa = data.schedule?.mode === 'devnet-qa-5m' && data.schedule.periodSeconds === 300;
      const cutoff = Date.parse(data.nextCutoffAt || '');
      const latest = qa && Number.isFinite(cutoff) ? `qa5m:${new Date(cutoff - 600000).toISOString().replace('.000Z','Z')}${data.schedule.cohort ? '@'+data.schedule.cohort : ''}`
        : new Date(Date.now() - 86400000).toISOString().slice(0,10);
      if (!day.value) day.value = latest;
      const choices = $('#bonus-recovery-windows'); choices?.replaceChildren();
      for (const row of data.snapshots) {
        const option = document.createElement('option'); option.value = row.day; choices?.append(option);
      }
      snapshots = data.snapshots; selectDay();
    } catch { status.textContent = 'Snapshot status is unavailable. Index a completed day or enter a current snapshot hash for server verification.'; }
  }
  const run = action => { if (busy) return; busy = true; render();
    action().catch(error => show(error.message,true)).finally(() => { busy = false; render(); });
  };
  day.addEventListener('input',selectDay);
  hash.addEventListener('input',() => { clear(); render(); });
  $('#bonus-recovery-index').addEventListener('click',() => {
    if (!day.reportValidity()) return;
    clear(); const current = generation, selectedDay = day.value;
    run(async() => {
      const result = await post('/api/admin/daily-bonus/snapshot',{day:selectedDay});
      if (current !== generation) return;
      preview.textContent = JSON.stringify(result,null,2);
      if (result.snapshot?.hash) {
        hash.value = result.snapshot.hash;
        snapshots = snapshots.filter(row => row.day !== result.snapshot.day);
        snapshots.push({day:result.snapshot.day,hash:result.snapshot.hash,
          sources:Object.values(result.payouts || {}).map(row => ({status:row.status}))});
      }
    });
  });
  reviewButton.addEventListener('click',() => {
    if (reviewButton.disabled || !day.reportValidity()) return;
    clear(); const current = generation, input = {day:day.value,expectedHash:hash.value.trim()};
    run(async() => {
      const result = await post('/api/admin/daily-bonus/review',input);
      if (current !== generation) return;
      reviewed = result; preview.textContent = JSON.stringify(result,null,2);
    });
  });
  form.addEventListener('submit',event => {
    event.preventDefault(); if (applyButton.disabled || !reviewed) return;
    const reason = $('#bonus-recovery-reason').value.trim();
    if (reason.length < 10) { show('Enter an audit reason of at least 10 characters.',true); return; }
    const input = {...reviewed,reason};
    run(async() => {
      const result = await post('/api/admin/daily-bonus/reconcile',input);
      clear(); preview.textContent = JSON.stringify(result,null,2);
      show('Unpaid daily bonus snapshot reconciled. The original revision remains in the audit history.');
      await refreshAudit();
    });
  });
  render(); return {refresh};
}
