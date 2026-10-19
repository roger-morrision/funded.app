import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import { ComputeBudgetProgram, PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PUMP_AMM_PROGRAM_ID } from '@pump-fun/pump-swap-sdk';
import { verifyMintPolicyV3Account } from '../mint-router-v3.js';
import {agencyDiscriminator} from '../agency-mint-router-v3.js';
import { buildV3BuybackInstruction, V3_DEVNET_FUNDED_MINT,
  V3_DEVNET_FUNDED_POOL } from './v3-buyback-instruction.mjs';

const discriminator = name => createHash('sha256').update(name).digest().subarray(0, 8);
const address = value => typeof value === 'string' ? value : value?.toBase58?.() || '';
const bytes = value => typeof value === 'string' ? Buffer.from(bs58.decode(value)) : Buffer.from(value || []);

// A successful transaction signature alone cannot establish a token burn.
// The finality proof binds the category-vault debit, PumpSwap exact-quote CPI,
// token burn CPI, immutable router receipt, and current policy budget.
export async function loadFinalizedV3Buyback({ connection, signature, programId,
  sourceMint, creator, initialAuthority, authority, baseTokenProgram,
  buybackId, spendableQuoteIn, minBaseAmountOut, maxTotalDebit,
  pumpBuyInstruction, split,agencyPolicy=split?.agencyPercent!==undefined,agencyExecution=null,
  verifyPolicy = verifyMintPolicyV3Account }) {
  try {
    const expected = buildV3BuybackInstruction({ programId, sourceMint,
      creator, authority, baseTokenProgram, buybackId, spendableQuoteIn,
      minBaseAmountOut, maxTotalDebit, pumpBuyInstruction,agencyPolicy,agencyExecution });
    const boughtMint=expected.boughtMint||V3_DEVNET_FUNDED_MINT,pool=expected.pool||V3_DEVNET_FUNDED_POOL;
    const category=expected.category??6;
    const tx = await connection.getTransaction(signature, {
      commitment:'finalized', maxSupportedTransactionVersion:0 });
    if (!tx || tx.meta?.err !== null || !Number.isSafeInteger(tx.slot)
      || tx.slot <= 0 || !tx.transaction?.signatures?.includes(signature)) return null;
    const message = tx.transaction.message;
    const staticKeys = (message.accountKeys || message.staticAccountKeys || []).map(address);
    const keys = [...staticKeys, ...(tx.meta.loadedAddresses?.writable || []).map(address),
      ...(tx.meta.loadedAddresses?.readonly || []).map(address)];
    const signers = staticKeys.slice(0, message.header?.numRequiredSignatures || 0);
    if (!signers.includes(new PublicKey(authority).toBase58())) return null;
    const instructions = message.instructions || message.compiledInstructions || [];
    let routerIndex = -1;
    for (let index = 0; index < instructions.length; index++) {
      const ix = instructions[index];
      if (keys[ix.programIdIndex] === ComputeBudgetProgram.programId.toBase58()) continue;
      if (routerIndex !== -1 || keys[ix.programIdIndex] !== new PublicKey(programId).toBase58())
        return null;
      const ixKeys = ix.accounts || ix.accountKeyIndexes || [];
      if (!bytes(ix.data).equals(expected.instruction.data)
        || ixKeys.length !== expected.instruction.keys.length
        || expected.instruction.keys.some((entry, offset) =>
          keys[ixKeys[offset]] !== entry.pubkey.toBase58())) return null;
      routerIndex = index;
    }
    if (routerIndex < 0) return null;
    const inner = tx.meta.innerInstructions?.find(group => group.index === routerIndex)?.instructions || [];
    let pumpSeen = false, burnSeen = false;
    for (const ix of inner) {
      const program = keys[ix.programIdIndex];
      const data = bytes(ix.data);
      const accounts = (ix.accounts || ix.accountKeyIndexes || []).map(index => keys[index]);
      if (program === PUMP_AMM_PROGRAM_ID.toBase58()
        && data.length === 25 && data[24] === 0
        && data.subarray(0, 8).equals(Buffer.from([198, 46, 21, 82, 180, 217, 232, 112]))
        && data.readBigUInt64LE(8) === BigInt(spendableQuoteIn)
        && data.readBigUInt64LE(16) === BigInt(minBaseAmountOut)
        && accounts[0] === pool.toBase58()
        && accounts[1] === expected.vault.toBase58()) pumpSeen = true;
      if (program === new PublicKey(baseTokenProgram).toBase58()
        && (program === TOKEN_PROGRAM_ID.toBase58()
          || program === TOKEN_2022_PROGRAM_ID.toBase58())
        && data[0] === 15 && data.length === 10
        && accounts[0] === expected.fundedAta.toBase58()
        && accounts[1] === boughtMint.toBase58()
        && accounts[2] === expected.vault.toBase58()) burnSeen = data.readBigUInt64LE(1);
    }
    if (!pumpSeen || typeof burnSeen !== 'bigint' || burnSeen < BigInt(minBaseAmountOut)) return null;
    const vaultIndex = keys.indexOf(expected.vault.toBase58());
    const before = tx.meta.preBalances?.[vaultIndex], after = tx.meta.postBalances?.[vaultIndex];
    if (vaultIndex < 0 || !Number.isSafeInteger(before) || !Number.isSafeInteger(after)
      || before <= after) return null;
    const spent = BigInt(before) - BigInt(after);
    if (spent > BigInt(maxTotalDebit)) return null;
    const [receiptInfo, policy] = await Promise.all([
      connection.getAccountInfo(expected.receipt, 'finalized'),
      verifyPolicy({ connection, programId, mint:sourceMint, creator,
        initialAuthority, split }),
    ]);
    const row = Buffer.from(receiptInfo?.data || []);
    if (!receiptInfo?.owner?.equals(new PublicKey(programId)) || row.length !== (agencyPolicy?209:160)
      || !row.subarray(0, 8).equals(agencyPolicy?agencyDiscriminator('AgencyBuybackV3'):discriminator('account:MintBuybackV3'))
      || !row.subarray(8, 40).equals(expected.buybackId)
      || !row.subarray(40, 72).equals(new PublicKey(sourceMint).toBuffer())
      || !row.subarray(72, 104).equals(boughtMint.toBuffer())
      || !row.subarray(104, 136).equals(pool.toBuffer())
      || row.readBigUInt64LE(136) !== spent
      || row.readBigUInt64LE(144) !== burnSeen
      || !policy?.verified || policy.withdrawnLamports[category] < spent
      || agencyPolicy&&(!policy.agencyPolicy||row[160]!==expected.agent)) return null;
    if(agencyExecution&&(row.readBigUInt64LE(161)!==BigInt(agencyExecution.observationSlot)
      ||row.readBigUInt64LE(169)!==BigInt(agencyExecution.marketCapUsdMicros)
      ||!row.subarray(177,209).equals(Buffer.from(agencyExecution.observationHash))
      ||!(policy.completedMask&(1<<expected.agent))||policy.agentSpent[expected.agent]<spent))return null;
    const burnedAtSeconds = row.readBigInt64LE(152);
    const burnedAt = burnedAtSeconds > 0n && burnedAtSeconds < 8_640_000_000_000n
      ? new Date(Number(burnedAtSeconds) * 1000).toISOString() : null;
    return { signature, slot:tx.slot, sourceMint:new PublicKey(sourceMint).toBase58(),
      receipt:expected.receipt.toBase58(), vault:expected.vault.toBase58(),
      spentLamports:String(spent), burnedBaseUnits:String(burnSeen),
      fundedMint:boughtMint.toBase58(),
      pool:pool.toBase58(), burnedAt, finalized:true,
      ...(agencyPolicy?{agencyPolicy:true,agent:expected.agent,category}:{}),
      vaultDebitVerified:true, burnInstructionVerified:true, balanceDeltaVerified:true };
  } catch { return null; }
}
