import { createHash } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';

export const REWARD_LEAF_DOMAIN = Buffer.from('funded-reward-leaf-v1');
export const SOL_ASSET_MINT = '11111111111111111111111111111111';

function hash(...parts) {
  const digest = createHash('sha256');
  parts.forEach(part => digest.update(part));
  return digest.digest();
}

function uint(value, bytes) {
  const parsed = BigInt(value);
  if (parsed < 0n || parsed >= 1n << BigInt(bytes * 8)) throw new Error(`Value does not fit in ${bytes} bytes.`);
  const output = Buffer.alloc(8);
  output.writeBigUInt64LE(parsed, 0);
  return output.subarray(0, bytes);
}

function bytes32(value, label) {
  if (Buffer.isBuffer(value) && value.length === 32) return value;
  if (value instanceof Uint8Array && value.length === 32) return Buffer.from(value);
  if (typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value)) return Buffer.from(value, 'hex');
  throw new Error(`${label} must be 32 bytes or a 64-character hex string.`);
}

function publicKeyBytes(value, label) {
  try { return new PublicKey(value).toBuffer(); }
  catch { throw new Error(`${label} must be a valid Solana address.`); }
}

export function rewardLeaf({ cycleId, recipient, asset = 'SOL', amount, index }) {
  const assetMint = asset === 'SOL' ? SOL_ASSET_MINT : asset;
  return hash(REWARD_LEAF_DOMAIN, bytes32(cycleId, 'cycleId'), publicKeyBytes(recipient, 'recipient'), publicKeyBytes(assetMint, 'asset'), uint(amount, 8), uint(index, 4));
}

function pairHash(left, right) {
  return Buffer.compare(left, right) <= 0 ? hash(left, right) : hash(right, left);
}

export function createRewardCycleId({ mint, kind, asset, periodStart, periodEnd }) {
  if (!Number.isSafeInteger(periodStart) || !Number.isSafeInteger(periodEnd) || periodEnd <= periodStart) throw new Error('Invalid reward cycle period.');
  return hash(Buffer.from('funded-reward-cycle-v1'), publicKeyBytes(mint, 'mint'), Buffer.from(String(kind)), Buffer.from(String(asset)), uint(periodStart, 8), uint(periodEnd, 8)).toString('hex');
}

export function buildRewardManifest({ cycleId, asset = 'SOL', allocations }) {
  if (!Array.isArray(allocations) || allocations.length === 0) throw new Error('At least one reward allocation is required.');
  const seen = new Set();
  const leaves = allocations.map((row, index) => {
    const recipient = new PublicKey(row.recipient || row.wallet).toBase58();
    if (seen.has(recipient)) throw new Error('A reward manifest may contain only one leaf per recipient.');
    seen.add(recipient);
    const amount = String(row.amount ?? row.amountLamports ?? '');
    if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n) throw new Error('Reward amounts must be positive integer strings.');
    return { index, recipient, amount, hash: rewardLeaf({ cycleId, recipient, asset, amount, index }) };
  });
  let level = leaves.map(row => row.hash);
  const levels = [level];
  while (level.length > 1) {
    const next = [];
    for (let index = 0; index < level.length; index += 2) next.push(index + 1 < level.length ? pairHash(level[index], level[index + 1]) : level[index]);
    levels.push(next); level = next;
  }
  for (const leaf of leaves) {
    let position = leaf.index;
    leaf.proof = [];
    for (let depth = 0; depth < levels.length - 1; depth += 1) {
      const sibling = position % 2 === 0 ? position + 1 : position - 1;
      if (sibling < levels[depth].length) leaf.proof.push(levels[depth][sibling].toString('hex'));
      position = Math.floor(position / 2);
    }
    leaf.hash = leaf.hash.toString('hex');
  }
  return {
    version: 1,
    cycleId: bytes32(cycleId, 'cycleId').toString('hex'),
    asset,
    root: levels.at(-1)[0].toString('hex'),
    totalAmount: String(leaves.reduce((sum, row) => sum + BigInt(row.amount), 0n)),
    leaves,
  };
}

export function verifyRewardProof({ cycleId, asset = 'SOL', recipient, amount, index, proof, root }) {
  let node = rewardLeaf({ cycleId, asset, recipient, amount, index });
  for (const sibling of proof || []) node = pairHash(node, bytes32(sibling, 'proof node'));
  return node.equals(bytes32(root, 'root'));
}
