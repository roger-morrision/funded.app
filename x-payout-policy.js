import { normalizeXHandle, validateSolClaimRecipient } from './sol-claim-policy.js';

export { normalizeXHandle };

export function buildXPayoutPolicy({ handle, percent = 0, feeRouterAddress = null } = {}) {
  const recipient = validateSolClaimRecipient({ handle, percent });
  if (!recipient.valid) throw new Error('A valid X handle is required for X payouts.');
  return {
    mode: 'x-handle-payout',
    handle: normalizeXHandle(handle) || null,
    percent: Number(percent) || 0,
    feeRouterAddress: feeRouterAddress ? String(feeRouterAddress) : null,
    primaryRail: { type: 'x-money', status: 'requires-x-oauth-attestation' },
    fallbackRail: { type: 'sol-claim', status: 'requires-wallet-signature' },
  };
}

export function buildXPayoutObligation({ claimSignature, amountSol, recipient, obligationId } = {}) {
  if (!String(claimSignature || '').trim()) throw new Error('Claim signature is required.');
  if (!Number.isFinite(Number(amountSol)) || Number(amountSol) <= 0) throw new Error('A positive SOL amount is required.');
  const normalized = validateSolClaimRecipient({ handle: recipient, percent: 1 });
  if (!normalized.valid) throw new Error('A valid X recipient is required.');
  return {
    id: String(obligationId || `${claimSignature}:x-payout`),
    claimSignature: String(claimSignature),
    recipient: normalized.handle,
    amountSol: Number(Number(amountSol).toFixed(9)),
    primaryStatus: 'pending-x-money',
    fallbackStatus: 'claimable-after-x-money-failure-or-ineligibility',
  };
}
