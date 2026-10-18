const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const positive = value => /^[1-9]\d*$/.test(String(value || '')) ? BigInt(value) : null;

// One payment can cover awards from several ranking groups. Count its proof once.
export function dailyBonusPayments(snapshot) {
  const wallets = new Map(), seen = new Map();
  for (const source of Array.isArray(snapshot?.sources) ? snapshot.sources : []) {
    for (const [wallet, payment] of Object.entries(source.payments || {})) {
      if (!ADDRESS.test(wallet) || payment?.finalized !== true || payment.balanceDeltaVerified !== true) continue;
      const account = ADDRESS.test(payment.payment || '') ? payment.payment : null;
      const signature = SIGNATURE.test(payment.signature || '') ? payment.signature : null;
      const amount = positive(payment.amount);
      if ((!account && !signature) || amount == null) continue;
      const received = positive(payment.amountReceived);
      const net = received != null && received <= amount ? received : null;
      const keys = [account && `account:${account}:${wallet}`, signature && `tx:${signature}:${wallet}`].filter(Boolean);
      const row = wallets.get(wallet) || { receivedLamports:0n, receipts:[] };
      const matches = [...new Set(keys.map(key => seen.get(key)).filter(Boolean))];
      const record = matches[0] || { identity:`${amount}:${net}`, keys:new Set(),
        receipt:{ receivedLamports:net, signature, paymentAccount:account,
          paidAt:payment.paidAt || null, day:source.snapshotDay || null } };
      if (!matches.length) row.receipts.push(record.receipt);
      // A later proof may connect two previously separate recovered records.
      // Remap every alias and remove the duplicate before calculating totals.
      for (const match of matches.slice(1)) {
        if (match.identity !== record.identity || match.receipt.receivedLamports == null)
          record.receipt.receivedLamports = null;
        for (const key of match.keys) record.keys.add(key);
        record.receipt.signature ||= match.receipt.signature;
        record.receipt.paymentAccount ||= match.receipt.paymentAccount;
        record.receipt.paidAt ||= match.receipt.paidAt;
        record.receipt.day ||= match.receipt.day;
        row.receipts = row.receipts.filter(receipt => receipt !== match.receipt);
      }
      if (record.identity !== `${amount}:${net}`) record.receipt.receivedLamports = null;
      record.receipt.signature ||= signature;
      record.receipt.paymentAccount ||= account;
      record.receipt.paidAt ||= payment.paidAt || null;
      record.receipt.day ||= source.snapshotDay || null;
      const proof = record.receipt;
      proof.href = `https://explorer.solana.com/${proof.signature ? 'tx' : 'address'}/${proof.signature || proof.paymentAccount}?cluster=devnet`;
      for (const key of keys) record.keys.add(key);
      for (const key of record.keys) seen.set(key, record);
      wallets.set(wallet, row);
    }
  }
  for (const row of wallets.values()) row.receivedLamports = row.receipts.reduce((total, receipt) =>
    total == null || receipt.receivedLamports == null ? null : total + receipt.receivedLamports, 0n);
  return wallets;
}

export function dailyBonusStatus(data, snapshot, next) {
  const indexing = data.indexing?.[0];
  if (snapshot?.status === 'reconciliation-required') {
    const started = snapshot.sources?.some(source => ['prepared','distributing','paid'].includes(source.status));
    return `Snapshot ${snapshot.day} requires reconciliation. Further payouts are blocked. ${snapshot.reason || 'Recorded evidence changed.'}${started ? ' Existing payment records are preserved. This day needs operator review; replacing a started payout is unavailable.' : ' An administrator must review the updated evidence.'}`;
  }
  if (data.worker?.status === 'blocked' || data.worker?.status === 'unavailable')
    return `Snapshot worker unavailable: ${data.worker.reason || 'Verification is unavailable.'}`;
  if (data.snapshotEnabled === false) return 'Daily snapshots and SOL bonus execution are not activated.';
  if (indexing) return `Processing ${indexing.day} UTC: ${indexing.reason || 'Verifying finalized history.'} Completed snapshots remain below.`;
  if (data.worker?.status === 'degraded') return 'Some daily bonus days need attention. Recorded snapshots and finalized receipts remain below.';
  const state = !snapshot ? 'No completed snapshot yet.' : snapshot.status === 'snapshotted'
    ? 'Verified snapshot below.' : 'Recorded snapshot below; verification status unavailable.';
  return `${state} Next cutoff: ${next}. ${data.payoutEnabled ? 'Payments require verified funding and finalized receipts.' : 'SOL payout execution is not activated.'}`;
}
