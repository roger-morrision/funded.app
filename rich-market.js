import {PublicKey,SystemProgram} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,NATIVE_MINT,unpackMint} from '@solana/spl-token';
import {PUMP_SDK,PUMP_PROGRAM_ID,bondingCurvePda} from '@pump-fun/pump-sdk';
import {canonicalPumpPoolPda} from '@pump-fun/pump-swap-sdk';
import {fetchVerifiedPoolSnapshot,buildVerifiedPoolTradeTransaction,fetchVerifiedPoolBuyQuote,
  buildTradeTransaction,formatBondingCurveSnapshot} from './pump-trading.js';

// One market resolver for RICH valuation, promotion/listing prices and wallet
// purchases. A failed RPC read never proves that a token has migrated.
export async function fetchRichMarketSnapshot({connection,mint,poolAddress,
  readPool=fetchVerifiedPoolSnapshot,decodeCurve=account=>PUMP_SDK.decodeBondingCurve(account)}) {
  const key=new PublicKey(mint),curveKey=bondingCurvePda(key);
  const {context,value:[curveAccount,mintAccount]}=await connection.getMultipleAccountsInfoAndContext([curveKey,key],'finalized');
  if(!mintAccount||![TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID].some(p=>p.equals(mintAccount.owner)))
    throw Error('The $RICH mint is not a verified SPL token.');
  const mintState=unpackMint(key,mintAccount,mintAccount.owner);
  if(!mintState.isInitialized||mintState.decimals>18)throw Error('The $RICH mint is not initialized.');
  if(curveAccount){
    if(!curveAccount.owner.equals(PUMP_PROGRAM_ID))throw Error('The $RICH bonding curve owner is invalid.');
    const curve=decodeCurve(curveAccount);
    if(!curve.quoteMint?.equals(NATIVE_MINT)&&!curve.quoteMint?.equals(PublicKey.default))
      throw Error('The $RICH market must be quoted in SOL.');
    if(!curve.complete){
      const quote=Number(curve.virtualQuoteReserves.toString())/1e9;
      const tokens=Number(curve.virtualTokenReserves.toString())/10**mintState.decimals;
      const price=quote/tokens;
      if(!(price>0&&Number.isFinite(price))||BigInt(curve.realTokenReserves.toString())<=0n)
        throw Error('The $RICH curve has no available liquidity.');
      return {...formatBondingCurveSnapshot({mint:key,bondingCurve:curve,slot:context.slot}),
        market:'pump-curve',pool:null,bondingCurve:curveKey.toBase58(),tokenDecimals:mintState.decimals,
        spotPriceSol:price,quoteReservesSol:Number(curve.realQuoteReserves.toString())/1e9};
    }
    const canonical=canonicalPumpPoolPda(key,NATIVE_MINT);
    if(poolAddress&&!canonical.equals(new PublicKey(poolAddress)))throw Error('The configured $RICH pool does not match its migrated Pump market.');
    poolAddress=canonical.toBase58();
  }
  const pool=poolAddress||canonicalPumpPoolPda(key,NATIVE_MINT).toBase58();
  const snapshot=await readPool({connection,mint:key,poolAddress:pool});
  return {...snapshot,market:'pump-swap',bondingCurve:curveAccount?curveKey.toBase58():null};
}

export async function buildRichTradeTransaction(args){
  const market=await fetchRichMarketSnapshot(args);
  return market.market==='pump-curve'?buildTradeTransaction(args)
    :buildVerifiedPoolTradeTransaction({...args,poolAddress:market.pool});
}

export async function fetchRichBuyQuote(args){
  const market=await fetchRichMarketSnapshot(args);
  if(market.market==='pump-swap')return fetchVerifiedPoolBuyQuote({...args,poolAddress:market.pool});
  // No wallet or signing: discard the SDK's prepared instructions. The same
  // bounded quote calculation is used when a wallet later requests a purchase.
  const {instructions,user,...quote}=await buildTradeTransaction({...args,side:'buy',user:SystemProgram.programId});
  return quote;
}

export function matchesRichPricingMarket(data,{mint,pool}){
  if(data?.fundedMint!==mint)return false;
  if(data.market==='pump-curve')return data.pool===null&&data.bondingCurve===bondingCurvePda(new PublicKey(mint)).toBase58();
  return data.pool===(pool||canonicalPumpPoolPda(new PublicKey(mint),NATIVE_MINT).toBase58());
}
