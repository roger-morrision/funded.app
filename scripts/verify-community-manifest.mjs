import assert from 'node:assert/strict';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';
import { buildCommunityManifest, verifyCommunityProof } from '../community-merkle.js';

const [drop, launchMint, eligibilityMint, a, b, excluded] = Array.from({ length:6 }, () => Keypair.generate().publicKey.toBase58());
const migrationSignature = bs58.encode(Buffer.alloc(64, 7));
const snapshot = { mint:eligibilityMint, slot:1234, blockTime:1_800_000_000, finalized:true, coverage:'finalized-exact-slot-v1',
  supplyBaseUnits:'100', accounts:[{ wallet:a, balance:'30' }, { wallet:b, balance:'50' }, { wallet:excluded, balance:'20' }] };
const input = { drop, launchMint, eligibilityMint, migrationSignature, migrationSlot:1234, migrationBlockTime:1_800_000_000,
  snapshot, amountBaseUnits:'1000', excludedWallets:[excluded] };
const manifest = buildCommunityManifest(input);
assert.equal(manifest.totalAmount, '1000');
assert.equal(manifest.allocatedAmount, '1000');
assert.equal(manifest.leaves.length, 2);
assert(manifest.leaves.every(leaf => verifyCommunityProof({ drop, recipient:leaf.recipient, amount:leaf.amount, index:leaf.index, proof:leaf.proof, root:manifest.root })));
assert.equal(verifyCommunityProof({ drop, recipient:excluded, amount:'250', index:0, proof:manifest.leaves[0].proof, root:manifest.root }), false);
assert.equal(verifyCommunityProof({ drop, recipient:manifest.leaves[0].recipient, amount:'1', index:0, proof:manifest.leaves[0].proof, root:manifest.root }), false);
assert.throws(() => buildCommunityManifest({ ...input, snapshot:{ ...snapshot, slot:1235 } }), /exact migration slot/);
assert.throws(() => buildCommunityManifest({ ...input, snapshot:{ ...snapshot, coverage:'finalized-sampled-v1' } }), /exact migration slot/);
assert.throws(() => buildCommunityManifest({ ...input, snapshot:{ ...snapshot, supplyBaseUnits:'101' } }), /full finalized eligibility supply/);
assert.throws(() => buildCommunityManifest({ ...input, snapshot:{ ...snapshot, accounts:[...snapshot.accounts, snapshot.accounts[0]] } }), /unique/);
assert.throws(() => buildCommunityManifest({ ...input, migrationSignature:'bad' }), /exact migration slot/);
console.log('Exact-slot community manifest, exclusions, full-supply coverage, and Merkle proof checks passed (deterministic fixture).');
