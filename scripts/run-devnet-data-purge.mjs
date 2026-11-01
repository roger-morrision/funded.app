import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync,spawnSync} from 'node:child_process';
const manifest=JSON.parse(await readFile('tmp/automation-release/archive-manifest.json','utf8'));
const helper=(await readFile('scripts/devnet-record-purge.mjs','utf8')).replaceAll('export ','');
let script=await readFile('scripts/purge-old-devnet-data.mjs','utf8');
script=script.replace("import {containsReference,linkedReferences,scrubShared,purgeRewardState} from './devnet-record-purge.mjs';",'')
  .replaceAll("from '../server/","from '/app/server/");
const [container]=JSON.parse(execFileSync('docker',['inspect','fundedapp-app-1'],{encoding:'utf8'}));
const oneOff=process.argv.includes('--one-off'),args=process.argv.slice(2).filter(arg=>arg!=='--one-off');
const env='FUNDED_DELETE_MINTS='+JSON.stringify(manifest.mints);
const files=container.Config.Labels['com.docker.compose.project.config_files'].split(',');
const command=oneOff?['compose','--project-name','fundedapp','--profile','*',...files.flatMap(path=>['-f',path]),
  'run','--rm','-T','--no-deps','--entrypoint','node','-e',env,'app','--input-type=module','-',...args]
  :['exec','-i','-e',env,'fundedapp-app-1','node','--input-type=module','-',...args];
const result=spawnSync('docker',command,{input:helper+'\n'+script,encoding:'utf8',maxBuffer:2*1024*1024,timeout:300000});
if(result.status!==0){console.error(result.stderr||'Purge execution failed');process.exit(1);}
const line=result.stdout.trim().split('\n').findLast(line=>line.startsWith('{'));
const report=JSON.parse(line);await mkdir('tmp/devnet-permanent-purge',{recursive:true});
await writeFile('tmp/devnet-permanent-purge/'+(args.includes('--apply')?'applied':'plan')+'.json',JSON.stringify(report,null,2));
await writeFile('tmp/devnet-permanent-purge/services.json',JSON.stringify({files,image:container.Config.Image},null,2));
console.log(JSON.stringify(report));
