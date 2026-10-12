import { homeLaunchFeeIndex } from '../home-launch-fee-index.mjs';
import { PublicKey, Connection } from '@solana/web3.js';
import { creatorVaultPda, OnlinePumpSdk } from '@pump-fun/pump-sdk';
import { coinFeeOverview } from '../coin-fee-overview.mjs';
import { creatorClaimStatus, creatorClaimBatch, verifiedCreatorRequests } from '../creator-fee-claim.mjs';
import { verifiedRewardFundingRequests } from '../reward-funding-claim.mjs';
import { verifyMintFeeRouterAccount, verifyMintFeeLedgerAccount } from '../../fee-router.js';
import { buildMintRouterSettlementInstruction, readMintClaimRecord } from '../mint-router-payout.mjs';
import { prepareCreatorSettlement, verifyCreatorSettlement, submitCreatorSettlement,
  verifyFinalizedSettlementDelta, creatorSettlementRetryState } from '../creator-settlement-transaction.mjs';
import bs58 from 'bs58';
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
  mintRouterReadiness,
  routerAuthorityKeypair,
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
      overview.rewardFunding = verifiedRewardFundingRequests({ mint, wallet:launch?.creatorWallet, launch,
        collections:state.collections, settlements:state.settlements, rewardState,
        operationsRecipient:process.env.FUNDED_PUMP_REVENUE_WALLET }).map(({ id, kind, amount, status, recipient }) => ({
        id, kind, amountLamports:amount, status, recipient:recipient || null }));
      const router = feeRouterConfig()?.address?.toBase58();
      const sharedRouter = router ? { address: router, scope: 'shared-creator-account', collections: await store.readRouterFeeActivity(router, solanaCluster) } : null;
      return json(res, 200, { mint, cluster: solanaCluster, source: databaseUrl ? 'funded.app-postgresql' : 'funded.app-file-ledger', coverage: 'mint-verified-fee-claims-only', ...activity, overview, sharedRouter });
    }
    const creatorClaimMatch = req.method === 'POST' ? url.pathname.match(/^\/api\/tokens\/([^/]+)\/creator-claim\/(prepare|request)$/) : null;
    if (creatorClaimMatch) {
      if (solanaCluster !== 'devnet') return json(res, 403, { error:'Creator fee claims are enabled on Devnet only.' });
      if (!allowedAuthOrigin(req, process.env.CORS_ORIGIN)) return json(res, 403, { error:'Claim from the app origin.' });
      let mint;
      try { mint = new PublicKey(decodeURIComponent(creatorClaimMatch[1])).toBase58(); }
      catch { return json(res, 400, { error:'A valid Solana mint is required.' }); }
      const input = await body(req);
      const main = await store.read();
      const launch = main.launches?.[mint];
      if (!launch?.onchainVerified || launch.cluster !== solanaCluster || launch.pumpFeeRoute?.scope !== 'per-mint-v2' || launch.pumpFeeRoute.router !== launch.creator) return json(res, 409, { error:'A verified per-mint Devnet launch is required.' });
      const wallet = launch.creatorWallet;
      const rewardState = await automaticRewardStore.read();
      const inputs = { mint, wallet, launch, collections:main.collections, settlements:main.settlements, rewardState };
      const batch = creatorClaimBatch(inputs);
      if (!batch.eligible) return json(res, 409, { error:'Creator fees have not reached the 0.01 SOL minimum.', ...creatorClaimStatus(inputs) });
      const readiness = await mintRouterReadiness({ creatorSigned:true });
      if (!readiness.ready) return json(res, 503, { error:'Creator-signed mint-router settlement is not active on Devnet.', reasons:readiness.reasons });
      const config = feeRouterConfig();
      const authority = routerAuthorityKeypair();
      const connection = new Connection(solanaRpcUrl, 'confirmed');
      const [routerAccount, ledgerAccount] = await Promise.all([
        verifyMintFeeRouterAccount({ connection, programId:config.programId, mint, expectedAuthority:authority.publicKey }),
        verifyMintFeeLedgerAccount({ connection, programId:config.programId, mint, creator:wallet }),
      ]);
      if (!routerAccount.verified || routerAccount.address.toBase58() !== launch.creator || !ledgerAccount.verified) {
        return json(res, 503, { error:'This mint router and creator fee ledger are not verified on Devnet.' });
      }
      if (creatorClaimMatch[2] === 'prepare') return json(res, 200, creatorFeeChallenges.prepare({ mint, wallet, status:batch, origin:String(req.headers.origin) }));
      const verified = creatorFeeChallenges.verify({ challengeId:input.challengeId, signature:input.signature, origin:String(req.headers.origin), status:batch });
      if (!verified || verified.mint !== mint || verified.wallet !== wallet) return json(res, 401, { error:'Creator wallet signature is invalid, expired, or the claim batch changed.' });
      const requested = await automaticRewardStore.transaction(current => {
        const fresh = creatorClaimBatch({ ...inputs, rewardState:current });
        if (!fresh.eligible || JSON.stringify(fresh.requestIds) !== JSON.stringify(verified.requestIds) || fresh.claimableLamports !== verified.amount) return null;
        const now = new Date().toISOString();
        for (const id of fresh.requestIds) if (current.fundingRequests[id].status === 'claimable') {
          current.fundingRequests[id].status = 'awaiting-creator-signature';
          current.fundingRequests[id].creatorRequestedAt = now;
        }
        return { mint, wallet, amountLamports:fresh.claimableLamports, requestIds:fresh.requestIds, status:'awaiting-creator-signature' };
      });
      return requested ? json(res, 202, requested) : json(res, 409, { error:'Claim state changed. Refresh and retry.' });
    }
    const creatorSettleMatch = req.method === 'POST' ? url.pathname.match(/^\/api\/tokens\/([^/]+)\/creator-claim\/settle$/) : null;
    if (creatorSettleMatch) {
      if (solanaCluster !== 'devnet' || !allowedAuthOrigin(req, process.env.CORS_ORIGIN)) return json(res, 403, { error:'Creator settlement requires the Devnet app origin.' });
      let mint;
      try { mint = new PublicKey(decodeURIComponent(creatorSettleMatch[1])).toBase58(); }
      catch { return json(res, 400, { error:'A valid Solana mint is required.' }); }
      const input = await body(req);
      const requestId = String(input?.requestId || '');
      const main = await store.read();
      const launch = main.launches?.[mint];
      if (!launch?.onchainVerified || launch.cluster !== solanaCluster || launch.pumpFeeRoute?.scope !== 'per-mint-v2' || launch.pumpFeeRoute.router !== launch.creator || !launch.creatorWallet) return json(res, 409, { error:'A verified launch creator is required.' });
      const wallet = new PublicKey(launch.creatorWallet).toBase58();
      const rewardState = await automaticRewardStore.read();
      const verified = verifiedCreatorRequests({ mint, wallet, launch, collections:main.collections, settlements:main.settlements,
        rewardState, statuses:['awaiting-creator-signature','verification-pending','executing','paid-via-creator-settlement'] });
      const request = verified.find(row => row.id === requestId);
      if (!request) return json(res, 404, { error:'Verified creator fee request is unavailable.' });
      if (request.status === 'paid-via-creator-settlement' && request.finalized && request.balanceDeltaVerified && request.fundingSignature) return json(res, 200, { status:'paid', signature:request.fundingSignature, requestId, amountLamports:request.amount });
      const readiness = await mintRouterReadiness({ creatorSigned:true });
      if (!readiness.ready) return json(res, 503, { error:'Creator-signed mint-router settlement is not active on Devnet.', reasons:readiness.reasons });
      const config = feeRouterConfig();
      const authority = routerAuthorityKeypair();
      const connection = new Connection(solanaRpcUrl, 'confirmed');
      const checked = await verifyMintFeeRouterAccount({ connection, programId:config.programId, mint, expectedAuthority:authority.publicKey });
      if (!checked.verified || checked.address.toBase58() !== launch.creator) return json(res, 409, { error:'The verified mint router does not match this creator fee request.' });
      const ledger = await verifyMintFeeLedgerAccount({ connection, programId:config.programId, mint, creator:wallet });
      if (!ledger.verified) return json(res, 409, { error:'The launch creator fee ledger is not verified on Devnet.' });
      const settlement = buildMintRouterSettlementInstruction({ programId:config.programId, mint, authority:authority.publicKey,
        creator:wallet, recipient:wallet, amountLamports:request.amount, obligationId:request.id, claimDomain:'creator' });
      const recordMatches = account => readMintClaimRecord(account, { programId:config.programId, mint, recipient:wallet,
        amountLamports:request.amount, claimId:settlement.claimId, share:settlement.share });
      const priorRecord = await connection.getAccountInfo(settlement.claim, 'finalized');
      if (priorRecord && !recordMatches(priorRecord)) return json(res, 409, { error:'The on-chain creator claim record conflicts with this allocation.' });
      let recoveryAllowed = false;
      if (!priorRecord && ['executing','verification-pending'].includes(request.status)) {
        const retry = await creatorSettlementRetryState({ connection, signatures:request.pendingPayoutSignatures,
          blockhash:request.pendingPayoutBlockhash });
        if (!retry.retry) return json(res, 409, { error:retry.reason });
        recoveryAllowed = true;
      }
      let transaction = null, expectedSignature = null;
      if (!priorRecord) {
        if (!input?.creatorSignedTransaction) {
          const latest = await connection.getLatestBlockhash('finalized');
          return json(res, 202, { status:'awaiting-creator-signature', requestId, creatorWallet:wallet,
            recipient:wallet, amountLamports:request.amount, transaction:prepareCreatorSettlement({ instruction:settlement.instruction,
              authority:authority.publicKey, blockhash:latest.blockhash }), lastValidBlockHeight:latest.lastValidBlockHeight });
        }
        transaction = verifyCreatorSettlement({ signedTransaction:input.creatorSignedTransaction,
          instruction:settlement.instruction, authority:authority.publicKey, creator:wallet });
        transaction.partialSign(authority);
        expectedSignature = bs58.encode(transaction.signature);
      }
      const locked = await automaticRewardStore.transaction(current => {
        const row = current.fundingRequests?.[request.id];
        if (!row || ['mint','kind','asset','amount','recipient','sourceSignature'].some(key => row[key] !== request[key])) throw new Error('Creator fee allocation changed before settlement.');
        if (row.status === 'paid-via-creator-settlement' || (row.status === 'executing' && !priorRecord && !recoveryAllowed)
          || (row.status === 'verification-pending' && !priorRecord && !recoveryAllowed)
          || !['awaiting-creator-signature','verification-pending','executing'].includes(row.status)) return false;
        if (recoveryAllowed && (row.pendingPayoutBlockhash !== request.pendingPayoutBlockhash
          || JSON.stringify(row.pendingPayoutSignatures) !== JSON.stringify(request.pendingPayoutSignatures))) return false;
        row.status = 'executing'; row.startedAt = new Date().toISOString();
        if (expectedSignature) {
          row.pendingPayoutSignatures = [...new Set([...(row.pendingPayoutSignatures || []), expectedSignature])];
          row.pendingPayoutBlockhash = transaction.recentBlockhash;
        }
        return true;
      });
      if (!locked) return json(res, 409, { error:'Creator fee settlement is already executing or paid. Refresh its status.' });
      try {
        let signature;
        if (priorRecord) {
          const candidates = [...new Set(request.pendingPayoutSignatures || [])];
          if (!candidates.length) throw new Error('On-chain creator claim exists without a saved settlement signature; manual reconciliation is required.');
          const receipts = (await connection.getSignatureStatuses(candidates, { searchTransactionHistory:true })).value || [];
          signature = candidates.find((candidate,index) => receipts[index]?.confirmationStatus === 'finalized' && !receipts[index]?.err);
          if (!signature) throw new Error('Saved creator settlement has no finalized receipt; manual reconciliation is required.');
        } else {
          signature = await submitCreatorSettlement({ connection, transaction, authority });
          if (signature !== expectedSignature) throw new Error('Finalized signature differs from the exact creator-approved transaction.');
        }
        if (!recordMatches(await connection.getAccountInfo(settlement.claim, 'finalized'))) throw new Error('Finalized creator claim record does not match the allocation.');
        await verifyFinalizedSettlementDelta({ connection, signature, router:settlement.router, recipient:wallet, amountLamports:request.amount });
        const paidAt = new Date().toISOString();
        await automaticRewardStore.transaction(current => {
          const row = current.fundingRequests?.[request.id];
          if (!row || row.status !== 'executing' || row.amount !== request.amount || row.recipient !== wallet) throw new Error('Creator fee request changed during finalization.');
          Object.assign(row, { status:'paid-via-creator-settlement', fundingSignature:signature, fundingClaim:settlement.claim.toBase58(),
            finalized:true, balanceDeltaVerified:true, fundedAt:paidAt });
        });
        return json(res, 200, { status:'paid', signature, requestId, amountLamports:request.amount });
      } catch (error) {
        await automaticRewardStore.transaction(current => {
          const row = current.fundingRequests?.[request.id];
          if (row?.status === 'executing') Object.assign(row, { status:'verification-pending', reason:String(error.message || error), lastAttemptAt:new Date().toISOString() });
        });
        throw error;
      }
    }
    return false;
  };
}
