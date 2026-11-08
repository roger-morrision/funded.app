import {createHash} from 'node:crypto';
import { SOLANA_GENESIS } from '../solana-network.js';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { readProgramDataEvidence } from '../server/program-data-evidence.mjs';
import {loadMainnetConfig} from './mainnet-config.mjs';
import {reviewedMainnetManifest} from '../mainnet-program.js';

const UPGRADEABLE_LOADER = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const PUBLIC_MAINNET_RPCS = new Set([new URL(clusterApiUrl('mainnet-beta')).hostname, 'api.mainnet.solana.com']);

function validPublicKey(value) {
  try { return new PublicKey(String(value || '').trim()).toBase58(); }
  catch { return null; }
}

function validProductionRpc(value) {
  if(/REPLACE|PLACEHOLDER/i.test(String(value||'')))return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password
      && !PUBLIC_MAINNET_RPCS.has(url.hostname)
      && !/^(localhost|127\.|\[::1\])|devnet|testnet/i.test(url.hostname);
  } catch { return false; }
}

function endpointIdentity(value,{database=false}={}) {
  try {const url=new URL(value);
    if(database&&!['postgres:','postgresql:'].includes(url.protocol))return null;
    return `${url.hostname.toLowerCase()}:${url.port||(database?'5432':url.protocol==='https:'?'443':'80')}${url.pathname}`;
  } catch {return null;}
}

export function assessMainnetConfig(env) {
  const layout=env.MAINNET_PROGRAM_LAYOUT||'legacy-three-role',merged=layout==='merged-v3';
  const cluster = String(env.VITE_SOLANA_CLUSTER || '').trim();
  const serverCluster = String(env.SOLANA_CLUSTER || cluster).trim();
  const routerId = validPublicKey(merged?env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID:env.FUNDED_FEE_ROUTER_PROGRAM_ID);
  const clientRouterId = validPublicKey(env.VITE_FUNDED_FEE_ROUTER_PROGRAM_ID);
  const hash = String((merged?env.FUNDED_V3_PROGRAM_DATA_SHA256:env.FUNDED_REWARD_PROGRAM_DATA_SHA256) || '').trim().toLowerCase();
  const authority = validPublicKey(env.MAINNET_APPROVED_UPGRADE_AUTHORITY);
  const immutable = String(env.MAINNET_APPROVED_IMMUTABLE_PROGRAM || '').toLowerCase() === 'true';
  const checks = {
    programLayout:['merged-v3','legacy-three-role'].includes(layout),
    mergedProgramIdentity:!merged||Boolean(routerId&&env.FUNDED_DEVELOPER_LOCK_PROGRAM_ID===routerId
      &&env.FUNDED_DEVELOPER_LOCK_PROGRAM_DATA_SHA256===hash
      &&(!env.FUNDED_FEE_ROUTER_PROGRAM_ID||env.FUNDED_FEE_ROUTER_PROGRAM_ID===routerId)
      &&(!env.FUNDED_REWARD_PROGRAM_DATA_SHA256||env.FUNDED_REWARD_PROGRAM_DATA_SHA256===hash)),
    cluster: cluster === 'mainnet-beta' && serverCluster === cluster
      && String(env.VITE_EXPLORE_CLUSTER || cluster)===cluster,
    stagingReadOnly: env.VITE_MAINNET_READ_ONLY==='true',
    stagingOrigin:validProductionRpc(env.MAINNET_APP_ORIGIN)&&new URL(env.MAINNET_APP_ORIGIN).origin===env.MAINNET_APP_ORIGIN,
    developmentWalletDisabled: !['VITE_DEV_MODE','VITE_DEV_AUTOCONNECT','DEV_WALLET_ENABLED'].some(key=>['true','1','yes','on'].includes(String(env[key]||'').trim().toLowerCase())),
    tradingFeeOnePercent: String(env.VITE_FUNDED_TRADE_FEE_BPS || '100')==='100',
    configuredTradeRecipient: Boolean(validPublicKey(env.FUNDED_TRADE_FEE_OWNER) && env.FUNDED_TRADE_FEE_OWNER===env.VITE_FUNDED_TRADE_FEE_OWNER),
    v3RouterConfigured: Boolean(validPublicKey(env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID) && /^[a-f0-9]{64}$/.test(env.FUNDED_V3_PROGRAM_DATA_SHA256 || '')),
    developerEscrowConfigured: Boolean(validPublicKey(env.FUNDED_DEVELOPER_LOCK_PROGRAM_ID) && /^[a-f0-9]{64}$/.test(env.FUNDED_DEVELOPER_LOCK_PROGRAM_DATA_SHA256 || '')),
    fundedMintConfigured: Boolean(validPublicKey(env.FUNDED_TOKEN_MINT) && env.FUNDED_TOKEN_MINT===env.VITE_FUNDED_TOKEN_MINT),
    durableMetadata: env.METADATA_STORAGE==='pinata' && Boolean(env.PINATA_JWT_FILE)
      && !/REPLACE|PLACEHOLDER/i.test(env.PINATA_JWT_FILE),
    writeGuardStillDisabled: String(env.VITE_ALLOW_MAINNET || 'false').toLowerCase() !== 'true',
    dedicatedHttpsRpc: validProductionRpc(env.SOLANA_RPC_URL),
    routerIdentity: Boolean(routerId && routerId === clientRouterId),
    approvedRouterHash: /^[0-9a-f]{64}$/.test(hash),
    approvedUpgradeAuthority: Boolean(authority) && !immutable,
    persistentDatabase: /^postgres(?:ql)?:\/\//.test(String(env.DATABASE_URL || '')) && !String(env.FUNDED_STORE_PATH || '').trim(),
    isolatedDatabase: Boolean(env.DATABASE_URL && env.DEVNET_DATABASE_URL && endpointIdentity(env.DATABASE_URL,{database:true}) && endpointIdentity(env.DEVNET_DATABASE_URL,{database:true}) && endpointIdentity(env.DATABASE_URL,{database:true})!==endpointIdentity(env.DEVNET_DATABASE_URL,{database:true})),
    isolatedRpc: Boolean(env.SOLANA_RPC_URL && env.DEVNET_SOLANA_RPC_URL && endpointIdentity(env.DEVNET_SOLANA_RPC_URL) && endpointIdentity(env.SOLANA_RPC_URL)!==endpointIdentity(env.DEVNET_SOLANA_RPC_URL)),
  };
  return { checks, configurationComplete: Object.values(checks).every(Boolean), routerId, authority, immutable, hash,layout };
}

export function mainnetProgramRoles(env,config){
  const roles=[['v3-router',env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID,env.FUNDED_V3_PROGRAM_DATA_SHA256],
    ['developer-escrow',env.FUNDED_DEVELOPER_LOCK_PROGRAM_ID,env.FUNDED_DEVELOPER_LOCK_PROGRAM_DATA_SHA256]];
  if(config.layout!=='merged-v3')roles.unshift(['reward-router',config.routerId,config.hash]);
  return roles;
}

async function withTimeout(promise, milliseconds = 12000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('RPC read timed out')), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

export async function readMainnetProgramEvidence(env, config, {connectionFactory=(url,options)=>new Connection(url,options)}={}) {
  if (!config.configurationComplete) {
    return { status:'blocked', reason:'Complete the isolated read-only configuration and program approvals before online reads.' };
  }
  try {
    const rpcOptions={commitment:'finalized',disableRetryOnRateLimit:true,fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.any([AbortSignal.timeout(12000),...(options?.signal?[options.signal]:[])])})};
    const configured = connectionFactory(env.SOLANA_RPC_URL, rpcOptions);
    const official = connectionFactory(clusterApiUrl('mainnet-beta'), rpcOptions);
    const [configuredGenesis, officialGenesis] = await withTimeout(Promise.all([configured.getGenesisHash(),official.getGenesisHash()]));
    if(configuredGenesis!==SOLANA_GENESIS['mainnet-beta'] || officialGenesis!==SOLANA_GENESIS['mainnet-beta'])
      return {status:'blocked',reason:'Configured and official RPCs must both match the full Mainnet genesis hash.'};
    const roles=mainnetProgramRoles(env,config),evidenceByProgram=new Map();
    const programs=[];
    for(const [role,programId,hash] of roles){
      // Explicitly use the verified dedicated Mainnet connection. A globally
      // configured Devnet large-account fallback must never enter this check.
      if(!evidenceByProgram.has(programId))evidenceByProgram.set(programId,await withTimeout(readProgramDataEvidence(configured,programId,{rpcUrl:'',cluster:'mainnet-beta'})));
      const program=evidenceByProgram.get(programId);
      const data=program.programData?.data;
      const validHeader=Boolean(data?.length>=45 && data.readUInt32LE(0)===3 && [0,1].includes(data[12]));
      const upgradeAuthority=validHeader && data[12]===1 ? new PublicKey(data.subarray(13,45)).toBase58():null;
      const checks={
        executableUpgradeableProgram:Boolean(program.account?.executable && program.account.owner.equals(UPGRADEABLE_LOADER)),
        validProgramDataHeader:validHeader,
        approvedProgramBytes:program.sha256===hash,
        approvedUpgradeAuthority:validHeader && upgradeAuthority===config.authority && (config.immutable===(upgradeAuthority===null)),
      };
      programs.push({role,programId,status:Object.values(checks).every(Boolean)?'verified':'blocked',checks,
        programDataAddress:program.programDataAddress||null,observedProgramDataSha256:program.sha256||null,upgradeAuthority});
    }
    return {status:programs.every(p=>p.status==='verified')?'verified':'blocked',mainnetGenesis:true,programs};
  } catch {
    return { status:'unavailable', reason:'A finalized Mainnet RPC read failed or timed out.' };
  }
}

export async function readMainnetServicePolicy(env,{fetchImpl=fetch}={}) {
  const config=assessMainnetConfig(env);
  if(!config.configurationComplete)return {status:'blocked',reason:'Complete the isolated Mainnet staging configuration first.'};
  try {
    const response=await fetchImpl(`${env.MAINNET_APP_ORIGIN}/api/service-fees`,{redirect:'error',credentials:'omit',signal:AbortSignal.timeout(12000)});
    if(!response.ok)throw new Error('Unavailable policy');
    const body=await response.json();
    const checks={mainnet:body.cluster==='mainnet-beta',tradingFeeOnePercent:body.policy?.tradeBps===100,
      reviewedTradeRecipient:body.tradeRecipient===env.FUNDED_TRADE_FEE_OWNER,
      policyIntegrity:Number.isSafeInteger(body.revision)&&body.revision>=0&&body.hash===createHash('sha256').update(JSON.stringify({policy:body.policy,revision:body.revision})).digest('hex')};
    return {status:Object.values(checks).every(Boolean)?'verified':'blocked',checks};
  } catch {return {status:'unavailable',reason:'Mainnet service-fee policy could not be verified.'};}
}

export async function mainnetReadinessPreflight(env, { online = false } = {}) {
  const config = assessMainnetConfig(env);
  const onchain = online ? await readMainnetProgramEvidence(env, config)
    : { status:'unavailable', reason:'Offline preflight; run with --online for read-only finalized RPC verification.' };
  return {
    ready:false,
    status:'no-go',
    scope:online ? 'read-only-mainnet-preflight' : 'offline-mainnet-preflight',
    configuration:config.checks,
    configurationComplete:config.configurationComplete,
    programReview:{configured:Boolean(reviewedMainnetManifest()),upgradeableRequired:true,
      status:reviewedMainnetManifest()?'reviewed-manifest-present':'blocked-awaiting-production-identity-and-independent-review'},
    onchain,
    publicPolicy:online?await readMainnetServicePolicy(env):{status:'unavailable',reason:'Offline preflight; saved deployment fee policy was not read.'},
    invariants:{tradingFeeBps:100,creatorBuyCapPercent:20},
    preparedCode:{productionContractFeature:'mainnet-v3-program',productionIdentityRequired:true,
      qaRecoveryExcluded:true,metadataEndpoint:'/api/token-metadata',networkBoundRouterProof:true,
      backendMainnetMutations:'blocked',backendMainnetTransactionSubmission:'blocked'},
    evidenceRequired:['Independent contract and custody review tied to exact program bytes','Devnet finalized state and balance evidence for every financial path','Verified dedicated mainnet program and infrastructure inventory','Capped mainnet canary and rollback approval'],
    remainingCodeGates:['Mainnet launch client and registration', 'Mainnet metadata activation and durable-storage verification',
      'Mainnet fee collection and all payout routes', 'Mainnet market indexing and claim reconciliation',
      'Independent program and custody audit', 'Capped canary and rollback evidence'],
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  let configFile;
  for(let i=0;i<args.length;i++){
    if(args[i]==='--online')continue;
    if(args[i]==='--config'&&args[i+1]&&!args[i+1].startsWith('--')&&!configFile){configFile=args[++i];continue;}
    throw Error('Use [--config FILE] [--online]. Offline mode is the default.');
  }
  const report = await mainnetReadinessPreflight(configFile?loadMainnetConfig(configFile):process.env, { online:args.includes('--online') });
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = 1; // Code paths and operational evidence still block Mainnet activation.
}
