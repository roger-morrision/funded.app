import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { rewardAddresses } from './automatic-reward-chain.mjs';
import { verifyCommunityProof } from '../community-merkle.js';

const DROP_SEED = Buffer.from('community-drop-v1');
const PAYMENT_SEED = Buffer.from('community-pay-v1');
const ROUTER_SEED = Buffer.from('funded-fee-router-v1');
const digest = name => createHash('sha256').update(name).digest().subarray(0, 8);
const u64 = value => { const data = Buffer.alloc(8); data.writeBigUInt64LE(BigInt(value)); return data; };
const i64 = value => { const data = Buffer.alloc(8); data.writeBigInt64LE(BigInt(value)); return data; };
const u32 = value => { const data = Buffer.alloc(4); data.writeUInt32LE(Number(value)); return data; };
const hex32 = (value, name) => {
  if (!/^[a-f0-9]{64}$/i.test(String(value))) throw new Error(`${name} must be a 32-byte hex value.`);
  return Buffer.from(value, 'hex');
};
const address = value => new PublicKey(value).toBase58();

export function communityAddresses({ programId, authority, mint, recipient }) {
  const program = new PublicKey(programId), issuer = new PublicKey(authority), asset = new PublicKey(mint);
  const [drop] = PublicKey.findProgramAddressSync([DROP_SEED, issuer.toBuffer(), asset.toBuffer()], program);
  const result = { drop };
  if (recipient) [result.payment] = PublicKey.findProgramAddressSync([PAYMENT_SEED, drop.toBuffer(), new PublicKey(recipient).toBuffer()], program);
  return result;
}

export function buildCommunityInitializeInstruction({ programId, authority, creator, mint, eligibilityMint, tokenProgram,
  manifest, sourceVaultBalance }) {
  const program = new PublicKey(programId), issuer = new PublicKey(authority), creatorKey = new PublicKey(creator), asset = new PublicKey(mint);
  const eligible = new PublicKey(eligibilityMint), token = new PublicKey(tokenProgram);
  if (!token.equals(TOKEN_PROGRAM_ID) && !token.equals(TOKEN_2022_PROGRAM_ID)) throw new Error('Unsupported claim token program.');
  const { drop } = communityAddresses({ programId:program, authority:issuer, mint:asset });
  const { vault } = rewardAddresses({ programId:program, authority:issuer, mint:asset });
  if (manifest.drop !== drop.toBase58() || manifest.launchMint !== asset.toBase58() || manifest.eligibilityMint !== eligible.toBase58()
    || manifest.migrationSlot !== manifest.snapshotSlot && manifest.snapshotSlot !== undefined
    || !Array.isArray(manifest.leaves) || manifest.leaves.length < 1 || manifest.leaves.length > 0xffffffff
    || BigInt(manifest.allocatedAmount) !== BigInt(manifest.totalAmount)
    || BigInt(sourceVaultBalance) !== BigInt(manifest.totalAmount)) {
    throw new Error('Community manifest does not match the fully funded launch reserve and exact migration slot.');
  }
  const signature = bs58.decode(manifest.migrationSignature);
  if (signature.length !== 64 || !Number.isSafeInteger(manifest.migrationSlot) || manifest.migrationSlot <= 0
    || !Number.isSafeInteger(manifest.migrationBlockTime) || manifest.migrationBlockTime <= 0) {
    throw new Error('Manifest lacks finalized migration identity.');
  }
  const root = hex32(manifest.root, 'Merkle root'), snapshotHash = hex32(manifest.snapshotHash, 'Snapshot hash');
  for (const leaf of manifest.leaves) {
    if (!verifyCommunityProof({ drop:drop.toBase58(), recipient:leaf.recipient, amount:leaf.amount,
      index:leaf.index, proof:leaf.proof, root:manifest.root })) throw new Error('Community manifest contains an invalid Merkle proof.');
  }
  const [router] = PublicKey.findProgramAddressSync([ROUTER_SEED], program);
  const sourceToken = getAssociatedTokenAddressSync(asset, vault, true, token);
  const dropToken = getAssociatedTokenAddressSync(asset, drop, true, token);
  const data = Buffer.concat([digest('global:initialize_community_drop_from_reward_vault'), root, snapshotHash, signature,
    u64(manifest.migrationSlot), u64(manifest.migrationSlot), i64(manifest.migrationBlockTime),
    u64(manifest.totalAmount), u32(manifest.leaves.length)]);
  const keys = [
    { pubkey:issuer, isSigner:true, isWritable:true },
    { pubkey:creatorKey, isSigner:false, isWritable:false },
    { pubkey:issuer, isSigner:false, isWritable:false },
    { pubkey:asset, isSigner:false, isWritable:false },
    { pubkey:eligible, isSigner:false, isWritable:false },
    { pubkey:vault, isSigner:false, isWritable:false },
    { pubkey:sourceToken, isSigner:false, isWritable:true },
    { pubkey:drop, isSigner:false, isWritable:true },
    { pubkey:dropToken, isSigner:false, isWritable:true },
    { pubkey:router, isSigner:false, isWritable:false },
    { pubkey:token, isSigner:false, isWritable:false },
    { pubkey:ASSOCIATED_TOKEN_PROGRAM_ID, isSigner:false, isWritable:false },
    { pubkey:SystemProgram.programId, isSigner:false, isWritable:false },
  ];
  return { instruction:new TransactionInstruction({ programId:program, keys, data }), drop:drop.toBase58(),
    sourceToken:sourceToken.toBase58(), dropToken:dropToken.toBase58() };
}

export function buildCommunityClaimInstruction({ programId, authority, mint, tokenProgram, manifest, recipient, payer }) {
  const program = new PublicKey(programId), asset = new PublicKey(mint), token = new PublicKey(tokenProgram);
  const wallet = address(recipient);
  const leaf = manifest.leaves?.find(row => row.recipient === wallet);
  if (!leaf || !verifyCommunityProof({ drop:manifest.drop, recipient:wallet, amount:leaf.amount,
    index:leaf.index, proof:leaf.proof, root:manifest.root })) throw new Error('Recipient has no valid published community proof.');
  const { drop, payment } = communityAddresses({ programId:program, authority, mint:asset, recipient:wallet });
  if (drop.toBase58() !== manifest.drop) throw new Error('Manifest does not belong to the current drop PDA.');
  const vaultToken = getAssociatedTokenAddressSync(asset, drop, true, token);
  const recipientToken = getAssociatedTokenAddressSync(asset, new PublicKey(wallet), false, token);
  const proof = Buffer.concat(leaf.proof.map(node => hex32(node, 'Proof node')));
  const data = Buffer.concat([digest('global:claim_community_drop'), u64(leaf.amount), u32(leaf.index), u32(leaf.proof.length), proof]);
  const keys = [
    { pubkey:new PublicKey(payer), isSigner:true, isWritable:true },
    { pubkey:drop, isSigner:false, isWritable:true },
    { pubkey:new PublicKey(wallet), isSigner:false, isWritable:false },
    { pubkey:asset, isSigner:false, isWritable:false },
    { pubkey:vaultToken, isSigner:false, isWritable:true },
    { pubkey:recipientToken, isSigner:false, isWritable:true },
    { pubkey:payment, isSigner:false, isWritable:true },
    { pubkey:token, isSigner:false, isWritable:false },
    { pubkey:SystemProgram.programId, isSigner:false, isWritable:false },
  ];
  return { instruction:new TransactionInstruction({ programId:program, keys, data }), payment:payment.toBase58(),
    recipientToken:recipientToken.toBase58(), vaultToken:vaultToken.toBase58(), amount:leaf.amount };
}
