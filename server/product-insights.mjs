import { v3RewardExperience } from './v3-reward-experience.mjs';
import { dailyPaymentCandidates } from './daily-bonus-payment-history.mjs';
import { financialProcessingMetrics } from './financial-processing-metrics.mjs';
const address = value => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(value || ''));
const signature = value => /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(String(value || ''));
const integer = value => /^(0|[1-9]\d*)$/.test(String(value));
export function recordedFinancialEvents(state, rewards, cluster, selectedSignature = null) {
  const experience = v3RewardExperience(state, rewards, cluster, null, null, {signature:selectedSignature});
  const events = experience.events.map(row => ({...row,asset:'SOL',evidence:'recorded-finalized-v3'}));
  for (const candidate of dailyPaymentCandidates(rewards || {}).candidates) {
    const source = state.collections?.[candidate.source.collectionSignature], funding = state.v3CommunityFunding?.[candidate.source.collectionSignature];
    const launch=state.launches?.[source?.mint],settlement=state.v3Settlements?.[candidate.source.collectionSignature];
    if (!source?.onchainVerified || source.status !== 'collected' || source.cluster !== cluster || source.scope !== 'per-mint-v3'
      || !state.launches?.[source.mint]?.onchainVerified || state.launches[source.mint].cluster !== cluster
      || launch.pumpFeeRoute?.scope !== 'per-mint-v3' || launch.pumpFeeRoute.programId !== source.programId || launch.pumpFeeRoute.router !== source.router
      || launch.feeDistribution?.fixedFunded?.communityRewards?.dailyBonus?.version !== 1
      || source.signature !== candidate.source.collectionSignature || source.mint !== candidate.source.mint
      || settlement?.status !== 'finalized' || settlement.mint !== source.mint || settlement.collectionSignature !== source.signature
      || settlement.settlementSignature !== candidate.source.settlementSignature
      || funding?.status !== 'finalized' || funding.balanceDeltaVerified !== true || funding.amount !== candidate.source.amountLamports
      || funding.signature !== candidate.payout.fundingSignature
      || funding.mint !== source.mint || !signature(candidate.payment.signature)
      || selectedSignature && selectedSignature !== candidate.payment.signature) continue;
    events.push({mint:source.mint,kind:'bonus-paid',label:'Ranked bonus received',signature:candidate.payment.signature,
      wallet:candidate.recipient,amountLamports:candidate.leaf.amount,at:candidate.payment.paidAt || null,sourceSignature:source.signature,sourceSignatures:[source.signature],
      asset:'SOL',evidence:'recorded-finalized-v3',feeSourceVerified:true});
  }
  return events;
}
export function financialReceipt(state, rewards, cluster, selectedSignature) {
  if (!signature(selectedSignature)) throw new Error('A valid transaction signature is required.');
  const events = recordedFinancialEvents(state,rewards,cluster,selectedSignature);
  if (!events.length) return null;
  const sources = new Set(), recipients = [], burns = [];
  for (const event of events) {
    if (event.kind === 'fee-collected') sources.add(event.signature);
    for(const source of event.sourceSignatures||[])if(signature(source))sources.add(source);
    if (event.wallet) recipients.push({mint:event.mint,wallet:event.wallet,amountLamports:event.amountLamports,kind:event.kind});
    for (const row of Object.values(state.v3BuybackOrders || {})) if (event.kind === 'buyback-burned' && row.mint === event.mint && row.signature === selectedSignature
      && row.status === 'finalized' && row.programId === state.launches?.[event.mint]?.pumpFeeRoute?.programId
      && row.finalized === true && row.vaultDebitVerified === true && row.burnInstructionVerified === true) {
      burns.push({mint:event.mint,targetMint:address(row.fundedMint) ? row.fundedMint : null,spentLamports:integer(row.spentLamports) ? row.spentLamports : null,
        burnedBaseUnits:integer(row.burnedBaseUnits) ? row.burnedBaseUnits : null,networkFeeLamports:integer(row.feeLamports) ? String(row.feeLamports) : null,
        vault:address(row.vault) ? row.vault : null,slot:row.slot || null});
      if (signature(row.collectionSignature)) sources.add(row.collectionSignature);
      for (const budget of Array.isArray(row.sourceBudgets) ? row.sourceBudgets : []) if (signature(budget.source)) sources.add(budget.source);
    }
  }
  return {cluster,signature:selectedSignature,evidence:'recorded-finalized-v3',currentRpcRecheck:false,events,
    recipients:[...new Map(recipients.filter(row => address(row.wallet) && integer(row.amountLamports)).map(row => [`${row.kind}:${row.mint}:${row.wallet}:${row.amountLamports}`,row])).values()].slice(0,100),
    burns:[...new Map(burns.map(row => [row.mint,row])).values()],sourceSignatures:[...sources].filter(signature).slice(0,100),
    coverage:'Recorded finalized V3 events and balance-delta proofs. Amounts of different assets are not combined; missing network costs are unavailable.'};
}
export function financialOperations(state, rewards, cluster, now = Date.now()) {
  const events = recordedFinancialEvents(state,rewards,cluster), orders = Object.values(state.v3BuybackOrders || {}).filter(row =>
    state.launches?.[row.mint]?.cluster === cluster && state.launches[row.mint].onchainVerified === true);
  const pending = orders.filter(row => row.status !== 'finalized');
  const ages = pending.map(row => (now - Date.parse(row.createdAt || row.submittedAt)) / 1000).filter(value => Number.isFinite(value) && value >= 0);
  const last = events.filter(row => row.kind.endsWith('-paid') || row.kind === 'buyback-burned').map(row => row.at).filter(value => Number.isFinite(Date.parse(value))).sort().at(-1) || null;
  const timing = financialProcessingMetrics(state,cluster,now,{rewards,bonusEvents:events.filter(row=>row.kind==='bonus-paid')});
  const creators = new Map();
  for (const launch of Object.values(state.launches || {})) if (launch.cluster === cluster && launch.onchainVerified && address(launch.creatorWallet)) {
    const row = creators.get(launch.creatorWallet) || {wallet:launch.creatorWallet,launches:0,verifiedPaymentReceipts:0,recipientWallets:new Set(),returningRecipients:new Map(),lastPaymentAt:null};
    row.launches++;
    const own = events.filter(event => event.mint === launch.mint && event.kind.endsWith('-paid'));
    row.verifiedPaymentReceipts += new Set(own.map(event => event.signature)).size;
    for (const schedule of Object.values(rewards?.schedules || {})) if (schedule.mint === launch.mint && schedule.kind === 'holder') {
      for (const [wallet,payment] of Object.entries(schedule.payments || {})) if (wallet !== launch.creatorWallet && own.some(event => event.signature === payment.signature)
        && payment.finalized === true && payment.balanceDeltaVerified === true && address(wallet)) {
        row.recipientWallets.add(wallet); const cycles = row.returningRecipients.get(wallet) || new Set(); cycles.add(schedule.id || schedule.cutoffAt); row.returningRecipients.set(wallet,cycles);
      }
    }
    row.lastPaymentAt = [...own.map(event => event.at),row.lastPaymentAt].filter(Boolean).sort().at(-1) || null; creators.set(row.wallet,row);
  }
  return {cluster,generatedAt:new Date(now).toISOString(),evidence:'recorded-finalized-v3',currentRpcRecheck:false,
    lastVerifiedDeliveryAt:last,pendingBuybackOperations:pending.length,oldestPendingSeconds:ages.length ? Math.floor(ages.reduce((max,value)=>Math.max(max,value),0)) : null,
    failedRecordedOperations:pending.filter(row => row.status === 'failed').length,logicalOperations:orders.length,
    completedRecordedOperations:orders.filter(row => row.status === 'finalized' && row.finalized === true && row.vaultDebitVerified === true && row.burnInstructionVerified === true).length,
    retryAttempts:null,timing,reconciliation:{status:'unavailable',reason:'This projection lacks an opening balance, complete verified inflow/outflow coverage, and matching closing balance. Current vault balances alone do not establish reconciliation.'},
    creators:[...creators.values()].map(row => ({...row,recipientWallets:row.recipientWallets.size,
      returningRecipients:[...row.returningRecipients.values()].filter(cycles => cycles.size > 1).length,
      badges:[row.launches && 'Verified launcher',row.verifiedPaymentReceipts && 'Verified reward delivery'].filter(Boolean)}))
      .sort((a,b) => b.returningRecipients - a.returningRecipients || b.verifiedPaymentReceipts - a.verifiedPaymentReceipts || a.wallet.localeCompare(b.wallet)).slice(0,100),
    retentionCoverage:'Returning paid wallets in recorded holder cycles; not unique people or a complete holder-retention measure. No monetary ranking changes.',
    rewardLedgerAvailable:rewards!=null,coverage:'Operation counts cover registered V3 launch policies; on-chain policies without registry entries remain in Buybacks. Payment events cover the latest 100 projected V3 events plus validated ranked bonus receipts. Retry-attempt counts and current vault balances are not inferred.'+(rewards==null?' Reward ledger unavailable: holder and bonus receipt coverage is missing.':'')};
}
