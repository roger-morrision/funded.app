const X_HANDLE_PATTERN = /^@[A-Za-z0-9_]{1,15}$/;

export function normalizeXHandle(value) {
  const handle = String(value || '').trim();
  return handle ? (handle.startsWith('@') ? handle : `@${handle}`) : '';
}

export function validateSolClaimRecipient({ handle, percent = 0 } = {}) {
  const normalizedHandle = normalizeXHandle(handle);
  const enabled = Number(percent) > 0;
  return { valid: !enabled || X_HANDLE_PATTERN.test(normalizedHandle), enabled, handle: normalizedHandle };
}

export function buildSolClaimPolicy({ handle, percent = 0, feeRouterAddress = null } = {}) {
  const recipient = validateSolClaimRecipient({ handle, percent });
  if (!recipient.valid) throw new Error('A valid X handle is required for SOL claims.');
  return {
    mode: 'x-handle-sol-claim', recipient: recipient.handle || null,
    sharePercentOfCreatorFees: Number(percent) || 0,
    source: 'funded-app-pump-fee-router-claim',
    payoutRail: { type: 'solana', asset: 'SOL', status: 'claimable-after-x-identity-verification' },
    claimRequirements: ['x-handle-attestation', 'wallet-signature', 'one-time-claim-token'],
    feeRouterAddress: feeRouterAddress ? String(feeRouterAddress) : null,
    safety: { noPrivateKeysInBrowser: true, idempotencyKey: 'claim-signature-and-obligation-id' },
  };
}

export function buildSolClaimObligation({ claimSignature, amountSol, recipient, obligationId } = {}) {
  if (!String(claimSignature || '').trim()) throw new Error('Claim signature is required.');
  if (!Number.isFinite(Number(amountSol)) || Number(amountSol) <= 0) throw new Error('A positive SOL amount is required.');
  const normalized = validateSolClaimRecipient({ handle: recipient, percent: 1 });
  if (!normalized.valid) throw new Error('A valid X recipient is required.');
  return { id: String(obligationId || `${claimSignature}:sol-claim`), claimSignature: String(claimSignature), recipient: normalized.handle, asset: 'SOL', amountSol: Number(Number(amountSol).toFixed(9)), status: 'claimable-after-wallet-verification', createdAt: new Date().toISOString() };
}
