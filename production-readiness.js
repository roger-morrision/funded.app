import {PublicKey} from '@solana/web3.js';
export const isKeeperEnabled = env => env.SOLANA_KEEPER_CONFIGURED === 'true';

export function buildProductionReadiness(env = {}) {
  const present = value => typeof value === 'string' && value.trim().length > 0 && !/REPLACE|PLACEHOLDER/i.test(value);
  const address = value => {try {return present(value)&&new PublicKey(value).toBase58()===value;}catch{return false;}};
  const cluster = String(env.SOLANA_CLUSTER || env.VITE_SOLANA_CLUSTER || 'devnet').trim();
  const matchingNetwork = ['devnet','mainnet-beta'].includes(cluster)
    && (!env.VITE_SOLANA_CLUSTER || env.VITE_SOLANA_CLUSTER===cluster);
  const v3 = address(env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID)&&/^[a-f0-9]{64}$/.test(env.FUNDED_V3_PROGRAM_DATA_SHA256||'');
  let productionRpcConfigured = false;
  try {
    const url = new URL(env.SOLANA_RPC_URL);
    productionRpcConfigured = matchingNetwork && cluster === 'mainnet-beta' && url.protocol === 'https:'
      && !/localhost|127\.|\[::1\]|devnet|testnet/i.test(url.hostname);
  } catch { /* Configuration diagnostics never probe an arbitrary URL. */ }
  const checks = [
    ['matchingNetwork', matchingNetwork],
    ['feeRouterProgram', v3 || address(env.FUNDED_FEE_ROUTER_PROGRAM_ID) || address(env.VITE_FUNDED_FEE_ROUTER_PROGRAM_ID)],
    ['productionRpc', productionRpcConfigured],
    ['keeper', isKeeperEnabled(env) && present(env.SOLANA_KEEPER_SECRET_KEY)],
    ['persistentStore', present(env.DATABASE_URL) && !present(env.FUNDED_STORE_PATH)],
    ['marketProvider', present(env.BIRDEYE_API_KEY)],
    // The merged V3 router owns rewards and community custody; legacy aliases
    // are not missing dependencies when that shared program is configured.
    ['rewardProgram', v3 || address(env.FUNDED_REWARD_PROGRAM_ID)],
    ['communityVault', v3 || address(env.FUNDED_COMMUNITY_VAULT_PROGRAM_ID)],
    ['xAttestation', v3 ? env.FUNDED_V3_X_CLAIMS_ENABLED==='true' && present(env.X_CLIENT_ID)
      && present(env.X_CLIENT_SECRET) && present(env.X_BEARER_TOKEN) : present(env.X_ATTESTATION_SECRET)],
  ].map(([id, configured]) => ({ id, configured, ready: false, status: configured ? 'configured-unverified' : 'missing' }));
  const missing = checks.filter(check => !check.configured).map(check => check.id);
  return { ready: false, status: 'blocked', configurationComplete: missing.length === 0,
    verification: 'unavailable', scope: 'configuration-only', cluster, checks, missing,
    reason: 'Configuration presence does not verify RPC identity, deployed programs, custody, funding, persistence or successful settlement. Production activation requires separate live evidence and review.',
    generatedAt: new Date().toISOString() };
}
