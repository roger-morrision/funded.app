import BN from 'bn.js';
import {PublicKey} from '@solana/web3.js';
import {NATIVE_MINT,TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID} from '@solana/spl-token';
import {OnlinePumpAmmSdk,PUMP_AMM_SDK,PUMP_AMM_PROGRAM_ID,buyQuoteInput} from '@pump-fun/pump-swap-sdk';
import {GLOBAL_PDA,PUMP_SDK} from '@pump-fun/pump-sdk';
import {readBuybackCurve,quoteCurveBuyback} from './v3-buyback-curve.mjs';
import {selectV3PumpBuy} from './v3-buyback-setup.mjs';
import {protectedV3BuybackMinimum} from './v3-buyback-quote.mjs';
import {unpackMint} from '@solana/spl-token';
import {agencyMarketCapMicros} from './agency-market-observation.mjs';

// SOL/USD for own-coin milestone checks. Deliberately a different source from
// the application's CoinGecko reference, so one feed cannot satisfy both.
export async function krakenSolUsd({request=fetch}={}){
  const response=await request('https://api.kraken.com/0/public/Ticker?pair=SOLUSD',{redirect:'error',signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw Error('Independent SOL/USD reference is unavailable.');
  const body=await response.json(),row=body?.result&&Object.values(body.result)[0];
  const price=String(row?.c?.[0]||'').replace(/0+$/,'').replace(/\.$/,'');
  if((body?.error||[]).length||!/^[1-9]\d{0,6}(?:\.\d{1,8})?$/.test(price))throw Error('Independent SOL/USD reference is invalid.');
  return price;
}

// Always fetch from the signer's own finalized connection. No price, reserves,
// market identity, or RPC URL from the HTTP caller is trusted.
export async function independentMarketQuote({connection,config,vault,quote,solUsd=krakenSolUsd}){
  const mint=new PublicKey(config.mint),pool=new PublicKey(config.pool);
  const snapshot=await readBuybackCurve(connection,mint);
  if(snapshot&&!snapshot.curve.complete){
    if(!config.allowCurve)throw Error('Curve signing is disabled.');
    const result=await quoteCurveBuyback({connection,mint,vault,budgetLamports:quote,snapshot});
    const global=PUMP_SDK.decodeGlobal(await connection.getAccountInfo(GLOBAL_PDA,'finalized'));
    return {...result,curve:true,recipientChoices:new Map([[1,[global.feeRecipient,...global.feeRecipients]],
      [17,global.buybackFeeRecipients]])};
  }
  const sdk=new OnlinePumpAmmSdk(connection),state=await sdk.swapSolanaState(pool,vault);
  const mintInfo=await connection.getAccountInfo(mint,'finalized');
  if(!mintInfo||![TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID].some(k=>k.equals(mintInfo.owner))
    ||!state.poolAccountInfo?.owner.equals(PUMP_AMM_PROGRAM_ID)||!state.pool.baseMint.equals(mint)
    ||!state.pool.quoteMint.equals(NATIVE_MINT)||state.pool.isMayhemMode||state.pool.isCashbackCoin)
    throw Error('Approved SOL pool is unavailable or unsupported.');
  const reserves=BigInt(state.poolQuoteAmount.toString());
  if(quote<10000n||quote>reserves*25n/10000n)throw Error('Pool liquidity limit exceeded.');
  const output=buyQuoteInput({quote:new BN(String(quote)),slippage:1,
    baseReserve:state.poolBaseAmount,quoteReserve:state.poolQuoteAmount,
    virtualQuoteReserves:state.pool.virtualQuoteReserves,globalConfig:state.globalConfig,
    feeConfig:state.feeConfig,baseMint:state.baseMint,baseMintAccount:state.baseMintAccount,
    coinCreator:state.pool.coinCreator,creator:state.pool.creator,quoteMint:state.pool.quoteMint,
    isMayhemMode:state.pool.isMayhemMode,creatorFeeBps:state.pool.creatorFeeBps});
  const buy=selectV3PumpBuy(await PUMP_AMM_SDK.buyQuoteInput(state,new BN(String(quote)),1));
  // Own-coin milestones: market cap from the signer's own finalized reserves,
  // mint supply and an independent SOL/USD reference.
  const marketCapUsdMicros=config.ownCoin?agencyMarketCapMicros({supply:String(unpackMint(mint,mintInfo,mintInfo.owner).supply),
    baseReserve:String(state.poolBaseAmount),quoteReserve:String(state.poolQuoteAmount),
    virtualQuoteReserve:String(state.pool.virtualQuoteReserves||0),solUsd:await solUsd()}):undefined;
  const choices=new Map([[9,state.globalConfig.protocolFeeRecipients],
    [buy.keys.length-2,state.globalConfig.buybackFeeRecipients]]);
  return{curve:false,pumpBuyInstruction:buy,baseTokenProgram:mintInfo.owner,marketCapUsdMicros,
    spendableQuoteIn:String(quote),minBaseAmountOut:String(protectedV3BuybackMinimum(output.base.toString())),recipientChoices:choices};
}
