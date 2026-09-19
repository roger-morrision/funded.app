export const REWARD_POLICY = Object.freeze({
  acceptedTransferFeeBps: Object.freeze([100, 300]),
  defaultOperatingFeeBps: 250,
  minimumHolderUsd: 20,
  payoutAsset: 'quote-asset',
  claimMode: 'push',
  idempotencyKey: 'reward-cycle-signature',
});

function number(value, label) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0) throw new Error(`${label} must be a non-negative number.`);
  return result;
}

export function validateRewardConfig({ transferFeeBps, operatingFeeBps = REWARD_POLICY.defaultOperatingFeeBps } = {}) {
  const rate = Number(transferFeeBps);
  const operating = Number(operatingFeeBps);
  return {
    valid: REWARD_POLICY.acceptedTransferFeeBps.includes(rate) && Number.isFinite(operating) && operating >= 0 && operating < 10_000,
    transferFeeBps: rate,
    operatingFeeBps: operating,
    supportedRates: [...REWARD_POLICY.acceptedTransferFeeBps],
  };
}

export function calculateRewardPool({ withheldAmount, operatingFeeBps = REWARD_POLICY.defaultOperatingFeeBps } = {}) {
  const withheld = number(withheldAmount, 'Withheld amount');
  const fee = number(operatingFeeBps, 'Operating fee');
  if (fee >= 10_000) throw new Error('Operating fee must be below 100%.');
  const operatingAmount = withheld * fee / 10_000;
  return {
    withheldAmount: Number(withheld.toFixed(9)),
    operatingAmount: Number(operatingAmount.toFixed(9)),
    distributableAmount: Number((withheld - operatingAmount).toFixed(9)),
    payoutAsset: REWARD_POLICY.payoutAsset,
  };
}

export function allocateProRataRewards({ distributableAmount, holders = [], minimumHolderUsd = REWARD_POLICY.minimumHolderUsd } = {}) {
  const distributable = number(distributableAmount, 'Distributable amount');
  const minimum = number(minimumHolderUsd, 'Minimum holder value');
  const eligible = holders
    .map(holder => ({ wallet: String(holder.wallet || '').trim(), balance: number(holder.balance, 'Holder balance'), valueUsd: number(holder.valueUsd ?? 0, 'Holder value') }))
    .filter(holder => holder.wallet && holder.balance > 0 && holder.valueUsd >= minimum);
  const totalBalance = eligible.reduce((sum, holder) => sum + holder.balance, 0);
  const payouts = totalBalance > 0
    ? eligible.map(holder => ({ ...holder, share: holder.balance / totalBalance, amount: Number((distributable * holder.balance / totalBalance).toFixed(9)) }))
    : [];
  return { minimumHolderUsd: minimum, eligibleHolders: eligible.length, totalEligibleBalance: totalBalance, distributableAmount: distributable, payouts };
}

export function buildRewardCycle({ cycleSignature, tokenMint, quoteMint, transferFeeBps, withheldAmount, holders, operatingFeeBps = REWARD_POLICY.defaultOperatingFeeBps, payoutSignature = null, cycleAt = new Date().toISOString() } = {}) {
  const config = validateRewardConfig({ transferFeeBps, operatingFeeBps });
  if (!config.valid) throw new Error('Reward token configuration is invalid or unsupported.');
  const signature = String(cycleSignature || '').trim();
  if (!signature) throw new Error('A reward cycle signature is required.');
  const pool = calculateRewardPool({ withheldAmount, operatingFeeBps });
  const allocation = allocateProRataRewards({ distributableAmount: pool.distributableAmount, holders });
  return {
    id: signature,
    cycleSignature: signature,
    tokenMint: String(tokenMint || '').trim() || null,
    quoteMint: String(quoteMint || '').trim() || null,
    transferFeeBps: config.transferFeeBps,
    ...pool,
    ...allocation,
    payoutSignature: payoutSignature ? String(payoutSignature) : null,
    payouts: allocation.payouts,
    status: payoutSignature ? 'paid' : 'ready-to-payout',
    cycleAt: new Date(cycleAt).toISOString(),
    idempotencyKey: REWARD_POLICY.idempotencyKey,
  };
}
