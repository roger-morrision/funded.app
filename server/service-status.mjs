export const GENESIS_HASHES = {
  devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
  'mainnet-beta': '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
};

async function probe(check, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(check),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Probe timed out')), timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}

export async function serviceStatus({ cluster, build, database, rpc, timeoutMs = 6000 }) {
  const [storage, network] = await Promise.allSettled([probe(database, timeoutMs), probe(rpc, timeoutMs)]);
  const checks = [
    { id: 'storage', status: storage.status === 'fulfilled' && storage.value === true ? 'operational' : 'unavailable' },
    { id: 'network', status: network.status === 'fulfilled' && network.value === GENESIS_HASHES[cluster] && Boolean(GENESIS_HASHES[cluster]) ? 'operational' : network.status === 'fulfilled' ? 'wrong-network' : 'unavailable' },
  ];
  return { cluster, build, status: checks.every(check => check.status === 'operational') ? 'operational' : 'degraded',
    checks, observedAt: new Date().toISOString(), scope: 'storage-and-network-only',
    settlementVerified: false, mainnetActivationAuthorized: false };
}
