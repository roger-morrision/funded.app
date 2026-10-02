import { createHash } from 'node:crypto';

export const JACKPOT_PERIOD_SECONDS = 86_400;
export const CREATOR_SHARE_BPS = 100; // 1% of funded.vip's settled share.
export const TRADER_FEE_BPS = 500; // 5% of verified app trading fees.
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

export function jackpotWindow(nowSeconds) {
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) throw new Error('Invalid round time.');
  const start = Math.floor(nowSeconds / JACKPOT_PERIOD_SECONDS) * JACKPOT_PERIOD_SECONDS;
  return { start, end:start + JACKPOT_PERIOD_SECONDS, secondsRemaining:start + JACKPOT_PERIOD_SECONDS - nowSeconds };
}

function lamports(value) {
  if (!/^(?:0|[1-9]\d*)$/.test(String(value))) throw new Error('Invalid lamport amount.');
  return BigInt(value);
}

export function jackpotContribution(sourceLamports, bps) {
  if (![CREATOR_SHARE_BPS, TRADER_FEE_BPS].includes(bps)) throw new Error('Invalid jackpot rate.');
  return (lamports(sourceLamports) * BigInt(bps) / 10_000n).toString();
}

// These receipts must come from a finalized on-chain indexer, not client claims or market scans.
export function eligibleJackpotEntries(kind, receipts, window) {
  if (!['creator', 'trader'].includes(kind)) throw new Error('Invalid jackpot kind.');
  if (!window || !Number.isSafeInteger(window.start) || !Number.isSafeInteger(window.end)
    || window.start < 0 || window.end - window.start !== JACKPOT_PERIOD_SECONDS
    || window.start % JACKPOT_PERIOD_SECONDS !== 0) throw new Error('Invalid jackpot window.');
  const unique = new Map();
  for (const row of receipts || []) {
    if (!row || typeof row !== 'object') continue;
    const wallet = kind === 'creator' ? row.creatorWallet : row.traderWallet;
    const source = kind === 'creator' ? row.mint : row.signature;
    if (row.cluster !== 'devnet' || row.finalized !== true || row.onchainVerified !== true
      || !ADDRESS.test(String(wallet || ''))
      || kind === 'creator' && !ADDRESS.test(String(source || ''))
      || kind === 'trader' && !SIGNATURE.test(String(source || ''))
      || !Number.isSafeInteger(row.blockTime) || row.blockTime < window.start || row.blockTime >= window.end) continue;
    if (kind === 'trader' && (row.feeTransferVerified !== true
      || !/^[1-9]\d*$/.test(String(row.feeLamports || '')))) continue;
    const existing = unique.get(source);
    if (existing && (existing.wallet !== wallet || existing.blockTime !== row.blockTime
      || kind === 'trader' && existing.feeLamports !== String(row.feeLamports)))
      throw new Error('Conflicting finalized jackpot receipt.');
    unique.set(source, { wallet, source, blockTime:row.blockTime,
      ...(kind === 'trader' ? { feeLamports:String(row.feeLamports) } : {}) });
  }
  return [...unique.values()].sort((a, b) => a.source < b.source ? -1 : a.source > b.source ? 1 : 0)
    .map(({ wallet, source }) => ({ wallet, source }));
}

// Entropy must be public and independent of the operator, such as an audited VRF output.
// Rejection sampling avoids modulo bias. The receipt list and entropy must be published.
export function selectJackpotWinner(entries, entropyHex, roundId) {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('No eligible entries.');
  if (!/^[a-f0-9]{64}$/i.test(String(entropyHex))) throw new Error('A 32-byte public entropy proof is required.');
  if (!/^(creator|trader):\d+$/.test(String(roundId))) throw new Error('Invalid round ID.');
  const start = Number(roundId.split(':')[1]);
  if (!Number.isSafeInteger(start) || start % JACKPOT_PERIOD_SECONDS !== 0) throw new Error('Invalid round boundary.');
  const seen = new Set();
  const ordered = entries.map(entry => {
    if (!entry || !ADDRESS.test(String(entry.wallet || '')) || !entry.source
      || seen.has(entry.source)) throw new Error('Invalid or duplicate jackpot entry.');
    seen.add(entry.source);
    return entry;
  }).sort((a, b) => a.source < b.source ? -1 : a.source > b.source ? 1 : 0);
  const count = BigInt(ordered.length);
  const range = 1n << 256n;
  const limit = range - range % count;
  for (let nonce = 0; nonce < 1000; nonce += 1) {
    const hash = createHash('sha256').update(`${roundId}:${entropyHex.toLowerCase()}:${nonce}`).digest('hex');
    const number = BigInt(`0x${hash}`);
    if (number < limit) return { winner:ordered[Number(number % count)].wallet,
      selectedEntry:ordered[Number(number % count)].source, entryIndex:Number(number % count),
      entropyHex:entropyHex.toLowerCase(), nonce, drawHash:hash };
  }
  throw new Error('Public entropy could not select a winner.');
}

export function verifiedJackpotPayout({ round, proof }) {
  if (!round || !proof || round.status !== 'drawn' || round.cluster !== 'devnet'
    || !ADDRESS.test(String(round.winner || '')) || !ADDRESS.test(String(round.vault || ''))
    || !SIGNATURE.test(String(proof.signature || '')) || proof.cluster !== 'devnet'
    || proof.commitment !== 'finalized' || proof.transactionSucceeded !== true
    || proof.balanceDeltaVerified !== true || proof.from !== round.vault || proof.to !== round.winner
    || lamports(proof.amountLamports || '0') !== lamports(round.prizeLamports || '0')
    || lamports(round.prizeLamports || '0') <= 0n
    || !Number.isSafeInteger(proof.blockTime) || proof.blockTime < Number(round.windowEnd || 0))
    throw new Error('Payout has no matching finalized SOL transfer proof.');
  return { roundId:round.id, winner:round.winner, amountLamports:String(round.prizeLamports),
    signature:proof.signature, paidAt:proof.blockTime, status:'paid', cluster:'devnet' };
}

export function jackpotPreview(nowSeconds, cluster = 'devnet') {
  const window = jackpotWindow(nowSeconds);
  const common = { windowStart:window.start, windowEnd:window.end,
    secondsRemaining:window.secondsRemaining, fundedLamports:'0', entries:null,
    fundingVerified:false, payoutEnabled:false, rulesPublished:false,
    eligibilityApproved:false, status:'inactive', history:[] };
  return { cluster, mode:'devnet-prototype', generatedAt:new Date(nowSeconds * 1000).toISOString(),
    creator:{ ...common, id:`creator:${window.start}`, contributionBpsOfFundedShare:CREATOR_SHARE_BPS,
      entryRule:'One finalized verified launch per unique mint' },
    trader:{ ...common, id:`trader:${window.start}`, contributionBpsOfAppTradingFee:TRADER_FEE_BPS,
      entryRule:'One finalized verified fee-paying trade per unique signature' },
    blockers:['No prospective creator-fee allocation, dedicated jackpot vault, or finalized contribution ledger.',
      'No persistent finalized wallet-attributed trading-fee receipt index.',
      'No durable round lock, independent draw beacon, or automatic payout worker.',
      'Worldwide eligibility and paid-activity-weighted odds require legal approval.'] };
}
