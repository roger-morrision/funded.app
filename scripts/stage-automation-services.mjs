import {wireAgencyPriceSigner} from './agency-service-config.mjs';
import {execFileSync} from 'node:child_process';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {PublicKey} from '@solana/web3.js';
import {createHash} from 'node:crypto';
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
const gatewayEnabled=Boolean(config.services['rpc-gateway']);
const clientRpc=gatewayEnabled?'http://rpc-gateway:8899':process.env.FUNDED_AUTOMATION_RPC_URL||'https://api.devnet.solana.com';
const inactive=process.argv.includes('--inactive');
const deployment=inactive ? {programDataSha256:process.env.FUNDED_V3_PROGRAM_DATA_SHA256}
  : JSON.parse(await readFile('tmp/automation-release/deployed-program.json','utf8'));
if(!inactive&&deployment.status!=='finalized-exact-binary')throw Error('The upgraded program is not confirmed.');
if(!inactive){
  const rpc=process.env.FUNDED_AUTOMATION_RPC_URL||'https://api.devnet.solana.com',program=new PublicKey(deployment.program);
  const loader=new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
  const [programData]=PublicKey.findProgramAddressSync([program.toBuffer()],loader);
  const response=await fetch(rpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify([
    {jsonrpc:'2.0',id:1,method:'getGenesisHash',params:[]},
    {jsonrpc:'2.0',id:2,method:'getMultipleAccounts',params:[[program.toBase58(),programData.toBase58()],{encoding:'base64',commitment:'finalized'}]},
  ]),signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error(`Release verification RPC HTTP ${response.status}`);
  const rows=await response.json();if(!Array.isArray(rows)||rows.some(row=>row.error))throw Error('Release verification RPC failed');
  if(rows.find(row=>row.id===1)?.result!=='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG')throw Error('Not Devnet');
  const snapshot=rows.find(row=>row.id===2)?.result,[account,dataAccount]=snapshot?.value||[];
  const accountBytes=Buffer.from(account?.data?.[0]||'','base64'),dataBytes=Buffer.from(dataAccount?.data?.[0]||'','base64');
  if(!Number.isSafeInteger(snapshot?.context?.slot)||!account?.executable||account.owner!==loader.toBase58()
    ||accountBytes.length!==36||accountBytes.readUInt32LE(0)!==2||!new PublicKey(accountBytes.subarray(4,36)).equals(programData)
    ||dataAccount?.owner!==loader.toBase58()||dataAccount.executable||dataBytes.length<45||dataBytes.readUInt32LE(0)!==3
    ||createHash('sha256').update(dataBytes).digest('hex')!==deployment.programDataSha256)
    throw Error('Finalized ProgramData differs from deployment evidence');
}
for(const name of ['app','fee-collector','buyback-worker','agency-buyback-worker']){
  if(!config.services[name])throw Error(`Missing explicitly selected service ${name}`);
  config.services[name].image=image;delete config.services[name].build;
  config.services[name].environment={...config.services[name].environment,FUNDED_BUILD_ID:sha,
    FUNDED_V3_PROGRAM_DATA_SHA256:deployment.programDataSha256,
    SOLANA_RPC_URL:clientRpc};
  config.services[name].labels={...config.services[name].labels,'org.opencontainers.image.revision':sha,
    'org.opencontainers.image.source':'https://github.com/roger-morrision/funded.app'};
}
Object.assign(config.services.app.environment,{FUNDED_BUILD_ID:sha,FUNDED_V3_PROGRAM_DATA_SHA256:deployment.programDataSha256,
  FUNDED_V3_AUTO_SETTLEMENT_ENABLED:String(!inactive),FUNDED_V3_AUTO_DISBURSEMENT_ENABLED:String(!inactive),
  SOLANA_RPC_URL:clientRpc,SOLANA_HOLDER_INDEX_RPC_URL:clientRpc,
  FUNDED_PROGRAM_EVIDENCE_RPC_URL:gatewayEnabled?'':clientRpc});
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
wireAgencyPriceSigner(config);
const folder=resolve('tmp/automation-release');await mkdir(folder,{recursive:true});
await writeFile(resolve(folder,'previous-services.json'),rendered);
await writeFile(resolve(folder,'services.compose.json'),JSON.stringify(config,null,2));
console.log(JSON.stringify({config:resolve(folder,'services.compose.json'),image,sha,programDataSha256:deployment.programDataSha256,
  services:['app','fee-collector','buyback-worker','agency-buyback-worker']}));
