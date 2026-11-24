// One row per wallet in a referrer's three-level network, with the figures the
// Referrals page shows: when they joined, where from, coins they created, creator
// fees those coins collected, and the referral bonus this wallet was paid or can
// still claim from them. All amounts are lamport strings; only finalized records count.
const lamports = value => { try { const n = BigInt(String(value ?? '0')); return n > 0n ? n : 0n; } catch { return 0n; } };

export function referralRows({ state, wallet, network, qualified, cleanShareSource = value => value || null, entitlement }) {
  const attributions = state.referrals?.attributions || {};
  const parents = new Map(Object.values(attributions).map(row => [row.wallet, row.inviterWallet]));
  const coinsBy = new Map();
  for (const [mint, launch] of Object.entries(state.launches || {})) {
    if (!launch?.creatorWallet) continue;
    if (!coinsBy.has(launch.creatorWallet)) coinsBy.set(launch.creatorWallet, new Set());
    coinsBy.get(launch.creatorWallet).add(mint);
  }
  const paid = Object.values(state.v3ReferralPayouts || {}).filter(row => row?.recipient === wallet && row.status === 'finalized' && row.signature);
  return [...new Set(network)].filter(address => address !== wallet).map(address => {
    let parent = parents.get(address), level = 1;
    while (parent !== wallet && level < 3) { parent = parents.get(parent); level++; }
    const joined = attributions[address];
    const mints = coinsBy.get(address) || new Set();
    let fees = 0n, earned = 0n, claimable = 0n;
    for (const [source, settlement] of Object.entries(state.v3Settlements || {})) {
      if (settlement?.status !== 'finalized' || !mints.has(settlement.mint)) continue;
      // V3 settlements record the collected amount as expectedLamports.
      fees += lamports(settlement.grossCreatorFees ?? settlement.expectedLamports);
      for (let step = 1; step <= 3; step++) {
        let owed = null;
        try { owed = entitlement?.({ settlement, plan: settlement.allocationPlan, level: step }); } catch { owed = null; }
        if (owed?.recipient !== wallet) continue;
        const payout = paid.find(row => row.collectionSignature === source && row.level === step);
        if (payout) earned += lamports(payout.amount); else claimable += lamports(owed.amount);
      }
    }
    return { wallet: address, level, inviterWallet: parents.get(address) || null, qualified: qualified.has(address),
      joinedAt: joined?.capturedAt || null, source: joined?.source ? cleanShareSource(joined.source) : null,
      coinsCreated: mints.size, feesCollectedLamports: String(fees),
      bonusPaidLamports: String(earned), bonusClaimableLamports: String(claimable) };
  }).sort((a, b) => a.level - b.level || String(b.joinedAt || '').localeCompare(String(a.joinedAt || '')) || a.wallet.localeCompare(b.wallet));
}
