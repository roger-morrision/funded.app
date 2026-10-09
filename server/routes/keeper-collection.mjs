import { PublicKey, Connection } from '@solana/web3.js';
import { reconcileXFeeObligation, deriveXFeeObligation } from '../x-fee-guard.mjs';
import { deriveMintFeeRouter } from '../../fee-router.js';
import { verifyWrappedSolRecoveryReceipt } from '../wrapped-sol-recovery-receipt.mjs';

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
      const launches = Object.values(state.launches || {}).filter(row => row.onchainVerified && row.cluster === 'devnet' && row.pumpFeeRoute?.scope === 'per-mint-v2' && row.pumpFeeRoute.router === row.creator);
      const rewards = await automaticRewardStore.read();
      const pendingSettlements = Object.values(state.collections || {}).filter(row => {
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
      return json(res, 200, { cluster:solanaCluster, minimumCollectionLamports:'10000000', mints:launches.map(row => ({ mint:row.mint, collectionStatus:state.alerts?.[`fee-collect:${row.mint}`]?.status || null })), pendingSettlements });
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
        if (result.onchainVerified && result.status === 'collected') {
          Object.assign(result, reconcileXFeeObligation(state, { mint:result.mint, claimSignature:result.signature, createdAt:recordedAt }));
          state.collections[result.signature] = { ...state.collections[result.signature],
            ...(result.obligationStatus ? { obligationStatus:result.obligationStatus } : {}),
            ...(result.obligationError ? { obligationError:result.obligationError } : {}) };
        }
        return result;
      });
      return json(res, 200, result);
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
