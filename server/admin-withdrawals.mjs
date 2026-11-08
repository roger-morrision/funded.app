import {randomUUID} from 'node:crypto';
import bs58 from 'bs58';
import {PublicKey,SystemProgram,Transaction} from '@solana/web3.js';
import {DEVNET_GENESIS_HASH} from './automatic-reward-chain.mjs';
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
  if(!tx?.meta||tx.meta.err||!integer(tx.slot)||tx.slot<1||tx.transaction.signatures?.[0]!==signature
    ||tx.transaction.signatures.length!==1||sourceIndex!==0||destinationIndex<0||source===destination||keys[0]?.signer!==true
    ||instructions.length!==1||instruction.program!=='system'||transfer?.type!=='transfer'||!integer(amount)||amount<1||!integer(tx.meta.fee)
    ||tx.meta.innerInstructions?.some(row=>row.instructions?.length)
    ||tx.meta.postBalances[destinationIndex]-tx.meta.preBalances[destinationIndex]!==amount
    ||tx.meta.preBalances[sourceIndex]-tx.meta.postBalances[sourceIndex]!==amount+tx.meta.fee)return null;
  return{tx,source,destination,amount};
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
    const [account,blockhash]=await Promise.all([rpc.getAccountInfo(pubkey,'finalized'),rpc.getLatestBlockhash('finalized')]);
    if(!PublicKey.isOnCurve(pubkey.toBytes())||account&&(account.executable||!account.owner.equals(SystemProgram.programId)||account.data.length!==0))
      throw error(409,'Program vaults require their authorized payout instructions; they are not wallet withdrawal sources.');
    const tx=new Transaction({feePayer:pubkey,recentBlockhash:blockhash.blockhash})
      .add(SystemProgram.transfer({fromPubkey:pubkey,toPubkey:new PublicKey(admin),lamports:1}));
    const fee=(await rpc.getFeeForMessage(tx.compileMessage(),'finalized')).value,balance=account?.lamports||0,reserve=reserveFor(role);
    return{source,destination:admin,signingMode:role.signingMode,blockhash:blockhash.blockhash,lastValidBlockHeight:blockhash.lastValidBlockHeight,
      balanceLamports:String(balance),estimatedFeeLamports:fee,reserveLamports:String(reserve),maximumLamports:String(withdrawalMaximum(balance,fee,reserve))};
  }
  async function saveReceipt(transfer,signature,admin){
    sourceRole(transfer.source,admin);
    if(transfer.destination!==admin)throw error(409,'Withdrawal destination must be the signed-in admin wallet.');
    const receipt={action:'wallet-withdrawal',source:transfer.source,destination:admin,amountLamports:String(transfer.amount),signature,
      wallet:admin,slot:transfer.tx.slot,at:new Date(now()).toISOString(),finalized:true,balanceDeltaVerified:true};
    return store.update(state=>{state.adminAudit||={};state.adminAudit[`withdraw:${signature}`]||=receipt;
      const pending=state.adminWithdrawalIntents?.[transfer.source];
      if(pending?.signature===signature)pending.status='finalized';return state.adminAudit[`withdraw:${signature}`];});
  }
  async function priorIntent(rpc,source){
    const prior=(await store.read()).adminWithdrawalIntents?.[source];
    if(!prior||['finalized','failed-finalized','expired'].includes(prior.status))return null;
    if(!prior.signature){if(prior.leaseUntil>now())throw error(409,'A withdrawal is being prepared for this source. Retry shortly.');return null;}
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
  return async function handle(req,res,url,{session,body,json}){
    if(!url.pathname.startsWith('/api/admin/withdrawals/'))return false;
    try{
      const admin=session.wallet,path=url.pathname,rpc=await verifiedRpc();
      if(req.method==='GET'&&path==='/api/admin/withdrawals/maximum')return json(res,200,await quote(rpc,url.searchParams.get('source'),admin));
      if(req.method==='GET'&&path==='/api/admin/withdrawals/pending'){
        const source=url.searchParams.get('source');sourceRole(source,admin);
        const pending=(await store.read()).adminWithdrawalIntents?.[source];
        return json(res,200,{pending:pending?.destination===admin&&pending.signature&&!['finalized','expired','failed-finalized'].includes(pending.status)
          ?{signature:pending.signature,source,destination:admin,amountLamports:pending.amountLamports,lastValidBlockHeight:pending.lastValidBlockHeight}:null});
      }
      if(req.method!=='POST')return json(res,405,{error:'Method not allowed.'});
      const input=await body(req)||{};
      if(Object.hasOwn(input,'destination')&&input.destination!==admin)throw error(403,'Withdrawals can only go to the signed-in admin wallet.');
      if(path==='/api/admin/withdrawals/prepare'){
        const source=String(input.source||''),role=sourceRole(source,admin),amount=Number(input.amountLamports);
        if(!integer(amount)||amount<1)throw error(400,'Enter a positive exact SOL amount.');
        if(role.signingMode==='server'){
          const previous=await priorIntent(rpc,source);
          if(previous){
            if(previous.status==='finalized')return json(res,200,previous.receipt);
            if(previous.destination!==admin||Number(previous.amountLamports)!==amount)throw error(409,'This source has a pending withdrawal. Reconcile its existing transaction first.');
            return json(res,200,{...previous,recovery:true});
          }
        }
        const plan=await quote(rpc,source,admin);
        if(amount>Number(plan.maximumLamports))throw error(409,'Amount exceeds the available balance after network fees and the protected reserve. Refresh Max.');
        Object.assign(plan,{id:randomUUID(),amountLamports:amount,expiresAt:new Date(now()+120000).toISOString()});
        if(role.signingMode==='server'){
          const token=randomUUID();
          const acquired=await store.update(state=>{state.adminWithdrawalIntents||={};const current=state.adminWithdrawalIntents[source];
            if(current&&!['finalized','failed-finalized','expired'].includes(current.status)&&(current.signature||current.leaseUntil>now()))return false;
            state.adminWithdrawalIntents[source]={token,source,destination:admin,status:'preparing',leaseUntil:now()+60000};return true;});
          if(!acquired)throw error(409,'Another withdrawal is pending for this source.');
          const signer=signerFor(source);if(!signer||signer.publicKey.toBase58()!==source)throw error(503,'Source signer is unavailable.');
          const tx=new Transaction({feePayer:signer.publicKey,recentBlockhash:plan.blockhash})
            .add(SystemProgram.transfer({fromPubkey:signer.publicKey,toPubkey:new PublicKey(admin),lamports:amount}));tx.sign(signer);
          const signedTransaction=tx.serialize().toString('base64'),signature=bs58.encode(tx.signature);
          const saved=await store.update(state=>{const active=state.adminWithdrawalIntents?.[source];
            if(active?.token!==token||active.signature||active.leaseUntil<=now())return null;
            return state.adminWithdrawalIntents[source]={...plan,status:'verification-pending',signature,signedTransaction};});
          if(!saved)throw error(409,'Withdrawal preparation expired. No transaction was submitted.');
          return json(res,200,saved);
        }
        return json(res,200,plan);
      }
      if(['/api/admin/withdrawals/verify','/api/admin/withdrawals/reconcile'].includes(path)){
        const signature=String(input.signature||'');if(!signaturePattern.test(signature))throw error(400,'Enter a Solana transaction signature.');
        const transfer=await finalizedAdminTransfer(rpc,signature);if(!transfer)throw error(409,'No matching finalized transfer and exact balance changes were found.');
        return json(res,200,await saveReceipt(transfer,signature,admin));
      }
      return json(res,404,{error:'Unknown withdrawal action.'});
    }catch(failure){return json(res,failure.status||503,{error:failure.status?failure.message:'Withdrawal verification is unavailable. No replacement transaction was authorized.'});}
  };
}
