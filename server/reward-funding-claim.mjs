import { solToLamports } from './settlement-rewards.mjs';

const SOURCES = {
  holder:{ suffix:'holders', kind:'holder', amount:row => row.creatorDestinations?.holderAirdrop },
  operations:{ suffix:'operations', kind:'operations', amount:row => row.fundedApp?.operations },
  'community-reserve':{ suffix:'community', kind:'community-reserve', amount:row => row.fundedApp?.community },
};

export function verifiedRewardFundingRequests({ mint, wallet, launch, collections = {}, settlements = {}, rewardState = {},
  operationsRecipient, statuses = ['pending','awaiting-creator-signature','executing','verification-pending','funding','funded'] }) {
  if (!launch?.onchainVerified || launch.mint !== mint || launch.creatorWallet !== wallet
    || launch.pumpFeeRoute?.scope !== 'per-mint-v2' || launch.pumpFeeRoute.router !== launch.creator) return [];
  return Object.values(rewardState.fundingRequests || {}).filter(request => {
    const source = SOURCES[request.kind];
    if (!source || request.mint !== mint || request.asset !== 'SOL' || !statuses.includes(request.status)
      || request.id !== `${request.sourceSignature}:${source.suffix}` || !/^\d+$/.test(String(request.amount))
      || BigInt(request.amount) <= 0n) return false;
    const collection = collections[request.sourceSignature];
    if (collection?.mint !== mint || collection.router !== launch.creator || collection.status !== 'collected'
      || collection.attribution !== 'mint-verified' || collection.onchainVerified !== true
      || collection.cluster !== launch.cluster) return false;
    const settlement = settlements[request.sourceSignature];
    if (!settlement) return false;
    let expected;
    try { expected = solToLamports(source.amount(settlement)); } catch { return false; }
    if (expected !== String(request.amount)) return false;
    return request.kind === 'operations' ? Boolean(operationsRecipient && request.recipient === operationsRecipient)
      : request.recipient === null;
  }).sort((a, b) => a.id.localeCompare(b.id));
}
