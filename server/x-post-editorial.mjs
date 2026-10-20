import {createHash} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
import bs58 from 'bs58';
import {formatXSol,xWeightedLength} from './x-post-content.mjs';

const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
export const xEventHash=event=>createHash('sha256').update(JSON.stringify(stable(event))).digest('hex');
export function checkedPayout(value){
  if(!value||!['holder','creator','referral','x','operations','bonus'].includes(value.kind)
    ||typeof value.amountLamports!=='string'||!/^[1-9]\d{0,39}$/.test(value.amountLamports))throw new Error('Invalid payout summary facts.');
  let recipient;try{recipient=new PublicKey(value.recipient).toBase58();}catch{throw new Error('Invalid payout recipient.');}
  return{kind:value.kind,amountLamports:value.amountLamports,recipient};
}
function terms(text){
  return String(text).normalize('NFKC').toLowerCase().replace(/https:\/\/\S+/g,' ')
    .replace(/[1-9a-hj-np-z]{32,88}/gi,' ').replace(/\b\d[\d.,:-]*\b/g,' ')
    .replace(/[^\p{L}\p{N}]+/gu,' ').trim().split(/\s+/).filter(Boolean);
}
export function substantiallySimilar(a,b){
  if(a===b)return true;
  const left=terms(a),right=terms(b);
  if(!left.length||!right.length)return false;
  if(left.join(' ')===right.join(' '))return true;
  const x=new Set(left),y=new Set(right),shared=[...x].filter(word=>y.has(word)).length;
  // Conservative hold for editorial review, not a claim to reproduce X's rules.
  return Math.min(left.length,right.length)>=6&&shared/(x.size+y.size-shared)>=0.8;
}
export function editorialBlock(event){
  if(['auto_payout','daily_rewards'].includes(event.kind))return'legacy-payout-posts-disabled';
  if(/(^|[^\w])@[a-z0-9_]{1,15}\b/i.test(event.text))return'unsolicited-mentions-disabled';
  return null;
}
function validProof(proof){
  if(proof?.cluster!=='devnet'||proof.commitment!=='finalized')return false;
  if(proof.kind==='finalized-proof-set')return Number.isSafeInteger(proof.count)&&proof.count>0&&/^[a-f0-9]{64}$/.test(proof.sha256)
    &&Number.isSafeInteger(proof.firstSlot)&&proof.firstSlot>0&&proof.lastSlot>=proof.firstSlot
    &&Array.isArray(proof.sample)&&proof.sample.length>0&&proof.sample.every(validProof);
  try{return proof.verified===true&&Number.isSafeInteger(proof.slot)&&proof.slot>0&&bs58.decode(proof.signature).length===64;}catch{return false;}
}
export function buildPayoutDigest(rows,{day,origin='https://funded.vip'}={}){
  const start=Date.parse(`${day}T00:00:00Z`);
  if(!Number.isFinite(start)||new Date(start).toISOString().slice(0,10)!==day||!rows.length||rows.length>10000)
    throw new Error('A bounded completed UTC recording day is required.');
  const url=new URL(origin);
  if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('A public HTTPS origin is required.');
  const sources=rows.map(row=>row.event).sort((a,b)=>a.id.localeCompare(b.id));
  if(new Set(sources.map(event=>event.id)).size!==sources.length)throw new Error('Duplicate payout summary sources.');
  const recipients=new Set();let total=0n;
  for(const event of sources){
    if(event.kind!=='auto_payout'||event.cluster!=='devnet'||!Array.isArray(event.proofs)||!event.proofs.length||!event.proofs.every(validProof))throw new Error('Verified Devnet payout sources are required.');
    const facts=checkedPayout(event.payout);recipients.add(facts.recipient);total+=BigInt(facts.amountLamports);
  }
  const text=`[Devnet test] Payout receipts recorded ${day} UTC: ${sources.length} payment${sources.length===1?'':'s'} to ${recipients.size} wallet${recipients.size===1?'':'s'}, ${formatXSol(total)} SOL gross. Test SOL only. Review individual receipts and net amounts:\n${url.origin}/#payments`;
  if(Buffer.byteLength(text)>280||xWeightedLength(text)>280)throw new Error('Daily summary exceeds the post limit.');
  return{id:`devnet:payout_digest:${day}`,kind:'payout_digest',cluster:'devnet',occurredAt:new Date(start+86400000).toISOString(),text,
    proofs:{kind:'recorded-payout-summary',recordedDay:day,count:sources.length,sourceHash:xEventHash(sources),grossLamports:String(total),walletCount:recipients.size}};
}
