import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';

export const X_POST_KINDS = Object.freeze(['launch', 'listing', 'trade_profit', 'daily_projects', 'daily_rewards']);
export const DEFAULT_BIG_PROFIT_LAMPORTS = '1000000000';
const LAMPORTS = 1_000_000_000n;
const DAY_MS = 86_400_000;
const PROOF_LIMIT_BYTES = 16_384;

function requireValue(condition, message) { if (!condition) throw new Error(message); }
function units(value, label, positive = false) {
  requireValue(typeof value === 'string' || typeof value === 'bigint' || Number.isSafeInteger(value), `${label} must be exact integer base units.`);
  const text = String(value);
  requireValue(/^(0|[1-9][0-9]{0,39})$/.test(text), `${label} must be nonnegative integer base units.`);
  const result = BigInt(text);
  requireValue(!positive || result > 0n, `${label} must be positive.`);
  return result;
}
export function formatXSol(value) {
  const amount = units(value, 'SOL amount');
  const fraction = (amount % LAMPORTS).toString().padStart(9, '0').replace(/0+$/, '');
  return `${amount / LAMPORTS}${fraction ? `.${fraction}` : ''}`;
}
function address(value, label = 'mint') {
  try { requireValue(typeof value === 'string', `${label} must be an address.`); return new PublicKey(value).toBase58(); }
  catch { throw new Error(`${label} must be a valid Solana address.`); }
}
function signature(value) {
  try { return typeof value === 'string' && value.length >= 64 && value.length <= 88 && bs58.decode(value).length === 64; }
  catch { return false; }
}

// This is deliberately conservative for Unicode (two units per non-ASCII code
// point). Every URL produced by this module is an absolute HTTPS application URL.
export function xWeightedLength(text) {
  let length = 0, offset = 0;
  const weight = value => [...value].reduce((total, character) => total + (character.codePointAt(0) <= 0x7f ? 1 : 2), 0);
  for (const match of String(text).matchAll(/https:\/\/[^\s]+/g)) {
    length += weight(text.slice(offset, match.index)) + 23;
    offset = match.index + match[0].length;
  }
  return length + weight(String(text).slice(offset));
}
export function sanitizeXLabel(value, maxWeight = 32) {
  const cleaned = String(value ?? '').slice(0, 2048).normalize('NFKC')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/[^\p{L}\p{N}\p{M} _-]/gu, ' ').replace(/\s+/g, ' ').trim() || 'Unnamed token';
  let result = '', length = 0;
  for (const character of cleaned) {
    const weight = character.codePointAt(0) <= 0x7f ? 1 : 2;
    if (length + weight > maxWeight) break;
    result += character; length += weight;
  }
  return result.trim() || 'Token';
}
function trustedOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('A trusted public HTTPS application origin is required.'); }
  requireValue(url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash,
    'A trusted public HTTPS application origin is required.');
  requireValue(/^[a-z0-9.-]+$/i.test(url.hostname) && url.hostname.includes('.') && !url.hostname.endsWith('.'), 'A public application hostname is required.');
  return url.origin;
}
function finalizedProofs(proofs, cluster) {
  requireValue(Array.isArray(proofs) && proofs.length > 0 && proofs.length <= 100_000, 'Verified finalized transaction proofs are required.');
  const unique = new Map();
  for (const proof of proofs) {
    requireValue(proof?.verified === true && proof.commitment === 'finalized' && proof.cluster === cluster
      && signature(proof.signature) && Number.isSafeInteger(proof.slot) && proof.slot > 0,
    'Every proof must be verified, finalized, and on the post cluster.');
    const row = { signature: proof.signature, slot: proof.slot, cluster, commitment: 'finalized', verified: true };
    requireValue(!unique.has(row.signature) || unique.get(row.signature).slot === row.slot, 'Conflicting finalized proof slots.');
    unique.set(row.signature, row);
  }
  return [...unique.values()].sort((a, b) => a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0);
}
function evidenceForOutbox(proofs, cluster) {
  if (Buffer.byteLength(JSON.stringify(proofs)) <= PROOF_LIMIT_BYTES) return proofs;
  // Keep a deterministic commitment to the complete validated proof set rather
  // than silently dropping evidence to fit the durable outbox's size limit.
  const range = proofs.reduce((result, proof) => ({ first: Math.min(result.first, proof.slot), last: Math.max(result.last, proof.slot) }), { first: Infinity, last: 0 });
  return [{ kind: 'finalized-proof-set', cluster, commitment: 'finalized', count: proofs.length,
    sha256: createHash('sha256').update(JSON.stringify(proofs)).digest('hex'),
    firstSlot: range.first, lastSlot: range.last, sample: proofs.slice(0, 3) }];
}
function windowLabel(payload) {
  const parse = value => {
    requireValue(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00(?:\.000)?Z$/.test(value), 'Daily windows require explicit UTC ISO timestamps.');
    const result = Date.parse(value);
    requireValue(Number.isFinite(result) && new Date(result).toISOString() === value.replace(/:00Z$/, ':00.000Z'), 'Invalid UTC window timestamp.');
    return result;
  };
  const start = parse(payload.windowStart), end = parse(payload.windowEnd);
  requireValue(Number.isFinite(start) && Number.isFinite(end) && end - start === DAY_MS && start % 60_000 === 0 && end % 60_000 === 0,
    'Daily posts require an exact, minute-aligned 24-hour window.');
  requireValue(payload.coverage === 'complete', 'Daily posts require complete verified interval coverage.');
  const label = value => new Date(value).toISOString().slice(0, 16).replace('T', ' ');
  return `${label(start)} to ${label(end)} UTC`;
}

/**
 * Format trusted collector output, never a user-submitted POST body. This module
 * validates the evidence schema and facts; the collector must reverify receipts,
 * amounts, interval completeness and consent against their authoritative sources.
 */
export function buildXPost(kind, payload, { cluster, publicOrigin = 'https://funded.vip', minProfitLamports = DEFAULT_BIG_PROFIT_LAMPORTS } = {}) {
  requireValue(X_POST_KINDS.includes(kind), 'Unsupported X post kind.');
  requireValue(['devnet', 'mainnet-beta'].includes(cluster), 'Unsupported X post cluster.');
  requireValue(payload && typeof payload === 'object', 'A verified collector payload is required.');
  const origin = trustedOrigin(publicOrigin);
  const proofs = finalizedProofs(payload.proofs, cluster);
  const prefix = cluster === 'devnet' ? '[Devnet test] ' : '[Mainnet] ';
  let makeText;
  if (kind === 'launch' || kind === 'listing' || kind === 'trade_profit') {
    const mint = address(payload.mint);
    const link = `${origin}/token/${mint}`;
    const project = budget => `“${sanitizeXLabel(payload.name || payload.symbol, budget)}”`;
    if (kind === 'launch') makeText = budget => `${prefix}Token launch: ${project(budget)}. Creation finalized.\n${link}`;
    if (kind === 'listing') {
      requireValue(payload.listingType === 'paid', 'Listing posts require a verified paid listing type.');
      makeText = budget => `${prefix}Paid listing added: ${project(budget)}. Listing payment finalized.\n${link}`;
    }
    if (kind === 'trade_profit') {
      requireValue(payload.positionClosed === true && payload.completeCostBasis === true && payload.publicConsent === true,
        'Profit posts require a closed position, complete verified cost basis, and public consent.');
      requireValue(proofs.length >= 2, 'Profit posts require distinct finalized buy and sell receipts.');
      const cost = units(payload.buyCostLamports, 'Gross buy cost', true);
      const proceeds = units(payload.sellProceedsLamports, 'Gross sell proceeds', true);
      const fees = units(payload.feesLamports, 'All attributable fees');
      const profit = proceeds - cost - fees;
      const threshold = units(minProfitLamports, 'Profit threshold', true);
      requireValue(profit >= threshold, 'Closed trade net profit is below the posting threshold.');
      makeText = budget => `${prefix}Closed trade: ${project(budget)}. Realized net profit: ${formatXSol(profit)} SOL after fees. Buy and sell finalized.\n${link}`;
    }
  } else if (kind === 'daily_projects') {
    const window = windowLabel(payload);
    const metrics = { volume_lamports: 'finalized trading volume', creator_fees_collected_lamports: 'creator fees collected', paid_rewards_lamports: 'verified rewards paid' };
    requireValue(Object.hasOwn(metrics, payload.metric), 'An explicit verified SOL ranking metric is required.');
    requireValue(Array.isArray(payload.projects) && payload.projects.length > 0, 'Verified project rows are required.');
    const seen = new Set();
    const projects = payload.projects.map(row => {
      const mint = address(row.mint);
      requireValue(!seen.has(mint), 'Ranking contains duplicate projects.'); seen.add(mint);
      return { mint, name: row.name || row.symbol, amount: units(row.amountLamports, 'Project metric', true) };
    }).sort((a, b) => a.amount === b.amount ? a.mint < b.mint ? -1 : a.mint > b.mint ? 1 : 0 : a.amount > b.amount ? -1 : 1);
    makeText = (budget, limit) => `${prefix}Top ${Math.min(limit, projects.length)}${payload.scope === 'recorded-verified-payouts' ? ' recorded projects' : ''} by ${metrics[payload.metric]} (SOL):\n${projects.slice(0, limit).map((row, index) => `${index + 1}. ${sanitizeXLabel(row.name, budget)}: ${formatXSol(row.amount)}`).join('\n')}\n${window}\n${origin}/explore`;
  } else {
    const window = windowLabel(payload);
    requireValue(Array.isArray(payload.payments) && payload.payments.length > 0, 'Verified paid reward rows are required.');
    const signatures = new Set(proofs.map(proof => proof.signature)), seenIds = new Set(), seenTransfers = new Set();
    let total = 0n, largest = 0n;
    for (const payment of payload.payments) {
      requireValue(typeof payment.id === 'string' && payment.id.length > 0 && !seenIds.has(payment.id), 'Paid reward rows require distinct IDs.');
      const recipient = address(payment.recipient, 'Reward recipient');
      const transfer = `${payment.signature}:${recipient}`;
      requireValue(!seenTransfers.has(transfer), 'A reward transfer cannot be counted twice.');
      requireValue(payment.asset === 'SOL', 'Daily SOL rewards cannot include or silently drop another asset.');
      requireValue(payment.status === 'paid' && payment.finalized === true && payment.balanceDeltaVerified === true
        && signatures.has(payment.signature), 'Daily rewards count only matching verified finalized payments.');
      seenIds.add(payment.id); seenTransfers.add(transfer);
      const amount = units(payment.amountLamports, 'Reward amount', true);
      total += amount; largest = amount > largest ? amount : largest;
    }
    makeText = () => `${prefix}${payload.scope === 'recorded-verified-payouts' ? 'Recorded rewards' : 'Rewards'} paid: ${formatXSol(total)} SOL across ${payload.payments.length} verified payment${payload.payments.length === 1 ? '' : 's'}. Largest payment: ${formatXSol(largest)} SOL.\n${window}\n${origin}/#payments`;
  }
  for (const limit of [3, 2, 1]) for (const budget of [32, 24, 16, 8]) {
    const text = makeText(budget, limit);
    const weightedLength = xWeightedLength(text);
    if (weightedLength <= 280 && Buffer.byteLength(text) <= 280) return { kind, cluster, text, weightedLength, byteLength: Buffer.byteLength(text), proofs: evidenceForOutbox(proofs, cluster) };
  }
  throw new Error('Verified facts exceed the X post length limit; amounts and interval cannot be truncated.');
}
