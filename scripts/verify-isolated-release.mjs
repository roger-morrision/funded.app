// Actual HTTP server + built assets, but no user database, authority or external network.
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const probe=createServer();
await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const directory=await mkdtemp(join(tmpdir(),'funded-isolated-release-'));
const env={...process.env,NODE_ENV:'test',FUNDED_AUTH_HTTP_FIXTURE:'1',FUNDED_STORE_PATH:join(directory,'state.json'),DATABASE_URL:'',
  HOST:'127.0.0.1',PORT:String(port),VITE_SOLANA_CLUSTER:'devnet',SOLANA_CLUSTER:'devnet',SOLANA_RPC_URL:'http://127.0.0.1:9',
  DEV_MODE:'false',DEVNET_TEST_MODE:'false',FUNDED_MINT_FEE_ROUTER_ENABLED:'false',SOLANA_KEEPER_CONFIGURED:'false',
  FUNDED_BUILD_ID:'isolated-release',PUBLIC_APP_URL:'',CORS_ORIGIN:`http://127.0.0.1:${port}`};
for(const key of ['SOLANA_KEEPER_KEYPAIR_PATH','SOLANA_KEEPER_SECRET_KEY','FUNDED_ROUTER_AUTHORITY_KEYPAIR_PATH','FUNDED_ROUTER_AUTHORITY_SECRET_KEY','FUNDED_API_TOKEN','FUNDED_FEE_ROUTER_PROGRAM_ID','VITE_FUNDED_FEE_ROUTER_PROGRAM_ID','X_BEARER_TOKEN','X_CLIENT_ID','X_CLIENT_SECRET','X_CALLBACK_URL'])env[key]='';
const api=spawn(process.execPath,['scripts/fixtures/x-oauth-api.mjs'],{env,stdio:'ignore'});
try {
  let ready=false;
  for(let attempt=0;attempt<60;attempt++){
    try { if((await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(1000)})).ok){ready=true;break;} } catch {}
    if(api.exitCode!==null)break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(ready,'Isolated release server did not start. Build assets first with npm run build.');
  const check=spawn(process.execPath,['scripts/verify-release-contract.mjs'],{env:{...env,FUNDED_RELEASE_BASE:`http://127.0.0.1:${port}`,FUNDED_EXPECT_BUILD:'isolated-release',FUNDED_REQUIRE_POSTGRES:'false'},stdio:'inherit'});
  const [code]=await once(check,'exit');assert.equal(code,0,'Release contract failed.');
} finally {
  if(api.exitCode===null){const stopped=once(api,'exit');api.kill();await stopped;}
  await rm(directory,{recursive:true,force:true});
}
