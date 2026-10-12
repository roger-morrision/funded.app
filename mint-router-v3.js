import { Buffer } from 'buffer';
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { PROTOCOL_FEE_SPLIT } from './config/protocol-fee-split.js';
import { validateProtocolFeeSplit } from './distribution-policy.js';
import { deriveFeeRouter, FEE_ROUTER_POLICY_HASH_HEX } from './fee-router.js';

const MINT_ROUTER_V3_SEED = Buffer.from('funded-mint-router-v3');
const MINT_POLICY_V3_SEED = Buffer.from('mint-fee-policy-v3');
const MINT_VAULT_V3_SEED = Buffer.from('mint-fee-vault-v3');
const MINT_CLAIM_V3_SEED = Buffer.from('mint-fee-claim-v3');
const MINT_WITHDRAWAL_V3_SEED = Buffer.from('mint-withdraw-v3');
const REWARD_VAULT_SEED = Buffer.from('reward-vault-v1');
// Anchor's first eight SHA-256 bytes for each V3 instruction/account. Keep
// these constants checked against Node's crypto implementation in the verifier
// so the browser never needs a Node crypto polyfill to construct a launch.
const GLOBAL_DISCRIMINATORS = Object.freeze({
  initialize_mint_v3:'81b9d41bdc1b9cec',
  settle_mint_v3:'a44b0102a9594346',
  disburse_mint_v3:'68aef12e59187f1b',
});
const ACCOUNT_DISCRIMINATORS = Object.freeze({
  MintFeePolicyV3:'25d0c7eca736c38f',
  MintWithdrawalV3:'66d5a507606b85ce',
  MintClaimRecordV3:'90c82e2a7a966b02',
});
const discriminator = name => Buffer.from(GLOBAL_DISCRIMINATORS[name], 'hex');
const accountDiscriminator = name => Buffer.from(ACCOUNT_DISCRIMINATORS[name], 'hex');
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

export function deriveMintWithdrawalV3(programId, mint, withdrawalId) {
  const bytes = Buffer.from(withdrawalId);
  if (bytes.length !== 32) throw new Error('V3 withdrawal ID must be 32 bytes.');
  return PublicKey.findProgramAddressSync([MINT_WITHDRAWAL_V3_SEED, key(mint).toBuffer(), bytes], key(programId))[0];
}

export function deriveCommunityRewardVaultV3(programId, mint, authority) {
  return PublicKey.findProgramAddressSync([REWARD_VAULT_SEED, key(authority).toBuffer(), key(mint).toBuffer()], key(programId))[0];
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
  const expectedDiscriminator = accountDiscriminator('MintFeePolicyV3');
  if (data.length !== 249 || !data.subarray(0, 8).equals(expectedDiscriminator)
    || !data.subarray(8, 40).equals(key(mint).toBuffer())
    || !data.subarray(40, 72).equals(key(creator).toBuffer())
    || !data.subarray(72, 104).equals(key(initialAuthority).toBuffer()) || data[248] !== address.bump) {
    return { ...address, verified:false, reason:'v3-policy-layout-or-identity-mismatch' };
  }
  const protocolUnits = Array.from({ length:6 }, (_, index) => data.readUInt32LE(104 + index * 4));
  if (protocolUnits.reduce((sum, rate) => sum + rate, 0) !== 2_000_000
    || (split && protocolUnits.some((rate, index) => rate !== protocolGrossUnits(split)[index]))) {
    return { ...address, verified:false, reason:'v3-policy-rate-mismatch' };
  }
  const settledLamports = data.readBigUInt64LE(128);
  const paidLamports = Array.from({ length:7 }, (_, index) => data.readBigUInt64LE(136 + index * 8));
  const withdrawnLamports = Array.from({ length:7 }, (_, index) => data.readBigUInt64LE(192 + index * 8));
  if (paidLamports.reduce((sum, amount) => sum + amount, 0n) !== settledLamports
    || withdrawnLamports.some((amount, index) => amount > paidLamports[index])) {
    return { ...address, verified:false, reason:'v3-policy-ledger-mismatch' };
  }
  return { ...address, verified:true, reason:'verified', protocolUnits, settledLamports,
    paidLamports, withdrawnLamports };
}

export async function verifyMintWithdrawalV3Account({ connection, programId, mint, withdrawalId,
  category, recipient, amount }) {
  const address = deriveMintWithdrawalV3(programId, mint, withdrawalId);
  const account = await connection.getAccountInfo(address, 'finalized');
  if (!account?.owner?.equals(key(programId))) return { address, verified:false, reason:'v3-withdrawal-owner-or-account-mismatch' };
  const data = Buffer.from(account.data);
  const expectedDiscriminator = accountDiscriminator('MintWithdrawalV3');
  const valid = data.length === 121 && data.subarray(0, 8).equals(expectedDiscriminator)
    && data.subarray(8, 40).equals(Buffer.from(withdrawalId))
    && data.subarray(40, 72).equals(key(mint).toBuffer())
    && data[72] === category && data.subarray(73, 105).equals(key(recipient).toBuffer())
    && data.readBigUInt64LE(105) === BigInt(amount);
  return { address, verified:valid, reason:valid ? 'verified' : 'v3-withdrawal-receipt-mismatch',
    createdAt:valid ? data.readBigInt64LE(113) : null };
}

export async function verifyMintClaimV3Account({ connection, programId, mint, claimId,
  expectedLamports }) {
  const address = deriveMintClaimV3(programId, mint, claimId);
  const account = await connection.getAccountInfo(address, 'finalized');
  if (!account?.owner?.equals(key(programId))) return { address, verified:false, reason:'v3-claim-owner-or-account-mismatch' };
  const data = Buffer.from(account.data);
  const expectedDiscriminator = accountDiscriminator('MintClaimRecordV3');
  if (data.length !== 144 || !data.subarray(0, 8).equals(expectedDiscriminator)
    || !data.subarray(8, 40).equals(Buffer.from(claimId))
    || !data.subarray(40, 72).equals(key(mint).toBuffer())
    || data.readBigUInt64LE(72) !== BigInt(expectedLamports)) {
    return { address, verified:false, reason:'v3-claim-record-mismatch' };
  }
  const categoryLamports = Array.from({ length:7 }, (_, index) => data.readBigUInt64LE(80 + index * 8));
  if (categoryLamports.reduce((sum, amount) => sum + amount, 0n) !== BigInt(expectedLamports)) {
    return { address, verified:false, reason:'v3-claim-allocation-mismatch' };
  }
  return { address, verified:true, reason:'verified', categoryLamports,
    createdAt:data.readBigInt64LE(136) };
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
      { pubkey:key(authority), isSigner:false, isWritable:false },
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

export function buildMintRouterV3SettlementInstruction({ programId, mint, authority, creator, claimId,
  expectedLamports }) {
  if (typeof expectedLamports === 'number' && !Number.isSafeInteger(expectedLamports)) {
    throw new Error('V3 expected collection amount must be a safe integer, bigint, or decimal string.');
  }
  const expected = BigInt(expectedLamports);
  if (expected <= 0n || expected > 0xffff_ffff_ffff_ffffn) {
    throw new Error('V3 expected collection amount is invalid.');
  }
  const router = deriveMintRouterV3(programId, mint);
  const policy = deriveMintPolicyV3(programId, mint);
  const claim = deriveMintClaimV3(programId, mint, claimId);
  const vaults = deriveMintVaultsV3(programId, mint);
  const legacy = deriveFeeRouter(programId);
  const data = Buffer.alloc(8 + 32 + 8);
  discriminator('settle_mint_v3').copy(data);
  Buffer.from(claimId).copy(data, 8);
  data.writeBigUInt64LE(expected, 40);
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

export function buildMintRouterV3DisbursementInstruction({ programId, mint, authority, creator,
  withdrawalId, category, amount, recipient }) {
  if (!Number.isInteger(category) || category < 0 || category > 5) {
    throw new Error('V3 disbursement category must be 0 through 5; buyback is locked.');
  }
  if (typeof amount === 'number' && !Number.isSafeInteger(amount)) {
    throw new Error('V3 disbursement amount must be a safe integer, bigint, or decimal string.');
  }
  const lamports = BigInt(amount);
  if (lamports <= 0n || lamports > 0xffff_ffff_ffff_ffffn) throw new Error('V3 disbursement amount is invalid.');
  const destination = key(recipient);
  if (category === 0 && !destination.equals(key(creator))) throw new Error('Creator budget must pay the creator.');
  if (category === 5 && !destination.equals(deriveCommunityRewardVaultV3(programId, mint, authority))) {
    throw new Error('Community budget must enter its proof-gated reward vault.');
  }
  const router = deriveMintRouterV3(programId, mint);
  const vaults = deriveMintVaultsV3(programId, mint);
  if (destination.equals(router.address) || vaults.some(vault => destination.equals(vault))) {
    throw new Error('V3 category budgets cannot be reclassified through a router or vault.');
  }
  const policy = deriveMintPolicyV3(programId, mint);
  const withdrawal = deriveMintWithdrawalV3(programId, mint, withdrawalId);
  const legacy = deriveFeeRouter(programId);
  const data = Buffer.alloc(8 + 32 + 1 + 8);
  discriminator('disburse_mint_v3').copy(data);
  Buffer.from(withdrawalId).copy(data, 8);
  data[40] = category;
  data.writeBigUInt64LE(lamports, 41);
  return { policy, vault:vaults[category], withdrawal, recipient:destination, instruction:new TransactionInstruction({
    programId:key(programId),
    keys:[
      { pubkey:key(authority), isSigner:true, isWritable:true },
      { pubkey:key(creator), isSigner:true, isWritable:false },
      { pubkey:key(mint), isSigner:false, isWritable:false },
      { pubkey:legacy.address, isSigner:false, isWritable:false },
      { pubkey:policy.address, isSigner:false, isWritable:true },
      { pubkey:vaults[category], isSigner:false, isWritable:true },
      { pubkey:destination, isSigner:false, isWritable:true },
      { pubkey:withdrawal, isSigner:false, isWritable:true },
      { pubkey:SystemProgram.programId, isSigner:false, isWritable:false },
    ],
    data,
  }) };
}
