// One definition of "platform trading volume" for Overview and Analytics:
// the sum of each verified launch's 24h SOL volume. Before this, Overview
// showed sampled all-time volume and a 24h window in the same tile (whichever
// renderer ran last), while Analytics showed this 24h sum.
export function platformVolume24h(records) {
  const rows = Array.isArray(records) ? records : [];
  const known = rows.filter(item => item?.volume24hSol != null && Number.isFinite(Number(item.volume24hSol)) && Number(item.volume24hSol) >= 0);
  const volumeSol = known.reduce((sum, item) => sum + Number(item.volume24hSol), 0);
  const partial = known.length < rows.length || rows.some(item => item?.volumeCoverage === 'partial');
  return { volumeSol, partial, available: known.length > 0, scanned: known.length, total: rows.length };
}
