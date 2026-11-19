import {readFile,open,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import assert from 'node:assert/strict';
import {unusedPriceReservation} from './price-signer-reconciliation.mjs';

// One service instance owns this append-only journal. A reservation is fsynced
// BEFORE a signature leaves the process. Charges remain until independent
// finalized expiry and absent-receipt evidence durably releases them.
export class PriceSignerJournal {
  constructor(path){this.path=path;this.entries=[];this.ready=false;}
  async load(){
    await mkdir(dirname(this.path),{recursive:true,mode:0o700});
    try{this.entries=(await readFile(this.path,'utf8')).split('\n').filter(Boolean).map(JSON.parse);}
    catch(error){if(error.code!=='ENOENT')throw Error('Price signer journal is corrupt or unavailable.');}
    const reservations=new Map(),released=new Set();
    for(const row of this.entries){
      assert(/^[a-f0-9]{64}$/.test(row.messageHash)&&Number.isSafeInteger(row.at),'Invalid signer journal.');
      if(row.type==='reservation'){
        assert(!reservations.has(row.messageHash)&&Number.isSafeInteger(row.slot)&&row.slot>0&&/^[1-9]\d*$/.test(row.quote)&&row.vault&&row.programId&&row.receipt&&row.blockhash,'Invalid signer reservation.');
        reservations.set(row.messageHash,row);
      }else{
        const original=reservations.get(row.messageHash);
        assert(row.type==='release'&&original&&!released.has(row.messageHash)
          &&Number.isSafeInteger(row.expirySlot)&&row.expirySlot>=original.slot
          &&Number.isSafeInteger(row.receiptSlot)&&row.receiptSlot>=row.expirySlot,'Invalid signer release.');
        released.add(row.messageHash);
      }
    }
    this.ready=true;
  }
  async reserve(review,{connection,maxDailyLamports,now=Date.now()}){
    assert(this.ready,'Signer journal has not loaded.');
    const released=new Set(this.entries.filter(row=>row.type==='release').map(row=>row.messageHash));
    assert(!released.has(review.messageHash),'Released signing message cannot be reused.');
    const existing=this.entries.find(row=>row.type==='reservation'&&row.messageHash===review.messageHash);
    if(existing)return existing;
    for(const row of this.entries.filter(row=>row.type==='reservation'&&!released.has(row.messageHash)
      &&(row.at>now-86400000||row.programId===review.programId&&row.vault===review.vault))){
      const evidence=await unusedPriceReservation(connection,row);
      if(evidence){await this.append({type:'release',at:now,messageHash:row.messageHash,...evidence});released.add(row.messageHash);}
    }
    const charged=this.entries.filter(row=>row.type==='reservation'&&!released.has(row.messageHash));
    const pending=charged.filter(row=>row.programId===review.programId&&row.vault===review.vault);
    for(const row of pending){
      if((await connection.isBlockhashValid(row.blockhash,{commitment:'confirmed'})).value)
        throw Error('This fee vault already has a signed transaction awaiting expiry.');
    }
    const used=charged.filter(row=>row.at>now-86400000).reduce((sum,row)=>sum+BigInt(row.quote),0n);
    assert(used+BigInt(review.quote)<=BigInt(maxDailyLamports),'Rolling daily signing budget exceeded.');
    const {messageHash,programId,vault,receipt,blockhash,quote,minimum,slot}=review;
    const row={type:'reservation',at:now,messageHash,programId,vault,receipt,blockhash,quote,minimum,slot};
    await this.append(row);return row;
  }
  async append(row){
    const file=await open(this.path,'a',0o600);
    try{await file.writeFile(JSON.stringify(row)+'\n');await file.sync();}finally{await file.close();}
    this.entries.push(row);return row;
  }
}
