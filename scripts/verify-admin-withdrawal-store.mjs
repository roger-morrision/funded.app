import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createPostgresStore} from '../server/postgres-store.mjs';
const run=args=>execFileSync('docker',args,{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:30000});
let id,store;
try{
  id=run(['run','--rm','-d','--name','funded-admin-withdraw-test-'+randomUUID(),'--label','funded.qa=admin-withdrawal',
    '--tmpfs','/var/lib/postgresql/data','-p','127.0.0.1::5432','-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_DB=funded_admin_test','postgres:17-alpine']).trim();
  assert.match(id,/^[a-f0-9]{64}$/);
  for(let i=0;i<30;i++){try{run(['exec',id,'pg_isready','-U','postgres','-d','funded_admin_test']);break;}catch{await new Promise(r=>setTimeout(r,500));}}
  const port=JSON.parse(run(['inspect',id]))[0].NetworkSettings.Ports['5432/tcp'][0].HostPort;
  const url=`postgres://postgres@127.0.0.1:${port}/funded_admin_test`;
  store=createPostgresStore(url);
  await store.update(state=>{state.adminWithdrawalIntents['test-source']={signature:'test-only-signature',status:'verification-pending',signedTransaction:'test-only-wire'};});
  await store.close();store=createPostgresStore(url);
  assert.equal((await store.read()).adminWithdrawalIntents['test-source'].signature,'test-only-signature');
  const acquired=await Promise.all([0,1].map(i=>store.update(state=>{if(state.adminWithdrawalIntents.lock)return false;state.adminWithdrawalIntents.lock={owner:i};return true;})));
  assert.equal(acquired.filter(Boolean).length,1);
  console.log(JSON.stringify({postgresRoundTrip:true,restartRecovery:true,atomicSinglePreparation:true,isolatedDatabase:true}));
}catch{console.error('Isolated withdrawal journal verification failed.');process.exitCode=1;}
finally{await store?.close();if(id&&/^[a-f0-9]{64}$/.test(id))run(['rm','-f',id]);}
