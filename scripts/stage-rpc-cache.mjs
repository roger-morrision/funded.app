import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {applyRpcGatewayRedisConfig} from '../server/rpc-gateway-config.mjs';

const docker=args=>execFileSync('docker',args,{encoding:'utf8',maxBuffer:8*1024*1024});
const revision=process.argv.find(value=>value.startsWith('--revision='))?.slice(11);
assert(revision,'An explicit tested source revision is required');
const sha=execFileSync('git',['rev-parse','--verify',`${revision}^{commit}`],{encoding:'utf8'}).trim();
const image=`fundedapp-devnet:rpc-cache-${sha.slice(0,8)}`,[built]=JSON.parse(docker(['image','inspect',image]));
assert.equal(built.Config.Labels['org.opencontainers.image.revision'],sha);
const [current]=JSON.parse(docker(['inspect','fundedapp-rpc-gateway-1']));
// App/worker releases can advance independently of a gateway-only release.
// Preserve their latest active compose baseline, not the gateway's older one.
const [app]=JSON.parse(docker(['inspect','fundedapp-app-1']));
const files=app.Config.Labels['com.docker.compose.project.config_files'].split(',');
const rendered=docker(['compose','--project-name','fundedapp','--profile','*',...files.flatMap(file=>['-f',file]),'config','--format','json']);
const base=JSON.parse(rendered),config=applyRpcGatewayRedisConfig(base,{image,revision:sha});
assert.equal(config.services['rpc-gateway'].environment.SOLANA_CLUSTER,'devnet');
const [redis]=JSON.parse(docker(['image','inspect','redis:8-alpine']));
const redisImage=redis.RepoDigests.find(value=>/^redis@sha256:[a-f0-9]{64}$/.test(value));
assert(redisImage,'Pull the official Redis image before staging');config.services['rpc-cache'].image=redisImage;
const folder=resolve('tmp/rpc-cache-release');await mkdir(folder,{recursive:true});
await writeFile(resolve(folder,'previous-services.compose.json'),rendered);
await writeFile(resolve(folder,'services.compose.json'),JSON.stringify(config,null,2));
await writeFile(resolve(folder,'release.json'),JSON.stringify({sha,image,imageId:built.Id,
  redisImage,previousGatewayRevision:current.Config.Labels['org.opencontainers.image.revision'],config:resolve(folder,'services.compose.json')},null,2));
console.log(JSON.stringify({staged:true,sha,image,services:['rpc-cache','rpc-gateway']}));
