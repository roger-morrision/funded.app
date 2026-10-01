import { NATIVE_MINT, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { OnlinePumpSdk } from '@pump-fun/pump-sdk';
import { PUMP_AMM_SDK, coinCreatorVaultAuthorityPda, coinCreatorVaultAtaPda } from '@pump-fun/pump-swap-sdk';

// PumpSwap's ordinary collection deposits wSOL in the creator's ATA. A mint
// router PDA cannot sign to unwrap that ATA. Transfer the AMM fees to Pump's
// creator vault first; Pump's collection then pays native SOL to the router.
export async function buildMintCreatorFeeCollectionInstructions({ connection, router, keeper }) {
  const pump = new OnlinePumpSdk(connection);
  const pumpInstructions = await pump.collectCoinCreatorFeeV2Instructions(router, NATIVE_MINT, TOKEN_PROGRAM_ID, keeper);
  if (!pumpInstructions.length) throw new Error('Pump creator-fee collection instruction is unavailable.');
  const ammVault = coinCreatorVaultAtaPda(coinCreatorVaultAuthorityPda(router), NATIVE_MINT, TOKEN_PROGRAM_ID);
  let ammAmount = 0n;
  try { ammAmount = BigInt((await connection.getTokenAccountBalance(ammVault, 'confirmed')).value.amount); }
  catch (error) { if (!/could not find account|invalid param|account not found/i.test(String(error.message || error))) throw error; }
  if (ammAmount === 0n) return { instructions:[pumpInstructions[0]], ammVault:ammVault.toBase58(), ammAccruedLamports:'0' };
  const transfer = await PUMP_AMM_SDK.transferCreatorFeesToPumpV2Instruction({
    payer:keeper, coinCreator:router, quoteMint:NATIVE_MINT, quoteTokenProgram:TOKEN_PROGRAM_ID,
  });
  return { instructions:[transfer, pumpInstructions[0]], ammVault:ammVault.toBase58(), ammAccruedLamports:String(ammAmount) };
}
