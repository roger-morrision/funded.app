import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {applyRpcGatewayConfig} from '../server/rpc-gateway-config.mjs';

const docker=args=>execFileSync('docker',args,{encoding:'utf8',maxBuffer:8*1024*1024});
const revision=process.argv.find(value=>value.startsWith('--revision='))?.slice(11);
assert(revision,'An explicit tested source revision is required');
const sha=execFileSync('git',['rev-parse','--verify',`${revision}^{commit}`],{encoding:'utf8'}).trim();
const image=`fundedapp-devnet:rpc-${sha.slice(0,8)}`,[built]=JSON.parse(docker(['image','inspect',image]));
assert.equal(built.Config.Labels['org.opencontainers.image.revision'],sha);
const [current]=JSON.parse(docker(['inspect','fundedapp-app-1']));
const files=current.Config.Labels['com.docker.compose.project.config_files'].split(',');
const rendered=docker(['compose','--project-name','fundedapp','--profile','*',...files.flatMap(file=>['-f',file]),'config','--format','json']);
const base=JSON.parse(rendered),deployment=JSON.parse(await readFile('tmp/automation-release/deployed-program.json','utf8'));
assert.equal(deployment.status,'finalized-exact-binary');
for(const name of ['app','fee-collector','buyback-worker','agency-buyback-worker']){
  const service=base.services[name];assert(service,`Missing ${name}`);
  assert.equal(service.environment.FUNDED_V3_PROGRAM_DATA_SHA256,deployment.programDataSha256);
  service.image=image;delete service.build;
  service.environment.FUNDED_BUILD_ID=sha;
  service.labels={...service.labels,'org.opencontainers.image.revision':sha};
}
// A separate file prevents host-side tools from accidentally making the
// gateway its own upstream when they switch to the loopback client URL.
const upstreamFile=resolve('.secrets/rpc-gateway-upstream-url');
let upstream;try{upstream=(await readFile(upstreamFile,'utf8')).trim();}catch(error){if(error.code!=='ENOENT')throw error;
  upstream=(await readFile('.secrets/automation-selected-rpc-url','utf8')).trim();
  const url=new URL(upstream);assert.equal(url.protocol,'https:');
  await writeFile(upstreamFile,upstream+'\n',{mode:0o600,flag:'wx'});
}
assert.equal(new URL(upstream).protocol,'https:');
const config=applyRpcGatewayConfig(base,{image,revision:sha,upstreamFile});
const folder=resolve('tmp/rpc-gateway-release');await mkdir(folder,{recursive:true});
await writeFile(resolve(folder,'previous-services.compose.json'),rendered);
await writeFile(resolve(folder,'services.compose.json'),JSON.stringify(config,null,2));
await writeFile(resolve(folder,'release.json'),JSON.stringify({sha,image,imageId:built.Id,
 previousAppRevision:current.Config.Labels['org.opencontainers.image.revision'],programDataSha256:deployment.programDataSha256,
 config:resolve(folder,'services.compose.json')},null,2));
console.log(JSON.stringify({staged:true,sha,image,services:['rpc-gateway','app','fee-collector','buyback-worker','agency-buyback-worker']}));
