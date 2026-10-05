export function createWalletState(wallet = {}) {
  return {
    connected: Boolean(wallet?.publicKey),
    address: wallet?.publicKey?.toString ? wallet.publicKey.toString() : null,
    network: wallet?.adapter?.network || null,
    namespace: wallet?.adapter?.name || 'unknown-wallet',
    isReady: Boolean(wallet?.publicKey && wallet?.adapter),
    updatedAt: new Date().toISOString(),
  };
}

export function getWalletSummary(wallet) {
  const state = createWalletState(wallet);
  return {
    connected: state.connected,
    address: state.address,
    network: state.network,
    ready: state.isReady,
    summary: state.connected ? `Wallet ${state.address} is connected on ${state.network || 'unknown network'}.` : 'Wallet is not connected.',
  };
}
