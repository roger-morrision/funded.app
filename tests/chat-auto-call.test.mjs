import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey } from '@solana/web3.js';
import { createTokenChatRoutes } from '../server/routes/token-chat.mjs';
const mint='11111111111111111111111111111112', author=new PublicKey(new Uint8Array(32).fill(7)).toBase58();
for(const scenario of [
  {name:'holder',holding:1.25,call:true},
  {name:'non-holder',holding:0},
  {name:'unknown holding',holding:null},
  {name:'RPC failure',holding:'reject'},
  {name:'invalid holding',holding:NaN},
  {name:'missing market cap',holding:1.25,noCap:true},
  {name:'repeat call',holding:1.25,repeat:true},
  {name:'call limit',holding:1.25,limited:true},
  {name:'forged holding',holding:0,forged:true},
  {name:'wrong wallet',holding:1.25,wrongWallet:true},
])test(`single Post routes ${scenario.name} using server evidence (mocked RPC)`,async()=>{
  const chats=[],calls=scenario.repeat?[{author,mint,createdAt:new Date().toISOString()}]:[];let sent,reads=0;
  const handle=createTokenChatRoutes({
    body:async()=>({author,text:'A community observation',...(scenario.forged?{callout:true,holdingPercent:50}: {})}),
    walletKey:value=>new PublicKey(value).toBase58(),clientKey:()=> 'fixture',tokenChatSessions:{},
    referralSession:async()=>({wallet:scenario.wrongWallet?mint:author}),requireAuthorized:()=>false,
    store:{chargeRpcRate:async key=>!(scenario.limited&&key.startsWith('callout-wallet:')),readCallouts:async()=>calls,
      updateCallouts:async fn=>fn(calls),updateCoinChat:async(_mint,fn)=>fn(chats)},
    readMarketCaps:async()=>scenario.noCap?{}:{[mint]:{marketCapSol:12,observedAt:new Date().toISOString()}},
    readHolderShare:async()=>{reads++;if(scenario.holding==='reject')throw new Error('RPC offline');return scenario.holding;},
    respond:(_res,status,body)=>{sent={status,body};},
  });
  await handle({method:'POST',headers:{origin:'http://app',host:'app','x-token-chat-session':'wallet'}},{},new URL(`http://app/api/tokens/${mint}/chat`));
  assert.equal(sent.status,scenario.wrongWallet?401:201);
  assert.equal(reads,scenario.wrongWallet?0:1);
  assert.equal(Boolean(sent.body.message?.callout),Boolean(scenario.call));
  assert.equal(chats.length,scenario.wrongWallet?0:1);
  assert.equal(calls.length,scenario.call||scenario.repeat?1:0);
});
