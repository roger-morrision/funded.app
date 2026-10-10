import { invalidRequest } from '../http-policy.mjs';
import { randomBytes } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { verifyReferralClaim, pendingReferralClaim } from '../referral-claim-state.mjs';
import { allowedAuthOrigin } from '../x-auth.mjs';
import nacl from 'tweetnacl';
import { solToLamports } from '../referral-sol-transfer.mjs';

// Called after the shared request policy, rate limit, and authorization checks.
// Return true only after sending a response; false lets the router continue.
export function createReferralClaimsRoutes({
  body,
  walletKey,
  store,
  id,
  referralClaimExpiryMs,
  route,
  walletSignature,
  referralSession,
  maxReferralPayoutSol,
  devnetTestMode,
  referralPayoutKeypair,
  executeSolPayout,
  reconcileSolPayout,
  respond,
}) {
  const json = (...args) => { respond(...args); return true; };
  const recordPaid = (claimId, amountSol, transfer) => store.updateReferralClaimState(claimId, current => {
    const currentClaim = current.referralClaims[claimId];
    if (!['executing', 'verification-pending'].includes(currentClaim?.status)
      || currentClaim.pendingSignature !== transfer.signature) throw new Error('Referral claim changed during reconciliation.');
    const record = { id: `referral:${claimId}`, claimId, amountSol, ...transfer, status: 'paid',
      paidAt: new Date().toISOString(), source: 'solana-keeper-referral-claim' };
    current.payouts[record.id] = record;
    current.referralClaims[claimId] = { ...currentClaim, status: 'paid', payoutId: record.id,
      payoutSignature: transfer.signature, paidAt: record.paidAt };
    return record;
  });
  return async function handleReferralClaimsRoutes(req, res, url) {
    if (req.method === 'POST' && url.pathname === '/api/referral-claims/prepare') {
      const input = await body(req);
      const settlementSignature = String(input.settlementSignature || '').trim();
      let recipientWallet;
      try { recipientWallet = walletKey(input.recipientWallet); } catch { return json(res, 400, { error: 'A valid recipientWallet is required.' }); }
      const levelNumber = Number(input.level);
      if (!settlementSignature || !recipientWallet || !Number.isInteger(levelNumber)) return json(res, 400, { error: 'settlementSignature, recipientWallet, and level are required.' });
      const claim = await store.update(state => {
        const settlement = state.settlements[settlementSignature];
        const level = settlement?.fundedApp?.referralLevels?.find(item => item.level === levelNumber && item.recipient === recipientWallet && item.status === 'claimable');
        if (!level) throw invalidRequest('No claimable referral reward matches this wallet.');
        const existing = Object.values(state.referralClaims || {}).find(item => item.settlementSignature === settlementSignature && item.level === levelNumber && item.recipientWallet === recipientWallet);
        if (existing) return existing;
        const createdAt = new Date().toISOString(); const created = { id: id('referral_claim'), settlementSignature, level: levelNumber, recipientWallet, amount: level.amount, asset: settlement.asset, nonce: randomBytes(24).toString('hex'), status: 'awaiting-wallet-signature', createdAt, expiresAt: new Date(Date.now() + referralClaimExpiryMs).toISOString() };
        state.referralClaims[created.id] = created;
        return created;
      });
      return json(res, 200, { ...claim, statement: `funded.app referral reward claim ${claim.id} nonce ${claim.nonce}`, expiresInMinutes: 14 * 24 * 60 });
    }

    const referralClaimId = route(url.pathname, req.method, /^\/api\/referral-claims\/([^/]+)\/verify$/);
    if (referralClaimId) {
      const input = await body(req); const state = await store.readReferralClaimState(referralClaimId); const claim = state.referralClaims?.[referralClaimId]; if (!claim) return json(res, 404, { error: 'Referral claim not found.' });
      if (claim.status === 'wallet-verified' || claim.status === 'paid') return json(res, 200, claim);
      if (['executing','verification-pending','failed'].includes(claim.status) || (claim.expiresAt && Date.parse(claim.expiresAt) < Date.now())) return json(res, 409, { error: 'Referral claim is no longer available. Previous attempts need reconciliation.' });
      const publicKey = new PublicKey(walletKey(input.publicKey)); if (publicKey.toBase58() !== claim.recipientWallet) return json(res, 401, { error: 'The claiming wallet must match the referral recipient.' });
      const message = new TextEncoder().encode(`funded.app referral reward claim ${referralClaimId} nonce ${claim.nonce}`); const signature = walletSignature(input.signature);
      if (!nacl.sign.detached.verify(message, signature, publicKey.toBytes())) return json(res, 401, { error: 'Wallet signature is invalid.' });
      const updated = await store.updateReferralClaimState(referralClaimId,current => { current.referralClaims[referralClaimId] = verifyReferralClaim(current.referralClaims[referralClaimId],claim,publicKey.toBase58()); return current.referralClaims[referralClaimId]; }); return json(res, 200, updated);
    }

    const referralExecuteId = route(url.pathname, req.method, /^\/api\/referral-claims\/([^/]+)\/execute$/);
    if (referralExecuteId) {
      const state = await store.readReferralClaimState(referralExecuteId); const claim = state.referralClaims?.[referralExecuteId]; if (!claim) return json(res, 404, { error: 'Referral claim not found.' });
      const session = await referralSession(req);
      if (!allowedAuthOrigin(req, process.env.CORS_ORIGIN) || session?.wallet !== claim.recipientWallet) return json(res, 403, { error:'Execute this referral payout from its approved wallet session.' });
      if (claim.status === 'paid') return json(res, 200, state.payouts[claim.payoutId]);
      if (['executing', 'verification-pending'].includes(claim.status) && claim.pendingSignature) {
        try {
          const transfer = await reconcileSolPayout({ recipientWallet: claim.recipientWallet,
            amountSol: Number(claim.amount), signature: claim.pendingSignature, from: claim.pendingFrom });
          return json(res, 200, await recordPaid(referralExecuteId, Number(claim.amount), transfer));
        } catch {
          return json(res, 409, { error: 'The signed referral transfer still needs finalized reconciliation.',
            signature: claim.pendingSignature });
        }
      }
      if (claim.status !== 'wallet-verified') return json(res, 409, { error: 'The referral claim must be wallet-signed before execution.' });
      if (claim.expiresAt && Date.parse(claim.expiresAt) < Date.now()) return json(res, 409, { error: 'Referral claim has expired.' });
      if (claim.asset !== 'SOL') return json(res, 409, { error: 'Only SOL referral claims are executable by this payout wallet.' });
      const amountSol = Number(claim.amount); if (!Number.isFinite(amountSol) || amountSol <= 0 || amountSol > maxReferralPayoutSol) return json(res, 409, { error: 'Referral claim exceeds the configured payout limit.' });
      if ((process.env.SOLANA_REFERRAL_PAYOUT_CONFIGURED !== 'true' && !devnetTestMode) || !referralPayoutKeypair()) return json(res, 503, { error: 'Referral payouts are not enabled. Your verified claim remains unchanged.' });
      const locked = await store.updateReferralClaimState(referralExecuteId,current => {
        const currentClaim = current.referralClaims[referralExecuteId];
        if (!currentClaim || currentClaim.status !== 'wallet-verified') return null;
        if (['nonce','recipientWallet','amount','asset','expiresAt','publicKey'].some(key=>currentClaim[key]!==claim[key]) || (currentClaim.expiresAt&&Date.parse(currentClaim.expiresAt)<Date.now())) return null;
        currentClaim.status = 'executing'; currentClaim.executionStartedAt = new Date().toISOString(); return currentClaim;
      });
      if (!locked) return json(res, 409, { error: 'Referral claim is already being executed.' });
      try {
        const transfer = await executeSolPayout({ recipientWallet: claim.recipientWallet, amountSol,
          onSigned: async ({ signature, from }) => {
            await store.updateReferralClaimState(referralExecuteId, current => {
              const currentClaim = current.referralClaims[referralExecuteId];
              if (currentClaim?.status !== 'executing' || currentClaim.pendingSignature) throw new Error('Referral signature journal is unavailable.');
              currentClaim.pendingSignature = signature;
              currentClaim.pendingFrom = from;
              currentClaim.signedAt = new Date().toISOString();
              return currentClaim;
            });
          },
        });
        if (!transfer.finalized || transfer.amountLamports !== solToLamports(amountSol)
          || transfer.recipientDeltaLamports !== transfer.amountLamports
          || transfer.to !== claim.recipientWallet) throw new Error('Referral payout has no exact finalized recipient proof.');
        const payout = await recordPaid(referralExecuteId, amountSol, transfer);
        return json(res, 200, payout);
      } catch (error) {
        await store.updateReferralClaimState(referralExecuteId,current => {
          const existing = current.referralClaims[referralExecuteId];
          if (error.safeToRetry && existing?.status === 'executing' && !existing.pendingSignature) {
            current.referralClaims[referralExecuteId] = { ...existing, status: 'wallet-verified',
              lastAttemptError: String(error.message || error), lastAttemptAt: new Date().toISOString() };
          } else current.referralClaims[referralExecuteId] = pendingReferralClaim(existing,error);
          return current.referralClaims[referralExecuteId];
        });
        if (error.safeToRetry) return json(res, 409, { error: error.message });
        throw error;
      }
    }
    return false;
  };
}
