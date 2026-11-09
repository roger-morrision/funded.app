import bs58 from 'bs58';
import {Connection,PublicKey,SystemProgram,Transaction} from '@solana/web3.js';
import {exactSolLamports} from './exact-sol-units.js';
import {Buffer} from 'buffer';
import {createPendingWithdrawals} from './admin-withdrawal-pending.js';
const SIGNATURE=/^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
export function initAdminWithdrawals({api,post,show,refresh,wallet,connected,document=globalThis.document,
 connectionFactory=()=>new Connection(`${location.origin}/api/solana/rpc`,'finalized')}){
 const $=s=>document.querySelector(s),workspace=$('#workspace'),form=$('#withdraw-form'),reconcile=$('#reconcile-form');
 const submit=form.querySelector('[type=submit]'),receiptSubmit=reconcile.querySelector('[type=submit]');
 const review=$('#withdraw-review'),signatureInput=$('#reconcile-signature'),status=$('#withdraw-status');
 let busy=false,pending=null,recoveryKey='',activeScope='';
 const journal=createPendingWithdrawals(sessionStorage);
 function report(message,error=false){status.textContent=message;status.classList.toggle('error',error);show(message,error);}
 const maxButton=$('#withdraw-max');
 const exactSol=value=>{const units=BigInt(value);return `${units/1000000000n}.${String(units%1000000000n).padStart(9,'0')}`;};
 const token=()=>workspace.dataset.sessionEpoch,current=value=>!workspace.hidden&&token()===value;
 function save(row){
  // A known public signature survives reload/logout; signed bytes and keys do not.
  pending=journal.save(row);signatureInput.value=row.signature;
 }
 function clear(){if(pending)journal.clear(pending);pending=null;}
 function sync(){
  const destination=$('#withdraw-destination').value,provider=wallet();
  const source=$('#withdraw-source').value,key=token()+':'+destination+':'+source;
  if(key!==activeScope){
   activeScope=key;pending=journal.get(destination,source);signatureInput.value=pending?.signature||'';
   review.textContent='Use Max to check the available balance.';status.textContent='';status.classList.toggle('error',false);
  }
  const adminConnected=provider?.isPhantom&&provider.signTransaction&&connected()===destination&&provider.publicKey?.toBase58()===destination;
  submit.disabled=busy||!$('#withdraw-source').options.length||workspace.hidden||!adminConnected;
  if(!busy&&!pending&&destination&&!adminConnected)review.textContent='Connect the signed-in admin wallet in Phantom to submit a withdrawal.';
  receiptSubmit.disabled=busy||workspace.hidden;
  maxButton.disabled=busy||workspace.hidden||!$('#withdraw-source').value;
  if(pending){signatureInput.value=pending.signature;review.textContent=`Saved transfer: ${pending.signature}. You can edit the amount or use Max. Submit checks this transfer before preparing another.`;}
  if(!workspace.hidden&&!busy&&!pending&&source&&key!==recoveryKey){recoveryKey=key;const epoch=token();
   void api(`/api/admin/withdrawals/pending?source=${encodeURIComponent(source)}`).then(({pending:row})=>{
    if(current(epoch)&&source===$('#withdraw-source').value&&row?.source===source&&row?.destination===$('#withdraw-destination').value&&SIGNATURE.test(row.signature)){
      save(row);update();
    }
   }).catch(()=>{});
  }
 }
 const checker=document.createElement('button');checker.type='button';checker.textContent='Check pending transfer';checker.hidden=!pending;
 reconcile.append(checker);
 function update(){sync();checker.hidden=!pending;checker.disabled=busy||workspace.hidden;
  for(const input of form.querySelectorAll('input,select'))input.disabled=busy;}
 const rpc=connectionFactory;
 async function record(signature,epoch){
  const payload={signature,...(pending?.signature===signature&&pending.intentId?{intentId:pending.intentId}:{})};
  let receipt;
  if(payload.intentId){
   try{receipt=await api('/api/admin/withdrawals/reconcile',{method:'POST',body:JSON.stringify(payload)});}
   catch(error){if(error.code!=='ADMIN_EMAIL_CONFIRMATION_FAILED')throw error;
    if(!current(epoch))return;
    report('This withdrawal was approved in an earlier admin session. Verify a new email code to recover its receipt.');
    receipt=await post('/api/admin/withdrawals/reconcile',{signature});}
  }else receipt=await post('/api/admin/withdrawals/reconcile',payload);
  if(!current(epoch))return;
  if(receipt.finalized!==true||receipt.balanceDeltaVerified!==true||!receipt.signature||receipt.signature!==signature)throw Error('A finalized matching receipt and exact balance proof are required.');
  if(pending?.signature===signature)clear();
  review.textContent=`Finalized receipt ${receipt.signature}`;
  report(`Finalized ${Number(receipt.amountLamports)/1e9} SOL transfer recorded: ${receipt.signature}`);await refresh();
 }
 async function run(action){if(busy||workspace.hidden)return;const epoch=token();busy=true;update();try{await action();}catch(error){if(current(epoch))report(error.message,true);}finally{busy=false;update();}}
 maxButton.addEventListener('click',()=>{const epoch=token(),source=$('#withdraw-source').value;
  void run(async()=>{const quote=await api(`/api/admin/withdrawals/maximum?source=${encodeURIComponent(source)}`);
   if(!current(epoch)||source!==$('#withdraw-source').value)return;
   if(quote.destination!==$('#withdraw-destination').value)throw Error('Admin session changed. Refresh before withdrawing.');
   $('#withdraw-amount').value=exactSol(quote.maximumLamports);report('Available balance checked. Review the amount before submitting.');
   review.textContent=`Available: ${exactSol(quote.maximumLamports)} SOL · admin pays ${exactSol(quote.estimatedFeeLamports)} SOL network fee · source reserve ${exactSol(quote.reserveLamports)} SOL.`;
  });});
 $('#withdraw-source').addEventListener('change',()=>{$('#withdraw-amount').value='';update();});
 form.addEventListener('submit',event=>{
  event.preventDefault();if(busy||!form.reportValidity())return;
  const epoch=token();void run(async()=>{
   const source=$('#withdraw-source').value,destination=$('#withdraw-destination').value,amount=Number(exactSolLamports($('#withdraw-amount').value));
   const provider=wallet();
   if(!provider?.isPhantom||!provider.signTransaction||!connected()||connected()!==destination||provider.publicKey?.toBase58()!==destination)
    throw Error('Connect the signed-in admin wallet in Phantom before submitting.');
   if(!Number.isSafeInteger(amount)||amount<1)throw Error('Enter a positive exact SOL amount.');
   if(pending){report('Checking the previous transfer before preparing your new amount.');
    if(!await checkPending(epoch)||!current(epoch))return;
   }
   report('Preparing withdrawal. Verify the email code to authorize this amount and destination.');
   const plan=await post('/api/admin/withdrawals/prepare',{source,destination,amountLamports:amount});if(!current(epoch))return;
   if(plan.finalized===true&&plan.balanceDeltaVerified===true){await refresh();report('The prior withdrawal is finalized. Review the updated balance before another transfer.');return;}
   if(plan.source!==source||plan.destination!==destination||plan.amountLamports!==amount)throw Error('The withdrawal review changed. Review it again.');
   const summary=`Withdraw ${exactSol(amount)} Devnet SOL · From ${source} · To admin ${destination} · Admin pays ${exactSol(plan.estimatedFeeLamports)} SOL network fee; ${exactSol(plan.reserveLamports)} SOL stays in the source.`;
   review.textContent=summary;
   const connection=rpc();if(await connection.getGenesisHash()!=='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG')throw Error('The browser RPC is not Devnet.');
   if(!current(epoch))return;
   if(wallet()!==provider||!provider.isPhantom||provider.publicKey?.toBase58()!==destination||connected()!==destination)throw Error('Phantom must still be connected to the signed-in admin wallet.');
   const tx=new Transaction({feePayer:new PublicKey(destination),recentBlockhash:plan.blockhash})
    .add(SystemProgram.transfer({fromPubkey:new PublicKey(source),toPubkey:new PublicKey(destination),lamports:amount}));
   const reviewedMessage=tx.serializeMessage();
   if(plan.signingMode!=='server'||plan.feePayer!==destination)throw Error('Admin fee payer or source signing mode changed. Refresh before withdrawing.');
   const partial=Transaction.from(Buffer.from(plan.signedTransaction,'base64'));
   if(!partial.serializeMessage().equals(reviewedMessage)||!partial.verifySignatures(false))throw Error('The source authorization or reviewed transfer changed.');
   report('Email verified. Sign in Phantom with the admin wallet to pay the transfer fee.');
   const signed=await provider.signTransaction(partial);if(!current(epoch))return;
   if(wallet()!==provider||!provider.isPhantom||provider.publicKey?.toBase58()!==destination||connected()!==destination
     ||!signed.serializeMessage().equals(reviewedMessage)||!signed.verifySignatures())throw Error('The admin wallet or reviewed transfer changed before submission.');
   if(!Number.isSafeInteger(plan.lastValidBlockHeight)||!Number.isFinite(Date.parse(plan.expiresAt)))throw Error('The withdrawal review is missing its expiry. Review it again.');
   if(!plan.recovery&&Date.now()>=Date.parse(plan.expiresAt)||!(await connection.isBlockhashValid(plan.blockhash,'confirmed')).value)throw Error('The withdrawal review expired. Reconcile its saved signature before preparing another.');
   if(!current(epoch))return;
   const wire=signed.serialize(),signature=bs58.encode(signed.signature);
   save({signature,intentId:plan.id,source,destination,feePayer:destination,amountLamports:amount,lastValidBlockHeight:plan.lastValidBlockHeight});update();
   report(`Signed transfer saved: ${signature}. Registering it before submission.`);
   // From this point every failure retains the exact identity. Never re-sign.
   const registered=await api('/api/admin/withdrawals/submit',{method:'POST',body:JSON.stringify({intentId:plan.id,signedTransaction:wire.toString('base64')})});
   if(registered.signature!==signature||registered.registered!==true)throw Error('The approved withdrawal signature could not be recorded. Reconcile before retrying.');
   if(registered.finalized){await record(signature,epoch);return;}
   if(!current(epoch)||wallet()!==provider||provider.publicKey?.toBase58()!==destination||connected()!==destination)
    throw Error('The admin session or Phantom wallet changed. Reconcile the saved signature before retrying.');
   const sent=await connection.sendRawTransaction(wire,{skipPreflight:false,preflightCommitment:'confirmed',maxRetries:2});
   if(sent!==signature)throw Error('RPC returned a different signature; reconcile the saved transfer.');
   report(`Submitted ${signature}. Waiting for finalized Devnet confirmation.`);
   const deadline=Date.now()+90000;
   while(Date.now()<deadline&&current(epoch)){
    const status=(await connection.getSignatureStatuses([signature],{searchTransactionHistory:true})).value[0];
    if(status?.err)throw Error(`Devnet rejected ${signature}. Check the saved transfer before another attempt.`);
    if(status?.confirmationStatus==='finalized'){await record(signature,epoch);return;}
    await new Promise(resolve=>setTimeout(resolve,2000));
   }
   throw Error(`Confirmation is pending. Check ${signature} before another withdrawal.`);
  });
 });
 reconcile.addEventListener('submit',event=>{event.preventDefault();const epoch=token(),signature=signatureInput.value.trim();
  if(!SIGNATURE.test(signature)){report('Enter a valid Devnet transaction signature.',true);return;}void run(()=>record(signature,epoch));});
 async function checkPending(epoch){
  const row=pending;if(!row)return true;
  const connection=rpc();if(await connection.getGenesisHash()!=='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG')throw Error('The browser RPC is not Devnet.');
  const status=(await connection.getSignatureStatuses([row.signature],{searchTransactionHistory:true})).value[0];
  if(!current(epoch))return;
  if(status?.confirmationStatus==='finalized'&&!status.err){await record(row.signature,epoch);return false;}
  const height=await connection.getBlockHeight('finalized'),transaction=await connection.getTransaction(row.signature,{commitment:'finalized',maxSupportedTransactionVersion:0});
  if(current(epoch)&&status?.confirmationStatus==='finalized'&&status.err&&transaction?.meta?.err
    &&transaction.transaction?.signatures?.includes(row.signature)){
   clear();review.textContent='The saved transfer failed on chain. You may submit any available amount.';report(review.textContent);return true;
  }
  if(current(epoch)&&status===null&&transaction===null&&height>row.lastValidBlockHeight+32){
   clear();review.textContent='The saved transfer expired without landing. You may submit any available amount.';report(review.textContent);return true;
  }
  throw Error('The previous transfer outcome is still pending. No new transfer was signed. Keep your new amount and submit again after confirmation or expiry.');
 }
 checker.addEventListener('click',()=>{const epoch=token();if(!pending)return;void run(()=>checkPending(epoch));});
 new MutationObserver(update).observe(workspace,{attributes:true,attributeFilter:['hidden']});update();return{sync:update};
}
