const rpcSecrets=new Set(['solana_rpc_url','solana_devnet_rpc_url','solana_holder_index_rpc_url']);
const clients=new Set(['app','fee-collector','buyback-worker','agency-buyback-worker','agency-worker',
  'community-claim-worker','receipt-worker','reward-volume-init','reward-worker','x-post-worker']);

export function applyRpcGatewayConfig(input,{image,revision,upstreamFile}={}){
  if(!input.services?.app||!image||!/^[a-f0-9]{40}$/.test(revision||'')||!upstreamFile)throw Error('An exact app image and upstream secret file are required');
  const config=structuredClone(input),url='http://rpc-gateway:8899';
  config.secrets||={};config.secrets.rpc_gateway_upstream={file:upstreamFile};
  config.services['rpc-gateway']={image,init:true,restart:'unless-stopped',read_only:true,user:'node',cap_drop:['ALL'],
    security_opt:['no-new-privileges:true'],stop_grace_period:'30s',tmpfs:['/tmp'],
    command:['node','scripts/run-rpc-gateway.mjs'],
    environment:{SOLANA_CLUSTER:'devnet',FUNDED_BUILD_ID:revision,FUNDED_RPC_UPSTREAM_URL_FILE:'/run/secrets/rpc_gateway_upstream',PORT:'8899',WS_PORT:'8900'},
    secrets:[{source:'rpc_gateway_upstream',target:'rpc_gateway_upstream'}],
    ports:[{target:8899,published:'8899',host_ip:'127.0.0.1',protocol:'tcp'},
      {target:8900,published:'8900',host_ip:'127.0.0.1',protocol:'tcp'}],
    networks:Object.fromEntries(Object.keys(config.services.app.networks||{default:{}}).map(name=>[name,{}])),
    labels:{'org.opencontainers.image.revision':revision},
    healthcheck:{test:['CMD','node','-e',"fetch('http://127.0.0.1:8899/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"],
      interval:'10s',timeout:'5s',retries:3,start_period:'10s'}};
  for(const [name,service] of Object.entries(config.services)){
    if(!clients.has(name))continue;
    service.environment||={};
    for(const key of ['SOLANA_RPC_URL_FILE','SOLANA_DEVNET_RPC_URL_FILE','SOLANA_HOLDER_INDEX_RPC_URL_FILE','FUNDED_PROGRAM_EVIDENCE_RPC_URL_FILE'])delete service.environment[key];
    Object.assign(service.environment,{SOLANA_RPC_URL:url,SOLANA_DEVNET_RPC_URL:url,SOLANA_HOLDER_INDEX_RPC_URL:url,
      FUNDED_PROGRAM_EVIDENCE_RPC_URL:'',FUNDED_RPC_GATEWAY_ENABLED:'true',FUNDED_RPC_GATEWAY_URL:url,FUNDED_RPC_GATEWAY_WS_URL:'ws://rpc-gateway:8900'});
    if(service.secrets)service.secrets=service.secrets.filter(secret=>!rpcSecrets.has(typeof secret==='string'?secret:secret.source));
    service.depends_on||={};service.depends_on['rpc-gateway']={condition:'service_healthy',required:true};
  }
  return applyRpcGatewayRedisConfig(config);
}

// This overlay changes only the gateway/cache. Existing worker releases,
// frontend mounts, signing secrets and financial policies are preserved.
export function applyRpcGatewayRedisConfig(input,{image,revision}={}){
  if(!input.services?.['rpc-gateway'])throw Error('The central RPC gateway is required');
  if((image||revision)&&(!image||!/^[a-f0-9]{40}$/.test(revision||'')))throw Error('An exact gateway image and revision are required');
  const config=structuredClone(input),gateway=config.services['rpc-gateway'];
  if(image){gateway.image=image;delete gateway.build;gateway.labels={...gateway.labels,'org.opencontainers.image.revision':revision};}
  gateway.environment={...gateway.environment,FUNDED_RPC_REDIS_URL:'redis://rpc-cache:6379',...(revision?{FUNDED_BUILD_ID:revision}:{})};
  gateway.depends_on={...gateway.depends_on,'rpc-cache':{condition:'service_started',required:false}};
  gateway.networks={...(gateway.networks||{default:{}}),'rpc-cache':{}};
  config.services['rpc-cache']={image:'redis:8-alpine',init:true,restart:'unless-stopped',read_only:true,user:'redis',
    cap_drop:['ALL'],security_opt:['no-new-privileges:true'],tmpfs:['/tmp'],mem_limit:'256m',
    command:['redis-server','--bind','0.0.0.0','--protected-mode','no','--dir','/data','--save','',
      '--appendonly','yes','--appendfsync','everysec','--maxmemory','128mb','--maxmemory-policy','allkeys-lru'],
    volumes:[{type:'volume',source:'rpc_cache_data',target:'/data'}],networks:{'rpc-cache':{}},
    healthcheck:{test:['CMD','redis-cli','ping'],interval:'10s',timeout:'3s',retries:3,start_period:'5s'}};
  config.networks={...config.networks,'rpc-cache':{internal:true}};
  config.volumes={...config.volumes,rpc_cache_data:config.volumes?.rpc_cache_data||{}};
  return config;
}
