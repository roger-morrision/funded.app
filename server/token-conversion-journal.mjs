import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {VersionedTransaction} from '@solana/web3.js';
import nacl from 'tweetnacl';
import {deriveTokenConversionV3} from '../mint-router-v3-token.js';
import {buildReviewedUsdcSellConversion,decodeTokenConversionIntent} from './token-conversion-sell.mjs';
import {reviewedMainnetManifest} from '../mainnet-program.js';
import {SOLANA_GENESIS} from '../solana-network.js';
import {reviewTokenSellConversion,requireReviewedTokenSignerPolicy,tokenPricePolicyHash} from './token-conversion-sell-review.mjs';
import {decodeTokenSellIntent} from './token-conversion-intent.mjs';
import {loadFinalizedTokenSell} from './token-conversion-sell-proof.mjs';
import {unusedTokenSellReservation,signedTokenSellBytes} from './token-conversion-reservation.mjs';

const bucket='tokenConversionPriceJournalV1',copy=value=>structuredClone(value);
const identity=row=>`${row.programId}:${row.mint}:${row.conversionId}`;
const immutable=row=>tokenPricePolicyHash({programId:row.programId,mint:row.mint,conversionId:row.conversionId,
  category:row.category,amountIn:row.amountIn,authority:row.authority,priceSigner:row.priceSigner});
const slots=(...values)=>values.every(value=>Number.isSafeInteger(value)&&value>0);
const roleIndex=role=>role==='operator'?0:role==='price-attestation'?1:-1;
function roleSignature(row,role,value){
  const index=roleIndex(role);assert(index>=0&&typeof value==='string'&&value.length===88,'Canonical role signature required.');
  const signature=Buffer.from(value,'base64'),tx=VersionedTransaction.deserialize(Buffer.from(row.unsignedTransaction,'base64'));
  assert(signature.length===64&&signature.toString('base64')===value
    &&nacl.sign.detached.verify(tx.message.serialize(),signature,tx.message.staticAccountKeys[index].toBytes()),'Role signature differs from durable reviewed message.');
}

// Dedicated durable store with transactional lock/fsync BEFORE a price signature
// may leave its caller. No method signs or broadcasts. Reuse the existing locked
// AutomaticRewardStore on a fresh dedicated path, not the Devnet financial ledger.
export function createTokenConversionJournal({store,connection,config,release=reviewedMainnetManifest(),now=Date.now}){
  config=copy(config);release=copy(release);requireReviewedTokenSignerPolicy(config,release);
  assert(typeof store?.transaction==='function'&&typeof store.read==='function','Locked durable conversion store required.');
  const context={version:1,genesisHash:SOLANA_GENESIS['mainnet-beta'],programId:config.programId,programDataSha256:config.programDataSha256,
    policyHash:tokenPricePolicyHash(config),quoteMint:config.quotePolicy.quoteMint,authority:config.authority,priceSigner:config.priceSigner};
  const contextHash=tokenPricePolicyHash(context);
  const checked=state=>{
    const journal=state[bucket];assert(journal&&tokenPricePolicyHash(journal.context)===contextHash,'Different-context or legacy conversion journal needs explicit migration.');
    assert(Number.isSafeInteger(journal.clock)&&journal.clock>0&&journal.attempts&&typeof journal.attempts==='object'&&!Array.isArray(journal.attempts),'Invalid conversion journal.');
    const intents=new Map(),activeVaults=new Set();
    for(const [hash,row]of Object.entries(journal.attempts)){
      assert(/^[a-f0-9]{64}$/.test(hash)&&row.messageHash===hash&&row.contextHash===contextHash&&row.intentDigest===tokenPricePolicyHash(row.proofIntent),
        'Immutable conversion journal evidence differs.');
      const intent=decodeTokenSellIntent(row.proofIntent);
      const built=buildReviewedUsdcSellConversion(intent);
      assert(row.vault===String(built.vault)&&row.receipt===String(deriveTokenConversionV3(intent.programId,intent.mint,intent.conversionId)),
        'Stored conversion custody differs.');
      assert(typeof row.unsignedTransaction==='string'&&row.unsignedTransaction.length<=1644,'Stored unsigned conversion is unavailable.');
      const raw=Buffer.from(row.unsignedTransaction,'base64'),unsigned=VersionedTransaction.deserialize(raw),message=unsigned.message;
      const instruction=message.compiledInstructions.at(-1),parsed=decodeTokenConversionIntent(Buffer.from(instruction.data));
      assert(raw.toString('base64')===row.unsignedTransaction&&raw.length<=1232&&message.version===0&&message.header.numRequiredSignatures===2
        &&String(message.staticAccountKeys[0])===context.authority&&String(message.staticAccountKeys[1])===context.priceSigner&&unsigned.signatures.every(s=>s.every(byte=>byte===0))
        &&createHash('sha256').update(message.serialize()).digest('hex')===hash&&message.recentBlockhash===row.blockhash
        &&String(message.staticAccountKeys[instruction.programIdIndex])===context.programId
        &&parsed.conversionId===row.proofIntent.conversionId&&parsed.category===row.proofIntent.category
        &&parsed.amountIn===row.proofIntent.amountIn&&parsed.minSolOut===row.proofIntent.minSolOut,'Stored unsigned conversion differs.');
      assert(row.proofIntent.messageHash===hash&&String(intent.programId)===context.programId&&row.budgetAsset===context.quoteMint
        &&row.proofIntent.authority===context.authority&&row.proofIntent.priceSigner===context.priceSigner&&row.amountIn===intent.amountIn
        &&Number.isSafeInteger(row.at)&&row.at>0&&row.at<=journal.clock&&Number.isSafeInteger(row.slot)&&row.slot>0
        &&['reserved','submitted','settled','released-no-conversion'].includes(row.status),'Invalid typed conversion reservation.');
      const id=identity(row.proofIntent),facts=immutable(row.proofIntent);assert(!intents.has(id)||intents.get(id)===facts,'Conversion nonce was reclassified.');intents.set(id,facts);
      if(['reserved','submitted'].includes(row.status)){assert(!activeVaults.has(row.vault),'Multiple unresolved reservations share a vault.');activeVaults.add(row.vault);}
      if(row.signedTransaction)assert(signedTokenSellBytes(row.signedTransaction,row).signature===row.signature,'Stored conversion signatures differ.');
      if(row.signingStartedAt!==undefined)assert(Number.isSafeInteger(row.signingStartedAt)&&row.signingStartedAt>=row.at
        &&row.signingStartedAt<=journal.clock,'Invalid durable signing marker.');
      if(row.broadcastAttemptedAt!==undefined)assert(row.signedTransaction&&row.signingStartedAt!==undefined
        &&Number.isSafeInteger(row.broadcastAttemptedAt)&&row.broadcastAttemptedAt>=row.submittedAt&&row.broadcastAttemptedAt<=journal.clock
        &&Number.isSafeInteger(row.broadcastReviewedAt)&&row.broadcastReviewedAt<=row.broadcastAttemptedAt
        &&row.broadcastReviewedAt>=row.at&&row.broadcastAttemptedAt-row.broadcastReviewedAt<35000,'Invalid durable broadcast marker.');
      if(row.roleSignatures!==undefined){
        assert(row.signingStartedAt!==undefined&&row.roleSignatures&&typeof row.roleSignatures==='object'&&!Array.isArray(row.roleSignatures),'Invalid role signature cache.');
        for(const [role,value]of Object.entries(row.roleSignatures))roleSignature(row,role,value);
      }
      if(row.status==='submitted')assert(row.signature&&row.signedTransaction,'Submitted conversion lacks durable signed bytes.');
      if(row.status==='reserved')assert(!row.signature&&!row.signedTransaction,'Unsigned reservation has unexpected signature state.');
      if(row.status==='settled')assert(row.proof?.finalized===true&&row.proof.messageHash===hash&&row.proof.balanceDeltaVerified===true
        &&row.proof.signaturesVerified===true&&row.proof.wsolClosed===true&&row.proof.signature===row.signature
        &&row.proof.programDataSha256===context.programDataSha256&&row.proof.programId===context.programId&&row.proof.spentQuoteRaw===row.amountIn
        &&row.proof.mint===row.proofIntent.mint&&row.proof.quoteMint===context.quoteMint&&row.proof.category===row.proofIntent.category
        &&row.proof.conversionId===row.proofIntent.conversionId&&/^[1-9]\d*$/.test(row.proof.receivedLamports)
        &&BigInt(row.proof.receivedLamports)>=BigInt(row.proofIntent.minSolOut)
        &&Number.isSafeInteger(row.proof.slot)&&row.proof.slot>=row.slot&&BigInt(row.proof.deploymentSlot)<BigInt(row.proof.slot)
        &&slots(row.proof.programContextSlot,row.proof.programDataContextSlot,row.proof.receiptContextSlot)
        &&row.proof.programContextSlot>=row.proof.slot&&row.proof.programDataContextSlot>=row.proof.programContextSlot
        &&row.proof.receiptContextSlot>=row.proof.programDataContextSlot,'Settled conversion lacks exact proof.');
      if(row.status==='released-no-conversion')assert(row.release?.kind==='finalized-expired-and-absent'&&row.release.programDataSha256===context.programDataSha256
        &&Number.isSafeInteger(row.release.expirySlot)&&Number.isSafeInteger(row.release.receiptSlot)&&Number.isSafeInteger(row.release.programDataContextSlot)
        &&row.release.expirySlot>=row.slot&&row.release.receiptSlot>=row.release.programDataContextSlot
        &&row.release.programDataContextSlot>=row.release.expirySlot,'Released conversion lacks finalized absence.');
    }
    return journal;
  };
  const transaction=mutate=>store.transaction(state=>{
    const journal=checked(state),at=now();assert(Number.isSafeInteger(at)&&at>=journal.clock,'Conversion journal clock moved backwards.');
    const result=mutate(journal,at);journal.clock=at;checked(state);return copy(result);
  });
  return {
    initialize:({firstProvisioningRole=null}={})=>store.transaction((state,publication)=>{
      if(firstProvisioningRole!==null){
        assert(['controller','operator','price-attestation'].includes(firstProvisioningRole)
          &&publication?.published===false&&!Object.hasOwn(state,bucket),'First provisioning requires a genuinely unpublished journal.');
        const at=now();assert(Number.isSafeInteger(at)&&at>0,'Valid journal clock required.');
        state[bucket]={context:copy(context),clock:at,attempts:{},provisionedRole:firstProvisioningRole};
      }else assert(publication?.published===true&&Object.hasOwn(state,bucket),
        'Missing conversion journal requires reviewed first provisioning.');
      checked(state);return {contextHash};
    }),
    verifyExisting:({role})=>store.transaction((state,publication)=>{
      assert(publication?.published===true&&['controller','operator','price-attestation'].includes(role)
        &&state[bucket]?.provisionedRole===role,'Missing or mismatched provisioned conversion journal.');
      checked(state);return {contextHash};
    }),
    async reserve(request){
      checked(await store.read());
      // Do not accept a client-supplied "reviewed" boolean, amount or allowlist.
      const review=await reviewTokenSellConversion({connection,config,signer:config.priceSigner,request,now:now(),release});
      const proofIntent=copy(review.proofIntent),digest=tokenPricePolicyHash(proofIntent),id=identity(proofIntent);
      assert(review.messageHash===createHash('sha256').update(review.transaction.message.serialize()).digest('hex')
        &&review.messageHash===proofIntent.messageHash&&review.amountIn===proofIntent.amountIn,'Reviewed conversion changed before reservation.');
      const result=await transaction((journal,at)=>{
        assert(Number.isSafeInteger(review.reviewedAt)&&at>=review.reviewedAt&&at-review.reviewedAt<35000,'Conversion review expired before durable reservation.');
        const prior=journal.attempts[review.messageHash];
        if(prior){assert(prior.intentDigest===digest&&!['settled','released-no-conversion'].includes(prior.status),'Finished or changed conversion message cannot be signed again.');return {reservation:prior,created:false};}
        const rows=Object.values(journal.attempts),same=rows.filter(row=>identity(row.proofIntent)===id);
        assert(same.every(row=>immutable(row.proofIntent)===immutable(proofIntent)),'Conversion nonce cannot change asset, category or input.');
        assert(same.every(row=>row.status==='released-no-conversion'),'Existing conversion needs exact finalized reconciliation before replacement.');
        assert(!rows.some(row=>row.vault===review.vault&&['reserved','submitted'].includes(row.status)),'Vault has an unresolved conversion; no replacement signing.');
        const used=rows.filter(row=>row.status!=='released-no-conversion'&&row.at>at-86400000).reduce((sum,row)=>sum+BigInt(row.amountIn),0n);
        assert(used+BigInt(review.amountIn)<=BigInt(config.quotePolicy.maxDailyQuoteRaw),'Typed rolling USDC signing budget exceeded.');
        const row={contextHash,messageHash:review.messageHash,proofIntent,intentDigest:digest,status:'reserved',at,slot:review.slot,
          blockhash:review.blockhash,vault:review.vault,receipt:review.receipt,budgetAsset:review.budgetAsset,amountIn:review.amountIn,
          unsignedTransaction:Buffer.from(review.transaction.serialize()).toString('base64')};
        journal.attempts[row.messageHash]=row;return {reservation:row,created:true};
      });
      return {...result,review};
    },
    claimSigning:({messageHash})=>transaction((journal,at)=>{
      const row=journal.attempts[messageHash];assert(row?.status==='reserved','No unsigned conversion reservation.');
      if(row.signingStartedAt!==undefined)return {claimed:false,reservation:row};
      row.signingStartedAt=at;return {claimed:true,reservation:row};
    }),
    recordRoleSignature:({messageHash,role,signatureBase64})=>transaction(journal=>{
      const row=journal.attempts[messageHash];assert(row?.status==='reserved'&&row.signingStartedAt!==undefined,'No signer-owned reservation.');
      roleSignature(row,role,signatureBase64);row.roleSignatures||={};
      assert(!row.roleSignatures[role]||row.roleSignatures[role]===signatureBase64,'Role signature cache is immutable.');
      row.roleSignatures[role]=signatureBase64;return row;
    }),
    recordSigned:({messageHash,transactionBase64})=>transaction((journal,at)=>{
      const row=journal.attempts[messageHash];assert(row&&['reserved','submitted'].includes(row.status),'No active conversion reservation.');
      const signed=signedTokenSellBytes(transactionBase64,row);
      if(row.signedTransaction){assert(row.signedTransaction===signed.signedTransaction&&row.signature===signed.signature,'Signed conversion bytes are immutable.');return row;}
      Object.assign(row,signed,{status:'submitted',submittedAt:at});return row;
    }),
    claimBroadcast:({messageHash,reviewedAt})=>transaction((journal,at)=>{
      const row=journal.attempts[messageHash];assert(row?.status==='submitted'&&row.signingStartedAt!==undefined,'No transport-owned signed reservation.');
      if(row.broadcastAttemptedAt!==undefined)return {claimed:false,reservation:row};
      assert(Number.isSafeInteger(reviewedAt)&&reviewedAt>=row.at&&reviewedAt<=at&&at-reviewedAt<35000,'Conversion review expired before broadcast claim.');
      row.broadcastAttemptedAt=at;row.broadcastReviewedAt=reviewedAt;return {claimed:true,reservation:row};
    }),
    async reconcile({messageHash,signature=null}){
      const row=checked(await store.read()).attempts[messageHash];assert(row,'Unknown conversion reservation.');
      if(row.status==='settled'||row.status==='released-no-conversion')return copy(row);
      const candidate=row.signature||signature;
      const proof=candidate?await loadFinalizedTokenSell({connection,signature:candidate,expected:decodeTokenSellIntent(row.proofIntent),release}):null;
      if(proof)return transaction((journal,at)=>{
        const active=journal.attempts[messageHash];assert(active.intentDigest===row.intentDigest&&active.status!=='released-no-conversion','Conversion state changed during reconciliation.');
        if(active.status==='settled')return active;Object.assign(active,{status:'settled',proof:copy(proof),settledAt:at,signature:proof.signature});return active;
      });
      const absent=await unusedTokenSellReservation({connection,release,row:{...row,signature:candidate}});
      if(!absent)return {status:'reconciliation-pending',messageHash};
      return transaction((journal,at)=>{
        const active=journal.attempts[messageHash];assert(active.intentDigest===row.intentDigest&&active.status!=='settled','Conversion finalized while checking absence.');
        if(active.status==='released-no-conversion')return active;Object.assign(active,{status:'released-no-conversion',release:copy(absent),releasedAt:at});return active;
      });
    },
    async status(){const journal=checked(await store.read());return {contextHash,quoteMint:context.quoteMint,attempts:copy(journal.attempts)};},
  };
}
