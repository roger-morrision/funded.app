export function normalizeEnvValue(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

export function getRequiredEnv(vars, env = process.env) {
  const result = {};
  const missing = [];

  for (const key of vars) {
    const value = normalizeEnvValue(env[key]);
    if (!value) {
      missing.push(key);
      continue;
    }
    result[key] = value;
  }

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return result;
}

export function validateRuntimeEnv(env = process.env) {
  const mode = normalizeEnvValue(env.NODE_ENV || 'development');
  const cluster = normalizeEnvValue(env.VITE_SOLANA_CLUSTER || 'devnet');
  const apiBaseUrl = normalizeEnvValue(env.VITE_API_BASE_URL || '/');
  const allowMainnet = normalizeEnvValue(env.VITE_ALLOW_MAINNET || 'false');
  const devMode = normalizeEnvValue(env.VITE_DEV_MODE || 'false');

  if (cluster !== 'devnet' && cluster !== 'mainnet-beta' && cluster !== 'testnet') {
    throw new Error(`Unsupported Solana cluster: ${cluster}`);
  }

  if (allowMainnet !== 'true' && allowMainnet !== 'false') {
    throw new Error('VITE_ALLOW_MAINNET must be true or false');
  }

  if (devMode !== 'true' && devMode !== 'false') {
    throw new Error('VITE_DEV_MODE must be true or false');
  }

  if (cluster === 'devnet' && !apiBaseUrl) {
    throw new Error('VITE_API_BASE_URL is required for the devnet browser build');
  }

  if (mode === 'production' && devMode === 'true') {
    throw new Error('Production builds cannot enable VITE_DEV_MODE');
  }

  return {
    mode,
    cluster,
    apiBaseUrl,
    allowMainnet: allowMainnet === 'true',
    devMode: devMode === 'true',
  };
}

export function getSafeEnvSnapshot(env = process.env) {
  const snapshot = {};
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith('VITE_') && !key.startsWith('FUNDED_') && !key.startsWith('API_')) continue;
    const redacted = /SECRET|TOKEN|KEY|PASSWORD|PRIVATE/i.test(key)
      ? '[REDACTED]'
      : value;
    snapshot[key] = redacted;
  }
  return snapshot;
}
