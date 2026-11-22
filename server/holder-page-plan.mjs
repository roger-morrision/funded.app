// Experimental planning only. The scheduler's 1,000-holder admission gate stays in place.
import { createHash } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { allocateHolderPool } from '../automatic-rewards.js';
import { buildRewardManifest } from '../reward-merkle.js';

export const HOLDER_PAGE_LIMITS = Object.freeze({ recipients:1001, pageSize:32 });
export const planDigest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const units = value => {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value) || BigInt(value) > 0xffffffffffffffffn)
    throw new Error('Expected canonical u64 base units.');
  return BigInt(value);
};

export function buildHolderPagePlan({ cycleId, asset, pool, weights, expiresAt, pageSize = 32 }) {
  if (!Array.isArray(weights) || !weights.length || weights.length > HOLDER_PAGE_LIMITS.recipients)
    throw new Error('Experimental cohort exceeds the declared 1,001-recipient bound.');
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > HOLDER_PAGE_LIMITS.pageSize)
    throw new Error('Invalid bounded page size.');
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) throw new Error('Invalid expiry.');
  const canonicalAsset = asset === 'SOL' ? 'SOL' : new PublicKey(asset).toBase58();
  const ordered = weights.map(row => {
    const weight = units(row.weight);
    if (!weight) throw new Error('Positive holder weights required.');
    const key = new PublicKey(row.wallet);
    return { wallet:key.toBase58(), key:key.toBuffer(), weight:String(weight) };
  }).sort((a, b) => Buffer.compare(a.key, b.key));
  if (new Set(ordered.map(row => row.wallet)).size !== ordered.length) throw new Error('Duplicate recipient.');
  const amount = units(pool);
  if (!amount) throw new Error('Positive pool required.');
  const allocation = allocateHolderPool(pool, ordered);
  const manifest = buildRewardManifest({ cycleId, asset:canonicalAsset, allocations:allocation.allocations });
  const pages = [];
  for (let offset = 0; offset < manifest.leaves.length; offset += pageSize) {
    const leaves = manifest.leaves.slice(offset, offset + pageSize);
    pages.push({ index:pages.length, leaves, total:String(leaves.reduce((sum, leaf) => sum + BigInt(leaf.amount), 0n)) });
  }
  const body = { version:1, mode:'experimental-offline-only', cycleId:manifest.cycleId,
    asset:canonicalAsset, root:manifest.root, pool, expiresAt, eligibleCount:weights.length,
    payableCount:manifest.leaves.length, zeroAllocationCount:weights.length - manifest.leaves.length,
    allocated:manifest.totalAmount, retainedDust:allocation.remainderLamports, pageSize, pages };
  return { ...body, digest:planDigest(body) };
}

export function assertHolderPagePlan(plan) {
  const { digest, ...body } = plan;
  if (digest !== planDigest(body) || body.mode !== 'experimental-offline-only') throw new Error('Plan integrity mismatch.');
  // Enforce admission before rebuilding a persisted tree, including counts that
  // could otherwise hide oversized leaves behind a negative zero-allocation count.
  if (body.version !== 1 || !Number.isSafeInteger(body.eligibleCount)
    || body.eligibleCount < 1 || body.eligibleCount > HOLDER_PAGE_LIMITS.recipients
    || !Number.isSafeInteger(body.payableCount) || body.payableCount < 1
    || body.payableCount > body.eligibleCount || !Number.isSafeInteger(body.zeroAllocationCount)
    || body.zeroAllocationCount < 0 || body.payableCount + body.zeroAllocationCount !== body.eligibleCount
    || !Number.isSafeInteger(body.pageSize) || body.pageSize < 1 || body.pageSize > HOLDER_PAGE_LIMITS.pageSize
    || !Array.isArray(body.pages) || body.pages.length !== Math.ceil(body.payableCount / body.pageSize)
    || body.pages.some((page, index) => page.index !== index || !Array.isArray(page.leaves)
      || page.leaves.length !== Math.min(body.pageSize, body.payableCount - index * body.pageSize)))
    throw new Error('Persisted plan exceeds bounded admission.');
  // Rebuild the commitment and validate every persisted index, amount and proof.
  const leaves = body.pages.flatMap(page => page.leaves);
  const rebuilt = buildRewardManifest({ cycleId:body.cycleId, asset:body.asset,
    allocations:leaves.map(leaf => ({ recipient:leaf.recipient, amount:leaf.amount })) });
  if (rebuilt.root !== body.root || rebuilt.totalAmount !== body.allocated
    || JSON.stringify(rebuilt.leaves) !== JSON.stringify(leaves)
    || leaves.length !== body.payableCount
    || !Number.isSafeInteger(body.expiresAt) || body.expiresAt <= 0
    || units(body.allocated) + units(body.retainedDust) !== units(body.pool)) throw new Error('Plan accounting mismatch.');
  body.pages.forEach((page, index) => {
    if (page.index !== index || !page.leaves.length || page.leaves.length > body.pageSize
      || (index < body.pages.length - 1 && page.leaves.length !== body.pageSize)
      || BigInt(page.total) !== page.leaves.reduce((sum, leaf) => sum + BigInt(leaf.amount), 0n))
      throw new Error('Invalid page boundary.');
  });
  return plan;
}
