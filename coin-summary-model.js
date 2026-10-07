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
    ? `${Number(overview.collectionCount) || 0} recorded fee collection${Number(overview.collectionCount) === 1 ? '' : 's'}`
    : 'Fee history unavailable';
  const feeUsd = value => toUsd(feeReady ? solFromLamports(value) : null, solUsd);
  const feeCard = (id, label, icon, value, note) => {
    const amount = feeUsd(value);
    return card(id, label, icon, 'USD', amount, amount == null ? 'unavailable' : amount > 0 ? 'available' : 'empty', amount == null
      ? feeReady ? 'Current SOL price unavailable' : 'Fee history unavailable'
      : `${note} · ${feeNote}`);
  };

  const cards = [feeCard('fees', 'Fees collected', '◇', overview?.collectedLamports, 'Creator fees')];
  const shares = launch.feeDistribution?.creatorDirected?.shares || {};
  const holders = receivers.get('holders');
  const x = receivers.get('x');
  if (Number(shares.holderAirdropPercent) > 0 || Number(holders?.allocatedLamports) > 0) {
    cards.push(feeCard('holders', 'Set aside for holders', '◉', holders?.allocatedLamports, 'Allocated, not yet paid'));
  }
  if (Number(shares.solClaimPercent) > 0 || Number(x?.allocatedLamports) > 0) {
    cards.push(feeCard('x', 'Set aside for X rewards', '𝕏', x?.allocatedLamports, 'Allocated, not yet paid'));
  }
  cards.push(feeCard('buyback', 'Set aside for buybacks', '↺', receivers.get('buyback')?.allocatedLamports, 'Allocated, not yet burned'));
  cards.push(feeCard('community', 'Community fund', '✧', receivers.get('community')?.allocatedLamports, 'Includes unused referral shares'));

  const referralRows = ['referral-1', 'referral-2', 'referral-3'].map(id => receivers.get(id)).filter(Boolean);
  const paidLamports = feeReady && referralRows.length === 3 && referralRows.every(row => solFromLamports(row.confirmedPaidLamports) != null)
    ? referralRows.reduce((sum, row) => sum + BigInt(row.confirmedPaidLamports), 0n).toString() : null;
  const referralReceipts = new Set(referralRows
    .filter(row => (solFromLamports(row.confirmedPaidLamports) || 0) > 0)
    .flatMap(row => row.payoutSignatures || [])).size;
  cards.push(feeCard('referrals', 'Referral rewards paid', '♧', paidLamports,
    `${referralReceipts} confirmed payment${referralReceipts === 1 ? '' : 's'}`));

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
