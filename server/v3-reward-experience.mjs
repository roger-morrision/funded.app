import { AUTOMATIC_REWARDS } from '../automatic-rewards.js';

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const value = input => /^(0|[1-9]\d*)$/.test(String(input)) ? BigInt(input) : 0n;

// Public reward discovery is a V3 projection of finalized ledger records.
// A recorded allocation is never presented as a payment.
export function v3RewardExperience(state = {}, rewards = {}, cluster = 'devnet', wallet = null, selectedMint = null) {
  if (wallet != null && !ADDRESS.test(wallet)) throw new Error('A valid Solana wallet is required.');
  if (selectedMint != null && !ADDRESS.test(selectedMint)) throw new Error('A valid Solana mint is required.');
  const rewardState = rewards && typeof rewards === 'object' ? rewards : {};
  const tokens = [], walletRows = [], events = [];
  let communityAllocated = 0n, communityFunded = 0n;
  const communityVaults = new Set();
  for (const launch of Object.values(state.launches || {})) {
    if (!launch.onchainVerified || launch.cluster !== cluster || !ADDRESS.test(String(launch.mint || ''))
      || launch.pumpFeeRoute?.scope !== 'per-mint-v3' || launch.pumpFeeRoute.router !== launch.creator
      || selectedMint && selectedMint !== launch.mint) continue;
    const mint = launch.mint;
    const collections = Object.values(state.collections || {}).filter(row => row.mint === mint
      && row.scope === 'per-mint-v3' && row.status === 'collected' && row.onchainVerified === true
      && row.cluster === cluster && row.programId === launch.pumpFeeRoute.programId
      && row.router === launch.creator);
    const totals = { collected:0n, allocated:0n, creator:0n, holder:0n, x:0n,
      community:0n, buyback:0n };
    const sourceSignatures = new Set();
    for (const row of collections) {
      totals.collected += value(row.collectedLamports);
      sourceSignatures.add(row.signature);
      if (SIGNATURE.test(row.signature)) events.push({ mint, kind:'fee-collected', signature:row.signature,
        amountLamports:String(row.collectedLamports), at:row.recordedAt || null,
        label:'Creator fees collected from Pump' });
      const settlement = state.v3Settlements?.[row.signature];
      const plan = settlement?.allocationPlan;
      if (settlement?.status !== 'finalized' || settlement.mint !== mint
        || plan?.status !== 'allocated-not-funded'
        || value(plan.grossLamports) !== value(row.collectedLamports)) continue;
      totals.allocated += value(plan.grossLamports);
      totals.creator += value(plan.creatorDirected?.walletLamports);
      totals.holder += value(plan.creatorDirected?.holderLamports);
      totals.x += value(plan.creatorDirected?.xLamports);
      totals.community += value(plan.protocol?.communityLamports);
      totals.buyback += value(plan.protocol?.buybackLamports);
      const funded = state.v3CommunityFunding?.[row.signature];
      if (funded?.status === 'finalized' && funded.balanceDeltaVerified === true
        && funded.amount === plan.protocol?.communityLamports) {
        communityFunded += value(funded.amount);
        if (ADDRESS.test(String(funded.recipient || ''))) communityVaults.add(funded.recipient);
      }
    }
    communityAllocated += totals.community;
    const payouts = [];
    for (const schedule of Object.values(rewardState.schedules || {})) {
      if (schedule.mint !== mint || schedule.kind !== 'holder' || schedule.asset !== 'SOL') continue;
      const linked = (schedule.poolIds || []).some(id => {
        if (!id.startsWith('v3:') || !sourceSignatures.has(id.slice(3))) return false;
        const funded = state.v3CreatorRewardFunding?.[id.slice(3)];
        return funded?.status === 'finalized' && funded.balanceDeltaVerified === true;
      });
      if (!linked) continue;
      for (const [recipient, payment] of Object.entries(schedule.payments || {})) {
        if (!ADDRESS.test(recipient) || !SIGNATURE.test(String(payment.signature || ''))
          || payment.status !== 'paid' || payment.finalized !== true
          || payment.balanceDeltaVerified !== true) continue;
        payouts.push({ kind:'holder', wallet:recipient, signature:payment.signature,
          amountLamports:String(payment.amount), paidAt:payment.paidAt || null,
          source:'finalized-v3-reward-cycle', feeSourceVerified:true });
      }
    }
    for (const [source, claim] of Object.entries(state.v3XClaims || {})) {
      if (!sourceSignatures.has(source) || claim.mint !== mint || claim.status !== 'paid'
        || state.v3CreatorRewardFunding?.[source]?.status !== 'finalized'
        || state.v3CreatorRewardFunding[source]?.balanceDeltaVerified !== true
        || !ADDRESS.test(String(claim.wallet || ''))
        || !SIGNATURE.test(String(claim.payment?.signature || ''))
        || claim.payment?.finalized !== true || claim.payment?.balanceDeltaVerified !== true) continue;
      payouts.push({ kind:'x', wallet:claim.wallet, signature:claim.payment.signature,
        amountLamports:String(claim.amountLamports), paidAt:claim.paidAt || null,
        source:'finalized-v3-x-claim', feeSourceVerified:true });
    }
    for (const source of sourceSignatures) {
      const payout = state.v3CreatorWalletPayout?.[source];
      const allocation = state.v3Settlements?.[source]?.allocationPlan?.creatorDirected?.walletLamports;
      if (payout?.status !== 'finalized' || payout.balanceDeltaVerified !== true
        || payout.collectionSignature !== source || payout.mint !== mint
        || payout.programId !== launch.pumpFeeRoute.programId || payout.category !== 0
        || payout.recipient !== launch.creatorWallet || payout.amount !== allocation
        || !/^[1-9]\d*$/.test(String(allocation || ''))
        || !SIGNATURE.test(String(payout.signature || ''))) continue;
      payouts.push({ kind:'creator', wallet:launch.creatorWallet, signature:payout.signature,
        amountLamports:payout.amount, paidAt:payout.finalizedAt || null,
        source:'finalized-v3-creator-wallet-payout', feeSourceVerified:true });
    }
    for (const payout of payouts) events.push({ mint, kind:`${payout.kind}-paid`,
      signature:payout.signature, amountLamports:payout.amountLamports, at:payout.paidAt,
      label:`${payout.kind} reward paid`, feeSourceVerified:true });
    const burns = Object.entries(state.v3BuybackOrders || {}).filter(([source, row]) =>
      sourceSignatures.has(source) && row.status === 'finalized' && row.finalized === true
      && row.vaultDebitVerified === true && row.burnInstructionVerified === true);
    for (const [, row] of burns) if (SIGNATURE.test(String(row.signature || '')))
      events.push({ mint, kind:'buyback-burned', signature:row.signature,
        amountLamports:String(row.spentLamports || '0'), at:row.finalizedAt || null,
        label:'Fee-funded $FUNDED buyback and burn' });
    const holderPaid = payouts.filter(row => row.kind === 'holder');
    const paidByWallet = new Map();
    for (const row of holderPaid) {
      const prior = paidByWallet.get(row.wallet) || { wallet:row.wallet,
        amountLamports:0n, paymentCount:0, latestSignature:null, latestPaidAt:null };
      prior.amountLamports += value(row.amountLamports);
      prior.paymentCount += 1;
      if (!prior.latestSignature || String(row.paidAt || '') >= String(prior.latestPaidAt || '')) {
        prior.latestSignature = row.signature;
        prior.latestPaidAt = row.paidAt;
      }
      paidByWallet.set(row.wallet, prior);
    }
    const topHolderRecipients = [...paidByWallet.values()]
      .sort((a, b) => a.amountLamports === b.amountLamports
        ? a.wallet.localeCompare(b.wallet) : a.amountLamports > b.amountLamports ? -1 : 1)
      .slice(0, 10).map(row => ({ ...row, amountLamports:String(row.amountLamports) }));
    const xPaid = payouts.filter(row => row.kind === 'x');
    const lastHolderPayout = holderPaid.map(row => row.paidAt).filter(Boolean).sort().at(-1) || null;
    const token = { mint, name:launch.name || launch.symbol || mint,
      symbol:launch.symbol || '', imageUri:launch.imageUri || null,
      creatorWallet:launch.creatorWallet || null, createdAt:launch.createdAt || null,
      createdTimestamp:launch.createdTimestamp || launch.blockTime || null,
      holderSharePercent:Number(launch.feeDistribution?.creatorDirected?.shares?.holderAirdropPercent || 0),
      totals:Object.fromEntries(Object.entries(totals).map(([key, amount]) => [key, amount.toString()])),
      collectionCount:collections.length, holderPaidWallets:new Set(holderPaid.map(row => row.wallet)).size,
      holderPayoutCount:holderPaid.length,
      holderPaidLamports:holderPaid.reduce((sum, row) => sum + value(row.amountLamports), 0n).toString(),
      topHolderRecipients,
      holderRewardPolicy:['usd-20-hourly-v1', 'usd-qa-hourly-v1'].includes(rewardState.programs?.[mint]?.eligibilityPolicy)
        ? { cadence:'hourly',
          minimumHolderUsd:rewardState.programs[mint].qaMinimums?.minimumHolderUsd ?? AUTOMATIC_REWARDS.minimumHolderUsd,
          minimumPoolUsd:rewardState.programs[mint].qaMinimums?.minimumPoolUsd ?? AUTOMATIC_REWARDS.minimumPoolUsd,
          qaMinimums:rewardState.programs[mint].eligibilityPolicy === 'usd-qa-hourly-v1',
          maxEligibleHolders:AUTOMATIC_REWARDS.maxEligibleHolders,
          referenceOnly:cluster === 'devnet' } : null,
      xPaidWallets:new Set(xPaid.map(row => row.wallet)).size, xPayoutCount:xPaid.length,
      xPaidLamports:xPaid.reduce((sum, row) => sum + value(row.amountLamports), 0n).toString(),
      lastHolderPayout, buybackBurnCount:burns.length,
      buybackBurnedBaseUnits:burns.reduce((sum, [, row]) => sum + value(row.burnedBaseUnits), 0n).toString(),
      status:holderPaid.length ? 'holders-paid' : totals.holder > 0n ? 'holder-fees-allocated'
        : 'no-holder-share',
      payoutSource:holderPaid.length ? 'verified-v3-fee-funded-cycle' : null };
    tokens.push(token);
    if (wallet) {
      const creator = launch.creatorWallet === wallet;
      const mine = payouts.filter(row => row.wallet === wallet);
      const creatorPayout = payouts.filter(row => row.kind === 'creator')
        .reduce((sum, row) => sum + value(row.amountLamports), 0n);
      if (creator || mine.length) walletRows.push({ mint, symbol:token.symbol, creator,
        creatorAllocatedLamports:creator ? totals.creator.toString() : '0',
        creatorWithoutPayoutProofLamports:creator && totals.creator > creatorPayout
          ? String(totals.creator - creatorPayout) : '0', payouts:mine });
    }
  }
  tokens.sort((a, b) => b.holderPaidWallets - a.holderPaidWallets
    || String(b.lastHolderPayout || '').localeCompare(String(a.lastHolderPayout || ''))
    || a.mint.localeCompare(b.mint));
  events.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  return { cluster, generatedAt:new Date().toISOString(), evidence:{ status:rewards == null
      ? 'partial' : 'recorded-finalized-v3',
    commitment:null, coverage:null }, tokens:tokens.slice(0, 100),
    wallet:wallet ? { address:wallet, rows:walletRows } : null,
    community:{ allocatedLamports:String(communityAllocated), baseAllocatedLamports:'0',
      referralRolloverLamports:'0', fundedLamports:String(communityFunded),
      vaultAddress:communityVaults.size === 1 ? [...communityVaults][0] : null,
      paidLamports:null, status:communityFunded > 0n ? 'vault-funded-no-program-payout'
        : 'allocated-awaiting-vault-funding' }, events:events.slice(0, 100) };
}
