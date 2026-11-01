import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const genesis='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const files=(await readdir('.')).filter(name=>name.startsWith('.env')&&name!=='.env.example');
async function walk(folder,depth=0){
  if(depth>12)return;
  let rows;try{rows=await readdir(folder,{withFileTypes:true});}catch{return;}
  for(const row of rows){
    const path=join(folder,row.name);
    if(row.isDirectory()){
      if(!['node_modules','.git','target','dist','vendor'].includes(row.name))await walk(path,depth+1);
    }else if(row.isFile()&&/helius|rpc|env|compose|config/i.test(row.name)&&!row.name.endsWith('.example'))files.push(path);
  }
}
await walk('.secrets');await walk('tmp');
const candidates=new Map();
function add(key,source){
  if(!/^[A-Za-z0-9_-]{10,}$/.test(key||''))return;
  const id=createHash('sha256').update(key).digest('hex').slice(0,12);
  const row=candidates.get(id)||{id,key,sources:[]};row.sources.push(source);candidates.set(id,row);
}
for(const path of files){
  let contents;try{contents=await readFile(path,'utf8');}catch{continue;}
  for(const match of contents.matchAll(/https:\/\/[^\s"'<>\r\n]+/g)){
    try{const url=new URL(match[0].replace(/[),;]+$/,''));
      if(/(?:^|\.)helius(?:-rpc\.com|\.xyz)$/.test(url.hostname))add(url.searchParams.get('api-key'),path);
    }catch{}
  }
  for(const match of contents.matchAll(/(?:HELIUS[A-Z_]*(?:KEY|TOKEN)|HELIUS_API_KEY)\s*[=:]\s*["']?([A-Za-z0-9_-]{10,})/g))add(match[1],path);
}
let previous=[];try{previous=JSON.parse(await readFile('tmp/automation-release/helius-probe.json','utf8')).results;}catch{}
const results=[];let selected;
for(const row of candidates.values()){
  const url='https://devnet.helius-rpc.com/?api-key='+encodeURIComponent(row.key);
  const rpc=async(method,params=[])=>{
    const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(15000)});
    let data;try{data=await response.json();}catch{}
    if(!response.ok||data?.error){
      const message=String(data?.error?.message||'');
      const error=Error(/quota|usage|credit|limit|429/i.test(message)||response.status===429?'quota-or-rate-limit':
        [401,403].includes(response.status)?'unauthorized':'rpc-error');error.httpStatus=response.status;throw error;
    }
    return data.result;
  };
  let result={fingerprint:row.id,sources:[...new Set(row.sources)]};
  const tested=previous.find(value=>value.fingerprint===row.id);
  if(tested&&!process.argv.includes('--refresh')){results.push({...tested,sources:result.sources});continue;}
  try{
    if(await rpc('getGenesisHash')!==genesis)throw Error('wrong-network');
    const account=await rpc('getAccountInfo',['9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm',{encoding:'base64',commitment:'finalized'}]);
    if(!account?.value?.executable)throw Error('program-not-executable');
    await rpc('getLatestBlockhash',[{commitment:'confirmed'}]);
    result.status='available-devnet';if(!selected)selected={...row,url};
  }catch(error){result.status=error.name==='TimeoutError'?'timeout':error.message;result.httpStatus=error.httpStatus;}
  results.push(result);console.log(JSON.stringify(result));
}
await mkdir('tmp/automation-release',{recursive:true});
await writeFile('tmp/automation-release/helius-probe.json',JSON.stringify({checkedAt:new Date().toISOString(),results,
  selectedFingerprint:selected?.id||null},null,2));
if(selected)await writeFile('.secrets/automation-selected-rpc-url',selected.url,{mode:0o600});
console.log(JSON.stringify({uniqueKeys:candidates.size,available:results.filter(row=>row.status==='available-devnet').length,
  selectedFingerprint:selected?.id||null}));
if(!selected)process.exitCode=2;
