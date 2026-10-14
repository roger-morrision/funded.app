import { Connection, PublicKey } from '@solana/web3.js';
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
  let communityReserveSnapshot = null;
  const invalidateReserveCache = () => { communityReserveSnapshot = null; };
  const json = (...args) => { respond(...args); return true; };
  async function handle(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/airdrops/reserves') {
      if (solanaCluster !== 'devnet') return json(res, 503, { error:'Verified Solana community reserve checks are unavailable.' });
      if (communityReserveSnapshot?.expiresAt > Date.now()) return json(res, 200, communityReserveSnapshot.value);
      try {
        const connection = new Connection(solanaRpcUrl, 'finalized');
        if (await connection.getGenesisHash() !== DEVNET_GENESIS_HASH) throw new Error('Reward RPC is not Devnet.');
        const state = await store.read();
        const claimLedger = await automaticRewardStore.read();
        const configuredReceipts = JSON.parse(process.env.FUNDED_COMMUNITY_RESERVE_RECEIPTS_JSON || '{}');
        const launches = Object.values(state.launches || {}).filter(row => row.onchainVerified && row.cluster === 'devnet'
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
        const authorities = new Set(reserves.filter(row => row.verified).map(row => row.authority));
        const result = { cluster:'devnet', checkedAt:new Date().toISOString(), claimPolicy:{ windowDays:90,
          unclaimedRecipient:authorities.size === 1 ? [...authorities][0] : null,
          status:reserves.some(row => row.status === 'drop-active') ? 'active' : 'not-activated',
          qaOnly:reserves.some(row => row.status === 'drop-active')
            && reserves.filter(row => row.status === 'drop-active')
              .every(row => row.snapshotBasis === 'devnet-qa-cutoff') }, reserves };
        communityReserveSnapshot = { value:result, expiresAt:Date.now() + 30_000 };
        return json(res, 200, result);
      } catch (error) { return json(res, 503, { error:`Community reserve verification unavailable: ${error.message}` }); }
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
      } catch (error) { return json(res, 503, { error:`Community funding receipt could not be recorded: ${error.message}` }); }
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
          snapshotBasis:record.snapshotBasis || 'pump-migration' } : { status:'unprepared', mint });
      } catch (error) { return json(res, 503, { error:`Community claim status is unavailable: ${error.message}` }); }
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
      try {
        const record = await (await communityClaimService(mint)).prepare({ mint, creator:launch.creatorWallet,
          reservedTokens:Number(launch.communityAirdrop.reservedTokens), fundingSignature:receipt.signature,
          migrationSignature, snapshotBasis:qaCutoff ? 'devnet-qa-cutoff' : 'pump-migration' });
        return json(res, 200, { mint:record.mint, drop:record.manifest.drop, root:record.manifest.root,
          snapshotHash:record.manifest.snapshotHash, migrationSlot:record.snapshot.slot,
          snapshotBasis:record.snapshotBasis, recipients:record.manifest.leaves.length,
          totalAmount:record.manifest.totalAmount, status:'prepared' });
      } catch (error) { return json(res, 422, { error:`Community claim preparation failed: ${error.message}` }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/airdrops/claims/opening-instruction') {
      const input = await body(req);
      try {
        const prepared = await (await communityClaimService(input.mint)).openingInstruction(input.mint);
        const instruction = prepared.instruction;
        return json(res, 200, { drop:prepared.drop, programId:instruction.programId.toBase58(),
          accounts:instruction.keys.map(row => ({ pubkey:row.pubkey.toBase58(), isSigner:row.isSigner, isWritable:row.isWritable })),
          data:instruction.data.toString('base64') });
      } catch (error) { return json(res, 422, { error:`Community opening is unavailable: ${error.message}` }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/airdrops/claims/approval-instruction') {
      if (!requireAuthorized(req, res)) return true;
      const input = await body(req);
      try {
        const instruction = await (await communityClaimService(input.mint)).approvalInstruction({ mint:input.mint, appOwner:input.appOwner });
        return json(res, 200, { programId:instruction.programId.toBase58(),
          accounts:instruction.keys.map(row => ({ pubkey:row.pubkey.toBase58(), isSigner:row.isSigner, isWritable:row.isWritable })),
          data:instruction.data.toString('base64') });
      } catch (error) { return json(res, 422, { error:`Snapshot approval is unavailable: ${error.message}` }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/airdrops/claims/opening-receipt') {
      const input = await body(req);
      try {
        const receipt = await (await communityClaimService(input.mint)).recordOpening({ mint:input.mint, signature:input.signature });
        invalidateReserveCache();
        return json(res, 200, receipt);
      }
      catch (error) { return json(res, 422, { error:`Community opening receipt was rejected: ${error.message}` }); }
    }
    if (req.method === 'GET' && url.pathname === '/api/airdrops/claims/proof') {
      const mint = url.searchParams.get('mint'), wallet = url.searchParams.get('wallet');
      if (!mint || !wallet) return json(res, 400, { error:'Mint and wallet are required.' });
      if (!await store.chargeRpcRate(`community-proof:${clientKey(req)}`, 1, 12, Math.floor(Date.now()/60000)*60000))
        return json(res, 429, { error:'Wait before requesting another community proof.' });
      try { return json(res, 200, await (await communityClaimService(mint)).recipientProof({ mint, wallet })); }
      catch (error) { return json(res, 503, { error:`Community proof is unavailable: ${error.message}` }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/airdrops/claims/claim-instruction') {
      if (!await store.chargeRpcRate(`community-claim:${clientKey(req)}`, 1, 6, Math.floor(Date.now()/60000)*60000))
        return json(res, 429, { error:'Wait before requesting another community claim.' });
      const input = await body(req);
      try {
        const result = await (await communityClaimService(input.mint)).claimInstruction({ mint:input.mint, wallet:input.wallet });
        return json(res, 200, { programId:result.instruction.programId.toBase58(),
          accounts:result.instruction.keys.map(row => ({ pubkey:row.pubkey.toBase58(), isSigner:row.isSigner, isWritable:row.isWritable })),
          data:result.instruction.data.toString('base64'), amount:result.amount,
          payment:result.payment, recipientToken:result.recipientToken, vaultToken:result.vaultToken });
      } catch (error) { return json(res, 422, { error:`Community claim is unavailable: ${error.message}` }); }
    }
    return false;
  }
  return { handle, invalidateReserveCache };
}
