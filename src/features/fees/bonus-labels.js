export function bonusSnapshotLabel(value) {
  const key = String(value || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    const date = new Date(`${key}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === key ? `${key} · UTC day` : 'Snapshot time unavailable';
  }
  const match = /^qa5m:(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z)(?:@[a-f0-9]{12})?$/.exec(key);
  if (!match) return 'Snapshot time unavailable';
  const start = new Date(match[1]);
  if (!Number.isFinite(start.getTime()) || start.toISOString().replace('.000Z','Z') !== match[1] || start.getUTCMinutes() % 5) return 'Snapshot time unavailable';
  const end = new Date(start.getTime() + 300_000).toISOString();
  const endLabel = end.slice(0,10) === match[1].slice(0,10) ? end.slice(11,16) : `${end.slice(0,10)} ${end.slice(11,16)}`;
  return `${match[1].slice(0,10)} · ${match[1].slice(11,16)}–${endLabel} UTC · QA`;
}

export function bonusVerificationLabel(data) {
  if (data.snapshotEnabled === false) return 'Bonus snapshots are not enabled.';
  if (data.payoutEnabled === false) return 'Automatic bonus payouts are not enabled.';
  if (['blocked','degraded','unavailable'].includes(data.worker?.status)) return 'Payout verification is delayed. Recorded payments remain available.';
  if (data.worker?.status === 'indexing') return 'Payout history is being checked. A cutoff does not guarantee immediate payment.';
  if (data.worker?.status === 'active' && data.snapshotEnabled === true && data.payoutEnabled === true) return 'Automatic payouts are enabled. Each payment still requires verified funding.';
  return 'Current payout readiness is unavailable. Recorded payments remain available.';
}
