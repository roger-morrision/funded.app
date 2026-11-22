import {PublicKey,TransactionMessage,VersionedTransaction} from '@solana/web3.js';
import {createAssociatedTokenAccountIdempotentInstruction} from '@solana/spl-token';
import {buildCommunityClaimInstruction,communityAddresses,supportsProgramRecipients} from './community-claim-chain.mjs';
import {executeCommunityJournal} from './community-execution-journal.mjs';
import {verifyCommunityDelivery} from './community-delivery-proof.mjs';

export function createCommunityAutoDelivery({connection,store,service,authority,programId,approvedHash,
  execute=executeCommunityJournal,verifyDelivery=verifyCommunityDelivery,now=Date.now}) {
  const payer=authority.publicKey;
  async function transaction(instructions,rentSizes){
    const latest=await connection.getLatestBlockhash('finalized');
    const rents=await Promise.all(rentSizes.map(size=>connection.getMinimumBalanceForRentExemption(size,'finalized')));
    return {transaction:new VersionedTransaction(new TransactionMessage({payerKey:payer,
      recentBlockhash:latest.blockhash,instructions}).compileToV0Message()),
      lastValidBlockHeight:latest.lastValidBlockHeight,estimatedRentLamports:String(rents.reduce((a,b)=>a+BigInt(b),0n))};
  }
  function run(record,suffix,{prepare,prove,reconcileOnly=false}){
    if(record.snapshotBasis!=='pump-migration')throw new Error('Automatic delivery requires a real migration snapshot.');
    if(record.authority!==payer.toBase58()||record.programId!==programId)throw new Error('Community delivery authority differs from the saved manifest.');
    return execute({store,connection,authority,key:`community:${record.mint}:${suffix}`,
      intent:{cluster:'devnet',approvedHash,programId,authority:payer.toBase58(),mint:record.mint,
        root:record.manifest.root,snapshotHash:record.manifest.snapshotHash,action:suffix},prepare,prove,reconcileOnly});
  }
  // Already-claimed leaves bypass the journal on subsequent passes.
  async function settle(key){
    try{
      const row=(await store.read()).communityExecutions?.[key];
      if(row?.status!=='verification-pending'||!row.signature)return;
      const s=(await connection.getSignatureStatuses([row.signature],{searchTransactionHistory:true})).value?.[0];
      if(s?.confirmationStatus!=='finalized'||s.err)return;
      await store.update(state=>{
        const active=state.communityExecutions?.[key];
        if(active?.signature!==row.signature||active.status!=='verification-pending')return;
        const {signedTransaction,...rest}=active;
        state.communityExecutions[key]={...rest,status:'finalized',finalizedAt:new Date(now()).toISOString(),reconciledBy:'chain-status'};
      });
    }catch{/* Bookkeeping only; delivery state comes from the chain. */}
  }
  async function proveOpening(record,row){
    if(record.openingSignature&&record.openingSignature!==row.signature)return null;
    const receipt=await connection.getTransaction(row.signature,{commitment:'finalized',maxSupportedTransactionVersion:0});
    if(!receipt?.meta||receipt.meta.err)return null;
    await service.recordOpening({mint:record.mint,signature:row.signature});
    return {signature:row.signature,finalized:true,balanceDeltaVerified:true};
  }
  async function reconcileOpening(record){
    const row=(await store.read()).communityExecutions?.[`community:${record.mint}:open`];
    if(row?.status!=='verification-pending'||!row.signature)return null;
    return run(record,'open',{reconcileOnly:true,prove:entry=>proveOpening(record,entry)});
  }
  async function open(record){
    if(record.openingSignature){
      try{await reconcileOpening(record);}catch{/* The recorded opening was already verified. */}
      return {status:'opened'};
    }
    // The deadline stops new attempts, but an earlier opening may still need proof.
    const expiresAt=Number(record.manifest?.expiresAt);
    if(Number.isSafeInteger(expiresAt)&&Math.floor(now()/1000)>=expiresAt){
      const result=await reconcileOpening(record);
      return result?.status==='finalized'?result:{status:'expired'};
    }
    const {drop,approval}=communityAddresses({programId,authority:payer,mint:record.mint});
    // Recover earlier operator/worker openings before constructing any new tx.
    if(await connection.getAccountInfo(drop,'finalized')){
      for(const row of await connection.getSignaturesForAddress(drop,{limit:30},'finalized')){
        if(row.err)continue;
        try{await service.recordOpening({mint:record.mint,signature:row.signature});return {status:'opened'};}catch{}
      }
      throw new Error('Existing community drop needs opening-receipt reconciliation.');
    }
    return run(record,'open',{prepare:async()=>{
      const instructions=[];
      if(!await connection.getAccountInfo(approval,'finalized'))instructions.push(await service.approvalInstruction({mint:record.mint,appOwner:payer.toBase58()}));
      instructions.push(...(await service.openingInstruction(record.mint)).instructions);
      // Conservative rent bound includes Token-2022 account extensions.
      return transaction(instructions,[512,512,512]);
    },prove:row=>proveOpening(record,row)});
  }
  async function pay(record,leaf){
    const proof=await service.recipientProof({mint:record.mint,wallet:leaf.recipient,allowRecentProgramProof:false,forAutomaticDelivery:true});
    if(proof.status==='claimed'){await settle(`community:${record.mint}:${leaf.recipient}`);return {status:'already-paid',payment:proof.payment};}
    if(proof.status!=='claimable')return {status:proof.status,reason:proof.reason};
    const built=buildCommunityClaimInstruction({programId,authority:payer,mint:record.mint,tokenProgram:record.tokenProgram,
      manifest:record.manifest,recipient:leaf.recipient,payer,allowProgramRecipient:supportsProgramRecipients(record)});
    return run(record,leaf.recipient,{prepare:async()=>{
      const ata=createAssociatedTokenAccountIdempotentInstruction(payer,new PublicKey(built.recipientToken),
        new PublicKey(leaf.recipient),new PublicKey(record.mint),new PublicKey(record.tokenProgram));
      return transaction([ata,built.instruction],[512,92]);
    },prove:row=>verifyDelivery({connection,signature:row.signature,built,programId,recipient:leaf.recipient,index:leaf.index})});
  }
  return {open,pay};
}
