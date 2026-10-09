// Dependencies and mutable application state are read live through appState.
export function createConnectionsController(appState) {
  // app-source: 135
  function connectionConfig(web3, cluster = appState.APP_CLUSTER){
    return {
      commitment: 'confirmed',
      disableRetryOnRateLimit: true,
      ...(appState.APP_RPC_URL ? { wsEndpoint: web3.clusterApiUrl(cluster).replace(/^http/, 'ws') } : {}),
    };
  }
  // app-source-end

  // app-source: 136
  async function getSolana(){
    if (!appState.solanaModules) {
      const [web3, spl] = await Promise.all([import('@solana/web3.js'), import('@solana/spl-token')]);
      appState.connection = new web3.Connection(appState.APP_RPC_URL || web3.clusterApiUrl(appState.APP_CLUSTER), appState.connectionConfig(web3));
      appState.solanaModules = { ...web3, ...spl };
    }
    return appState.solanaModules;
  }
  // app-source-end

  // app-source: 137
  async function getExploreConnection(){
    const { Connection } = await appState.getSolana();
    if (!appState.exploreConnection) appState.exploreConnection = new Connection(appState.EXPLORE_RPC_URL || (appState.solanaModules.clusterApiUrl ? appState.solanaModules.clusterApiUrl(appState.EXPLORE_CLUSTER) : `https://api.${appState.EXPLORE_CLUSTER}.solana.com`), appState.connectionConfig(appState.solanaModules, appState.EXPLORE_CLUSTER));
    return appState.exploreConnection;
  }
  // app-source-end

  // app-source: 138
  async function fetchTokenAccountSample(mintAddress, rpc, PublicKey){
    const response = await appState.apiRequest(`/api/tokens/${encodeURIComponent(mintAddress)}/token-accounts`, { signal: AbortSignal.timeout(8000) }).catch(() => ({ available: false, data: null }));
    if (response.available && response.data?.cluster === appState.EXPLORE_CLUSTER && Array.isArray(response.data.accounts)) return response.data;
    const result = await rpc.getTokenLargestAccounts(new PublicKey(mintAddress), 'confirmed');
    const rows = Array.isArray(result?.value) ? result.value : [];
    const accounts = rows.filter(row => BigInt(String(row.amount || '0')) > 0n).map(row => ({
      address: row.address.toBase58(), amount: String(row.amount), decimals: Number(row.decimals), uiAmountString: String(row.uiAmountString ?? row.uiAmount ?? ''),
    }));
    return { mint: mintAddress, cluster: appState.EXPLORE_CLUSTER, accounts, count: accounts.length, coverage: rows.length >= 20 ? 'lower-bound' : 'complete-account-list', source: 'browser-rpc-fallback' };
  }
  // app-source-end

  // app-source: 139
  async function getTradePreviewConnection(){
    const { Connection, clusterApiUrl } = await appState.getSolana();
    if (!appState.tradePreviewConnection) appState.tradePreviewConnection = new Connection(appState.APP_RPC_URL ? `${appState.APP_RPC_URL}?purpose=trade-preview` : clusterApiUrl(appState.APP_CLUSTER), appState.connectionConfig(appState.solanaModules));
    return appState.tradePreviewConnection;
  }
  // app-source-end

  return { connectionConfig, getSolana, getExploreConnection, fetchTokenAccountSample, getTradePreviewConnection };
}
