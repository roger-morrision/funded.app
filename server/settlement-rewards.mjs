import { PublicKey } from '@solana/web3.js';

// Created once by the server composition layer; state belongs to this instance.
export function createSettlementRewards({
  store,
  automaticRewardStore,
}) {
  async function registerAutomaticLaunch(launch) {
    if (Number(launch?.feeDistribution?.creatorDirected?.shares?.holderAirdropPercent || 0) <= 0) return;
    const excludedWallets = String(process.env.REWARD_EXCLUDED_WALLETS || '').split(',').map(row => row.trim()).filter(Boolean);
    const periodSeconds = 86400;
    const activatedAt = Math.floor(Date.now() / 1000);
    const firstPeriodStart = Math.ceil(activatedAt / periodSeconds) * periodSeconds;
    await automaticRewardStore.transaction(state => {
      state.programs ||= {};
      state.programs[launch.mint] ||= { mint:launch.mint, enabled:true, asset:'SOL', kind:'holder', periodSeconds, sampleIntervalSeconds:300, payoutDelaySeconds:3600, activatedAt, firstPeriodStart, excludedWallets:[...new Set(excludedWallets)].sort(), updatedAt:new Date().toISOString() };
    });
  }

  async function queueAutomaticSettlementRewards(settlement) {
    const main = await store.read(), collection = main.collections?.[settlement.claimSignature], launch = collection?.mint ? main.launches?.[collection.mint] : null;
    if (collection?.status !== 'collected' || collection.attribution !== 'mint-verified' || !launch?.onchainVerified) throw new Error('Automatic rewards require the verified collection and launch records.');
    const rows = [
      { suffix:'creator', kind:'creator', amount:solToLamports(settlement.creatorDestinations?.creatorWallet), recipient:launch.creatorWallet, status:'claimable' },
      { suffix:'holders', kind:'holder', amount:solToLamports(settlement.creatorDestinations?.holderAirdrop), recipient:null, status:'pending' },
      { suffix:'operations', kind:'operations', amount:solToLamports(settlement.fundedApp?.operations), recipient:process.env.FUNDED_PUMP_REVENUE_WALLET, status:'pending' },
      { suffix:'community', kind:'community-reserve', amount:solToLamports(settlement.fundedApp?.community), recipient:null, status:'pending' },
    ];
    if (rows.some(row => row.kind === 'operations' && BigInt(row.amount) > 0n && !row.recipient)) throw new Error('Operations payout requires a dedicated Pump revenue wallet.');
    if (rows.some(row => row.kind === 'operations' && BigInt(row.amount) > 0n)) new PublicKey(process.env.FUNDED_PUMP_REVENUE_WALLET);
    const xObligation = Object.values(main.obligations || {}).find(row => row.claimSignature === settlement.claimSignature && row.mint === collection.mint);
    if (BigInt(solToLamports(settlement.creatorDestinations?.solClaim)) > 0n) rows.push({ suffix:'x', kind:'x', amount:solToLamports(settlement.creatorDestinations.solClaim), recipient:null, obligationId:xObligation?.id || null, status:'awaiting-verified-recipient' });
    await automaticRewardStore.transaction(state => {
      state.fundingRequests ||= {};
      for (const row of rows.filter(item => BigInt(item.amount) > 0n)) {
        const id = `${settlement.claimSignature}:${row.suffix}`;
        const prior = state.fundingRequests[id];
        const request = { id, mint:collection.mint, asset:'SOL', kind:row.kind, amount:row.amount, recipient:prior?.kind === 'operations' ? prior.recipient : row.recipient, obligationId:row.obligationId || null, sourceSignature:settlement.claimSignature, status:row.status, createdAt:new Date().toISOString() };
        if (prior && ['mint','asset','kind','amount','recipient','obligationId','sourceSignature'].some(key => prior[key] !== request[key])) throw new Error('Automatic reward funding request conflicts with its immutable settlement.');
        state.fundingRequests[id] ||= request;
      }
    });
  }

  async function enrollAutomaticXReward(claim) {
    if (!claim?.publicKey || !claim?.xAttestation || claim.xAttestation.subject !== claim.xUserId) return;
    return automaticRewardStore.transaction(state => {
      state.fundingRequests ||= {};
      for (const request of Object.values(state.fundingRequests)) if (request.kind === 'x' && request.obligationId === claim.obligationId && request.status === 'awaiting-verified-recipient') { request.recipient = claim.publicKey; request.status = 'pending'; request.enrolledAt = new Date().toISOString(); }
      return Object.values(state.fundingRequests).find(request => request.kind === 'x' && request.obligationId === claim.obligationId && request.recipient === claim.publicKey)?.status || null;
    });
  }

  return { registerAutomaticLaunch, queueAutomaticSettlementRewards, enrollAutomaticXReward };
}

export function solToLamports(value) {
  const lamports = Math.round(Number(value) * 1_000_000_000);
  if (!Number.isSafeInteger(lamports) || lamports < 0) throw new Error('Automatic reward amount is not valid lamports.');
  return String(lamports);
}
