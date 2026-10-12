import { PublicKey, Connection } from '@solana/web3.js';
import { reconcileXFeeObligation, deriveXFeeObligation } from '../x-fee-guard.mjs';
import { deriveMintFeeRouter } from '../../fee-router.js';
import { verifyWrappedSolRecoveryReceipt } from '../wrapped-sol-recovery-receipt.mjs';
import { PROTOCOL_FEE_SPLIT } from '../../config/protocol-fee-split.js';
import { deriveMintRouterV3 } from '../../mint-router-v3.js';
import { verifyV3LaunchRouterReadiness as verifyV3Readiness } from '../v3-launch-readiness.mjs';
import { loadFinalizedV3PumpCollection as loadV3Collection } from '../v3-finalized-collection.mjs';

// Called after the shared request policy, rate limit, and authorization checks.
// Return true only after sending a response; false lets the router continue.
export function createKeeperCollectionRoutes({
  requireAuthorized,
  body,
  fetchPump,
  normalizePumpToken,
  store,
  automaticRewardStore,
  solToLamports,
  solanaCluster,
  collectPumpCreatorFees,
  feeRouterConfig,
  solanaRpcUrl,
  respond,
  env = process.env,
  connectionFactory = url => new Connection(url, 'finalized'),
  verifyV3LaunchRouterReadiness = verifyV3Readiness,
  loadFinalizedV3PumpCollection = loadV3Collection,
}) {
  const json = (...args) => { respond(...args); return true; };
  return async function handleKeeperCollectionRoutes(req, res, url) {
    if (req.method === 'POST' && url.pathname === '/api/indexer/sync') {
      if (!requireAuthorized(req, res)) return true;
      const input = await body(req); const mint = String(input.mint || '').trim();
      if (!mint) return json(res, 400, { error: 'mint is required.' });
      const items = await fetchPump('/coins', { offset: '0', limit: '100', sort: 'created_timestamp', order: 'DESC', includeNsfw: 'false' });
      const token = items.map(normalizePumpToken).find(item => item?.mint === mint);
      if (!token) return json(res, 404, { error: 'Mint was not returned by the Pump indexer provider.' });
      const record = { ...token, chain: 'solana', source: 'pump.fun', indexedAt: new Date().toISOString() };
      await store.update(state => { state.launches[mint] = { ...(state.launches[mint] || {}), ...record }; state.lastIndexedAt = record.indexedAt; return record; });
      return json(res, 200, record);
    }
    if (req.method === 'GET' && url.pathname === '/api/keeper/collection-candidates') {
      if (!requireAuthorized(req, res)) return true;
      const state = await store.read();
      const launches = Object.values(state.launches || {}).filter(row => row.onchainVerified
        && row.cluster === 'devnet' && row.pumpFeeRoute?.router
        && row.pumpFeeRoute.router === row.creator
        && (row.pumpFeeRoute.scope === 'per-mint-v2'
          || (process.env.FUNDED_V3_COLLECTION_ENABLED === 'true' && row.pumpFeeRoute.scope === 'per-mint-v3')));
      const rewards = await automaticRewardStore.read();
      const pendingSettlements = Object.values(state.collections || {}).filter(row => {
        if (row.scope === 'per-mint-v3') return false;
        if (row.status !== 'collected' || row.onchainVerified !== true || row.attribution !== 'mint-verified' || row.cluster !== 'devnet') return false;
        const settlement = state.settlements?.[row.signature];
        if (!settlement) return true;
        return [
          ['creator', settlement.creatorDestinations?.creatorWallet],
          ['holders', settlement.creatorDestinations?.holderAirdrop],
          ['x', settlement.creatorDestinations?.solClaim],
          ['operations', settlement.fundedApp?.operations],
          ['community', settlement.fundedApp?.community],
        ].some(([kind, amount]) => BigInt(solToLamports(amount)) > 0n && !rewards.fundingRequests?.[`${row.signature}:${kind}`]);
      }).map(row => row.signature);
      return json(res, 200, { cluster:solanaCluster, minimumCollectionLamports:'10000000', mints:launches.map(row => ({ mint:row.mint,
        scope:row.pumpFeeRoute.scope, collectionStatus:state.alerts?.[`fee-collect:${row.mint}`]?.status || null })), pendingSettlements });
    }
    if (req.method === 'POST' && url.pathname === '/api/keeper/collect') {
      if (!requireAuthorized(req, res)) return true;
      const input = await body(req); const mint = String(input.mint || '').trim();
      if (!mint) return json(res, 400, { error: 'mint is required.' });
      if (solanaCluster !== 'devnet') return json(res, 403, { error:'Automatic fee collection is Solana only.' });
      let mintKey;
      try { mintKey = new PublicKey(mint).toBase58(); } catch { return json(res, 400, { error:'A valid mint is required.' }); }
      const started = await store.update(state => {
        const key = `fee-collect:${mintKey}`;
        if (state.alerts?.[key] && !['complete','nothing-to-collect','no-fees'].includes(state.alerts[key].status)) return false;
        state.alerts ||= {};
        state.alerts[key] = { mint:mintKey, status:'executing', startedAt:new Date().toISOString() };
        return true;
      });
      if (!started) return json(res, 409, { error:'A previous fee collection needs operator reconciliation before retry.' });
      let result;
      try { result = await collectPumpCreatorFees({ requestedMint: mintKey }); }
      catch (error) {
        await store.update(state => { state.alerts[`fee-collect:${mintKey}`] = { ...state.alerts[`fee-collect:${mintKey}`], status:'review-required', reason:String(error.message || error).slice(0, 240) }; });
        throw error;
      }
      await store.update(state => {
        const recordedAt = new Date().toISOString();
        if (result.signature) state.collections[result.signature] = { id: result.signature, ...result, recordedAt };
        state.alerts[`fee-collect:${mintKey}`] = { ...state.alerts[`fee-collect:${mintKey}`], status:result.onchainVerified && result.status === 'collected' ? 'complete' : result.status === 'nothing-to-collect' || result.status === 'no-fees' ? result.status : 'review-required', signature:result.signature || null, recordedAt };
        if (result.onchainVerified && result.status === 'collected' && result.scope !== 'per-mint-v3') {
          Object.assign(result, reconcileXFeeObligation(state, { mint:result.mint, claimSignature:result.signature, createdAt:recordedAt }));
          state.collections[result.signature] = { ...state.collections[result.signature],
            ...(result.obligationStatus ? { obligationStatus:result.obligationStatus } : {}),
            ...(result.obligationError ? { obligationError:result.obligationError } : {}) };
        }
        return result;
      });
      return json(res, 200, result);
    }
    if (req.method === 'POST' && url.pathname === '/api/keeper/reconcile-v3-collection') {
      if (!requireAuthorized(req, res)) return true;
      if (solanaCluster !== 'devnet') return json(res, 403, { error:'V3 collection reconciliation requires Devnet.' });
      const input = await body(req);
      let mint;
      try { mint = new PublicKey(String(input.mint || '')).toBase58(); }
      catch { return json(res, 400, { error:'A valid mint is required.' }); }
      const signature = String(input.signature || '').trim();
      if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) {
        return json(res, 400, { error:'A valid collection signature is required.' });
      }
      const programId = String(env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID || '').trim();
      const approvedHash = String(env.FUNDED_V3_PROGRAM_DATA_SHA256 || '').trim();
      if (!programId || !/^[a-f0-9]{64}$/i.test(approvedHash)) {
        return json(res, 503, { error:'The approved V3 Devnet program is not configured.' });
      }
      let router;
      try { router = deriveMintRouterV3(programId, mint).address.toBase58(); }
      catch { return json(res, 503, { error:'The configured V3 program ID is invalid.' }); }
      const state = await store.read();
      const collection = state.collections?.[signature];
      const launch = state.launches?.[mint];
      if (!collection || collection.signature !== signature || collection.mint !== mint
        || collection.scope !== 'per-mint-v3' || collection.cluster !== 'devnet'
        || collection.programId !== programId || collection.router !== router
        || !['verification-pending', 'collected'].includes(collection.status)
        || launch?.pumpFeeRoute?.scope !== 'per-mint-v3'
        || launch.pumpFeeRoute.programId !== programId || launch.pumpFeeRoute.router !== router) {
        return json(res, 409, { error:'A matching recorded V3 collection and launch are required.' });
      }
      const connection = connectionFactory(solanaRpcUrl);
      const readiness = await verifyV3LaunchRouterReadiness({ connection, programId,
        expectedProgramDataSha256:approvedHash, mint, creatorWallet:launch.creatorWallet,
        initialAuthority:launch.pumpFeeRoute.initialAuthority, split:PROTOCOL_FEE_SPLIT });
      if (!readiness.ready || readiness.configuredRouter !== router) {
        return json(res, 409, { error:'The approved V3 program and mint policy are not verified.' });
      }
      const proof = await loadFinalizedV3PumpCollection({ connection, signature,
        programId, mint, launch });
      if (!proof || proof.signature !== signature || proof.mint !== mint || proof.router !== router
        || typeof proof.expectedLamports !== 'bigint' || proof.expectedLamports <= 0n
        || proof.expectedLamports > BigInt(Number.MAX_SAFE_INTEGER)
        || !Buffer.isBuffer(proof.claimId) || proof.claimId.length !== 32
        || !Number.isSafeInteger(proof.slot) || proof.slot <= 0
        || collection.collectedLamports != null && !/^\d+$/.test(String(collection.collectedLamports))
        || collection.claimId && collection.claimId !== proof.claimId.toString('hex')
        || collection.collectedLamports != null
          && BigInt(collection.collectedLamports) !== proof.expectedLamports) {
        return json(res, 409, { error:'A matching finalized V3 Pump collection proof is required.' });
      }
      const recorded = await store.update(current => {
        const prior = current.collections?.[signature];
        if (!prior || prior.signature !== signature || prior.mint !== mint
          || prior.scope !== 'per-mint-v3' || prior.programId !== programId
          || prior.router !== router || !['verification-pending', 'collected'].includes(prior.status)) {
          return null;
        }
        if (prior.claimId && prior.claimId !== proof.claimId.toString('hex')) return null;
        if (prior.collectedLamports != null && !/^\d+$/.test(String(prior.collectedLamports))) return null;
        if (prior.collectedLamports != null
          && BigInt(prior.collectedLamports) !== proof.expectedLamports) return null;
        const next = { ...prior, status:'collected', attribution:'mint-verified',
          onchainVerified:true, collectedLamports:Number(proof.expectedLamports),
          claimId:proof.claimId.toString('hex'), slot:proof.slot,
          reconciledAt:new Date().toISOString() };
        current.collections[signature] = next;
        current.alerts ||= {};
        current.alerts[`fee-collect:${mint}`] = { ...current.alerts[`fee-collect:${mint}`],
          mint, status:'complete', signature };
        return next;
      });
      if (!recorded) return json(res, 409, { error:'The collection changed during reconciliation.' });
      return json(res, 200, recorded);
    }
    if (req.method === 'POST' && url.pathname === '/api/keeper/reconcile-wrapped-sol') {
      if (!requireAuthorized(req, res)) return true;
      if (solanaCluster !== 'devnet') return json(res, 403, { error:'Wrapped SOL reconciliation is Solana only.' });
      const input = await body(req);
      let mint;
      try { mint = new PublicKey(String(input.mint || '')).toBase58(); }
      catch { return json(res, 400, { error:'A valid mint is required.' }); }
      const signature = String(input.signature || '');
      if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) return json(res, 400, { error:'A valid recovery signature is required.' });
      const config = feeRouterConfig();
      const launch = await store.readLaunch(mint);
      if (!config || !launch?.onchainVerified || launch.cluster !== solanaCluster || launch.pumpFeeRoute?.scope !== 'per-mint-v2')
        return json(res, 409, { error:'A verified mint-router launch is required.' });
      const connection = new Connection(solanaRpcUrl, 'finalized');
      if (await connection.getGenesisHash() !== 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG')
        return json(res, 409, { error:'Configured RPC failed verification.' });
      const router = deriveMintFeeRouter(config.programId, new PublicKey(mint));
      if (launch.creator !== router.address.toBase58()) return json(res, 409, { error:'Launch router mismatch.' });
      const tx = await connection.getTransaction(signature, { commitment:'finalized', maxSupportedTransactionVersion:0 });
      const proof = verifyWrappedSolRecoveryReceipt({ transaction:tx, signature, mint,
        router:router.address.toBase58(), programId:config.programId.toBase58() });
      if (!proof) return json(res, 409, { error:'Finalized mint-router wrapped SOL recovery proof is missing or invalid.' });
      const recorded = await store.update(state => {
        if (state.collections[signature]) return null;
        const recordedAt = new Date().toISOString();
        const collection = { id:signature, signature, requestedMint:mint, mint, attribution:'mint-verified',
          onchainVerified:true, router:router.address.toBase58(), programId:config.programId.toBase58(),
          collectionMethod:'wrapped-sol-recovery', wrappedSolAccount:proof.wrappedSolAccount,
          collectedLamports:proof.collectedLamports, rentRefundLamports:proof.rentRefundLamports,
          cluster:solanaCluster, status:'collected', recordedAt };
        state.collections[signature] = collection;
        try {
          const obligation = deriveXFeeObligation(state, { mint, claimSignature:signature });
          state.obligations[obligation.id] ||= { ...obligation, createdAt:recordedAt };
        } catch (error) {
          collection.obligationStatus = 'reconciliation-required';
          collection.obligationError = String(error.message || error);
        }
        return collection;
      });
      if (!recorded) return json(res, 409, { error:'Recovery signature was already reconciled.' });
      return json(res, 200, { ...recorded, proof });
    }
    return false;
  };
}
