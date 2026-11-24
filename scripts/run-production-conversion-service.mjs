import {readFile} from 'node:fs/promises';
import {prepareProductionConversionService} from '../server/production-conversion-runtime.mjs';

// Separate private process. Never loads .env, provisions keys/journals, enables
// public Mainnet routes or starts an automatic financial worker.
const [mode,deploymentFile,bindingsFile,...extra]=process.argv.slice(2);
let runtime;
try{
  if(!['check','serve'].includes(mode)||!deploymentFile||!bindingsFile||extra.length)
    throw Error('Use check|serve DEPLOYMENT_JSON BINDINGS_JSON.');
  const deployment=JSON.parse(await readFile(deploymentFile,'utf8'));
  const bindings=JSON.parse(await readFile(bindingsFile,'utf8'));
  runtime=await prepareProductionConversionService({deployment,bindings,sourceRevision:process.env.FUNDED_BUILD_ID});
  if(mode==='check'){
    console.log(JSON.stringify({scope:'runtime-admission-only',...runtime.admission,listening:false,transactionsSubmitted:0}));
    await runtime.close();
  }else{
    console.log(JSON.stringify({event:'production-conversion-listening',...await runtime.start()}));
    const stop=async()=>{try{await runtime.close();process.exitCode=0;}catch{process.exitCode=1;}};
    process.once('SIGTERM',stop);process.once('SIGINT',stop);
  }
}catch{
  await runtime?.close().catch(()=>{});
  console.error('Production conversion startup refused. Check reviewed release, role bindings, existing journals and exact activation approval.');
  process.exitCode=1;
}
