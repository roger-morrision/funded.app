import { createHash, randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import nacl from 'tweetnacl';
import { Connection, PublicKey } from '@solana/web3.js';
import { createAutomaticRewardChain, rewardAddresses } from '../automatic-reward-chain.mjs';
import { createRewardScheduler } from '../reward-scheduler.mjs';
import { loadFinalizedV3Settlement } from '../v3-settlement-proof.mjs';
import { loadFinalizedV3RewardFunding } from '../v3-reward-funding-proof.mjs';
import { v3AllocationPlan } from '../v3-allocation-plan.mjs';
import { allowedAuthOrigin } from '../x-auth.mjs';
import { verifyMintPolicyV3Account } from '../../mint-router-v3.js';

const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const CLAIM_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;

export function v3XClaimStatement(claim, wallet) {
  return `funded.app V3 SOL reward ${claim.collectionSignature} mint ${claim.mint} X user ${claim.xUserId} wallet ${wallet} nonce ${claim.nonce}`;
}

// The X OAuth subject, creator-approved allocation, finalized category-0
// transfer, and recipient wallet signature must all agree before enrollment.
export function createV3XClaimRoutes({ body, store, rewardStore, xSession,
  walletSignature, v3AuthorityKeypair, solanaCluster, solanaRpcUrl,
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
    const collectionSignature = decodeURIComponent(match[2]);
    if (!SIGNATURE.test(collectionSignature))
      return json(res, 400, { error:'A valid V3 collection signature is required.' });
    const session = await xSession(req);
    if (!/^\d{1,24}$/.test(String(session?.user?.id || '')))
      return json(res, 401, { error:'Sign in with the selected X account.' });
    const state = await store.read();
    const launch = state.launches?.[mint];
    const collection = state.collections?.[collectionSignature];
    const settled = state.v3Settlements?.[collectionSignature];
    const funding = state.v3CreatorRewardFunding?.[collectionSignature];
    const programId = String(env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID || '');
    const approvedHash = String(env.FUNDED_V3_PROGRAM_DATA_SHA256 || '');
    if (!launch?.onchainVerified || launch.cluster !== 'devnet' || launch.mint !== mint
      || launch.pumpFeeRoute?.scope !== 'per-mint-v3'
      || launch.pumpFeeRoute.programId !== programId
      || String(launch.xUserId) !== String(session.user.id)
      || collection?.mint !== mint || collection.signature !== collectionSignature
      || collection.cluster !== 'devnet' || collection.scope !== 'per-mint-v3'
      || collection.status !== 'collected' || collection.onchainVerified !== true
      || collection.attribution !== 'mint-verified' || collection.programId !== programId
      || !/^[a-f0-9]{64}$/.test(String(collection.claimId || ''))
      || settled?.status !== 'finalized' || settled.mint !== mint
      || settled.collectionSignature !== collectionSignature
      || funding?.status !== 'finalized' || funding.mint !== mint
      || !SIGNATURE.test(String(funding.signature || ''))
      || !/^[a-f0-9]{64}$/i.test(approvedHash))
      return json(res, 409, { error:'A matching finalized V3 X allocation and funding record are required.' });
    let authority;
    try { authority = v3AuthorityKeypair(); } catch {}
    if (!authority?.publicKey || authority.publicKey.toBase58() !== launch.pumpFeeRoute.initialAuthority)
      return json(res, 503, { error:'The approved V3 reward authority is unavailable.' });
    const connection = connectionFactory(solanaRpcUrl);
    const chain = rewardChainFactory({ connection, programId, authority,
      expectedProgramDataSha256:approvedHash });
    if (!(await chain.readiness()).constrainedPayouts)
      return json(res, 503, { error:'The approved V3 payout program is not verified.' });
    const settlement = await loadSettlement({ connection,
      signature:settled.settlementSignature, programId, mint,
      authority:launch.pumpFeeRoute.initialAuthority,
      creator:launch.creatorWallet, claimId:Buffer.from(collection.claimId, 'hex'),
      expectedLamports:collection.collectedLamports, split:launch.pumpFeeRoute.protocolSplit,
      includePosition:settled.allocationPlan?.allocationVersion === 2 });
    if (!settlement || settlement.signature !== settled.settlementSignature)
      return json(res, 409, { error:'Finalized V3 settlement proof is unavailable.' });
    let plan;
    try { plan = v3AllocationPlan({ launch, settlement:{ ...settlement, programId,
      collectionSignature, settlementSignature:settled.settlementSignature } }); }
    catch { return json(res, 409, { error:'The V3 X allocation cannot be reconstructed.' }); }
    if (!isDeepStrictEqual(plan, settled.allocationPlan)
      || plan.creatorDirected.xUserId !== String(session.user.id)
      || BigInt(plan.creatorDirected.xLamports) <= 0n)
      return json(res, 409, { error:'The stored V3 X allocation differs from the signed launch policy.' });
    const amount = BigInt(plan.creatorDirected.holderLamports)
      + BigInt(plan.creatorDirected.xLamports);
    const policy = await verifyPolicy({ connection, programId, mint,
      creator:launch.creatorWallet, initialAuthority:launch.pumpFeeRoute.initialAuthority,
      split:launch.pumpFeeRoute.protocolSplit });
    if (!policy.verified) return json(res, 409, {
      error:'The immutable V3 creator fee policy is not verified.' });
    const withdrawalId = createHash('sha256')
      .update(`funded.v3.creator-reward-funding.v1:${settled.settlementSignature}`).digest();
    const { vault } = rewardAddresses({ programId, authority:authority.publicKey, mint });
    if (funding.amount !== String(amount) || funding.recipient !== vault.toBase58())
      return json(res, 409, { error:'The recorded V3 reward funding does not match its allocation.' });
    const proof = await loadFunding({ connection, signature:funding.signature,
      programId, mint, authority:authority.publicKey, creator:launch.creatorWallet,
      initialAuthority:launch.pumpFeeRoute.initialAuthority, withdrawalId,
      category:0, amount, recipient:vault,
      split:launch.pumpFeeRoute.protocolSplit,
      protectedPolicy:policy.protectedPolicy, beneficiary:1,
      holderAmount:BigInt(plan.creatorDirected.holderLamports) });
    if (!proof?.balanceDeltaVerified || proof.signature !== funding.signature
      || proof.amount !== String(amount))
      return json(res, 409, { error:'Finalized V3 reward-vault funding proof is unavailable.' });
    const claim = state.v3XClaims?.[collectionSignature];
    if (match[3] === 'prepare') {
      const input = await body(req);
      let requestedWallet;
      try { requestedWallet = new PublicKey(input.wallet).toBase58(); }
      catch { return json(res, 400, { error:'A valid recipient wallet is required.' }); }
      const prepared = await store.update(current => {
        current.v3XClaims ||= {};
        const existing = current.v3XClaims[collectionSignature];
        if (existing && (existing.mint !== mint || existing.xUserId !== String(session.user.id)
          || existing.amountLamports !== plan.creatorDirected.xLamports
          || existing.fundingSignature !== funding.signature)) return null;
        if (existing && (existing.wallet || Date.parse(existing.expiresAt) > Date.now()))
          return existing;
        return current.v3XClaims[collectionSignature] = {
          collectionSignature, mint, xUserId:String(session.user.id),
          amountLamports:plan.creatorDirected.xLamports,
          fundingSignature:funding.signature, wallet:null,
          nonce:randomBytes(24).toString('hex'), status:'awaiting-wallet',
          createdAt:new Date().toISOString(),
          expiresAt:new Date(Date.now() + CLAIM_LIFETIME_MS).toISOString(),
        };
      });
      return prepared ? json(res, 200, { status:prepared.status,
        amountLamports:prepared.amountLamports, wallet:prepared.wallet || null,
        statement:prepared.wallet ? null : v3XClaimStatement(prepared, requestedWallet),
        expiresAt:prepared.expiresAt })
        : json(res, 409, { error:'The V3 X claim changed during preparation.' });
    }
    if (!claim || claim.mint !== mint || claim.xUserId !== String(session.user.id)
      || claim.amountLamports !== plan.creatorDirected.xLamports
      || claim.fundingSignature !== funding.signature)
      return json(res, 409, { error:'Prepare the matching V3 X claim first.' });
    if (match[3] === 'verify') {
      const input = await body(req);
      let wallet;
      try { wallet = new PublicKey(input.wallet).toBase58(); }
      catch { return json(res, 400, { error:'A valid recipient wallet is required.' }); }
      if (claim.wallet && claim.wallet !== wallet)
        return json(res, 409, { error:'This X claim is bound to another wallet.' });
      if (!claim.wallet && Date.parse(claim.expiresAt) <= Date.now())
        return json(res, 409, { error:'The wallet challenge expired; prepare a new one.' });
      let signature;
      try { signature = walletSignature(input.signature); }
      catch { return json(res, 400, { error:'A valid wallet signature is required.' }); }
      if (!nacl.sign.detached.verify(new TextEncoder().encode(v3XClaimStatement(claim, wallet)),
        signature, new PublicKey(wallet).toBytes()))
        return json(res, 401, { error:'The recipient wallet signature is invalid.' });
      const bound = await store.update(current => {
        const row = current.v3XClaims?.[collectionSignature];
        if (!row || row.nonce !== claim.nonce || row.xUserId !== claim.xUserId
          || row.wallet && row.wallet !== wallet) return null;
        row.wallet = wallet;
        row.status = row.status === 'paid' ? 'paid' : 'ready';
        row.verifiedAt ||= new Date().toISOString();
        return row;
      });
      return bound ? json(res, 200, { status:bound.status, wallet:bound.wallet,
        amountLamports:bound.amountLamports })
        : json(res, 409, { error:'The V3 X claim changed during wallet verification.' });
    }
    if (!claim.wallet || !['ready', 'verification-pending', 'paid'].includes(claim.status))
      return json(res, 409, { error:'A verified recipient wallet is required.' });
    const fundedAt = Math.floor(Date.parse(funding.finalizedAt) / 1000);
    if (!Number.isSafeInteger(fundedAt) || fundedAt <= 0)
      return json(res, 409, { error:'The finalized V3 funding time is unavailable.' });
    const scheduler = schedulerFactory({ store:rewardStore, chain,
      indexer:{ capture:async () => { throw new Error('X payouts do not use holder indexing.'); } } });
    const schedule = await scheduler.recordDirectFunded({ kind:'x',
      id:collectionSignature, mint, recipient:claim.wallet, asset:'SOL',
      amount:claim.amountLamports, fundingSignature:funding.signature,
      balanceDeltaVerified:true, fundedAt });
    if (schedule.mint !== mint || schedule.manifest.leaves[0]?.recipient !== claim.wallet
      || schedule.manifest.totalAmount !== claim.amountLamports)
      return json(res, 409, { error:'The immutable X reward manifest conflicts with this claim.' });
    await scheduler.execute(Math.floor(Date.now() / 1000), [schedule.id]);
    const paid = (await rewardStore.read()).schedules?.[schedule.id];
    const payment = paid?.payments?.[claim.wallet];
    if (paid?.status !== 'paid' || payment?.status !== 'paid'
      || !payment.balanceDeltaVerified || !payment.finalized)
      return json(res, 503, { error:'X payout is pending finalized on-chain verification.' });
    const result = await store.update(current => {
      const row = current.v3XClaims?.[collectionSignature];
      if (!row || row.wallet !== claim.wallet || row.xUserId !== claim.xUserId) return null;
      row.status = 'paid'; row.payment = payment;
      row.paidAt ||= new Date().toISOString();
      return row;
    });
    return result ? json(res, 200, { status:'paid', wallet:result.wallet,
      amountLamports:result.amountLamports, payment:result.payment })
      : json(res, 409, { error:'The V3 X claim changed after finalized payout.' });
  };
}
