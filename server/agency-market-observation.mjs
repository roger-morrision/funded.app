import {createHash} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
import {NATIVE_MINT,TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,unpackMint,unpackAccount,getAssociatedTokenAddressSync} from '@solana/spl-token';
import {PUMP_SDK,PUMP_PROGRAM_ID,bondingCurvePda} from '@pump-fun/pump-sdk';
import {PUMP_AMM_SDK,PUMP_AMM_PROGRAM_ID,canonicalPumpPoolPda} from '@pump-fun/pump-swap-sdk';
import {allocationAuditHash} from './allocation-audit-hash.mjs';
import {DEVNET_GENESIS_HASH} from './automatic-reward-chain.mjs';
import {createSolUsdQuoteReader} from './price-quote.mjs';

const maxAge=60000;
export function agencyMarketCapMicros({supply,baseReserve,quoteReserve,virtualQuoteReserve='0',solUsd}){
  const exact=value=>{if(!/^(0|[1-9]\d{0,19})$/.test(String(value)))throw new Error('Exact pool and supply base units are required.');return BigInt(value);};
  const supplyN=exact(supply),base=exact(baseReserve),quote=exact(quoteReserve)+exact(virtualQuoteReserve),price=String(solUsd);
  // Do not round a floating-point market cap across a milestone boundary.
  if(!/^[1-9]\d{0,6}(?:\.\d{1,8})?$/.test(price)||supplyN===0n||base===0n||quote===0n)throw new Error('A positive bounded pool and SOL/USD quote are required.');
  const [whole,fraction='']=price.split('.'),scale=10n**BigInt(fraction.length),usd=BigInt(whole+fraction);
  const result=supplyN*quote*usd*1000000n/(base*1000000000n*scale);
  if(result>0xffffffffffffffffn)throw new Error('Market cap exceeds the protected observation range.');
  return String(result);
}

// One finalized bank snapshot binds the canonical pool, mint supply, completed
// Pump curve and both custody reserves. USD is an off-chain reference, not a
// contract oracle or a claim that Devnet assets have realizable dollar value.
export async function readAgencyMarketObservation({connection,mint,readSolUsd=createSolUsdQuoteReader(),now=()=>Date.now(),
  decodePool=account=>PUMP_AMM_SDK.decodePool(account),decodeCurve=account=>PUMP_SDK.decodeBondingCurveNullable(account)}){
  const key=new PublicKey(mint),poolKey=canonicalPumpPoolPda(key,NATIVE_MINT),curveKey=bondingCurvePda(key);
  if(await connection.getGenesisHash()!==DEVNET_GENESIS_HASH)throw new Error('Agency market observation requires Devnet.');
  const first=await connection.getAccountInfo(poolKey,'finalized');
  if(!first)throw Object.assign(new Error('The canonical own-coin pool is not deployed.'),{code:'AGENCY_MARKET_NOT_MIGRATED'});
  if(!first.owner.equals(PUMP_AMM_PROGRAM_ID))throw new Error('A canonical finalized PumpSwap pool is required.');
  const layout=decodePool(first),addresses=[poolKey,key,curveKey,layout.poolBaseTokenAccount,layout.poolQuoteTokenAccount];
  const[snapshot,usd]=await Promise.all([connection.getMultipleAccountsInfoAndContext(addresses,{commitment:'finalized'}),readSolUsd()]);
  const slot=snapshot?.context?.slot;
  if(!Number.isSafeInteger(slot)||slot<1||snapshot.value?.length!==5)throw new Error('A complete finalized market snapshot is required.');
  const [poolInfo,mintInfo,curveInfo,baseInfo,quoteInfo]=snapshot.value,observedAt=await connection.getBlockTime(slot),at=now();
  if(!Number.isSafeInteger(observedAt)||at-observedAt*1000<0||at-observedAt*1000>maxAge||usd?.source!=='coingecko'
    ||!Number.isSafeInteger(Date.parse(usd.fetchedAt))||at-Date.parse(usd.fetchedAt)<0||at-Date.parse(usd.fetchedAt)>maxAge)
    throw new Error('Fresh finalized reserves and an independently fetched SOL/USD reference are required.');
  if(!poolInfo?.owner.equals(PUMP_AMM_PROGRAM_ID)||!curveInfo?.owner.equals(PUMP_PROGRAM_ID)
    ||![TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID].some(program=>mintInfo?.owner.equals(program)))throw new Error('Market account ownership differs.');
  const pool=decodePool(poolInfo),curve=decodeCurve(curveInfo);
  if(curve?.complete===false)throw Object.assign(new Error('The Pump curve is not complete.'),{code:'AGENCY_MARKET_NOT_MIGRATED'});
  const baseAta=getAssociatedTokenAddressSync(key,poolKey,true,mintInfo.owner),quoteAta=getAssociatedTokenAddressSync(NATIVE_MINT,poolKey,true,TOKEN_PROGRAM_ID);
  if(!pool.baseMint.equals(key)||!pool.quoteMint.equals(NATIVE_MINT)||!pool.poolBaseTokenAccount.equals(baseAta)
    ||!pool.poolQuoteTokenAccount.equals(quoteAta)||!layout.poolBaseTokenAccount.equals(baseAta)||!layout.poolQuoteTokenAccount.equals(quoteAta)
    ||curve?.complete!==true)throw new Error('A completed Pump curve and its canonical own-coin SOL pool are required.');
  const supply=unpackMint(key,mintInfo,mintInfo.owner),base=unpackAccount(baseAta,baseInfo,mintInfo.owner),quote=unpackAccount(quoteAta,quoteInfo,TOKEN_PROGRAM_ID);
  if(!supply.isInitialized||!base.isInitialized||!quote.isInitialized||base.isFrozen||quote.isFrozen
    ||!base.mint.equals(key)||!quote.mint.equals(NATIVE_MINT)||!base.owner.equals(poolKey)||!quote.owner.equals(poolKey)
    ||base.amount===0n||quote.amount===0n)throw new Error('Canonical reserve custody and live liquidity are incomplete.');
  const marketCapUsdMicros=agencyMarketCapMicros({supply:supply.supply,baseReserve:base.amount,quoteReserve:quote.amount,
    virtualQuoteReserve:pool.virtualQuoteReserves.toString(),solUsd:usd.priceUsd});
  const evidence={mint:key.toBase58(),pool:poolKey.toBase58(),slot,observedAt,cluster:'devnet',commitment:'finalized',
    source:'canonical-finalized-PumpSwap-reserves-and-coingecko-reference',quoteCurrency:'USD',marketCapUsdMicros,
    supply:String(supply.supply),baseReserve:String(base.amount),quoteReserve:String(quote.amount),virtualQuoteReserve:pool.virtualQuoteReserves.toString(),
    solUsd:String(usd.priceUsd),solUsdFetchedAt:usd.fetchedAt,
    accountHashes:snapshot.value.map(info=>createHash('sha256').update(info.data).digest('hex'))};
  const fixed=new Map(addresses.map((address,i)=>[address.toBase58(),snapshot.value[i]]));
  const pinnedConnection=new Proxy(connection,{get(target,name){
    if(name==='getMultipleAccountsInfo')return async keys=>{
      const unknown=keys.filter(address=>!fixed.has(address.toBase58()));
      const found=unknown.length?await target.getMultipleAccountsInfo(unknown,{commitment:'finalized',minContextSlot:slot}):[];
      const extra=new Map(unknown.map((address,i)=>[address.toBase58(),found[i]]));
      return keys.map(address=>fixed.get(address.toBase58())||extra.get(address.toBase58())||null);
    };
    if(name==='getAccountInfo')return async address=>fixed.get(address.toBase58())||target.getAccountInfo(address,{commitment:'finalized',minContextSlot:slot});
    const value=target[name];return typeof value==='function'?value.bind(target):value;
  }});
  return{...evidence,verified:true,observationHash:allocationAuditHash(evidence),poolKey,mintKey:key,baseTokenProgram:mintInfo.owner,pinnedConnection};
}
