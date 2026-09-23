export const isKeeperEnabled = env => env.SOLANA_KEEPER_CONFIGURED === 'true';

export function buildProductionReadiness(env = {}) {
  const present = value => typeof value === 'string' && value.trim().length > 0;
  const cluster = String(env.VITE_SOLANA_CLUSTER || env.SOLANA_CLUSTER || 'devnet').trim();
  let productionRpcConfigured = false;
  try {
    const url = new URL(env.SOLANA_RPC_URL);
    productionRpcConfigured = cluster === 'mainnet-beta' && url.protocol === 'https:'
      && !/localhost|127\.|\[::1\]|devnet|testnet/i.test(url.hostname);
  } catch { /* Configuration diagnostics never probe an arbitrary URL. */ }
  const checks = [
    ['feeRouterProgram', present(env.FUNDED_FEE_ROUTER_PROGRAM_ID) || present(env.VITE_FUNDED_FEE_ROUTER_PROGRAM_ID)],
    ['productionRpc', productionRpcConfigured],
    ['keeper', isKeeperEnabled(env) && present(env.SOLANA_KEEPER_SECRET_KEY)],
    ['persistentStore', present(env.DATABASE_URL) && !present(env.FUNDED_STORE_PATH)],
    ['marketProvider', present(env.BIRDEYE_API_KEY)],
    ['rewardProgram', present(env.FUNDED_REWARD_PROGRAM_ID)],
    ['communityVault', present(env.FUNDED_COMMUNITY_VAULT_PROGRAM_ID)],
    ['xAttestation', present(env.X_ATTESTATION_SECRET)],
  ].map(([id, configured]) => ({ id, configured, ready: false, status: configured ? 'configured-unverified' : 'missing' }));
  const missing = checks.filter(check => !check.configured).map(check => check.id);
  return { ready: false, status: 'blocked', configurationComplete: missing.length === 0,
    verification: 'unavailable', scope: 'configuration-only', cluster, checks, missing,
    reason: 'Configuration presence does not verify RPC identity, deployed programs, custody, funding, persistence or successful settlement. Production activation requires separate live evidence and review.',
    generatedAt: new Date().toISOString() };
}
