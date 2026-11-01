import test from 'node:test';
import assert from 'node:assert/strict';
import {applyRpcGatewayConfig,applyRpcGatewayRedisConfig} from '../server/rpc-gateway-config.mjs';
import {createSolanaRpcProxy} from '../server/rpc-proxy.mjs';
const revision='a'.repeat(40);
test('only the gateway receives the provider secret and existing financial policies remain unchanged',()=>{
  const input={services:{app:{image:'old',environment:{SOLANA_RPC_URL_FILE:'/run/secrets/solana_rpc_url',
    FUNDED_V3_PROGRAM_DATA_SHA256:'b'.repeat(64),FUNDED_V3_AUTO_SETTLEMENT_ENABLED:'true',FUNDED_DEVNET_QA_MINIMUMS_ENABLED:'false'},
    secrets:[{source:'solana_rpc_url'},{source:'funded_router_authority_secret_key'},{source:'funded_api_token'}],networks:{default:{}},depends_on:{db:{condition:'service_healthy'}}},
    'agency-buyback-worker':{environment:{SOLANA_RPC_URL:'https://private.invalid/?api-key=secret'},secrets:['solana_devnet_rpc_url','funded_router_authority_secret_key']},
    db:{image:'postgres'},tunnel:{image:'tunnel'}},secrets:{solana_rpc_url:{file:'provider-secret'},funded_api_token:{file:'api-secret'}}};
  const before=structuredClone(input),result=applyRpcGatewayConfig(input,{image:'exact-image',revision,upstreamFile:'upstream-secret'});
  assert.deepEqual(input,before);assert.deepEqual(result.services.db,input.services.db);assert.deepEqual(result.services.tunnel,input.services.tunnel);
  assert.equal(result.services.app.environment.SOLANA_RPC_URL,'http://rpc-gateway:8899');
  assert.equal(result.services.app.environment.SOLANA_RPC_URL_FILE,undefined);assert.equal(result.services.app.environment.FUNDED_PROGRAM_EVIDENCE_RPC_URL,'');
  assert.equal(result.services.app.environment.FUNDED_V3_PROGRAM_DATA_SHA256,'b'.repeat(64));
  assert.equal(result.services.app.environment.FUNDED_V3_AUTO_SETTLEMENT_ENABLED,'true');assert.equal(result.services.app.environment.FUNDED_DEVNET_QA_MINIMUMS_ENABLED,'false');
  assert.deepEqual(result.services.app.secrets,[{source:'funded_router_authority_secret_key'},{source:'funded_api_token'}]);
  assert.deepEqual(result.services['agency-buyback-worker'].secrets,['funded_router_authority_secret_key']);
  assert.equal(result.services.app.depends_on.db.condition,'service_healthy');assert.equal(result.services.app.depends_on['rpc-gateway'].condition,'service_healthy');
  const gateway=result.services['rpc-gateway'];assert.deepEqual(gateway.secrets,[{source:'rpc_gateway_upstream',target:'rpc_gateway_upstream'}]);
  assert.equal(gateway.user,'node');assert.equal(gateway.read_only,true);assert.equal(gateway.environment.SOLANA_RPC_URL,undefined);
  assert.deepEqual(gateway.ports.map(row=>row.target),[8899,8900]);assert(gateway.ports.every(row=>row.host_ip==='127.0.0.1'));
  assert(!JSON.stringify(result.services.app).includes('private.invalid'));
});

test('Redis deployment changes only the gateway and persists an isolated bounded cache',()=>{
  const input={services:{app:{image:'preserved',environment:{financialPolicy:'unchanged'}},
    'rpc-gateway':{image:'old',environment:{SOLANA_CLUSTER:'devnet'},networks:{default:{}},secrets:['provider']},
    'fee-collector':{image:'preserved-worker'}},networks:{default:{}}};
  const before=structuredClone(input),result=applyRpcGatewayRedisConfig(input,{image:'exact-gateway',revision});
  assert.deepEqual(input,before);assert.deepEqual(result.services.app,input.services.app);
  assert.deepEqual(result.services['fee-collector'],input.services['fee-collector']);
  const gateway=result.services['rpc-gateway'],redis=result.services['rpc-cache'];
  assert.equal(gateway.image,'exact-gateway');assert.deepEqual(gateway.secrets,['provider']);
  assert.equal(gateway.environment.FUNDED_RPC_REDIS_URL,'redis://rpc-cache:6379');
  assert.equal(result.networks['rpc-cache'].internal,true);assert.deepEqual(redis.networks,{'rpc-cache':{}});
  assert.equal(redis.ports,undefined);assert.equal(redis.secrets,undefined);assert.equal(redis.mem_limit,'256m');
  assert(redis.command.includes('allkeys-lru'));assert(redis.command.includes('128mb'));
  assert.equal(redis.volumes[0].source,'rpc_cache_data');assert(result.volumes.rpc_cache_data);
  assert(gateway.networks.default);assert.equal(gateway.depends_on['rpc-cache'].condition,'service_started');
  assert.equal(gateway.depends_on['rpc-cache'].required,false);
});

test('the browser proxy keeps its public limits and delegates raw caching to the central gateway',async()=>{
  let calls=0,charges=0;
  const proxy=createSolanaRpcProxy({centralized:true,store:{chargeRpcRate:async()=>{charges++;return true;}},
    solanaRpcUrl:'http://rpc-gateway:8899',body:async req=>req.body,authorized:()=>false,clientKey:()=> 'client',
    rpcMethods:new Set(['getBalance']),json:(_res,status,body)=>({status,body}),
    fetch:async(_url,options)=>{calls++;const request=JSON.parse(options.body);return Response.json({jsonrpc:'2.0',id:request.id,result:calls});}}).proxySolanaRpc;
  const request=id=>proxy({url:'/api/solana/rpc',headers:{},body:{jsonrpc:'2.0',id,method:'getBalance',params:['11111111111111111111111111111111']}},{});
  assert.equal((await request(1)).body.result,1);assert.equal((await request(2)).body.result,2);
  assert.equal(calls,2);assert.equal(charges,2);
});
