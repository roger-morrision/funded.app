import { PublicKey, SystemProgram } from '@solana/web3.js';
import { deriveMintVaultsV3, verifyMintPolicyV3Account } from '../mint-router-v3.js';

// An unindexed policy is the obligation ledger. Require its exact remaining
// category-6 amount to match finalized vault custody before signing a spend.
export async function finalizedUnindexedV3Budget({ connection, programId, mint,
  creator, initialAuthority }) {
  const policy = await verifyMintPolicyV3Account({ connection, programId, mint,
    creator, initialAuthority, split:null });
  if (!policy.verified || policy.protocolUnits[5] !== 500_000) return null;
  const remaining = policy.paidLamports[6] - policy.withdrawnLamports[6];
  if (remaining < 0n) return null;
  const vault = deriveMintVaultsV3(programId, mint)[6];
  const [account, reserve] = await Promise.all([
    connection.getAccountInfo(vault, 'finalized'),
    connection.getMinimumBalanceForRentExemption(0, 'finalized'),
  ]);
  if (!account && remaining === 0n) return { remaining, vault:new PublicKey(vault) };
  if (!account?.owner?.equals(SystemProgram.programId)
    || Buffer.from(account.data || []).length !== 0
    || BigInt(account.lamports) !== BigInt(reserve) + remaining) return null;
  return { remaining, vault:new PublicKey(vault) };
}
