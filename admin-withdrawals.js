import bs58 from 'bs58';
import {Connection,PublicKey,SystemProgram,Transaction} from '@solana/web3.js';
import {exactSolLamports} from './exact-sol-units.js';
const STORAGE='funded.admin.pending-withdrawal.devnet.v1';
const SIGNATURE=/^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
export function initAdminWithdrawals({api,post,show,refresh,wallet,connected,document=globalThis.document}){
 const $=s=>document.querySelector(s),workspace=$('#workspace'),form=$('#withdraw-form'),reconcile=$('#reconcile-form');
 const submit=form.querySelector('[type=submit]'),receiptSubmit=reconcile.querySelector('[type=submit]');
 const review=$('#withdraw-review'),signatureInput=$('#reconcile-signature');let busy=false,pending;
 try{const saved=JSON.parse(sessionStorage.getItem(STORAGE));if(SIGNATURE.test(saved?.signature)&&Number.isSafeInteger(saved.lastValidBlockHeight))pending=saved;}catch{}
 const token=()=>workspace.dataset.sessionEpoch,current=value=>!workspace.hidden&&token()===value;
 function save(row){
  // A known public signature survives reload/logout; signed bytes and keys do not.
  sessionStorage.setItem(STORAGE,JSON.stringify(row));pending=row;signatureInput.value=row.signature;
 }
 function clear(){sessionStorage.removeItem(STORAGE);pending=null;}
 function sync(){
  submit.disabled=busy||!!pending||!$('#withdraw-source').options.length||workspace.hidden;
  receiptSubmit.disabled=busy||workspace.hidden;
  if(pending){signatureInput.value=pending.signature;review.textContent=`Transfer pending reconciliation: ${pending.signature}. Check this receipt before preparing another withdrawal.`;}
 }
 const checker=document.createElement('button');checker.type='button';checker.textContent='Check pending transfer';checker.hidden=!pending;
 reconcile.append(checker);
 function update(){checker.hidden=!pending;checker.disabled=busy||workspace.hidden;
  for(const input of form.querySelectorAll('input,select'))input.disabled=busy;sync();}
 const rpc=()=>new Connection(`${location.origin}/api/solana/rpc`,'finalized');
 async function record(signature,epoch){
  const receipt=await post('/api/admin/withdrawals/reconcile',{signature});
  if(!current(epoch))return;
  if(receipt.finalized!==true||receipt.balanceDeltaVerified!==true||!receipt.signature||receipt.signature!==signature)throw Error('A finalized matching receipt and exact balance proof are required.');
  if(pending?.signature===signature)clear();
  review.textContent=`Finalized receipt ${receipt.signature}`;
  show(`Finalized ${Number(receipt.amountLamports)/1e9} SOL transfer recorded: ${receipt.signature}`);await refresh();
 }
 async function run(action){if(busy||workspace.hidden)return;const epoch=token();busy=true;update();try{await action();}catch(error){if(current(epoch))show(error.message,true);}finally{busy=false;update();}}
 form.addEventListener('submit',event=>{
  event.preventDefault();if(busy||pending||!form.reportValidity())return;
  const epoch=token();void run(async()=>{
   const source=$('#withdraw-source').value,destination=$('#withdraw-destination').value,amount=Number(exactSolLamports($('#withdraw-amount').value));
   if(!connected()||connected()!==source)throw Error('Connect the selected source wallet before signing its transfer.');
   if(amount<1000000||amount>5000000000)throw Error('Enter 0.001–5 SOL in exact lamports.');
   const plan=await post('/api/admin/withdrawals/prepare',{source,destination,amountLamports:amount});if(!current(epoch))return;
   if(plan.source!==source||plan.destination!==destination||plan.amountLamports!==amount)throw Error('The withdrawal review changed. Review it again.');
   const summary=`Withdraw ${amount/1e9} Devnet SOL\nFrom ${source}\nTo ${destination}\nThe source pays the network fee; at least 0.02 SOL must remain.`;
   review.textContent=summary.replaceAll('\n',' · ');if(!confirm(`${summary}\n\nContinue to your wallet?`))return;
   const connection=rpc();if(await connection.getGenesisHash()!=='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG')throw Error('The browser RPC is not Devnet.');
   if(!current(epoch))return;
   const provider=wallet();if(!provider?.signTransaction||provider.publicKey?.toBase58()!==source)throw Error('Connect the selected source wallet before signing.');
   const tx=new Transaction({feePayer:new PublicKey(source),recentBlockhash:plan.blockhash})
    .add(SystemProgram.transfer({fromPubkey:new PublicKey(source),toPubkey:new PublicKey(destination),lamports:amount}));
   const reviewedMessage=tx.serializeMessage();
   const signed=await provider.signTransaction(tx);if(!current(epoch))return;
   if(provider.publicKey?.toBase58()!==source||!signed.serializeMessage().equals(reviewedMessage))throw Error('The wallet or reviewed transfer changed before submission.');
   if(!Number.isSafeInteger(plan.lastValidBlockHeight)||!Number.isFinite(Date.parse(plan.expiresAt)))throw Error('The withdrawal review is missing its expiry. Review it again.');
   if(Date.now()>=Date.parse(plan.expiresAt)||!(await connection.isBlockhashValid(plan.blockhash,'confirmed')).value)throw Error('The withdrawal review expired. Review again before signing.');
   if(!current(epoch))return;
   const wire=signed.serialize(),signature=bs58.encode(signed.signature);
   save({signature,source,destination,amountLamports:amount,lastValidBlockHeight:plan.lastValidBlockHeight});update();
   show(`Transfer prepared: ${signature}. Waiting for Devnet confirmation.`);
   // From this point every failure retains the exact identity. Never re-sign.
   const sent=await connection.sendRawTransaction(wire,{skipPreflight:false,preflightCommitment:'confirmed',maxRetries:2});
   if(sent!==signature)throw Error('RPC returned a different signature; reconcile the saved transfer.');
   show(`Submitted ${signature}. Waiting for finalized Devnet confirmation.`);
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
  if(!SIGNATURE.test(signature)){show('Enter a valid Devnet transaction signature.',true);return;}void run(()=>record(signature,epoch));});
 checker.addEventListener('click',()=>{const row=pending,epoch=token();if(!row)return;void run(async()=>{
  const connection=rpc();if(await connection.getGenesisHash()!=='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG')throw Error('The browser RPC is not Devnet.');
  const status=(await connection.getSignatureStatuses([row.signature],{searchTransactionHistory:true})).value[0];
  if(status?.confirmationStatus==='finalized'&&!status.err){await record(row.signature,epoch);return;}
  const height=await connection.getBlockHeight('finalized'),transaction=await connection.getTransaction(row.signature,{commitment:'finalized',maxSupportedTransactionVersion:0});
  if(current(epoch)&&status?.confirmationStatus==='finalized'&&status.err&&transaction?.meta?.err
    &&transaction.transaction?.signatures?.includes(row.signature)){
   clear();review.textContent='The saved transfer failed on chain. You may review a new withdrawal.';show(review.textContent);return;
  }
  if(current(epoch)&&status===null&&transaction===null&&height>row.lastValidBlockHeight+32){
   clear();review.textContent='The saved transfer expired without landing. You may review a new withdrawal.';show(review.textContent);return;
  }
  throw Error('The saved transfer still needs reconciliation. No replacement was submitted.');
 });});
 new MutationObserver(update).observe(workspace,{attributes:true,attributeFilter:['hidden']});update();return{sync:update};
}
