import bs58 from 'bs58';

// Never retry a send automatically: a timeout may hide a successful broadcast.
export async function executeLaunchPlan({connection,provider,payer,mint,plan,onEvent=()=>{},assertWalletCurrent=()=>{}}) {
  const result={signature:null,mintRouterSignature:null};
  for(const step of plan.steps) {
    let broadcast=false, signature=null;
    try {
      const latest=await connection.getLatestBlockhash('confirmed');
      step.transaction.recentBlockhash=latest.blockhash;step.transaction.feePayer=payer;
      step.transaction.signatures=[];step.transaction.partialSign(mint);
      assertWalletCurrent();
      onEvent({state:'awaiting-approval',step:step.kind,lastValidBlockHeight:latest.lastValidBlockHeight});
      const signed=await provider.signTransaction(step.transaction);assertWalletCurrent();
      const raw=signed.serialize();if(raw.length>1232)throw new Error('Transaction exceeds the Solana packet limit.');
      signature=bs58.encode(signed.signature);
      onEvent({state:'broadcasting',step:step.kind,signature,lastValidBlockHeight:latest.lastValidBlockHeight});
      broadcast=true;
      const returned=await connection.sendRawTransaction(raw,{skipPreflight:false});
      if(returned!==signature)throw new Error('RPC returned an unexpected signature.');
      onEvent({state:'submitted',step:step.kind,signature});
      const confirmation=await connection.confirmTransaction({signature,...latest},'confirmed');
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
