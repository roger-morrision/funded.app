// Only public browser configuration belongs in the release artifact.
// Never copy the environment: it also contains RPC, storage and signing secrets.
export function browserReleaseIdentity(env = {}) {
  const value = name => String(env[name] || '').trim();
  return {
    routerProgram: value('VITE_FUNDED_FEE_ROUTER_PROGRAM_ID'),
    fundedMint: value('VITE_FUNDED_TOKEN_MINT'),
    fundedPool: value('VITE_FUNDED_SWAP_POOL'),
    tradeFeeRecipient: value('VITE_FUNDED_TRADE_FEE_OWNER'),
    tradeFeeBps: value('VITE_FUNDED_TRADE_FEE_BPS') || '100',
    apiBase: value('VITE_API_BASE_URL') || '/',
  };
}
