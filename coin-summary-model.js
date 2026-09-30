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

function card(id, label, icon, unit, amount, state, note) {
  return { id, label, icon, unit, amount, state, note };
}

export function buildCoinSummary({ mint, cluster, launch, ledgerMint, overview, market, solUsd, tokenSpotSol }) {
  if (!mint || launch?.mint !== mint || launch.cluster !== cluster || launch.onchainVerified !== true) {
    return { visible: false, cards: [] };
  }

  const feeReady = ledgerMint === mint && overview?.available === true;
  const receivers = new Map(feeReady ? (overview.receivers || []).map(row => [row.id, row]) : []);
  const feeNote = feeReady
    ? `${Number(overview.collectionCount) || 0} recorded mint-attributed collection${Number(overview.collectionCount) === 1 ? '' : 's'}`
    : 'Mint-verified fee ledger unavailable';
  const feeUsd = value => toUsd(feeReady ? solFromLamports(value) : null, solUsd);
  const feeCard = (id, label, icon, value, note) => {
    const amount = feeUsd(value);
    return card(id, label, icon, 'USD', amount, amount == null ? 'unavailable' : amount > 0 ? 'available' : 'empty', amount == null
      ? feeReady ? 'Current SOL/USD quote unavailable' : 'Mint-verified fee ledger unavailable'
      : `${note} · ${feeNote}`);
  };

  const cards = [feeCard('fees', 'Fees collected', '◇', overview?.collectedLamports, 'Collected from Pump')];
  const shares = launch.feeDistribution?.creatorDirected?.shares || {};
  const holders = receivers.get('holders');
  const x = receivers.get('x');
  if (Number(shares.holderAirdropPercent) > 0 || Number(holders?.allocatedLamports) > 0) {
    cards.push(feeCard('holders', 'Holder rewards allocated', '◉', holders?.allocatedLamports, 'Allocation, not a paid reward'));
  }
  if (Number(shares.solClaimPercent) > 0 || Number(x?.allocatedLamports) > 0) {
    cards.push(feeCard('x', 'X rewards allocated', '𝕏', x?.allocatedLamports, 'Allocation, not a paid reward'));
  }
  cards.push(feeCard('buyback', 'Buyback allocation', '↺', receivers.get('buyback')?.allocatedLamports, 'Reserved for buyback, not burned'));
  cards.push(feeCard('community', 'Community fee reserve', '✧', receivers.get('community')?.allocatedLamports, 'Includes redirected referral shares'));

  const referralRows = ['referral-1', 'referral-2', 'referral-3'].map(id => receivers.get(id)).filter(Boolean);
  const paidLamports = feeReady && referralRows.length === 3 && referralRows.every(row => solFromLamports(row.confirmedPaidLamports) != null)
    ? referralRows.reduce((sum, row) => sum + BigInt(row.confirmedPaidLamports), 0n).toString() : null;
  const referralReceipts = new Set(referralRows
    .filter(row => (solFromLamports(row.confirmedPaidLamports) || 0) > 0)
    .flatMap(row => row.payoutSignatures || [])).size;
  cards.push(feeCard('referrals', 'Referral rewards paid', '♧', paidLamports,
    `${referralReceipts} verified payout receipt${referralReceipts === 1 ? '' : 's'}`));

  const reserved = Number(launch.communityAirdrop?.reservedTokens);
  if (Number.isFinite(reserved) && reserved > 0) {
    const amount = toUsd(Number.isFinite(tokenSpotSol) && tokenSpotSol > 0 ? reserved * tokenSpotSol : null, solUsd);
    cards.push(card('airdrop', 'Indicative airdrop allocation', '◈', 'USD', amount,
      amount == null ? 'unavailable' : 'partial', amount == null
        ? 'Published token reserve · spot price or USD quote unavailable'
        : `${reserved.toLocaleString()} tokens at current spot · vault funding unverified`));
  }

  const burn = launch.creatorLaunchBurn;
  const burnedTokens = Number(burn?.receipt?.amountTokens ?? burn?.amountTokens);
  if (burn?.status === 'verified' && burn.receipt?.signature && Number.isFinite(burnedTokens) && burnedTokens > 0) {
    cards.push(card('burn', '$FUNDED burned at launch', '♨', '$FUNDED', burnedTokens, 'available', 'Verified launch burn receipt'));
  }

  const volumeSol = market?.volume24hSol == null ? null : Number(market.volume24hSol);
  const volumeReady = ['complete', 'partial'].includes(market?.coverage)
    && (!market?.graduated || Number(market.poolTradeCount24h) > 0);
  const volumeUsd = toUsd(volumeReady ? volumeSol : null, solUsd);
  cards.push(card('volume', 'Trading volume · 24h', '⌁', 'USD', volumeUsd,
    volumeUsd == null ? 'unavailable' : market.coverage === 'partial' ? 'partial' : volumeUsd > 0 ? 'available' : 'empty',
    volumeUsd == null ? 'Verified trade scan or SOL/USD quote unavailable'
      : `Confirmed ${market.graduated ? 'curve and pool' : 'curve'} trades${market.coverage === 'partial' ? ' · partial RPC scan' : ''}`));

  return { visible: true, cards };
}
