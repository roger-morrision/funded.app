// These browser-facing routes enforce their own Devnet origin, finalized
// collection, approved program, and wallet signature checks before writing.
const walletSignedV3Path = /^\/api\/tokens\/[1-9A-HJ-NP-Za-km-z]{32,44}\/v3-(?:settlement|community-funding|creator-reward-funding|creator-wallet-payout|referral-payout|operations-payout)\/[1-9A-HJ-NP-Za-km-z]{64,88}(?:\/[1-3])?$/;

export function publicWalletSignedV3Post(path) {
  return walletSignedV3Path.test(path);
}
