import bs58 from 'bs58';
import { ComputeBudgetProgram, PublicKey } from '@solana/web3.js';
import { buildMintRouterV3SettlementInstruction, verifyMintClaimV3Account,
  verifyMintPolicyV3Account } from '../mint-router-v3.js';

const address = value => typeof value === 'string' ? value : value?.pubkey
  ? address(value.pubkey) : value?.toBase58?.() || '';

// The caller must separately verify the approved Devnet program hash, the
// immutable launch policy, and the source Pump collection before using this.
export async function loadFinalizedV3Settlement({ connection, signature, programId, mint,
  authority, creator, claimId, expectedLamports, split,
  verifyClaim = verifyMintClaimV3Account, verifyPolicy = verifyMintPolicyV3Account }) {
  try {
    const expected = buildMintRouterV3SettlementInstruction({ programId, mint,
      authority, creator, claimId, expectedLamports });
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
    const instructions = message.instructions || message.compiledInstructions || [];
    let settlements = 0;
    for (const instruction of instructions) {
      const program = keys[instruction.programIdIndex];
      if (program === ComputeBudgetProgram.programId.toBase58()) continue;
      if (program !== expected.instruction.programId.toBase58() || settlements++) return null;
      const data = typeof instruction.data === 'string'
        ? bs58.decode(instruction.data) : Buffer.from(instruction.data || []);
      const accounts = instruction.accounts || instruction.accountKeyIndexes || [];
      if (!Buffer.from(data).equals(expected.instruction.data)
        || accounts.length !== expected.instruction.keys.length
        || expected.instruction.keys.some((entry, index) => keys[accounts[index]] !== entry.pubkey.toBase58())) return null;
    }
    if (settlements !== 1) return null;
    const routerIndex = keys.indexOf(expected.router.address.toBase58());
    const before = transaction.meta.preBalances;
    const after = transaction.meta.postBalances;
    if (routerIndex < 0 || !Array.isArray(before) || !Array.isArray(after)
      || before.length !== keys.length || after.length !== keys.length
      || !Number.isSafeInteger(before[routerIndex]) || !Number.isSafeInteger(after[routerIndex])
      || BigInt(before[routerIndex]) - BigInt(after[routerIndex]) !== BigInt(expectedLamports)) return null;
    const [claim, policy] = await Promise.all([
      verifyClaim({ connection, programId, mint, claimId, expectedLamports }),
      verifyPolicy({ connection, programId, mint, creator, initialAuthority:authority, split }),
    ]);
    if (!claim.verified || !policy.verified
      || claim.address.toBase58() !== expected.claim.toBase58()
      || policy.address.toBase58() !== expected.policy.address.toBase58()
      || policy.settledLamports < BigInt(expectedLamports)) return null;
    return { signature, slot:transaction.slot, mint:new PublicKey(mint).toBase58(),
      router:expected.router.address.toBase58(), claim:expected.claim.toBase58(),
      policy:expected.policy.address.toBase58(), claimId:Buffer.from(claimId).toString('hex'),
      expectedLamports:String(expectedLamports),
      categoryLamports:claim.categoryLamports.map(value => String(value)) };
  } catch { return null; }
}
