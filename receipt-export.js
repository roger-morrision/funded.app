const csvCell = value => {
  let text = String(value ?? '');
  // Spreadsheet applications may interpret even quoted cells as formulas.
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};

export function receiptPageCsv(receipts, cluster, page) {
  if (!['devnet', 'mainnet-beta'].includes(cluster)) throw new Error('Unsupported receipt network.');
  const rows = [['network', 'coverage', 'page', 'asset', 'amount_base_units', 'mint', 'payout_signature', 'finalized_slot', 'paid_at', 'recipient', 'source_collection_signature', 'obligation_id']];
  if (!Array.isArray(receipts) || !Number.isSafeInteger(page) || page < 1) throw new Error('Invalid receipt page.');
  const seen = new Set();
  for (const receipt of receipts) {
    if (!receipt || seen.has(receipt.signature) || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(receipt.signature) || !/^\d+$/.test(receipt.amountLamports) || !Number.isSafeInteger(receipt.slot) || receipt.slot < 1) continue;
    seen.add(receipt.signature);
    rows.push([cluster, 'current verified page only', page, 'SOL', receipt.amountLamports, receipt.mint, receipt.signature, receipt.slot, receipt.paidAt, receipt.recipient, receipt.sourceCollectionSignature, receipt.obligationId]);
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
