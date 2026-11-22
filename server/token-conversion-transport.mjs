import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PublicKey,VersionedTransaction} from '@solana/web3.js';
import nacl from 'tweetnacl';
import {createTokenConversionJournal} from './token-conversion-journal.mjs';

// Injectable transport for the admitted reviewer/journal. This module is NOT
// registered with a service, worker, signer allowlist or activation flag.
// Dedicated production custody, admission and live acceptance remain separate.
export function createTokenConversionTransport({store,connection,config,release,priceSigner,operator,now=Date.now,signTimeoutMs=30000}){
  assert(String(priceSigner?.publicKey)===config.priceSigner&&String(operator?.publicKey)===config.authority
    &&String(priceSigner.publicKey)!==String(operator.publicKey),'Distinct exact reviewed signer handles required.');
  assert(typeof priceSigner.signMessage==='function'&&typeof operator.signMessage==='function','Explicit signer adapters required.');
  assert(Number.isSafeInteger(signTimeoutMs)&&signTimeoutMs>0&&signTimeoutMs<=30000,'Bounded signing deadline required.');
  const journal=createTokenConversionJournal({store,connection,config,release,now});
  const fresh=review=>{const at=now();return Number.isSafeInteger(at)&&at>=review.reviewedAt&&at-review.reviewedAt<35000;};
  const pending=(row,stage)=>({status:'reconciliation-pending',messageHash:row.messageHash,signature:row.signature||null,stage});
  async function sign(handle,row,message,role){
    const controller=new AbortController();let timer;
    try{
      const expected=new PublicKey(role==='operator'?row.proofIntent.authority:row.proofIntent.priceSigner);
      assert(String(handle.publicKey)===String(expected),'Signer identity changed after construction.');
      const value=await Promise.race([Promise.resolve().then(()=>handle.signMessage({message:Buffer.from(message),version:0,
        messageHash:row.messageHash,transactionBase64:row.unsignedTransaction,intentDigest:row.intentDigest,role,signal:controller.signal})),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Signer result remains unknown')),signTimeoutMs);})]);
      const signature=Uint8Array.from(value||[]);
      assert(signature.length===64&&nacl.sign.detached.verify(message,signature,expected.toBytes()),'Signer signature differs from exact reviewed message.');
      return signature;
    }finally{clearTimeout(timer);controller.abort();}
  }
  return {initialize:()=>journal.initialize(),status:()=>journal.status(),
    async run({request=null,messageHash=null,recoveryOnly=false}={}){
      assert(typeof recoveryOnly==='boolean'&&!(request&&messageHash),'One exact request or saved hash required.');
      const safe=request?structuredClone(request):null;let hash=messageHash;
      if(safe){
        assert(typeof safe.transaction==='string'&&safe.transaction.length<=1644,'Bounded unsigned request required.');
        const tx=VersionedTransaction.deserialize(Buffer.from(safe.transaction,'base64'));
        hash=createHash('sha256').update(tx.message.serialize()).digest('hex');
      }
      assert(/^[a-f0-9]{64}$/.test(hash||''),'Exact message hash required.');
      const old=(await journal.status()).attempts[hash];
      // A prior reservation may have crossed an unknown external-signing or
      // publication boundary. Restart NEVER signs or sends it automatically.
      if(old)return journal.reconcile({messageHash:hash});
      if(recoveryOnly||!request)return {status:'unavailable',messageHash:hash,reason:'saved-attempt-required'};
      const first=await journal.reserve(safe),row=first.reservation;
      if(!first.created)return journal.reconcile({messageHash:hash});
      const claimed=await journal.claimSigning({messageHash:hash});
      if(!claimed.claimed||!fresh(first.review))return pending(row,'signing-not-started');
      const tx=VersionedTransaction.deserialize(Buffer.from(row.unsignedTransaction,'base64')),message=Buffer.from(tx.message.serialize());
      let price,authority;
      try{price=await sign(priceSigner,row,message,'price-attestation');}
      catch(error){if(error.code==='ERR_ASSERTION')throw error;return pending(row,'price-signature-unconfirmed');}
      if(!fresh(first.review))return pending(row,'price-review-expired');
      try{authority=await sign(operator,row,message,'operator');}
      catch(error){if(error.code==='ERR_ASSERTION')throw error;return pending(row,'operator-signature-unconfirmed');}
      tx.signatures=[authority,price];
      const saved=await journal.recordSigned({messageHash:hash,transactionBase64:Buffer.from(tx.serialize()).toString('base64')});
      if(!fresh(first.review))return pending(saved,'signed-review-expired');
      // Re-run actual review/simulation after both signatures, before durable
      // send admission. A changed quote/context or delayed disk write stops it.
      const latest=await journal.reserve(safe);
      const admitted=await journal.claimBroadcast({messageHash:hash,reviewedAt:latest.review.reviewedAt});
      if(!admitted.claimed||!fresh(latest.review))return pending(saved,'broadcast-not-started');
      let received;
      try{received=await connection.sendRawTransaction(Buffer.from(saved.signedTransaction,'base64'),
        {skipPreflight:false,preflightCommitment:'finalized',maxRetries:0});}
      catch{return pending(saved,'send-unconfirmed');}
      if(received!==saved.signature)return pending(saved,'send-signature-mismatch');
      return journal.reconcile({messageHash:hash});
    },
  };
}
