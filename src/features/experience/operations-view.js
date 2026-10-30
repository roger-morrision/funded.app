import { panel, el, link, button, array, utc } from './view-utils.js';
export function initializeOperationsView(app) {
  const parent = document.querySelector('#financial-center'); if (!parent) return;
  const details = el('details'); details.append(el('summary','Financial engine health & creator delivery'));
  const root = panel('financial-engine','Recorded engine health','Completed operations and retry attempts are different measures. Missing data remains unavailable.'); details.append(root); parent.append(details);
  root.removeAttribute('aria-labelledby');
  let busy = false;
  async function refresh() {
    if (busy || !details.open) return; busy = true; root.replaceChildren(el('h3','Checking financial engine records…'));
    try {
      const result = await app.apiRequest('/api/financial/operations',{signal:AbortSignal.timeout(18000)});
      const data = result.available && result.data?.cluster === 'devnet' && result.data.evidence === 'recorded-finalized-v3' ? result.data : null;
      if (!data) throw new Error();
      root.replaceChildren(el('h3','Recorded engine health'));
      const stats = [['Recorded completed buybacks',data.completedRecordedOperations],['Pending recorded buybacks',data.pendingBuybackOperations],['Failed recorded operations',data.failedRecordedOperations],
        ['Retry-attempt count',data.retryAttempts ?? 'Unavailable'],['Oldest pending operation',data.oldestPendingSeconds == null ? 'Unavailable' : `${data.oldestPendingSeconds}s`],['Last verified delivery',utc(data.lastVerifiedDeliveryAt)]];
      const list = el('dl'); for (const [label,value] of stats) list.append(el('dt',label),el('dd',String(value))); root.append(list);
      for (const [label,key] of [['Collection → settlement','collectionToSettlement'],['Funding → X payment','fundedToVerifiedXPayment'],['Funding → holder payment','fundedToVerifiedHolderPayment'],['Funding → ranked bonus payment','fundedToVerifiedBonusPayment']]) {
        const sample = data.timing?.[key]; root.append(el('p',`${label}: median ${sample?.medianSeconds == null ? 'unavailable' : sample.medianSeconds + 's'} · p95 ${sample?.p95Seconds == null ? 'unavailable' : sample.p95Seconds + 's'} · ${sample?.samples ?? 0} recorded samples`));
      }
      root.append(el('p',data.coverage),el('p',data.timing?.coverage),el('h3','Creator delivery badges'),el('p',data.retentionCoverage));
      root.append(el('p',`Vault reconciliation: ${data.reconciliation?.status||'unavailable'}. ${data.reconciliation?.reason||'Complete opening, inflow, outflow and closing evidence is unavailable.'}`));
      for (const creator of array(data.creators).slice(0,10)) {
        const row = el('p'); row.append(link(creator.wallet,`/wallet/${creator.wallet}`),el('span',` · ${creator.verifiedPaymentReceipts} recorded payment receipts · ${creator.returningRecipients} returning paid wallets · ${array(creator.badges).join(' · ')}`)); root.append(row);
      }
      root.append(el('p',`Recorded data generated ${utc(data.generatedAt)}. Current vault balances are checked on Buybacks.`),button('Refresh engine health',()=>void refresh()));
    } catch {root.replaceChildren(el('h3','Financial engine health unavailable'),el('p','The current API could not provide these records. Existing receipts and financial policies are unchanged.'),button('Retry health check',()=>void refresh()));}
    finally {busy=false;}
  }
  details.addEventListener('toggle',()=>void refresh());
}
