import bs58 from 'bs58';
import { Connection, PublicKey } from '@solana/web3.js';
import { verifyMintFeeLedgerAccount, verifyMintFeeRouterAccount } from '../../fee-router.js';
import { createAutomaticRewardChain } from '../automatic-reward-chain.mjs';
import { buildMintRouterSettlementInstruction, readMintClaimRecord } from '../mint-router-payout.mjs';
import { verifiedRewardFundingRequests } from '../reward-funding-claim.mjs';
import { prepareCreatorSettlement, verifyCreatorSettlement, submitCreatorSettlement,
  verifyFinalizedSettlementDelta, creatorSettlementRetryState } from '../creator-settlement-transaction.mjs';
import { allowedAuthOrigin } from '../x-auth.mjs';

// Only an immutable, verified fee allocation may enter this creator-approved route.
// The worker observes the signed receipt later and schedules holder/direct payouts.
export function createRewardFundingRoutes({ store, automaticRewardStore, solanaCluster, solanaRpcUrl,
  feeRouterConfig, mintRouterReadiness, routerAuthorityKeypair, body, respond,
  connectionFactory = url => new Connection(url, 'confirmed'), chainFactory = createAutomaticRewardChain }) {
  const json = (...args) => { respond(...args); return true; };
  return async function handleRewardFundingRoutes(req, res, url) {
    const match = url.pathname.match(/^\/api\/tokens\/([^/]+)\/reward-funding\/(pending|settle)$/);
    if (!match || (match[2] === 'pending' ? req.method !== 'GET' : req.method !== 'POST')) return false;
    if (solanaCluster !== 'devnet') return json(res, 403, { error:'Creator-approved reward funding is Devnet-only.' });
    if (req.method === 'POST' && !allowedAuthOrigin(req, process.env.CORS_ORIGIN))
      return json(res, 403, { error:'Approve reward funding from the app origin.' });
    let mint;
    try { mint = new PublicKey(decodeURIComponent(match[1])).toBase58(); }
    catch { return json(res, 400, { error:'A valid Solana mint is required.' }); }
    const main = await store.read();
    const launch = main.launches?.[mint];
    if (!launch?.creatorWallet || !launch.onchainVerified || launch.cluster !== 'devnet')
      return json(res, 404, { error:'A verified Devnet launch is required.' });
    const wallet = new PublicKey(launch.creatorWallet).toBase58();
    const verifiedInput = { mint, wallet, launch, collections:main.collections, settlements:main.settlements,
      operationsRecipient:process.env.FUNDED_PUMP_REVENUE_WALLET };
    const rewardState = await automaticRewardStore.read();
    const requests = verifiedRewardFundingRequests({ ...verifiedInput, rewardState });
    if (match[2] === 'pending') return json(res, 200, { mint, creatorWallet:wallet,
      requests:requests.map(({ id, kind, amount, status, recipient, fundingSignature }) => ({
        id, kind, amountLamports:amount, status, recipient:recipient || null,
        fundingSignature:fundingSignature || null })) });
    const input = await body(req);
    const requestId = String(input?.requestId || '');
    const request = requests.find(row => row.id === requestId);
    if (!request) return json(res, 404, { error:'Verified reward funding request is unavailable.' });
    if (request.status === 'funded' && request.balanceDeltaVerified && request.fundingClaim)
      return json(res, 200, { status:'funded', requestId, signature:request.fundingSignature,
        amountLamports:request.amount, claim:request.fundingClaim });
    if (request.status === 'funding' && request.fundingSignature)
      return json(res, 202, { status:'vault-funded', requestId, signature:request.fundingSignature,
        amountLamports:request.amount, claim:request.fundingClaim });
    const readiness = await mintRouterReadiness({ creatorSigned:true });
    if (!readiness.ready) return json(res, 503, { error:'Creator-signed mint-router settlement is unavailable.', reasons:readiness.reasons });
    const config = feeRouterConfig();
    const authority = routerAuthorityKeypair();
    if (!config?.programId || !authority || authority.publicKey.toBase58() !== process.env.FUNDED_REWARD_AUTHORITY)
      return json(res, 503, { error:'Reward vault authority does not match the configured router signer.' });
    const connection = connectionFactory(solanaRpcUrl);
    const [router, ledger] = await Promise.all([
      verifyMintFeeRouterAccount({ connection, programId:config.programId, mint, expectedAuthority:authority.publicKey }),
      verifyMintFeeLedgerAccount({ connection, programId:config.programId, mint, creator:wallet }),
    ]);
    if (!router.verified || router.address.toBase58() !== launch.creator || !ledger.verified)
      return json(res, 409, { error:'The verified mint router and creator ledger do not match this allocation.' });
    const chain = chainFactory({ connection, programId:config.programId, authority,
      expectedProgramDataSha256:process.env.FUNDED_REWARD_PROGRAM_DATA_SHA256 });
    const rewardReady = await chain.readiness();
    if (!rewardReady.constrainedPayouts) return json(res, 503, { error:'Reward vault program is unavailable.', reasons:rewardReady.reasons });
    const vault = await chain.ensureVault(request.kind === 'community-reserve' ? config.programId : mint);
    const claimDomain = request.kind === 'holder' ? 'holder-funding'
      : request.kind === 'operations' ? 'operations-funding' : 'community-reserve';
    const settlement = buildMintRouterSettlementInstruction({ programId:config.programId, mint,
      authority:authority.publicKey, creator:wallet, recipient:vault, amountLamports:request.amount,
      obligationId:request.id, claimDomain });
    const recordMatches = account => readMintClaimRecord(account, { programId:config.programId, mint,
      recipient:vault, amountLamports:request.amount, claimId:settlement.claimId, share:settlement.share });
    const priorRecord = await connection.getAccountInfo(settlement.claim, 'finalized');
    if (priorRecord && !recordMatches(priorRecord)) return json(res, 409, { error:'On-chain reward funding claim conflicts with this allocation.' });
    let recoveryAllowed = false;
    if (!priorRecord && ['executing','verification-pending'].includes(request.status)) {
      const retry = await creatorSettlementRetryState({ connection,
        signatures:request.pendingPayoutSignatures, blockhash:request.pendingPayoutBlockhash });
      if (!retry.retry) return json(res, 409, { error:retry.reason });
      recoveryAllowed = true;
    }
    let transaction = null, expectedSignature = null;
    if (!priorRecord) {
      if (!input?.creatorSignedTransaction) {
        const latest = await connection.getLatestBlockhash('finalized');
        return json(res, 202, { status:'awaiting-creator-signature', requestId, kind:request.kind,
          creatorWallet:wallet, recipient:vault.toBase58(), amountLamports:request.amount,
          transaction:prepareCreatorSettlement({ instruction:settlement.instruction,
            authority:authority.publicKey, blockhash:latest.blockhash }), lastValidBlockHeight:latest.lastValidBlockHeight });
      }
      transaction = verifyCreatorSettlement({ signedTransaction:input.creatorSignedTransaction,
        instruction:settlement.instruction, authority:authority.publicKey, creator:wallet });
      transaction.partialSign(authority);
      expectedSignature = bs58.encode(transaction.signature);
    }
    const locked = await automaticRewardStore.transaction(current => {
      const fresh = verifiedRewardFundingRequests({ ...verifiedInput, rewardState:current }).find(row => row.id === requestId);
      if (!fresh || ['mint','kind','asset','amount','recipient','sourceSignature'].some(key => fresh[key] !== request[key]))
        throw new Error('Reward allocation changed before creator approval.');
      if (['funded','funding'].includes(fresh.status) || (['executing','verification-pending'].includes(fresh.status)
        && !priorRecord && !recoveryAllowed)) return false;
      if (recoveryAllowed && (fresh.pendingPayoutBlockhash !== request.pendingPayoutBlockhash
        || JSON.stringify(fresh.pendingPayoutSignatures) !== JSON.stringify(request.pendingPayoutSignatures))) return false;
      fresh.status = 'executing'; fresh.startedAt = new Date().toISOString();
      if (expectedSignature) {
        fresh.pendingPayoutSignatures = [...new Set([...(fresh.pendingPayoutSignatures || []), expectedSignature])];
        fresh.pendingPayoutBlockhash = transaction.recentBlockhash;
      }
      return true;
    });
    if (!locked) return json(res, 409, { error:'Reward funding is already executing or funded. Refresh its status.' });
    try {
      let signature;
      if (priorRecord) {
        const candidates = [...new Set(request.pendingPayoutSignatures || [])];
        if (!candidates.length) throw new Error('On-chain funding claim lacks a saved signature; manual reconciliation is required.');
        const receipts = (await connection.getSignatureStatuses(candidates, { searchTransactionHistory:true })).value || [];
        signature = candidates.find((candidate, index) => receipts[index]?.confirmationStatus === 'finalized' && !receipts[index]?.err);
        if (!signature) throw new Error('Saved reward settlement has no finalized receipt; manual reconciliation is required.');
      } else {
        signature = await submitCreatorSettlement({ connection, transaction, authority });
        if (signature !== expectedSignature) throw new Error('Finalized signature differs from the creator-approved transaction.');
      }
      if (!recordMatches(await connection.getAccountInfo(settlement.claim, 'finalized')))
        throw new Error('Finalized reward funding claim does not match this allocation.');
      await verifyFinalizedSettlementDelta({ connection, signature, router:settlement.router,
        recipient:vault, amountLamports:request.amount });
      await automaticRewardStore.transaction(current => {
        const fresh = current.fundingRequests?.[requestId];
        if (!fresh || fresh.status !== 'executing' || fresh.amount !== request.amount || fresh.kind !== request.kind)
          throw new Error('Reward request changed during finalization.');
        Object.assign(fresh, { status:'funding', fundingSignature:signature, fundingClaim:settlement.claim.toBase58(),
          approvedCreator:wallet, vault:vault.toBase58(), balanceDeltaVerified:true, fundedAt:new Date().toISOString() });
      });
      return json(res, 200, { status:'vault-funded', requestId, kind:request.kind, signature,
        recipient:vault.toBase58(), amountLamports:request.amount, claim:settlement.claim.toBase58(),
        scheduleStatus:'pending-worker-reconciliation' });
    } catch (error) {
      await automaticRewardStore.transaction(current => {
        const fresh = current.fundingRequests?.[requestId];
        if (fresh?.status === 'executing') Object.assign(fresh, { status:'verification-pending',
          reason:String(error.message || error), lastAttemptAt:new Date().toISOString() });
      });
      throw error;
    }
  };
}
