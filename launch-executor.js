import bs58 from 'bs58';
import { Buffer } from 'buffer';
import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import nacl from 'tweetnacl';

// Never retry a send automatically: a timeout may hide a successful broadcast.
export async function executeLaunchPlan({connection,provider,payer,mint,plan,onEvent=()=>{},assertWalletCurrent=()=>{},beforeBroadcast=()=>{}}) {
  const result={signature:null,mintRouterSignature:null};
  for(const step of plan.steps) {
    let broadcast=false, signature=null, outcome='not-submitted';
    try {
      await beforeBroadcast();
      // A finalized hash is slightly older but is visible across every backend
      // in a load-balanced Solana RPC pool. A merely confirmed hash can be
      // returned by one backend and rejected as unknown by the next.
      const latest=await connection.getLatestBlockhash('finalized');
      if(!Number.isSafeInteger(latest?.lastValidBlockHeight)||latest.lastValidBlockHeight<=0
        ||typeof latest.blockhash!=='string'||new PublicKey(latest.blockhash).toBase58()!==latest.blockhash)
        throw new Error('A valid finalized launch blockhash and expiry are required before wallet approval.');
      const versioned=step.transaction instanceof VersionedTransaction;
      // A step after coin creation (the paired developer buy) needs no mint signature.
      const signers=step.signers||[mint];
      if(versioned){step.transaction.message.recentBlockhash=latest.blockhash;step.transaction.signatures=step.transaction.signatures.map(()=>new Uint8Array(64));if(signers.length)step.transaction.sign(signers);}
      else {step.transaction.recentBlockhash=latest.blockhash;step.transaction.feePayer=payer;
        step.transaction.signatures=[];if(signers.length)step.transaction.partialSign(...signers);}
      step.transaction.fundedLastValidBlockHeight=latest.lastValidBlockHeight;
      assertWalletCurrent();
      await onEvent({state:'awaiting-approval',step:step.kind,lastValidBlockHeight:latest.lastValidBlockHeight});
      assertWalletCurrent();
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
      await onEvent({state:'broadcasting',step:step.kind,signature,lastValidBlockHeight:latest.lastValidBlockHeight});
      // Persistence may be asynchronous. Recheck the wallet and quote/lease
      // after it completes, immediately before the only broadcast attempt.
      assertWalletCurrent();await beforeBroadcast();assertWalletCurrent();
      broadcast=true;outcome='unknown';
      const returned=await connection.sendRawTransaction(raw,{skipPreflight:false,maxRetries:0});
      if(returned!==signature)throw new Error('RPC returned an unexpected signature.');
      await onEvent({state:'submitted',step:step.kind,signature});
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
      if(confirmation?.value?.err!==null) {
        const failure=confirmation?.value?.err;
        if(!failure||!['object','string'].includes(typeof failure))
          throw new Error('Finalized launch confirmation is incomplete. Check the saved signature before retrying.');
        outcome='finalized-failure';
        const error=new Error(`${step.kind} failed on-chain. Inspect ${signature}.`);error.knownFailure=true;throw error;
      }
      outcome='finalized-success';
      await onEvent({state:'confirmed',step:step.kind,signature});
      if(step.kind==='initialize-mint-router')result.mintRouterSignature=signature;
      else if(step.kind==='developer-buy')result.developerBuySignature=signature;else result.signature=signature;
    } catch(error) {
      const stopped=new Error(String(error?.message||error),{cause:error});
      stopped.knownFailure=outcome==='finalized-failure';
      // Keep the outcome available even if the journal itself is unavailable.
      // A secondary persistence error must never hide a possible broadcast.
      stopped.launchRecovery={step:step.kind,signature,broadcastAttempted:broadcast,outcome};
      const state=outcome==='finalized-success'?'confirmed':stopped.knownFailure?'failed'
        :broadcast?'unknown':/reject|cancel|denied/i.test(stopped.message)?'cancelled':'failed';
      try{await onEvent({state,step:step.kind,...(signature?{signature}:{}),message:stopped.message});}
      catch{stopped.journalUnavailable=true;}
      throw stopped;
    }
  }
  return result;
}
