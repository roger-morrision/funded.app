// Existing Devnet deployment upgrades only. Preparation never contacts Docker.
import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve,join,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {releaseServices,assessReleaseServices} from './verify-deployment-readiness.mjs';
import {localDockerHost,deploymentCapacity} from './check-deployment-capacity.mjs';
import {monitoredWorkers,workerHealthcheck} from './worker-health.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const revisionPattern=/^[a-f0-9]{40}$/,imagePattern=/^sha256:[a-f0-9]{64}$/;
const releasePattern=/^[a-f0-9]{40}-[a-f0-9-]{36}$/;
class ReleaseError extends Error {}
function requireValue(ok,message){if(!ok)throw new ReleaseError(message);}
const readJSON=file=>JSON.parse(fs.readFileSync(file,'utf8'));
function writeJSON(file,value){
  const temp=file+'.'+randomUUID()+'.tmp';
  fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});
  fs.renameSync(temp,file);
}
function childPath(base,name){
  const path=resolve(base,name),rel=relative(base,path);
  requireValue(rel!==''&&!rel.startsWith('..')&&!isAbsolute(rel),'Release path escapes its directory.');
  return path;
}
function regularTree(path){
  const stat=fs.lstatSync(path);
  requireValue(!stat.isSymbolicLink()&&(stat.isFile()||stat.isDirectory()),'Release inputs must be regular files/directories, without links.');
  if(stat.isDirectory())for(const name of fs.readdirSync(path))regularTree(join(path,name));
}
function filesIn(path,base=path){
  regularTree(path);
  if(fs.statSync(path).isFile())return[{path:relative(base,path).replaceAll('\\','/'),sha256:sha(fs.readFileSync(path))}];
  return fs.readdirSync(path).sort().flatMap(name=>filesIn(join(path,name),base));
}
function privateDirectory(path){fs.mkdirSync(path,{recursive:true,mode:0o700});requireValue(!fs.lstatSync(path).isSymbolicLink(),'Release directories cannot be links.');}
function readableInput(path){
  const directory=fs.statSync(path).isDirectory();fs.chmodSync(path,directory?0o755:0o644);
  if(directory)for(const name of fs.readdirSync(path))readableInput(join(path,name));
}
// Compose interpolates dollar signs even in JSON. Preserve already-resolved values.
export function literalCompose(value){
  if(typeof value==='string')return value.replaceAll('$',()=>'$$');
  if(Array.isArray(value))return value.map(literalCompose);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,literalCompose(v)]));
  return value;
}
export function validateReleaseIdentity({project,origin,image,revision}){
  requireValue(/^[a-z0-9][a-z0-9_-]*$/.test(project||''),'An explicit Compose project is required.');
  requireValue(revisionPattern.test(revision||'')&&imagePattern.test(image||''),'Use a full source revision and immutable local image ID.');
  const url=new URL(origin);
  requireValue(url.origin===origin&&!url.username&&!url.password&&url.protocol==='https:','Use an exact HTTPS public origin.');
}

export function prepareRelease({config,image,revision,origin,stateDir}){
  const project=config.name;validateReleaseIdentity({project,origin,image,revision});
  requireValue(!config.include&&!config.env_file,'Supply fully resolved Compose JSON.');
  for(const service of releaseServices){
    const s=config.services?.[service];
    requireValue(s&&s.environment?.SOLANA_CLUSTER==='devnet',`${service}: explicit Devnet configuration is required.`);
    requireValue(!Array.isArray(s.environment)&&!Array.isArray(s.labels),`${service}: resolve environment and labels first.`);
  }
  const id=revision+'-'+randomUUID(),dir=childPath(resolve(stateDir),'releases/'+id);
  privateDirectory(dir);
  try{
    const frozen=structuredClone(config),inputs=[];let index=0;
    const freeze=source=>{
      requireValue(isAbsolute(source),'Resolve every host input to an absolute path first.');
      regularTree(source);const name='inputs/'+String(index++),dest=childPath(dir,name);
      privateDirectory(dirname(dest));fs.cpSync(source,dest,{recursive:true,errorOnExist:true,force:false});readableInput(dest);
      inputs.push(name);return dest;
    };
    for(const [name,s] of Object.entries(frozen.services)){
      requireValue(!s.extends&&!s.env_file&&!s.develop,'Resolve inherited configuration and environment files before preparation.');
      delete s.build;delete s.pull_policy;
      for(const mount of s.volumes||[]){
        requireValue(mount&&typeof mount==='object','Use resolved long-form mount definitions.');
        if(mount.type==='bind'){
          requireValue(mount.read_only===true,'Writable host binds require a separately managed data volume.');
          mount.source=freeze(mount.source);
        }else requireValue(mount.type==='volume'||mount.type==='tmpfs','Unsupported runtime mount.');
      }
      if(releaseServices.includes(name)){
        s.image=image;s.environment.FUNDED_BUILD_ID=revision;
        s.labels={...s.labels,'org.opencontainers.image.revision':revision};
        if(name==='app')s.labels['vip.funded.frontend.revision']=revision;
        if(monitoredWorkers.includes(name))s.healthcheck=workerHealthcheck(name);
      }
    }
    // Existing named data volumes and networks must never be silently recreated.
    for(const section of ['volumes','networks'])for(const [key,value]of Object.entries(frozen[section]||{})){
      requireValue(typeof value.name==='string'&&value.name.length>0,'Resolve resource names before preparation.');
      frozen[section][key]={name:value.name,external:true};
    }
    for(const entry of Object.values(frozen.configs||{}))if(entry.file)entry.file=freeze(entry.file);
    for(const entry of Object.values(frozen.secrets||{})){
      requireValue(entry.file&&isAbsolute(entry.file)&&!/(^|[\\/])(tmp|temp)([\\/]|$)/i.test(entry.file),'Secrets must use stable absolute file paths.');
      requireValue(fs.statSync(entry.file).isFile(),'Secret file is unavailable.');
    }
    const frontend=frozen.services.app.volumes?.find(v=>v.target==='/app/dist');
    requireValue(frontend?.type==='bind'&&frontend.read_only,'Supply the reviewed frontend as a read-only /app/dist bind.');
    const settings=readJSON(join(frontend.source,'build-settings.json'));
    requireValue(settings.cluster==='devnet'&&settings.mainnetEnabled===false&&/^[a-f0-9]{64}$/.test(settings.sourceDigest||''),'Frontend identity must be a Devnet build with a source digest.');
    frozen.services.app.labels['vip.funded.frontend.digest']=settings.sourceDigest;
    const composeFile=join(dir,'compose.json');writeJSON(composeFile,literalCompose(frozen));
    const inputFiles=inputs.flatMap(name=>{
      const path=childPath(dir,name);
      return fs.statSync(path).isFile()?[{path:name,sha256:sha(fs.readFileSync(path))}]:filesIn(path,dir);
    });
    const manifest={schemaVersion:1,id,project,origin,image,revision,frontendDigest:settings.sourceDigest,
      composeHash:sha(fs.readFileSync(composeFile)),inputs:inputFiles,preparedAt:new Date().toISOString()};
    writeJSON(join(dir,'manifest.json'),manifest);
    return manifest;
  }catch(error){
    // Keep an incomplete private bundle for diagnosis; it is not deployable.
    throw error;
  }
}

export function loadRelease(stateDir,id){
  requireValue(releasePattern.test(id||''),'Invalid release identifier.');
  const dir=childPath(resolve(stateDir),'releases/'+id);regularTree(dir);
  const manifest=readJSON(join(dir,'manifest.json'));validateReleaseIdentity(manifest);
  requireValue(manifest.schemaVersion===1&&manifest.id===id,'Release manifest identity differs.');
  const composeFile=join(dir,'compose.json');
  requireValue(sha(fs.readFileSync(composeFile))===manifest.composeHash,'Release configuration changed after preparation.');
  for(const input of manifest.inputs){
    requireValue(sha(fs.readFileSync(childPath(dir,input.path)))===input.sha256,'Release input changed after preparation.');
  }
  // Added files can affect a mounted directory just as much as modified files.
  const actual=fs.existsSync(join(dir,'inputs'))?filesIn(join(dir,'inputs'),dir):[];
  requireValue(JSON.stringify(actual.sort((a,b)=>a.path.localeCompare(b.path)))===JSON.stringify([...manifest.inputs].sort((a,b)=>a.path.localeCompare(b.path))),'Release input inventory changed.');
  return{...manifest,dir,composeFile,manifestHash:sha(fs.readFileSync(join(dir,'manifest.json')))};
}

export function composeReleaseArgs(release){
  return ['compose','--project-name',release.project,'--project-directory',release.dir,
    '--env-file',join(release.dir,'empty.env'),'-f',release.composeFile,'up','--detach','--no-deps',
    '--no-build','--pull','never','--wait','--wait-timeout','180',...releaseServices];
}
export function assertReleaseImage(image,release){
  requireValue(image.Id===release.image&&image.Config?.Labels?.['org.opencontainers.image.revision']===release.revision
    &&image.Config.Env?.includes('FUNDED_BUILD_ID='+release.revision),'Image identity does not match the prepared release.');
}
export function assertImageFrontend(settings,release){
  requireValue(settings?.cluster==='devnet'&&settings.mainnetEnabled===false&&settings.sourceDigest===release.frontendDigest,
    'The image frontend differs from the prepared frontend. Build both from the same reviewed source.');
}
export function assessPublicRelease(release,checks){
  return checks.status?.cluster==='devnet'&&checks.status.build===release.revision
    &&checks.frontend?.cluster==='devnet'&&checks.frontend.mainnetEnabled===false&&checks.frontend.sourceDigest===release.frontendDigest
    &&checks.fees?.policy?.tradeBps===100&&checks.launch?.developerTokenLock?.ready===true&&checks.launch.developerTokenLock.lockSeconds===43200;
}
export async function verifyRelease(release,io,{attempts=1}={}){
  let report;
  for(let attempt=0;attempt<attempts;attempt++){
    const services=assessReleaseServices(await io.containers(release.project),release);
    let publicReady=false;
    try{publicReady=assessPublicRelease(release,await io.publicChecks(release.origin));}catch{/* Public failure is sanitized. */}
    const exactImage=services.services.length===releaseServices.length&&services.services.every(s=>s.image===release.image);
    report={at:new Date().toISOString(),ready:services.ready&&exactImage&&publicReady,services:services.services,
      errors:[...services.errors,...(!exactImage?['Prepared image is not running on every release service.']:[]),...(!publicReady?['Public build, fee policy or launch readiness is unavailable.']:[])]};
    if(report.ready)return report;
    if(attempt+1<attempts)await io.wait(5000);
  }
  return report;
}

export async function applyRelease({stateDir,id,rollback=false},io){
  privateDirectory(stateDir);const lock=join(stateDir,'release.lock');
  const lockFd=fs.openSync(lock,'wx',0o600);
  try{
    const stateFile=join(stateDir,'state.json'),state=fs.existsSync(stateFile)?readJSON(stateFile):{};
    const pendingFile=join(stateDir,'pending.json'),pending=fs.existsSync(pendingFile)?readJSON(pendingFile):null;
    const target=rollback?(pending?.previous||state.previous):{id};
    requireValue(target?.id,'No verified prior release is available for rollback.');
    requireValue(!pending||rollback||pending.target.id===target.id,'Resolve the unfinished release before selecting another candidate.');
    const release=loadRelease(stateDir,target.id);
    if(rollback)requireValue(release.manifestHash===target.manifestHash,'Rollback manifest changed.');
    if(pending&&!rollback)requireValue(release.manifestHash===pending.target.manifestHash,'Pending release changed.');
    if(state.current){
      const prior=loadRelease(stateDir,state.current.id);requireValue(prior.manifestHash===state.current.manifestHash,'Accepted release changed.');
      requireValue(prior.project===release.project&&prior.origin===release.origin,'Cannot switch project or origin during a release.');
      if(!pending&&!rollback){const before=await verifyRelease(prior,io);requireValue(before.ready,'Current release is not verified; diagnose drift before deploying.');}
    }
    assertReleaseImage(await io.image(release.image),release);
    await io.preflight(release);
    fs.writeFileSync(join(release.dir,'empty.env'),'',{mode:0o600});
    const journal={target:{id:release.id,manifestHash:release.manifestHash},previous:pending?.previous||state.current||null,startedAt:new Date().toISOString()};
    writeJSON(pendingFile,journal);
    // Explicitly update all four services. No dependency startup, pull, build or volume deletion.
    await io.up(release);
    const verification=await verifyRelease(release,io,{attempts:12});
    writeJSON(join(release.dir,'verification.json'),verification);
    requireValue(verification.ready,'Release acceptance failed. Prior accepted state was retained; retry the same release or run rollback.');
    const current={id:release.id,manifestHash:release.manifestHash};
    const previous=state.current?.id===release.id?state.previous:state.current;
    writeJSON(stateFile,{current,previous:previous||null,acceptedAt:new Date().toISOString()});
    fs.unlinkSync(pendingFile);
    return{release:release.id,revision:release.revision,ready:true,rollbackAvailable:Boolean(previous)};
  }finally{fs.closeSync(lockFd);fs.unlinkSync(lock);}
}

function dockerIO(){
  const env={...process.env};for(const k of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH','COMPOSE_FILE','COMPOSE_PROFILES','COMPOSE_PROJECT_NAME','COMPOSE_ENV_FILES'])delete env[k];
  const docker=args=>execFileSync('docker',[`--host=${localDockerHost()}`,...args],{env,encoding:'utf8',windowsHide:true,timeout:240000,maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe']});
  const containers=async project=>{
    const ids=docker(['ps','-aq','--filter','label=com.docker.compose.project='+project]).trim().split(/\s+/).filter(Boolean);
    return ids.length?JSON.parse(docker(['inspect',...ids])):[];
  };
  return{containers,image:async id=>JSON.parse(docker(['image','inspect',id]))[0],wait:ms=>new Promise(r=>setTimeout(r,ms)),
    preflight:async release=>{
      const current=await containers(release.project);
      for(const service of releaseServices)requireValue(current.filter(c=>c.Config.Labels['com.docker.compose.service']===service).length===1,'This command upgrades an existing four-service deployment only.');
      const config=readJSON(release.composeFile);
      for(const service of releaseServices)for(const [name,dependency]of Object.entries(config.services[service].depends_on||{}))if(!releaseServices.includes(name)){
        const c=current.find(c=>c.Config.Labels['com.docker.compose.service']===name);
        const ready=dependency.condition==='service_completed_successfully'?c?.State.Status==='exited'&&c.State.ExitCode===0
          :c?.State.Status==='running'&&(dependency.condition!=='service_healthy'||c.State.Health?.Status==='healthy');
        requireValue(ready,'Start and verify existing infrastructure before applying a release.');
      }
      const app=current.find(c=>c.Config.Labels['com.docker.compose.service']==='app');
      const capacity=await deploymentCapacity({container:app.Id,workspace:release.dir,phase:'switch'});
      requireValue(capacity.ready,'Deployment capacity is insufficient or unavailable.');
      // Inspect the image filesystem without starting its process or mounting credentials.
      let inspector;const settingsFile=join(release.dir,'image-settings-'+randomUUID()+'.json');
      try{
        inspector=docker(['create','--pull=never','--network','none','--read-only',release.image]).trim();
        requireValue(/^[a-f0-9]{64}$/.test(inspector),'Image inspection container was not created.');
        docker(['cp',inspector+':/app/dist/build-settings.json',settingsFile]);
        assertImageFrontend(readJSON(settingsFile),release);
      }finally{
        if(inspector&&/^[a-f0-9]{64}$/.test(inspector))docker(['rm','--volumes',inspector]);
        if(fs.existsSync(settingsFile))fs.unlinkSync(settingsFile);
      }
    },
    up:async release=>{docker(composeReleaseArgs(release));},
    publicChecks:async origin=>{
      const entries=await Promise.all(Object.entries({status:'/api/status',frontend:'/build-settings.json',fees:'/api/service-fees',launch:'/api/launch-reserve-config'}).map(async([key,path])=>{
        const response=await fetch(origin+path,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
        requireValue(response.ok,'Public verification unavailable.');return[key,await response.json()];
      }));return Object.fromEntries(entries);
    }};
}

async function main(){
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),stateDir=join(root,'.secrets','funded-vip-deployment');
  const [mode,...args]=process.argv.slice(2);
  if(mode==='prepare'){
    requireValue(args.length===4,'prepare requires resolved-compose.json, immutable image ID, full revision and HTTPS origin.');
    const manifest=prepareRelease({config:readJSON(resolve(args[0])),image:args[1],revision:args[2],origin:args[3],stateDir});
    console.log(JSON.stringify({prepared:true,id:manifest.id,revision:manifest.revision,inputs:manifest.inputs.length,liveVerified:false}));return;
  }
  if(mode==='check'){
    requireValue(args.length===1,'check requires a release ID.');const release=loadRelease(stateDir,args[0]);
    console.log(JSON.stringify({intact:true,id:release.id,revision:release.revision,liveVerified:false}));return;
  }
  requireValue(mode==='deploy'&&args.length===1||mode==='rollback'&&args.length===0||mode==='verify'&&args.length===1,'Use prepare, check, deploy, rollback or verify.');
  const io=dockerIO();
  const result=mode==='verify'?await verifyRelease(loadRelease(stateDir,args[0]),io):await applyRelease({stateDir,id:args[0],rollback:mode==='rollback'},io);
  console.log(JSON.stringify(result,null,2));if(!result.ready)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{
  // Compose/inspect stderr may contain rendered credentials. Never echo it.
  console.error(error instanceof ReleaseError?error.message:'Release operation failed; no new release is accepted. Check the private bundle/pending journal and Docker availability. No credentials were printed.');process.exitCode=1;
});
