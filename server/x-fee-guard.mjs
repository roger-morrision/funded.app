import { PublicKey } from '@solana/web3.js';
import { validateFeeDistribution } from '../distribution-policy.js';

export function deriveXFeeObligation(state, { mint, claimSignature }) {
  const mintAddress = new PublicKey(String(mint || '')).toBase58();
  const signature = String(claimSignature || '').trim();
  if (!signature) throw new Error('A confirmed fee-collection signature is required.');
  const launch = state.launches?.[mintAddress];
  if (!launch?.onchainVerified || launch.cluster !== 'devnet') throw new Error('A verified Devnet launch policy is required.');
  const route = launch.pumpFeeRoute;
  if (!/^\d{1,24}$/.test(String(launch.xUserId || ''))) throw new Error('The launch has no stable X user ID; a handle alone is not sufficient for a fee claim.');
  if (route?.scope !== 'per-mint-v2' || route?.verified !== true || route.router !== launch.creator) {
    throw new Error('This launch has no isolated, verified per-mint fee router. Shared-router fees cannot be attributed to an X claim.');
  }
  const shares = launch.feeDistribution?.creatorDirected?.shares;
  const recipient = launch.feeDistribution?.creatorDirected?.recipients?.xAccount;
  const validation = validateFeeDistribution({ ...shares, xRecipient: recipient });
  if (!validation.valid || validation.shares.solClaimPercent <= 0) throw new Error('The verified launch policy has no valid X-linked fee share.');
  const collection = state.collections?.[signature];
  if (collection?.status !== 'collected' || collection.mint !== mintAddress || collection.router !== route.router || collection.attribution !== 'mint-verified' || collection.onchainVerified !== true) {
    throw new Error('A mint-attributed, on-chain-verified fee collection is required.');
  }
  const collectedLamports = BigInt(collection.collectedLamports || 0);
  if (collectedLamports <= 0n) throw new Error('The collection contains no creator fees.');
  const shareBps = BigInt(Math.round(validation.shares.solClaimPercent * 100));
  const amountLamports = collectedLamports * shareBps / 10_000n;
  if (amountLamports <= 0n) throw new Error('The X-linked share rounds to zero lamports.');
  const id = `${signature}:${mintAddress}:x`;
  return {
    id, mint: mintAddress, claimSignature: signature, router: route.router,
    recipient, xUserId: launch.xUserId, asset: 'SOL', amountLamports: amountLamports.toString(),
    amountSol: Number(amountLamports) / 1_000_000_000,
    shareBps: Number(shareBps), status: 'claimable-after-x-and-wallet-verification',
    source: 'verified-per-mint-router-collection',
  };
}
