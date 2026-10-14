import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import bs58 from 'bs58';
import { Connection, PublicKey } from '@solana/web3.js';
import { PROTOCOL_FEE_SPLIT } from '../../config/protocol-fee-split.js';
import { buildMintRouterV3DisbursementInstruction } from '../../mint-router-v3.js';
import { createAutomaticRewardChain } from '../automatic-reward-chain.mjs';
import { createRewardScheduler } from '../reward-scheduler.mjs';
import { holderFundingMinimumLamports } from '../reward-scheduler.mjs';
import { AUTOMATIC_REWARDS } from '../../automatic-rewards.js';
import { prepareCreatorSettlement, verifyCreatorSettlement,
  submitCreatorSettlement, creatorSettlementRetryState } from '../creator-settlement-transaction.mjs';
import { verifyV3LaunchRouterReadiness } from '../v3-launch-readiness.mjs';
import { loadFinalizedV3Settlement } from '../v3-settlement-proof.mjs';
import { v3AllocationPlan } from '../v3-allocation-plan.mjs';
import { loadFinalizedV3RewardFunding } from '../v3-reward-funding-proof.mjs';
import { allowedAuthOrigin } from '../x-auth.mjs';
import { v3ReferralEntitlement } from '../v3-referral-entitlement.mjs';

const withdrawalIdFor = (kind, signature) => createHash('sha256')
  .update(`funded.v3.${kind}-funding.v1:${signature}`).digest();

export function createV3RewardFundingRoutes({ body, store, solanaCluster, solanaRpcUrl,
  v3AuthorityKeypair, rewardStore, respond, env = process.env,
  connectionFactory = url => new Connection(url, 'finalized'),
  verifyReadiness = verifyV3LaunchRouterReadiness,
  rewardChainFactory = createAutomaticRewardChain,
  schedulerFactory = createRewardScheduler,
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
      ? url.pathname.match(/^\/api\/tokens\/([^/]+)\/v3-(community-funding|creator-reward-funding|creator-wallet-payout|referral-payout)\/([^/]+)(?:\/([1-3]))?$/) : null;
    if (!match) return false;
    const kind = match[2].replace(/-(funding|payout)$/, '');
    const level = kind === 'referral' ? Number(match[4]) : null;
    if (kind === 'referral' && !level || kind !== 'referral' && match[4])
      return json(res, 400, { error:'A V3 referral payout requires one level from 1 to 3.' });
    const category = kind === 'community' ? 5 : kind === 'referral' ? level + 1 : 0;
    const ledger = kind === 'community' ? 'v3CommunityFunding'
      : kind === 'creator-reward' ? 'v3CreatorRewardFunding'
        : kind === 'referral' ? 'v3ReferralPayouts' : 'v3CreatorWalletPayout';
    if (solanaCluster !== 'devnet' || !originAllowed(req, env.CORS_ORIGIN)) {
      return json(res, 403, { error:'V3 category disbursement requires the Devnet app origin.' });
    }
    const enabled = kind === 'referral' ? env.FUNDED_V3_REFERRAL_PAYOUT_ENABLED
      : kind === 'community' ? env.FUNDED_V3_COMMUNITY_FUNDING_ENABLED
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
    let entitlement = null;
    if (kind === 'referral') {
      try { entitlement = v3ReferralEntitlement({ settlement:settled, plan, level }); }
      catch { return json(res, 409, { error:'The V3 referral attribution is invalid.' }); }
      if (!entitlement) return json(res, 409, { error:'No inviter frozen at the first qualified V3 fee event has a payable allocation for this level.' });
    }
    const amount = kind === 'referral' ? BigInt(entitlement.amount)
      : kind === 'community' ? BigInt(plan.protocol.communityLamports)
      : kind === 'creator-reward' ? BigInt(plan.creatorDirected.holderLamports)
        + BigInt(plan.creatorDirected.xLamports)
        : BigInt(plan.creatorDirected.walletLamports);
    if (amount <= 0n) return json(res, 409, { error:'This settlement has no payable allocation for this category.' });
    const recipient = kind === 'referral' ? new PublicKey(entitlement.recipient)
      : kind === 'creator-wallet' ? new PublicKey(launch.creatorWallet)
      : await chain.ensureVault(mint);
    const withdrawalId = withdrawalIdFor(kind === 'referral' ? `referral-${level}` : kind,
      settled.settlementSignature);
    const ledgerKey = kind === 'referral' ? `${collectionSignature}:${level}` : collectionSignature;
    const payout = buildMintRouterV3DisbursementInstruction({ programId, mint,
      authority:authority.publicKey, creator:launch.creatorWallet, withdrawalId,
      category, amount, recipient });
    const loadProof = signature => loadFunding({ connection, signature, programId, mint,
      authority:authority.publicKey, creator:launch.creatorWallet,
      initialAuthority:launch.pumpFeeRoute.initialAuthority,
      withdrawalId, category, amount, recipient, split:PROTOCOL_FEE_SPLIT });
    const enrollHolderPool = async funded => {
      if (kind !== 'creator-reward' || BigInt(plan.creatorDirected.holderLamports) === 0n) return;
      if (!funded?.balanceDeltaVerified || funded.amount !== String(amount)
        || funded.recipient !== recipient.toBase58())
        throw new Error('Holder pool enrollment requires exact finalized V3 reward funding.');
      if (!rewardStore) throw new Error('V3 holder reward ledger is unavailable.');
      const activatedAt = Number(launch.createdTimestamp);
      const fundedAt = Math.floor(Date.parse(funded.finalizedAt) / 1000);
      if (!Number.isSafeInteger(activatedAt) || activatedAt <= 0
        || !Number.isSafeInteger(fundedAt) || fundedAt < activatedAt)
        throw new Error('Verified launch and funding times are required for holder enrollment.');
      const scheduler = schedulerFactory({ store:rewardStore, chain,
        indexer:{ capture:async () => { throw new Error('Funding enrollment does not capture holder snapshots.'); } } });
      const existingProgram = (await rewardStore.read()).programs?.[mint];
      const qaShort = solanaCluster === 'devnet'
        && env.FUNDED_QA_SHORT_REWARD_PERIODS === 'true'
        && env.FUNDED_QA_HOLDER_MINT === mint;
      if (qaShort) holderFundingMinimumLamports({ mint, periodSeconds:300 },
        { ...env, SOLANA_CLUSTER:'devnet' });
      if (existingProgram && (existingProgram.activatedAt !== activatedAt
        || existingProgram.asset !== 'SOL'))
        throw new Error('Holder schedule conflicts with the verified V3 launch.');
      if (qaShort && existingProgram && ![300, AUTOMATIC_REWARDS.periodSeconds]
        .includes(existingProgram.periodSeconds))
        throw new Error('The QA holder schedule conflicts with an existing reward period.');
      const excludedWallets = [...new Set([
        ...(existingProgram?.excludedWallets || []), recipient.toBase58()])];
      if (!existingProgram || qaShort && existingProgram.periodSeconds !== 300
        || !existingProgram.excludedWallets?.includes(recipient.toBase58())) {
        const firstPeriodStart = qaShort
          ? Math.ceil(Math.max(activatedAt, fundedAt, Math.floor(Date.now() / 1000)) / 300) * 300
          : existingProgram?.firstPeriodStart;
        await scheduler.register({ mint, asset:'SOL', activatedAt,
          excludedWallets,
          ...(existingProgram ? { periodSeconds:existingProgram.periodSeconds,
            sampleIntervalSeconds:existingProgram.sampleIntervalSeconds,
            payoutDelaySeconds:existingProgram.payoutDelaySeconds } : {}),
          ...(qaShort ? { periodSeconds:300, sampleIntervalSeconds:300,
            payoutDelaySeconds:0, firstPeriodStart } : {}) });
      }
      await scheduler.recordFundedPool({ id:`v3:${collectionSignature}`,
        mint, asset:'SOL', amount:plan.creatorDirected.holderLamports,
        fundingSignature:funded.signature, balanceDeltaVerified:true, fundedAt });
    };
    const existing = state[ledger]?.[ledgerKey];
    if (kind === 'referral' && existing && (existing.recipient !== recipient.toBase58()
      || existing.amount !== String(amount) || existing.category !== category))
      return json(res, 409, { error:'The saved V3 payout conflicts with its immutable entitlement.' });
    if (existing?.status === 'finalized') {
      const verified = await loadProof(existing.signature);
      if (!verified) return json(res, 409, { error:'Saved V3 funding lacks finalized proof.' });
      await enrollHolderPool(existing);
      return json(res, 200, existing);
    }
    if (existing?.signature) {
      const funded = await loadProof(existing.signature);
      if (funded) {
        const result = await store.update(current => {
          const row = current[ledger]?.[ledgerKey];
          if (row?.signature !== existing.signature) return null;
          return current[ledger][ledgerKey] = { ...funded,
            collectionSignature, ...(level ? { level } : {}), status:'finalized', finalizedAt:new Date().toISOString() };
        });
        if (!result) return json(res, 409, { error:'Funding state changed during recovery.' });
        await enrollHolderPool(result);
        return json(res, 200, result);
      }
      const retry = await retryState({ connection, signatures:[existing.signature],
        blockhash:existing.blockhash });
      if (!retry.retry) return json(res, 409, { error:retry.reason });
    }
    if (kind === 'referral') {
      const [balance, rentMinimum] = await Promise.all([
        connection.getBalance(recipient, 'finalized'),
        connection.getMinimumBalanceForRentExemption(0, 'finalized'),
      ]);
      if (BigInt(balance) + amount < BigInt(rentMinimum))
        return json(res, 409, { error:'The referral recipient needs a funded Devnet wallet before this small SOL payout can satisfy account rent.',
          recipient:recipient.toBase58(), minimumTopUpLamports:String(BigInt(rentMinimum) - BigInt(balance)) });
    }
    if (!input?.creatorSignedTransaction) {
      const latest = await connection.getLatestBlockhash('finalized');
      return json(res, 202, { status:'awaiting-creator-signature', mint,
        collectionSignature, ...(level ? { level } : {}), amountLamports:String(amount),
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
      const row = current[ledger]?.[ledgerKey];
      let currentEntitlement = entitlement;
      if (kind === 'referral') {
        try { currentEntitlement = v3ReferralEntitlement({ settlement:current.v3Settlements?.[collectionSignature],
          plan:current.v3Settlements?.[collectionSignature]?.allocationPlan, level }); }
        catch { return false; }
      }
      if (current.v3Settlements?.[collectionSignature]?.status !== 'finalized'
        || row?.status === 'finalized' || row?.signature !== existing?.signature
        || kind === 'referral' && (currentEntitlement?.recipient !== entitlement.recipient
          || currentEntitlement?.amount !== entitlement.amount)) return false;
      current[ledger] ||= {};
      current[ledger][ledgerKey] = { status:'verification-pending',
        signature, collectionSignature, mint, category, ...(level ? { level } : {}),
        recipient:recipient.toBase58(), amount:String(amount),
        blockhash:transaction.recentBlockhash, startedAt:new Date().toISOString() };
      return true;
    });
    if (!locked) return json(res, 409, { error:'V3 funding state changed before submission.' });
    const submitted = await submitTransaction({ connection, transaction, authority });
    if (submitted !== signature) throw new Error('Finalized V3 funding signature changed.');
    const funded = await loadProof(submitted);
    if (!funded) throw new Error('Finalized V3 disbursement proof is unavailable; reconcile before retrying.');
    const result = await store.update(current => {
      const row = current[ledger]?.[ledgerKey];
      if (row?.signature !== submitted || row.status !== 'verification-pending') return null;
      return current[ledger][ledgerKey] = { ...funded,
        collectionSignature, ...(level ? { level } : {}), status:'finalized', finalizedAt:new Date().toISOString() };
    });
    if (!result) return json(res, 409, { error:'Finalized funding state changed; reconcile its signature.' });
    await enrollHolderPool(result);
    return json(res, 200, result);
  };
}
