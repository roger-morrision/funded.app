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

export async function serviceStatus({ cluster, build, database, rpc, settlement,
  timeoutMs = 6000, settlementTimeoutMs = 30000 }) {
  const [storage, network, proof] = await Promise.allSettled([
    probe(database, timeoutMs), probe(rpc, timeoutMs),
    settlement ? probe(settlement, settlementTimeoutMs) : Promise.resolve(null),
  ]);
  const checks = [
    { id: 'storage', status: storage.status === 'fulfilled' && storage.value === true ? 'operational' : 'unavailable' },
    { id: 'network', status: network.status === 'fulfilled' && network.value === GENESIS_HASHES[cluster] && Boolean(GENESIS_HASHES[cluster]) ? 'operational' : network.status === 'fulfilled' ? 'wrong-network' : 'unavailable' },
  ];
  const evidence = proof.status === 'fulfilled' && proof.value?.scope === 'all-recorded-v3-collections'
    ? proof.value : { verified:false, scope:'all-recorded-v3-collections', recorded:0,
      checked:0, reason:'finalized-evidence-unavailable' };
  return { cluster, build, status: checks.every(check => check.status === 'operational') ? 'operational' : 'degraded',
    checks, observedAt: new Date().toISOString(), scope: 'storage-network-and-v3-settlement-evidence',
    settlementVerified: evidence.verified === true, settlementEvidence:evidence,
    mainnetActivationAuthorized: false };
}
