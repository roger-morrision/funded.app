import bs58 from 'bs58';
import { Buffer } from 'buffer';
import { VersionedTransaction } from '@solana/web3.js';
import nacl from 'tweetnacl';

// Never retry a send automatically: a timeout may hide a successful broadcast.
export async function executeLaunchPlan({connection,provider,payer,mint,plan,onEvent=()=>{},assertWalletCurrent=()=>{}}) {
  const result={signature:null,mintRouterSignature:null};
  for(const step of plan.steps) {
    let broadcast=false, signature=null;
    try {
      // A finalized hash is slightly older but is visible across every backend
      // in a load-balanced test network RPC pool. A merely confirmed hash can be
      // returned by one backend and rejected as unknown by the next.
      const latest=await connection.getLatestBlockhash('finalized');
      const versioned=step.transaction instanceof VersionedTransaction;
      if(versioned){step.transaction.message.recentBlockhash=latest.blockhash;step.transaction.signatures=step.transaction.signatures.map(()=>new Uint8Array(64));step.transaction.sign([mint]);}
      else {step.transaction.recentBlockhash=latest.blockhash;step.transaction.feePayer=payer;
        step.transaction.signatures=[];step.transaction.partialSign(mint);}
      step.transaction.fundedLastValidBlockHeight=latest.lastValidBlockHeight;
      assertWalletCurrent();
      onEvent({state:'awaiting-approval',step:step.kind,lastValidBlockHeight:latest.lastValidBlockHeight});
      const signed=await provider.signTransaction(step.transaction);assertWalletCurrent();
      if(versioned){
        if(!(signed instanceof VersionedTransaction) || !Buffer.from(signed.message.serialize()).equals(Buffer.from(step.transaction.message.serialize())))
          throw new Error('Wallet changed the atomic reserve transaction. Nothing was submitted.');
        const message=signed.message.serialize();
        for(let index=0;index<signed.message.header.numRequiredSignatures;index++)
          if(!nacl.sign.detached.verify(message,signed.signatures[index],signed.message.staticAccountKeys[index].toBytes()))
            throw new Error('Atomic reserve transaction has an invalid wallet or mint signature. Nothing was submitted.');
      }
      const raw=signed.serialize();if(raw.length>1232)throw new Error('Transaction exceeds the Solana packet limit.');
      signature=bs58.encode(versioned?signed.signatures[0]:signed.signature);
      onEvent({state:'broadcasting',step:step.kind,signature,lastValidBlockHeight:latest.lastValidBlockHeight});
      broadcast=true;
      const returned=await connection.sendRawTransaction(raw,{skipPreflight:false});
      if(returned!==signature)throw new Error('RPC returned an unexpected signature.');
      onEvent({state:'submitted',step:step.kind,signature});
      let confirmation;
      try { confirmation=await connection.confirmTransaction({signature,...latest},'finalized'); }
      catch(error) {
        // A block-height expiry can race a finalized transaction on a lagging
        // RPC backend. Reconcile the same signature; never send it again.
        let status;
        try { status=(await connection.getSignatureStatuses([signature],{searchTransactionHistory:true})).value?.[0]; }
        catch {}
        if(status?.confirmationStatus!=='finalized')throw error;
        confirmation={value:{err:status.err}};
      }
      if(confirmation.value.err) {
        onEvent({state:'failed',step:step.kind,signature,message:JSON.stringify(confirmation.value.err)});
        const error=new Error(`${step.kind} failed on-chain. Inspect ${signature}.`);error.knownFailure=true;throw error;
      }
      onEvent({state:'confirmed',step:step.kind,signature});
      if(step.kind==='initialize-mint-router')result.mintRouterSignature=signature;else result.signature=signature;
    } catch(error) {
      if(!error.knownFailure)onEvent({state:broadcast?'unknown':/reject|cancel|denied/i.test(error.message)?'cancelled':'failed',step:step.kind,...(signature?{signature}:{}),message:error.message});
      throw error;
    }
  }
  return result;
}
