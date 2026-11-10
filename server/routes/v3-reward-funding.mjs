import { isDeepStrictEqual } from 'node:util';
import {ADMIN_EMAIL_AUTHORIZED} from '../admin-email-verification.mjs';
import {prepareManualReferralPayout,verifyManualReferralPayout} from '../manual-referral-payout.mjs';
import { creatorFeeLock } from '../launch-protections.mjs';
import {buildV3PolicyApproval,buildV3PolicyDisbursement} from '../v3-policy-builders.mjs';
import bs58 from 'bs58';
import { PublicKey, Transaction } from '@solana/web3.js';
import {SharedRpcConnection as Connection} from '../rpc-connection.mjs';
import {ensureMintAutomationV3} from '../mint-automation-v3.mjs';
import {deriveMintPolicyV3} from '../../mint-router-v3.js';
import {deriveAgencyPolicyV3} from '../../agency-mint-router-v3.js';
import { buildMintRouterV3DisbursementInstruction } from '../../mint-router-v3.js';
import { buildProtectedMintV3ApprovalInstruction,
  buildProtectedMintV3DisbursementInstruction } from '../../protected-mint-router-v3.js';
import { createAutomaticRewardChain } from '../automatic-reward-chain.mjs';
import { createRewardScheduler } from '../reward-scheduler.mjs';
import { holderFundingMinimumLamports } from '../reward-scheduler.mjs';
import { AUTOMATIC_REWARDS } from '../../automatic-rewards.js';
import { prepareCreatorSettlement, verifyCreatorSettlement,
  submitCreatorSettlement, creatorSettlementRetryState } from '../creator-settlement-transaction.mjs';
import { verifyV3LaunchRouterReadiness, retryUnavailableReadiness, readinessRejection } from '../v3-launch-readiness.mjs';
import { loadFinalizedV3Settlement } from '../v3-settlement-proof.mjs';
import { v3AllocationPlan } from '../v3-allocation-plan.mjs';
import { reconcileV3Allocations } from '../v3-allocation-reconciliation.mjs';
import {reviewV3AllocationResiduals} from '../v3-allocation-residuals.mjs';
import {v3ResidualAllocation,residualDisbursementId} from '../v3-residual-source.mjs';
import { loadFinalizedV3RewardFunding } from '../v3-reward-funding-proof.mjs';
import { v3DisbursementId } from '../v3-disbursement-id.mjs';
import { allowedAuthOrigin } from '../x-auth.mjs';
import { v3ReferralEntitlement } from '../v3-referral-entitlement.mjs';
import { QA_HOLDER_POLICY, qaHolderMinimums, qaShortHolderMintSelected } from '../devnet-qa-minimums.mjs';
import {financialRecordNetwork} from '../financial-network.mjs';

export function createV3RewardFundingRoutes({ body, store, solanaCluster, solanaRpcUrl,
  v3AuthorityKeypair, rewardStore, requireAuthorized = () => false, respond, env = process.env,
  ensureAutomation = ensureMintAutomationV3,
  connectionFactory = url => new Connection(url, 'finalized'),
  verifyReadiness = verifyV3LaunchRouterReadiness,
  rewardChainFactory = createAutomaticRewardChain,
  schedulerFactory = createRewardScheduler,
  loadSettlement = loadFinalizedV3Settlement,
  loadFunding = loadFinalizedV3RewardFunding,
  reviewResiduals = reviewV3AllocationResiduals,
  prepareTransaction = prepareCreatorSettlement,
  verifyTransaction = verifyCreatorSettlement,
  submitTransaction = submitCreatorSettlement,
  retryState = creatorSettlementRetryState,
  originAllowed = allowedAuthOrigin }) {
  const json = (...args) => { respond(...args); return true; };
  return async function handleV3RewardFunding(req, res, url) {
    const automatic=req.method==='POST'&&url.pathname==='/api/keeper/disburse-v3';
    if(automatic&&!requireAuthorized(req,res))return true;
    const automaticInput=automatic?await body(req):null;
    const match = automatic ? [null,String(automaticInput?.mint||''),String(automaticInput?.action||''),
      String(automaticInput?.collectionSignature||''),automaticInput?.level] : req.method === 'POST'
      ? url.pathname.match(/^\/api\/tokens\/([^/]+)\/v3-(community-funding|creator-reward-funding|creator-wallet-payout|referral-payout|operations-payout)\/([^/]+)(?:\/([1-3]))?$/) : null;
    if (!match) return false;
    if(automatic&&(!['community-funding','creator-reward-funding','creator-wallet-payout','referral-payout','operations-payout'].includes(match[2])
      ||env.FUNDED_V3_AUTO_DISBURSEMENT_ENABLED!=='true'))return json(res,503,{error:'Automatic category disbursement is not activated.'});
    const kind = match[2].replace(/-(funding|payout)$/, '');
    if(automatic&&['creator-wallet','referral'].includes(kind))
      return json(res,409,{error:'Creator fees and three-level referral rewards require a manual recipient claim.'});
    const level = kind === 'referral' ? Number(match[4]) : null;
    if (kind === 'referral' && ![1,2,3].includes(level) || kind !== 'referral' && match[4])
      return json(res, 400, { error:'A V3 referral payout requires one level from 1 to 3.' });
    const category = kind === 'community' ? 5 : kind === 'operations' ? 1
      : kind === 'referral' ? level + 1 : 0;
    const ledger = kind === 'community' ? 'v3CommunityFunding'
      : kind === 'creator-reward' ? 'v3CreatorRewardFunding'
      : kind === 'referral' ? 'v3ReferralPayouts'
        : kind === 'operations' ? 'v3OperationsPayout' : 'v3CreatorWalletPayout';
    if (solanaCluster !== 'devnet' || !automatic && !originAllowed(req, env.CORS_ORIGIN)) {
      return json(res, 403, { error:'V3 category disbursement requires the Devnet app origin.' });
    }
    const enabled = kind === 'referral' ? env.FUNDED_V3_REFERRAL_PAYOUT_ENABLED
      : kind === 'operations' ? env.FUNDED_V3_OPERATIONS_PAYOUT_ENABLED
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
    const input = automatic?automaticInput:await body(req);
    const residualHash=input?.residualPlanHash;
    if(residualHash!==undefined&&req[ADMIN_EMAIL_AUTHORIZED]?.path!=='/api/admin/v3-allocations/transfer')
      return json(res,403,{error:'Administrative residual transfers require the admin wallet session and email confirmation.'});
    if(residualHash!==undefined&&(!/^[a-f0-9]{64}$/.test(String(residualHash))
      ||!['creator-wallet','creator-reward'].includes(kind)))
      return json(res,400,{error:'A valid audited residual hash and creator beneficiary are required.'});
    const programId = String(env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID || '').trim();
    const approvedHash = String(env.FUNDED_V3_PROGRAM_DATA_SHA256 || '').trim();
    if (!programId || !/^[a-f0-9]{64}$/i.test(approvedHash)) {
      return json(res, 503, { error:'The approved V3 Devnet program is not configured.' });
    }
    let authority;
    try { authority = v3AuthorityKeypair(); } catch {}
    let state = await store.read();
    const launch = state.launches?.[mint];
    const feeLock = creatorFeeLock(launch);
    if (kind === 'creator-wallet' && feeLock.locked)
      return json(res, 423, { error:feeLock.unlockAt
        ? `Creator SOL fees are locked until ${feeLock.unlockAt} (12 hours after launch).`
        : 'Creator SOL fees are locked pending verification of the launch timestamp.', creatorFeeLock:feeLock });
    const collection = state.collections?.[collectionSignature];
    let settled = state.v3Settlements?.[collectionSignature];
    if (!authority?.publicKey || !launch?.onchainVerified || !financialRecordNetwork(launch,solanaCluster)
      || launch.mint !== mint || launch.pumpFeeRoute?.scope !== 'per-mint-v3'
      || launch.pumpFeeRoute.programId !== programId
      || collection?.mint !== mint || collection.signature !== collectionSignature
      || collection.scope !== 'per-mint-v3' || !financialRecordNetwork(collection,solanaCluster)
      || collection.status !== 'collected' || collection.onchainVerified !== true
      || collection.attribution !== 'mint-verified'
      || collection.programId !== programId || !/^[a-f0-9]{64}$/.test(String(collection.claimId || ''))
      || !financialRecordNetwork(settled,solanaCluster,{legacyDevnet:true})
      || settled?.status !== 'finalized' || settled.collectionSignature !== collectionSignature
      || settled.mint !== mint || settled.allocationPlan?.status !== 'allocated-not-funded') {
      return json(res, 409, { error:'A matching finalized V3 settlement and payable allocation are required.' });
    }
    const connection = connectionFactory(solanaRpcUrl);
    const readiness = await retryUnavailableReadiness(() => verifyReadiness({ connection, programId,cluster:solanaCluster,
      expectedProgramDataSha256:approvedHash, mint,
      creatorWallet:launch.creatorWallet,
      initialAuthority:launch.pumpFeeRoute.initialAuthority, split:launch.pumpFeeRoute.protocolSplit }));
    if (!readiness.ready || readiness.configuredRouter !== collection.router) {
      { const rejection = readinessRejection(readiness); return json(res, rejection.status, { error:rejection.error }); }
    }
    if (kind === 'operations' && !readiness.protectedPolicy)
      return json(res, 409, { error:'Operations funds require the protected V3 on-chain approval policy.' });
    if(residualHash&&!readiness.protectedPolicy)return json(res,409,{error:'Residual transfers require a protected V3 policy.'});
    if (!residualHash && readiness.protectedPolicy && ['creator-wallet','creator-reward'].includes(kind)) {
      try {
        state = await reconcileV3Allocations({store,connection,mint,loadSettlement,cluster:solanaCluster});
        settled = state.v3Settlements[collectionSignature];
      } catch(error) { return json(res,409,{error:String(error.message || error)}); }
    }
    const chain = rewardChainFactory({ connection, programId, authority,cluster:solanaCluster,
      expectedProgramDataSha256:approvedHash });
    if (!(await chain.readiness()).constrainedPayouts) {
      return json(res, 503, { error:'The V3 reward vault program or current authority is not verified.' });
    }
    const proof = await loadSettlement({ connection, signature:settled.settlementSignature,cluster:solanaCluster,
      programId, mint, authority:launch.pumpFeeRoute.initialAuthority,
      creator:launch.creatorWallet, claimId:Buffer.from(collection.claimId, 'hex'),
      expectedLamports:collection.collectedLamports, split:launch.pumpFeeRoute.protocolSplit,
      includePosition:Boolean(residualHash)||settled.allocationPlan?.allocationVersion===2 });
    if (!financialRecordNetwork(proof,solanaCluster,{legacyDevnet:true}) || proof.claimId !== collection.claimId
      || proof.signature !== settled.settlementSignature) {
      return json(res, 409, { error:'Finalized V3 settlement proof is unavailable.' });
    }
    let plan;
    try { plan = v3AllocationPlan({ launch, cluster:solanaCluster, settlement:{ ...proof,
      position:settled.allocationPlan?.allocationVersion===2?proof.position:undefined,programId,
      collectionSignature, settlementSignature:settled.settlementSignature } }); }
    catch { return json(res, 409, { error:'The signed V3 allocation cannot be reconstructed.' }); }
    if (!isDeepStrictEqual(plan, settled.allocationPlan)) {
      return json(res, 409, { error:'The saved V3 allocation differs from finalized chain evidence.' });
    }
    const originalPlan=plan;
    let residual=null;
    if(residualHash){
      try{
        if(!proof.position)throw new Error('Finalized cumulative settlement position is required.');
        residual=v3ResidualAllocation({state,collectionSignature,residualPlanHash:residualHash,
          canonicalTarget:v3AllocationPlan({launch,settlement:{...proof,programId,collectionSignature,
            settlementSignature:settled.settlementSignature}})});
        plan=residual.allocation;
      }catch(error){return json(res,409,{error:String(error.message||error)});}
    }
    let entitlement = null;
    if (kind === 'referral') {
      try { entitlement = v3ReferralEntitlement({ settlement:settled, plan, level }); }
      catch { return json(res, 409, { error:'The V3 referral attribution is invalid.' }); }
      if (!entitlement) return json(res, 409, { error:'No inviter frozen at the first qualified V3 fee event has a payable allocation for this level.' });
    }
    const amount = kind === 'referral' ? BigInt(entitlement.amount)
      : kind === 'operations' ? BigInt(plan.protocol.operationsLamports)
      : kind === 'community' ? BigInt(plan.protocol.communityLamports)
      : kind === 'creator-reward' ? BigInt(plan.creatorDirected.holderLamports)
        + BigInt(plan.creatorDirected.xLamports)
        : BigInt(plan.creatorDirected.walletLamports);
    if (amount <= 0n) return json(res, 409, { error:'This settlement has no payable allocation for this category.' });
    let operationsRecipient;
    if (kind === 'operations') {
      try { operationsRecipient = new PublicKey(env.FUNDED_V3_OPERATIONS_RECIPIENT); }
      catch { return json(res, 503, { error:'The approved Devnet operations recipient is not configured.' }); }
    }
    const recipient = kind === 'referral' ? new PublicKey(entitlement.recipient)
      : kind === 'operations' ? operationsRecipient
      : kind === 'creator-wallet' ? new PublicKey(launch.creatorWallet)
      : await chain.ensureVault(mint);
    const withdrawalId = residualHash?residualDisbursementId(kind,settled.settlementSignature,residualHash)
      :v3DisbursementId(kind === 'referral' ? `referral-${level}` : kind,settled.settlementSignature);
    const ledgerKey = residual?.ledgerKey||(kind === 'referral' ? `${collectionSignature}:${level}` : collectionSignature);
    const residualMetadata=residualHash?{residualPlanHash:residualHash}:{};
    const protectedPolicy = readiness.protectedPolicy === true;
    const recipientClaim=kind==='referral'&&!automatic;
    const claimIntent={mint,collectionSignature,level,recipient:recipient.toBase58(),amount:String(amount)};
    const operatorSigned=automatic||recipientClaim;
    if(recipientClaim&&!protectedPolicy)return json(res,409,{error:'Manual referral delivery requires a verified protected policy.'});
    if(operatorSigned&&!protectedPolicy)return json(res,409,{error:'Automatic payouts require protected on-chain shares.'});
    const beneficiary = kind === 'creator-wallet' ? 0 : kind === 'creator-reward' ? 1
      : category + 2;
    const holderAmount = kind === 'creator-reward'
      ? BigInt(plan.creatorDirected.holderLamports) : 0n;
    const payoutInput = { programId, mint, authority:authority.publicKey,
      creator:launch.creatorWallet, withdrawalId, category, amount, recipient,split:launch.pumpFeeRoute.protocolSplit,auto:operatorSigned };
    const payout = protectedPolicy
      ? buildV3PolicyDisbursement({ ...payoutInput, beneficiary, holderAmount })
      : buildMintRouterV3DisbursementInstruction(payoutInput);
    const approval = protectedPolicy && ['referral','operations'].includes(kind)
      ? buildV3PolicyApproval({ ...payoutInput, beneficiary }) : null;
    const payoutInstructions = approval ? [approval.instruction, payout.instruction]
      : payout.instruction;
    const loadProof = async signature => {
      const proof=await loadFunding({ connection, signature, programId, mint,cluster:solanaCluster,
      authority:authority.publicKey, creator:launch.creatorWallet,
      initialAuthority:launch.pumpFeeRoute.initialAuthority,
      withdrawalId, category, amount, recipient, split:launch.pumpFeeRoute.protocolSplit,
        protectedPolicy, beneficiary, holderAmount });
      return financialRecordNetwork(proof,solanaCluster,{legacyDevnet:true})?proof:null;
    };
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
      const qaShort = qaShortHolderMintSelected(mint, solanaCluster, env);
      const qaMinimums = qaHolderMinimums(mint, solanaCluster, env);
      const eligibilityPolicy = qaMinimums ? QA_HOLDER_POLICY : 'usd-20-hourly-v1';
      if (qaShort) holderFundingMinimumLamports({ mint, periodSeconds:300,
        eligibilityPolicy, qaMinimums },
        { ...env, SOLANA_CLUSTER:'devnet' });
      if (existingProgram && (existingProgram.activatedAt !== activatedAt
        || existingProgram.asset !== 'SOL'))
        throw new Error('Holder schedule conflicts with the verified V3 launch.');
      if (qaShort && existingProgram && ![300, 3600, 86400]
        .includes(existingProgram.periodSeconds))
        throw new Error('The QA holder schedule conflicts with an existing reward period.');
      const periodSeconds = qaShort ? 300 : AUTOMATIC_REWARDS.periodSeconds;
      const excludedWallets = [...new Set([
        ...(existingProgram?.excludedWallets || []), recipient.toBase58()])];
      if (!existingProgram || existingProgram.periodSeconds !== periodSeconds
        || existingProgram.eligibilityPolicy !== eligibilityPolicy
        || JSON.stringify(existingProgram.qaMinimums || null) !== JSON.stringify(qaMinimums)
        || !existingProgram.excludedWallets?.includes(recipient.toBase58())) {
        const firstPeriodStart = !existingProgram || existingProgram.periodSeconds !== periodSeconds
          || existingProgram.eligibilityPolicy !== eligibilityPolicy
          || JSON.stringify(existingProgram.qaMinimums || null) !== JSON.stringify(qaMinimums)
          ? Math.ceil(Math.max(activatedAt, fundedAt, Math.floor(Date.now() / 1000)) / periodSeconds) * periodSeconds
          : existingProgram.firstPeriodStart;
        await scheduler.register({ mint, asset:'SOL', activatedAt,
          excludedWallets, eligibilityPolicy, qaMinimums,
          periodSeconds, sampleIntervalSeconds:qaShort ? 60 : AUTOMATIC_REWARDS.sampleIntervalSeconds,
          payoutDelaySeconds:0, firstPeriodStart });
      }
      await scheduler.recordFundedPool({ id:`v3:${ledgerKey}`,
        mint, asset:'SOL', amount:plan.creatorDirected.holderLamports,
        fundingSignature:funded.signature, balanceDeltaVerified:true, fundedAt });
    };
    const existing = state[ledger]?.[ledgerKey];
    if(existing&&!financialRecordNetwork(existing,solanaCluster,{legacyDevnet:true}))
      return json(res,409,{error:'The saved payout belongs to a different network.'});
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
            collectionSignature, ...residualMetadata, ...(level ? { level } : {}), status:'finalized', finalizedAt:new Date().toISOString() };
        });
        if (!result) return json(res, 409, { error:'Funding state changed during recovery.' });
        await enrollHolderPool(result);
        return json(res, 200, result);
      }
      const retry = await retryState({ connection, signatures:[existing.signature],
        blockhash:existing.blockhash,receiptAddress:existing.receiptAddress,lastValidBlockHeight:existing.lastValidBlockHeight });
      if (!retry.retry) return json(res, 409, { error:retry.reason });
    }
    if(recipientClaim){
      if(!input.recipientSignature){
        const claim=await prepareManualReferralPayout(store,claimIntent);
        return json(res,202,{status:'awaiting-recipient-signature',...claim});
      }
      try{verifyManualReferralPayout(await store.read(),claimIntent,input);}
      catch(error){return json(res,401,{error:error.message});}
    }
    if(operatorSigned){
      await ensureAutomation({connection,authority,programId,mint,creator:launch.creatorWallet,
        policy:(launch.pumpFeeRoute.protocolSplit?.agencyPercent!==undefined?deriveAgencyPolicyV3:deriveMintPolicyV3)(programId,mint).address,
        recipients:[env.FUNDED_V3_OPERATIONS_RECIPIENT,...[0,1,2].map(index=>settled.referralUpline?.[index]||PublicKey.default)]});
    }
    const financialBaseline=residual?structuredClone({wallet:state.v3CreatorWalletPayout||{},reward:state.v3CreatorRewardFunding||{}}):null;
    if(residual){
      try{
        const reviewed=await reviewResiduals({store,connection,mint,loadSettlement,loadFunding,cluster:solanaCluster,
          ignorePendingResidual:existing?.signature?{bucket:ledger,key:ledgerKey,signature:existing.signature}:null});
        const source=reviewed.sources.find(row=>row.collectionSignature===collectionSignature);
        const indexes=kind==='creator-wallet'?[0]:[1,2];
        if(!source||!isDeepStrictEqual(source.target,residual.source.target)
          ||indexes.some(index=>source.unreleasedLamports[index]!==residual.source.unreleasedLamports[index]))
          throw new Error('The reviewed residual is no longer fully unpaid; review its current balances.');
      }catch(error){return json(res,409,{error:String(error.message||error)});}
    }
    if (kind === 'referral' || kind === 'operations') {
      const [balance, rentMinimum] = await Promise.all([
        connection.getBalance(recipient, 'finalized'),
        connection.getMinimumBalanceForRentExemption(0, 'finalized'),
      ]);
      if (BigInt(balance) + amount < BigInt(rentMinimum))
        return json(res, 409, { error:'The payout recipient needs a funded Devnet wallet before this small SOL payout can satisfy account rent.',
          recipient:recipient.toBase58(), minimumTopUpLamports:String(BigInt(rentMinimum) - BigInt(balance)) });
    }
    if (!operatorSigned&&!input?.creatorSignedTransaction) {
      const latest = await connection.getLatestBlockhash('finalized');
      return json(res, 202, { status:'awaiting-creator-signature', mint,
        collectionSignature, ...residualMetadata, ...(level ? { level } : {}), amountLamports:String(amount),
        recipient:recipient.toBase58(),
        transaction:prepareTransaction({ instruction:payoutInstructions,
          authority:authority.publicKey, blockhash:latest.blockhash }),
        lastValidBlockHeight:latest.lastValidBlockHeight });
    }
    const latest=operatorSigned?await connection.getLatestBlockhash('finalized'):null;
    const transaction = operatorSigned ? new Transaction({feePayer:authority.publicKey,
      recentBlockhash:latest.blockhash})
      .add(...(Array.isArray(payoutInstructions)?payoutInstructions:[payoutInstructions]))
      : verifyTransaction({ signedTransaction:input.creatorSignedTransaction,
        instruction:payoutInstructions, authority:authority.publicKey,creator:launch.creatorWallet });
    transaction.partialSign(authority);
    const signature = bs58.encode(transaction.signature);
    const locked = await store.update(current => {
      if(recipientClaim)verifyManualReferralPayout(current,claimIntent,input);
      const row = current[ledger]?.[ledgerKey];
      let currentEntitlement = entitlement;
      if (kind === 'referral') {
        try { currentEntitlement = v3ReferralEntitlement({ settlement:current.v3Settlements?.[collectionSignature],
          plan:current.v3Settlements?.[collectionSignature]?.allocationPlan, level }); }
        catch { return false; }
      }
      if (current.v3Settlements?.[collectionSignature]?.status !== 'finalized'
        || !isDeepStrictEqual(current.v3Settlements[collectionSignature].allocationPlan,originalPlan)
        ||residual&&(!isDeepStrictEqual(current.v3AllocationResidualPlans?.[residualHash],residual.approval)
          ||!isDeepStrictEqual(current.v3CreatorWalletPayout||{},financialBaseline.wallet)
          ||!isDeepStrictEqual(current.v3CreatorRewardFunding||{},financialBaseline.reward))
        || row?.status === 'finalized' || row?.signature !== existing?.signature
        || kind === 'referral' && (currentEntitlement?.recipient !== entitlement.recipient
          || currentEntitlement?.amount !== entitlement.amount)) return false;
      current[ledger] ||= {};
      current[ledger][ledgerKey] = { status:'verification-pending',
        signature, collectionSignature, ...residualMetadata, mint, category, ...(level ? { level } : {}),
        recipient:recipient.toBase58(), amount:String(amount),
        cluster:solanaCluster,programId,signedTransaction:transaction.serialize().toString('base64'),
        receiptAddress:payout.withdrawal.toBase58(),...(latest?{lastValidBlockHeight:latest.lastValidBlockHeight}:{}),
        blockhash:transaction.recentBlockhash, startedAt:new Date().toISOString() };
      return true;
    });
    if (!locked) return json(res, 409, { error:'V3 funding state changed before submission.' });
    const submitted = await submitTransaction({ connection, transaction, authority, automatic:operatorSigned });
    if (submitted !== signature) throw new Error('Finalized V3 funding signature changed.');
    const funded = await loadProof(submitted);
    if (!funded) throw new Error('Finalized V3 disbursement proof is unavailable; reconcile before retrying.');
    const result = await store.update(current => {
      const row = current[ledger]?.[ledgerKey];
      if (row?.signature !== submitted || row.status !== 'verification-pending') return null;
      return current[ledger][ledgerKey] = { ...funded,
        collectionSignature, ...residualMetadata, ...(level ? { level } : {}), status:'finalized', finalizedAt:new Date().toISOString() };
    });
    if (!result) return json(res, 409, { error:'Finalized funding state changed; reconcile its signature.' });
    await enrollHolderPool(result);
    return json(res, 200, result);
  };
}
