import { el, panel, link, button, signature, address, array, utc, reportContextLink } from './view-utils.js';
import { solText } from './financial-model.js';
import { APP_NET } from '../shared/app-network.js';
export function receiptUrl(sig, mint, wallet) {
  if (!signature(sig)) return '';
  const params = new URLSearchParams({receipt:sig});
  if (address(mint)) params.set('mint',mint); if (address(wallet)) params.set('wallet',wallet);
  return `/?${params}#payments/activity`;
}
export function initializeReceiptInspector(app) {
  const dialog = el('dialog',null,'info-dialog financial-receipt-dialog'); dialog.id = 'receipt-inspector';
  dialog.setAttribute('aria-label','Verified event receipt');
  const close = button('Close receipt',()=>dialog.close()), body = el('div'); dialog.append(close,body); document.body.append(dialog);
  let serial = 0, current = '';
  async function inspect() {
    const url = new URL(location.href), sig = url.searchParams.get('receipt');
    if (!signature(sig) || current === url.href) return;
    current = url.href; const id = ++serial; body.replaceChildren(el('h2','Checking exact receipt'),el('p','Checking the transaction against recorded evidence.'));
    if (!dialog.open) dialog.showModal();
    const params = new URLSearchParams(); for (const key of ['mint','wallet']) if (address(url.searchParams.get(key))) params.set(key,url.searchParams.get(key));
    let response; try {response = await app.apiRequest(`/api/financial/receipts/${sig}${params.size ? '?' + params : ''}`,{signal:AbortSignal.timeout(20000)});} catch {response=null;}
    if (id !== serial || !dialog.open) return;
    const data = response?.available && response.data?.signature === sig && response.data.cluster === APP_NET
      && ['recorded-finalized-v3','finalized-rpc-trade'].includes(response.data.evidence) ? response.data : null;
    body.replaceChildren(el('h2',data ? 'Verified event receipt' : 'Receipt verification unavailable'));
    body.append(el('p',`${import.meta.env?.VITE_SOLANA_CLUSTER === 'mainnet-beta' ? 'Solana' : 'Solana Devnet'} · ${sig}`),link('Inspect transaction ↗',`https://explorer.solana.com/tx/${sig}${import.meta.env?.VITE_SOLANA_CLUSTER==='mainnet-beta'?'':'?cluster=devnet'}`,true));
    const report=reportContextLink('Report an issue with this receipt');report.addEventListener('click',()=>dialog.close());body.append(report);
    if (!data) {body.append(el('p','The current API could not provide matching evidence. This is not proof of failure; retain this signature before retrying.'));return;}
    body.append(el('p',data.currentRpcRecheck ? 'Finalized trade and balance changes checked on RPC.' : 'Recorded finalized evidence; current RPC recheck is not included.'));
    const buy=url.searchParams.get('buyReceipt');if(signature(buy))body.append(link('Inspect the separate buy receipt',receiptUrl(buy,url.searchParams.get('mint'),url.searchParams.get('wallet'))),el('p','The buy and sell receipts are separate checks. This view does not recompute the shared closed-position result.'));
    for (const event of array(data.events)) {
      const row = panel('',event.label || event.kind,`${event.mint} · ${utc(event.at)}`);
      row.removeAttribute('id'); row.removeAttribute('aria-labelledby'); row.querySelector('h2').removeAttribute('id');
      row.append(el('strong',solText(event.amountLamports))); body.append(row);
    }
    for (const row of array(data.recipients)) body.append(el('p',`${row.kind} · ${solText(row.amountLamports)} to ${row.wallet} · Mint ${row.mint||'Unavailable'}`));
    for (const row of array(data.burns)) body.append(el('p',`Supply burn: ${row.burnedBaseUnits ?? 'Unavailable'} $RICH base units · spent ${solText(row.spentLamports)} · vault ${row.vault || 'unavailable'} · recorded network cost ${solText(row.networkFeeLamports)}`));
    if (data.trade) body.append(el('p',`${data.trade.side} · ${data.trade.tokenAmountRaw} token base units · ${solText(data.trade.solLamports)}. No profit claim.`),el('p',`Network cost: ${solText(data.trade.networkFeeLamports)} · Fee payer: ${data.trade.feePayer||'Unavailable'}. Account rent and other SOL movements require the full transaction.`));
    else body.append(el('p','Fee payer and recipient net after network costs: unavailable in this recorded projection. Recorded payment amounts are gross; inspect the full transaction for all balance movements.'));
    for (const source of array(data.sourceSignatures)) if (signature(source)) body.append(link(`Source collection ${source.slice(0,10)}… ↗`,`https://explorer.solana.com/tx/${source}${import.meta.env?.VITE_SOLANA_CLUSTER==='mainnet-beta'?'':'?cluster=devnet'}`,true));
    body.append(el('p',data.coverage),button('Copy exact receipt link',async()=>{
      try {await navigator.clipboard.writeText(location.href);app.showToast('Exact receipt link copied.');}
      catch {body.append(el('p',location.href));}
    }));
  }
  dialog.addEventListener('close',()=>{++serial;current='';const url=new URL(location.href);for(const key of ['receipt','wallet','mint','buyReceipt'])url.searchParams.delete(key);history.replaceState({},'',url);});
  for (const name of ['hashchange','popstate','funded:route-change']) window.addEventListener(name,()=>void inspect());
  void inspect();
}
