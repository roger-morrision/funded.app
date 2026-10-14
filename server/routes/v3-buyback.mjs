import { isDeepStrictEqual } from 'node:util';
import bs58 from 'bs58';
import { Connection, PublicKey, TransactionInstruction } from '@solana/web3.js';
import { deriveMintVaultsV3 } from '../../mint-router-v3.js';
import { verifyV3LaunchRouterReadiness } from '../v3-launch-readiness.mjs';
import { loadFinalizedV3Settlement } from '../v3-settlement-proof.mjs';
import { v3AllocationPlan } from '../v3-allocation-plan.mjs';
import { buildV3BuybackInstruction, v3BuybackId } from '../v3-buyback-instruction.mjs';
import { quoteV3Buyback } from '../v3-buyback-quote.mjs';
import { loadFinalizedV3Buyback } from '../v3-buyback-proof.mjs';
import { prepareV3BuybackTransaction, verifyV3BuybackTransaction,
  submitV3BuybackTransaction } from '../v3-buyback-transaction.mjs';
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
  submit=submitV3BuybackTransaction, originAllowed=allowedAuthOrigin }) {
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
    const collectionSignature=decodeURIComponent(match[2]);
    if(!SIGNATURE.test(collectionSignature))
      return json(res,400,{error:'A finalized V3 collection signature is required.'});
    const programId=String(env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID||'');
    const hash=String(env.FUNDED_V3_PROGRAM_DATA_SHA256||'');
    const lookupAddress=String(env.FUNDED_V3_BUYBACK_LOOKUP_TABLE||'');
    if(!programId||!/^[a-f0-9]{64}$/i.test(hash)||!lookupAddress)
      return json(res,503,{error:'Approved V3 program and buyback lookup table are required.'});
    let authority;
    try{authority=v3AuthorityKeypair();}
    catch{return json(res,503,{error:'V3 authority signer is unavailable.'});}
    const state=await store.read();
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
    const connection=connectionFactory(solanaRpcUrl);
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
    const id=v3BuybackId([collectionSignature]);
    const input=await body(req);
    const saved=state.v3BuybackOrders?.[collectionSignature];
    if(saved && (saved.programId!==programId
      || saved.approvedHash!==hash.toLowerCase()
      || saved.buybackId!==id.toString('hex')
      || saved.maxTotalDebit!==plan.protocol.buybackLamports))
      return json(res,409,{error:'The V3 buyback belongs to a different approved program or allocation.'});
    const proofFor=async row=>loadProof({connection,signature:row.signature,
      programId,sourceMint:mint,creator:launch.creatorWallet,
      initialAuthority:launch.pumpFeeRoute.initialAuthority,
      authority:authority.publicKey,baseTokenProgram:row.baseTokenProgram,
      buybackId:id,spendableQuoteIn:row.spendableQuoteIn,
      minBaseAmountOut:row.minBaseAmountOut,maxTotalDebit:row.maxTotalDebit,
      pumpBuyInstruction:storedPumpInstruction(row),split:launch.pumpFeeRoute.protocolSplit});
    if(saved?.signature){
      const proof=await proofFor(saved);
      if(proof){
        const finalized=await store.update(current=>{
          const row=current.v3BuybackOrders?.[collectionSignature];
          if(row?.signature!==saved.signature) return null;
          return current.v3BuybackOrders[collectionSignature]={...row,...proof,
            status:'finalized',finalizedAt:new Date().toISOString()};
        });
        return finalized?json(res,200,finalized)
          :json(res,409,{error:'The V3 buyback changed during reconciliation.'});
      }
      return json(res,409,{error:'A submitted V3 buyback is awaiting finalized burn proof; reconcile its recorded signature.'});
    }
    if(saved?.status==='prepared'&&Date.parse(saved.expiresAt)>Date.now()){
      if(!input?.creatorSignedTransaction)
        return json(res,202,{status:'awaiting-creator-signature',mint,
          collectionSignature,amountLamports:saved.maxTotalDebit,
          minimumBoughtBaseUnits:saved.minBaseAmountOut,
          transaction:saved.preparedTransaction,expiresAt:saved.expiresAt});
      const signed=verifyV3BuybackTransaction({
        signedTransaction:input.creatorSignedTransaction,
        preparedTransaction:saved.preparedTransaction,
        authority:authority.publicKey,creator:launch.creatorWallet});
      signed.sign([authority]);
      const signature=bs58.encode(signed.signatures[0]);
      const locked=await store.update(current=>{
        const row=current.v3BuybackOrders?.[collectionSignature];
        if(row?.status!=='prepared'||row.preparedTransaction!==saved.preparedTransaction)
          return false;
        row.status='verification-pending';row.signature=signature;
        row.signedTransaction=Buffer.from(signed.serialize()).toString('base64');
        row.submittedAt=new Date().toISOString();return true;
      });
      if(!locked) return json(res,409,{error:'The V3 buyback changed before submission.'});
      const submitted=await submit({connection,transaction:signed,authority});
      if(submitted!==signature) throw new Error('Submitted V3 buyback signature changed.');
      const proof=await proofFor({...saved,signature});
      if(!proof) return json(res,503,{error:'Finalized V3 burn proof is unavailable; reconcile before retrying.'});
      const finalized=await store.update(current=>{
        const row=current.v3BuybackOrders?.[collectionSignature];
        if(row?.signature!==signature)return null;
        return current.v3BuybackOrders[collectionSignature]={...row,...proof,
          status:'finalized',finalizedAt:new Date().toISOString()};
      });
      return finalized?json(res,200,finalized)
        :json(res,409,{error:'V3 buyback state changed after finality.'});
    }
    if(input?.creatorSignedTransaction)
      return json(res,409,{error:'The buyback quote expired; prepare and sign a fresh transaction.'});
    const vault=deriveMintVaultsV3(programId,mint)[6];
    const quoted=await quote({connection,vault,
      budgetLamports:plan.protocol.buybackLamports});
    if(quoted.maxTotalDebit!==plan.protocol.buybackLamports)
      return json(res,409,{error:'The V3 market quote differs from the signed buyback allocation.'});
    const built=buildV3BuybackInstruction({programId,sourceMint:mint,
      authority:authority.publicKey,creator:launch.creatorWallet,buybackId:id,
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
    const row={status:'prepared',mint,collectionSignature,
      programId,approvedHash:hash.toLowerCase(),
      settlementSignature:settled.settlementSignature,
      buybackId:id.toString('hex'),
      baseTokenProgram:quoted.baseTokenProgram.toBase58(),
      spendableQuoteIn:quoted.spendableQuoteIn,
      minBaseAmountOut:quoted.minBaseAmountOut,
      maxTotalDebit:quoted.maxTotalDebit,
      pumpProgram:quoted.pumpBuyInstruction.programId.toBase58(),
      pumpData:Buffer.from(quoted.pumpBuyInstruction.data).toString('base64'),
      pumpKeys:quoted.pumpBuyInstruction.keys.map(key=>({
        pubkey:key.pubkey.toBase58(),isSigner:key.isSigner,isWritable:key.isWritable})),
      preparedTransaction,expiresAt,createdAt:new Date().toISOString()};
    const prepared=await store.update(current=>{
      current.v3BuybackOrders||={};
      const existing=current.v3BuybackOrders[collectionSignature];
      if(existing?.signature||existing?.status==='finalized'
        ||existing?.status==='prepared'&&Date.parse(existing.expiresAt)>Date.now())
        return null;
      return current.v3BuybackOrders[collectionSignature]=row;
    });
    return prepared?json(res,202,{status:'awaiting-creator-signature',mint,
      collectionSignature,amountLamports:row.maxTotalDebit,
      minimumBoughtBaseUnits:row.minBaseAmountOut,
      transaction:row.preparedTransaction,expiresAt})
      :json(res,409,{error:'Another V3 buyback preparation is active.'});
  };
}
