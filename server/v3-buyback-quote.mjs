import BN from 'bn.js';
import { OnlinePumpAmmSdk, PUMP_AMM_PROGRAM_ID, PUMP_AMM_SDK,
  buyQuoteInput } from '@pump-fun/pump-swap-sdk';
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { V3_DEVNET_FUNDED_MINT, V3_DEVNET_FUNDED_POOL } from './v3-buyback-instruction.mjs';

export async function quoteV3Buyback({ connection, vault, budgetLamports }) {
  const budget=BigInt(budgetLamports);
  if (budget<100_000n || budget>BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error('V3 buyback budget is outside the bounded Devnet range.');
  const quote=budget;
  const [state,mintInfo]=await Promise.all([
    new OnlinePumpAmmSdk(connection).swapSolanaState(V3_DEVNET_FUNDED_POOL,vault),
    connection.getAccountInfo(V3_DEVNET_FUNDED_MINT,'finalized'),
  ]);
  if (!mintInfo || ![TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID]
    .some(program=>mintInfo.owner.equals(program))
    || !state.poolAccountInfo?.owner?.equals(PUMP_AMM_PROGRAM_ID)
    || !state.pool?.baseMint?.equals(V3_DEVNET_FUNDED_MINT)
    || !state.pool?.quoteMint?.equals(NATIVE_MINT)
    || BigInt(state.poolQuoteAmount?.toString()||0)<=0n)
    throw new Error('The approved $FUNDED PumpSwap Devnet pool is unavailable.');
  const reserves=BigInt(state.poolQuoteAmount.toString());
  if (quote*10_000n>reserves*100n)
    throw new Error('The buyback exceeds one percent of verified pool quote liquidity.');
  const quoted=buyQuoteInput({ quote:new BN(String(quote)),slippage:1,
    baseReserve:state.poolBaseAmount,quoteReserve:state.poolQuoteAmount,
    virtualQuoteReserves:state.pool.virtualQuoteReserves,
    globalConfig:state.globalConfig,feeConfig:state.feeConfig,
    baseMint:state.baseMint,baseMintAccount:state.baseMintAccount,
    coinCreator:state.pool.coinCreator,creator:state.pool.creator,
    quoteMint:state.pool.quoteMint,isMayhemMode:state.pool.isMayhemMode,
    creatorFeeBps:state.pool.creatorFeeBps });
  const minimum=BigInt(quoted.base?.toString()||0);
  if (minimum<=0n) throw new Error('The protected $FUNDED output quote is empty.');
  const instructions=await PUMP_AMM_SDK.buyQuoteInput(state,new BN(String(quote)),1);
  const buy=instructions.filter(ix=>ix.programId.equals(PUMP_AMM_PROGRAM_ID));
  if (buy.length!==1) throw new Error('The PumpSwap quote has no unique buy instruction.');
  return { pumpBuyInstruction:buy[0],baseTokenProgram:mintInfo.owner,
    spendableQuoteIn:String(quote),minBaseAmountOut:String(minimum),
    maxTotalDebit:String(budget) };
}
