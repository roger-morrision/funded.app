import { Buffer } from 'buffer';
import { PublicKey, SystemProgram, Transaction, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
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

export function buildPumpLaunchPlan({ payer, mint, blockhash, launchInstructions, burnInstruction = null, mintRouterInstruction = null, reserveInstructions = [], lookupTable = null }) {
  const prepare = (instructions, kind) => {
    const transaction = new Transaction().add(...instructions);
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = payer;
    try { transaction.partialSign(mint); }
    catch (error) { if (isOversized(error)) return { kind, transaction, bytes: Infinity }; throw error; }
    return { kind, transaction, bytes: serializedLength(transaction) };
  };
  const pumpInstructions = [...launchInstructions, ...(burnInstruction ? [burnInstruction] : [])];
  if (reserveInstructions.length) {
    if (!lookupTable?.isActive?.()) throw new Error('Verified Solana launch reserve lookup table is unavailable. No coin was created.');
    const instructions = [...pumpInstructions, ...reserveInstructions];
    const compile = items => {
      const message = new TransactionMessage({ payerKey:new PublicKey(payer), recentBlockhash:blockhash, instructions:items }).compileToV0Message([lookupTable]);
      if (!message.addressTableLookups.some(row => row.accountKey.equals(lookupTable.key))) throw new Error('Launch reserve lookup table did not compress this transaction.');
      const transaction = new VersionedTransaction(message);
      transaction.sign([mint]);
      let bytes;
      try { bytes = transaction.serialize().length; }
      catch (error) { if (!isOversized(error)) throw error; bytes = Infinity; }
      return { kind:'launch', transaction, bytes };
    };
    const combined = compile([...(mintRouterInstruction ? [mintRouterInstruction] : []), ...instructions]);
    if (combined.bytes <= MAX_LAUNCH_TRANSACTION_BYTES) return { steps:[combined], mintRouterSeparate:false, reserveAtomic:true };
    const launch = compile(instructions);
    const bytes = launch.bytes;
    if (bytes > MAX_LAUNCH_TRANSACTION_BYTES) throw new Error(`Atomic community reserve transaction is ${bytes} bytes, above Solana's limit. Shorten the coin name or select Standard; no coin was created.`);
    const steps = [];
    if (mintRouterInstruction) {
      const initialize = prepare([mintRouterInstruction], 'initialize-mint-router');
      if (initialize.bytes > MAX_LAUNCH_TRANSACTION_BYTES) throw new Error('Mint router initialization exceeds Solana’s size limit.');
      steps.push(initialize);
    }
    steps.push(launch);
    return { steps, mintRouterSeparate:Boolean(mintRouterInstruction), reserveAtomic:true };
  }
  const combined = prepare([...(mintRouterInstruction ? [mintRouterInstruction] : []), ...pumpInstructions], 'launch');
  if (combined.bytes <= MAX_LAUNCH_TRANSACTION_BYTES) return { steps: [combined], mintRouterSeparate: false };
  if (mintRouterInstruction) {
    const initialize = prepare([mintRouterInstruction], 'initialize-mint-router');
    const launch = prepare(pumpInstructions, 'launch');
    if (initialize.bytes <= MAX_LAUNCH_TRANSACTION_BYTES && launch.bytes <= MAX_LAUNCH_TRANSACTION_BYTES) {
      return { steps: [initialize, launch], mintRouterSeparate: true };
    }
  }
  throw new Error('Pump launch exceeds Solana’s transaction size limit. Set the creator buy to zero or choose Standard; no launch transaction was signed.');
}
