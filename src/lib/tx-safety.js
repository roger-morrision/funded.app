export function requireTxSafety({ wallet, cluster, featureName, isProduction, devMode, rpcHealthy, hasSimulation }) {
  if (!wallet || !wallet.publicKey) {
    throw new Error('Transaction cannot start without a connected wallet.');
  }

  if (cluster && wallet?.adapter?.network && wallet.adapter.network !== cluster) {
    throw new Error(`Wallet network mismatch: expected ${cluster}, got ${wallet.adapter.network}.`);
  }

  if (isProduction && devMode) {
    throw new Error('Production transactions are blocked when developer mode is enabled.');
  }

  if (!rpcHealthy) {
    throw new Error(`RPC is unhealthy for ${featureName}. Transaction aborted.`);
  }

  if (!hasSimulation) {
    throw new Error(`Pre-flight simulation is required for ${featureName}.`);
  }

  return { ok: true, featureName, createdAt: new Date().toISOString() };
}

export function validateTxPayload(payload, requiredFields = []) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Transaction payload must be an object.');
  }

  for (const field of requiredFields) {
    if (payload[field] === undefined || payload[field] === null || payload[field] === '') {
      throw new Error(`Transaction payload is missing required field: ${field}`);
    }
  }

  return true;
}

export function getTxRiskLevel({ featureName, amount, network }) {
  if (!featureName) return 'unknown';
  if (amount && Number(amount) > 1000000) return 'high';
  if (network === 'mainnet-beta') return 'high';
  return 'medium';
}
