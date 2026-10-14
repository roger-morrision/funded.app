import { homeLaunchFeeIndex } from '../home-launch-fee-index.mjs';
import { PublicKey, Connection } from '@solana/web3.js';
import { creatorVaultPda, OnlinePumpSdk } from '@pump-fun/pump-sdk';

export function createCreatorFeesRoutes({ store, solanaCluster, route, solanaRpcUrl, databaseUrl, respond }) {
  const json = (...args) => { respond(...args); return true; };
  return async function handleCreatorFeesRoutes(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/home/launch-filter-fees')
      return json(res, 200, homeLaunchFeeIndex(await store.read(), solanaCluster));
    const tokenActivityMint = req.method === 'GET'
      ? route(url.pathname, req.method, /^\/api\/tokens\/([^/]+)\/fee-activity$/) : null;
    if (!tokenActivityMint) return false;
    let mint;
    try { mint = new PublicKey(decodeURIComponent(tokenActivityMint)).toBase58(); }
    catch { return json(res, 400, { error:'A valid Solana mint is required.' }); }
    const state = await store.read();
    const launch = state.launches?.[mint];
    if (!launch) return json(res, 404, { error:'Launch not found.' });
    if (!launch.onchainVerified || launch.cluster !== 'devnet' || launch.cluster !== solanaCluster
      || launch.pumpFeeRoute?.scope !== 'per-mint-v3' || launch.pumpFeeRoute.router !== launch.creator
      || launch.pumpFeeRoute.programId !== process.env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID)
      return json(res, 410, { error:'Only verified V3 launch fee activity is available.' });
    let pumpVault = null, pumpAccruedLamports = null, pumpError = null;
    try {
      const owner = new PublicKey(launch.creator);
      pumpVault = creatorVaultPda(owner).toBase58();
      const online = new OnlinePumpSdk(new Connection(solanaRpcUrl, 'confirmed'));
      const amount = await Promise.race([
        online.getCreatorVaultBalanceBothPrograms(owner),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Pump vault read timed out')), 4500)),
      ]);
      pumpAccruedLamports = amount.toString();
    } catch (error) { pumpError = String(error.message || error).slice(0, 180); }
    const collections = Object.values(state.collections || {}).filter(row => row.mint === mint
      && row.scope === 'per-mint-v3' && row.status === 'collected' && row.onchainVerified === true
      && row.programId === launch.pumpFeeRoute.programId && row.router === launch.pumpFeeRoute.router)
      .map(row => ({ signature:row.signature, recordedAt:row.recordedAt || null,
        amountLamports:String(row.collectedLamports),
        settlement:state.v3Settlements?.[row.signature]?.status || 'pending',
        allocationPlan:state.v3Settlements?.[row.signature]?.status === 'finalized'
          ? state.v3Settlements[row.signature].allocationPlan : null,
        communityFunding:state.v3CommunityFunding?.[row.signature]?.status || 'pending',
        creatorRewardFunding:state.v3CreatorRewardFunding?.[row.signature]?.status || 'pending',
        creatorWalletPayout:state.v3CreatorWalletPayout?.[row.signature]?.status || 'pending',
        buyback:state.v3BuybackOrders?.[row.signature]?.status || 'pending' }));
    const activity = { collections:collections.map(row => ({ signature:row.signature,
      recordedAt:row.recordedAt, collectedLamports:row.amountLamports })),
      claims:collections.filter(row => row.settlement === 'finalized').map(row => ({
        claimSignature:row.signature, status:'finalized',
        grossCreatorFees:row.amountLamports, asset:'SOL', claimedAt:null })) };
    return json(res, 200, { mint, cluster:solanaCluster,
      source:databaseUrl ? 'funded.app-postgresql' : 'funded.app-file-ledger',
      coverage:'verified-v3-collections', ...activity,
      overview:{ available:true, scope:'per-mint-v3', creatorWallet:launch.creatorWallet,
        pump:{ vault:pumpVault, accruedLamports:pumpAccruedLamports,
          status:pumpError || pumpAccruedLamports == null ? 'unavailable' : 'confirmed',
          error:pumpError },
        collections, gates:{ settlement:process.env.FUNDED_V3_SETTLEMENT_ENABLED === 'true',
          communityFunding:process.env.FUNDED_V3_COMMUNITY_FUNDING_ENABLED === 'true',
          creatorRewardFunding:process.env.FUNDED_V3_CREATOR_REWARD_FUNDING_ENABLED === 'true',
          creatorWalletPayout:process.env.FUNDED_V3_CREATOR_WALLET_PAYOUT_ENABLED === 'true',
          referralPayout:process.env.FUNDED_V3_REFERRAL_PAYOUT_ENABLED === 'true',
          buyback:process.env.FUNDED_V3_BUYBACK_ENABLED === 'true' } },
      sharedRouter:null });
  };
}
