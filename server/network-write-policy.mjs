import {requireSolanaCluster} from '../solana-network.js';

export function deploymentCluster(env) {
  const server=String(env.SOLANA_CLUSTER || '').trim();
  const client=String(env.VITE_SOLANA_CLUSTER || '').trim();
  if(server && client && server!==client)throw Error('Server and browser Solana networks must match.');
  return requireSolanaCluster(server || client || 'devnet');
}

// Mainnet is still a read-only preparation environment. Client flags and API
// credentials cannot unlock a backend whose financial release gates are unmet.
export function mainnetMutationBlocked(cluster,method,pathname) {
  requireSolanaCluster(cluster);
  if(cluster!=='mainnet-beta' || ['GET','HEAD','OPTIONS'].includes(method))return false;
  return !(method==='POST' && pathname==='/api/solana/rpc');
}

export function rpcWriteBlocked(cluster,method) {
  requireSolanaCluster(cluster);
  return cluster==='mainnet-beta' && ['sendTransaction','requestAirdrop'].includes(method);
}

const subscriptionMethods=new Set(['accountSubscribe','accountUnsubscribe','logsSubscribe','logsUnsubscribe',
  'programSubscribe','programUnsubscribe','signatureSubscribe','signatureUnsubscribe','slotSubscribe',
  'slotUnsubscribe','rootSubscribe','rootUnsubscribe','slotsUpdatesSubscribe','slotsUpdatesUnsubscribe','ping']);
export function readOnlyRpcSubscription(request) {
  return Boolean(request && !Array.isArray(request) && request.jsonrpc==='2.0'
    && subscriptionMethods.has(request.method) && (request.params===undefined || Array.isArray(request.params)));
}
