import { Buffer } from 'buffer';
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { deriveFeeRouter } from './fee-router.js';
import { deriveCommunityRewardVaultV3, deriveMintPolicyV3, deriveMintVaultsV3,
  deriveMintWithdrawalApprovalV3, deriveMintWithdrawalV3 } from './mint-router-v3.js';

const APPROVE = Buffer.from('dd6fdb42000c1d97', 'hex');
const DISBURSE = Buffer.from('fec3433797747da7', 'hex');
const key = value => new PublicKey(value);

function checkedWithdrawal({ programId, mint, withdrawalId, category, beneficiary, amount, recipient }) {
  const bytes = Buffer.from(withdrawalId);
  if (typeof amount === 'number' && !Number.isSafeInteger(amount)) {
    throw new Error('Protected V3 withdrawal amount must be an exact integer.');
  }
  const lamports = BigInt(amount);
  if (bytes.length !== 32 || !Number.isInteger(category) || category < 0 || category > 5
    || !Number.isInteger(beneficiary)
    || !(category === 0 ? beneficiary >= 0 && beneficiary <= 1 : beneficiary === category + 2)
    || lamports <= 0n || lamports > 0xffff_ffff_ffff_ffffn) {
    throw new Error('Protected V3 withdrawal ID, category, beneficiary, or amount is invalid.');
  }
  return { program:key(programId), mintKey:key(mint), bytes, lamports, destination:key(recipient),
    approval:deriveMintWithdrawalApprovalV3(programId, mint, bytes) };
}

export function buildProtectedMintV3ApprovalInstruction(input) {
  const { program, mintKey, bytes, lamports, destination, approval } = checkedWithdrawal(input);
  const { category, beneficiary, authority, creator } = input;
  if (!(category >= 1 && category <= 4)) {
    throw new Error('Only operations and referral withdrawals require an approval.');
  }
  const data = Buffer.alloc(8 + 32 + 1 + 1 + 8);
  APPROVE.copy(data);
  bytes.copy(data, 8);
  data[40] = category;
  data[41] = beneficiary;
  data.writeBigUInt64LE(lamports, 42);
  return { approval, instruction:new TransactionInstruction({ programId:program,
    keys:[
      { pubkey:key(authority), isSigner:true, isWritable:true },
      { pubkey:key(creator), isSigner:true, isWritable:false },
      { pubkey:mintKey, isSigner:false, isWritable:false },
      { pubkey:deriveFeeRouter(program).address, isSigner:false, isWritable:false },
      { pubkey:deriveMintPolicyV3(program, mintKey).address, isSigner:false, isWritable:false },
      { pubkey:destination, isSigner:false, isWritable:false },
      { pubkey:approval, isSigner:false, isWritable:true },
      { pubkey:SystemProgram.programId, isSigner:false, isWritable:false },
    ], data }) };
}

export function buildProtectedMintV3DisbursementInstruction(input) {
  const { program, mintKey, bytes, lamports, destination, approval } = checkedWithdrawal(input);
  const { category, beneficiary, authority, creator } = input;
  if (typeof input.holderAmount === 'number' && !Number.isSafeInteger(input.holderAmount)) {
    throw new Error('Protected V3 holder allocation must be an exact integer.');
  }
  const holderAmount = BigInt(input.holderAmount || 0);
  if (holderAmount < 0n || holderAmount > lamports
    || !(category === 0 && beneficiary === 1) && holderAmount !== 0n) {
    throw new Error('Protected V3 holder allocation is invalid.');
  }
  const vaults = deriveMintVaultsV3(program, mintKey);
  const reward = deriveCommunityRewardVaultV3(program, mintKey, authority);
  if (category === 0 && beneficiary === 0 && !destination.equals(key(creator))
    || category === 0 && beneficiary === 1 && !destination.equals(reward)
    || category === 5 && !destination.equals(reward)
    || vaults.some(vault => vault.equals(destination))) {
    throw new Error('Protected V3 withdrawal destination is not allowed.');
  }
  const data = Buffer.alloc(8 + 32 + 1 + 1 + 8 + 8);
  DISBURSE.copy(data);
  bytes.copy(data, 8);
  data[40] = category;
  data[41] = beneficiary;
  data.writeBigUInt64LE(lamports, 42);
  data.writeBigUInt64LE(holderAmount, 50);
  const withdrawal = deriveMintWithdrawalV3(program, mintKey, bytes);
  return { policy:deriveMintPolicyV3(program, mintKey), vault:vaults[category], approval,
    withdrawal, recipient:destination, instruction:new TransactionInstruction({
    programId:program,
    keys:[
      { pubkey:key(authority), isSigner:true, isWritable:true },
      { pubkey:key(creator), isSigner:true, isWritable:false },
      { pubkey:mintKey, isSigner:false, isWritable:false },
      { pubkey:deriveFeeRouter(program).address, isSigner:false, isWritable:false },
      { pubkey:deriveMintPolicyV3(program, mintKey).address, isSigner:false, isWritable:true },
      { pubkey:vaults[category], isSigner:false, isWritable:true },
      { pubkey:destination, isSigner:false, isWritable:true },
      { pubkey:approval, isSigner:false, isWritable:true },
      { pubkey:withdrawal, isSigner:false, isWritable:true },
      { pubkey:SystemProgram.programId, isSigner:false, isWritable:false },
    ], data }) };
}
