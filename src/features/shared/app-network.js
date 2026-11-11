// The Solana cluster this build serves; server records are accepted only for it.
export const APP_NET = globalThis.process?.env?.VITEST ? 'devnet'
  : (import.meta.env?.VITE_SOLANA_CLUSTER === 'mainnet-beta' ? 'mainnet-beta' : 'devnet');
