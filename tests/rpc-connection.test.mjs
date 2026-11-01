import test from 'node:test';
import assert from 'node:assert/strict';
import {SharedRpcConnection} from '../server/rpc-connection.mjs';

test('server RPC shares the HTTP transport, preserves commitments and does not retry a throttled send',async()=>{
  const original=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,options)=>{
    const request=JSON.parse(options.body);calls.push(request);
    assert(options.signal instanceof AbortSignal);
    if(request.method==='sendTransaction')return new Response('rate limited',{status:429});
    return Response.json({jsonrpc:'2.0',id:request.id,result:'devnet-genesis'});
  };
  try{
    const first=new SharedRpcConnection('https://rpc.invalid','finalized'),second=new SharedRpcConnection('https://rpc.invalid','confirmed');
    assert.equal(await first.getGenesisHash(),'devnet-genesis');assert.equal(await second.getGenesisHash(),'devnet-genesis');
    assert.equal(first.commitment,'finalized');assert.equal(second.commitment,'confirmed');
    await assert.rejects(first.sendRawTransaction(Buffer.from([1,2,3])),/429/);
    assert.equal(calls.filter(row=>row.method==='sendTransaction').length,1);
  }finally{globalThis.fetch=original;}
});
