export const SOLANA_GENESIS = Object.freeze({
  devnet:'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
  'mainnet-beta':'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
});
export function requireSolanaCluster(cluster) {
  if(!Object.hasOwn(SOLANA_GENESIS,cluster))throw new Error('Unsupported Solana network.');
  return cluster;
}
export async function assertRpcNetwork(connection,cluster,{timeoutMs=10000}={}) {
  requireSolanaCluster(cluster);let timer;
  try {
    const genesis=await Promise.race([connection.getGenesisHash(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Network identity check timed out. No transaction was prepared.')),timeoutMs);})]);
    if(genesis!==SOLANA_GENESIS[cluster])throw new Error('RPC network does not match the selected network. No transaction was prepared.');
    return genesis;
  } finally {clearTimeout(timer);}
}
export function solanaExplorerUrl(kind,address,cluster) {
  requireSolanaCluster(cluster);
  if(!['tx','address'].includes(kind)||!address)throw new Error('Invalid explorer target.');
  return `https://explorer.solana.com/${kind}/${encodeURIComponent(address)}${cluster==='devnet'?'?cluster=devnet':''}`;
}

export function assertQuoteNetwork(quote,cluster) {
  requireSolanaCluster(cluster);
  // Old Devnet quotes may finish their short validity window after an upgrade.
  if(cluster==='devnet'&&quote?.cluster==null&&quote?.genesisHash==null)return;
  if(quote?.cluster!==cluster||quote.genesisHash!==SOLANA_GENESIS[cluster])
    throw new Error('Quote network does not match the selected network. Refresh the quote.');
}
