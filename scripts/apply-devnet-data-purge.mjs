import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
const services=['fundedapp-app-1','fundedapp-fee-collector-1','fundedapp-buyback-worker-1','fundedapp-agency-buyback-worker-1'];
const run=(command,args)=>execFileSync(command,args,{encoding:'utf8',maxBuffer:2*1024*1024,timeout:300000});
const initial=JSON.parse(run('docker',['inspect',...services]));
if(initial.length!==4||initial.some(row=>!row.State.Running))throw Error('Expected four running services before maintenance.');
const app=initial.find(row=>row.Name==='/fundedapp-app-1');
if(!app.Config.Env.includes('SOLANA_CLUSTER=devnet'))throw Error('The selected app is not Devnet.');
let stopped=false;
try{
  stopped=true;run('docker',['stop','--time','30',...services.slice(1),services[0]]);
  if(JSON.parse(run('docker',['inspect',...services])).some(row=>row.State.Running))throw Error('A selected writer is still running.');
  console.log(run(process.execPath,['scripts/run-devnet-data-purge.mjs','--one-off']).trim());
  const plan=JSON.parse(await readFile('tmp/devnet-permanent-purge/plan.json','utf8'));
  if(plan.launches!==20)throw Error('The inventoried launch count changed.');
  console.log(run(process.execPath,['scripts/run-devnet-data-purge.mjs','--one-off','--apply','--expect='+plan.planHash]).trim());
}finally{
  if(stopped){run('docker',['start',services[0]]);run('docker',['start',...services.slice(1)]);}
}
const final=JSON.parse(run('docker',['inspect',...services]));
if(final.some(row=>!row.State.Running))throw Error('A service failed to restart after maintenance.');
console.log(JSON.stringify({servicesRestarted:services,sourceImageUnchanged:final.every(row=>row.Image===initial.find(prior=>prior.Name===row.Name).Image)}));
