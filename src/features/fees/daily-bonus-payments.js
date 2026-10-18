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
      const matches = keys.map(key => seen.get(key)).filter(Boolean);
      const prior = matches[0];
      if (prior) {
        if (prior.identity !== `${amount}:${net}` || matches.some(row => row !== prior)) {
          wallets.get(wallet).receivedLamports = null;
          for (const match of matches) match.receipt.receivedLamports = null;
        }
        for (const key of keys) seen.set(key, prior);
        continue;
      }
      const row = wallets.get(wallet) || { receivedLamports:0n, receipts:[] };
      row.receivedLamports = row.receivedLamports == null || net == null ? null : row.receivedLamports + net;
      const receipt = { receivedLamports:net,
        href:`https://explorer.solana.com/${signature ? 'tx' : 'address'}/${signature || account}?cluster=devnet` };
      const record = { identity:`${amount}:${net}`, receipt };
      for (const key of keys) seen.set(key, record);
      row.receipts.push(receipt);
      wallets.set(wallet, row);
    }
  }
  return wallets;
}

export function dailyBonusStatus(data, snapshot, next) {
  if (snapshot?.status === 'reconciliation-required')
    return `Snapshot ${snapshot.day} requires reconciliation. Further payouts are blocked. ${snapshot.reason || 'Recorded evidence changed.'}`;
  if (data.worker?.status === 'blocked' || data.worker?.status === 'unavailable')
    return `Snapshot worker unavailable: ${data.worker.reason || 'Verification is unavailable.'}`;
  if (data.snapshotEnabled === false) return 'Daily snapshots and SOL bonus execution are not activated.';
  const state = !snapshot ? 'No completed snapshot yet.' : snapshot.status === 'snapshotted'
    ? 'Verified snapshot below.' : 'Recorded snapshot below; verification status unavailable.';
  return `${state} Next cutoff: ${next}. ${data.payoutEnabled ? 'Payments require verified funding and finalized receipts.' : 'SOL payout execution is not activated.'}`;
}
