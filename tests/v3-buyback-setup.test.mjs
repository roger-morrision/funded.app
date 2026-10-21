import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,SystemProgram,TransactionInstruction} from '@solana/web3.js';
import {ASSOCIATED_TOKEN_PROGRAM_ID,getAssociatedTokenAddressSync,NATIVE_MINT,TOKEN_PROGRAM_ID} from '@solana/spl-token';
import {PUMP_AMM_PROGRAM_ID} from '@pump-fun/pump-swap-sdk';
import {selectV3PumpBuy,v3BuybackFeeSetup} from '../server/v3-buyback-setup.mjs';
const key=n=>Keypair.fromSeed(Buffer.alloc(32,n)).publicKey;
function buy(length=26){
  const keys=Array.from({length},(_,i)=>({pubkey:key(i+1),isSigner:false,isWritable:false}));
  for(const [owner,ata]of [[9,10],[18,17],[length-2,length-1]])keys[ata].pubkey=getAssociatedTokenAddressSync(NATIVE_MINT,keys[owner].pubkey,true);
  return new TransactionInstruction({programId:PUMP_AMM_PROGRAM_ID,keys,data:Buffer.concat([Buffer.from('66063d1201daebea','hex'),Buffer.alloc(17)])});
}
test('SDK pool extension does not count as a buy, and duplicate or missing buys fail closed',()=>{
  const instruction=buy(),extension=new TransactionInstruction({programId:PUMP_AMM_PROGRAM_ID,keys:[],data:Buffer.from('ea66c2cb96483ee5','hex')});
  assert.equal(selectV3PumpBuy([extension,instruction]),instruction);
  assert.throws(()=>selectV3PumpBuy([extension]),/unique/);
  assert.throws(()=>selectV3PumpBuy([instruction,instruction]),/unique/);
  assert.throws(()=>selectV3PumpBuy([{...instruction,programId:SystemProgram.programId}]),/unique/);
  assert.throws(()=>selectV3PumpBuy([{...instruction,data:instruction.data.subarray(0,8)}]),/unique/);
});
test('authority fronts only the three canonical fee ATAs across SDK remaining-account layouts',()=>{
  for(const length of [25,26,27]){
    const instruction=buy(length),authority=key(100),setup=v3BuybackFeeSetup({pumpBuyInstruction:instruction,authority});
    assert.equal(setup.length,3);
    for(const ix of setup){assert(ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID));assert.deepEqual([...ix.data],[1]);
      assert(ix.keys[0].pubkey.equals(authority));assert(ix.keys[0].isSigner);assert(ix.keys[3].pubkey.equals(NATIVE_MINT));
      assert(ix.keys[4].pubkey.equals(SystemProgram.programId));assert(ix.keys[5].pubkey.equals(TOKEN_PROGRAM_ID));}
    instruction.keys[10].pubkey=key(110);assert.throws(()=>v3BuybackFeeSetup({pumpBuyInstruction:instruction,authority}),/canonical/);
  }
});
