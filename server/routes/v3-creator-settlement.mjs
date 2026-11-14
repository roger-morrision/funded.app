import bs58 from 'bs58';
import {isDeepStrictEqual} from 'node:util';
import {assertRpcNetwork,SOLANA_GENESIS} from '../../solana-network.js';
import {financialProgramAllowed,financialRecordNetwork} from '../financial-network.mjs';
import { PublicKey, Transaction } from '@solana/web3.js';
import {SharedRpcConnection as Connection} from '../rpc-connection.mjs';
import { buildMintRouterV3SettlementInstruction } from '../../mint-router-v3.js';
import {buildV3PolicySettlement, buildV3AutoPolicySettlement, v3SettlementSolCredit} from '../v3-policy-builders.mjs';
import { prepareCreatorSettlement, verifyCreatorSettlement,
  submitCreatorSettlement, creatorSettlementRetryState } from '../creator-settlement-transaction.mjs';
import { verifyV3LaunchRouterReadiness, retryUnavailableReadiness, readinessRejection } from '../v3-launch-readiness.mjs';
import { loadFinalizedV3PumpCollection } from '../v3-finalized-collection.mjs';
import { loadFinalizedV3Settlement } from '../v3-settlement-proof.mjs';
import { recordedV3AllocationPlan } from '../v3-allocation-plan.mjs';
import { allowedAuthOrigin } from '../x-auth.mjs';
import { v3ReferralUpline } from '../v3-referral-entitlement.mjs';

export function createV3CreatorSettlementRoutes({ body, store, solanaCluster, solanaRpcUrl,
  v3AuthorityKeypair, requireAuthorized = () => false, respond, env = process.env,
  connectionFactory = url => new Connection(url, 'finalized'),
  verifyReadiness = verifyV3LaunchRouterReadiness,
  loadCollection = loadFinalizedV3PumpCollection,
  loadSettlement = loadFinalizedV3Settlement,
  prepareTransaction = prepareCreatorSettlement,
  verifyTransaction = verifyCreatorSettlement,
  submitTransaction = submitCreatorSettlement,
  retryState = creatorSettlementRetryState,
  programAllowed = financialProgramAllowed,
  originAllowed = allowedAuthOrigin }) {
  const json = (...args) => { respond(...args); return true; };
  return async function handleV3CreatorSettlement(req, res, url) {
    const automatic = req.method === 'POST' && url.pathname === '/api/keeper/settle-v3';
    const match = req.method === 'POST'
      ? url.pathname.match(/^\/api\/tokens\/([^/]+)\/v3-settlement\/([^/]+)$/) : null;
    if (!match && !automatic) return false;
    if (automatic && !requireAuthorized(req, res)) return true;
    if (!Object.hasOwn(SOLANA_GENESIS,solanaCluster) || !automatic && !originAllowed(req, env.CORS_ORIGIN)) {
      return json(res, 403, { error:'V3 settlement requires a supported network and the app origin.' });
    }
    if (env.FUNDED_V3_SETTLEMENT_ENABLED !== 'true') {
      return json(res, 503, { error:'V3 settlement is not activated.' });
    }
    if (automatic && env.FUNDED_V3_AUTO_SETTLEMENT_ENABLED !== 'true') {
      return json(res, 503, { error:'Automatic V3 settlement requires the reviewed program and explicit activation.' });
    }
    const input = await body(req);
    let mint;
    try { mint = new PublicKey(automatic ? String(input?.mint || '') : decodeURIComponent(match[1])).toBase58(); }
    catch { return json(res, 400, { error:'A valid mint is required.' }); }
    const collectionSignature = automatic ? String(input?.collectionSignature || '') : decodeURIComponent(match[2]);
    if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(collectionSignature)) {
      return json(res, 400, { error:'A valid collection signature is required.' });
    }
    const programId = String(env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID || '').trim();
    const approvedHash = String(env.FUNDED_V3_PROGRAM_DATA_SHA256 || '').trim();
    if (!programId || !/^[a-f0-9]{64}$/i.test(approvedHash)||!programAllowed(solanaCluster,programId,approvedHash)) {
      return json(res, 503, { error:'The reviewed V3 program is not configured for this network.' });
    }
    let authority;
    try { authority = v3AuthorityKeypair(); } catch {}
    const state = await store.read();
    const collection = state.collections?.[collectionSignature];
    const launch = state.launches?.[mint];
    if (!authority || !launch?.onchainVerified || !financialRecordNetwork(launch,solanaCluster)
      || launch.mint !== mint || launch.pumpFeeRoute?.scope !== 'per-mint-v3'
      || launch.pumpFeeRoute.programId !== programId
      || launch.pumpFeeRoute.initialAuthority !== authority.publicKey.toBase58()
      || collection?.mint !== mint || collection.signature !== collectionSignature
      || collection.scope !== 'per-mint-v3' || !financialRecordNetwork(collection,solanaCluster)
      || collection.status !== 'collected' || collection.onchainVerified !== true
      || collection.attribution !== 'mint-verified' || collection.programId !== programId
      || !Number.isSafeInteger(collection.collectedLamports)
      || collection.collectedLamports <= 0 || !/^[a-f0-9]{64}$/.test(String(collection.claimId || ''))) {
      return json(res, 409, { error:'A matching verified V3 launch, collection, and settlement signer are required.' });
    }
    const prior = state.v3Settlements?.[collectionSignature];
    if(prior&&(!financialRecordNetwork(prior,solanaCluster,{legacyDevnet:true})||prior.mint!==mint
      ||prior.collectionSignature!==collectionSignature
      ||(solanaCluster==='mainnet-beta'||prior.programId!=null)&&prior.programId!==programId
      ||prior.approvedHash!=null&&prior.approvedHash!==approvedHash.toLowerCase()
        // A Devnet settlement in flight during an approved router upgrade is still
        // reconciled by its exact finalized signature below.
        &&!(solanaCluster==='devnet'&&prior.status==='verification-pending')))
      return json(res,409,{error:'Stored settlement belongs to another network, program or source.'});
    if(prior?.status==='finalized'&&!prior.settlementSignature)
      return json(res,409,{error:'Finalized settlement has no signature to reconcile.'});
    const connection = connectionFactory(solanaRpcUrl);
    try{await assertRpcNetwork(connection,solanaCluster);}
    catch{return json(res,503,{error:'Settlement RPC does not match the selected network.'});}
    const readiness = await retryUnavailableReadiness(() => verifyReadiness({ connection, programId,cluster:solanaCluster,
      expectedProgramDataSha256:approvedHash, mint, creatorWallet:launch.creatorWallet,
      initialAuthority:authority.publicKey, split:launch.pumpFeeRoute.protocolSplit }));
    if (!readiness.ready || readiness.configuredRouter !== collection.router
      || launch.pumpFeeRoute.router !== collection.router) {
      { const rejection = readinessRejection(readiness); return json(res, rejection.status, { error:rejection.error }); }
    }
    const source = await loadCollection({ connection, signature:collectionSignature,cluster:solanaCluster,
      programId, mint, launch });
    if (!source || source.signature !== collectionSignature || source.router !== collection.router
      || source.expectedLamports !== BigInt(collection.collectedLamports)
      || source.claimId.toString('hex') !== collection.claimId) {
      return json(res, 409, { error:'The finalized Pump collection does not match its record.' });
    }
    const proofInput = { connection, programId, mint,cluster:solanaCluster, authority:authority.publicKey,
      creator:launch.creatorWallet, claimId:source.claimId,
      expectedLamports:source.expectedLamports, split:launch.pumpFeeRoute.protocolSplit, includePosition:true };
    const frozenUpline = (proof, current) => {
      const first = Object.values(current.v3Settlements || {}).filter(row =>
        row.mint === mint && row.status === 'finalized' && financialRecordNetwork(row,solanaCluster,{legacyDevnet:true})
        && Array.isArray(row.referralUpline))
        .sort((a, b) => a.slot - b.slot)[0];
      if (first) return first.referralUpline;
      try { return v3ReferralUpline({ creatorWallet:launch.creatorWallet,
        attributions:current.referrals?.attributions, qualifiedAt:proof.blockTime }); }
      catch { return []; }
    };
    const recordedFinalized = (proof, signature, current) => ({ ...proof,
      collectionSignature, settlementSignature:signature, status:'finalized',
      cluster:solanaCluster,genesisHash:SOLANA_GENESIS[solanaCluster],programId,approvedHash:approvedHash.toLowerCase(), finalizedAt:new Date().toISOString(),
      ...(prior?.approvedHash&&prior.approvedHash!==approvedHash.toLowerCase()?{signedUnderApprovedHash:prior.approvedHash}:{}),
      referralUpline:frozenUpline(proof, current),
      allocationPlan:recordedV3AllocationPlan({ launch,cluster:solanaCluster, settlement:{ ...proof,
        cluster:solanaCluster,programId, collectionSignature, settlementSignature:signature } }) });
    const matchingProof=(proof,signature)=>Boolean(proof&&proof.signature===signature&&proof.mint===mint
      &&financialRecordNetwork(proof,solanaCluster,{legacyDevnet:true})&&proof.router===collection.router
      &&proof.claimId===collection.claimId&&proof.expectedLamports===String(collection.collectedLamports));
    if (prior?.settlementSignature) {
      const finalized = await loadSettlement({ ...proofInput, signature:prior.settlementSignature });
      if (matchingProof(finalized,prior.settlementSignature)) {
        const result = await store.update(current => {
          const row = current.v3Settlements?.[collectionSignature];
          if (row?.settlementSignature !== prior.settlementSignature) return null;
          return current.v3Settlements[collectionSignature] =
            recordedFinalized(finalized, prior.settlementSignature, current);
        });
        return result ? json(res, 200, result)
          : json(res, 409, { error:'Settlement state changed during recovery.' });
      }
      if(prior.status==='finalized')return json(res,409,{error:'Stored finalized settlement could not be reverified; no new transaction was signed.'});
      const retry = await retryState({ connection, signatures:[prior.settlementSignature],
        blockhash:prior.blockhash,receiptAddress:prior.receiptAddress,lastValidBlockHeight:prior.lastValidBlockHeight });
      if (!retry.retry) return json(res, 409, { error:retry.reason });
    }
    const settlement = (automatic ? buildV3AutoPolicySettlement : buildV3PolicySettlement)({ programId, mint,split:launch.pumpFeeRoute.protocolSplit,
      authority:authority.publicKey, creator:launch.creatorWallet,
      claimId:source.claimId, expectedLamports:source.expectedLamports,
      solCredit:await v3SettlementSolCredit({connection,programId,mint,split:launch.pumpFeeRoute.protocolSplit}) });
    if (!automatic && !input?.creatorSignedTransaction) {
      const latest = await connection.getLatestBlockhash('finalized');
      return json(res, 202, { status:'awaiting-creator-signature', mint,cluster:solanaCluster,genesisHash:SOLANA_GENESIS[solanaCluster],
        collectionSignature, creatorWallet:launch.creatorWallet,
        amountLamports:String(source.expectedLamports),
        transaction:prepareTransaction({ instruction:settlement.instruction,
          authority:authority.publicKey, blockhash:latest.blockhash }),
        lastValidBlockHeight:latest.lastValidBlockHeight });
    }
    const latest=automatic?await connection.getLatestBlockhash('finalized'):null;
    const transaction = automatic
      ? new Transaction({feePayer:authority.publicKey,
        recentBlockhash:latest.blockhash})
        .add(settlement.instruction)
      : verifyTransaction({ signedTransaction:input.creatorSignedTransaction,
        instruction:settlement.instruction, authority:authority.publicKey,
        creator:launch.creatorWallet });
    transaction.partialSign(authority);
    const settlementSignature = bs58.encode(transaction.signature);
    const locked = await store.update(current => {
      const row = current.collections?.[collectionSignature];
      const existing = current.v3Settlements?.[collectionSignature];
      if (!row || row.claimId !== collection.claimId
        ||!financialRecordNetwork(row,solanaCluster)||row.programId!==programId
        ||!isDeepStrictEqual(current.launches?.[mint]?.pumpFeeRoute,launch.pumpFeeRoute)
        || row.collectedLamports !== collection.collectedLamports
        || existing?.status === 'finalized'
        || existing?.settlementSignature !== prior?.settlementSignature) return false;
      current.v3Settlements ||= {};
      current.v3Settlements[collectionSignature] = { collectionSignature,
        settlementSignature, mint, status:'verification-pending',
        blockhash:transaction.recentBlockhash, cluster:solanaCluster,genesisHash:SOLANA_GENESIS[solanaCluster],
        programId,approvedHash:approvedHash.toLowerCase(),signedTransaction:transaction.serialize().toString('base64'),
        receiptAddress:settlement.claim.toBase58(),...(latest?{lastValidBlockHeight:latest.lastValidBlockHeight}:{}),
        startedAt:new Date().toISOString() };
      return true;
    });
    if (!locked) return json(res, 409, { error:'V3 settlement state changed before submission.' });
    const submitted = await submitTransaction({ connection, transaction, authority, automatic });
    if (submitted !== settlementSignature) throw new Error('Finalized V3 settlement signature changed.');
    const finalized = await loadSettlement({ ...proofInput, signature:submitted });
    if (!matchingProof(finalized,submitted)) {
      throw new Error('Finalized V3 category settlement proof is unavailable; reconcile before retrying.');
    }
    const result = await store.update(current => {
      const row = current.v3Settlements?.[collectionSignature];
      if (row?.settlementSignature !== submitted) return null;
      // A concurrent worker can reconcile our exact signature while this request
      // waits for finality. Return that proven result without another submission.
      if (row.status === 'finalized') return matchingProof(row,submitted)
        && row.programId === programId && row.approvedHash === approvedHash.toLowerCase()
        && isDeepStrictEqual(row.categoryLamports,finalized.categoryLamports) ? row : null;
      if (row.status !== 'verification-pending') return null;
      return current.v3Settlements[collectionSignature] = recordedFinalized(finalized, submitted, current);
    });
    return result ? json(res, 200, result)
      : json(res, 409, { error:'Finalized settlement state changed; reconcile its signature.' });
  };
}
