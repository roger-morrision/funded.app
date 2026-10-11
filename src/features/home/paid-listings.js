const base58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

export function verifiedPaidListings(records, cluster = 'devnet') {
  if (!Array.isArray(records)) return [];
  const seen = new Set();
  return records.filter(record => {
    const mint = String(record?.mint || '');
    const signature = String(record?.signature || '');
    if (record?.onchainVerified !== true || record.status !== 'listed' || record.cluster !== cluster
      || mint.length < 32 || mint.length > 44 || !base58.test(mint)
      || signature.length < 64 || signature.length > 88 || !base58.test(signature)
      || !String(record.name || '').trim() || !String(record.symbol || '').trim()
      || !Number.isFinite(Date.parse(record.listedAt)) || seen.has(mint)) return false;
    seen.add(mint);
    return true;
  }).sort((a, b) => Date.parse(b.listedAt) - Date.parse(a.listedAt));
}
