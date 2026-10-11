export function isOnCurveAirdrop(program, market) {
  return !program.claimPublished && market?.complete === false && market?.migrated !== true;
}

export function directoryPage(rows, query = '', page = 1, size = 10) {
  const needle = query.trim().toLowerCase();
  const filtered = rows.filter(row => !needle || `${row.name || ''} ${row.symbol || ''} ${row.mint || row.id || ''}`.toLowerCase().includes(needle));
  const pages = Math.max(1, Math.ceil(filtered.length / size));
  const current = Math.max(1, Math.min(page, pages));
  const start = (current - 1) * size;
  return { rows: filtered.slice(start, start + size), total: filtered.length, page: current, pages,
    range: filtered.length ? `${start + 1}–${Math.min(start + size, filtered.length)} of ${filtered.length}` : '0 results' };
}

export function holderRewardGroups(data) {
  const available = ['onchain-indexed', 'partial', 'no-records'].includes(data?.evidence?.status) && Array.isArray(data?.tokens);
  const rows = available ? data.tokens.filter(row => Number(row.holderSharePercent) > 0) : [];
  // A migrated coin or a fee allocation alone does not prove a payment.
  const paid = row => /^\d+$/.test(String(row.holderPaidLamports)) && BigInt(row.holderPaidLamports) > 0n && row.holderPaidWallets > 0;
  return { available, partial: data?.evidence?.status === 'partial',
    upcoming: rows.filter(row => !paid(row)), distributed: rows.filter(paid) };
}
