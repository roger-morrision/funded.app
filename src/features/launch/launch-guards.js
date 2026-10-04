export function validateLaunchInput(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Launch input is required.');
  }

  const required = ['name', 'ticker', 'creatorWallet'];
  for (const field of required) {
    if (!data[field]) {
      throw new Error(`Launch input missing required field: ${field}`);
    }
  }

  if (String(data.name).trim().length < 2) {
    throw new Error('Launch name must be at least 2 characters long.');
  }

  if (String(data.ticker).trim().length < 2 || String(data.ticker).trim().length > 10) {
    throw new Error('Ticker length must be between 2 and 10 characters.');
  }

  return true;
}

export const LAUNCH_POLICY_DEFAULTS = {
  communityReserve: 0.03,
  creatorWalletShare: 0.8,
  failClosed: true,
};
