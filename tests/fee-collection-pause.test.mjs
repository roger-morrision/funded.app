import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';

const paused='HdGmAbwR1ng3VTQkQ6Gw3QYhJGebWNFf5voktjCKwhvL';
const active='33NWqBP7VedxoKm5M7qZbb8LT6xvBu8iHQrwD5wkbkKH';
test('real collector worker pauses only the configured QA mint and keeps other collections active',async()=>{
  const requests=[],dir=await mkdtemp(join(tmpdir(),'funded-collector-test-'));
  const token=join(dir,'qa-token');await writeFile(token,'non-secret-local-fixture');
  const server=createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    requests.push({path:req.url,method:req.method,body:body?JSON.parse(body):null});
    const data=req.url==='/api/keeper/collection-candidates'?{cluster:'devnet',mints:[{mint:paused,collectionStatus:'complete'},{mint:active,collectionStatus:'complete'}],pendingV3Settlements:[]}
      :req.url.startsWith('/api/tokens/')?{overview:{available:true,pump:{status:'confirmed',accruedLamports:'20000000'}}}
        :{scope:'per-mint-v3',status:'collected',onchainVerified:true,signature:'3'.repeat(64)};
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(data));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const worker=spawn(process.execPath,['scripts/run-fee-collector.mjs','--once'],{env:{...process.env,
      SOLANA_CLUSTER:'devnet',FUNDED_API_TOKEN_FILE:token,FUNDED_FEE_COLLECTION_API:`http://127.0.0.1:${server.address().port}`,
      FUNDED_FEE_COLLECTION_PAUSED_MINTS:paused,FUNDED_DEVNET_QA_MINIMUMS_ENABLED:'false'},stdio:['ignore','pipe','pipe']});
    let output='';worker.stdout.on('data',chunk=>output+=chunk);worker.stderr.on('data',chunk=>output+=chunk);
    const code=await new Promise(resolve=>worker.once('exit',resolve));assert.equal(code,0,output);
    assert(!requests.some(row=>row.path.includes(paused)));
    assert.deepEqual(requests.filter(row=>row.method==='POST').map(row=>row.body),[{mint:active}]);
    assert.deepEqual(JSON.parse(output.trim()).pausedMints,[paused]);
  }finally{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
});

test('invalid pause configuration stops the worker before any collection',async()=>{
  const worker=spawn(process.execPath,['scripts/run-fee-collector.mjs','--once'],{env:{...process.env,SOLANA_CLUSTER:'devnet',
    FUNDED_FEE_COLLECTION_PAUSED_MINTS:'not-a-mint'},stdio:['ignore','pipe','pipe']});
  let output='';worker.stderr.on('data',chunk=>output+=chunk);
  const code=await new Promise(resolve=>worker.once('exit',resolve));assert.notEqual(code,0);assert.match(output,/pause mint is invalid/);
});
