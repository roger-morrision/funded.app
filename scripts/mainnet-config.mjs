import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {parseEnv} from 'node:util';
import {assertMainnetStagingPolicy} from '../server/mainnet-staging-policy.mjs';
const missing=value=>!String(value||'').trim()||/REPLACE|PLACEHOLDER/i.test(value);
// Explicit configuration only: never inherit the local Devnet .env or credentials.
export function loadMainnetConfig(file,{read=readFileSync}={}){
  const path=resolve(file),env={...parseEnv(read(path,'utf8')),FUNDED_SKIP_LOCAL_ENV:'true'};
  if(env.SOLANA_CLUSTER!=='mainnet-beta'||env.VITE_SOLANA_CLUSTER!=='mainnet-beta')
    throw Error('The explicit configuration must select Mainnet for both server and client.');
  assertMainnetStagingPolicy(env); // Reject signers before reading any referenced secret.
  for(const name of ['SOLANA_RPC_URL','DEVNET_SOLANA_RPC_URL','DATABASE_URL','DEVNET_DATABASE_URL','BIRDEYE_API_KEY','PINATA_JWT','FUNDED_API_TOKEN']){
    const reference=env[name+'_FILE'];
    if(missing(reference)){if(missing(env[name]))delete env[name];continue;}
    if(!missing(env[name]))throw Error(`Configure ${name} by file reference only, not both sources.`);
    let value;try{value=read(resolve(dirname(path),reference),'utf8').trim();}catch{throw Error(`Cannot read ${name}_FILE. No network request was made.`);}
    if(missing(value)||/[\r\n]/.test(value))throw Error(`Invalid ${name}_FILE contents.`);
    env[name]=value;
  }
  return env;
}
