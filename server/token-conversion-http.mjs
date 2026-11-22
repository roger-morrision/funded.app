import assert from 'node:assert/strict';
import {createHash,timingSafeEqual} from 'node:crypto';
import {VersionedTransaction} from '@solana/web3.js';
import bs58 from 'bs58';

export function conversionAuthorization(token){
  assert(typeof token==='string'&&token.length===64&&/^[a-f0-9]{64}$/.test(token),'Dedicated conversion authentication token required.');
  const digest=value=>createHash('sha256').update(value).digest(),expected=digest('Bearer '+token);
  return req=>timingSafeEqual(digest(String(req.headers.authorization||'')),expected);
}
export function conversionReply(res,code,value){
  if(res.destroyed||res.writableEnded)return;
  res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));
}
export async function conversionJson(stream,maximum=4096){
  let bytes=0;const chunks=[];
  for await(const chunk of stream){bytes+=Buffer.byteLength(chunk);assert(bytes<=maximum,'Conversion body exceeds bound.');chunks.push(Buffer.from(chunk));}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export function conversionObject(value,allowed){
  assert(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>allowed.includes(k)),'Unexpected conversion fields.');
  assert(value.schemaVersion===1,'Conversion protocol version required.');return value;
}
export function conversionSignature(value){
  assert(typeof value==='string'&&value.length<=88,'Canonical candidate signature required.');
  const bytes=bs58.decode(value);assert(bytes.length===64&&bs58.encode(bytes)===value,'Canonical candidate signature required.');
  return value;
}
export function unsignedConversionHash(request){
  assert(request?.cluster==='mainnet-beta'&&typeof request.programId==='string'&&typeof request.transaction==='string'&&request.transaction.length<=1644,'Exact conversion request required.');
  const bytes=Buffer.from(request.transaction,'base64');assert(bytes.length<=1232&&bytes.toString('base64')===request.transaction,'Canonical conversion wire required.');
  const tx=VersionedTransaction.deserialize(bytes);assert(tx.message.version===0&&tx.message.header.numRequiredSignatures===2
    &&tx.signatures.every(s=>s.every(b=>b===0)),'Unsigned two-role conversion required.');
  return {tx,messageHash:createHash('sha256').update(tx.message.serialize()).digest('hex')};
}
export const conversionSummary=value=>({status:value.status,messageHash:value.messageHash,
  signature:value.signature||null,stage:value.stage||null,proof:value.proof||null});
