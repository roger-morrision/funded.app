import BN from 'bn.js';
import {OnlinePumpAmmSdk,PUMP_AMM_SDK,PUMP_AMM_PROGRAM_ID,buyQuoteInput} from '@pump-fun/pump-swap-sdk';
import {NATIVE_MINT} from '@solana/spl-token';
import {protectedV3BuybackClip} from './v3-buyback-quote.mjs';
import {selectV3PumpBuy} from './v3-buyback-setup.mjs';

export async function quoteAgencyBuyback({observation,vault,budgetLamports,
  readSwap=(connection,pool,user)=>new OnlinePumpAmmSdk(connection).swapSolanaState(pool,user),
  quoteOutput=buyQuoteInput,buildBuy=(state,quote)=>PUMP_AMM_SDK.buyQuoteInput(state,quote,1)}){
  if(observation?.verified!==true||observation.cluster!=='devnet'||observation.commitment!=='finalized')
    throw new Error('A finalized own-coin market observation is required.');
  const state=await readSwap(observation.pinnedConnection,observation.poolKey,vault),budget=BigInt(budgetLamports);
  if(!state.poolKey?.equals(observation.poolKey)||!state.pool?.baseMint?.equals(observation.mintKey)
    ||!state.pool.quoteMint.equals(NATIVE_MINT)||!state.poolAccountInfo?.owner.equals(PUMP_AMM_PROGRAM_ID)
    ||String(state.poolBaseAmount)!==observation.baseReserve||String(state.poolQuoteAmount)!==observation.quoteReserve
    ||String(state.pool.virtualQuoteReserves)!==observation.virtualQuoteReserve||!state.baseTokenProgram.equals(observation.baseTokenProgram)
    ||budget<10000n||budget>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Agency quote differs from its finalized canonical reserves or bounded budget.');
  const amount=protectedV3BuybackClip(budget,observation.quoteReserve);
  if(amount<10000n)throw new Error('Insufficient verified liquidity for a protected agency purchase.');
  const quoted=quoteOutput({quote:new BN(String(amount)),slippage:1,baseReserve:state.poolBaseAmount,quoteReserve:state.poolQuoteAmount,
    virtualQuoteReserves:state.pool.virtualQuoteReserves,globalConfig:state.globalConfig,feeConfig:state.feeConfig,
    baseMint:state.baseMint,baseMintAccount:state.baseMintAccount,coinCreator:state.pool.coinCreator,creator:state.pool.creator,
    quoteMint:state.pool.quoteMint,isMayhemMode:state.pool.isMayhemMode,creatorFeeBps:state.pool.creatorFeeBps});
  if(BigInt(String(quoted.base||0))<=0n)throw new Error('The agency minimum token output is empty.');
  const instructions=await buildBuy(state,new BN(String(amount))),buy=selectV3PumpBuy(instructions);
  return{pumpBuyInstruction:buy,baseTokenProgram:observation.baseTokenProgram,spendableQuoteIn:String(amount),
    maxTotalDebit:String(amount),minBaseAmountOut:String(quoted.base)};
}
