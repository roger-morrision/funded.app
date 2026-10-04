import { exactLamports } from './exact-lamports.js';
import { receiptPaidAtDate } from './receipt-timestamp.js';

export function formatReceiptSol(amountLamports) {
  const units = exactLamports(amountLamports);
  const fraction = String(units % 1_000_000_000n).padStart(9, '0').replace(/0+$/, '');
  return `${units / 1_000_000_000n}${fraction ? `.${fraction}` : ''}`;
}

const csvCell = value => {
  let text = String(value ?? '');
  // Spreadsheet applications may interpret even quoted cells as formulas.
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};

// The history view and its CSV must include exactly the same accepted amounts.
export function selectExactReceiptRows(input) {
  if (!Array.isArray(input)) throw new Error('Invalid receipt page.');
  const receipts = [], seen = new Set();
  let omittedCount = 0;
  for (const row of input) {
    try {
      if (!row || typeof row.signature !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(row.signature)
        || seen.has(row.signature) || !Number.isSafeInteger(row.slot) || row.slot < 1) throw new Error('Invalid receipt.');
      const units = exactLamports(row.amountLamports);
      if (units === 0n) throw new Error('A paid receipt must have a positive amount.');
      const amountLamports = units.toString();
      seen.add(row.signature);
      receipts.push({ ...row, amountLamports });
    } catch { omittedCount++; }
  }
  return { receipts, omittedCount };
}

export function receiptPageCsv(receipts, cluster, page) {
  if (!['devnet', 'mainnet-beta'].includes(cluster)) throw new Error('Unsupported receipt network.');
  const rows = [['network', 'coverage', 'page', 'asset', 'amount_base_units', 'amount_sol', 'mint', 'payout_signature', 'finalized_slot', 'paid_at', 'recipient', 'source_collection_signature', 'obligation_id']];
  if (!Array.isArray(receipts) || !Number.isSafeInteger(page) || page < 1) throw new Error('Invalid receipt page.');
  for (const receipt of selectExactReceiptRows(receipts).receipts) {
    // Keep the existing paid_at column: this is ledger-recorded time, not
    // verified block time. Unknown metadata stays blank without losing proof.
    const paidAt = receiptPaidAtDate(receipt.paidAt) ? receipt.paidAt : '';
    rows.push([cluster, 'current verified page only (verified subset)', page, 'SOL', receipt.amountLamports, formatReceiptSol(receipt.amountLamports), receipt.mint, receipt.signature, receipt.slot, paidAt, receipt.recipient, receipt.sourceCollectionSignature, receipt.obligationId]);
  }
  return rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function downloadReceiptPage(receipts, cluster, page) {
  const blob = new Blob([receiptPageCsv(receipts, cluster, page)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = `funded-${cluster}-receipts-page-${page}.csv`;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
