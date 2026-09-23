import { apiRequest } from './client.js';

export function mountReceiptHistory(container, id, cluster, isCurrent = () => true) {
  container.innerHTML = '<h2>Finalized receipt history</h2><p>Browse recorded payouts beyond the recent window. Only payouts with a matching finalized source collection and entitlement are shown. This is not a lifetime earnings total.</p><p data-history-status role="status">History loads only when requested.</p><div class="creator-receipts" data-history-rows></div><div class="support-actions"><button data-history-next>Load finalized history</button><button data-history-retry hidden>Retry this page</button><button data-history-reset hidden>Start over</button></div>';
  const next=container.querySelector('[data-history-next]'),retry=container.querySelector('[data-history-retry]'),reset=container.querySelector('[data-history-reset]');
  const status=container.querySelector('[data-history-status]'),rows=container.querySelector('[data-history-rows]');
  let cursor='',pageNumber=0,lastCursor='',lastPage=1,busy=false;
  async function load(after,number) {
    if(busy||!isCurrent())return;
    busy=true;next.disabled=retry.disabled=reset.disabled=true;
    status.textContent='Checking finalized payout and collection receipts…';
    try {
      const response=await apiRequest(`/api/creators/${id}/receipts${after?`?after=${encodeURIComponent(after)}`:''}`,{signal:AbortSignal.timeout(25000)});
      if(!isCurrent()||!container.isConnected)return;
      if(!response.available||response.data?.commitment!=='finalized'||!Array.isArray(response.data.receipts))throw new Error('Receipt history is unavailable. No new payment is implied.');
      const data=response.data;
      // Clear this page before displaying another; browsing long histories does not grow the DOM.
      rows.replaceChildren();const seen=new Set();
      for(const receipt of data.receipts) {
        if(!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(receipt.signature)||seen.has(receipt.signature)||!/^\d+$/.test(receipt.amountLamports))continue;
        seen.add(receipt.signature);
        const article=document.createElement('article');article.className='creator-card';
        const amount=document.createElement('strong');
        const lamports=BigInt(receipt.amountLamports),fraction=String(lamports%1000000000n).padStart(9,'0').replace(/0+$/,'');
        amount.textContent=`${lamports/1000000000n}${fraction?'.'+fraction:''} SOL`;
        const link=document.createElement('a');link.textContent='Verify finalized payout ↗';link.target='_blank';link.rel='noopener noreferrer';
        link.href=`https://explorer.solana.com/tx/${receipt.signature}?cluster=${encodeURIComponent(cluster)}`;
        article.append(amount,link);rows.append(article);
      }
      lastCursor=after;lastPage=number;pageNumber=number;cursor=data.nextCursor||'';
      const incomplete=!['onchain-indexed','no-records'].includes(data.status);
      status.textContent=`Page ${number}: ${rows.children.length} matched finalized payouts from ${data.checkedPayouts} checked records. ${incomplete?'Some evidence is unavailable or unmatched. Retry this page to check again.':cursor?'More recorded payouts are available.':'End of currently recorded payouts.'} No lifetime total is implied.`;
      next.hidden=!cursor;next.textContent='Next receipts';retry.hidden=!incomplete;reset.hidden=number===1;
    } catch(error) {
      if(!isCurrent()||!container.isConnected)return;
      status.textContent='Receipt history is unavailable. Check your connection and retry. This action does not submit a payout.';lastCursor=after;lastPage=number;retry.hidden=false;next.hidden=true;
      // A failed request never looks like an empty or paid result.
      rows.replaceChildren();
    } finally {busy=false;next.disabled=retry.disabled=reset.disabled=false;}
  }
  next.onclick=()=>load(cursor,pageNumber+1);
  retry.onclick=()=>load(lastCursor,lastPage);
  reset.onclick=()=>load('',1);
}
