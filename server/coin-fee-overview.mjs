const LAMPORTS = 1_000_000_000n;

function units(value) {
  if (value == null || value === '') return 0n;
  if (typeof value === 'number') {
    const lamports = Math.round(value * Number(LAMPORTS));
    return Number.isSafeInteger(lamports) && lamports >= 0 ? BigInt(lamports) : 0n;
  }
  const text = String(value);
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/.test(text)) return 0n;
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * LAMPORTS + BigInt(fraction.padEnd(9, '0'));
}
function integerUnits(value) {
  return /^(?:0|[1-9]\d*)$/.test(String(value)) ? BigInt(value) : 0n;
}
const asString = value => value.toString();

export function coinFeeOverview({ mint, cluster, launch, collections = {}, settlements = {}, rewardState = {}, referralClaims = {}, payouts = {}, verifiedPayoutSignatures = [], operationsRecipient = null, pumpAccruedLamports = null, pumpVault = null, pumpError = null }) {
  const verified = Boolean(launch?.onchainVerified && launch.cluster === cluster && launch.pumpFeeRoute?.scope === 'per-mint-v2' && launch.pumpFeeRoute.router === launch.creator);
  const payoutProofs = new Set(verifiedPayoutSignatures);
  const rows = Object.values(collections).filter(row => row.mint === mint && row.cluster === cluster && row.status === 'collected' && row.attribution === 'mint-verified' && row.onchainVerified === true && row.signature && integerUnits(row.collectedLamports) > 0n);
  const claimed = rows.filter(row => settlements[row.signature]);
  const gross = rows.reduce((sum, row) => sum + integerUnits(row.collectedLamports), 0n);
  const settled = claimed.reduce((sum, row) => sum + units(settlements[row.signature].grossCreatorFees), 0n);
  const shares = launch?.feeDistribution?.creatorDirected?.shares || {};
  const fixed = launch?.feeDistribution?.fixedFunded;
  const definitions = [
    { id:'creator', label:'Coin creator', percent:Number(shares.creatorWalletPercent || 0), recipient:launch?.creatorWallet || null, kind:'creator', path:'wallet requested payout' },
    { id:'holders', label:'Token holders', percent:Number(shares.holderAirdropPercent || 0), recipient:null, kind:'holder', path:'snapshot based distribution' },
    { id:'x', label:'X recipient', percent:Number(shares.solClaimPercent || 0), recipient:launch?.feeDistribution?.creatorDirected?.recipients?.xAccount || null, kind:'x', path:'X sign in and wallet verification' },
    { id:'operations', label:'Operations', percent:Number(fixed?.operations?.effectivePercentOfCreatorFees ?? 14), recipient:operationsRecipient, kind:'operations', path:'automatic verified payout' },
    { id:'referral-1', label:'Direct referral', percent:Number(fixed?.appReferral?.levels?.[0]?.effectivePercentOfCreatorFees ?? 2), recipient:null, kind:null, path:'wallet claim' },
    { id:'referral-2', label:'Second referral', percent:Number(fixed?.appReferral?.levels?.[1]?.effectivePercentOfCreatorFees ?? 0.6), recipient:null, kind:null, path:'wallet claim' },
    { id:'referral-3', label:'Third referral', percent:Number(fixed?.appReferral?.levels?.[2]?.effectivePercentOfCreatorFees ?? 0.4), recipient:null, kind:null, path:'wallet claim' },
    { id:'community', label:'Community programs reserve', percent:Number(fixed?.communityRewards?.effectivePercentOfCreatorFees ?? 2), recipient:null, kind:null, path:'reserved for future published programs' },
    { id:'buyback', label:'Buyback and burn', percent:Number(fixed?.fundedBuyback?.effectivePercentOfCreatorFees ?? 1), recipient:null, kind:null, path:'protocol allocation' },
  ];
  const entries = definitions.map(definition => ({ ...definition, allocated:0n, paid:0n, statuses:new Set(), signatures:new Set() }));
  const byId = Object.fromEntries(entries.map(row => [row.id, row]));
  for (const collection of claimed) {
    const settlement = settlements[collection.signature];
    const amounts = {
      creator:settlement.creatorDestinations?.creatorWallet,
      holders:settlement.creatorDestinations?.holderAirdrop,
      x:settlement.creatorDestinations?.solClaim,
      operations:settlement.fundedApp?.operations,
      community:settlement.fundedApp?.communityBase,
      buyback:settlement.fundedApp?.buyback,
    };
    for (const [id, amount] of Object.entries(amounts)) byId[id].allocated += units(amount);
    for (const level of settlement.fundedApp?.referralLevels || []) {
      const entry = byId[`referral-${level.level}`];
      if (!entry) continue;
      if (level.recipient) { entry.recipient ||= level.recipient; entry.allocated += units(level.amount); }
      else byId.community.allocated += units(level.amount);
    }
    let xAutomaticallyPaid = false;
    for (const kind of ['creator','holders','x','operations']) {
      const request = rewardState.fundingRequests?.[`${collection.signature}:${kind}`];
      if (!request) continue;
      byId[kind].statuses.add(request.status || 'pending');
      const schedule = rewardState.schedules?.[request.scheduleId];
      if (kind === 'holders') continue; // Individual recipients exist only after a finalized snapshot.
      const payment = schedule?.payments?.[request.recipient];
      if (payment?.status === 'paid' && payment.finalized === true && payment.balanceDeltaVerified === true && payment.signature) {
        byId[kind].paid += integerUnits(payment.amount);
        byId[kind].signatures.add(payment.signature);
        if (kind === 'x') xAutomaticallyPaid = true;
      }
    }
    for (const level of settlement.fundedApp?.referralLevels || []) {
      const entry = byId[`referral-${level.level}`];
      if (!entry || !level.recipient) continue;
      const claim = Object.values(referralClaims).find(item => item.settlementSignature === collection.signature && item.level === level.level && item.recipientWallet === level.recipient && item.status === 'paid' && payoutProofs.has(item.payoutSignature));
      if (claim) { entry.paid += units(level.amount); entry.signatures.add(claim.payoutSignature); }
    }
    const xObligation = Object.values(rewardState.fundingRequests || {}).find(item => item.sourceSignature === collection.signature && item.kind === 'x');
    const manualX = xObligation && Object.values(payouts).find(item => item.obligationId === xObligation.obligationId && item.mint === mint && item.status === 'paid' && item.signature);
    if (manualX && !xAutomaticallyPaid && payoutProofs.has(manualX.signature)) { byId.x.paid += integerUnits(manualX.amountLamports); byId.x.signatures.add(manualX.signature); }
  }
  // Holder payments are attached to a reward cycle, not to a funding request.
  // Count a cycle only when every pool it consumed came from one of this
  // mint's verified Pump collections. A cycle mixed with an unrelated QA
  // top-up cannot be presented as a fully fee-funded payout here.
  const feeFundedHolderPools = new Set(claimed.map(row => `${row.signature}:holders`));
  for (const schedule of Object.values(rewardState.schedules || {})) {
    if (schedule.mint !== mint || schedule.kind !== 'holder' || schedule.asset !== 'SOL'
      || !Array.isArray(schedule.poolIds) || schedule.poolIds.length === 0
      || !schedule.poolIds.every(id => feeFundedHolderPools.has(id))) continue;
    const pools = schedule.poolIds.map(id => rewardState.rewardPools?.[id]);
    if (pools.some(pool => !pool || pool.mint !== mint || pool.asset !== 'SOL'
      || pool.status !== 'assigned' || pool.scheduleId !== schedule.id || pool.balanceDeltaVerified !== true)) continue;
    const funded = pools.reduce((sum, pool) => sum + integerUnits(pool.amount), 0n);
    const payments = Object.values(schedule.payments || {}).filter(payment => payment.status === 'paid'
      && payment.finalized === true && payment.balanceDeltaVerified === true && payment.signature);
    const paid = payments.reduce((sum, payment) => sum + integerUnits(payment.amount), 0n);
    if (paid > funded) continue;
    byId.holders.paid += paid;
    if (paid > 0n) byId.holders.statuses.add('paid');
    payments.forEach(payment => byId.holders.signatures.add(payment.signature));
  }
  return {
    available:verified,
    source:'mint-verified-collections-and-payout-receipts',
    pump:{ vault:pumpVault, accruedLamports:pumpAccruedLamports == null ? null : String(pumpAccruedLamports), status:pumpError ? 'unavailable' : pumpAccruedLamports == null ? 'unavailable' : 'confirmed', error:pumpError },
    collectedLamports:asString(gross),
    allocatedLamports:asString(settled),
    awaitingAllocationLamports:asString(gross > settled ? gross - settled : 0n),
    collectionCount:rows.length,
    creatorWallet:launch?.creatorWallet || null,
    router:launch?.pumpFeeRoute?.router || null,
    receivers:entries.filter(row => row.percent > 0 || row.allocated > 0n).map(row => ({
      id:row.id, label:row.label, percent:row.percent, recipient:row.recipient, path:row.path,
      allocatedLamports:asString(row.allocated), confirmedPaidLamports:asString(row.paid),
      withoutConfirmedPayoutLamports:asString(row.allocated > row.paid ? row.allocated - row.paid : 0n),
      deliveryStatus:[...row.statuses], payoutSignatures:[...row.signatures],
    })),
  };
}
