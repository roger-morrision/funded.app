import { downloadReceiptPage, formatReceiptSol } from './receipt-export.js';
import { apiRequest } from './client.js';

export function mountReceiptHistory(container, id, cluster, isCurrent = () => true) {
  container.innerHTML = '<h2>Payment history</h2><p>Browse payments matched to finalized collection and entitlement records. Each page shows recorded payments, not lifetime earnings.</p><p data-history-status role="status" aria-live="polite">Load your recorded payments when you are ready.</p><div class="creator-receipts" data-history-rows></div><div class="support-actions receipt-history-actions"><button type="button" data-history-next>Load payment history</button><button type="button" data-history-retry hidden>Retry this page</button><button type="button" data-history-reset hidden>First page</button><button type="button" data-history-export disabled>Download page as CSV</button></div><p class="receipt-history-coverage">CSV downloads include this page only, with exact SOL amounts, network and transaction references.</p>';
  const next = container.querySelector('[data-history-next]'), retry = container.querySelector('[data-history-retry]'), reset = container.querySelector('[data-history-reset]');
  const status = container.querySelector('[data-history-status]'), rows = container.querySelector('[data-history-rows]');
  const exportButton = container.querySelector('[data-history-export]');
  let exportRows = [];
  let cursor = '', pageNumber = 0, lastCursor = '', lastPage = 1, busy = false;
  exportButton.onclick = () => {
    if (!isCurrent() || busy || !exportRows.length) return;
    try {
      downloadReceiptPage(exportRows, cluster, pageNumber);
      status.textContent = `CSV download started for page ${pageNumber}: ${exportRows.length} verified payments.`;
    } catch { status.textContent = 'The download could not start. Try Download page as CSV again.'; }
  };
  async function load(after, number) {
    if (busy || !isCurrent()) return;
    busy = true; next.disabled = retry.disabled = reset.disabled = true; exportButton.disabled = true;
    rows.setAttribute('aria-busy', 'true');
    status.textContent = `Checking payment records for page ${number}…`;
    try {
      const response = await apiRequest(`/api/creators/${encodeURIComponent(id)}/receipts${after ? `?after=${encodeURIComponent(after)}` : ''}`, { signal: AbortSignal.timeout(25000) });
      if (!isCurrent() || !container.isConnected) return;
      if (!response.available || response.data?.cluster !== cluster || response.data?.commitment !== 'finalized' || !Array.isArray(response.data.receipts)) throw new Error('Receipt history is unavailable.');
      const data = response.data;
      rows.replaceChildren(); exportRows = []; const seen = new Set();
      for (const receipt of data.receipts) {
        if (!receipt || !Number.isSafeInteger(receipt.slot) || receipt.slot < 1 || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(receipt.signature) || seen.has(receipt.signature) || !/^\d+$/.test(receipt.amountLamports)) continue;
        seen.add(receipt.signature); exportRows.push(receipt);
        const article = document.createElement('article'); article.className = 'creator-card receipt-history-card';
        const amount = document.createElement('strong'); amount.textContent = `${formatReceiptSol(receipt.amountLamports)} SOL`;
        const link = document.createElement('a'); link.textContent = 'View payment transaction ↗'; link.target = '_blank'; link.rel = 'noopener noreferrer';
        link.href = `https://explorer.solana.com/tx/${receipt.signature}?cluster=${encodeURIComponent(cluster)}`;
        const detail = document.createElement('small'); const paidAt = new Date(receipt.paidAt);
        detail.textContent = `${cluster === 'devnet' ? 'Devnet' : 'Mainnet'} · Finalized${Number.isNaN(paidAt.getTime()) ? '' : ` · ${paidAt.toLocaleString()}`}`;
        const slot = document.createElement('small'); slot.textContent = `Slot ${receipt.slot.toLocaleString()}`;
        article.append(amount, detail, slot, link); rows.append(article);
      }
      lastCursor = after; lastPage = number; pageNumber = number; cursor = typeof data.nextCursor === 'string' ? data.nextCursor : '';
      const incomplete = !['onchain-indexed', 'no-records'].includes(data.status);
      const checkedCount = Number.isSafeInteger(data.checkedPayouts) && data.checkedPayouts >= 0 ? `${data.checkedPayouts} checked records` : 'the available records';
      if (!exportRows.length) {
        const empty = document.createElement('p'); empty.className = 'receipt-history-empty';
        empty.textContent = incomplete ? 'No verified payments are available on this page yet. Retry to check missing evidence.' : 'No recorded payments on this page. Return to Rewards to check pending amounts.';
        rows.append(empty);
      }
      status.textContent = `Page ${number}: ${exportRows.length} verified payments from ${checkedCount}. ${incomplete ? 'Some records could not be verified. Retry this page to check again.' : cursor ? 'More payments are available on the next page.' : 'You have reached the end of the recorded history.'}`;
      next.hidden = !cursor; next.textContent = 'Next page'; retry.hidden = !incomplete; reset.hidden = number === 1;
    } catch {
      if (!isCurrent() || !container.isConnected) return;
      status.textContent = `Payment history is unavailable. Check your connection and retry.${pageNumber ? ` Page ${pageNumber} remains displayed.` : ''}`;
      lastCursor = after; lastPage = number; retry.hidden = false; next.hidden = true;
      // Keep the last verified page and its matching CSV available during an outage.
    } finally {
      busy = false; rows.setAttribute('aria-busy', 'false');
      next.disabled = retry.disabled = reset.disabled = false;
      exportButton.disabled = !isCurrent() || !exportRows.length;
    }
  }
  next.onclick = () => load(cursor, pageNumber + 1);
  retry.onclick = () => load(lastCursor, lastPage);
  reset.onclick = () => load('', 1);
}
