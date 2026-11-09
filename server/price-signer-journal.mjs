import {readFile,open,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import assert from 'node:assert/strict';

// One service instance owns this append-only journal. A reservation is fsynced
// BEFORE a signature leaves the process. Crashes consume budget conservatively.
export class PriceSignerJournal {
  constructor(path){this.path=path;this.entries=[];this.ready=false;}
  async load(){
    await mkdir(dirname(this.path),{recursive:true,mode:0o700});
    try{this.entries=(await readFile(this.path,'utf8')).split('\n').filter(Boolean).map(JSON.parse);}
    catch(error){if(error.code!=='ENOENT')throw Error('Price signer journal is corrupt or unavailable.');}
    for(const row of this.entries)assert(row.type==='reservation'&&/^[a-f0-9]{64}$/.test(row.messageHash)
      &&Number.isSafeInteger(row.at)&&/^[1-9]\d*$/.test(row.quote)&&row.vault&&row.programId&&row.receipt&&row.blockhash,'Invalid signer journal.');
    this.ready=true;
  }
  async reserve(review,{connection,maxDailyLamports,now=Date.now()}){
    assert(this.ready,'Signer journal has not loaded.');
    const existing=this.entries.find(row=>row.messageHash===review.messageHash);
    if(existing)return existing;
    const pending=this.entries.filter(row=>row.programId===review.programId&&row.vault===review.vault);
    for(const row of pending){
      if((await connection.isBlockhashValid(row.blockhash,'confirmed')).value)
        throw Error('This fee vault already has a signed transaction awaiting expiry.');
    }
    const used=this.entries.filter(row=>row.at>now-86400000).reduce((sum,row)=>sum+BigInt(row.quote),0n);
    assert(used+BigInt(review.quote)<=BigInt(maxDailyLamports),'Rolling daily signing budget exceeded.');
    const {messageHash,programId,vault,receipt,blockhash,quote,minimum,slot}=review;
    const row={type:'reservation',at:now,messageHash,programId,vault,receipt,blockhash,quote,minimum,slot};
    const file=await open(this.path,'a',0o600);
    try{await file.writeFile(JSON.stringify(row)+'\n');await file.sync();}finally{await file.close();}
    this.entries.push(row);return row;
  }
}
