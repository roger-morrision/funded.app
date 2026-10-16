import { isDeepStrictEqual } from 'node:util';
import bs58 from 'bs58';
import { Connection, PublicKey, TransactionInstruction, VersionedTransaction } from '@solana/web3.js';
import { deriveMintVaultsV3 } from '../../mint-router-v3.js';
import { verifyV3LaunchRouterReadiness } from '../v3-launch-readiness.mjs';
import { loadFinalizedV3Settlement } from '../v3-settlement-proof.mjs';
import { v3AllocationPlan } from '../v3-allocation-plan.mjs';
import { buildV3BuybackInstruction, v3BuybackId, v3BuybackOnchainId } from '../v3-buyback-instruction.mjs';
import { quoteV3Buyback } from '../v3-buyback-quote.mjs';
import { loadFinalizedV3Buyback } from '../v3-buyback-proof.mjs';
import { prepareV3BuybackTransaction, submitV3BuybackTransaction } from '../v3-buyback-transaction.mjs';
import { readV3BuybackDashboard } from '../v3-buyback-dashboard.mjs';
import { buybackTriggerLamports } from '../devnet-qa-minimums.mjs';
import { v3BuybackNextOrder, v3BuybackSourceSpent } from '../v3-buyback-orders.mjs';
import { onchainBuybackSource, queueV3BuybackCycle } from '../v3-buyback-cycle.mjs';
import { finalizedUnindexedV3Budget } from '../v3-unindexed-buyback.mjs';
import { allowedAuthOrigin } from '../x-auth.mjs';

const SIGNATURE=/^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

function storedPumpInstruction(row) {
  return new TransactionInstruction({ programId:new PublicKey(row.pumpProgram),
    data:Buffer.from(row.pumpData,'base64'), keys:row.pumpKeys.map(key=>({
      pubkey:new PublicKey(key.pubkey),isSigner:key.isSigner,isWritable:key.isWritable })) });
}

export function createV3BuybackRoutes({ body, store, solanaCluster,
  solanaRpcUrl, v3AuthorityKeypair, respond, env=process.env,
  connectionFactory=url=>new Connection(url,'finalized'),
  verifyReadiness=verifyV3LaunchRouterReadiness,
  loadSettlement=loadFinalizedV3Settlement,
  quote=quoteV3Buyback, loadProof=loadFinalizedV3Buyback,
  submit=submitV3BuybackTransaction, originAllowed=allowedAuthOrigin,
  readDashboard=readV3BuybackDashboard }) {
  const json=(...args)=>{respond(...args);return true;};
  return async function handleV3Buyback(req,res,url) {
    const match=req.method==='POST' ? url.pathname.match(
      /^\/api\/tokens\/([^/]+)\/v3-buyback\/([^/]+)$/) : null;
    if(!match) return false;
    if(solanaCluster!=='devnet'||!originAllowed(req,env.CORS_ORIGIN))
      return json(res,403,{error:'V3 buybacks require the Devnet app origin.'});
    if(env.FUNDED_V3_BUYBACK_ENABLED!=='true')
      return json(res,503,{error:'V3 buyback is not activated.'});
    let mint;
    try{mint=new PublicKey(decodeURIComponent(match[1])).toBase58();}
    catch{return json(res,400,{error:'A valid V3 source mint is required.'});}
    const requestedSource=decodeURIComponent(match[2]);
    const unindexed=requestedSource==='onchain';
    if(!unindexed && !SIGNATURE.test(requestedSource))
      return json(res,400,{error:'A finalized V3 collection signature is required.'});
    const collectionSignature=unindexed?onchainBuybackSource(mint):requestedSource;
    const programId=String(env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID||'');
    const thresholdLamports=buybackTriggerLamports(solanaCluster,env);
    const thresholdSol=`${Number(thresholdLamports)/1_000_000_000} SOL`;
    const hash=String(env.FUNDED_V3_PROGRAM_DATA_SHA256||'');
    const lookupAddress=String(env.FUNDED_V3_BUYBACK_LOOKUP_TABLE||'');
    if(!programId||!/^[a-f0-9]{64}$/i.test(hash)||!lookupAddress)
      return json(res,503,{error:'Approved V3 program and buyback lookup table are required.'});
    let authority;
    try{authority=v3AuthorityKeypair();}
    catch{return json(res,503,{error:'V3 authority signer is unavailable.'});}
    const state=await store.read();
    const connection=connectionFactory(solanaRpcUrl);
    let creator, initialAuthority, split=null, remaining, settlementSignature=null;
    if(unindexed){
      if(Object.values(state.v3Settlements||{}).some(row=>row.mint===mint))
        return json(res,409,{error:'This mint has indexed settlements; use their verified collection routes.'});
      const pending=v3BuybackNextOrder(state,collectionSignature).row;
      const reconciling=Boolean(pending?.signature&&pending.sourceKind==='onchain-policy'
        &&pending.mint===mint&&pending.programId===programId);
      let vault;
      if(reconciling){
        creator=pending.creator;initialAuthority=pending.initialAuthority;
      }else{
        const dashboard=await readDashboard({state,programId,connection,thresholdLamports});
        vault=dashboard.unindexedVaults?.find(row=>row.mint===mint);
        if(dashboard.unindexedStatus!=='verified'||vault?.status!=='verified')
          return json(res,409,{error:'Finalized unindexed policy and exact vault custody are required.'});
        creator=vault.creator;initialAuthority=vault.initialAuthority;
      }
      if(!authority?.publicKey||initialAuthority!==authority.publicKey.toBase58()||!creator)
        return json(res,409,{error:'Finalized unindexed policy and exact vault custody are required.'});
      const readiness=await verifyReadiness({connection,programId,
        expectedProgramDataSha256:hash,mint,creatorWallet:creator,
        initialAuthority,split:null});
      if(!readiness.ready)
        return json(res,409,{error:'The approved V3 buyback program or mint policy is not verified.'});
      if(reconciling) remaining=0n;
      else{
        const budget=await finalizedUnindexedV3Budget({connection,programId,mint,
          creator,initialAuthority});
        if(!budget || budget.vault.toBase58()!==vault.address
          ||String(budget.remaining)!==String(vault.pendingLamports))
          return json(res,409,{error:'Finalized unindexed policy and exact vault custody changed.'});
        remaining=budget.remaining;
      }
    } else {
    const launch=state.launches?.[mint];
    const collection=state.collections?.[collectionSignature];
    const settled=state.v3Settlements?.[collectionSignature];
    if(!authority?.publicKey||!launch?.onchainVerified||launch.cluster!=='devnet'
      ||launch.mint!==mint||launch.pumpFeeRoute?.scope!=='per-mint-v3'
      ||launch.pumpFeeRoute.programId!==programId
      ||launch.pumpFeeRoute.initialAuthority!==authority.publicKey.toBase58()
      ||collection?.mint!==mint||collection.signature!==collectionSignature
      ||collection.scope!=='per-mint-v3'||collection.status!=='collected'
      ||collection.onchainVerified!==true||collection.programId!==programId
      ||!/^[a-f0-9]{64}$/.test(String(collection.claimId||''))
      ||settled?.status!=='finalized'||settled.mint!==mint
      ||settled.collectionSignature!==collectionSignature)
      return json(res,409,{error:'Matching verified V3 launch, collection, and settlement are required.'});
    const readiness=await verifyReadiness({connection,programId,
      expectedProgramDataSha256:hash,mint,creatorWallet:launch.creatorWallet,
      initialAuthority:launch.pumpFeeRoute.initialAuthority,split:launch.pumpFeeRoute.protocolSplit});
    if(!readiness.ready||readiness.configuredRouter!==collection.router)
      return json(res,409,{error:'The approved V3 buyback program or mint policy is not verified.'});
    const settlement=await loadSettlement({connection,
      signature:settled.settlementSignature,programId,mint,
      authority:launch.pumpFeeRoute.initialAuthority,creator:launch.creatorWallet,
      claimId:Buffer.from(collection.claimId,'hex'),
      expectedLamports:collection.collectedLamports,split:launch.pumpFeeRoute.protocolSplit});
    if(!settlement||settlement.signature!==settled.settlementSignature)
      return json(res,409,{error:'Finalized V3 settlement proof is unavailable.'});
    let plan;
    try{plan=v3AllocationPlan({launch,settlement:{...settlement,programId,
      collectionSignature,settlementSignature:settled.settlementSignature}});}
    catch{return json(res,409,{error:'The buyback allocation cannot be reconstructed.'});}
    if(!isDeepStrictEqual(plan,settled.allocationPlan)
      ||BigInt(plan.protocol.buybackLamports)<=0n)
      return json(res,409,{error:'An exact payable V3 buyback allocation is required.'});
    creator=launch.creatorWallet;initialAuthority=launch.pumpFeeRoute.initialAuthority;
    split=launch.pumpFeeRoute.protocolSplit;
    settlementSignature=settled.settlementSignature;
    remaining=BigInt(plan.protocol.buybackLamports)
      -v3BuybackSourceSpent(state,collectionSignature,programId);
    }
    const input=await body(req);
    if (input && Object.keys(input).length) return json(res,400,{error:'Automatic buyback accepts no wallet-signed input.'});
    let next=v3BuybackNextOrder(state,collectionSignature);
    let saved=next.row;
    let id=unindexed?v3BuybackOnchainId(mint,next.round)
      :v3BuybackId([collectionSignature],next.round);
    if(saved && (saved.programId!==programId
      || saved.approvedHash!==hash.toLowerCase()
      || saved.buybackId!==id.toString('hex')
      || unindexed && (saved.sourceKind!=='onchain-policy'
        || saved.creator!==creator || saved.initialAuthority!==initialAuthority)
      || !saved.signature && BigInt(saved.maxTotalDebit||'0')>remaining))
      return json(res,409,{error:'The V3 buyback belongs to a different approved program or allocation.'});
    const proofFor=async row=>loadProof({connection,signature:row.signature,
      programId,sourceMint:mint,creator,
      initialAuthority,
      authority:authority.publicKey,baseTokenProgram:row.baseTokenProgram,
      buybackId:Buffer.from(row.buybackId,'hex'),spendableQuoteIn:row.spendableQuoteIn,
      minBaseAmountOut:row.minBaseAmountOut,maxTotalDebit:row.maxTotalDebit,
      pumpBuyInstruction:storedPumpInstruction(row),split});
    if(saved?.signature){
      const proof=await proofFor(saved);
      if(proof){
        const finalized=await store.update(current=>{
          const row=current.v3BuybackOrders?.[next.key];
          if(row?.signature!==saved.signature) return null;
          return current.v3BuybackOrders[next.key]={...row,...proof,
            status:'finalized',finalizedAt:new Date().toISOString()};
        });
        return finalized?json(res,200,finalized)
          :json(res,409,{error:'The V3 buyback changed during reconciliation.'});
      }
      const outcome=(await connection.getSignatureStatuses([saved.signature],{
        searchTransactionHistory:true })).value?.[0];
      if(outcome?.confirmationStatus==='finalized'&&outcome.err){
        const retried=await store.update(current=>{
          const row=current.v3BuybackOrders?.[next.key];
          if(row?.signature!==saved.signature)return null;
          const {signature,signedTransaction,preparedTransaction,expiresAt,
            submittedAt,...rest}=row;
          return current.v3BuybackOrders[next.key]={...rest,status:'queued',
            failedSignatures:[...(row.failedSignatures||[]),saved.signature]};
        });
        return retried?json(res,409,{error:'Finalized buyback attempt failed without a vault debit; queued for a new protected quote.'})
          :json(res,409,{error:'The failed V3 buyback changed during reconciliation.'});
      }
      return json(res,409,{error:'A submitted V3 buyback is awaiting finalized burn proof; reconcile its recorded signature.'});
    }
    if(remaining<=0n)return json(res,409,{error:'This V3 buyback allocation is fully spent.'});
    if(saved?.status==='prepared'&&Date.parse(saved.expiresAt)>Date.now())
      return json(res,409,{error:'An older creator-signed quote must expire before automatic execution.'});
    if(saved?.status==='prepared'){
      let cycleId=saved.cycleId;
      if(!cycleId){
        const dashboard=await readDashboard({state,programId,connection,thresholdLamports});
        if(dashboard.status!=='verified'||!dashboard.triggerReached)
          return json(res,409,{error:`Finalized buyback vaults have not reached the ${thresholdSol} trigger.`});
        cycleId=`v3-buyback:${Date.now()}`;
      }
      saved=await store.update(current=>{
        const row=current.v3BuybackOrders?.[next.key];
        if(row?.status!=='prepared'||Date.parse(row.expiresAt)>Date.now())return null;
        const {preparedTransaction,expiresAt,...rest}=row;
        return current.v3BuybackOrders[next.key]={...rest,status:'queued',cycleId};
      });
      if(!saved)return json(res,409,{error:'The expired V3 quote changed during recovery.'});
    }
    if(saved?.status!=='queued') {
      // A finished round's residue waits for a new threshold cycle. An
      // already queued row may finish after the dashboard drops below it.
      const dashboard=await readDashboard({state,programId,connection,thresholdLamports});
      if(dashboard.status!=='verified'||!dashboard.triggerReached)
        return json(res,409,{error:`Finalized buyback vaults have not reached the ${thresholdSol} trigger.`});
      const cycleId=`v3-buyback:${Date.now()}`;
      saved=await store.update(current=>{
        queueV3BuybackCycle(current,{dashboard,programId,hash,cycleId});
        return structuredClone(current.v3BuybackOrders[next.key]||null);
      });
      if(!saved||saved.status!=='queued')
        return json(res,409,{error:`The ${thresholdSol} buyback cycle could not be queued.`});
    }
    const vault=deriveMintVaultsV3(programId,mint)[6];
    const quoted=await quote({connection,vault,
      budgetLamports:String(remaining)});
    if(BigInt(quoted.maxTotalDebit)<=0n
      ||BigInt(quoted.maxTotalDebit)>remaining)
      return json(res,409,{error:'The V3 market quote exceeds the remaining buyback allocation.'});
    const built=buildV3BuybackInstruction({programId,sourceMint:mint,
      authority:authority.publicKey,creator,buybackId:id,
      ...quoted});
    const lookup=await connection.getAddressLookupTable(new PublicKey(lookupAddress),{
      commitment:'finalized'});
    if(!lookup.value||!lookup.value.key.equals(new PublicKey(lookupAddress)))
      return json(res,503,{error:'The V3 buyback address lookup table is unavailable.'});
    const latest=await connection.getLatestBlockhash('finalized');
    const preparedTransaction=prepareV3BuybackTransaction({
      instruction:built.instruction,authority:authority.publicKey,
      blockhash:latest.blockhash,lookupTable:lookup.value});
    const expiresAt=new Date(Date.now()+60_000).toISOString();
    const signed=VersionedTransaction.deserialize(Buffer.from(preparedTransaction,'base64'));
    signed.sign([authority]);
    const signature=bs58.encode(signed.signatures[0]);
    const row={status:'verification-pending',mint,collectionSignature,
      programId,approvedHash:hash.toLowerCase(),
      settlementSignature,sourceKind:unindexed?'onchain-policy':'collection',
      ...(unindexed?{creator,initialAuthority}:{}),
      buybackId:id.toString('hex'),
      baseTokenProgram:quoted.baseTokenProgram.toBase58(),
      spendableQuoteIn:quoted.spendableQuoteIn,
      minBaseAmountOut:quoted.minBaseAmountOut,
      maxTotalDebit:quoted.maxTotalDebit,
      pumpProgram:quoted.pumpBuyInstruction.programId.toBase58(),
      pumpData:Buffer.from(quoted.pumpBuyInstruction.data).toString('base64'),
      pumpKeys:quoted.pumpBuyInstruction.keys.map(key=>({
        pubkey:key.pubkey.toBase58(),isSigner:key.isSigner,isWritable:key.isWritable})),
      preparedTransaction,expiresAt,signature,
      signedTransaction:Buffer.from(signed.serialize()).toString('base64'),
      submittedAt:new Date().toISOString(),createdAt:new Date().toISOString()};
    const prepared=await store.update(current=>{
      current.v3BuybackOrders||={};
      const existing=current.v3BuybackOrders[next.key];
      if(existing?.signature||existing?.status==='finalized'
        ||existing?.status==='prepared'&&Date.parse(existing.expiresAt)>Date.now())
        return null;
      if(existing?.status!=='queued'||existing.cycleId!==saved.cycleId)return null;
      return current.v3BuybackOrders[next.key]={...row,cycleId:saved.cycleId,round:next.round};
    });
    if(!prepared)return json(res,409,{error:'Another V3 buyback execution is active.'});
    const submitted=await submit({connection,transaction:signed,authority});
    if(submitted!==signature) throw new Error('Submitted V3 buyback signature changed.');
    const proof=await proofFor(row);
    if(!proof)return json(res,503,{error:'Finalized V3 burn proof is unavailable; reconcile the recorded signature.'});
    const finalized=await store.update(current=>{
      const active=current.v3BuybackOrders?.[next.key];
      if(active?.signature!==signature)return null;
      return current.v3BuybackOrders[next.key]={...active,...proof,
        status:'finalized',finalizedAt:new Date().toISOString()};
    });
    return finalized?json(res,200,finalized)
      :json(res,409,{error:'V3 buyback state changed after finality.'});
  };
}
