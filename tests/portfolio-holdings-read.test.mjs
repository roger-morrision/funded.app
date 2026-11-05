import test from 'node:test';
import assert from 'node:assert/strict';
import {readPortfolioTokenAccounts,portfolioLookupReason} from '../src/features/portfolio/holdings-read.js';
test('only the failed token program retries once after a transient error',async()=>{
 const calls={classic:0,new:0},waits=[];
 const result=await readPortfolioTokenAccounts({getParsedTokenAccountsByOwner:async(_,filter)=>{const p=filter.programId;if(++calls[p]===1&&p==='new')throw Error('429 busy');return{value:[p]};}},'wallet',['classic','new'],()=>true,async ms=>waits.push(ms));
 assert.deepEqual(calls,{classic:1,new:2});assert.deepEqual(waits,[1200]);assert.ok(result.every(x=>x.status==='fulfilled'));
});
test('wallet change cancels a queued retry and permanent failures are not retried',async()=>{
 let current=true,calls=0;
 const result=await readPortfolioTokenAccounts({getParsedTokenAccountsByOwner:async()=>{calls++;throw Error('503 unavailable');}},'old',['classic'],()=>current,async()=>{current=false;});
 assert.equal(calls,1);assert.equal(result[0].status,'rejected');
 await readPortfolioTokenAccounts({getParsedTokenAccountsByOwner:async()=>{calls++;throw Error('Invalid params');}},'wallet',['classic'],()=>true,async()=>assert.fail('must not wait'));
 assert.equal(calls,2);assert.match(portfolioLookupReason(Error('429')),/busy/);assert.match(portfolioLookupReason(Error('token missing')),/does not mean your wallet is empty/);
});
