const LAMPORTS_PER_SOL = 1_000_000_000;

function solFromLamports(value) {
  try {
    const amount = BigInt(value);
    return amount >= 0n && amount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) / LAMPORTS_PER_SOL : null;
  } catch { return null; }
}

function toUsd(sol, solUsd) {
  if (!Number.isFinite(sol) || sol < 0 || !Number.isFinite(solUsd) || solUsd <= 0) return null;
  const amount = sol * solUsd;
  return Number.isFinite(amount) ? amount : null;
}

function sumLamports(values) {
  let total = 0n;
  for (const value of values) {
    if (!/^(?:0|[1-9]\d*)$/.test(String(value))) return null;
    total += BigInt(value);
    if (total > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  }
  return total.toString();
}

function v3OverviewAmounts(mint, overview) {
  if (overview?.scope !== 'per-mint-v3' || !Array.isArray(overview.collections)) return null;
  const rows = overview.collections;
  const settled = rows.filter(row => row.settlement === 'finalized');
  const plansVerified = settled.every(row => row.allocationPlan?.status === 'allocated-not-funded'
    && row.allocationPlan?.mint === mint
    && row.allocationPlan?.sourceCollectionSignature === row.signature
    && row.allocationPlan?.grossLamports === row.amountLamports);
  const allocated = pick => plansVerified ? sumLamports(settled.map(row => pick(row.allocationPlan))) : null;
  return { collectionCount:rows.length,
    collectedLamports:sumLamports(rows.map(row => row.amountLamports)),
    holderLamports:allocated(plan => plan.creatorDirected?.holderLamports),
    xLamports:allocated(plan => plan.creatorDirected?.xLamports),
    buybackLamports:allocated(plan => plan.protocol?.buybackLamports),
    communityLamports:allocated(plan => plan.protocol?.communityLamports) };
}

function card(id, label, icon, unit, amount, state, note) {
  return { id, label, icon, unit, amount, state, note };
}

export function buildCoinSummary({ mint, cluster, launch, ledgerMint, overview, market, solUsd, tokenSpotSol }) {
  if (!mint || launch?.mint !== mint || launch.cluster !== cluster || launch.onchainVerified !== true) {
    return { visible: false, cards: [] };
  }

  const feeReady = ledgerMint === mint && overview?.available === true;
  const v3 = feeReady ? v3OverviewAmounts(mint, overview) : null;
  const receivers = new Map(feeReady ? (overview.receivers || []).map(row => [row.id, row]) : []);
  const collectionCount = v3?.collectionCount ?? overview?.collectionCount;
  const feeNote = feeReady
    ? `${Number(collectionCount) || 0} recorded fee collection${Number(collectionCount) === 1 ? '' : 's'}`
    : 'Fee history unavailable';
  const feeUsd = value => toUsd(feeReady ? solFromLamports(value) : null, solUsd);
  const feeCard = (id, label, icon, value, note, unavailableNote = 'Verified amount unavailable') => {
    const amount = feeUsd(value);
    return card(id, label, icon, 'USD', amount, amount == null ? 'unavailable' : amount > 0 ? 'available' : 'empty', amount == null
      ? !feeReady ? 'Fee history unavailable'
        : !Number.isFinite(solUsd) || solUsd <= 0 ? 'Current SOL price unavailable' : unavailableNote
      : `${note} · ${feeNote}`);
  };

  const cards = [feeCard('fees', 'Fees collected', '◇', v3?.collectedLamports ?? overview?.collectedLamports, 'Creator fees')];
  const shares = launch.feeDistribution?.creatorDirected?.shares || {};
  const holders = receivers.get('holders');
  const x = receivers.get('x');
  if (Number(shares.holderAirdropPercent) > 0 || Number(holders?.allocatedLamports) > 0) {
    cards.push(feeCard('holders', 'Allocated to holders', '◉', v3?.holderLamports ?? holders?.allocatedLamports, 'Total fee allocation; check payment history'));
  }
  if (Number(shares.solClaimPercent) > 0 || Number(x?.allocatedLamports) > 0) {
    cards.push(feeCard('x', 'Allocated to X rewards', '𝕏', v3?.xLamports ?? x?.allocatedLamports, 'Total fee allocation; check payment history'));
  }
  cards.push(feeCard('buyback', 'Allocated to buybacks', '↺', v3?.buybackLamports ?? receivers.get('buyback')?.allocatedLamports, 'Total fee allocation; see Buy & burn receipts'));
  cards.push(feeCard('community', 'Community fund', '✧', v3?.communityLamports ?? receivers.get('community')?.allocatedLamports,
    v3 ? 'Base allocation; check Rewards for rollovers' : 'Includes unused referral shares'));

  const referralRows = ['referral-1', 'referral-2', 'referral-3'].map(id => receivers.get(id)).filter(Boolean);
  const paidLamports = feeReady && referralRows.length === 3 && referralRows.every(row => solFromLamports(row.confirmedPaidLamports) != null)
    ? referralRows.reduce((sum, row) => sum + BigInt(row.confirmedPaidLamports), 0n).toString() : null;
  const referralReceipts = new Set(referralRows
    .filter(row => (solFromLamports(row.confirmedPaidLamports) || 0) > 0)
    .flatMap(row => row.payoutSignatures || [])).size;
  cards.push(feeCard('referrals', 'Referral rewards paid', '♧', v3 ? null : paidLamports,
    `${referralReceipts} confirmed payment${referralReceipts === 1 ? '' : 's'}`,
    v3 ? 'See Rewards for verified referral payouts' : 'Verified amount unavailable'));

  const reserved = Number(launch.communityAirdrop?.reservedTokens);
  if (Number.isFinite(reserved) && reserved > 0) {
    const amount = toUsd(Number.isFinite(tokenSpotSol) && tokenSpotSol > 0 ? reserved * tokenSpotSol : null, solUsd);
    cards.push(card('airdrop', 'Estimated airdrop value', '◈', 'USD', amount,
      amount == null ? 'unavailable' : 'partial', amount == null
        ? 'Current price unavailable; check funding on Airdrops'
        : `${reserved.toLocaleString()} planned tokens at current price · check funding on Airdrops`));
  }

  const burn = launch.creatorLaunchBurn;
  const burnedTokens = Number(burn?.receipt?.amountTokens ?? burn?.amountTokens);
  if (burn?.status === 'verified' && burn.receipt?.signature && Number.isFinite(burnedTokens) && burnedTokens > 0) {
    cards.push(card('burn', '$FUNDED burned at launch', '♨', '$FUNDED', burnedTokens, 'available', 'Confirmed launch burn'));
  }

  const volumeSol = market?.volume24hSol == null ? null : Number(market.volume24hSol);
  const volumeReady = ['complete', 'partial'].includes(market?.coverage)
    && (!market?.graduated || Number(market.poolTradeCount24h) > 0);
  const volumeUsd = toUsd(volumeReady ? volumeSol : null, solUsd);
  cards.push(card('volume', 'Trading volume · 24h', '⌁', 'USD', volumeUsd,
    volumeUsd == null ? 'unavailable' : market.coverage === 'partial' ? 'partial' : volumeUsd > 0 ? 'available' : 'empty',
    volumeUsd == null ? 'Trade history or current price unavailable'
      : `Confirmed trades${market.coverage === 'partial' ? ' · some history may be missing' : ''}`));

  return { visible: true, cards };
}
