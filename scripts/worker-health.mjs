import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';

export const monitoredWorkers = ['buyback-worker','agency-buyback-worker'];
export function workerHealthcheck(role) {
  if (!monitoredWorkers.includes(role)) throw Error('Unknown worker role.');
  return {test:['CMD','node','scripts/worker-health.mjs',role],interval:'30s',timeout:'5s',retries:3,start_period:'90s'};
}
const healthPath = role => {
  if (!monitoredWorkers.includes(role)) throw Error('Unknown worker role.');
  return join(tmpdir(),`funded-${role}-health.json`);
};
// Completion is operational health, not authorization to spend. An idle or
// funding-blocked completed cycle is healthy; a failed or stalled cycle is not.
export function recordWorkerCycle(role, status, readiness = null) {
  const path=healthPath(role),temp=path+'.'+process.pid+'.tmp';
  writeFileSync(temp,JSON.stringify({role,status,readiness,pid:process.pid,
    build:process.env.FUNDED_BUILD_ID,cluster:process.env.SOLANA_CLUSTER,completedAt:Date.now()}),{mode:0o600});
  renameSync(temp,path);
}
export function assessWorkerCycle(row,{role,build,now=Date.now(),isAlive=()=>true}) {
  return Boolean(monitoredWorkers.includes(role) && row?.role===role && row.status==='completed'
    && row.cluster==='devnet' && /^[a-f0-9]{40}$/.test(String(build)) && row.build===build
    && Number.isSafeInteger(row.pid) && row.pid>0 && isAlive(row.pid)
    && Number.isSafeInteger(row.completedAt) && now-row.completedAt>=0 && now-row.completedAt<=180_000);
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const role=process.argv[2],row=JSON.parse(readFileSync(healthPath(role),'utf8'));
    if(!assessWorkerCycle(row,{role,build:process.env.FUNDED_BUILD_ID,
      isAlive:pid=>{try{process.kill(pid,0);return true;}catch{return false;}}})) process.exitCode=1;
  } catch {process.exitCode=1;}
}
