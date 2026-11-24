import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Connection} from '@solana/web3.js';
import {observeMainnetCandidate,observeDeploymentFunding,validateCandidateSelection} from './mainnet-candidate-observation.mjs';
import {readProductionReference} from '../server/production-conversion-runtime.mjs';

try{
  const [binaryFile,rpcFile,output,...extra]=process.argv.slice(2);
  assert(binaryFile&&rpcFile&&output&&!extra.length,'Use CANDIDATE_ELF DEDICATED_RPC_FILE NEW_OUTPUT_JSON.');
  const candidate=JSON.parse(await readFile('config/mainnet-review-candidate.json','utf8'));
  const plan=JSON.parse(await readFile('config/mainnet-deployment-plan.json','utf8'));
  const binary=await readFile(resolve(binaryFile));
  validateCandidateSelection({candidate,plan,binary});
  const endpoint=await readProductionReference(resolve(rpcFile));
  const url=new URL(endpoint);
  assert(url.protocol==='https:'&&!url.username&&!url.password&&!url.hash
    &&!['api.mainnet-beta.solana.com','api.mainnet.solana.com'].includes(url.hostname),'Separate dedicated HTTPS RPC required.');
  const connect=rpc=>new Connection(rpc,{commitment:'finalized',disableRetryOnRateLimit:true,
    fetch:(address,options)=>fetch(address,{...options,signal:AbortSignal.timeout(15000)})});
  const connections=[connect(endpoint),connect('https://api.mainnet-beta.solana.com')];
  const report=await observeMainnetCandidate({connections,candidate,plan,binary});
  report.funding=await observeDeploymentFunding({connection:connections[0],candidate,plan});
  await writeFile(resolve(output),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(report,null,2));
  if(report.status!=='verified-candidate')process.exitCode=1;
}catch{
  console.error('Candidate observation refused or unavailable. Verify explicit candidate, RPC reference and fresh output path. No transaction was signed or submitted.');
  process.exitCode=1;
}
