// Read-only check of an explicitly selected Devnet deployment. Never print inspect Env.
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {localDockerHost} from './check-deployment-capacity.mjs';

export const releaseServices = ['app','fee-collector','buyback-worker','agency-buyback-worker'];
export function assessReleaseServices(containers,{project,revision}) {
  const errors=[],services=[];
  for(const service of releaseServices){
    const matches=containers.filter(c=>c.Config?.Labels?.['com.docker.compose.project']===project
      &&c.Config.Labels['com.docker.compose.service']===service);
    if(matches.length!==1){errors.push(`${service}: expected exactly one container`);continue;}
    const c=matches[0],env=Object.fromEntries((c.Config.Env||[]).map(row=>{const i=row.indexOf('=');return[row.slice(0,i),row.slice(i+1)];}));
    const row={service,image:c.Image,build:env.FUNDED_BUILD_ID,revision:c.Config.Labels['org.opencontainers.image.revision'],
      cluster:env.SOLANA_CLUSTER,state:c.State?.Status,health:c.State?.Health?.Status||'not-configured'};
    services.push(row);
    if(row.build!==revision||row.revision!==revision)errors.push(`${service}: release mismatch`);
    if(row.cluster!=='devnet')errors.push(`${service}: Devnet required`);
    if(row.state!=='running'||!['healthy','not-configured'].includes(row.health))errors.push(`${service}: not healthy/running`);
  }
  if(new Set(services.map(row=>row.image)).size!==1||services.some(row=>!/^sha256:[a-f0-9]{64}$/.test(row.image||'')))errors.push('services: immutable images differ or are unavailable');
  return{ready:errors.length===0,services,errors};
}

async function main(){
  const [project,revision,origin]=process.argv.slice(2);
  if(!/^[a-z0-9][a-z0-9_-]*$/.test(project||'')||! /^[a-f0-9]{40}$/.test(revision||''))throw Error('Usage: node scripts/verify-deployment-readiness.mjs <compose-project> <full-revision> <origin>');
  const url=new URL(origin);
  if(url.origin!==origin||url.username||url.password||!(url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw Error('Pass an HTTPS origin or local HTTP origin.');
  const env={...process.env};for(const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[key];
  const docker=args=>execFileSync('docker',[`--host=${localDockerHost()}`,...args],{env,encoding:'utf8',timeout:15000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']});
  const ids=docker(['ps','-aq','--filter',`label=com.docker.compose.project=${project}`]).trim().split(/\s+/).filter(Boolean);
  const report={at:new Date().toISOString(),revision,...assessReleaseServices(ids.length?JSON.parse(docker(['inspect',...ids])):[],{project,revision}),publicChecks:[]};
  for(const path of ['/api/status','/api/launch-reserve-config']){
    try{
      const response=await fetch(origin+path,{signal:AbortSignal.timeout(30000),redirect:'error'}),body=await response.json();
      const ok=response.ok&&(path==='/api/status'?body.cluster==='devnet'&&body.build===revision:body.developerTokenLock?.ready===true);
      report.publicChecks.push({path,status:response.status,ready:ok});
      if(!ok)report.errors.push(`${path}: release or launch readiness unavailable`);
    }catch{report.publicChecks.push({path,ready:false});report.errors.push(`${path}: verification unavailable`);}
  }
  report.ready=report.errors.length===0;
  console.log(JSON.stringify(report,null,2));if(!report.ready)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(()=>{console.error('Deployment readiness verification failed; no configuration or secrets were printed.');process.exitCode=1;});
