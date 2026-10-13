import bs58 from 'bs58';
import { ComputeBudgetProgram, PublicKey } from '@solana/web3.js';
import { buildMintRouterV3DisbursementInstruction,
  verifyMintPolicyV3Account, verifyMintWithdrawalV3Account } from '../mint-router-v3.js';

const address = value => typeof value === 'string' ? value : value?.pubkey
  ? address(value.pubkey) : value?.toBase58?.() || '';

// A payout plan or submitted signature is not funding. Require a finalized
// exact V3 instruction, category-vault debit, recipient credit, and receipt.
export async function loadFinalizedV3RewardFunding({ connection, signature, programId,
  mint, authority, creator, initialAuthority, withdrawalId, category, amount,
  recipient, split, verifyWithdrawal = verifyMintWithdrawalV3Account,
  verifyPolicy = verifyMintPolicyV3Account }) {
  try {
    if (category !== 0 && category !== 5) return null;
    const expected = buildMintRouterV3DisbursementInstruction({ programId, mint,
      authority, creator, withdrawalId, category, amount, recipient });
    const transaction = await connection.getTransaction(signature, {
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
    let disbursements = 0;
    for (const instruction of message.instructions || message.compiledInstructions || []) {
      const program = keys[instruction.programIdIndex];
      if (program === ComputeBudgetProgram.programId.toBase58()) continue;
      if (program !== expected.instruction.programId.toBase58() || disbursements++) return null;
      const data = typeof instruction.data === 'string'
        ? bs58.decode(instruction.data) : Buffer.from(instruction.data || []);
      const accounts = instruction.accounts || instruction.accountKeyIndexes || [];
      if (!Buffer.from(data).equals(expected.instruction.data)
        || accounts.length !== expected.instruction.keys.length
        || expected.instruction.keys.some((entry, index) => keys[accounts[index]] !== entry.pubkey.toBase58())) return null;
    }
    if (disbursements !== 1) return null;
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
    const [withdrawal, policy] = await Promise.all([
      verifyWithdrawal({ connection, programId, mint, withdrawalId, category, recipient, amount }),
      verifyPolicy({ connection, programId, mint, creator, initialAuthority, split }),
    ]);
    if (!withdrawal.verified || !policy.verified
      || !withdrawal.address.equals(expected.withdrawal)
      || !policy.address.equals(expected.policy.address)
      || policy.withdrawnLamports[category] < lamports) return null;
    return { signature, slot:transaction.slot, mint:new PublicKey(mint).toBase58(),
      programId:new PublicKey(programId).toBase58(), category, amount:String(lamports),
      recipient:expected.recipient.toBase58(), vault:expected.vault.toBase58(),
      withdrawal:expected.withdrawal.toBase58(), balanceDeltaVerified:true };
  } catch { return null; }
}
