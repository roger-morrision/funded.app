import { Connection, PublicKey } from '@solana/web3.js';
import { getPumpAmmProgram } from '@pump-fun/pump-swap-sdk';
import { walletTradeRows } from '../wallet-trades.mjs';
import { GENESIS_HASHES } from '../service-status.mjs';
import { allowedAuthOrigin } from '../x-auth.mjs';
import { recordTradeWake, tradeWakeStatus } from '../trade-financial-wakeup.mjs';
import { financialFlowMonitor } from '../financial-flow-monitor.mjs';

export async function verifyTradeWake({connection,mint,wallet,signature,now=Date.now(),maxAgeMs=86400_000}) {
  if(await connection.getGenesisHash()!==GENESIS_HASHES.devnet)throw new Error('Wrong network.');
  const tx=await connection.getTransaction(signature,{commitment:'finalized',maxSupportedTransactionVersion:0});
  if(!tx || !Number.isSafeInteger(tx.blockTime) || tx.blockTime*1000>now+30_000
    || now-tx.blockTime*1000>maxAgeMs)throw new Error('A recent finalized trade is required.');
  const coder=getPumpAmmProgram(connection).coder.events;
  const rows=walletTradeRows({transaction:tx,wallet,reference:{signature,slot:tx.slot,confirmationStatus:'finalized'},
    decodePoolEvent:coder.decode.bind(coder)});
  const trade=rows.find(row=>row.mint===mint&&row.trader===wallet);
  if(!trade)throw new Error('The finalized trade does not match this wallet and mint.');
  // Successful program events plus an actual directional recipient-token change.
  const total=list=>(list||[]).filter(row=>row.owner===wallet&&row.mint===mint)
    .reduce((sum,row)=>sum+BigInt(row.uiTokenAmount.amount),0n);
  const delta=total(tx.meta.postTokenBalances)-total(tx.meta.preTokenBalances);
  if(trade.side==='buy'?delta<=0n:delta>=0n)throw new Error('Trade balance changes are unavailable.');
  const feePayer=(tx.transaction?.message?.staticAccountKeys||tx.transaction?.message?.accountKeys||[])[0];
  return {...trade,networkFeeLamports:Number.isSafeInteger(tx.meta.fee)&&tx.meta.fee>=0?String(tx.meta.fee):null,
    feePayer:typeof feePayer==='string'?feePayer:feePayer?.pubkey?.toBase58?.()||feePayer?.toBase58?.()||null};
}

export function createTradeFinancialWakeRoutes({store,rewardStore,solanaCluster,solanaRpcUrl,
  body,clientKey,requireAuthorized,respond,env=process.env,now=Date.now,
  connectionFactory=url=>new Connection(url,{commitment:'finalized',disableRetryOnRateLimit:true,
    fetch:(target,options)=>fetch(target,{...options,signal:AbortSignal.timeout(10_000)})}),
  verify=verifyTradeWake}) {
  let active=0;
  const json=(...args)=>{respond(...args);return true;};
  return async(req,res,url)=>{
    if(req.method==='GET'&&['/api/automation/wakeup','/api/automation/status'].includes(url.pathname)) {
      if(!requireAuthorized)return json(res,503,{error:'Worker authorization is unavailable.'});
      if(!requireAuthorized(req,res))return true;
      if(url.pathname.endsWith('/status'))return json(res,200,financialFlowMonitor(await store.read(),
        await rewardStore.read(),{now:now(),programId:env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID}));
      return json(res,200,{cluster:solanaCluster,...tradeWakeStatus(await rewardStore.read())});
    }
    if(req.method!=='POST'||url.pathname!=='/api/trades/finalized')return false;
    if(solanaCluster!=='devnet'||!allowedAuthOrigin(req,env.CORS_ORIGIN))
      return json(res,403,{error:'Use the Devnet app origin.'});
    if(!await store.chargeRpcRate(`trade-wake:${clientKey(req)}`,1,12,Math.floor(now()/60_000)*60_000)
      ||!await store.chargeRpcRate('trade-wake:global',1,60,Math.floor(now()/60_000)*60_000))
      return json(res,429,{error:'Trade verification is busy; retry shortly.'});
    const input=await body(req);let mint,wallet;
    try{mint=new PublicKey(input?.mint).toBase58();wallet=new PublicKey(input?.wallet).toBase58();}
    catch{return json(res,400,{error:'A valid trade mint and wallet are required.'});}
    const signature=String(input?.signature||'');
    if(!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature))return json(res,400,{error:'A trade signature is required.'});
    const launch=(await store.read()).launches?.[mint];
    if(!launch?.onchainVerified||launch.cluster!=='devnet'||launch.pumpFeeRoute?.scope!=='per-mint-v3')
      return json(res,409,{error:'This mint has no verified V3 fee route.'});
    if(active>=2)return json(res,429,{error:'Trade verification is busy; retry shortly.'});
    active++;
    try {
      const trade=await verify({connection:connectionFactory(solanaRpcUrl),mint,wallet,signature,now:now()});
      if(trade?.mint!==mint||trade.signature!==signature||trade.trader!==wallet||trade.finalized!==true)
        return json(res,409,{error:'Finalized trade evidence does not match.'});
      const recorded=await recordTradeWake(rewardStore,trade,now());
      return json(res,202,{status:'processing-requested',...recorded,
        ...tradeWakeStatus(await rewardStore.read())});
    } catch(error) {
      if(error.statusCode===503)return json(res,503,{error:'Trade processing is temporarily unavailable.'});
      return json(res,409,{error:'Finalized trade verification is unavailable. Scheduled processing remains active.'});
    } finally{active--;}
  };
}
