import { randomBytes } from 'node:crypto';
import { PublicKey, Transaction, ComputeBudgetProgram, sendAndConfirmTransaction } from '@solana/web3.js';
import { OnlinePumpSdk } from '@pump-fun/pump-sdk';
import { PUMP_AMM_SDK, coinCreatorVaultAuthorityPda, coinCreatorVaultAtaPda } from '@pump-fun/pump-swap-sdk';
import { buildTokenAccountSetupInstructions, buildTokenLedgerInitializeInstruction, buildTokenSettlementInstruction,
  deriveTokenAccountsV3, deriveTokenLedgerV3, deriveAgencyPolicyV3 } from '../mint-router-v3-token.js';

// Keeper step for a coin paired with a token: make sure the router's and vaults'
// paired-token accounts and the coin's token ledger exist, collect Pump's
// creator fees in that token into the router, then settle them into the seven
// category vaults by the coin's policy. The keeper signs as router authority.
export async function collectAndSettleTokenFees({ connection, programId, keeper, mint, quoteMint, settle = true }) {
  const quote = new PublicKey(quoteMint), coin = new PublicKey(mint), program = new PublicKey(programId);
  const quoteInfo = await connection.getAccountInfo(quote, 'confirmed');
  if (!quoteInfo) throw new Error('Paired token not found.');
  const tokenProgram = quoteInfo.owner;
  const accounts = deriveTokenAccountsV3(program, coin, quote, tokenProgram);
  const ledger = deriveTokenLedgerV3(program, coin, quote);
  // Agency launches (all new launches) have an agency policy; older ones a protected policy.
  const agency = Boolean(await connection.getAccountInfo(deriveAgencyPolicyV3(program, coin), 'confirmed'));
  const setup = [...buildTokenAccountSetupInstructions({ programId: program, mint: coin, quoteMint: quote, tokenProgram, payer: keeper.publicKey })];
  if (!await connection.getAccountInfo(ledger, 'confirmed'))
    setup.push(buildTokenLedgerInitializeInstruction({ programId: program, mint: coin, quoteMint: quote, authority: keeper.publicKey, agency }));
  // PumpSwap fees (after migration) move to Pump's creator vault first; Pump's
  // collection then pays the router's paired-token account.
  const collect = await new OnlinePumpSdk(connection).collectCoinCreatorFeeV2Instructions(accounts.router, quote, tokenProgram, keeper.publicKey);
  const ammVault = coinCreatorVaultAtaPda(coinCreatorVaultAuthorityPda(accounts.router), quote, tokenProgram);
  const ammAmount = await connection.getTokenAccountBalance(ammVault, 'confirmed').then(row => BigInt(row.value.amount)).catch(() => 0n);
  const transfer = ammAmount > 0n ? [await PUMP_AMM_SDK.transferCreatorFeesToPumpV2Instruction({ payer: keeper.publicKey, coinCreator: accounts.router, quoteMint: quote, quoteTokenProgram: tokenProgram })] : [];
  const before = await connection.getTokenAccountBalance(accounts.routerToken, 'confirmed').then(row => BigInt(row.value.amount)).catch(() => 0n);
  const collectSignature = await sendAndConfirmTransaction(connection,
    new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }), ...setup, ...transfer, ...collect), [keeper], { commitment: 'confirmed' });
  const balance = BigInt((await connection.getTokenAccountBalance(accounts.routerToken, 'confirmed')).value.amount);
  const result = { tokenProgram: tokenProgram.toBase58(), routerToken: accounts.routerToken.toBase58(), collectSignature,
    collected: String(balance - before), routerBalance: String(balance), settleSignature: null, settled: '0', agency };
  if (!settle || balance === 0n) return result;
  const claimId = randomBytes(32);
  result.settleSignature = await sendAndConfirmTransaction(connection, new Transaction().add(
    buildTokenSettlementInstruction({ programId: program, mint: coin, quoteMint: quote, tokenProgram, authority: keeper.publicKey, claimId, amount: balance, agency })),
  [keeper], { commitment: 'confirmed' });
  result.settled = String(balance);
  result.claimId = claimId.toString('hex');
  return result;
}
