export function buildProductionReadiness(env = {}) {
  const checks = [
    ['feeRouterProgram', Boolean(env.FUNDED_FEE_ROUTER_PROGRAM_ID || env.VITE_FUNDED_FEE_ROUTER_PROGRAM_ID)],
    ['productionRpc', Boolean(env.SOLANA_RPC_URL && !String(env.SOLANA_RPC_URL).includes('devnet'))],
    ['keeper', Boolean(env.SOLANA_KEEPER_CONFIGURED && env.SOLANA_KEEPER_SECRET_KEY)],
    ['persistentStore', Boolean(env.DATABASE_URL || env.FUNDED_STORE_PATH)],
    ['marketProvider', Boolean(env.BIRDEYE_API_KEY)],
    ['rewardProgram', Boolean(env.FUNDED_REWARD_PROGRAM_ID)],
    ['communityVault', Boolean(env.FUNDED_COMMUNITY_VAULT_PROGRAM_ID)],
    ['xAttestation', Boolean(env.X_ATTESTATION_SECRET)],
  ].map(([id, ready]) => ({ id, ready, status: ready ? 'ready' : 'missing' }));
  const missing = checks.filter(check => !check.ready).map(check => check.id);
  return { ready: missing.length === 0, status: missing.length === 0 ? 'ready' : 'blocked', checks, missing, generatedAt: new Date().toISOString() };
}
