import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { SOLANA_GENESIS } from '../solana-network.js';

test('an idle Devnet payer can switch RPC after an outage and rejects a different chain', {timeout:15000}, async t => {
  const rpc = createServer(async (req,res) => {
    const chunks=[];
    for await (const chunk of req) chunks.push(chunk);
    const { id, method }=JSON.parse(Buffer.concat(chunks));
    const result=method==='getGenesisHash' ? SOLANA_GENESIS[req.url.slice(1)] : {context:{slot:1},value:12345};
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({jsonrpc:'2.0',id,result}));
  });
  rpc.listen(0,'127.0.0.1');
  await once(rpc,'listening');
  t.after(()=>rpc.close());
  const base='http://127.0.0.1:'+rpc.address().port;
  const script=fileURLToPath(new URL('../scripts/devnet-acceptance-session.mjs',import.meta.url));
  const child=spawn(process.execPath,[script],{stdio:['pipe','pipe','ignore']});
  t.after(()=>child.kill());
  const replies=createInterface({input:child.stdout})[Symbol.asyncIterator]();
  async function command(value){
    child.stdin.write(JSON.stringify(value)+'\n');
    return JSON.parse((await replies.next()).value);
  }
  const initial=await command({action:'initialize',rpcUrl:base+'/devnet'});
  assert.equal(initial.event,'session-ready');
  assert.equal((await command({action:'change-rpc',rpcUrl:base+'/mainnet-beta'})).event,'session-error');
  assert.equal((await command({action:'balance'})).lamports,12345);
  const transferred=await command({action:'change-rpc',rpcUrl:base+'/devnet'});
  assert.equal(transferred.event,'rpc-changed');
  assert.equal(transferred.payer,initial.payer);
});
