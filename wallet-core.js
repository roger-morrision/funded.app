export async function connectWalletProvider(provider) {
  if (!provider || typeof provider.connect !== 'function') throw new Error('No compatible Solana wallet provider found.');
  const response = await provider.connect();
  const publicKey = response?.publicKey || provider.publicKey;
  if (!publicKey || typeof provider.signTransaction !== 'function') throw new Error('Connected wallet cannot sign transactions.');
  return { provider, publicKey };
}
