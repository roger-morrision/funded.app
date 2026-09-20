import { Buffer } from 'buffer';
import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { deriveFeeRouter, deriveMintFeeRouter } from './fee-router.js';

export const MAX_LAUNCH_TRANSACTION_BYTES = 1232;
const INITIALIZE_MINT_DISCRIMINATOR = Buffer.from('d12ac3048155d12c', 'hex');

export function buildMintRouterInitializeInstruction({ programId, mint, payer }) {
  const legacy = deriveFeeRouter(programId);
  const router = deriveMintFeeRouter(programId, mint);
  return {
    router,
    instruction: new TransactionInstruction({
      programId: router.programId,
      keys: [
        { pubkey: new PublicKey(payer), isSigner: true, isWritable: true },
        { pubkey: router.mint, isSigner: true, isWritable: false },
        { pubkey: legacy.address, isSigner: false, isWritable: false },
        { pubkey: router.address, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: INITIALIZE_MINT_DISCRIMINATOR,
    }),
  };
}

function isOversized(error) { return /Transaction too large|offset.*out of range/i.test(String(error?.message)); }
function serializedLength(transaction) {
  try { return transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).length; }
  catch (error) {
    if (isOversized(error)) return Infinity;
    throw error;
  }
}

export function buildPumpLaunchPlan({ payer, mint, blockhash, launchInstructions, burnInstruction = null, mintRouterInstruction = null }) {
  const prepare = (instructions, kind) => {
    const transaction = new Transaction().add(...instructions);
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = payer;
    try { transaction.partialSign(mint); }
    catch (error) { if (isOversized(error)) return { kind, transaction, bytes: Infinity }; throw error; }
    return { kind, transaction, bytes: serializedLength(transaction) };
  };
  const pumpInstructions = [...launchInstructions, ...(burnInstruction ? [burnInstruction] : [])];
  const combined = prepare([...(mintRouterInstruction ? [mintRouterInstruction] : []), ...pumpInstructions], 'launch');
  if (combined.bytes <= MAX_LAUNCH_TRANSACTION_BYTES) return { steps: [combined], mintRouterSeparate: false };
  if (mintRouterInstruction) {
    const initialize = prepare([mintRouterInstruction], 'initialize-mint-router');
    const launch = prepare(pumpInstructions, 'launch');
    if (initialize.bytes <= MAX_LAUNCH_TRANSACTION_BYTES && launch.bytes <= MAX_LAUNCH_TRANSACTION_BYTES) {
      return { steps: [initialize, launch], mintRouterSeparate: true };
    }
  }
  throw new Error('Pump launch exceeds Solana’s transaction size limit. Reduce the creator buy or choose Standard; no launch transaction was signed.');
}
