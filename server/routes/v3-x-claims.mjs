import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { Connection, PublicKey } from '@solana/web3.js';
import { createAutomaticRewardChain, rewardAddresses } from '../automatic-reward-chain.mjs';
import { createRewardScheduler } from '../reward-scheduler.mjs';
import { loadFinalizedV3Settlement } from '../v3-settlement-proof.mjs';
import { loadFinalizedV3RewardFunding } from '../v3-reward-funding-proof.mjs';
import { v3AllocationPlan } from '../v3-allocation-plan.mjs';
import { allowedAuthOrigin } from '../x-auth.mjs';
import { verifyMintPolicyV3Account } from '../../mint-router-v3.js';
import {parseV3SourceKey,v3ResidualAllocation,residualDisbursementId} from '../v3-residual-source.mjs';
import {financialRecordNetwork} from '../financial-network.mjs';
import {SOLANA_GENESIS} from '../../solana-network.js';

const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
// Both the X identity and the receiving wallet must already be signed in.
// A claim binds that wallet once; the app signs and funds the payout fees.
export function createV3XClaimRoutes({ store, rewardStore, xSession,
  referralSession = async () => null, v3AuthorityKeypair, solanaCluster, solanaRpcUrl,
  respond, env = process.env,
  connectionFactory = url => new Connection(url, 'finalized'),
  rewardChainFactory = createAutomaticRewardChain,
  schedulerFactory = createRewardScheduler,
  loadSettlement = loadFinalizedV3Settlement,
  loadFunding = loadFinalizedV3RewardFunding,
  verifyPolicy = verifyMintPolicyV3Account,
  originAllowed = allowedAuthOrigin }) {
  const json = (...args) => { respond(...args); return true; };
  return async function handleV3XClaims(req, res, url) {
    const match = req.method === 'POST' ? url.pathname.match(
      /^\/api\/tokens\/([^/]+)\/v3-x-claim\/([^/]+)\/(prepare|verify|execute)$/) : null;
    if (!match) return false;
    if (solanaCluster !== 'devnet' || !originAllowed(req, env.CORS_ORIGIN))
      return json(res, 403, { error:'V3 X claims require the Devnet app origin.' });
    if (env.FUNDED_V3_X_CLAIMS_ENABLED !== 'true')
      return json(res, 503, { error:'V3 X claims are not activated.' });
    let mint;
    try { mint = new PublicKey(decodeURIComponent(match[1])).toBase58(); }
    catch { return json(res, 400, { error:'A valid V3 mint is required.' }); }
    let sourceIdentity;
    try{sourceIdentity=parseV3SourceKey(decodeURIComponent(match[2]));}catch{}
    if (!sourceIdentity)
      return json(res, 400, { error:'A valid V3 collection signature is required.' });
    const {collectionSignature,ledgerKey:claimKey,residualPlanHash}=sourceIdentity;
    const session = await xSession(req);
    if (!/^\d{1,24}$/.test(String(session?.user?.id || '')))
      return json(res, 401, { error:'Sign in with the selected X account.' });
    const walletSession = await referralSession(req);
    if (!walletSession?.wallet || !Number.isFinite(walletSession.expiresAt) || walletSession.expiresAt <= Date.now())
      return json(res, 401, { error:'Sign in with your receiving wallet to claim this reward.' });
    const wallet = walletSession.wallet;
    const state = await store.read();
    const launch = state.launches?.[mint];
    const collection = state.collections?.[collectionSignature];
    const settled = state.v3Settlements?.[collectionSignature];
    const funding = state.v3CreatorRewardFunding?.[claimKey];
    const programId = String(env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID || '');
    const approvedHash = String(env.FUNDED_V3_PROGRAM_DATA_SHA256 || '');
    if (!launch?.onchainVerified || !financialRecordNetwork(launch,solanaCluster) || launch.mint !== mint
      || launch.pumpFeeRoute?.scope !== 'per-mint-v3'
      || launch.pumpFeeRoute.programId !== programId
      || String(launch.xUserId) !== String(session.user.id)
      || collection?.mint !== mint || collection.signature !== collectionSignature
      || !financialRecordNetwork(collection,solanaCluster) || collection.scope !== 'per-mint-v3'
      || collection.status !== 'collected' || collection.onchainVerified !== true
      || collection.attribution !== 'mint-verified' || collection.programId !== programId
      || !/^[a-f0-9]{64}$/.test(String(collection.claimId || ''))
      || !financialRecordNetwork(settled,solanaCluster,{legacyDevnet:true}) || settled?.status !== 'finalized' || settled.mint !== mint
      || settled.collectionSignature !== collectionSignature
      || !financialRecordNetwork(funding,solanaCluster,{legacyDevnet:true}) || funding?.status !== 'finalized' || funding.mint !== mint
      ||residualPlanHash&&funding.residualPlanHash!==residualPlanHash
      || !SIGNATURE.test(String(funding.signature || ''))
      || !/^[a-f0-9]{64}$/i.test(approvedHash))
      return json(res, 409, { error:'A matching finalized V3 X allocation and funding record are required.' });
    if (state.v3XClaims?.[claimKey]?.wallet && state.v3XClaims[claimKey].wallet !== wallet)
      return json(res, 403, { error:'This X reward is already bound to another wallet.' });
    let authority;
    try { authority = v3AuthorityKeypair(); } catch {}
    if (!authority?.publicKey || authority.publicKey.toBase58() !== launch.pumpFeeRoute.initialAuthority)
      return json(res, 503, { error:'The approved V3 reward authority is unavailable.' });
    const connection = connectionFactory(solanaRpcUrl);
    const chain = rewardChainFactory({ connection, programId, authority,cluster:solanaCluster,
      expectedProgramDataSha256:approvedHash });
    if (!(await chain.readiness()).constrainedPayouts)
      return json(res, 503, { error:'The approved V3 payout program is not verified.' });
    const settlement = await loadSettlement({ connection,cluster:solanaCluster,
      signature:settled.settlementSignature, programId, mint,
      authority:launch.pumpFeeRoute.initialAuthority,
      creator:launch.creatorWallet, claimId:Buffer.from(collection.claimId, 'hex'),
      expectedLamports:collection.collectedLamports, split:launch.pumpFeeRoute.protocolSplit,
      includePosition:Boolean(residualPlanHash)||settled.allocationPlan?.allocationVersion === 2 });
    if (!financialRecordNetwork(settlement,solanaCluster,{legacyDevnet:true}) || settlement.signature !== settled.settlementSignature)
      return json(res, 409, { error:'Finalized V3 settlement proof is unavailable.' });
    let plan;
    try { plan = v3AllocationPlan({ launch, cluster:solanaCluster,settlement:{ ...settlement,
      position:settled.allocationPlan?.allocationVersion===2?settlement.position:undefined,programId,
      collectionSignature, settlementSignature:settled.settlementSignature } }); }
    catch { return json(res, 409, { error:'The V3 X allocation cannot be reconstructed.' }); }
    if (!isDeepStrictEqual(plan, settled.allocationPlan))return json(res,409,{error:'The original V3 allocation differs from signed source evidence.'});
    if(residualPlanHash){
      try{if(!settlement.position)throw new Error('Finalized cumulative settlement position is required.');
        plan=v3ResidualAllocation({state,collectionSignature,residualPlanHash,
        canonicalTarget:v3AllocationPlan({launch,cluster:solanaCluster,settlement:{...settlement,programId,collectionSignature,
          settlementSignature:settled.settlementSignature}})}).allocation;}
      catch{return json(res,409,{error:'The audited residual X allocation cannot be verified.'});}
    }
    if (plan.creatorDirected.xUserId !== String(session.user.id)
      || BigInt(plan.creatorDirected.xLamports) <= 0n)
      return json(res, 409, { error:'The stored V3 X allocation differs from the signed launch policy.' });
    const amount = BigInt(plan.creatorDirected.holderLamports)
      + BigInt(plan.creatorDirected.xLamports);
    const policy = await verifyPolicy({ connection, programId, mint,
      creator:launch.creatorWallet, initialAuthority:launch.pumpFeeRoute.initialAuthority,
      split:launch.pumpFeeRoute.protocolSplit });
    if (!policy.verified || residualPlanHash&&!policy.protectedPolicy) return json(res, 409, {
      error:'The immutable V3 creator fee policy is not verified.' });
    const withdrawalId = residualPlanHash?residualDisbursementId('creator-reward',settled.settlementSignature,residualPlanHash)
      :createHash('sha256').update(`funded.v3.creator-reward-funding.v1:${settled.settlementSignature}`).digest();
    const { vault } = rewardAddresses({ programId, authority:authority.publicKey, mint });
    if (funding.amount !== String(amount) || funding.recipient !== vault.toBase58())
      return json(res, 409, { error:'The recorded V3 reward funding does not match its allocation.' });
    const proof = await loadFunding({ connection, cluster:solanaCluster,signature:funding.signature,
      programId, mint, authority:authority.publicKey, creator:launch.creatorWallet,
      initialAuthority:launch.pumpFeeRoute.initialAuthority, withdrawalId,
      category:0, amount, recipient:vault,
      split:launch.pumpFeeRoute.protocolSplit,
      protectedPolicy:policy.protectedPolicy, beneficiary:1,
      holderAmount:BigInt(plan.creatorDirected.holderLamports) });
    if (!financialRecordNetwork(proof,solanaCluster,{legacyDevnet:true}) || !proof?.balanceDeltaVerified || proof.signature !== funding.signature
      || proof.amount !== String(amount))
      return json(res, 409, { error:'Finalized V3 reward-vault funding proof is unavailable.' });
    // RPC verification can be slow. Recheck both sessions before binding funds.
    const [currentX, currentWallet] = await Promise.all([xSession(req), referralSession(req)]);
    if (String(currentX?.user?.id || '') !== String(session.user.id)
      || currentWallet?.wallet !== wallet || !Number.isFinite(currentWallet?.expiresAt)
      || currentWallet.expiresAt <= Date.now())
      return json(res, 401, { error:'Your sign-in changed or expired. Sign in again to claim.' });
    const claim = await store.update(current => {
      if (currentWallet.expiresAt <= Date.now()
        || !isDeepStrictEqual(current.launches?.[mint], launch)
        || !isDeepStrictEqual(current.v3Settlements?.[collectionSignature], settled)
        || !isDeepStrictEqual(current.v3CreatorRewardFunding?.[claimKey], funding)) return null;
      current.v3XClaims ||= {};
      const prior = current.v3XClaims[claimKey];
      if (prior && (!financialRecordNetwork(prior, solanaCluster, {legacyDevnet:true})
        || prior.mint !== mint || prior.xUserId !== String(session.user.id)
        || prior.amountLamports !== plan.creatorDirected.xLamports
        || prior.fundingSignature !== funding.signature || prior.wallet && prior.wallet !== wallet)) return null;
      const row = prior || {
        cluster:solanaCluster, genesisHash:SOLANA_GENESIS[solanaCluster],
        collectionSignature:claimKey, sourceCollectionSignature:collectionSignature,
        ...(residualPlanHash ? {residualPlanHash} : {}), mint, xUserId:String(session.user.id),
        amountLamports:plan.creatorDirected.xLamports, fundingSignature:funding.signature,
        createdAt:new Date().toISOString(),
      };
      row.wallet = wallet;
      row.status = ['paid','verification-pending'].includes(row.status) ? row.status : 'ready';
      row.verifiedAt ||= new Date().toISOString();
      current.v3XClaims[claimKey] = row;
      return structuredClone(row);
    });
    if (!claim) return json(res, 409, {error:'The X reward or receiving wallet changed. Refresh before retrying.'});
    // Older clients may still call these steps; no new signature is requested.
    if (match[3] !== 'execute') return json(res, 200, {status:claim.status,
      wallet:claim.wallet, amountLamports:claim.amountLamports});
    const fundedAt = Math.floor(Date.parse(funding.finalizedAt) / 1000);
    if (!Number.isSafeInteger(fundedAt) || fundedAt <= 0)
      return json(res, 409, { error:'The finalized V3 funding time is unavailable.' });
    const scheduler = schedulerFactory({ store:rewardStore, chain,
      indexer:{ capture:async () => { throw new Error('X payouts do not use holder indexing.'); } } });
    const schedule = await scheduler.recordDirectFunded({ kind:'x',
      id:claimKey, mint, recipient:claim.wallet, asset:'SOL',
      amount:claim.amountLamports, fundingSignature:funding.signature,
      balanceDeltaVerified:true, fundedAt });
    if (schedule.mint !== mint || schedule.manifest.leaves[0]?.recipient !== claim.wallet
      || schedule.manifest.totalAmount !== claim.amountLamports)
      return json(res, 409, { error:'The immutable X reward manifest conflicts with this claim.' });
    await scheduler.execute(Math.floor(Date.now() / 1000), [schedule.id]);
    const paid = (await rewardStore.read()).schedules?.[schedule.id];
    const payment = paid?.payments?.[claim.wallet];
    if(payment?.status==='awaiting-recipient-funding')return json(res,409,{
      status:payment.status,code:'RECIPIENT_RENT_REQUIRED',error:payment.reason,
      minimumFundingLamports:payment.minimumFundingLamports,
    });
    if (paid?.status !== 'paid' || payment?.status !== 'paid'
      || !payment.balanceDeltaVerified || !payment.finalized)
      return json(res, 503, { error:'X payout is pending finalized on-chain verification.' });
    const result = await store.update(current => {
      const row = current.v3XClaims?.[claimKey];
      if (!row || row.wallet !== claim.wallet || row.xUserId !== claim.xUserId) return null;
      row.status = 'paid'; row.payment = payment;
      row.paidAt ||= new Date().toISOString();
      return row;
    });
    return result ? json(res, 200, { status:'paid', mint, collectionSignature:claimKey, wallet:result.wallet,
      amountLamports:result.amountLamports, payment:result.payment })
      : json(res, 409, { error:'The V3 X claim changed after finalized payout.' });
  };
}
