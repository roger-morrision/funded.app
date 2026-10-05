export function assertWalletConnected(wallet) {
  if (!wallet || !wallet.publicKey) {
    throw new Error('Wallet is not connected. Please connect a supported wallet first.');
  }

  return wallet;
}

export function assertWalletNetwork(wallet, expectedCluster) {
  const connectedWallet = assertWalletConnected(wallet);
  const cluster = expectedCluster || 'devnet';

  if (!connectedWallet.adapter || !connectedWallet.adapter.network) {
    return connectedWallet;
  }

  if (connectedWallet.adapter.network !== cluster) {
    throw new Error(`Wallet is connected to ${connectedWallet.adapter.network}, but this action requires ${cluster}.`);
  }

  return connectedWallet;
}

export function assertUserActionAllowed(featureName, flag, { enabled = true } = {}) {
  if (!enabled || !flag) {
    throw new Error(`${featureName} is unavailable or disabled for this session.`);
  }

  return true;
}

export function assertNoDevModeInProduction({ isProduction, devMode }) {
  if (isProduction && devMode) {
    throw new Error('Developer mode is disabled in production.');
  }

  return true;
}

export function getWalletActionSummary(actionName, wallet, { network, displayName } = {}) {
  const walletAddress = wallet?.publicKey?.toString?.() || 'unknown';
  return {
    action: actionName,
    walletAddress,
    network: network || 'unknown',
    displayName: displayName || 'wallet action',
    createdAt: new Date().toISOString(),
  };
}
