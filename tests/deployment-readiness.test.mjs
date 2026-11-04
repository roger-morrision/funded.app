import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessReleaseServices,releaseServices} from '../scripts/verify-deployment-readiness.mjs';
const revision='a'.repeat(40),options={project:'fixture',revision};
const fixtures=()=>releaseServices.map(service=>({Image:'sha256:'+'b'.repeat(64),Config:{Env:[`FUNDED_BUILD_ID=${revision}`,'SOLANA_CLUSTER=devnet','SECRET=must-not-appear'],Labels:{'com.docker.compose.project':'fixture','com.docker.compose.service':service,'org.opencontainers.image.revision':revision}},State:{Status:'running'}}));
test('aligned workers are distinguished from health checks and never expose secret env',()=>{
  const result=assessReleaseServices(fixtures(),options);assert.equal(result.ready,true);assert.equal(result.services[2].health,'not-configured');assert(!JSON.stringify(result).includes('must-not-appear'));
});
test('a healthy app cannot hide an old worker release',()=>{
  const rows=fixtures();rows[3].Config.Env[0]='FUNDED_BUILD_ID='+'c'.repeat(40);rows[3].State.Health={Status:'healthy'};
  assert.deepEqual(assessReleaseServices(rows,options).errors,['agency-buyback-worker: release mismatch']);
});
test('missing, duplicated, stopped, wrong-network and different-image workers fail closed',()=>{
  for(const mutate of [r=>r.pop(),r=>r.push(r[1]),r=>{r[1].State.Status='exited';},r=>{r[1].Config.Env[1]='SOLANA_CLUSTER=mainnet-beta';},r=>{r[1].Image='sha256:'+'c'.repeat(64);}]){
    const rows=fixtures();mutate(rows);assert.equal(assessReleaseServices(rows,options).ready,false);
  }
});
