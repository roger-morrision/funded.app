const LAMPORTS_PER_SOL = 1_000_000_000n;
const DESTINATIONS = [
  ['operations', 'operationsPercent', 'operationsLamports'],
  ['referrals', 'referralLevelPercents', 'referralLamports'],
  ['community', 'communityPercent', 'communityLamports'],
  ['buyback', 'buybackPercent', 'buybackLamports'],
];

function exactLamports(value) {
  return typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value) ? BigInt(value) : null;
}

function formatSol(amount) {
  if (amount == null) return '—';
  const fraction = String(amount % LAMPORTS_PER_SOL).padStart(9, '0').replace(/0+$/, '');
  return `${amount / LAMPORTS_PER_SOL}${fraction ? `.${fraction}` : ''} SOL allocated`;
}

function validPolicy(split) {
  const levels = split?.referralLevelPercents;
  const rates = [split?.operationsPercent, ...(Array.isArray(levels) ? levels : []),
    split?.communityPercent, split?.buybackPercent];
  return Array.isArray(levels) && levels.length === 3 && rates.length === 6
    && rates.every(rate => typeof rate === 'number' && Number.isFinite(rate) && rate >= 0)
    && Math.abs(rates.reduce((sum, rate) => sum + rate, 0) - 100) < 0.000001;
}

export function protocolFeeRouteModel(allocation) {
  const split = allocation?.currentPolicy?.split;
  const policyReady = validPolicy(split);
  const evidenceReady = ['verified', 'partial'].includes(allocation?.status)
    && Number.isSafeInteger(allocation?.settledCollections) && allocation.settledCollections >= 0;
  const amounts = DESTINATIONS.map(([, , field]) => exactLamports(allocation?.[field]));
  const total = exactLamports(allocation?.appRevenueLamports);
  const completeAmounts = evidenceReady && amounts.every(amount => amount != null)
    && total != null && amounts.reduce((sum, amount) => sum + amount, 0n) === total
    && (allocation.status === 'verified' || allocation.settledCollections > 0);
  const labels = ['Operations', 'Referral network', 'Community reserve', '$FUNDED buyback'];
  const rates = policyReady ? [split.operationsPercent,
    split.referralLevelPercents.reduce((sum, rate) => sum + rate, 0),
    split.communityPercent, split.buybackPercent] : [];
  return {
    state:!policyReady ? 'unavailable' : !completeAmounts ? 'policy-only'
      : allocation.status === 'partial' ? 'partial' : 'verified',
    policyNote:policyReady
      ? `Current policy for new launches${allocation.currentPolicy.revision ? ` · revision ${allocation.currentPolicy.revision}` : ''}. Existing coins keep their launch-time split.`
      : 'Current protocol fee policy is unavailable.',
    evidenceNote:!completeAmounts
      ? 'Verified V3 allocation amounts are unavailable. The percentages above describe policy only.'
      : `${allocation.settledCollections} finalized V3 settlement${allocation.settledCollections === 1 ? '' : 's'} · allocated SOL, not wallet balances or paid rewards${allocation.status === 'partial' ? ' · partial receipt coverage' : ''}.`,
    rows:DESTINATIONS.map(([key], index) => ({
      key,
      label:labels[index],
      share:policyReady ? `${rates[index]}% of app share` : '—',
      gross:policyReady ? `${Number((rates[index] / 5).toFixed(6))}% of gross collected fees` : 'Current rate unavailable',
      amount:formatSol(completeAmounts ? amounts[index] : null),
      detail:key === 'referrals' && policyReady
        ? `L1 ${split.referralLevelPercents[0]}% · L2 ${split.referralLevelPercents[1]}% · L3 ${split.referralLevelPercents[2]}% of app share`
        : null,
    })),
  };
}

export function renderHomeProtocolFeeRoute(allocation, document = globalThis.document) {
  const root = document?.querySelector('#home-protocol-route');
  if (!root) return;
  const model = protocolFeeRouteModel(allocation);
  root.dataset.state = model.state;
  const policy = root.querySelector('#home-protocol-route-policy');
  const status = root.querySelector('#home-protocol-route-status');
  if (policy) policy.textContent = model.policyNote;
  if (status) status.textContent = model.evidenceNote;
  for (const row of model.rows) {
    const card = root.querySelector(`[data-protocol-destination="${row.key}"]`);
    if (!card) continue;
    const rate = card.querySelector('strong');
    const description = card.querySelector('small');
    const amount = card.querySelector('b');
    if (rate) rate.textContent = row.share;
    if (description) description.textContent = row.detail
      ? `${row.gross} · ${row.detail}` : row.gross;
    if (amount) amount.textContent = row.amount;
  }
}
