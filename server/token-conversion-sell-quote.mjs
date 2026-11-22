import assert from 'node:assert/strict';
import BN from 'bn.js';
import {PublicKey} from '@solana/web3.js';
import {unpackMint,unpackAccount,NATIVE_MINT,TOKEN_PROGRAM_ID} from '@solana/spl-token';
import {PUMP_AMM_SDK,PUMP_AMM_PROGRAM_ID,PUMP_AMM_FEE_CONFIG_PDA,PUMP_FEE_PROGRAM_ID,GLOBAL_CONFIG_PDA,sellBaseInput} from '@pump-fun/pump-swap-sdk';
import {BUYBACK_POLICY} from '../buyback-policy.js';
import {assertRpcNetwork,SOLANA_GENESIS} from '../solana-network.js';
import {USDC_SOL_SELL_MARKET} from './token-conversion-sell.mjs';

export function requireTokenSellPolicy(policy){
  assert(policy&&Object.keys(policy).sort().join(',')==='maxDailyQuoteRaw,maxOrderQuoteRaw,maximumLiquidityClipBps,maximumSlippageBps,pool,quoteMint','Exact typed conversion policy fields required.');
  assert(policy?.quoteMint===USDC_SOL_SELL_MARKET.mint&&policy.pool===USDC_SOL_SELL_MARKET.pool,'Explicit reviewed conversion market required.');
  for(const name of ['maxOrderQuoteRaw','maxDailyQuoteRaw'])assert(typeof policy[name]==='string'&&/^[1-9]\d*$/.test(policy[name])
    &&BigInt(policy[name])<=0xffffffffffffffffn,'Canonical positive conversion policy bound required.');
  assert(BigInt(policy.maxDailyQuoteRaw)>=BigInt(policy.maxOrderQuoteRaw),'Daily quote bound is smaller than one order.');
  assert(Number.isSafeInteger(policy.maximumSlippageBps)&&policy.maximumSlippageBps>=0&&policy.maximumSlippageBps<=BUYBACK_POLICY.maximumSlippageBps
    &&Number.isSafeInteger(policy.maximumLiquidityClipBps)&&policy.maximumLiquidityClipBps>=1
    &&policy.maximumLiquidityClipBps<=BUYBACK_POLICY.maximumLiquidityClipBps,'Conversion review may not widen existing protection limits.');
  return policy;
}

// Recompute from the reviewer's OWN finalized RPC. No price/reserve/provider or
// recipient allowlist supplied by an HTTP caller is used. Read-only, unadmitted.
export async function independentTokenSellQuote({connection,amountIn,policy,now=Date.now()}){
  policy=structuredClone(policy);
  requireTokenSellPolicy(policy);
  assert(typeof amountIn==='string'&&/^[1-9]\d*$/.test(amountIn)&&BigInt(amountIn)<=BigInt(policy.maxOrderQuoteRaw),'Conversion input exceeds reviewed order bound.');
  await assertRpcNetwork(connection,'mainnet-beta');
  const mint=new PublicKey(policy.quoteMint),pool=new PublicKey(policy.pool);
  const first=await connection.getAccountInfoAndContext(pool,{commitment:'finalized'}),info=first.value;
  assert(Number.isSafeInteger(first.context?.slot)&&first.context.slot>0,'Finalized market context is missing or malformed.');
  assert(info?.owner?.equals(PUMP_AMM_PROGRAM_ID)&&!info.executable&&info.data.length>=245,'Finalized PumpSwap pool is unavailable.');
  const initial=PUMP_AMM_SDK.decodePool(info);
  const addresses=[pool,GLOBAL_CONFIG_PDA,PUMP_AMM_FEE_CONFIG_PDA,mint,NATIVE_MINT,initial.poolBaseTokenAccount,initial.poolQuoteTokenAccount];
  const batch=await connection.getMultipleAccountsInfoAndContext(addresses,{commitment:'finalized',minContextSlot:first.context.slot});
  assert(Number.isSafeInteger(batch.context.slot)&&batch.context.slot>=first.context.slot,'Market snapshot moved backwards.');
  const [poolInfo,globalInfo,feeInfo,mintInfo,nativeInfo,baseInfo,quoteInfo]=batch.value;
  assert(poolInfo?.owner?.equals(PUMP_AMM_PROGRAM_ID)&&globalInfo?.owner?.equals(PUMP_AMM_PROGRAM_ID)
    &&feeInfo?.owner?.equals(PUMP_FEE_PROGRAM_ID),'Market configuration ownership differs.');
  const saved=PUMP_AMM_SDK.decodePool(poolInfo);
  assert(saved.baseMint.equals(mint)&&saved.quoteMint.equals(NATIVE_MINT)&&!saved.isMayhemMode&&!saved.isCashbackCoin
    &&saved.coinCreator.equals(PublicKey.default)&&saved.poolBaseTokenAccount.equals(initial.poolBaseTokenAccount)
    &&saved.poolQuoteTokenAccount.equals(initial.poolQuoteTokenAccount),'Reviewed pool orientation, custody or mode changed.');
  for(const account of [mintInfo,nativeInfo,baseInfo,quoteInfo])assert(account?.owner?.equals(TOKEN_PROGRAM_ID)&&!account.executable,'Classic SPL market custody required.');
  const baseMint=unpackMint(mint,mintInfo,TOKEN_PROGRAM_ID),quoteMint=unpackMint(NATIVE_MINT,nativeInfo,TOKEN_PROGRAM_ID);
  assert(baseMint.isInitialized&&baseMint.decimals===6&&quoteMint.isInitialized&&quoteMint.decimals===9,'Market mint configuration differs.');
  const base=unpackAccount(saved.poolBaseTokenAccount,baseInfo,TOKEN_PROGRAM_ID),quote=unpackAccount(saved.poolQuoteTokenAccount,quoteInfo,TOKEN_PROGRAM_ID);
  assert(base.owner.equals(pool)&&quote.owner.equals(pool)&&base.mint.equals(mint)&&quote.mint.equals(NATIVE_MINT)
    &&!base.isFrozen&&!quote.isFrozen&&base.amount>0n&&quote.amount>0n,'Pool reserves lack exact token custody.');
  assert(BigInt(amountIn)<=base.amount*BigInt(policy.maximumLiquidityClipBps)/10000n,'Conversion exceeds reviewed pool liquidity clip.');
  const global=PUMP_AMM_SDK.decodeGlobalConfig(globalInfo),fee=PUMP_AMM_SDK.decodeFeeConfig(feeInfo);
  const computed=sellBaseInput({base:new BN(amountIn),slippage:0,baseReserve:new BN(String(base.amount)),quoteReserve:new BN(String(quote.amount)),
    virtualQuoteReserves:saved.virtualQuoteReserves,globalConfig:global,feeConfig:fee,baseMint:mint,baseMintAccount:baseMint,
    coinCreator:saved.coinCreator,creator:saved.creator,quoteMint:NATIVE_MINT,isMayhemMode:false,creatorFeeBps:saved.creatorFeeBps});
  const output=BigInt(computed.uiQuote.toString()),minimum=output*BigInt(10000-policy.maximumSlippageBps)/10000n;
  assert(minimum>0n,'Conversion output is below usable units.');
  const time=await connection.getBlockTime(batch.context.slot);
  assert(Number.isSafeInteger(time)&&Math.abs(now/1000-time)<=90,'Finalized market snapshot is stale.');
  return {cluster:'mainnet-beta',genesisHash:SOLANA_GENESIS['mainnet-beta'],slot:batch.context.slot,quoteMint:String(mint),pool:String(pool),
    amountIn,expectedLamports:String(output),minimumLamports:String(minimum),poolAccount:poolInfo,
    protocolRecipients:global.protocolFeeRecipients,buybackRecipients:global.buybackFeeRecipients};
}
