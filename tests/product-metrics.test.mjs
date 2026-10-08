import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { journeyEvent, confirmedProductTotals, createProductMetricsHandler } from '../server/product-metrics.mjs';

test('journeys require explicit consent, reject extra fields, and rotate hashes by day and cluster',()=>{
  const input={consent:true,event:'launch_review',session:randomUUID()};
  const first=journeyEvent(input,'devnet',new Date('2026-10-08'));
  assert.equal(JSON.stringify(first).includes(input.session),false);
  assert.notEqual(first.sessionHash,journeyEvent(input,'devnet',new Date('2026-10-09')).sessionHash);
  assert.notEqual(first.sessionHash,journeyEvent(input,'mainnet-beta',new Date('2026-10-08')).sessionHash);
  for(const changed of [{consent:false},{wallet:'private'},{event:'wallet_address'},{session:'not-a-uuid'}]) assert.throws(()=>journeyEvent({...input,...changed},'devnet'));
});

test('confirmed totals exclude pending, mismatched and duplicate boosts and preserve exact base units',()=>{
  const quote={id:'quote',mint:'mint',payer:'payer',recipient:'recipient',packageId:'10x',cluster:'devnet',lamports:100000001};
  const receipt={...quote,quoteId:'quote',signature:'2'.repeat(88),status:'finalized',slot:10};
  const state={launches:{one:{mint:'mint',cluster:'devnet',onchainVerified:true},duplicate:{mint:'mint',cluster:'devnet',onchainVerified:true},unconfirmed:{mint:'other',cluster:'devnet'}},boostQuotes:{quote},boostReceipts:{one:receipt,duplicate:receipt,pending:{...receipt,status:'pending'},wrong:{...receipt,signature:'3'.repeat(88),lamports:1},otherCluster:{...receipt,cluster:'mainnet-beta'}}};
  const report=confirmedProductTotals(state,{status:'unavailable'},'devnet');
  assert.equal(report.registeredLaunches,1);assert.equal(report.boostPurchases,1);assert.equal(report.boostPaidLamports,'100000001');
  assert.equal(report.collectedFeeLamports,null);assert.equal(report.finalizedPayoutLamports,null);assert.equal(report.tradingVolumeLamports,null);
  assert.equal(JSON.stringify(report).includes(receipt.signature),false);
});

test('journey HTTP boundary enforces origin, consent, payload size, rate limit, and private reporting',async()=>{
  const recorded=[];let allowed=true;
  const metrics={enabled:true,record:async row=>recorded.push(row),report:async()=>({dailyEvents:[]})};
  const handler=createProductMetricsHandler({metrics,cluster:'devnet',origin:'https://funded.vip',authorized:req=>req.headers.authorization==='Bearer fixture',charge:async()=>allowed,confirmedTotals:async()=>({boostPurchases:0})});
  const server=createServer(async(req,res)=>{try{if(!await handler(req,res,new URL(req.url,'http://localhost')))res.writeHead(404).end();}catch(error){res.writeHead(error.statusCode||500).end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const input={consent:true,event:'launch_completed',session:randomUUID()};
  const post=(body=input,origin='https://funded.vip')=>fetch(`${base}/api/product-events`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
  try{
    assert.equal((await post(input,'https://elsewhere.example')).status,403);
    assert.equal((await post({...input,consent:false})).status,400);
    assert.equal((await post({...input,url:'private'})).status,400);
    assert.equal((await post({...input,session:'x'.repeat(1000)})).status,413);
    assert.equal((await post()).status,202);assert.equal(recorded.length,1);
    assert.equal(JSON.stringify(recorded).includes(input.session),false);
    allowed=false;assert.equal((await post()).status,429);assert.equal(recorded.length,1);
    assert.equal((await fetch(`${base}/api/product-metrics`)).status,401);
    const report=await fetch(`${base}/api/product-metrics`,{headers:{authorization:'Bearer fixture'}});
    assert.equal(report.status,200);assert.equal(report.headers.get('cache-control'),'no-store');
    assert.equal((await report.json()).confirmed.boostPurchases,0);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
