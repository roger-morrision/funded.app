import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,PublicKey} from '@solana/web3.js';
import {ensureMintAutomationV3} from '../server/mint-automation-v3.mjs';
import {deriveMintAutomationV3} from '../mint-automation-v3.js';

function fixture(){
 const address=()=>Keypair.generate().publicKey;
 const input={authority:Keypair.generate(),programId:address(),mint:address(),creator:address(),policy:address(),recipients:[address(),address(),address(),address()]};
 const data=Buffer.alloc(233);Buffer.from('668959b59cb1e7ba','hex').copy(data);
 [input.mint,input.creator,input.policy,...input.recipients].forEach((key,i)=>key.toBuffer().copy(data,8+i*32));
 data[232]=PublicKey.findProgramAddressSync([Buffer.from('mint-automation-v3'),input.mint.toBuffer()],input.programId)[1];
 const info={owner:input.programId,data},failure=new Error('Account already in use');let calls=0,visible=null;
 const connection={getAccountInfo:async(_,commitment)=>{assert.equal(commitment,'finalized');return visible;},
  getLatestBlockhash:async()=>({blockhash:PublicKey.default.toBase58(),lastValidBlockHeight:100}),
  sendRawTransaction:async()=>{calls++;visible=info;throw failure;}};
 return {input,connection,info,failure,calls:()=>calls,setInfo:value=>{visible=value;}};
}

test('a competing initializer is accepted only after exact finalized destinations are verified',async()=>{
 const f=fixture();const actual=await ensureMintAutomationV3({...f.input,connection:f.connection});
 assert(actual.equals(deriveMintAutomationV3(f.input.programId,f.input.mint)));assert.equal(f.calls(),1);
});

test('initialization failure is retained when finalized state is missing, different, or unreadable',async()=>{
 for(const state of ['missing','different-recipient','wrong-owner','rpc-error']){
  const f=fixture();let reads=0;
  f.connection.getAccountInfo=async()=>{if(++reads===1)return null;if(state==='rpc-error')throw Error('RPC unavailable');
   if(state==='missing')return null;if(state==='wrong-owner')return {...f.info,owner:PublicKey.default};
   const data=Buffer.from(f.info.data);PublicKey.default.toBuffer().copy(data,104);return {...f.info,data};};
  await assert.rejects(ensureMintAutomationV3({...f.input,connection:f.connection}),error=>error===f.failure);assert.equal(f.calls(),1);
 }
});

test('existing verified automation is reused without signing or broadcasting',async()=>{
 const f=fixture();f.setInfo(f.info);await ensureMintAutomationV3({...f.input,connection:f.connection});assert.equal(f.calls(),0);
});
