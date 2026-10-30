export async function refreshFinancialHealth({api,document=globalThis.document}) {
  const root=document.querySelector('#financial-health');if(!root)return;
  try{
    const health=await api('/api/admin/financial-health');
    const fresh=Number.isFinite(Date.parse(health.checkedAt))&&Date.now()-Date.parse(health.checkedAt)<180000;
    root.replaceChildren();
    const summary=document.createElement('p');
    summary.textContent=`${fresh?'Recorded flow monitor':'Monitor is stale'} · ${health.counts?.flows||0} flows · ${health.counts?.alerts||0} alerts · checked ${health.checkedAt}`;
    root.append(summary);
    for(const alert of health.alerts||[]){
      const line=document.createElement('p');line.textContent=`${alert.code} · ${alert.mint||''} · ${alert.source||alert.scheduleId||''}`;root.append(line);
    }
    const note=document.createElement('p');note.textContent='Recorded ledger checks. Every payout and burn still requires finalized on-chain proof.';root.append(note);
  }catch{root.textContent='Financial monitoring is unavailable. Refresh after the worker reports.';}
}
