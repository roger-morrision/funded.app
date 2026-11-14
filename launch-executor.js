import bs58 from 'bs58';
import { Buffer } from 'buffer';
import { VersionedTransaction } from '@solana/web3.js';
import nacl from 'tweetnacl';

// Never retry a send automatically: a timeout may hide a successful broadcast.
export async function executeLaunchPlan({connection,provider,payer,mint,plan,onEvent=()=>{},assertWalletCurrent=()=>{},beforeBroadcast=()=>{}}) {
  const result={signature:null,mintRouterSignature:null};
  for(const step of plan.steps) {
    let broadcast=false, signature=null;
    try {
      await beforeBroadcast();
      // A finalized hash is slightly older but is visible across every backend
      // in a load-balanced Solana RPC pool. A merely confirmed hash can be
      // returned by one backend and rejected as unknown by the next.
      const latest=await connection.getLatestBlockhash('finalized');
      const versioned=step.transaction instanceof VersionedTransaction;
      // A step after coin creation (the paired developer buy) needs no mint signature.
      const signers=step.signers||[mint];
      if(versioned){step.transaction.message.recentBlockhash=latest.blockhash;step.transaction.signatures=step.transaction.signatures.map(()=>new Uint8Array(64));if(signers.length)step.transaction.sign(signers);}
      else {step.transaction.recentBlockhash=latest.blockhash;step.transaction.feePayer=payer;
        step.transaction.signatures=[];if(signers.length)step.transaction.partialSign(...signers);}
      step.transaction.fundedLastValidBlockHeight=latest.lastValidBlockHeight;
      assertWalletCurrent();
      onEvent({state:'awaiting-approval',step:step.kind,lastValidBlockHeight:latest.lastValidBlockHeight});
      // Wallet adapters can mutate and return the same object. Capture the
      // reviewed message before handing over that object, for both wire formats.
      const reviewedMessage=Buffer.from(versioned?step.transaction.message.serialize():step.transaction.serializeMessage());
      const signed=await provider.signTransaction(step.transaction);assertWalletCurrent();
      // Wallets may return a transaction from another SDK bundle or wrap a legacy
      // message in VersionedTransaction. Validate its wire bytes, not its JS class.
      let raw, decoded;
      try { raw=Buffer.from(signed.serialize());decoded=VersionedTransaction.deserialize(raw); }
      catch { throw new Error('Wallet returned an invalid signed launch transaction. Nothing was submitted.'); }
      if(!Buffer.from(decoded.message.serialize()).equals(reviewedMessage))
        throw new Error('Wallet changed the reviewed launch transaction. Nothing was submitted.');
      for(let index=0;index<decoded.message.header.numRequiredSignatures;index++)
        if(!nacl.sign.detached.verify(reviewedMessage,decoded.signatures[index],decoded.message.staticAccountKeys[index].toBytes()))
          throw new Error('Launch transaction has an invalid wallet or mint signature. Nothing was submitted.');
      if(raw.length>1232)throw new Error('Transaction exceeds the Solana packet limit.');
      signature=bs58.encode(decoded.signatures[0]);
      await beforeBroadcast();
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
      if(step.kind==='initialize-mint-router')result.mintRouterSignature=signature;
      else if(step.kind==='developer-buy')result.developerBuySignature=signature;else result.signature=signature;
    } catch(error) {
      if(!error.knownFailure)onEvent({state:broadcast?'unknown':/reject|cancel|denied/i.test(error.message)?'cancelled':'failed',step:step.kind,...(signature?{signature}:{}),message:error.message});
      throw error;
    }
  }
  return result;
}
