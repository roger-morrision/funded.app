import {execFileSync} from 'node:child_process';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Connection,PublicKey} from '@solana/web3.js';
import {readProgramDataEvidence} from '../server/automatic-reward-chain.mjs';
const docker=args=>execFileSync('docker',args,{encoding:'utf8',maxBuffer:8*1024*1024});
const [current]=JSON.parse(docker(['inspect','fundedapp-app-1']));
const files=current.Config.Labels['com.docker.compose.project.config_files'].split(',');
const revision=process.argv.find(value=>value.startsWith('--revision='))?.slice(11)||'HEAD';
const sha=execFileSync('git',['rev-parse','--verify',`${revision}^{commit}`],{encoding:'utf8'}).trim();
const image=process.argv.find(value=>value.startsWith('--image='))?.slice(8)||`fundedapp-devnet:automation-${sha.slice(0,8)}`;
const [built]=JSON.parse(docker(['image','inspect',image]));
if(built.Config.Labels?.['org.opencontainers.image.revision']!==sha)throw Error('Image source revision differs from the selected commit');
const env={...process.env,FUNDED_RELEASE_IMAGE:image,FUNDED_APP_IMAGE:image,FUNDED_RELEASE_SHA:sha,
  FUNDED_RELEASE_SOURCE_DIR:resolve('tmp/automation-release/source')};
const rendered=execFileSync('docker',['compose','--project-name','fundedapp','--profile','*','--env-file','.env.deploy','--env-file','.env.x',
  ...files.flatMap(path=>['-f',path]),'config','--format','json'],{env,encoding:'utf8',maxBuffer:8*1024*1024});
const config=JSON.parse(rendered);
const inactive=process.argv.includes('--inactive');
const deployment=inactive ? {programDataSha256:process.env.FUNDED_V3_PROGRAM_DATA_SHA256}
  : JSON.parse(await readFile('tmp/automation-release/deployed-program.json','utf8'));
if(!inactive&&deployment.status!=='finalized-exact-binary')throw Error('The upgraded program is not confirmed.');
if(!inactive){
  const connection=new Connection(process.env.FUNDED_AUTOMATION_RPC_URL||'https://api.devnet.solana.com',{
    commitment:'finalized',disableRetryOnRateLimit:true,
    fetch:(url,options)=>globalThis.fetch(url,{...options,signal:AbortSignal.timeout(30000)})});
  if(await connection.getGenesisHash()!=='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG')throw Error('Not Devnet');
  if((await readProgramDataEvidence(connection,new PublicKey(deployment.program))).sha256!==deployment.programDataSha256)
    throw Error('Finalized ProgramData differs from deployment evidence');
}
for(const name of ['app','fee-collector','buyback-worker','agency-buyback-worker']){
  if(!config.services[name])throw Error(`Missing explicitly selected service ${name}`);
  config.services[name].image=image;delete config.services[name].build;
  config.services[name].environment={...config.services[name].environment,FUNDED_BUILD_ID:sha,
    FUNDED_V3_PROGRAM_DATA_SHA256:deployment.programDataSha256,
    SOLANA_RPC_URL:process.env.FUNDED_AUTOMATION_RPC_URL||'https://api.devnet.solana.com'};
  config.services[name].labels={...config.services[name].labels,'org.opencontainers.image.revision':sha,
    'org.opencontainers.image.source':'https://github.com/roger-morrision/funded.app'};
}
Object.assign(config.services.app.environment,{FUNDED_BUILD_ID:sha,FUNDED_V3_PROGRAM_DATA_SHA256:deployment.programDataSha256,
  FUNDED_V3_AUTO_SETTLEMENT_ENABLED:String(!inactive),FUNDED_V3_AUTO_DISBURSEMENT_ENABLED:String(!inactive),
  SOLANA_RPC_URL:process.env.FUNDED_AUTOMATION_RPC_URL||'https://api.devnet.solana.com',
  FUNDED_PROGRAM_EVIDENCE_RPC_URL:process.env.FUNDED_AUTOMATION_RPC_URL||'https://api.devnet.solana.com'});
if(inactive)for(const flag of ['LAUNCH','COLLECTION','SETTLEMENT','HOLDER_WORKER','BUYBACK','COMMUNITY_FUNDING',
  'CREATOR_REWARD_FUNDING','CREATOR_WALLET_PAYOUT','OPERATIONS_PAYOUT','REFERRAL_PAYOUT'])
  config.services.app.environment[`FUNDED_V3_${flag}_ENABLED`]='false';
if(inactive){
  for(const flag of ['FUNDED_DAILY_BONUS_PAYOUT_ENABLED','FUNDED_V3_AGENCY_BUYBACK_ENABLED'])config.services.app.environment[flag]='false';
  config.services['buyback-worker'].environment.FUNDED_V3_BUYBACK_ENABLED='false';
  config.services['agency-buyback-worker'].environment.FUNDED_V3_AGENCY_BUYBACK_ENABLED='false';
}else{
  for(const [name,value] of Object.entries(process.env))if(/^FUNDED_(V3_|DAILY_BONUS).*_ENABLED$/.test(name))
    config.services.app.environment[name]=value;
  config.services.app.environment.FUNDED_V3_AUTO_SETTLEMENT_ENABLED='true';
  config.services.app.environment.FUNDED_V3_AUTO_DISBURSEMENT_ENABLED='true';
  config.services['buyback-worker'].environment.FUNDED_V3_BUYBACK_ENABLED=process.env.FUNDED_V3_BUYBACK_ENABLED||'false';
  config.services['agency-buyback-worker'].environment.FUNDED_V3_AGENCY_BUYBACK_ENABLED=process.env.FUNDED_V3_AGENCY_BUYBACK_ENABLED||'false';
}
const folder=resolve('tmp/automation-release');await mkdir(folder,{recursive:true});
await writeFile(resolve(folder,'previous-services.json'),rendered);
await writeFile(resolve(folder,'services.compose.json'),JSON.stringify(config,null,2));
console.log(JSON.stringify({config:resolve(folder,'services.compose.json'),image,sha,programDataSha256:deployment.programDataSha256,
  services:['app','fee-collector','buyback-worker','agency-buyback-worker']}));
