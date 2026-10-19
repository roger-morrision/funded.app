import {PublicKey} from '@solana/web3.js';

// Operational pause only: existing source collections and settlement evidence
// remain visible and must still reconcile. No fee destination is changed.
export function pausedFeeCollectionMints(env=process.env){
  const values=String(env.FUNDED_FEE_COLLECTION_PAUSED_MINTS||'').split(',').map(value=>value.trim()).filter(Boolean);
  if(values.length>100)throw new Error('Too many paused fee-collection mints.');
  return new Set(values.map(value=>{
    try{const mint=new PublicKey(value).toBase58();if(mint!==value)throw new Error();return mint;}
    catch{throw new Error('A configured fee-collection pause mint is invalid.');}
  }));
}
