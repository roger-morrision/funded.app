export function payoutCoverageLabel(summary, cluster, now = Date.now()) {
  const at = Date.parse(summary?.payoutEvidenceAt || '');
  const suffix = Number.isFinite(at) ? ` · checked ${new Date(at).toISOString().slice(11,16)} UTC` : '';
  const coverage = summary?.payoutCoverage, recorded = summary?.recordedPayouts, verified = summary?.verifiedPayoutCount;
  const valid = summary?.feePayoutStats?.cluster === cluster
    && summary.feePayoutStats.commitment === 'finalized'
    && coverage?.scope === 'v3-sol-recipient-receipts' && ['verified','partial'].includes(coverage.status)
    && Number.isSafeInteger(recorded) && Number.isSafeInteger(verified) && verified >= 0 && recorded >= verified;
  const fresh = Number.isFinite(at) && now >= at && now-at <= 300_000;
  return valid && fresh ? {text:`${verified} of ${recorded} payouts verified${suffix}`,reason:null}
    : {text:`Receipt coverage unavailable${suffix}`,reason:!fresh
      ? !Number.isFinite(at) ? 'No receipt check time is available.'
        : now < at ? 'The receipt check is dated in the future.' : 'The last receipt check is over five minutes old.'
      : coverage?.reason || 'Recorded and verified receipts could not be reconciled to the same scope.'};
}
