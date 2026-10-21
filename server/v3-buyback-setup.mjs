import {PublicKey} from '@solana/web3.js';
import {createAssociatedTokenAccountIdempotentInstruction,getAssociatedTokenAddressSync,NATIVE_MINT,TOKEN_PROGRAM_ID} from '@solana/spl-token';
import {PUMP_AMM_PROGRAM_ID} from '@pump-fun/pump-swap-sdk';

const BUY=Buffer.from([102,6,61,18,1,218,235,234]);

// SDK output includes optional pool extension and account setup. Only this
// buy supplies CPI accounts; the router constructs its own bounded exact buy.
export function selectV3PumpBuy(instructions){
  const buys=instructions.filter(ix=>ix.programId?.equals(PUMP_AMM_PROGRAM_ID)
    &&Buffer.from(ix.data||[]).length===25&&Buffer.from(ix.data).subarray(0,8).equals(BUY));
  if(buys.length!==1)throw new Error('An exact unique PumpSwap buy instruction is required.');
  return buys[0];
}

// Front canonical fee-account rent with the authority in the same atomic
// transaction so category funds pay only for the bounded purchase.
export function v3BuybackFeeSetup({pumpBuyInstruction:buy,authority}){
  if(!buy?.programId?.equals(PUMP_AMM_PROGRAM_ID)||!Buffer.from(buy.data||[]).subarray(0,8).equals(BUY)
    ||![25,26,27].includes(buy.keys?.length))throw new Error('Reviewed PumpSwap fee accounts are required.');
  const payer=new PublicKey(authority),pairs=[[9,10],[18,17],[buy.keys.length-2,buy.keys.length-1]],seen=new Set();
  return pairs.flatMap(([ownerIndex,ataIndex])=>{
    const owner=buy.keys[ownerIndex].pubkey,ata=buy.keys[ataIndex].pubkey;
    if(!getAssociatedTokenAddressSync(NATIVE_MINT,owner,true,TOKEN_PROGRAM_ID).equals(ata))
      throw new Error('PumpSwap fee custody is not its canonical SOL token account.');
    const key=ata.toBase58();if(seen.has(key))return[];seen.add(key);
    return[createAssociatedTokenAccountIdempotentInstruction(payer,ata,owner,NATIVE_MINT,TOKEN_PROGRAM_ID)];
  });
}
