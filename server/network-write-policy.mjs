import {requireSolanaCluster} from '../solana-network.js';

export function deploymentCluster(env) {
  const server=String(env.SOLANA_CLUSTER || '').trim();
  const client=String(env.VITE_SOLANA_CLUSTER || '').trim();
  if(server && client && server!==client)throw Error('Server and browser Solana networks must match.');
  return requireSolanaCluster(server || client || 'devnet');
}

// Mainnet program flows (launches, fee router, rewards, claims, agency) stay
// blocked. FUNDED_MAINNET_NON_PROGRAM_WRITES=true opens only flows that need no
// Richpad on-chain program: listing burns, SOL boost payments, watchlists,
// follows, favorites, referral identity and token page metadata reads.
export const MAINNET_NON_PROGRAM_POSTS=Object.freeze(new Set([
  '/api/solana/rpc','/api/listings','/api/listings/quote','/api/burn-receipts',
  '/api/boosts/quote','/api/boosts/prepare','/api/boosts/confirm','/api/trade/jupiter/build',
  '/api/watchlist','/api/account-preferences','/api/token-metadata','/api/tokens/metadata','/api/shares/visit',
  '/api/referrals/registration/prepare','/api/referrals/registration/verify',
  '/api/referrals/attribution/prepare','/api/referrals/attribution/verify',
  '/api/referrals/session/prepare','/api/referrals/session/verify','/api/referrals/session/logout',
]));
export const mainnetNonProgramWrites=(env=process.env)=>String(env.FUNDED_MAINNET_NON_PROGRAM_WRITES||'').toLowerCase()==='true';
const MUTATING=new Set(['POST','PUT','PATCH','DELETE']);
export function mainnetMutationBlocked(cluster,method,pathname,env=process.env) {
  requireSolanaCluster(cluster);
  if(cluster!=='mainnet-beta' || ['GET','HEAD','OPTIONS'].includes(method))return false;
  if(method==='POST' && pathname==='/api/solana/rpc')return false;
  return !(mainnetNonProgramWrites(env) && MUTATING.has(method) && MAINNET_NON_PROGRAM_POSTS.has(pathname));
}

export function rpcWriteBlocked(cluster,method,env=process.env) {
  requireSolanaCluster(cluster);
  if(cluster!=='mainnet-beta')return false;
  if(method==='requestAirdrop')return true;
  return method==='sendTransaction' && !mainnetNonProgramWrites(env);
}
const subscriptionMethods=new Set(['accountSubscribe','accountUnsubscribe','logsSubscribe','logsUnsubscribe',
  'programSubscribe','programUnsubscribe','signatureSubscribe','signatureUnsubscribe','slotSubscribe',
  'slotUnsubscribe','rootSubscribe','rootUnsubscribe','slotsUpdatesSubscribe','slotsUpdatesUnsubscribe','ping']);
export function readOnlyRpcSubscription(request) {
  return Boolean(request && !Array.isArray(request) && request.jsonrpc==='2.0'
    && subscriptionMethods.has(request.method) && (request.params===undefined || Array.isArray(request.params)));
}
