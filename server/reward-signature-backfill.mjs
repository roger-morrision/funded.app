// Paid reward leaves recorded through the "already paid on-chain" recovery path
// may lack their payout signature, which hides them from receipts and payout
// totals. Fill those from the payment account's finalized history.
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

export async function backfillPaymentSignatures({ store, chain, limit = 10 }) {
  if (typeof chain?.paymentSignature !== 'function') return 0;
  const missing = await store.transaction(state => Object.values(state.schedules || {}).flatMap(row =>
    Object.entries(row.payments || {}).filter(([, p]) => p?.status === 'paid' && p.bitmap !== true && p.finalized === true && !p.signature && p.payment)
      .map(([recipient, p]) => ({ id: row.id, recipient, payment: p.payment }))).slice(0, limit));
  let filled = 0;
  for (const item of missing) {
    const signature = await chain.paymentSignature(item.payment);
    if (!SIGNATURE.test(String(signature || ''))) continue;
    await store.transaction(state => {
      const payment = state.schedules?.[item.id]?.payments?.[item.recipient];
      if (payment && !payment.signature && payment.payment === item.payment) { payment.signature = signature; payment.signatureRecovered = true; filled += 1; }
    });
  }
  return filled;
}
