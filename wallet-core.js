export function walletAddress(provider) {
  try { return provider?.publicKey?.toBase58?.() || null; } catch { return null; }
}

export function selectWalletProvider(candidates) {
  const providers = [...new Set(candidates)].filter(provider => provider && typeof provider.connect === 'function' && typeof provider.signTransaction === 'function');
  return providers.find(provider => provider.isConnected && walletAddress(provider)) || providers[0] || null;
}

export function selectRememberedWalletProvider(entries, rememberedId) {
  const preferred = entries.find(entry => entry.id === rememberedId)?.provider;
  if (preferred && typeof preferred.connect === 'function' && typeof preferred.signTransaction === 'function') return preferred;
  return selectWalletProvider(entries.map(entry => entry.provider));
}

export function canSignTransactions(provider) {
  return Boolean(provider && provider.isConnected !== false && !provider.readOnly && typeof provider.signTransaction === 'function' && walletAddress(provider));
}

export function walletLaunches(launches, address) {
  return address ? launches.filter(launch => launch?.creatorWallet === address && typeof launch.mint === 'string' && launch.mint.length > 8) : [];
}

export async function connectWalletProvider(provider, options) {
  if (!provider || typeof provider.connect !== 'function') throw new Error('No compatible Solana wallet provider found.');
  const response = await (options === undefined ? provider.connect() : provider.connect(options));
  const address = walletAddress(provider);
  if (!address || !canSignTransactions(provider)) throw new Error('Connected wallet cannot sign transactions.');
  const responseAddress = response?.publicKey?.toBase58?.();
  if (responseAddress && responseAddress !== address) throw new Error('Wallet account changed during connection. Please reconnect.');
  return { provider, publicKey: provider.publicKey };
}
