import { PublicKey } from '@solana/web3.js';
import { deriveMintRouterV3, verifyMintPolicyV3Account, verifyMintRouterV3Account } from '../mint-router-v3.js';
import { verifyPumpLaunch } from './launch-verification.mjs';
import { verifyV3PumpCollection } from './v3-collection-proof.mjs';

// This is the server-side boundary for a future v3 settlement route. It does
// not accept transaction JSON, a launch owner, or a policy from the requester.
export async function loadFinalizedV3PumpCollection({ connection, signature, programId, mint, launch,
  verifyLaunch = verifyPumpLaunch }) {
  const mintKey = new PublicKey(mint).toBase58();
  const programKey = new PublicKey(programId).toBase58();
  const router = deriveMintRouterV3(programKey, mintKey).address.toBase58();
  const route = launch?.pumpFeeRoute;
  if (!launch?.onchainVerified || launch.cluster !== 'devnet' || launch.mint !== mintKey
    || launch.creator !== router || !launch.creatorWallet || route?.scope !== 'per-mint-v3'
    || route.router !== router || route.programId !== programKey || !route.transaction
    || !route.initialAuthority || !route.protocolSplit) return null;

  const launchProof = await verifyLaunch({ connection, mint:mintKey, signature:route.transaction,
    commitment:'finalized' });
  if (!launchProof?.onchainVerified || launchProof.creator !== router
    || launchProof.feePayer !== launch.creatorWallet || launchProof.signature !== route.transaction) return null;

  const [routerAccount, policyAccount] = await Promise.all([
    verifyMintRouterV3Account({ connection, programId:programKey, mint:mintKey,
      initialAuthority:route.initialAuthority }),
    verifyMintPolicyV3Account({ connection, programId:programKey, mint:mintKey,
      creator:launch.creatorWallet, initialAuthority:route.initialAuthority,
      split:route.protocolSplit }),
  ]);
  if (!routerAccount.verified || !policyAccount.verified) return null;

  const transaction = await connection.getTransaction(signature, {
    commitment:'finalized', maxSupportedTransactionVersion:0,
  });
  return verifyV3PumpCollection({ transaction, signature, programId:programKey, mint:mintKey });
}
