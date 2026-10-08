import { randomBytes } from 'node:crypto';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { PublicKey } from '@solana/web3.js';

export const CREATOR_CLAIM_MIN_LAMPORTS = 10_000_000n;
const LIFETIME_MS = 5 * 60_000;

export function verifiedCreatorRequests({ mint, wallet, launch, collections = {}, settlements = {}, rewardState = {}, statuses = ['claimable'] }) {
  if (!launch?.onchainVerified || launch.mint !== mint || launch.creatorWallet !== wallet || launch.pumpFeeRoute?.scope !== 'per-mint-v2' || launch.pumpFeeRoute.router !== launch.creator) return [];
  return Object.values(rewardState.fundingRequests || {}).filter(request => {
    const collection = collections[request.sourceSignature];
    const settlement = settlements[request.sourceSignature];
    const allocated = Math.round(Number(settlement?.creatorDestinations?.creatorWallet) * 1_000_000_000);
    return request.kind === 'creator' && request.asset === 'SOL' && request.mint === mint && request.recipient === wallet && statuses.includes(request.status)
      && request.id === `${request.sourceSignature}:creator` && /^\d+$/.test(String(request.amount)) && BigInt(request.amount) > 0n
      && collection?.mint === mint && collection?.router === launch.creator && collection?.status === 'collected' && collection?.attribution === 'mint-verified'
      && collection?.onchainVerified === true && collection?.cluster === launch.cluster && Number.isSafeInteger(allocated)
      && String(allocated) === String(request.amount);
  }).sort((a, b) => a.id.localeCompare(b.id));
}

export function claimableCreatorRequests(input) { return verifiedCreatorRequests(input); }

export function creatorClaimStatus(input) {
  const requests = claimableCreatorRequests(input);
  const claimableLamports = requests.reduce((sum, row) => sum + BigInt(row.amount), 0n);
  const pending = verifiedCreatorRequests({ ...input, statuses:['awaiting-creator-signature','verification-pending','executing'] });
  return { claimableLamports: String(claimableLamports), pendingLamports:String(pending.reduce((sum,row)=>sum+BigInt(row.amount),0n)),
    minimumLamports: String(CREATOR_CLAIM_MIN_LAMPORTS), eligible: claimableLamports >= CREATOR_CLAIM_MIN_LAMPORTS,
    requestIds: requests.map(row => row.id), pendingCount:pending.length };
}

export function creatorClaimBatch(input) {
  const claimable = claimableCreatorRequests(input);
  const pending = verifiedCreatorRequests({ ...input, statuses:['awaiting-creator-signature','verification-pending','executing'] });
  const newAmount = claimable.reduce((sum,row)=>sum+BigInt(row.amount),0n);
  const selected = newAmount >= CREATOR_CLAIM_MIN_LAMPORTS ? [...pending,...claimable] : pending;
  return { eligible:selected.length > 0, claimableLamports:String(selected.reduce((sum,row)=>sum+BigInt(row.amount),0n)),
    requestIds:selected.map(row=>row.id).sort() };
}

export function createCreatorFeeChallenges() {
  const challenges = new Map();
  return {
    prepare({ mint, wallet, status, origin }) {
      for (const [id, row] of challenges) if (row.expiresAtMs <= Date.now()) challenges.delete(id);
      if (!status.eligible) throw new Error('Creator fees have not reached the 0.01 SOL minimum.');
      const challengeId = randomBytes(24).toString('base64url');
      const row = { mint, wallet, origin, amount: status.claimableLamports, requestIds: status.requestIds, nonce: randomBytes(24).toString('hex'), expiresAtMs: Date.now() + LIFETIME_MS };
      challenges.set(challengeId, row);
      return { challengeId, statement: statement(row), expiresAt: new Date(row.expiresAtMs).toISOString(), amountLamports: row.amount };
    },
    verify({ challengeId, signature, origin, status }) {
      const row = challenges.get(String(challengeId || ''));
      if (!row || row.origin !== origin || row.expiresAtMs <= Date.now() || !status.eligible || row.amount !== status.claimableLamports
        || JSON.stringify(row.requestIds) !== JSON.stringify(status.requestIds)) return null;
      try {
        const bytes = bs58.decode(String(signature || ''));
        if (bytes.length !== nacl.sign.signatureLength || !nacl.sign.detached.verify(new TextEncoder().encode(statement(row)), bytes, new PublicKey(row.wallet).toBytes())) return null;
      } catch { return null; }
      challenges.delete(challengeId);
      return row;
    },
  };
}

function statement(row) {
  return `funded.vip Solana creator fee claim\nMint: ${row.mint}\nWallet: ${row.wallet}\nAmount: ${row.amount} lamports\nRequests: ${row.requestIds.join(',')}\nNonce: ${row.nonce}`;
}
