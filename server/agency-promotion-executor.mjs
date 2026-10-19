import {TransactionMessage,VersionedTransaction} from '@solana/web3.js';
import {MARKETING_AGENCY_POLICY as POLICY} from '../config/marketing-agency.js';
import {buildAgencyPromotionV3Instruction} from '../agency-mint-router-v3.js';
import {buildXPost} from './x-post-content.mjs';
import {normalizeXPostEvent} from './x-post-store.mjs';
import {allocationAuditHash} from './allocation-audit-hash.mjs';
import {agencyDeliveryHash,loadFinalizedAgencyPromotion} from './agency-promotion-proof.mjs';
import {executeAgencyJournal} from './agency-execution-journal.mjs';
import {readAgencyMintContext} from './agency-mint-context.mjs';

const BUCKET='v3AgencyPromotions';
const clone=value=>structuredClone(value);
function assertCurrent(context,row,{delivered=false}={}){
  const p=context.policy;
  if(!context.verified||context.cluster!=='devnet'||context.programDataSha256!==row.approvedHash
    ||!(p.selectedMask&1)||p.promotionSequence!==row.sequence||BigInt(context.agentRemaining[0])<BigInt(row.amount)
    ||p.promotionRecipient!==row.recipient||!context.promotionRecipientReady
    ||!delivered&&p.lastPromotionAt>0n&&BigInt(Math.floor(Date.now()/1000))-p.lastPromotionAt<BigInt(POLICY.promotionCadenceSeconds))
    throw new Error('The immutable agency selection, delivery sequence, cadence or protected funding changed.');
}

// Queue one immutable post per on-chain sequence. A pending/uncertain post is
// retained across restarts and budget changes; it never generates a fresh ID.
export async function runAgencyPromotion({store,outbox,connection,mint,programId,approvedHash,authority,publisher,
  readContext=readAgencyMintContext,journal=executeAgencyJournal,loadProof=loadFinalizedAgencyPromotion,
  publicOrigin='https://funded.vip',now=()=>Date.now()}){
  const state=await store.read(),current=await readContext({connection,state,mint,programId,approvedHash,authority:authority.publicKey});
  const pending=Object.values(state[BUCKET]||{}).filter(row=>row.mint===mint&&row.status!=='finalized');
  if(pending.length>1)throw new Error('More than one unpaid agency promotion requires audit.');
  let row=pending[0];
  if(!row){
    if(!(current.policy.selectedMask&1)||BigInt(current.agentRemaining[0])===0n)return{status:'not-payable',mint};
    if(current.policy.lastPromotionAt>0n&&BigInt(Math.floor(now()/1000))-current.policy.lastPromotionAt<BigInt(POLICY.promotionCadenceSeconds))
      return{status:'cadence-wait',mint};
    const sequence=current.policy.promotionSequence,key=`agency:${mint}:0:${sequence}`,amount=current.agentRemaining[0];
    const post=buildXPost('agency_promotion',{mint,name:current.launch.name,symbol:current.launch.symbol,
      agencyVersion:POLICY.version,agentId:'x-promotion',sequence,budgetLamports:amount,proofs:current.proofs},
      {cluster:'devnet',publicOrigin});
    const event=normalizeXPostEvent({...post,id:key,occurredAt:new Date(now()).toISOString()});
    const candidate={key,mint,programId:String(programId),approvedHash,sequence,amount,recipient:current.policy.promotionRecipient,
      event,eventHash:allocationAuditHash(event),status:'queued',createdAt:new Date(now()).toISOString()};
    assertCurrent(current,candidate);
    row=await store.update(next=>{
      next[BUCKET]||={};const existing=Object.values(next[BUCKET]).find(value=>value.mint===mint&&value.status!=='finalized');
      if(existing)return clone(existing);
      if(next[BUCKET][key])return clone(next[BUCKET][key]);
      next[BUCKET][key]=candidate;return clone(candidate);
    });
  }
  if(row.status==='finalized')return{status:'finalized',mint,signature:row.signature};
  if(row.approvedHash!==approvedHash||row.programId!==String(programId)||row.eventHash!==allocationAuditHash(row.event))
    throw new Error('Saved agency promotion intent or approved program changed.');
  let published=await outbox.get(row.event.id);
  if(!published){assertCurrent(current,row);published=await outbox.enqueue(row.event);}
  if(allocationAuditHash(published?.event)!==row.eventHash)throw new Error('Agency outbox differs from its immutable funded intent.');
  if(published.status!=='posted')return{status:`x-${published.status}`,mint,eventId:row.event.id};
  const delivery=await publisher.verifyPost({id:published.result?.id,text:row.event.text});
  const hash=agencyDeliveryHash(delivery),postId=delivery.id,postedAt=Math.floor(Date.parse(delivery.createdAt)/1000);
  const intent={cluster:'devnet',mint,programId:String(programId),approvedHash,agent:0,sequence:row.sequence,
    amount:row.amount,recipient:row.recipient,postId,deliveryHash:hash.toString('hex'),postedAt,eventHash:row.eventHash};
  const proofInput={connection,programId,mint,creator:current.launch.creatorWallet,initialAuthority:current.launch.pumpFeeRoute.initialAuthority,
    authority:authority.publicKey,promotionRecipient:row.recipient,postId,sequence:row.sequence,amount:row.amount,text:row.event.text,
    split:current.launch.pumpFeeRoute.protocolSplit,verifyDelivery:input=>publisher.verifyPost(input)};
  const outcome=await journal({store,connection,key:row.key,intent,authority,
    prepare:async()=>{
      const fresh=await readContext({connection,state:await store.read(),mint,programId,approvedHash,authority:authority.publicKey});
      assertCurrent(fresh,row,{delivered:true});
      if(postedAt<Math.floor(Date.parse(row.createdAt)/1000)||BigInt(postedAt)<fresh.policy.lastPromotionAt+BigInt(POLICY.promotionCadenceSeconds)
        &&fresh.policy.lastPromotionAt>0n)throw new Error('Delivered agency post does not satisfy its funded sequence and cadence.');
      const built=buildAgencyPromotionV3Instruction({programId,mint,authority:authority.publicKey,promotionRecipient:row.recipient,
        postId,sequence:row.sequence,amount:row.amount,postedAt,deliveryHash:hash});
      const latest=await connection.getLatestBlockhash('finalized');
      const message=new TransactionMessage({payerKey:authority.publicKey,recentBlockhash:latest.blockhash,instructions:[built.instruction]}).compileToV0Message();
      return{transaction:new VersionedTransaction(message),lastValidBlockHeight:latest.lastValidBlockHeight,
        estimatedRentLamports:String(await connection.getMinimumBalanceForRentExemption(140,'finalized'))};
    },prove:saved=>loadProof({...proofInput,signature:saved.signature})});
  if(outcome.status==='finalized')await store.update(next=>{
    const active=next[BUCKET]?.[row.key];if(active?.eventHash!==row.eventHash)throw new Error('Agency promotion changed after billing.');
    active.status='finalized';active.signature=outcome.signature;active.proof=clone(outcome.proof);active.finalizedAt=new Date(now()).toISOString();
  });
  return{...outcome,mint,eventId:row.event.id};
}

// Dedicated X worker callback. Revalidate the funded immutable intent just
// before dispatch rather than treating an old queue row as spending permission.
export function createAgencyPublisher({store,connection,programId,approvedHash,authority,publisher,readContext=readAgencyMintContext}){
  return async(event,options)=>{
    const state=await store.read(),row=state[BUCKET]?.[event.id];
    if(event.kind!=='agency_promotion'||row?.status!=='queued'||row.eventHash!==allocationAuditHash(event)
      ||row.approvedHash!==approvedHash||row.programId!==String(programId))
      throw Object.assign(new Error('Agency publication has no matching funded intent.'),{delivery:'not-sent'});
    let context;try{
      context=await readContext({connection,state,mint:row.mint,programId,approvedHash,authority:authority.publicKey});
      assertCurrent(context,row);
    }catch{throw Object.assign(new Error('Agency publication funding preflight is unavailable.'),{delivery:'not-sent',status:429,retryAfterMs:60000});}
    return publisher.publish(event,options);
  };
}
