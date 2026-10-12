import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { PROTOCOL_FEE_SPLIT } from './config/protocol-fee-split.js';
import { validateProtocolFeeSplit } from './distribution-policy.js';
import { deriveFeeRouter, FEE_ROUTER_POLICY_HASH_HEX } from './fee-router.js';

const MINT_ROUTER_V3_SEED = Buffer.from('funded-mint-router-v3');
const MINT_POLICY_V3_SEED = Buffer.from('mint-fee-policy-v3');
const MINT_VAULT_V3_SEED = Buffer.from('mint-fee-vault-v3');
const MINT_CLAIM_V3_SEED = Buffer.from('mint-fee-claim-v3');
const discriminator = name => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
const key = value => new PublicKey(value);

export function protocolGrossUnits(split = PROTOCOL_FEE_SPLIT) {
  const checked = validateProtocolFeeSplit(split);
  const rates = [checked.operationsPercent, ...checked.referralLevelPercents,
    checked.communityPercent, checked.buybackPercent];
  // One percent of the protocol's fixed 20% is 20,000 ten-millionths of gross fees.
  const units = rates.map(rate => Math.round(rate * 20_000));
  if (rates.some((rate, index) => Math.abs(rate * 20_000 - units[index]) > 0.000001)
    || units.reduce((sum, rate) => sum + rate, 0) !== 2_000_000) {
    throw new Error('Protocol fee rates cannot be represented in whole gross-fee units.');
  }
  return units;
}

export function deriveMintRouterV3(programId, mint) {
  const program = key(programId);
  const mintKey = key(mint);
  const [address, bump] = PublicKey.findProgramAddressSync([MINT_ROUTER_V3_SEED, mintKey.toBuffer()], program);
  return { address, bump, programId: program, mint: mintKey };
}

export function deriveMintPolicyV3(programId, mint) {
  const [address, bump] = PublicKey.findProgramAddressSync([MINT_POLICY_V3_SEED, key(mint).toBuffer()], key(programId));
  return { address, bump };
}

export function deriveMintVaultsV3(programId, mint) {
  return Array.from({ length: 7 }, (_, index) => PublicKey.findProgramAddressSync(
    [MINT_VAULT_V3_SEED, key(mint).toBuffer(), Buffer.from([index])], key(programId))[0]);
}

export function deriveMintClaimV3(programId, mint, claimId) {
  const bytes = Buffer.from(claimId);
  if (bytes.length !== 32) throw new Error('V3 claim ID must be 32 bytes.');
  return PublicKey.findProgramAddressSync([MINT_CLAIM_V3_SEED, key(mint).toBuffer(), bytes], key(programId))[0];
}

export async function verifyMintRouterV3Account({ connection, programId, mint, initialAuthority }) {
  const router = deriveMintRouterV3(programId, mint);
  const account = await connection.getAccountInfo(router.address, 'finalized');
  if (!account?.owner?.equals(router.programId)) return { ...router, verified:false, reason:'v3-router-owner-or-account-mismatch' };
  const data = Buffer.from(account.data);
  const valid = data.length === 106 && data.subarray(0, 8).toString('ascii') === 'FUNDMNT3'
    && data[8] === 3 && data.subarray(9, 41).equals(Buffer.from(FEE_ROUTER_POLICY_HASH_HEX, 'hex'))
    && data.subarray(41, 73).equals(key(initialAuthority).toBuffer())
    && data.subarray(73, 105).equals(router.mint.toBuffer()) && data[105] === router.bump;
  return { ...router, verified:valid, reason:valid ? 'verified' : 'v3-router-header-mismatch' };
}

export async function verifyMintPolicyV3Account({ connection, programId, mint, creator, initialAuthority, split = null }) {
  const address = deriveMintPolicyV3(programId, mint);
  const account = await connection.getAccountInfo(address.address, 'finalized');
  if (!account?.owner?.equals(key(programId))) return { ...address, verified:false, reason:'v3-policy-owner-or-account-mismatch' };
  const data = Buffer.from(account.data);
  const accountDiscriminator = createHash('sha256').update('account:MintFeePolicyV3').digest().subarray(0, 8);
  if (data.length !== 193 || !data.subarray(0, 8).equals(accountDiscriminator)
    || !data.subarray(8, 40).equals(key(mint).toBuffer())
    || !data.subarray(40, 72).equals(key(creator).toBuffer())
    || !data.subarray(72, 104).equals(key(initialAuthority).toBuffer()) || data[192] !== address.bump) {
    return { ...address, verified:false, reason:'v3-policy-layout-or-identity-mismatch' };
  }
  const protocolUnits = Array.from({ length:6 }, (_, index) => data.readUInt32LE(104 + index * 4));
  if (protocolUnits.reduce((sum, rate) => sum + rate, 0) !== 2_000_000
    || (split && protocolUnits.some((rate, index) => rate !== protocolGrossUnits(split)[index]))) {
    return { ...address, verified:false, reason:'v3-policy-rate-mismatch' };
  }
  const settledLamports = data.readBigUInt64LE(128);
  const paidLamports = Array.from({ length:7 }, (_, index) => data.readBigUInt64LE(136 + index * 8));
  if (paidLamports.reduce((sum, amount) => sum + amount, 0n) !== settledLamports) {
    return { ...address, verified:false, reason:'v3-policy-ledger-mismatch' };
  }
  return { ...address, verified:true, reason:'verified', protocolUnits, settledLamports, paidLamports };
}

export function buildMintRouterV3InitializeInstruction({ programId, mint, authority, creator, split = PROTOCOL_FEE_SPLIT }) {
  const router = deriveMintRouterV3(programId, mint);
  const policy = deriveMintPolicyV3(programId, mint);
  const legacy = deriveFeeRouter(programId);
  const units = protocolGrossUnits(split);
  const data = Buffer.alloc(8 + 6 * 4);
  discriminator('initialize_mint_v3').copy(data);
  units.forEach((rate, index) => data.writeUInt32LE(rate, 8 + index * 4));
  return { router, policy, protocolUnits: units, instruction: new TransactionInstruction({
    programId: router.programId,
    keys: [
      { pubkey:key(authority), isSigner:true, isWritable:true },
      { pubkey:key(creator), isSigner:true, isWritable:true },
      { pubkey:router.mint, isSigner:true, isWritable:false },
      { pubkey:legacy.address, isSigner:false, isWritable:false },
      { pubkey:router.address, isSigner:false, isWritable:true },
      { pubkey:policy.address, isSigner:false, isWritable:true },
      { pubkey:SystemProgram.programId, isSigner:false, isWritable:false },
    ],
    data,
  }) };
}

export function buildMintRouterV3SettlementInstruction({ programId, mint, authority, creator, claimId }) {
  const router = deriveMintRouterV3(programId, mint);
  const policy = deriveMintPolicyV3(programId, mint);
  const claim = deriveMintClaimV3(programId, mint, claimId);
  const vaults = deriveMintVaultsV3(programId, mint);
  const legacy = deriveFeeRouter(programId);
  const data = Buffer.concat([discriminator('settle_mint_v3'), Buffer.from(claimId)]);
  return { router, policy, claim, vaults, instruction: new TransactionInstruction({
    programId: router.programId,
    keys: [
      { pubkey:key(authority), isSigner:true, isWritable:true },
      { pubkey:key(creator), isSigner:true, isWritable:false },
      { pubkey:router.mint, isSigner:false, isWritable:false },
      { pubkey:legacy.address, isSigner:false, isWritable:false },
      { pubkey:router.address, isSigner:false, isWritable:true },
      { pubkey:policy.address, isSigner:false, isWritable:true },
      { pubkey:claim, isSigner:false, isWritable:true },
      { pubkey:SystemProgram.programId, isSigner:false, isWritable:false },
      ...vaults.map(pubkey => ({ pubkey, isSigner:false, isWritable:true })),
    ],
    data,
  }) };
}
