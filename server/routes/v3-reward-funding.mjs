import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import bs58 from 'bs58';
import { Connection, PublicKey } from '@solana/web3.js';
import { PROTOCOL_FEE_SPLIT } from '../../config/protocol-fee-split.js';
import { buildMintRouterV3DisbursementInstruction } from '../../mint-router-v3.js';
import { createAutomaticRewardChain } from '../automatic-reward-chain.mjs';
import { prepareCreatorSettlement, verifyCreatorSettlement,
  submitCreatorSettlement, creatorSettlementRetryState } from '../creator-settlement-transaction.mjs';
import { verifyV3LaunchRouterReadiness } from '../v3-launch-readiness.mjs';
import { loadFinalizedV3Settlement } from '../v3-settlement-proof.mjs';
import { v3AllocationPlan } from '../v3-allocation-plan.mjs';
import { loadFinalizedV3RewardFunding } from '../v3-reward-funding-proof.mjs';
import { allowedAuthOrigin } from '../x-auth.mjs';

const withdrawalIdFor = (kind, signature) => createHash('sha256')
  .update(`funded.v3.${kind}-funding.v1:${signature}`).digest();

export function createV3RewardFundingRoutes({ body, store, solanaCluster, solanaRpcUrl,
  v3AuthorityKeypair, respond, env = process.env,
  connectionFactory = url => new Connection(url, 'finalized'),
  verifyReadiness = verifyV3LaunchRouterReadiness,
  rewardChainFactory = createAutomaticRewardChain,
  loadSettlement = loadFinalizedV3Settlement,
  loadFunding = loadFinalizedV3RewardFunding,
  prepareTransaction = prepareCreatorSettlement,
  verifyTransaction = verifyCreatorSettlement,
  submitTransaction = submitCreatorSettlement,
  retryState = creatorSettlementRetryState,
  originAllowed = allowedAuthOrigin }) {
  const json = (...args) => { respond(...args); return true; };
  return async function handleV3RewardFunding(req, res, url) {
    const match = req.method === 'POST'
      ? url.pathname.match(/^\/api\/tokens\/([^/]+)\/v3-(community-funding|creator-reward-funding|creator-wallet-payout)\/([^/]+)$/) : null;
    if (!match) return false;
    const kind = match[2].replace(/-(funding|payout)$/, '');
    const category = kind === 'community' ? 5 : 0;
    const ledger = kind === 'community' ? 'v3CommunityFunding'
      : kind === 'creator-reward' ? 'v3CreatorRewardFunding' : 'v3CreatorWalletPayout';
    if (solanaCluster !== 'devnet' || !originAllowed(req, env.CORS_ORIGIN)) {
      return json(res, 403, { error:'V3 category disbursement requires the Devnet app origin.' });
    }
    const enabled = kind === 'community' ? env.FUNDED_V3_COMMUNITY_FUNDING_ENABLED
      : kind === 'creator-reward' ? env.FUNDED_V3_CREATOR_REWARD_FUNDING_ENABLED
      : env.FUNDED_V3_CREATOR_WALLET_PAYOUT_ENABLED;
    if (enabled !== 'true') {
      return json(res, 503, { error:'Creator-signed V3 category disbursement is not activated.' });
    }
    let mint;
    try { mint = new PublicKey(decodeURIComponent(match[1])).toBase58(); }
    catch { return json(res, 400, { error:'A valid mint is required.' }); }
    const collectionSignature = decodeURIComponent(match[3]);
    if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(collectionSignature)) {
      return json(res, 400, { error:'A valid collection signature is required.' });
    }
    const input = await body(req);
    const programId = String(env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID || '').trim();
    const approvedHash = String(env.FUNDED_V3_PROGRAM_DATA_SHA256 || '').trim();
    if (!programId || !/^[a-f0-9]{64}$/i.test(approvedHash)) {
      return json(res, 503, { error:'The approved V3 Devnet program is not configured.' });
    }
    let authority;
    try { authority = v3AuthorityKeypair(); } catch {}
    const state = await store.read();
    const launch = state.launches?.[mint];
    const collection = state.collections?.[collectionSignature];
    const settled = state.v3Settlements?.[collectionSignature];
    if (!authority?.publicKey || !launch?.onchainVerified || launch.cluster !== 'devnet'
      || launch.mint !== mint || launch.pumpFeeRoute?.scope !== 'per-mint-v3'
      || launch.pumpFeeRoute.programId !== programId
      || collection?.mint !== mint || collection.signature !== collectionSignature
      || collection.scope !== 'per-mint-v3' || collection.cluster !== 'devnet'
      || collection.status !== 'collected' || collection.onchainVerified !== true
      || collection.attribution !== 'mint-verified'
      || collection.programId !== programId || !/^[a-f0-9]{64}$/.test(String(collection.claimId || ''))
      || settled?.status !== 'finalized' || settled.collectionSignature !== collectionSignature
      || settled.mint !== mint || settled.allocationPlan?.status !== 'allocated-not-funded') {
      return json(res, 409, { error:'A matching finalized V3 settlement and payable allocation are required.' });
    }
    const connection = connectionFactory(solanaRpcUrl);
    const readiness = await verifyReadiness({ connection, programId,
      expectedProgramDataSha256:approvedHash, mint,
      creatorWallet:launch.creatorWallet,
      initialAuthority:launch.pumpFeeRoute.initialAuthority, split:PROTOCOL_FEE_SPLIT });
    if (!readiness.ready || readiness.configuredRouter !== collection.router) {
      return json(res, 409, { error:'The approved V3 program and mint policy are not verified.' });
    }
    const chain = rewardChainFactory({ connection, programId, authority,
      expectedProgramDataSha256:approvedHash });
    if (!(await chain.readiness()).constrainedPayouts) {
      return json(res, 503, { error:'The V3 reward vault program or current authority is not verified.' });
    }
    const proof = await loadSettlement({ connection, signature:settled.settlementSignature,
      programId, mint, authority:launch.pumpFeeRoute.initialAuthority,
      creator:launch.creatorWallet, claimId:Buffer.from(collection.claimId, 'hex'),
      expectedLamports:collection.collectedLamports, split:PROTOCOL_FEE_SPLIT });
    if (!proof || proof.claimId !== collection.claimId
      || proof.signature !== settled.settlementSignature) {
      return json(res, 409, { error:'Finalized V3 settlement proof is unavailable.' });
    }
    let plan;
    try { plan = v3AllocationPlan({ launch, settlement:{ ...proof, programId,
      collectionSignature, settlementSignature:settled.settlementSignature } }); }
    catch { return json(res, 409, { error:'The signed V3 allocation cannot be reconstructed.' }); }
    if (!isDeepStrictEqual(plan, settled.allocationPlan)) {
      return json(res, 409, { error:'The saved V3 allocation differs from finalized chain evidence.' });
    }
    const amount = kind === 'community' ? BigInt(plan.protocol.communityLamports)
      : kind === 'creator-reward' ? BigInt(plan.creatorDirected.holderLamports)
        + BigInt(plan.creatorDirected.xLamports)
        : BigInt(plan.creatorDirected.walletLamports);
    if (amount <= 0n) return json(res, 409, { error:'This settlement has no payable allocation for this category.' });
    const recipient = kind === 'creator-wallet' ? new PublicKey(launch.creatorWallet)
      : await chain.ensureVault(mint);
    const withdrawalId = withdrawalIdFor(kind, settled.settlementSignature);
    const payout = buildMintRouterV3DisbursementInstruction({ programId, mint,
      authority:authority.publicKey, creator:launch.creatorWallet, withdrawalId,
      category, amount, recipient });
    const loadProof = signature => loadFunding({ connection, signature, programId, mint,
      authority:authority.publicKey, creator:launch.creatorWallet,
      initialAuthority:launch.pumpFeeRoute.initialAuthority,
      withdrawalId, category, amount, recipient, split:PROTOCOL_FEE_SPLIT });
    const existing = state[ledger]?.[collectionSignature];
    if (existing?.status === 'finalized') {
      return await loadProof(existing.signature) ? json(res, 200, existing)
        : json(res, 409, { error:'Saved V3 funding lacks finalized proof.' });
    }
    if (existing?.signature) {
      const funded = await loadProof(existing.signature);
      if (funded) {
        const result = await store.update(current => {
          const row = current[ledger]?.[collectionSignature];
          if (row?.signature !== existing.signature) return null;
          return current[ledger][collectionSignature] = { ...funded,
            collectionSignature, status:'finalized', finalizedAt:new Date().toISOString() };
        });
        return result ? json(res, 200, result)
          : json(res, 409, { error:'Funding state changed during recovery.' });
      }
      const retry = await retryState({ connection, signatures:[existing.signature],
        blockhash:existing.blockhash });
      if (!retry.retry) return json(res, 409, { error:retry.reason });
    }
    if (!input?.creatorSignedTransaction) {
      const latest = await connection.getLatestBlockhash('finalized');
      return json(res, 202, { status:'awaiting-creator-signature', mint,
        collectionSignature, amountLamports:String(amount),
        recipient:recipient.toBase58(),
        transaction:prepareTransaction({ instruction:payout.instruction,
          authority:authority.publicKey, blockhash:latest.blockhash }),
        lastValidBlockHeight:latest.lastValidBlockHeight });
    }
    const transaction = verifyTransaction({ signedTransaction:input.creatorSignedTransaction,
      instruction:payout.instruction, authority:authority.publicKey,
      creator:launch.creatorWallet });
    transaction.partialSign(authority);
    const signature = bs58.encode(transaction.signature);
    const locked = await store.update(current => {
      const row = current[ledger]?.[collectionSignature];
      if (current.v3Settlements?.[collectionSignature]?.status !== 'finalized'
        || row?.status === 'finalized' || row?.signature !== existing?.signature) return false;
      current[ledger] ||= {};
      current[ledger][collectionSignature] = { status:'verification-pending',
        signature, collectionSignature, mint, amount:String(amount),
        blockhash:transaction.recentBlockhash, startedAt:new Date().toISOString() };
      return true;
    });
    if (!locked) return json(res, 409, { error:'V3 funding state changed before submission.' });
    const submitted = await submitTransaction({ connection, transaction, authority });
    if (submitted !== signature) throw new Error('Finalized V3 funding signature changed.');
    const funded = await loadProof(submitted);
    if (!funded) throw new Error('Finalized V3 disbursement proof is unavailable; reconcile before retrying.');
    const result = await store.update(current => {
      const row = current[ledger]?.[collectionSignature];
      if (row?.signature !== submitted || row.status !== 'verification-pending') return null;
      return current[ledger][collectionSignature] = { ...funded,
        collectionSignature, status:'finalized', finalizedAt:new Date().toISOString() };
    });
    return result ? json(res, 200, result)
      : json(res, 409, { error:'Finalized funding state changed; reconcile its signature.' });
  };
}
