import addresses from '../config/deleted-devnet-mints.json' with {type:'json'};

// Minimal exclusion inventory after the user-requested permanent app-data purge.
// These addresses prevent on-chain rediscovery from recreating deleted records.
const deleted=new Set(addresses);
export const isDeletedDevnetMint=(mint,cluster='devnet')=>cluster==='devnet'&&deleted.has(String(mint));
