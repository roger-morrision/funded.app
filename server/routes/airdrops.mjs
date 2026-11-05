import { PublicKey } from '@solana/web3.js';
import { SharedRpcConnection as Connection } from '../rpc-connection.mjs';
import { readProgramDataEvidence, DEVNET_GENESIS_HASH } from '../automatic-reward-chain.mjs';
import { mapBounded } from '../bounded-map.mjs';
import { readCommunityReserveStatus, verifiedCommunityClaimedWalletCount } from '../community-reserve-status.mjs';
import { communityProgramForLaunch } from '../community-program-config.mjs';

// Called after the shared request policy, rate limit, and authorization checks.
// Return true only after sending a response; false lets the router continue.
export function createAirdropsRoutes({
  solanaCluster, solanaRpcUrl, store, automaticRewardStore, fundedTokenMint, clientKey, body, requireAuthorized,
  communityClaimService, v3AuthorityKeypair,
  respond,
}) {
  const preparing = new Map(), reserveReads = new Map();
  let reserveEpoch = 0;
  let communityReserveSnapshot = null;
  const invalidateReserveCache = () => { communityReserveSnapshot = null; reserveEpoch++; reserveReads.clear(); };
  const json = (...args) => { respond(...args); return true; };
  async function handle(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/airdrops/reserves') {
      if (solanaCluster !== 'devnet') return json(res, 503, { error:'Verified Solana community reserve checks are unavailable.' });
      const mint = url.searchParams.get('mint');
      if (mint !== null && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return json(res, 400, { error:'Invalid reserve mint.' });
      if (communityReserveSnapshot?.expiresAt > Date.now()) {
        const snapshot = communityReserveSnapshot.value;
        if (!mint) return json(res, 200, snapshot);
        const cached = snapshot.reserves.find(row => row.mint === mint);
        if (cached) return json(res, 200, { cluster:solanaCluster, checkedAt:snapshot.checkedAt, reserves:[cached] });
      }
      const scope = mint || '*', epoch = reserveEpoch;
      if (!reserveReads.has(scope)) {
        const work = (async () => {
        const connection = new Connection(solanaRpcUrl, 'finalized');
        if (await connection.getGenesisHash() !== DEVNET_GENESIS_HASH) throw new Error('Reward RPC is not Devnet.');
        const state = await store.read();
        const claimLedger = typeof automaticRewardStore.readAutomationSnapshot === 'function'
          ? await automaticRewardStore.readAutomationSnapshot() : await automaticRewardStore.read();
        const configuredReceipts = JSON.parse(process.env.FUNDED_COMMUNITY_RESERVE_RECEIPTS_JSON || '{}');
        const launches = Object.values(state.launches || {}).filter(row => (!mint || row.mint === mint) && row.onchainVerified && row.cluster === 'devnet'
          && row.pumpFeeRoute?.scope === 'per-mint-v3'
          && Number.isSafeInteger(Number(row.communityAirdrop?.reservedTokens))
          && Number(row.communityAirdrop.reservedTokens) > 0).slice(0, 100);
        const programChecks = new Map();
        const reserves = await mapBounded(launches, 4, async launch => {
          try {
            const config = communityProgramForLaunch(launch, process.env, v3AuthorityKeypair);
            const programId = new PublicKey(config.programId);
            if (!programChecks.has(config.programId))
              programChecks.set(config.programId, readProgramDataEvidence(connection, programId));
            const evidence = await programChecks.get(config.programId);
            if (!evidence.account?.executable || evidence.sha256 !== config.expectedHash)
              throw new Error('Reward program identity or bytecode could not be verified.');
            const claim = claimLedger.communityDrops?.[launch.mint];
            const recorded = state.communityReserveReceipts?.[launch.mint]?.signature
              || configuredReceipts[launch.mint] || claim?.fundingSignature;
            const reserve = await readCommunityReserveStatus({ connection, programId, authority:config.authority,
              fundingAuthority:launch.creatorWallet, mint:launch.mint, reservedTokens:Number(launch.communityAirdrop.reservedTokens),
              fundingSignature:typeof recorded === 'string' ? recorded : null,
              expectedEligibilityMint:fundedTokenMint, dropOpeningSignature:claim?.openingSignature || null });
            let claimedWalletCount = null;
            if (reserve.verified && ['drop-active', 'drop-closed'].includes(reserve.status)) {
              try { claimedWalletCount = await verifiedCommunityClaimedWalletCount({ connection, programId,
                drop:reserve.drop, claimedBaseUnits:reserve.claimedBaseUnits, leafCount:reserve.leafCount }); }
              catch { /* Keep the verified token total; do not guess a wallet count from incomplete payment accounts. */ }
            }
            return { ...reserve, creatorWallet:launch.creatorWallet, programId:config.programId,
              authority:config.authority, scope:config.scope,
              claimedWalletCount,
              fundingSignature:reserve.verified ? reserve.fundingSignature || recorded || null : null,
              claimPreparation:claim ? claim.openingSignature ? 'opened' : 'prepared' : 'pending',
              snapshotBasis:claim?.snapshotBasis || null };
          } catch {
            return { mint:launch.mint, verified:false, status:'unavailable',
              reason:'Community reserve could not be verified for this mint.' };
          }
        });
        if (mint) return { cluster:solanaCluster, checkedAt:new Date().toISOString(), reserves };
        const authorities = new Set(reserves.filter(row => row.verified).map(row => row.authority));
        const result = { cluster:'devnet', checkedAt:new Date().toISOString(), claimPolicy:{ windowDays:90,
          unclaimedRecipient:authorities.size === 1 ? [...authorities][0] : null,
          status:reserves.some(row => row.status === 'drop-active') ? 'active' : 'not-activated',
          qaOnly:reserves.some(row => row.status === 'drop-active')
            && reserves.filter(row => row.status === 'drop-active')
              .every(row => row.snapshotBasis === 'devnet-qa-cutoff') }, reserves };
        if (epoch === reserveEpoch) communityReserveSnapshot = { value:result, expiresAt:Date.now() + 30_000 };
        return result;
        })().finally(() => { if (reserveReads.get(scope) === work) reserveReads.delete(scope); });
        reserveReads.set(scope, work);
      }
      try { return json(res, 200, await reserveReads.get(scope)); }
      catch { return json(res, 503, { error:'Community reserve verification is temporarily unavailable.' }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/airdrops/reserves/receipt') {
      if (solanaCluster !== 'devnet') return json(res, 503, { error:'Solana community reserve verification is unavailable.' });
      if (!await store.chargeRpcRate(`community-receipt:${clientKey(req)}`, 1, 5, Math.floor(Date.now()/60000)*60000)) return json(res, 429, { error:'Wait before checking another reserve receipt.' });
      const input = await body(req);
      const mint = String(input.mint || '').trim(), signature = String(input.signature || '').trim();
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint) || !/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(signature)) return json(res, 400, { error:'A valid launch mint and finalized funding signature are required.' });
      const launch = await store.readLaunch(mint);
      if (!launch?.onchainVerified || launch.cluster !== 'devnet' || launch.pumpFeeRoute?.scope !== 'per-mint-v3'
        || !Number.isSafeInteger(Number(launch.communityAirdrop?.reservedTokens))
        || Number(launch.communityAirdrop.reservedTokens) <= 0)
        return json(res, 404, { error:'Verified V3 community allocation not found.' });
      try {
        const connection = new Connection(solanaRpcUrl, 'finalized');
        const config = communityProgramForLaunch(launch, process.env, v3AuthorityKeypair);
        const programId = new PublicKey(config.programId);
        const [genesis, evidence] = await Promise.all([connection.getGenesisHash(), readProgramDataEvidence(connection, programId)]);
        if (genesis !== DEVNET_GENESIS_HASH || !evidence.account?.executable || evidence.sha256 !== config.expectedHash) throw new Error('Reward program identity or bytecode could not be verified.');
        const reserve = await readCommunityReserveStatus({ connection, programId, authority:config.authority, fundingAuthority:launch.creatorWallet, mint, reservedTokens:Number(launch.communityAirdrop.reservedTokens), fundingSignature:signature });
        if (!reserve.verified) return json(res, 422, { error:'Funding receipt lacks the finalized creator-signed exact reserve transfer.', reserve });
        await store.update(current => {
          current.communityReserveReceipts ||= {};
          const prior = current.communityReserveReceipts[mint];
          if (prior && prior.signature !== signature) throw new Error('A different immutable funding receipt is already recorded for this launch.');
          current.communityReserveReceipts[mint] ||= { signature, creatorWallet:launch.creatorWallet, recordedAt:new Date().toISOString() };
        });
        invalidateReserveCache();
        return json(res, 200, { ...reserve, creatorWallet:launch.creatorWallet,
          programId:config.programId, authority:config.authority, scope:config.scope });
      } catch { return json(res, 503, { error:'Community funding receipt could not be verified.' }); }
    }
    if (req.method === 'GET' && url.pathname === '/api/airdrops/claims/status') {
      if (!requireAuthorized(req, res)) return true;
      const mint = url.searchParams.get('mint');
      if (!mint) return json(res, 400, { error:'Mint is required.' });
      try {
        const record = await (await communityClaimService(mint)).prepared(mint);
        return json(res, 200, record ? { status:record.openingSignature ? 'opened' : 'prepared', mint:record.mint,
          drop:record.manifest.drop, openingSignature:record.openingSignature,
          migrationSignature:record.migrationSignature, migrationSlot:record.snapshot.slot,
          snapshotBasis:record.snapshotBasis || 'pump-migration', root:record.manifest.root, snapshotHash:record.manifest.snapshotHash,
          recipients:record.manifest.leaves.length, totalAmount:record.manifest.totalAmount } : { status:preparing.has(mint) ? 'preparing' : 'unprepared', mint });
      } catch { return json(res, 503, { error:'Community claim status is temporarily unavailable.' }); }
    }
    if (req.method === 'POST' && ['/api/airdrops/claims/prepare', '/api/airdrops/claims/prepare-qa'].includes(url.pathname)) {
      const qaCutoff = url.pathname.endsWith('/prepare-qa');
      if (qaCutoff && !requireAuthorized(req, res)) return true;
      const input = await body(req);
      const mint = String(input.mint || '').trim(), migrationSignature = String(input.migrationSignature || '').trim();
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint) || !/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(migrationSignature))
        return json(res, 400, { error:'A valid launch mint and finalized migration signature are required.' });
      const launch = await store.readLaunch(mint);
      const receipt = (await store.read()).communityReserveReceipts?.[mint];
      if (!launch?.onchainVerified || launch.cluster !== 'devnet' || !receipt?.signature
        || !Number.isSafeInteger(Number(launch.communityAirdrop?.reservedTokens)) || Number(launch.communityAirdrop.reservedTokens) <= 0)
        return json(res, 404, { error:'Verified Solana launch and community funding receipt are required.' });
      // Complete exact-slot replay can require 256 paced block reads. Keep its
      // response alive beyond the server's ordinary two-minute idle timeout.
      res.setTimeout?.(15*60_000);
      try {
        const service = await communityClaimService(mint);
        const args = { mint, creator:launch.creatorWallet,
          reservedTokens:Number(launch.communityAirdrop.reservedTokens), fundingSignature:receipt.signature,
          migrationSignature, snapshotBasis:qaCutoff ? 'devnet-qa-cutoff' : 'pump-migration' };
        if (req.headers?.prefer === 'respond-async') {
          const identity = JSON.stringify(args);
          const active = preparing.get(mint);
          if (active && active !== identity) return json(res,409,{ error:'A different migration is already being verified.' });
          if (!active) {
            preparing.set(mint, identity);
            Promise.resolve().then(() => service.prepare(args)).catch(error => {
              console.warn(JSON.stringify({ event:'community_claim_preparation_failed', mint,
                reason:String(error.message).replace(/https?:\/\/[^\s"']+/g,'[redacted-url]').slice(0,400) }));
            }).finally(() => preparing.delete(mint));
          }
          res.setHeader('Location','/api/airdrops/claims/status?mint='+mint);
          return json(res,202,{mint,status:'preparing'});
        }
        const record = await service.prepare(args);
        return json(res, 200, { mint:record.mint, drop:record.manifest.drop, root:record.manifest.root,
          snapshotHash:record.manifest.snapshotHash, migrationSlot:record.snapshot.slot,
          snapshotBasis:record.snapshotBasis, recipients:record.manifest.leaves.length,
          totalAmount:record.manifest.totalAmount, status:'prepared' });
      } catch (error) {
        console.warn(JSON.stringify({event:'community_claim_preparation_failed',mint,
          reason:String(error?.message || error).replace(/https?:\/\/[^\s"']+/g,'[redacted-url]').slice(0,400)}));
        return json(res, 422, { error:'Community claim preparation failed. Check the launch and migration evidence.' });
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/airdrops/claims/opening-instruction') {
      const input = await body(req);
      try {
        const prepared = await (await communityClaimService(input.mint)).openingInstruction(input.mint);
        const instruction = prepared.instruction;
        return json(res, 200, { drop:prepared.drop, programId:instruction.programId.toBase58(),
          accounts:instruction.keys.map(row => ({ pubkey:row.pubkey.toBase58(), isSigner:row.isSigner, isWritable:row.isWritable })),
          data:instruction.data.toString('base64') });
      } catch { return json(res, 422, { error:'Community opening instruction is unavailable.' }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/airdrops/claims/approval-instruction') {
      if (!requireAuthorized(req, res)) return true;
      const input = await body(req);
      try {
        const instruction = await (await communityClaimService(input.mint)).approvalInstruction({ mint:input.mint, appOwner:input.appOwner });
        return json(res, 200, { programId:instruction.programId.toBase58(),
          accounts:instruction.keys.map(row => ({ pubkey:row.pubkey.toBase58(), isSigner:row.isSigner, isWritable:row.isWritable })),
          data:instruction.data.toString('base64') });
      } catch { return json(res, 422, { error:'Snapshot approval instruction is unavailable.' }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/airdrops/claims/opening-receipt') {
      const input = await body(req);
      try {
        const receipt = await (await communityClaimService(input.mint)).recordOpening({ mint:input.mint, signature:input.signature });
        invalidateReserveCache();
        return json(res, 200, receipt);
      }
      catch { return json(res, 422, { error:'Community opening receipt could not be verified.' }); }
    }
    if (req.method === 'GET' && url.pathname === '/api/airdrops/allocation') {
      const mint = url.searchParams.get('mint'), wallet = url.searchParams.get('wallet');
      if (!mint || !wallet) return json(res, 400, { error:'Mint and wallet are required.' });
      if (!await store.chargeRpcRate(`community-proof:${clientKey(req)}`, 1, 12, Math.floor(Date.now()/60000)*60000))
        return json(res, 429, { error:'Wait before requesting another community proof.' });
      try {
        const proof=await (await communityClaimService(mint)).recipientProof({mint,wallet});
        const ledger=await automaticRewardStore.read();
        const automatic=ledger.communityDrops?.[mint]?.snapshotBasis==='pump-migration';
        return json(res,200,{...proof,delivery:automatic?{mode:'automatic',
          enabled:process.env.FUNDED_COMMUNITY_AUTO_DELIVERY_ENABLED==='true',
          worker:ledger.communityDeliveryStatus?{status:ledger.communityDeliveryStatus.status,
            checkedAt:ledger.communityDeliveryStatus.checkedAt}:null}:{mode:'manual-qa'}});
      }
      catch { return json(res, 503, { error:'Community proof is temporarily unavailable.' }); }
    }
    return false;
  }
  return { handle, invalidateReserveCache };
}
