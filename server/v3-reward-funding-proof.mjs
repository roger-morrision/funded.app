import bs58 from 'bs58';
import {buildV3PolicyApproval,buildV3PolicyDisbursement} from './v3-policy-builders.mjs';
import { ComputeBudgetProgram, PublicKey } from '@solana/web3.js';
import { buildMintRouterV3DisbursementInstruction,
  verifyMintPolicyV3Account, verifyMintWithdrawalV3Account,
  verifyMintWithdrawalApprovalV3Account } from '../mint-router-v3.js';
import { buildProtectedMintV3ApprovalInstruction,
  buildProtectedMintV3DisbursementInstruction } from '../protected-mint-router-v3.js';

const address = value => typeof value === 'string' ? value : value?.pubkey
  ? address(value.pubkey) : value?.toBase58?.() || '';

// A payout plan or submitted signature is not funding. Require a finalized
// exact V3 instruction, category-vault debit, recipient credit, and receipt.
export async function loadFinalizedV3RewardFunding({ connection, signature, programId,
  mint, authority, creator, initialAuthority, withdrawalId, category, amount,
  recipient, split, transaction:providedTransaction, protectedPolicy = false,
  beneficiary = null, holderAmount = 0n,
  verifyWithdrawal = verifyMintWithdrawalV3Account,
  verifyPolicy = verifyMintPolicyV3Account,
  verifyApproval = verifyMintWithdrawalApprovalV3Account }) {
  try {
    if (![0, 2, 3, 4, 5].includes(category) && !(protectedPolicy && category === 1)) return null;
    const expected = protectedPolicy
      ? buildV3PolicyDisbursement({ programId, mint, authority, creator,
        withdrawalId, category, beneficiary, amount, holderAmount, recipient,split })
      : buildMintRouterV3DisbursementInstruction({ programId, mint,
        authority, creator, withdrawalId, category, amount, recipient });
    const approvalRequired = protectedPolicy && category >= 1 && category <= 4;
    const approval = approvalRequired ? buildV3PolicyApproval({split,
      programId, mint, authority, creator, withdrawalId, category, beneficiary,
      amount, recipient }) : null;
    const expectedInstructions = approval ? [approval.instruction, expected.instruction]
      : [expected.instruction];
    const transaction = providedTransaction || await connection.getTransaction(signature, {
      commitment:'finalized', maxSupportedTransactionVersion:0 });
    if (!transaction || transaction.meta?.err !== null
      || !Number.isSafeInteger(transaction.slot) || transaction.slot <= 0
      || !transaction.transaction?.signatures?.includes(signature)) return null;
    const message = transaction.transaction.message;
    const staticKeys = (message.accountKeys || message.staticAccountKeys || []).map(address);
    const keys = [...staticKeys, ...(transaction.meta.loadedAddresses?.writable || []).map(address),
      ...(transaction.meta.loadedAddresses?.readonly || []).map(address)];
    const signers = staticKeys.slice(0, message.header?.numRequiredSignatures || 0);
    if (!signers.includes(new PublicKey(authority).toBase58())
      || !signers.includes(new PublicKey(creator).toBase58())) return null;
    let matched = 0;
    for (const instruction of message.instructions || message.compiledInstructions || []) {
      const program = keys[instruction.programIdIndex];
      if (program === ComputeBudgetProgram.programId.toBase58()) continue;
      const wanted = expectedInstructions[matched++];
      if (!wanted || program !== wanted.programId.toBase58()) return null;
      const data = typeof instruction.data === 'string'
        ? bs58.decode(instruction.data) : Buffer.from(instruction.data || []);
      const accounts = instruction.accounts || instruction.accountKeyIndexes || [];
      if (!Buffer.from(data).equals(wanted.data)
        || accounts.length !== wanted.keys.length
        || wanted.keys.some((entry, index) => keys[accounts[index]] !== entry.pubkey.toBase58())) return null;
    }
    if (matched !== expectedInstructions.length) return null;
    const vaultIndex = keys.indexOf(expected.vault.toBase58());
    const recipientIndex = keys.indexOf(expected.recipient.toBase58());
    const before = transaction.meta.preBalances;
    const after = transaction.meta.postBalances;
    const lamports = BigInt(amount);
    if (vaultIndex < 0 || recipientIndex < 0 || vaultIndex === recipientIndex
      || !Array.isArray(before) || !Array.isArray(after)
      || before.length !== keys.length || after.length !== keys.length
      || ![before[vaultIndex], after[vaultIndex], before[recipientIndex], after[recipientIndex]]
        .every(Number.isSafeInteger)
      || BigInt(before[vaultIndex]) - BigInt(after[vaultIndex]) !== lamports
      || BigInt(after[recipientIndex]) - BigInt(before[recipientIndex]) !== lamports) return null;
    const [withdrawal, policy, approvalRecord] = await Promise.all([
      verifyWithdrawal({ connection, programId, mint, withdrawalId, category, recipient, amount }),
      verifyPolicy({ connection, programId, mint, creator, initialAuthority, split }),
      approvalRequired ? verifyApproval({ connection, programId, mint, withdrawalId,
        category, beneficiary, recipient, amount }) : Promise.resolve(null),
    ]);
    if (!withdrawal.verified || !policy.verified
      || protectedPolicy && !policy.protectedPolicy
      || approvalRequired && (!approvalRecord?.verified
        || !approvalRecord.address.equals(expected.approval))
      || !withdrawal.address.equals(expected.withdrawal)
      || !policy.address.equals(expected.policy.address)
      || policy.withdrawnLamports[category] < lamports) return null;
    return { signature, slot:transaction.slot, blockTime:transaction.blockTime ?? null,
      feePayer:staticKeys[0], feeLamports:transaction.meta.fee,
      mint:new PublicKey(mint).toBase58(),
      programId:new PublicKey(programId).toBase58(), category, amount:String(lamports),
      recipient:expected.recipient.toBase58(), vault:expected.vault.toBase58(),
      withdrawal:expected.withdrawal.toBase58(), balanceDeltaVerified:true,
      ...(protectedPolicy ? { protectedPolicy:true, beneficiary,
        holderAmount:String(holderAmount), approval:approval?.approval.toBase58() || null } : {}) };
  } catch { return null; }
}
