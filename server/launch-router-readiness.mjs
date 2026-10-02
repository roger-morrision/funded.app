import { deriveMintFeeRouter, verifyFeeRouterAccount, verifyMintFeeRouterAccount } from '../fee-router.js';

export async function verifyLaunchRouterReadiness({ connection, routerConfig, mint, perMint }) {
  if (!routerConfig) return { ready: false, status: 503, error: 'The Devnet fee-router program is not configured. Launch registration is blocked.' };
  const configuredRouter = perMint
    ? deriveMintFeeRouter(routerConfig.programId, mint).address.toBase58()
    : routerConfig.address.toBase58();
  if (!perMint) return { ready: true, configuredRouter };
  try {
    const legacy = await verifyFeeRouterAccount({ connection, programId: routerConfig.programId });
    if (!legacy.verified) return { ready: false, status: 409, error: `The legacy fee-router policy is not verified: ${legacy.reason}.` };
    const checked = await verifyMintFeeRouterAccount({ connection, programId: routerConfig.programId, mint, expectedAuthority: legacy.authority });
    if (!checked.verified) return { ready: false, status: 409, error: `The mint-specific fee router is not verified: ${checked.reason}.` };
  } catch {
    return { ready: false, status: 503, error: 'The Devnet fee-router accounts could not be verified. Launch registration is blocked.' };
  }
  return { ready: true, configuredRouter };
}
