import {randomUUID} from 'node:crypto';
import bs58 from 'bs58';
import {VersionedTransaction} from '@solana/web3.js';
import {allocationAuditHash} from './allocation-audit-hash.mjs';

const BUCKET='developerTokenReleases';
const clone=value=>structuredClone(value);
const MAX_FEE=100000,MAX_RENT=10000000,RESERVE=100000000,DAILY_BUDGET=20000000;
// Journal before sending. Unknown outcomes only rebroadcast the same bytes.
export async function executeDeveloperRelease({store,connection,authority,intent,prepare,prove,now=Date.now}) {
  if(intent.cluster!=='devnet'||await connection.getGenesisHash()!=='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'
    ||!/^[a-f0-9]{64}$/.test(intent.approvedHash)||intent.payer!==authority.publicKey.toBase58())throw Error('Approved Devnet release required.');
  const key=`${intent.programId}:${intent.mint}`,hash=allocationAuditHash(intent),token=randomUUID(),at=now();
  const row=await store.update(state=>{
    const rows=state[BUCKET]||={};const old=rows[key];
    if(old&&old.intentHash!==hash)throw Error('Developer release intent changed.');
    if(old?.signature||old?.leaseUntil>at)return clone(old);
    return clone(rows[key]={...old,intent:clone(intent),intentHash:hash,status:'preparing',token,leaseUntil:at+60000,attempts:old?.attempts||[]});
  });
  async function reconcile(current){
    const proof=await prove(current);
    if(proof?.status!=='finalized')return null;
    if(proof.signature!==current.signature||proof.amount!==intent.amount)throw Error('Developer release proof differs.');
    return store.update(state=>{
      const active=state[BUCKET][key];if(active.signature!==current.signature)return null;
      const {signedTransaction,...rest}=active;
      state[BUCKET][key]={...rest,status:'finalized',proof:clone(proof),finalizedAt:now()};
      return {status:'finalized',signature:current.signature,amount:proof.amount};
    });
  }
  let active=row;
  if(row.signature){
    const result=await reconcile(row);if(result)return result;
    const status=(await connection.getSignatureStatuses([row.signature],{searchTransactionHistory:true})).value?.[0];
    const expired=status===null&&await connection.getBlockHeight('finalized')>row.lastValidBlockHeight;
    if(status?.confirmationStatus==='finalized'&&status.err||expired){
      await store.update(state=>{const current=state[BUCKET][key];if(current.signature!==row.signature)return;
        const {signature,signedTransaction,blockhash,lastValidBlockHeight,...rest}=current;
        state[BUCKET][key]={...rest,status:expired?'expired':'failed',leaseUntil:0,
          attempts:[...current.attempts,{signature,status:expired?'expired':'failed',reservedLamports:current.reservedLamports,preparedAt:current.preparedAt}].slice(-100),reservedLamports:0};
      });
      return {status:expired?'expired':'failed',signature:row.signature};
    }
    if(status?.confirmationStatus==='finalized'||!row.signedTransaction||!(await connection.isBlockhashValid(row.blockhash,'finalized')).value)return {status:'pending',signature:row.signature};
  }else{
    if(row.token!==token)return {status:'busy'};
    if(row.attempts.length>=10)throw Error('Developer release retry limit reached.');
    const built=await prepare();const tx=built.transaction;
    if(!(tx instanceof VersionedTransaction)||tx.message.header.numRequiredSignatures!==1
      ||!tx.message.staticAccountKeys[0].equals(authority.publicKey)||tx.serialize().length>1232
      ||!Number.isSafeInteger(built.lastValidBlockHeight)||!Number.isSafeInteger(built.rentLamports)
      ||built.rentLamports<0||built.rentLamports>MAX_RENT)throw Error('Unbounded developer release transaction.');
    const [fee,balance,valid]=await Promise.all([connection.getFeeForMessage(tx.message,'confirmed'),connection.getBalance(authority.publicKey,'finalized'),connection.isBlockhashValid(tx.message.recentBlockhash,'finalized')]);
    if(!valid.value||!Number.isSafeInteger(fee.value)||fee.value<0||fee.value>MAX_FEE
      ||!Number.isSafeInteger(balance)||balance-fee.value-built.rentLamports<RESERVE)throw Error('Developer release payer budget unavailable.');
    tx.sign([authority]);
    active={...row,status:'pending',signature:bs58.encode(tx.signatures[0]),signedTransaction:Buffer.from(tx.serialize()).toString('base64'),
      blockhash:tx.message.recentBlockhash,lastValidBlockHeight:built.lastValidBlockHeight,reservedLamports:fee.value+built.rentLamports,preparedAt:now()};
    const saved=await store.update(state=>{
      const current=state[BUCKET][key];if(current.token!==token||current.signature||current.leaseUntil<now())return false;
      const spent=Object.values(state[BUCKET]).flatMap(r=>[r,...(r.attempts||[])]).filter(r=>r.preparedAt>=now()-86400000).reduce((sum,r)=>sum+(r.reservedLamports||0),0);
      if(spent+active.reservedLamports>DAILY_BUDGET)throw Error('Daily developer release budget exhausted.');
      state[BUCKET][key]=clone(active);return true;
    });
    if(!saved)return {status:'superseded'};
  }
  try{await connection.sendRawTransaction(Buffer.from(active.signedTransaction,'base64'),{skipPreflight:false,preflightCommitment:'confirmed',maxRetries:0});}catch{/* Reconcile receipt identity. */}
  return await reconcile(active)||{status:'pending',signature:active.signature};
}
