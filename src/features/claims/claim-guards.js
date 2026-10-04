export function validateClaimRequest({ wallet, claimId, network, featureEnabled }) {
  if (!wallet || !wallet.publicKey) {
    throw new Error('Claim request requires a connected wallet.');
  }

  if (!claimId) {
    throw new Error('Claim request is missing claimId.');
  }

  if (!featureEnabled) {
    throw new Error('Claim feature is unavailable.');
  }

  if (network && wallet?.adapter?.network && wallet.adapter.network !== network) {
    throw new Error(`Claim requires wallet network ${network}.`);
  }

  return true;
}
