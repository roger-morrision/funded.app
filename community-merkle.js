import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';
import { allocateHolderPool } from './automatic-rewards.js';

const DOMAIN = Buffer.from('funded-community-leaf-v1');
const SNAPSHOT_DOMAIN = Buffer.from('funded-community-snapshot-v1');
const hash = (...parts) => { const digest = createHash('sha256'); for (const part of parts) digest.update(part); return digest.digest(); };
const key = value => new PublicKey(value).toBuffer();
const u64 = value => { const out = Buffer.alloc(8); out.writeBigUInt64LE(BigInt(value)); return out; };
const u32 = value => { const out = Buffer.alloc(4); out.writeUInt32LE(Number(value)); return out; };
const hex32 = value => { if (!/^[0-9a-f]{64}$/i.test(String(value))) throw new Error('Expected a 32-byte hash.'); return Buffer.from(value, 'hex'); };
const pair = (a, b) => Buffer.compare(a, b) <= 0 ? hash(a, b) : hash(b, a);

export function communityLeaf({ drop, recipient, amount, index }) {
  return hash(DOMAIN, key(drop), key(recipient), u64(amount), u32(index));
}

export function verifyCommunityProof({ drop, recipient, amount, index, proof, root }) {
  let node = communityLeaf({ drop, recipient, amount, index });
  for (const sibling of proof || []) node = pair(node, hex32(sibling));
  return node.equals(hex32(root));
}

// The caller must obtain the account list from an independently verified
// archival view of the exact migration slot. A current RPC balance is never
// substituted for missing historical holder data.
export function buildCommunityManifest({ drop, launchMint, eligibilityMint, migrationSignature, migrationSlot, migrationBlockTime, snapshot, amountBaseUnits, excludedWallets = [] }) {
  const signature = bs58.decode(String(migrationSignature || ''));
  if (signature.length !== 64 || !Number.isSafeInteger(migrationSlot) || migrationSlot <= 0
    || !Number.isSafeInteger(migrationBlockTime) || migrationBlockTime <= 0
    || !snapshot?.finalized || snapshot.coverage !== 'finalized-exact-slot-v1'
    || snapshot.slot !== migrationSlot || snapshot.blockTime !== migrationBlockTime
    || snapshot.mint !== eligibilityMint) throw new Error('A complete finalized eligibility snapshot at the exact migration slot is required.');
  const amount = BigInt(amountBaseUnits), supply = BigInt(snapshot.supplyBaseUnits || 0);
  if (amount <= 0n || supply <= 0n || amount > 0xffffffffffffffffn || supply > 0xffffffffffffffffn) throw new Error('Invalid community allocation or eligibility supply.');
  const exclusions = [...new Set(excludedWallets.map(value => new PublicKey(value).toBase58()))].sort();
  const seen = new Set();
  const accounts = (snapshot.accounts || []).map(row => {
    const wallet = new PublicKey(row.wallet).toBase58(), balance = BigInt(row.balance);
    if (seen.has(wallet) || balance < 0n || balance > 0xffffffffffffffffn) throw new Error('Snapshot wallets must be unique with valid balances.');
    seen.add(wallet); return { wallet, balance };
  }).sort((a, b) => a.wallet.localeCompare(b.wallet));
  if (!accounts.length || accounts.reduce((sum, row) => sum + row.balance, 0n) !== supply) throw new Error('Snapshot balances do not cover the full finalized eligibility supply.');
  const weights = accounts.filter(row => row.balance > 0n && !exclusions.includes(row.wallet)).map(row => ({ wallet:row.wallet, weight:String(row.balance) }));
  const allocation = allocateHolderPool(String(amount), weights);
  if (!allocation.allocations.length) throw new Error('No eligible $FUNDED holder has a payable allocation.');
  const snapshotHash = hash(SNAPSHOT_DOMAIN, key(launchMint), key(eligibilityMint), u64(migrationSlot), u64(migrationBlockTime), u64(supply), u32(accounts.length),
    ...accounts.flatMap(row => [key(row.wallet), u64(row.balance)]), u32(exclusions.length), ...exclusions.map(key)).toString('hex');
  const leaves = allocation.allocations.map((row, index) => ({ index, recipient:row.wallet, amount:row.amountLamports,
    hash:communityLeaf({ drop, recipient:row.wallet, amount:row.amountLamports, index }) }));
  const levels = [leaves.map(row => row.hash)];
  while (levels.at(-1).length > 1) {
    const current = levels.at(-1), next = [];
    for (let index = 0; index < current.length; index += 2) next.push(index + 1 < current.length ? pair(current[index], current[index + 1]) : current[index]);
    levels.push(next);
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
  return { version:1, drop:new PublicKey(drop).toBase58(), launchMint:new PublicKey(launchMint).toBase58(), eligibilityMint:new PublicKey(eligibilityMint).toBase58(),
    migrationSignature, migrationSlot, migrationBlockTime, snapshotHash, root:levels.at(-1)[0].toString('hex'),
    totalAmount:String(amount), allocatedAmount:String(leaves.reduce((sum, row) => sum + BigInt(row.amount), 0n)),
    remainderAmount:allocation.remainderLamports, excludedWallets:exclusions, leaves };
}
