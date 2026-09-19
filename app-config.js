const supportedClusters = new Set(['devnet', 'mainnet-beta']);

export const APP_CLUSTER = String(import.meta.env.VITE_SOLANA_CLUSTER || 'devnet').trim();
if (!supportedClusters.has(APP_CLUSTER)) throw new Error(`Unsupported VITE_SOLANA_CLUSTER: ${APP_CLUSTER}`);

// Keep local Devnet profiles coherent unless an operator explicitly opts the
// discovery feed into another cluster.  Showing mainnet RPC results alongside
// Devnet launch controls is misleading and can cause users to inspect the
// wrong network before signing.
export const EXPLORE_CLUSTER = String(import.meta.env.VITE_EXPLORE_CLUSTER || APP_CLUSTER).trim();
if (!supportedClusters.has(EXPLORE_CLUSTER)) throw new Error(`Unsupported VITE_EXPLORE_CLUSTER: ${EXPLORE_CLUSTER}`);
if (EXPLORE_CLUSTER !== APP_CLUSTER) throw new Error('Explore and trading must use the same Solana cluster.');
const configuredApiBase = String(import.meta.env.VITE_API_BASE_URL || '').trim();
const apiBase = configuredApiBase.replace(/\/$/, '');
const useRpcProxy = String(import.meta.env.VITE_USE_RPC_PROXY || '').toLowerCase() === 'true';
const rpcProxyUrl = useRpcProxy ? '/api/solana/rpc' : (configuredApiBase ? `${apiBase}/api/solana/rpc` : '');
// Keep the Helius credential server-side. A same-origin proxy is preferred for
// browser previews; an explicitly configured API base remains supported for
// deployments where the API is hosted separately.
export const APP_RPC_URL = rpcProxyUrl;
export const EXPLORE_RPC_URL = APP_RPC_URL;

export const APP_IS_MAINNET = APP_CLUSTER === 'mainnet-beta';
export const APP_EXPLORER_QUERY = APP_IS_MAINNET ? '' : `?cluster=${APP_CLUSTER}`;
export const APP_ENVIRONMENT_LABEL = APP_IS_MAINNET ? 'Solana Mainnet' : 'Solana Devnet';
export const APP_ALLOW_MAINNET = String(import.meta.env.VITE_ALLOW_MAINNET || '').toLowerCase() === 'true';

if (APP_IS_MAINNET && !APP_ALLOW_MAINNET) {
  throw new Error('Mainnet is disabled. Set VITE_ALLOW_MAINNET=true only after production review.');
}

export const TRADE_FEE_OWNER = String(import.meta.env.VITE_FUNDED_TRADE_FEE_OWNER || '').trim();
export const TRADE_FEE_BPS = Number(import.meta.env.VITE_FUNDED_TRADE_FEE_BPS || 50);
