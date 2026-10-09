import { homeLaunchFeeIndex } from '../home-launch-fee-index.mjs';
import { PublicKey, Connection } from '@solana/web3.js';
import { creatorVaultPda, OnlinePumpSdk } from '@pump-fun/pump-sdk';
import { coinFeeOverview } from '../coin-fee-overview.mjs';
import { creatorClaimStatus } from '../creator-fee-claim.mjs';
import { allowedAuthOrigin } from '../x-auth.mjs';

// Called after the shared request policy, rate limit, and authorization checks.
// Return true only after sending a response; false lets the router continue.
export function createCreatorFeesRoutes({
  store,
  solanaCluster,
  route,
  solanaRpcUrl,
  readFinalizedEvidence,
  automaticRewardStore,
  feeRouterConfig,
  databaseUrl,
  body,
  creatorFeeChallenges,
  respond,
}) {
  const json = (...args) => { respond(...args); return true; };
  return async function handleCreatorFeesRoutes(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/home/launch-filter-fees') {
      return json(res, 200, homeLaunchFeeIndex(await store.read(), solanaCluster));
    }
    const tokenActivityMint = req.method === 'GET' ? route(url.pathname, req.method, /^\/api\/tokens\/([^/]+)\/fee-activity$/) : null;
    if (tokenActivityMint) {
      let mint;
      try { mint = new PublicKey(decodeURIComponent(tokenActivityMint)).toBase58(); }
      catch { return json(res, 400, { error: 'A valid Solana mint is required.' }); }
      const activity = await store.readCoinFeeActivity(mint, solanaCluster);
      const state = await store.read();
      const launch = state.launches?.[mint];
      const readPump = async () => {
        if (!launch?.onchainVerified || launch.cluster !== solanaCluster || launch.pumpFeeRoute?.scope !== 'per-mint-v2' || launch.pumpFeeRoute.router !== launch.creator) return {};
        let pumpVault = null;
        try {
          const owner = new PublicKey(launch.creator);
          pumpVault = creatorVaultPda(owner).toBase58();
          const online = new OnlinePumpSdk(new Connection(solanaRpcUrl, 'confirmed'));
          const amount = await Promise.race([
            online.getCreatorVaultBalanceBothPrograms(owner),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Pump vault read timed out')), 4500)),
          ]);
          return { pumpAccruedLamports:amount.toString(), pumpVault };
        } catch (error) { return { pumpVault, pumpError:String(error.message || error).slice(0, 180) }; }
      };
      const mintPayouts = Object.fromEntries(Object.entries(state.payouts || {}).filter(([, row]) => row.mint === mint || state.collections?.[state.referralClaims?.[row.claimId]?.settlementSignature]?.mint === mint));
      const readPayouts = async () => {
        if (!Object.keys(mintPayouts).length) return [];
        try {
          const evidence = await Promise.race([
            readFinalizedEvidence({ collections:{}, payouts:mintPayouts, obligations:{} }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Payout verification timed out')), 3500)),
          ]);
          return evidence.verifiedPayouts?.map(row => row.signature) || [];
        } catch { return []; }
      };
      const [pump, verifiedPayoutSignatures, rewardState] = await Promise.all([readPump(), readPayouts(), automaticRewardStore.read()]);
      const overview = coinFeeOverview({ mint, cluster:solanaCluster, launch, collections:state.collections, settlements:state.settlements,
        rewardState, referralClaims:state.referralClaims, payouts:state.payouts, verifiedPayoutSignatures,
        operationsRecipient:process.env.FUNDED_PUMP_REVENUE_WALLET, ...pump });
      overview.creatorClaim = creatorClaimStatus({ mint, wallet:launch?.creatorWallet, launch, collections:state.collections, settlements:state.settlements, rewardState });
      const router = feeRouterConfig()?.address?.toBase58();
      const sharedRouter = router ? { address: router, scope: 'shared-creator-account', collections: await store.readRouterFeeActivity(router, solanaCluster) } : null;
      return json(res, 200, { mint, cluster: solanaCluster, source: databaseUrl ? 'funded.app-postgresql' : 'funded.app-file-ledger', coverage: 'mint-verified-fee-claims-only', ...activity, overview, sharedRouter });
    }
    const creatorClaimMatch = req.method === 'POST' ? url.pathname.match(/^\/api\/tokens\/([^/]+)\/creator-claim\/(prepare|request)$/) : null;
    if (creatorClaimMatch) {
      if (solanaCluster !== 'devnet') return json(res, 403, { error:'Creator fee claims are enabled on Solana only.' });
      if (!allowedAuthOrigin(req, process.env.CORS_ORIGIN)) return json(res, 403, { error:'Claim from the app origin.' });
      let mint;
      try { mint = new PublicKey(decodeURIComponent(creatorClaimMatch[1])).toBase58(); }
      catch { return json(res, 400, { error:'A valid Solana mint is required.' }); }
      const input = await body(req);
      const main = await store.read();
      const launch = main.launches?.[mint];
      if (!launch?.onchainVerified || launch.cluster !== solanaCluster || launch.pumpFeeRoute?.scope !== 'per-mint-v2' || launch.pumpFeeRoute.router !== launch.creator) return json(res, 409, { error:'A verified per-mint Solana launch is required.' });
      const wallet = launch.creatorWallet;
      const rewardState = await automaticRewardStore.read();
      const status = creatorClaimStatus({ mint, wallet, launch, collections:main.collections, settlements:main.settlements, rewardState });
      if (!status.eligible) return json(res, 409, { error:'Creator fees have not reached the 0.01 SOL minimum.', ...status });
      if (creatorClaimMatch[2] === 'prepare') return json(res, 200, creatorFeeChallenges.prepare({ mint, wallet, status, origin:String(req.headers.origin) }));
      const verified = creatorFeeChallenges.verify({ challengeId:input.challengeId, signature:input.signature, origin:String(req.headers.origin), status });
      if (!verified || verified.mint !== mint || verified.wallet !== wallet) return json(res, 401, { error:'Creator wallet signature is invalid, expired, or the claim amount changed.' });
      const requested = await automaticRewardStore.transaction(current => {
        const fresh = creatorClaimStatus({ mint, wallet, launch, collections:main.collections, settlements:main.settlements, rewardState:current });
        if (!fresh.eligible || JSON.stringify(fresh.requestIds) !== JSON.stringify(verified.requestIds) || fresh.claimableLamports !== verified.amount) return null;
        const now = new Date().toISOString();
        for (const id of fresh.requestIds) { current.fundingRequests[id].status = 'pending'; current.fundingRequests[id].creatorRequestedAt = now; }
        return { mint, wallet, amountLamports:fresh.claimableLamports, requestIds:fresh.requestIds, status:'payout-requested' };
      });
      return requested ? json(res, 202, requested) : json(res, 409, { error:'Claim state changed. Refresh and try again.' });
    }
    return false;
  };
}
