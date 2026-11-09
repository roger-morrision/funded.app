import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {assessMainnetConfig} from './mainnet-readiness-preflight.mjs';
import {loadMainnetConfig} from './mainnet-config.mjs';

export function mainnetStagingEnvironment(config,build,{systemEnv=process.env,port=4187}={}) {
  if(!assessMainnetConfig(config).configurationComplete)
    throw Error('Complete the isolated read-only Mainnet configuration before starting staging.');
  if(build?.schemaVersion!==1||build.cluster!=='mainnet-beta'||build.exploreCluster!==build.cluster
    ||build.mainnetEnabled!==false||build.mainnetReadOnly!==true||build.devWalletEnabled!==false)
    throw Error('Staging requires a Mainnet read-only browser build; a Devnet build cannot be served.');
  if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Use a non-privileged staging port.');
  for(const [name,value] of Object.entries(config)){
    if(value&&['NODE_OPTIONS','NODE_PATH'].includes(name))
      throw Error('Read-only staging must not inject Node runtime hooks.');
    if(value&&/SECRET_KEY|PRIVATE_KEY|KEYPAIR|SIGNER_FILE$/.test(name))
      throw Error('Read-only staging must not load transaction signers.');
    if(/(?:ENABLED|AUTOCONNECT)$/.test(name)&&/^(true|1|yes|on)$/i.test(value))
      throw Error('Read-only staging must not enable financial workers or developer wallets.');
  }
  // Never inherit a local Devnet database, signer, RPC, NODE_OPTIONS or .env.
  const systemNames=new Set(['PATH','SYSTEMROOT','WINDIR','COMSPEC','PATHEXT','TEMP','TMP','TMPDIR','LANG','LC_ALL','NODE_EXTRA_CA_CERTS']);
  const env=Object.fromEntries(Object.entries(systemEnv).filter(([name])=>systemNames.has(name.toUpperCase())));
  Object.assign(env,config,{NODE_ENV:'production',HOST:'127.0.0.1',PORT:String(port),FUNDED_SKIP_LOCAL_ENV:'true',
    FUNDED_API_ONLY:'true',SOLANA_CLUSTER:'mainnet-beta',VITE_SOLANA_CLUSTER:'mainnet-beta',
    VITE_EXPLORE_CLUSTER:'mainnet-beta',VITE_MAINNET_READ_ONLY:'true',VITE_ALLOW_MAINNET:'false',
    VITE_DEV_MODE:'false',VITE_DEV_AUTOCONNECT:'false',DEV_WALLET_ENABLED:'false',
    PUBLIC_APP_URL:config.MAINNET_APP_ORIGIN,CORS_ORIGIN:config.MAINNET_APP_ORIGIN});
  return env;
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const [flag,file,...extra]=process.argv.slice(2);
  if(flag!=='--config'||!file||extra.length)throw Error('Use --config PRIVATE_CONFIG_FILE. No local defaults are inherited.');
  const env=mainnetStagingEnvironment(loadMainnetConfig(file),JSON.parse(readFileSync('dist/build-settings.json','utf8')));
  const child=spawn(process.execPath,['server/index.mjs'],{env,stdio:'inherit'});
  child.on('error',()=>{console.error('Read-only staging could not start.');process.exitCode=1;});
  child.on('exit',code=>{process.exitCode=code??1;});
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
}
