import {PublicKey,TransactionMessage,VersionedTransaction} from '@solana/web3.js';
import {createAssociatedTokenAccountIdempotentInstruction} from '@solana/spl-token';
import {buildCommunityClaimInstruction,communityAddresses} from './community-claim-chain.mjs';
import {executeCommunityJournal} from './community-execution-journal.mjs';
import {verifyCommunityDelivery} from './community-delivery-proof.mjs';

export function createCommunityAutoDelivery({connection,store,service,authority,programId,approvedHash,
  execute=executeCommunityJournal,verifyDelivery=verifyCommunityDelivery}) {
  const payer=authority.publicKey;
  async function transaction(instructions,rentSizes){
    const latest=await connection.getLatestBlockhash('finalized');
    const rents=await Promise.all(rentSizes.map(size=>connection.getMinimumBalanceForRentExemption(size,'finalized')));
    return {transaction:new VersionedTransaction(new TransactionMessage({payerKey:payer,
      recentBlockhash:latest.blockhash,instructions}).compileToV0Message()),
      lastValidBlockHeight:latest.lastValidBlockHeight,estimatedRentLamports:String(rents.reduce((a,b)=>a+BigInt(b),0n))};
  }
  function run(record,suffix,prepare,prove){
    if(record.snapshotBasis!=='pump-migration')throw new Error('Automatic delivery requires a real migration snapshot.');
    if(record.authority!==payer.toBase58()||record.programId!==programId)throw new Error('Community delivery authority differs from the saved manifest.');
    return execute({store,connection,authority,key:`community:${record.mint}:${suffix}`,
      intent:{cluster:'devnet',approvedHash,programId,authority:payer.toBase58(),mint:record.mint,
        root:record.manifest.root,snapshotHash:record.manifest.snapshotHash,action:suffix},prepare,prove});
  }
  async function open(record){
    if(record.openingSignature)return {status:'opened'};
    const {drop,approval}=communityAddresses({programId,authority:payer,mint:record.mint});
    // Recover earlier operator/worker openings before constructing any new tx.
    if(await connection.getAccountInfo(drop,'finalized')){
      for(const row of await connection.getSignaturesForAddress(drop,{limit:30},'finalized')){
        if(row.err)continue;
        try{await service.recordOpening({mint:record.mint,signature:row.signature});return {status:'opened'};}catch{}
      }
      throw new Error('Existing community drop needs opening-receipt reconciliation.');
    }
    return run(record,'open',async()=>{
      const instructions=[];
      if(!await connection.getAccountInfo(approval,'finalized'))instructions.push(await service.approvalInstruction({mint:record.mint,appOwner:payer.toBase58()}));
      instructions.push((await service.openingInstruction(record.mint)).instruction);
      // Conservative rent bound includes Token-2022 account extensions.
      return transaction(instructions,[512,512,512]);
    },async row=>{
      if(!await connection.getTransaction(row.signature,{commitment:'finalized',maxSupportedTransactionVersion:0}))return null;
      await service.recordOpening({mint:record.mint,signature:row.signature});
      return {signature:row.signature,finalized:true,balanceDeltaVerified:true};
    });
  }
  async function pay(record,leaf){
    const proof=await service.recipientProof({mint:record.mint,wallet:leaf.recipient,allowRecentProgramProof:false});
    if(proof.status==='claimed')return {status:'already-paid',payment:proof.payment};
    if(proof.status!=='claimable')return {status:proof.status,reason:proof.reason};
    const built=buildCommunityClaimInstruction({programId,authority:payer,mint:record.mint,tokenProgram:record.tokenProgram,
      manifest:record.manifest,recipient:leaf.recipient,payer});
    return run(record,leaf.recipient,async()=>{
      const ata=createAssociatedTokenAccountIdempotentInstruction(payer,new PublicKey(built.recipientToken),
        new PublicKey(leaf.recipient),new PublicKey(record.mint),new PublicKey(record.tokenProgram));
      return transaction([ata,built.instruction],[512,92]);
    },row=>verifyDelivery({connection,signature:row.signature,built,programId,recipient:leaf.recipient,index:leaf.index}));
  }
  return {open,pay};
}
