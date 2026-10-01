const LAMPORTS = 1_000_000_000n;
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

function amount(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return 0n;
  const text = String(value);
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/.test(text)) return 0n;
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * LAMPORTS + BigInt(fraction.padEnd(9, '0'));
}
function integer(value) {
  return /^(?:0|[1-9]\d*)$/.test(String(value)) ? BigInt(value) : 0n;
}
function verifiedLaunch(launch, cluster) {
  return launch?.onchainVerified === true && launch.cluster === cluster && ADDRESS.test(String(launch.mint || ''))
    && launch.pumpFeeRoute?.scope === 'per-mint-v2' && launch.pumpFeeRoute.router === launch.creator;
}
function paymentRows(rewards, mint, verifiedCollections) {
  const rows = [];
  for (const schedule of Object.values(rewards.schedules || {})) {
    if (schedule.mint !== mint || schedule.asset !== 'SOL'
      || !['holder', 'creator', 'x'].includes(schedule.kind)) continue;
    const leaves = new Map((schedule.manifest?.leaves || []).map(leaf => [leaf.recipient, leaf]));
    const poolIds = schedule.kind === 'holder' ? schedule.poolIds || [] : schedule.sourceId ? [schedule.sourceId] : [];
    const sourceClaims = poolIds.map(id => {
      const request = rewards.fundingRequests?.[id];
      const pool = rewards.rewardPools?.[id];
      if (!request || request.mint !== mint || request.asset !== 'SOL' || request.status !== 'funded'
        || request.balanceDeltaVerified !== true || !verifiedCollections.has(request.sourceSignature)
        || schedule.kind === 'holder' && (!pool || pool.mint !== mint || pool.asset !== 'SOL'
          || pool.balanceDeltaVerified !== true || pool.fundingSignature !== request.fundingSignature
          || String(pool.amount) !== String(request.amount))
        || schedule.kind !== 'holder' && (schedule.fundingSignature !== request.fundingSignature
          || schedule.balanceDeltaVerified !== true)) return null;
      return request.sourceSignature;
    });
    const feeSourceVerified = poolIds.length > 0 && sourceClaims.every(Boolean);
    for (const [wallet, payment] of Object.entries(schedule.payments || {})) {
      const leaf = leaves.get(wallet);
      if (!ADDRESS.test(wallet) || !leaf || String(leaf.amount) !== String(payment.amount)
        || payment.status !== 'paid' || payment.finalized !== true || payment.balanceDeltaVerified !== true
        || !SIGNATURE.test(String(payment.signature || ''))) continue;
      rows.push({ kind:schedule.kind, wallet, signature:payment.signature, amountLamports:String(payment.amount),
        paidAt:payment.paidAt || schedule.paidAt || null, source:'finalized-reward-cycle',
        feeSourceVerified, sourceClaims:feeSourceVerified ? sourceClaims : [] });
    }
  }
  return rows;
}
function allocation(settlement, key) {
  if (key === 'creator') return amount(settlement.creatorDestinations?.creatorWallet);
  if (key === 'holder') return amount(settlement.creatorDestinations?.holderAirdrop);
  if (key === 'x') return amount(settlement.creatorDestinations?.solClaim);
  if (key === 'community') return amount(settlement.fundedApp?.community);
  if (key === 'buyback') return amount(settlement.fundedApp?.buyback);
  return 0n;
}

export function rewardExperience(state = {}, rewards = {}, evidence = {}, cluster = 'devnet', wallet = null, selectedMint = null) {
  if (wallet != null && !ADDRESS.test(wallet)) throw new Error('A valid Solana wallet is required.');
  if (selectedMint != null && !ADDRESS.test(selectedMint)) throw new Error('A valid Solana mint is required.');
  const evidenceReady = evidence.cluster === cluster && evidence.commitment === 'finalized'
    && ['onchain-indexed', 'partial', 'no-records'].includes(evidence.status);
  const verifiedCollections = new Map((evidenceReady ? evidence.verifiedCollections || [] : [])
    .filter(row => SIGNATURE.test(String(row.signature || ''))).map(row => [row.signature, row]));
  const verifiedPayouts = new Map((evidenceReady ? evidence.verifiedPayouts || [] : [])
    .filter(row => SIGNATURE.test(String(row.signature || ''))).map(row => [row.signature, row]));
  const tokens = [];
  const walletRows = [];
  const events = [];
  let communityAllocated = 0n;
  for (const launch of Object.values(state.launches || {})) {
    if (!verifiedLaunch(launch, cluster) || selectedMint && launch.mint !== selectedMint) continue;
    const mint = launch.mint;
    const collections = Object.values(state.collections || {}).filter(row => row.mint === mint && row.cluster === cluster
      && row.status === 'collected' && row.onchainVerified === true && row.attribution === 'mint-verified'
      && verifiedCollections.get(row.signature)?.mint === mint
      && integer(verifiedCollections.get(row.signature)?.collectedLamports) === integer(row.collectedLamports)
      && integer(row.collectedLamports) > 0n);
    const totals = { collected:0n, allocated:0n, creator:0n, holder:0n, x:0n, community:0n, buyback:0n };
    for (const row of collections) {
      const gross = integer(row.collectedLamports);
      totals.collected += gross;
      events.push({ mint, kind:'fee-collected', signature:row.signature, amountLamports:String(gross),
        at:row.recordedAt || null, label:'Creator fees collected from Pump' });
      const settlement = state.settlements?.[row.signature];
      if (settlement?.claimSignature !== row.signature || settlement.asset !== 'SOL'
        || amount(settlement.grossCreatorFees) !== gross) continue;
      totals.allocated += gross;
      for (const key of ['creator', 'holder', 'x', 'community', 'buyback']) totals[key] += allocation(settlement, key);
      // Unassigned referral levels belong to the community reserve.
      for (const level of settlement.fundedApp?.referralLevels || []) if (!level.recipient) totals.community += amount(level.amount);
    }
    communityAllocated += totals.community;
    const payouts = paymentRows(rewards, mint, verifiedCollections);
    for (const payout of Object.values(state.payouts || {})) {
      const proof = verifiedPayouts.get(payout.signature);
      const payoutMint = payout.mint || state.collections?.[state.referralClaims?.[payout.claimId]?.settlementSignature]?.mint;
      if (payoutMint !== mint || !proof || proof.to !== payout.to || proof.source !== payout.source
        || integer(proof.amountLamports) !== (payout.amountLamports == null ? amount(payout.amountSol) : integer(payout.amountLamports))) continue;
      payouts.push({ kind:payout.source === 'mint-router-settle-mint' ? 'x' : 'referral', wallet:payout.to,
        signature:payout.signature, amountLamports:String(proof.amountLamports), paidAt:payout.paidAt || null,
        source:'finalized-matching-balance-delta', feeSourceVerified:true });
    }
    for (const row of payouts) events.push({ mint, kind:`${row.kind}-paid`, signature:row.signature,
      amountLamports:row.amountLamports, at:row.paidAt, label:`${row.kind} reward paid`,
      feeSourceVerified:row.feeSourceVerified, sourceClaims:row.sourceClaims || [] });
    const burns = Object.values(state.buybackOrders || {}).filter(row => row.mint === mint && row.status === 'finalized'
      && row.refundVerified === true && SIGNATURE.test(String(row.signature || ''))
      && integer(row.boughtAndBurnedBaseUnits || row.burnedBaseUnits) > 0n
      && integer(row.supplyBefore) > integer(row.supplyAfter));
    for (const row of burns) events.push({ mint, kind:'buyback-burned', signature:row.signature,
      amountLamports:String(row.settledLamports || '0'), at:row.burnFinalizedAt || null,
      label:'Fee-funded $FUNDED buyback and burn' });
    const holderPaid = payouts.filter(row => row.kind === 'holder');
    const holderWallets = new Set(holderPaid.map(row => row.wallet));
    const lastHolderPayout = holderPaid.map(row => row.paidAt).filter(Boolean).sort().at(-1) || null;
    const token = { mint, name:launch.name || launch.symbol || mint, symbol:launch.symbol || '',
      imageUri:launch.imageUri || null, creatorWallet:launch.creatorWallet || null,
      holderSharePercent:Number(launch.feeDistribution?.creatorDirected?.shares?.holderAirdropPercent || 0),
      totals:Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, value.toString()])),
      collectionCount:collections.length, holderPaidWallets:holderWallets.size,
      holderPayoutCount:holderPaid.length, lastHolderPayout, buybackBurnCount:burns.length,
      buybackBurnedBaseUnits:burns.reduce((sum, row) => sum + integer(row.boughtAndBurnedBaseUnits || row.burnedBaseUnits), 0n).toString(),
      status:holderPaid.length ? 'holders-paid' : totals.holder > 0n ? 'holder-fees-allocated' :
        Number(launch.feeDistribution?.creatorDirected?.shares?.holderAirdropPercent || 0) > 0 ? 'policy-published' : 'no-holder-share',
      payoutSource:holderPaid.length ? holderPaid.every(row => row.feeSourceVerified)
        ? 'verified-fee-funded-cycle' : 'finalized-cycle-source-not-attributed-to-fee-claim' : null };
    tokens.push(token);
    if (wallet) {
      const creator = launch.creatorWallet === wallet;
      const mine = payouts.filter(row => row.wallet === wallet);
      const creatorPaid = mine.filter(row => row.kind === 'creator').reduce((sum, row) => sum + integer(row.amountLamports), 0n);
      const creatorAvailable = creator ? totals.creator > creatorPaid ? totals.creator - creatorPaid : 0n : 0n;
      if (creator || mine.length) walletRows.push({ mint, symbol:token.symbol, creator,
        creatorAllocatedLamports:creator ? totals.creator.toString() : '0',
        creatorWithoutPayoutProofLamports:creatorAvailable.toString(),
        payouts:mine });
    }
  }
  tokens.sort((a, b) => b.holderPaidWallets - a.holderPaidWallets
    || String(b.lastHolderPayout || '').localeCompare(String(a.lastHolderPayout || ''))
    || (BigInt(a.totals.holder) === BigInt(b.totals.holder) ? 0 : BigInt(a.totals.holder) > BigInt(b.totals.holder) ? -1 : 1)
    || a.mint.localeCompare(b.mint));
  events.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  return { cluster, generatedAt:new Date().toISOString(), evidence:{ status:evidenceReady ? evidence.status : 'unavailable',
    commitment:evidenceReady ? 'finalized' : null, coverage:evidenceReady ? evidence.coverage || null : null },
    tokens:tokens.slice(0, 100), wallet:wallet ? { address:wallet, rows:walletRows } : null,
    community:{ allocatedLamports:String(communityAllocated), paidLamports:null,
      status:'allocation-only-disbursement-proof-unavailable' }, events:events.slice(0, 100) };
}
