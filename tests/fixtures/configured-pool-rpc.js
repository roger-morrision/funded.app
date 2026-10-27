import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';
const sourceRoot=fileURLToPath(new URL('../../',import.meta.url));
export const configuredPoolFixture={mint:'US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx',pool:'YMN9Qj5jPNp7j14VPcML1B6xGgcPWVZUGLFU3Mnyfaf'};
export const rpcHtmlBody='<!DOCTYPE html><html>private-test-value upstream proxy failure</html>';
function throwRetained(errors,message){if(errors.length===1)throw errors[0];if(errors.length)throw new AggregateError(errors,message);}
export function withConfiguredPoolSource(info,action){return withPoolSource(info,action,configuredPoolFixture,'configured');}
export function withUnconfiguredPoolSource(info,action){return withPoolSource(info,action,{mint:'',pool:''},'unconfigured');}
async function withPoolSource(info,action,poolFixture,profile){
 const errors=[],contract={qualification:'Actual unmodified product source with explicit '+profile+' Devnet pool configuration; source-only, never canonical compiled artifact evidence.',sourceRoot,cache:info.outputPath(profile+'-pool-vite-cache'),events:[],sourcePins:[],effectiveDefines:{VITE_FUNDED_TOKEN_MINT:poolFixture.mint,VITE_FUNDED_SWAP_POOL:poolFixture.pool,VITE_API_BASE_URL:'/',VITE_SOLANA_CLUSTER:'devnet',VITE_EXPLORE_CLUSTER:'devnet',VITE_ALLOW_MAINNET:'false',VITE_MAINNET_READ_ONLY:'false',VITE_DEV_MODE:'false',VITE_DEV_AUTOCONNECT:'false'}};
 let server;
 try{
  for(const path of ['index.html','app.js','app-config.js','src/app/startup/connections.js','src/app/controllers/connections.js','src/app/controllers/funded-trading.js','src/features/funded/buy-feedback.js','pump-trading.js','package-lock.json']){const bytes=await readFile(sourceRoot+path);contract.sourcePins.push({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
  const define=Object.fromEntries(Object.entries(contract.effectiveDefines).map(([key,value])=>['import.meta.env.'+key,JSON.stringify(value)]));
  server=await createServer({root:sourceRoot,configFile:false,envDir:false,logLevel:'silent',cacheDir:contract.cache,define,server:{host:'127.0.0.1',port:0,strictPort:true}});
  await server.listen();const address=server.httpServer.address();if(!address||typeof address==='string'||address.address!=='127.0.0.1')throw Error('Configured source fixture is not loopback.');
  contract.origin='http://127.0.0.1:'+address.port;contract.events.push({event:'listening',at:new Date().toISOString(),address});
  await action(contract.origin,contract);
 }catch(error){errors.push(error);}
 finally{
  if(server)try{await server.close();contract.events.push({event:'original-server-close-resolved',at:new Date().toISOString(),listening:server.httpServer?.listening??false});if(server.httpServer?.listening)throw Error('Configured source listener remains active.');}catch(error){errors.push(error);}
  contract.errors=errors.map(e=>({name:e.name,message:e.message,stack:e.stack}));
  try{await info.attach(profile+'-pool-source-lifecycle',{body:JSON.stringify(contract,null,2),contentType:'application/json'});}catch(error){errors.push(error);}
 }
 throwRetained(errors,'Configured source startup, test, close or artifact errors.');
}
export async function withRpcHtmlReads(page,info,origin,expect,action){
 const errors=[],rows=[],byRequest=new Map(),finishedTasks=[],forbidden=[],failed=[];
 const stamp=()=>({epochMs:performance.timeOrigin+performance.now(),monotonicMs:performance.now()});
 page.on('request',q=>{const u=new URL(q.url());if(u.origin!==origin||!u.pathname.startsWith('/api/'))return;const row={id:'fqa009-read-'+(rows.length+1),url:q.url(),method:q.method(),requestObservedAt:stamp(),rpc:null,expectedStatus:null,expectedBody:null,requestfinishedAt:null,bodyFinishedAt:null,finishedError:null,identityMatches:false,complete:false};rows.push(row);byRequest.set(q,row);});
 page.on('requestfinished',q=>{
  const row=byRequest.get(q);if(!row)return;row.requestfinishedAt=stamp();
  const task=(async()=>{try{const response=await q.response();if(!response)throw Error('Completed original Request has no Response.');const finishedError=await response.finished();if(finishedError)throw finishedError;const body=await response.body();row.status=response.status();row.body=body.toString('utf8');row.bodyBytes=body.length;row.responseMarker=response.headers()['x-fqa009-read-id'];row.identityMatches=response.request()===q&&byRequest.get(response.request())===row;row.bodyFinishedAt=stamp();row.finalTiming={...q.timing()};row.complete=row.identityMatches&&row.status===row.expectedStatus&&row.body===row.expectedBody&&row.responseMarker===row.id&&row.finalTiming.responseEnd>=0;}catch(error){row.finishedError=String(error?.message||error);}})();finishedTasks.push(task);
 });
 page.on('requestfailed',q=>{const row=byRequest.get(q);if(row){row.finishedError=q.failure()?.errorText||'Original request failed';failed.push({id:row.id,error:row.finishedError});}});
 await page.route('**/*',async route=>{
  const q=route.request(),u=new URL(q.url()),method=q.method();
  if(u.origin!==origin){if(method==='GET'&&['fonts.googleapis.com','fonts.gstatic.com'].includes(u.hostname))return route.abort();forbidden.push({url:q.url(),method});return route.abort();}
  if(!u.pathname.startsWith('/api/'))return route.continue();
  const row=byRequest.get(q);if(!row)throw Error('Original request identity was not observed before routing.');
  let status=503,body=JSON.stringify({error:'Unavailable fixture'}),contentType='application/json';
  if(u.pathname==='/api/solana/rpc'){
   let payload;try{payload=q.postDataJSON();}catch{}const calls=Array.isArray(payload)?payload:[payload];row.rpc=calls;
   if(method!=='POST'||!calls.length||!calls.every(call=>call&&typeof call.method==='string'&&/^get[A-Z]/.test(call.method))){forbidden.push({url:q.url(),method,calls});status=403;body=JSON.stringify({error:'Read-only RPC fixture'});}
   else{status=502;body=rpcHtmlBody;contentType='text/html';}
  }else if(method!=='GET'){forbidden.push({url:q.url(),method});status=403;body=JSON.stringify({error:'No wallet, signing or financial write'});}
  else if(u.pathname==='/api/fee-policy'){status=200;body=JSON.stringify({split:PROTOCOL_FEE_SPLIT});}
  row.expectedStatus=status;row.expectedBody=body;
  return route.fulfill({status,contentType,body,headers:{'x-fqa009-read-id':row.id}});
 });
 const f={rows,forbidden,failed,configuredPoolReads:(expectedPool=configuredPoolFixture.pool)=>rows.filter(row=>new URL(row.url).searchParams.get('purpose')==='trade-preview'&&row.rpc?.some(call=>call.method==='getMultipleAccounts'&&Array.isArray(call.params?.[0])&&call.params[0].includes(expectedPool)))};
 try{await action(f);}catch(error){errors.push(error);}
 finally{
  try{await expect.poll(()=>rows.filter(row=>!row.complete&&!row.finishedError).length).toBe(0);await Promise.all(finishedTasks);if(forbidden.length||failed.length||rows.some(row=>!row.complete))throw Error('Original read-only request inventory did not complete exactly.');}catch(error){errors.push(error);}
  try{await info.attach('rpc-html-original-reads',{body:JSON.stringify({qualification:'Observed original Request/Response identities and completed synthetic bodies through assertion end; no real RPC/payment proof.',origin,recordedThrough:stamp(),rows,forbidden,failed,errors:errors.map(e=>({name:e.name,message:e.message,stack:e.stack}))},null,2),contentType:'application/json'});}catch(error){errors.push(error);}
 }
 throwRetained(errors,'Original RPC case and completed-read evidence errors.');
}
