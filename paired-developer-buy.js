import { ComputeBudgetProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { OnlinePumpSdk, PUMP_SDK, getBuyTokenAmountFromSolAmount } from '@pump-fun/pump-sdk';
import BN from 'bn.js';
import { developerLockLaunchInstructions } from './developer-token-lock.js';
import { executeLaunchPlan } from './launch-executor.js';

const MAX_DEVELOPER_BASE_UNITS = 200_000_000n * 1_000_000n;

// A paired coin's developer escrow does not fit in its atomic launch
// transaction. Right after the launch, one second transaction buys the
// developer allocation on the curve and escrows every purchased token, so the
// creator never holds an unlocked developer buy. Amounts are in the paired
// token's base units.
export async function buildPairedDeveloperBuy({ connection, payer, mint, quoteMint, quoteTokenProgram, spend, maxSpend,
  config, quoteId, lockSeconds, lookupTable, sdk = new OnlinePumpSdk(connection) }) {
  spend = BigInt(spend); maxSpend = BigInt(maxSpend);
  if (spend <= 0n || maxSpend < spend) throw new Error('A positive developer buy amount is required.');
  const [global, feeConfig, state] = await Promise.all([sdk.fetchGlobal(), sdk.fetchFeeConfig().catch(() => null),
    sdk.fetchBuyState(mint, payer, TOKEN_2022_PROGRAM_ID)]);
  if (!state.bondingCurve || state.bondingCurve.complete || !state.bondingCurve.quoteMint?.equals(quoteMint))
    throw new Error('The coin\'s paired-token curve is unavailable for the developer buy.');
  const supply = BigInt(state.bondingCurve.tokenTotalSupply.toString());
  let amount = BigInt(getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply: new BN(supply.toString()),
    bondingCurve: state.bondingCurve, amount: new BN(spend.toString()), quoteMint }).toString());
  if (amount > MAX_DEVELOPER_BASE_UNITS) amount = MAX_DEVELOPER_BASE_UNITS;
  if (amount <= 0n) throw new Error('The developer buy is too small to receive tokens.');
  // Pump buys an exact token amount for at most the reviewed spend plus 1%.
  const slippage = Number((maxSpend - spend) * 10000n / spend) / 100;
  const buy = await PUMP_SDK.buyV2Instructions({ global, bondingCurveAccountInfo: state.bondingCurveAccountInfo, bondingCurve: state.bondingCurve,
    associatedUserAccountInfo: state.associatedUserAccountInfo, mint, user: payer, amount: new BN(amount.toString()),
    quoteAmount: new BN(spend.toString()), slippage, tokenProgram: TOKEN_2022_PROGRAM_ID, quoteMint, quoteTokenProgram });
  const lock = developerLockLaunchInstructions({ mint, creator: payer, amount, config, quoteId, lockSeconds });
  const message = new TransactionMessage({ payerKey: payer, recentBlockhash: '11111111111111111111111111111111',
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...buy, ...lock] })
    .compileToV0Message(lookupTable ? [lookupTable] : []);
  const transaction = new VersionedTransaction(message);
  if (transaction.serialize().length > 1232) throw new Error('The developer buy does not fit in one Solana transaction.');
  return { amount, transaction };
}

export async function submitPairedDeveloperBuy({ connection, provider, payer, mint, assertWalletCurrent, onJournal, ...input }) {
  const { amount, transaction } = await buildPairedDeveloperBuy({ connection, payer, mint, ...input });
  const result = await executeLaunchPlan({ connection, provider, payer, mint: null, assertWalletCurrent, onEvent: onJournal,
    plan: { steps: [{ kind: 'developer-buy', transaction, signers: [] }] } });
  return { signature: result.developerBuySignature, amount };
}
