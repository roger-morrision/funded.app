import test from 'node:test';
import assert from 'node:assert/strict';
import {createTokenChatRoutes} from '../server/routes/token-chat.mjs';
import {communityMessageMarkup} from '../src/features/home/community-panel.js';
import {createCoinChatController} from '../src/app/controllers/coin-chat.js';

test('combined feed excludes moderated messages and never exposes private fields or invents P&L',async()=>{
  let response;
  const row={id:'chat_a',mint:'mint',author:'wallet',text:'hello',createdAt:'2026-11-05T00:00:00Z',reports:{private:'report'},signature:'secret',auth:'wallet-session'};
  const handle=createTokenChatRoutes({store:{readRecentCoinChats:async()=>[row,{...row,id:'call',callout:{marketCapSol:10,holdingPercent:2}},{...row,status:'hidden'},{...row,status:'deleted'}]},
    readCalloutFeed:async()=>({callouts:[{id:'call',multiple:1.2}]}),respond:(_res,_status,value)=>response=value});
  assert.equal(await handle({method:'GET'},{},new URL('http://app/api/token-chat/feed')),true);
  assert.equal(response.messages.length,2);
  assert.deepEqual(Object.keys(response.messages[0]),['id','mint','author','text','createdAt']);
  assert.equal(response.messages[1].callout.purchasedSol,null);assert.equal(response.messages[1].callout.pnlSol,null);
  assert.ok(Math.abs(response.messages[1].callout.marketChangePercent-20)<1e-6);
  const chat=communityMessageMarkup({...row,text:'<img src=x onerror=alert(1)>'});
  assert.ok(!chat.includes('<img'));assert.ok(!chat.includes('<dt>Purchased'));
  const call=communityMessageMarkup(response.messages[1]);
  assert.match(call,/<dt>Purchased/);assert.match(call,/P&amp;L/);assert.match(call,/Unavailable/);assert.match(call,/MC since call: \+20.0%/);
});

test('Home posts and reports use selected mint and existing wallet-session guards',async()=>{
  const requests=[];let checked=0;
  const app={wallet:{},captureWalletSession:()=>({address:'wallet'}),getCoinMintAddress:()=> 'other-token',
    ensureTokenChatSession:async()=> 'wallet',assertWalletSessionCurrent:()=>{checked++;},apiRequest:async(...args)=>{requests.push(args);return {available:true};}};
  const controller=createCoinChatController(app);
  await controller.tokenChatRequest('post',{text:'hello',author:'forged'},'selected-token');
  await controller.tokenChatRequest('report',{messageId:'chat_id',reason:'spam-or-scam'},'reported-token');
  assert.equal(requests[0][0],'/api/tokens/selected-token/chat');assert.equal(requests[0][1].body.author,'wallet');
  assert.equal(requests[1][0],'/api/tokens/reported-token/chat/report');assert.equal(checked,2);
});

test('feed cache is shared and moderation invalidates it immediately',async()=>{
  const row={id:'chat_a',mint:'mint',author:'wallet',text:'hello',createdAt:'2026-11-05T00:00:00Z',status:'visible'};
  let reads=0,response;
  const handle=createTokenChatRoutes({store:{readRecentCoinChats:async()=>{reads++;return [row];},updateCoinChat:async(_mint,fn)=>fn([row])},
    body:async()=>({mint:'mint',messageId:'chat_a',action:'hide',reason:'Spam'}),walletKey:value=>value,requireAuthorized:()=>true,
    respond:(_res,_status,value)=>response=value});
  const get=()=>handle({method:'GET'},{},new URL('http://app/api/token-chat/feed'));
  await get();await get();assert.equal(reads,1);assert.equal(response.messages.length,1);
  await handle({method:'POST'},{},new URL('http://app/api/ops/token-chat/moderate'));
  await get();assert.equal(reads,2);assert.deepEqual(response.messages,[]);
});
