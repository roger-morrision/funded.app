export function validateRewardClaim({ wallet, amount, network, featureEnabled }) {
  if (!wallet || !wallet.publicKey) {
    throw new Error('Reward claim requires an active wallet connection.');
  }

  if (!featureEnabled) {
    throw new Error('Reward feature is disabled for this session.');
  }

  if (!amount || Number(amount) <= 0) {
    throw new Error('Reward amount must be greater than zero.');
  }

  if (network && wallet?.adapter?.network && wallet.adapter.network !== network) {
    throw new Error(`Reward claim requires wallet network ${network}.`);
  }

  return true;
}

export const REWARD_POLICY_DEFAULTS = {
  minRewardAmount: 0,
  claimWindowHours: 72,
  failClosed: true,
};
