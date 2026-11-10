import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import {randomUUID} from 'node:crypto';
import {createTokenChatRoutes} from '../server/routes/token-chat.mjs';
const key=()=>Keypair.generate().publicKey.toBase58();
test('stalled optional holdings lookup cannot block chat and a retry returns the stored message',async()=>{
 const mint=key(),author=key(),messages=[],input={author,text:'Devnet resilience test',requestId:randomUUID()};let result;
 const route=createTokenChatRoutes({body:async()=>input,walletKey:v=>v,store:{readCoinChat:async()=>messages,chargeRpcRate:async()=>true,updateCoinChat:async(m,fn)=>fn(messages)},
 clientKey:()=>'',referralSession:async()=>({wallet:author}),respond:(res,status,data)=>result={status,data},
 readHolderShare:async()=>new Promise(()=>{}),optionalLookupTimeoutMs:5});
 const req={method:'POST',socket:{encrypted:true},headers:{host:'richpad.fun',origin:'https://richpad.fun','x-token-chat-session':'wallet'}};
 const url=new URL(`https://richpad.fun/api/tokens/${mint}/chat`);
 await route(req,{},url);assert.equal(result.status,201);assert.equal(messages.length,1);const id=result.data.message.id;
 await route(req,{},url);assert.equal(result.status,200);assert.equal(result.data.message.id,id);assert.equal(messages.length,1);
 input.author=key();await route(req,{},url);assert.equal(result.status,401);
});
