// Configuration readiness is separate from proof of a finalized X payment.
export function v3XCapability({ cluster, launch, enabled, oauthConfigured,
  lookupConfigured, lookupError } = {}) {
  const reasons = [...(launch?.reasons || [])];
  if (cluster !== 'devnet') reasons.push('V3 X claims require Devnet.');
  if (!launch?.ready) reasons.push('V3 launch readiness is unavailable.');
  if (!enabled) reasons.push('V3 X claims are disabled.');
  if (!oauthConfigured) reasons.push('X OAuth is unavailable.');
  if (!lookupConfigured || lookupError) reasons.push(lookupError || 'X account lookup is unavailable.');
  return { ready:reasons.length === 0, scope:'per-mint-v3',
    paymentVerified:false, reasons:[...new Set(reasons)] };
}
