import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir,readFile,writeFile,readdir } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { browserSourceDigest } from './browser-source-digest.mjs';
import { readExperienceSnapshot } from './product-experience-snapshot.mjs';
import { Connection } from '@solana/web3.js';
import { verifyCandidateBurn } from './product-experience-chain-proof.mjs';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
export function candidateEnvironment({port,build,storePath,rewardPath,rpcUrl},parent=process.env){
  const env=Object.fromEntries(Object.entries(parent).filter(([key])=>['PATH','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC','PATHEXT'].includes(key.toUpperCase())));
  return {...env,HOST:'127.0.0.1',PORT:String(port),NODE_ENV:'development',FUNDED_SKIP_LOCAL_ENV:'true',FUNDED_API_ONLY:'true',
    FUNDED_BUILD_ID:build,FUNDED_STORE_PATH:storePath,AUTOMATIC_REWARD_STORE_PATH:rewardPath,SOLANA_CLUSTER:'devnet',VITE_SOLANA_CLUSTER:'devnet',
    SOLANA_RPC_URL:rpcUrl,PUBLIC_APP_URL:`http://127.0.0.1:${port}`,CORS_ORIGIN:`http://127.0.0.1:${port}`,DEV_MODE:'false',DEVNET_TEST_MODE:'false'};
}
export function reviewedLoopback(input){
  const url=new URL(input);if(url.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Use an explicit loopback reviewed API origin.');
  return url.origin;
}
async function json(base,path,options={}){
  const response=await fetch(new URL(path,base),{...options,redirect:'error',headers:{...(options.body?{'content-type':'application/json'}:{}),...options.headers},signal:AbortSignal.timeout(20000)});
  const data=await response.json();return {response,data};
}
async function sourceIdentity(browserDigest){
  const hash=createHash('sha256').update(browserDigest);
  async function scan(path){for(const row of (await readdir(path,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const target=join(path,row.name);if(row.isDirectory())await scan(target);else if(row.isFile())hash.update(target.slice(root.length)).update(await readFile(target));}}
  await scan(join(root,'server'));for(const name of ['product-experience-snapshot.mjs','product-experience-candidate.mjs','product-experience-chain-proof.mjs'])hash.update(await readFile(join(root,'scripts',name)));
  return `local-product-${hash.digest('hex').slice(0,20)}`;
}
export async function readOnlyRpc(reviewed,{official=false}={}){
  const allowed=new Set(['getGenesisHash','getTransaction','getSignatureStatuses','getAccountInfo','getMultipleAccounts','getSlot','getBlockHeight','getTokenSupply','getTokenAccountsByOwner','getTokenAccountBalance','getSignaturesForAddress','getLatestBlockhash','getMinimumBalanceForRentExemption','getFeeForMessage']);
  const stats={forwarded:0,blocked:0};
  const server=createServer(async(req,res)=>{
    try{let body='';for await(const chunk of req){body+=chunk;if(body.length>50000)throw new Error();}const value=JSON.parse(body);
      if(req.method!=='POST'||!(Array.isArray(value)?value:[value]).every(row=>allowed.has(row.method))){stats.blocked++;res.writeHead(403,{'content-type':'application/json'});res.end(JSON.stringify({error:'Candidate RPC permits reads only.'}));return;}
      stats.forwarded++;const response=await fetch(official?'https://api.devnet.solana.com':new URL('/api/solana/rpc',reviewed),{method:'POST',redirect:'error',headers:{'content-type':'application/json'},body,signal:AbortSignal.timeout(15000)});
      res.writeHead(response.status,{'content-type':'application/json'});res.end(await response.text());
    }catch{res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:'Candidate read-only RPC unavailable.'}));}
  });
  await new Promise((done,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',done);});return {server,stats,url:`http://127.0.0.1:${server.address().port}`};
}
async function startApi(env){
  const child=spawn(process.execPath,['server/index.mjs'],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';
  for(const stream of [child.stdout,child.stderr])stream.on('data',value=>{log=(log+value).slice(-12000);});
  for(let attempt=0;attempt<100;attempt++){
    if(child.exitCode!==null)throw new Error('Candidate API exited during startup.');
    if(log.includes('mode":"api-only"')&&log.includes('app listening'))return child;
    await new Promise(done=>setTimeout(done,100));
  }
  child.kill();throw new Error('Candidate API did not establish API-only startup.');
}
async function stop(child){if(!child||child.exitCode!==null)return;child.kill('SIGTERM');await Promise.race([new Promise(done=>child.once('exit',done)),new Promise(done=>setTimeout(()=>{child.kill('SIGKILL');done();},5000).unref())]);}

export async function runCandidate({container='fundedapp-app-1',port=8789,reviewed='http://127.0.0.1:8788',serve=false,officialRpc=false}={}){
  if(!Number.isInteger(port)||port<1024||port>65535||port===new URL(reviewedLoopback(reviewed)).port*1)throw new Error('Choose a separate non-privileged candidate port.');
  reviewed=reviewedLoopback(reviewed);
  const digest=await browserSourceDigest(root),built=JSON.parse(await readFile(join(root,'dist/build-settings.json'),'utf8'));
  if(built.sourceDigest!==digest||built.cluster!=='devnet'||built.mainnetEnabled||built.devWalletEnabled)throw new Error('Build the current Devnet browser with server-held wallets disabled before starting a candidate.');
  const before=(await json(reviewed,'/api/status')).data;if(before.cluster!=='devnet'||!before.build)throw new Error('The reviewed source must advertise its Devnet build.');
  const snapshot=readExperienceSnapshot(container);if(snapshot.source.build!==before.build)throw new Error('Container snapshot and reviewed API builds differ.');
  const build=await sourceIdentity(JSON.stringify(built)),directory=join(root,'tmp','product-experience-candidate',`${Date.now()}-${build}`);await mkdir(directory,{recursive:true});
  const storePath=join(directory,'app.json'),rewardPath=join(directory,'rewards.json');await writeFile(storePath,JSON.stringify(snapshot.state));await writeFile(rewardPath,JSON.stringify(snapshot.rewards));
  await writeFile(join(directory,'provenance.json'),JSON.stringify({...snapshot,state:undefined,rewards:undefined},null,2));
  const rpc=await readOnlyRpc(reviewed,{official:officialRpc}),env=candidateEnvironment({port,build,storePath,rewardPath,rpcUrl:rpc.url});let child;
  const base=`http://127.0.0.1:${port}`,report={scope:'local-only API acceptance against copied recorded Devnet data',base,build,builtSettings:built,sourceBuild:before.build,capturedAt:snapshot.capturedAt,checks:[],rpc:rpc.stats,rpcSource:officialRpc?'official-devnet':'reviewed-api-proxy'};
  const check=(pass,name)=>{if(!pass)throw new Error(`Candidate check failed: ${name}`);report.checks.push(name);};
  try{
    child=await startApi(env);
    const health=(await json(base,'/api/health')).data;check(health.ok&&health.external.solanaKeeper===false&&health.external.automaticRewards===false,'API-only health; no keeper or active worker heartbeat');
    const caps=(await json(base,'/api/capabilities')).data;check(caps.build===build&&caps.cluster==='devnet','Candidate build and Devnet identity');
    const operations=await json(base,'/api/financial/operations');check(operations.response.ok&&operations.data.evidence==='recorded-finalized-v3','New operations endpoint over copied financial records');
    report.operations={completed:operations.data.completedRecordedOperations,pending:operations.data.pendingBuybackOperations,creatorCount:operations.data.creators.length};
    const activity=await json(base,'/api/financial/activity');check(activity.response.ok&&activity.data.cluster==='devnet','Public activity endpoint');
    const orders=Object.values(snapshot.state.v3BuybackOrders).filter(row=>row.status==='finalized'&&row.finalized===true&&row.vaultDebitVerified&&row.burnInstructionVerified).sort((a,b)=>Number(b.slot||0)-Number(a.slot||0));
    let receipt=null;for(const order of orders.slice(0,3)){const value=await json(base,`/api/financial/receipts/${order.signature}`);if(value.response.ok){receipt=value.data;break;}}
    check(receipt?.burns?.length>0&&receipt.currentRpcRecheck===false,'Exact recorded burn receipt with historical evidence label');report.recordedReceipt=receipt.signature;
    const connection=new Connection(rpc.url,{commitment:'finalized',disableRetryOnRateLimit:true,fetch:(target,options)=>fetch(target,{...options,signal:AbortSignal.timeout(18000),redirect:'error'})});
    const selected=orders.find(row=>row.signature===receipt.signature);
    report.chainProof=await verifyCandidateBurn(connection,selected,snapshot.state.launches[selected.mint]);
    check(report.chainProof.evidence==='fresh-finalized-rpc-burn-and-vault-delta','Independent finalized program, receipt, vault-debit and burn verification');
    const config=await json(base,'/api/creator-support/issues/config');check(config.data.enabled&&config.data.tokenHoldingRequired===false,'Guest reporting advertised without token holding');
    const issue=await json(base,'/api/creator-support/issues',{method:'POST',headers:{origin:base},body:JSON.stringify({category:'bug',description:'Local candidate acceptance probe; no real user report.',context:{route:'/#profile'}})});
    check(issue.response.status===201&&issue.data.status==='received','Guest issue persists through actual HTTP dispatcher');
    const privatePath=`/api/creator-support/issues/${issue.data.id}`,token=issue.data.token;
    check((await json(base,privatePath)).response.status===404,'Report unavailable without private view token');
    check((await json(base,privatePath,{headers:{'x-issue-token':token}})).data.status==='received','Owner can read report status');
    check((await json(base,'/api/admin/product-issues')).response.status===401,'Admin reports require existing admin session');
    check((await json(base,'/api/creator-support/brief',{method:'POST',headers:{origin:base},body:'{}'})).response.status===401,'Creator brief rejects missing verified session');
    check((await json(base,'/api/creator-support/device-preferences',{method:'POST',headers:{origin:base},body:'{}'})).response.status===401,'Account sync rejects missing verified session');
    await stop(child);child=await startApi(env);
    check((await json(base,privatePath,{headers:{'x-issue-token':token}})).data.status==='received','Report survives complete API process restart');
    const after=(await json(reviewed,'/api/status')).data;check(after.build===before.build&&after.cluster==='devnet','Reviewed public API retains its original build');
    report.finishedAt=new Date().toISOString();await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({...report,reportPath:join(directory,'report.json')},null,2));
    if(serve){console.log('Candidate is loopback-only; source gates/signers/workers are disabled and Solana RPC permits reads only.');await new Promise(done=>{process.once('SIGINT',done);process.once('SIGTERM',done);});}
    return report;
  }finally{await stop(child);await new Promise(done=>rpc.server.close(done));}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const args=process.argv.slice(2),get=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
  runCandidate({container:get('--source-container','fundedapp-app-1'),port:Number(get('--port','8789')),reviewed:get('--reviewed-api','http://127.0.0.1:8788'),serve:args.includes('--serve'),officialRpc:args.includes('--official-rpc')}).catch(error=>{console.error(error.message);process.exitCode=1;});
}
