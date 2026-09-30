import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { buildCommunityManifest } from '../community-merkle.js';
import { buildCommunityClaimInstruction, buildCommunityInitializeInstruction, communityAddresses } from '../server/community-claim-chain.mjs';

const key = () => Keypair.generate().publicKey.toBase58();
const programId = key(), authority = key(), creator = key(), mint = key(), eligibilityMint = key(), holder = key();
const drop = communityAddresses({ programId, authority, mint }).drop.toBase58();
const snapshot = { mint:eligibilityMint, finalized:true, coverage:'finalized-exact-slot-v1', slot:12345,
  blockTime:1_800_000_000, supplyBaseUnits:'100', accounts:[{ wallet:holder, balance:'100' }] };
const manifest = buildCommunityManifest({ drop, launchMint:mint, eligibilityMint,
  migrationSignature:bs58.encode(Buffer.alloc(64, 9)), migrationSlot:12345,
  migrationBlockTime:1_800_000_000, snapshot, amountBaseUnits:'1000' });

test('builds the escrow initialization instruction with exact on-chain account order', () => {
  const { instruction, sourceToken, dropToken } = buildCommunityInitializeInstruction({ programId, authority, creator, mint,
    eligibilityMint, tokenProgram:TOKEN_PROGRAM_ID, manifest, sourceVaultBalance:'1000' });
  assert.equal(instruction.keys.length, 13);
  assert.deepEqual(instruction.keys.slice(0, 5).map(row => row.pubkey.toBase58()), [authority, creator, authority, mint, eligibilityMint]);
  assert.equal(instruction.keys[6].pubkey.toBase58(), sourceToken);
  assert.equal(instruction.keys[8].pubkey.toBase58(), dropToken);
  assert.equal(instruction.data.subarray(0, 8).toString('hex'), createHash('sha256').update('global:initialize_community_drop_from_reward_vault').digest('hex').slice(0, 16));
  assert.equal(instruction.data.readBigUInt64LE(8 + 32 + 32 + 64), 12345n);
  assert.equal(instruction.data.readBigUInt64LE(8 + 32 + 32 + 64 + 8 + 8 + 8), 1000n);
});

test('rejects underfunded or tampered manifests and builds a valid claim', () => {
  assert.throws(() => buildCommunityInitializeInstruction({ programId, authority, creator, mint,
    eligibilityMint, tokenProgram:TOKEN_PROGRAM_ID, manifest, sourceVaultBalance:'999' }), /fully funded/);
  assert.throws(() => buildCommunityInitializeInstruction({ programId, authority, creator, mint,
    eligibilityMint, tokenProgram:TOKEN_PROGRAM_ID, manifest:{ ...manifest, root:'00'.repeat(32) }, sourceVaultBalance:'1000' }), /invalid Merkle proof/);
  const claim = buildCommunityClaimInstruction({ programId, authority, mint, tokenProgram:TOKEN_PROGRAM_ID,
    manifest, recipient:holder, payer:creator });
  assert.equal(claim.instruction.keys.length, 9);
  assert.equal(claim.amount, '1000');
  assert.equal(claim.instruction.keys[2].pubkey.toBase58(), holder);
  assert.equal(claim.instruction.data.readUInt32LE(8 + 8 + 4), 0);
});
