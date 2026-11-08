import {randomUUID} from 'node:crypto';
import bs58 from 'bs58';
import {PublicKey,SystemProgram,Transaction} from '@solana/web3.js';
import {DEVNET_GENESIS_HASH} from './automatic-reward-chain.mjs';
import {ADMIN_EMAIL_AUTHORIZED} from './admin-email-verification.mjs';
import {withdrawalSessionHash,adminWithdrawalTransaction,verifyAdminWithdrawalSignature} from './admin-withdrawal-signing.mjs';
const signaturePattern=/^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const error=(status,message)=>Object.assign(Error(message),{status});
const integer=value=>Number.isSafeInteger(value)&&value>=0;
export function withdrawalMaximum(balance,fee,reserve){
  if(![balance,fee,reserve].every(integer))throw error(503,'Finalized balance, network fee and reserve must be available.');
  return Math.max(0,balance-fee-reserve);
}
export async function finalizedAdminTransfer(rpc,signature){
  const tx=await rpc.getParsedTransaction(signature,{commitment:'finalized',maxSupportedTransactionVersion:0});
  const message=tx?.transaction?.message,instructions=message?.instructions||[],instruction=instructions[0],transfer=instruction?.parsed;
  const keys=message?.accountKeys||[],source=transfer?.info?.source,destination=transfer?.info?.destination,amount=transfer?.info?.lamports;
  const sourceIndex=keys.findIndex(key=>key.pubkey.toBase58()===source),destinationIndex=keys.findIndex(key=>key.pubkey.toBase58()===destination);
  const adminPays=destinationIndex===0,sourcePays=sourceIndex===0,fee=tx?.meta?.fee;
  if(!tx?.meta||tx.meta.err||!integer(tx.slot)||tx.slot<1||tx.transaction.signatures?.[0]!==signature
    ||tx.transaction.signatures.length!==(adminPays?2:1)||(!adminPays&&!sourcePays)||sourceIndex<0||destinationIndex<0
    ||source===destination||keys[0]?.signer!==true||keys[sourceIndex]?.signer!==true
    ||instructions.length!==1||instruction.program!=='system'||transfer?.type!=='transfer'||!integer(amount)||amount<1||!integer(tx.meta.fee)
    ||tx.meta.innerInstructions?.some(row=>row.instructions?.length)
    ||tx.meta.postBalances[destinationIndex]-tx.meta.preBalances[destinationIndex]!==amount-(adminPays?fee:0)
    ||tx.meta.preBalances[sourceIndex]-tx.meta.postBalances[sourceIndex]!==amount+(sourcePays?fee:0))return null;
  return{tx,source,destination,amount,feePayer:adminPays?destination:source};
}
export function createAdminWithdrawals({store,env,connection,roles,signerFor,now=Date.now}){
  function sourceRole(source,admin){
    const row=roles().find(row=>row.address===source&&row.withdrawable);
    if(!row||source===admin)throw error(400,'Choose an app source different from the signed-in admin wallet.');
    return row;
  }
  const reserveFor=row=>{
    const configured=env.FUNDED_ADMIN_WITHDRAW_RESERVE_LAMPORTS;
    const minimum=Number(row.reserveFloorLamports||20000000);
    if(configured===undefined||configured==='')return minimum;
    if(!/^\d+$/.test(configured)||!integer(Number(configured)))throw error(503,'Withdrawal reserve configuration is invalid.');
    return Math.max(minimum,Number(configured));
  };
  async function verifiedRpc(){const rpc=connection();if(await rpc.getGenesisHash()!==DEVNET_GENESIS_HASH)throw error(503,'Withdrawal RPC is not Devnet.');return rpc;}
  async function quote(rpc,source,admin){
    const role=sourceRole(source,admin),pubkey=new PublicKey(source);
    const [account,adminAccount,blockhash,adminRent]=await Promise.all([rpc.getAccountInfo(pubkey,'finalized'),
      rpc.getAccountInfo(new PublicKey(admin),'finalized'),rpc.getLatestBlockhash('finalized'),rpc.getMinimumBalanceForRentExemption(0,'finalized')]);
    if(!PublicKey.isOnCurve(pubkey.toBytes())||account&&(account.executable||!account.owner.equals(SystemProgram.programId)||account.data.length!==0))
      throw error(409,'Program vaults require their authorized payout instructions; they are not wallet withdrawal sources.');
    const tx=new Transaction({feePayer:new PublicKey(admin),recentBlockhash:blockhash.blockhash})
      .add(SystemProgram.transfer({fromPubkey:pubkey,toPubkey:new PublicKey(admin),lamports:1}));
    const fee=(await rpc.getFeeForMessage(tx.compileMessage(),'finalized')).value,balance=account?.lamports||0,reserve=reserveFor(role);
    withdrawalMaximum(balance,fee,reserve);
    if(!integer(adminRent)||adminRent<1||!integer(fee+adminRent))throw error(503,'Admin rent reserve or network fee is unavailable.');
    const adminBalance=adminAccount?.lamports||0;
    if(!adminAccount||!adminAccount.owner.equals(SystemProgram.programId)||adminAccount.data.length!==0||!integer(adminBalance)||adminBalance<fee+adminRent)
      throw error(409,'Fund the signed-in admin wallet with enough SOL for the network fee and its rent reserve before withdrawing.');
    return{source,destination:admin,feePayer:admin,signingMode:role.signingMode,blockhash:blockhash.blockhash,lastValidBlockHeight:blockhash.lastValidBlockHeight,
      balanceLamports:String(balance),adminBalanceLamports:String(adminBalance),estimatedFeeLamports:fee,reserveLamports:String(reserve),maximumLamports:String(withdrawalMaximum(balance,0,reserve))};
  }
  async function saveReceipt(transfer,signature,admin){
    sourceRole(transfer.source,admin);
    if(transfer.destination!==admin)throw error(409,'Withdrawal destination must be the signed-in admin wallet.');
    const receipt={action:'wallet-withdrawal',source:transfer.source,destination:admin,amountLamports:String(transfer.amount),signature,
      wallet:admin,slot:transfer.tx.slot,at:new Date(now()).toISOString(),finalized:true,balanceDeltaVerified:true};
    Object.assign(receipt,{feePayer:transfer.feePayer,feeLamports:String(transfer.tx.meta.fee),
      sourceDebitLamports:String(transfer.amount+(transfer.feePayer===transfer.source?transfer.tx.meta.fee:0)),
      recipientCreditLamports:String(transfer.amount-(transfer.feePayer===admin?transfer.tx.meta.fee:0))});
    return store.update(state=>{state.adminAudit||={};state.adminAudit[`withdraw:${signature}`]||=receipt;
      const pending=state.adminWithdrawalIntents?.[transfer.source];
      if(pending?.signature===signature)pending.status='finalized';return state.adminAudit[`withdraw:${signature}`];});
  }
  async function priorIntent(rpc,source){
    const prior=(await store.read()).adminWithdrawalIntents?.[source];
    if(!prior||['finalized','failed-finalized','expired'].includes(prior.status))return null;
    if(!prior.signature){
      if(prior.status==='awaiting-admin-signature'){
        if(await rpc.getBlockHeight('finalized')<=prior.lastValidBlockHeight+32)return prior;
        await store.update(state=>{const active=state.adminWithdrawalIntents?.[source];if(active?.id===prior.id&&!active.signature)active.status='expired';});return null;
      }
      if(prior.leaseUntil>now())throw error(409,'A withdrawal is being prepared for this source. Retry shortly.');return null;
    }
    const transfer=await finalizedAdminTransfer(rpc,prior.signature);
    if(transfer){
      if(transfer.source!==source||transfer.destination!==prior.destination||transfer.amount!==Number(prior.amountLamports)
        ||transfer.tx.transaction.message.recentBlockhash!==prior.blockhash)throw error(409,'Pending withdrawal proof does not match its saved intent.');
      const receipt=await saveReceipt(transfer,prior.signature,prior.destination);return{...prior,status:'finalized',receipt};
    }
    const [status,height,transaction]=await Promise.all([rpc.getSignatureStatuses([prior.signature],{searchTransactionHistory:true}),
      rpc.getBlockHeight('finalized'),rpc.getTransaction(prior.signature,{commitment:'finalized',maxSupportedTransactionVersion:0})]);
    const observed=status.value?.[0];
    const failed=observed?.confirmationStatus==='finalized'&&observed.err&&transaction?.meta?.err&&transaction.transaction?.signatures?.[0]===prior.signature;
    const expired=observed===null&&transaction===null&&height>prior.lastValidBlockHeight+32;
    if(failed||expired){await store.update(state=>{const active=state.adminWithdrawalIntents?.[source];
      if(active?.signature===prior.signature)active.status=failed?'failed-finalized':'expired';});return null;}
    return prior;
  }
  const handle=async function handle(req,res,url,{session,sessionId,body,json}){
    if(!url.pathname.startsWith('/api/admin/withdrawals/'))return false;
    try{
      const admin=session.wallet,path=url.pathname,rpc=await verifiedRpc();
      if(req.method==='GET'&&path==='/api/admin/withdrawals/maximum')return json(res,200,await quote(rpc,url.searchParams.get('source'),admin));
      if(req.method==='GET'&&path==='/api/admin/withdrawals/pending'){
        const source=url.searchParams.get('source');sourceRole(source,admin);
        const pending=(await store.read()).adminWithdrawalIntents?.[source];
        return json(res,200,{pending:pending?.destination===admin&&pending.signature&&!['finalized','expired','failed-finalized'].includes(pending.status)
          ?{signature:pending.signature,intentId:pending.id,source,destination:admin,feePayer:pending.feePayer,amountLamports:pending.amountLamports,lastValidBlockHeight:pending.lastValidBlockHeight}:null});
      }
      if(req.method!=='POST')return json(res,405,{error:'Method not allowed.'});
      const input=await body(req)||{};
      if(Object.hasOwn(input,'destination')&&input.destination!==admin)throw error(403,'Withdrawals can only go to the signed-in admin wallet.');
      if(path==='/api/admin/withdrawals/prepare'){
        if(!req[ADMIN_EMAIL_AUTHORIZED]||!sessionId)throw error(403,'Verify the email code for this withdrawal first.');
        const source=String(input.source||''),role=sourceRole(source,admin),amount=Number(input.amountLamports);
        if(!integer(amount)||amount<1)throw error(400,'Enter a positive exact SOL amount.');
        if(role.signingMode==='server'){
          const previous=await priorIntent(rpc,source);
          if(previous){
            if(previous.status==='finalized')return json(res,200,previous.receipt);
            if(previous.destination!==admin||Number(previous.amountLamports)!==amount)throw error(409,'This source has a pending withdrawal. Reconcile its existing transaction first.');
            await store.update(state=>{const active=state.adminWithdrawalIntents?.[source];
              if(active?.id===previous.id){active.approvedSessionHash=withdrawalSessionHash(sessionId);active.emailApprovalId=req[ADMIN_EMAIL_AUTHORIZED].id;}});
            return json(res,200,{...previous,recovery:true});
          }
        }
        const plan=await quote(rpc,source,admin);
        if(amount>Number(plan.maximumLamports))throw error(409,'Amount exceeds the available source balance after its protected reserve. Refresh Max.');
        Object.assign(plan,{id:randomUUID(),amountLamports:amount,expiresAt:new Date(now()+120000).toISOString(),
          approvedSessionHash:withdrawalSessionHash(sessionId),emailApprovalId:req[ADMIN_EMAIL_AUTHORIZED].id});
        if(role.signingMode==='server'){
          const token=randomUUID();
          const acquired=await store.update(state=>{state.adminWithdrawalIntents||={};const current=state.adminWithdrawalIntents[source];
            if(current&&!['finalized','failed-finalized','expired'].includes(current.status)&&(current.signedTransaction||current.signature||current.leaseUntil>now()))return false;
            state.adminWithdrawalIntents[source]={token,source,destination:admin,status:'preparing',leaseUntil:now()+60000};return true;});
          if(!acquired)throw error(409,'Another withdrawal is pending for this source.');
          const signer=signerFor(source);if(!signer||signer.publicKey.toBase58()!==source)throw error(503,'Source signer is unavailable.');
          const tx=adminWithdrawalTransaction(plan);tx.partialSign(signer);
          const signedTransaction=tx.serialize({requireAllSignatures:false}).toString('base64');
          const sourceSignature=bs58.encode(tx.signatures.find(row=>row.publicKey.equals(signer.publicKey)).signature);
          const saved=await store.update(state=>{const active=state.adminWithdrawalIntents?.[source];
            if(active?.token!==token||active.signature||active.leaseUntil<=now())return null;
            return state.adminWithdrawalIntents[source]={...plan,status:'awaiting-admin-signature',sourceSignature,signedTransaction};});
          if(!saved)throw error(409,'Withdrawal preparation expired. No transaction was submitted.');
          return json(res,200,saved);
        }
        return json(res,200,plan);
      }
      if(path==='/api/admin/withdrawals/submit'){
        const approved=await authorizeContinuation({session,sessionId,path,input});
        if(!approved)throw error(403,'The signed transaction must continue the email-approved withdrawal in this admin session.');
        const saved=await store.update(state=>{const plan=Object.values(state.adminWithdrawalIntents||{}).find(row=>row.id===input.intentId);
          if(!plan||plan.approvedSessionHash!==withdrawalSessionHash(sessionId)||plan.destination!==admin)throw error(409,'Withdrawal intent changed.');
          const {signature}=verifyAdminWithdrawalSignature(plan,input.signedTransaction);
          if(plan.signature&&plan.signature!==signature)throw error(409,'A different signature was already recorded.');
          plan.signature=signature;plan.signedTransaction=input.signedTransaction;
          if(plan.status!=='finalized')plan.status='verification-pending';
          return{registered:true,intentId:plan.id,signature,finalized:plan.status==='finalized'};});
        return json(res,200,saved);
      }
      if(['/api/admin/withdrawals/verify','/api/admin/withdrawals/reconcile'].includes(path)){
        const signature=String(input.signature||'');if(!signaturePattern.test(signature))throw error(400,'Enter a Solana transaction signature.');
        const transfer=await finalizedAdminTransfer(rpc,signature);if(!transfer)throw error(409,'No matching finalized transfer and exact balance changes were found.');
        return json(res,200,await saveReceipt(transfer,signature,admin));
      }
      return json(res,404,{error:'Unknown withdrawal action.'});
    }catch(failure){return json(res,failure.status||503,{error:failure.status?failure.message:'Withdrawal verification is unavailable. No replacement transaction was authorized.'});}
  };
  async function authorizeContinuation({session,sessionId,path,input}){
    if(!['/api/admin/withdrawals/submit','/api/admin/withdrawals/reconcile'].includes(path)||!input?.intentId||!sessionId)return null;
    const plan=Object.values((await store.read()).adminWithdrawalIntents||{}).find(row=>row.id===input.intentId);
    if(!plan?.emailApprovalId||plan.destination!==session.wallet||plan.feePayer!==session.wallet
      ||plan.approvedSessionHash!==withdrawalSessionHash(sessionId))return null;
    if(path.endsWith('/submit')){
      if(Object.keys(input).some(key=>!['intentId','signedTransaction'].includes(key))||['failed-finalized','expired'].includes(plan.status))return null;
      try{const {signature}=verifyAdminWithdrawalSignature(plan,input.signedTransaction);if(plan.signature&&plan.signature!==signature)return null;}catch{return null;}
    }else if(Object.keys(input).some(key=>!['intentId','signature'].includes(key))||!plan.signature||input.signature!==plan.signature)return null;
    return{id:plan.emailApprovalId,wallet:session.wallet,continuation:true,intentId:plan.id};
  }
  return Object.assign(handle,{authorizeContinuation});
}
