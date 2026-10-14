import bs58 from 'bs58';
import { Connection, PublicKey } from '@solana/web3.js';
import { buildMintRouterV3SettlementInstruction } from '../../mint-router-v3.js';
import { prepareCreatorSettlement, verifyCreatorSettlement,
  submitCreatorSettlement, creatorSettlementRetryState } from '../creator-settlement-transaction.mjs';
import { verifyV3LaunchRouterReadiness } from '../v3-launch-readiness.mjs';
import { loadFinalizedV3PumpCollection } from '../v3-finalized-collection.mjs';
import { loadFinalizedV3Settlement } from '../v3-settlement-proof.mjs';
import { recordedV3AllocationPlan } from '../v3-allocation-plan.mjs';
import { allowedAuthOrigin } from '../x-auth.mjs';
import { v3ReferralUpline } from '../v3-referral-entitlement.mjs';

export function createV3CreatorSettlementRoutes({ body, store, solanaCluster, solanaRpcUrl,
  v3AuthorityKeypair, respond, env = process.env,
  connectionFactory = url => new Connection(url, 'finalized'),
  verifyReadiness = verifyV3LaunchRouterReadiness,
  loadCollection = loadFinalizedV3PumpCollection,
  loadSettlement = loadFinalizedV3Settlement,
  prepareTransaction = prepareCreatorSettlement,
  verifyTransaction = verifyCreatorSettlement,
  submitTransaction = submitCreatorSettlement,
  retryState = creatorSettlementRetryState,
  originAllowed = allowedAuthOrigin }) {
  const json = (...args) => { respond(...args); return true; };
  return async function handleV3CreatorSettlement(req, res, url) {
    const match = req.method === 'POST'
      ? url.pathname.match(/^\/api\/tokens\/([^/]+)\/v3-settlement\/([^/]+)$/) : null;
    if (!match) return false;
    if (solanaCluster !== 'devnet' || !originAllowed(req, env.CORS_ORIGIN)) {
      return json(res, 403, { error:'V3 settlement requires the Devnet app origin.' });
    }
    if (env.FUNDED_V3_SETTLEMENT_ENABLED !== 'true') {
      return json(res, 503, { error:'Creator-signed V3 settlement is not activated.' });
    }
    let mint;
    try { mint = new PublicKey(decodeURIComponent(match[1])).toBase58(); }
    catch { return json(res, 400, { error:'A valid mint is required.' }); }
    const collectionSignature = decodeURIComponent(match[2]);
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
    const collection = state.collections?.[collectionSignature];
    const launch = state.launches?.[mint];
    if (!authority || !launch?.onchainVerified || launch.cluster !== 'devnet'
      || launch.mint !== mint || launch.pumpFeeRoute?.scope !== 'per-mint-v3'
      || launch.pumpFeeRoute.programId !== programId
      || launch.pumpFeeRoute.initialAuthority !== authority.publicKey.toBase58()
      || collection?.mint !== mint || collection.signature !== collectionSignature
      || collection.scope !== 'per-mint-v3' || collection.cluster !== 'devnet'
      || collection.status !== 'collected' || collection.onchainVerified !== true
      || collection.attribution !== 'mint-verified' || collection.programId !== programId
      || !Number.isSafeInteger(collection.collectedLamports)
      || collection.collectedLamports <= 0 || !/^[a-f0-9]{64}$/.test(String(collection.claimId || ''))) {
      return json(res, 409, { error:'A matching verified V3 launch, collection, and settlement signer are required.' });
    }
    const prior = state.v3Settlements?.[collectionSignature];
    if (prior?.status === 'finalized') return json(res, 200, prior);
    const connection = connectionFactory(solanaRpcUrl);
    const readiness = await verifyReadiness({ connection, programId,
      expectedProgramDataSha256:approvedHash, mint, creatorWallet:launch.creatorWallet,
      initialAuthority:authority.publicKey, split:launch.pumpFeeRoute.protocolSplit });
    if (!readiness.ready || readiness.configuredRouter !== collection.router
      || launch.pumpFeeRoute.router !== collection.router) {
      return json(res, 409, { error:'The approved V3 program and mint policy are not verified.' });
    }
    const source = await loadCollection({ connection, signature:collectionSignature,
      programId, mint, launch });
    if (!source || source.signature !== collectionSignature || source.router !== collection.router
      || source.expectedLamports !== BigInt(collection.collectedLamports)
      || source.claimId.toString('hex') !== collection.claimId) {
      return json(res, 409, { error:'The finalized Pump collection does not match its record.' });
    }
    const proofInput = { connection, programId, mint, authority:authority.publicKey,
      creator:launch.creatorWallet, claimId:source.claimId,
      expectedLamports:source.expectedLamports, split:launch.pumpFeeRoute.protocolSplit };
    const frozenUpline = (proof, current) => {
      const first = Object.values(current.v3Settlements || {}).filter(row =>
        row.mint === mint && row.status === 'finalized' && Array.isArray(row.referralUpline))
        .sort((a, b) => a.slot - b.slot)[0];
      if (first) return first.referralUpline;
      try { return v3ReferralUpline({ creatorWallet:launch.creatorWallet,
        attributions:current.referrals?.attributions, qualifiedAt:proof.blockTime }); }
      catch { return []; }
    };
    const recordedFinalized = (proof, signature, current) => ({ ...proof,
      collectionSignature, settlementSignature:signature, status:'finalized',
      cluster:'devnet', finalizedAt:new Date().toISOString(),
      referralUpline:frozenUpline(proof, current),
      allocationPlan:recordedV3AllocationPlan({ launch, settlement:{ ...proof,
        programId, collectionSignature, settlementSignature:signature } }) });
    if (prior?.settlementSignature) {
      const finalized = await loadSettlement({ ...proofInput, signature:prior.settlementSignature });
      if (finalized && finalized.claimId === collection.claimId
        && finalized.expectedLamports === String(collection.collectedLamports)) {
        const result = await store.update(current => {
          const row = current.v3Settlements?.[collectionSignature];
          if (row?.settlementSignature !== prior.settlementSignature) return null;
          return current.v3Settlements[collectionSignature] =
            recordedFinalized(finalized, prior.settlementSignature, current);
        });
        return result ? json(res, 200, result)
          : json(res, 409, { error:'Settlement state changed during recovery.' });
      }
      const retry = await retryState({ connection, signatures:[prior.settlementSignature],
        blockhash:prior.blockhash });
      if (!retry.retry) return json(res, 409, { error:retry.reason });
    }
    const settlement = buildMintRouterV3SettlementInstruction({ programId, mint,
      authority:authority.publicKey, creator:launch.creatorWallet,
      claimId:source.claimId, expectedLamports:source.expectedLamports });
    if (!input?.creatorSignedTransaction) {
      const latest = await connection.getLatestBlockhash('finalized');
      return json(res, 202, { status:'awaiting-creator-signature', mint,
        collectionSignature, creatorWallet:launch.creatorWallet,
        amountLamports:String(source.expectedLamports),
        transaction:prepareTransaction({ instruction:settlement.instruction,
          authority:authority.publicKey, blockhash:latest.blockhash }),
        lastValidBlockHeight:latest.lastValidBlockHeight });
    }
    const transaction = verifyTransaction({ signedTransaction:input.creatorSignedTransaction,
      instruction:settlement.instruction, authority:authority.publicKey,
      creator:launch.creatorWallet });
    transaction.partialSign(authority);
    const settlementSignature = bs58.encode(transaction.signature);
    const locked = await store.update(current => {
      const row = current.collections?.[collectionSignature];
      const existing = current.v3Settlements?.[collectionSignature];
      if (!row || row.claimId !== collection.claimId
        || row.collectedLamports !== collection.collectedLamports
        || existing?.status === 'finalized'
        || existing?.settlementSignature !== prior?.settlementSignature) return false;
      current.v3Settlements ||= {};
      current.v3Settlements[collectionSignature] = { collectionSignature,
        settlementSignature, mint, status:'verification-pending',
        blockhash:transaction.recentBlockhash, cluster:'devnet',
        startedAt:new Date().toISOString() };
      return true;
    });
    if (!locked) return json(res, 409, { error:'V3 settlement state changed before submission.' });
    const submitted = await submitTransaction({ connection, transaction, authority });
    if (submitted !== settlementSignature) throw new Error('Finalized V3 settlement signature changed.');
    const finalized = await loadSettlement({ ...proofInput, signature:submitted });
    if (!finalized || finalized.claimId !== collection.claimId
      || finalized.expectedLamports !== String(collection.collectedLamports)) {
      throw new Error('Finalized V3 category settlement proof is unavailable; reconcile before retrying.');
    }
    const result = await store.update(current => {
      const row = current.v3Settlements?.[collectionSignature];
      if (row?.settlementSignature !== submitted || row.status !== 'verification-pending') return null;
      return current.v3Settlements[collectionSignature] = recordedFinalized(finalized, submitted, current);
    });
    return result ? json(res, 200, result)
      : json(res, 409, { error:'Finalized settlement state changed; reconcile its signature.' });
  };
}
