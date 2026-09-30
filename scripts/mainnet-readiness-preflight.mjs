import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { readProgramDataEvidence } from '../server/automatic-reward-chain.mjs';

const UPGRADEABLE_LOADER = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const PUBLIC_MAINNET_RPC = 'api.mainnet.solana.com';

function validPublicKey(value) {
  try { return new PublicKey(String(value || '').trim()).toBase58(); }
  catch { return null; }
}

function validProductionRpc(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password
      && url.hostname !== PUBLIC_MAINNET_RPC
      && !/^(localhost|127\.|\[::1\])|devnet|testnet/i.test(url.hostname);
  } catch { return false; }
}

export function assessMainnetConfig(env) {
  const cluster = String(env.VITE_SOLANA_CLUSTER || '').trim();
  const serverCluster = String(env.SOLANA_CLUSTER || cluster).trim();
  const routerId = validPublicKey(env.FUNDED_FEE_ROUTER_PROGRAM_ID);
  const clientRouterId = validPublicKey(env.VITE_FUNDED_FEE_ROUTER_PROGRAM_ID);
  const hash = String(env.FUNDED_REWARD_PROGRAM_DATA_SHA256 || '').trim().toLowerCase();
  const authority = validPublicKey(env.MAINNET_APPROVED_UPGRADE_AUTHORITY);
  const immutable = String(env.MAINNET_APPROVED_IMMUTABLE_PROGRAM || '').toLowerCase() === 'true';
  const checks = {
    cluster: cluster === 'mainnet-beta' && serverCluster === cluster,
    writeGuardStillDisabled: String(env.VITE_ALLOW_MAINNET || 'false').toLowerCase() !== 'true',
    dedicatedHttpsRpc: validProductionRpc(env.SOLANA_RPC_URL),
    routerIdentity: Boolean(routerId && routerId === clientRouterId),
    approvedRouterHash: /^[0-9a-f]{64}$/.test(hash),
    approvedUpgradeAuthority: Boolean(authority) !== immutable,
    persistentDatabase: Boolean(String(env.DATABASE_URL || '').trim()) && !String(env.FUNDED_STORE_PATH || '').trim(),
  };
  return { checks, configurationComplete: Object.values(checks).every(Boolean), routerId, authority, immutable, hash };
}

async function withTimeout(promise, milliseconds = 12000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('RPC read timed out')), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

export async function readMainnetProgramEvidence(env, config) {
  if (!config.checks.dedicatedHttpsRpc || !config.routerId || !config.checks.approvedRouterHash || !config.checks.approvedUpgradeAuthority) {
    return { status:'blocked', reason:'Complete public RPC and router approvals before online reads.' };
  }
  try {
    const configured = new Connection(env.SOLANA_RPC_URL, 'finalized');
    const official = new Connection(clusterApiUrl('mainnet-beta'), 'finalized');
    const [configuredGenesis, officialGenesis, program] = await withTimeout(Promise.all([
      configured.getGenesisHash(), official.getGenesisHash(), readProgramDataEvidence(configured, config.routerId),
    ]));
    const data = program.programData?.data;
    const upgradeAuthority = data?.length >= 45 && data.readUInt32LE(0) === 3 && data[12] === 1
      ? new PublicKey(data.subarray(13, 45)).toBase58() : null;
    const checks = {
      mainnetGenesis: configuredGenesis === officialGenesis,
      executableUpgradeableProgram: Boolean(program.account?.executable && program.account.owner.equals(UPGRADEABLE_LOADER)),
      approvedProgramBytes: program.sha256 === config.hash,
      approvedUpgradeAuthority: upgradeAuthority === config.authority && (config.immutable === (upgradeAuthority === null)),
    };
    return { status:Object.values(checks).every(Boolean) ? 'verified' : 'blocked', checks,
      programId:config.routerId, programDataAddress:program.programDataAddress || null,
      observedProgramDataSha256:program.sha256 || null, upgradeAuthority };
  } catch {
    // Do not echo an RPC URL, API token, response body, or other credentials.
    return { status:'unavailable', reason:'A finalized Mainnet RPC read failed or timed out.' };
  }
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
    onchain,
    remainingCodeGates:['Mainnet launch client and registration', 'Mainnet metadata and image storage',
      'Mainnet fee collection and all payout routes', 'Mainnet market indexing and claim reconciliation',
      'Independent program and custody audit', 'Capped canary and rollback evidence'],
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--online')) throw new Error('Only --online is supported. Offline mode is the default.');
  const report = await mainnetReadinessPreflight(process.env, { online:args.includes('--online') });
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = 1; // Code paths and operational evidence still block Mainnet activation.
}
