import { validateInput, invalidRequest } from '../http-policy.mjs';
import { deriveXFeeObligation } from '../x-fee-guard.mjs';
import { renewClaimChallenge } from '../../reward-discovery.js';
import { randomBytes } from 'node:crypto';
import { PublicKey, Connection, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { assertObservedClaim } from '../claim-state.mjs';
import { verifyMintFeeRouterAccount } from '../../fee-router.js';
import { buildMintRouterSettlementInstruction, readMintClaimRecord } from '../mint-router-payout.mjs';
import nacl from 'tweetnacl';

// Called after the shared request policy, rate limit, and authorization checks.
// Return true only after sending a response; false lets the router continue.
export function createSolClaimsRoutes({
  requireAuthorized,
  body,
  store,
  route,
  xSession,
  walletKey,
  walletSignature,
  enrollAutomaticXReward,
  verifyHmacAttestation,
  automaticRewardStore,
  xFeeReadiness,
  feeRouterConfig,
  routerAuthorityKeypair,
  solanaRpcUrl,
  solanaCluster,
  respond,
}) {
  const json = (...args) => { respond(...args); return true; };
  return async function handleSolClaimsRoutes(req, res, url) {
    if (req.method === 'POST' && url.pathname === '/api/payout-obligations/sol') {
      return json(res, 410, { error: 'Caller-supplied SOL payout amounts are disabled. Use verified per-mint fee collections.' });
    }
    if (req.method === 'POST' && url.pathname === '/api/x-fee/obligations') {
      if (!requireAuthorized(req, res)) return true;
      const input = await body(req);
      const obligation = await store.update(state => {
        const computed = validateInput(() => deriveXFeeObligation(state, input));
        const existing = state.obligations[computed.id];
        if (existing) return existing;
        state.obligations[computed.id] = { ...computed, createdAt: new Date().toISOString() };
        return state.obligations[computed.id];
      });
      return json(res, 201, obligation);
    }

    const claimId = decodeURIComponent(route(url.pathname, req.method, /^\/api\/sol-claims\/([^/]+)\/prepare$/) || '');
    if (claimId) {
      const input = await body(req); const recipient = String(input.xHandle || input.recipient || '').trim();
      const session = await xSession(req);
      if (!session?.user?.id || `@${session.user.username}`.toLowerCase() !== recipient.toLowerCase()) return json(res, 401, { error: 'Sign in with the recipient X account before preparing a claim.' });
      const obligation = (await store.readClaimState(claimId)).obligations[claimId];
      if (!obligation || obligation.source !== 'verified-per-mint-router-collection' || obligation.xUserId !== String(session.user.id)) return json(res, 409, { error: 'A verified X fee obligation for this X user ID is required.' });
      const claim = await store.updateClaimState(claimId,state => {
        const currentObligation=state.obligations[claimId];
        if(!currentObligation||currentObligation.source!=='verified-per-mint-router-collection'||currentObligation.xUserId!==String(session.user.id))throw new Error('Claim entitlement changed. Refresh before preparing.');
        const existing=state.claims[claimId];if(existing){if(existing.xUserId!==String(session.user.id))throw new Error('Claim identity mismatch.');return state.claims[claimId]=renewClaimChallenge(existing,randomBytes(24).toString('hex'));}
        return state.claims[claimId]={id:claimId,recipient:currentObligation.recipient,xUserId:currentObligation.xUserId,obligationId:currentObligation.id,nonce:randomBytes(24).toString('hex'),status:'awaiting-wallet-signature',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+14*24*60*60*1000).toISOString()};
      });
      if (claim.xUserId !== String(session.user.id)) return json(res, 409, { error: 'Claim X user ID does not match the original account.' });
      if (claim.expiresAt && Date.parse(claim.expiresAt) < Date.now()) return json(res, 409, { error: 'Claim has expired; contact support for a new claim window.' });
      return json(res, 200, { claimId, recipient: claim.recipient, boundWallet:claim.publicKey||null, statement: `funded.app SOL claim ${claimId} for ${claim.recipient} nonce ${claim.nonce}`, expiresAt: claim.expiresAt });
    }

    const verifyId = decodeURIComponent(route(url.pathname, req.method, /^\/api\/sol-claims\/([^/]+)\/verify$/) || '');
    if (verifyId) {
      const input = await body(req); const state = await store.readClaimState(verifyId); const claim = state.claims[verifyId]; if (!claim) return json(res, 404, { error: 'Claim not found.' });
      const session = await xSession(req);
      if (!session?.user?.id || String(session.user.id) !== claim.xUserId) return json(res, 401, { error: 'Sign in with the original X account before verifying a wallet.' });
      if (String(input.xHandle || input.recipient || '').toLowerCase() !== `@${session.user.username}`.toLowerCase()) return json(res, 409, { error: 'X handle does not match the signed-in account.' });
      if (claim.expiresAt && Date.parse(claim.expiresAt) < Date.now()) return json(res, 409, { error: 'Claim has expired.' });
      const publicKey = new PublicKey(walletKey(input.publicKey)); const message = new TextEncoder().encode(`funded.app SOL claim ${verifyId} for ${claim.recipient} nonce ${claim.nonce}`); const signature = walletSignature(input.signature);
      if (!nacl.sign.detached.verify(message, signature, publicKey.toBytes())) return json(res, 401, { error: 'Wallet signature is invalid.' });
      if (claim.publicKey && claim.publicKey !== publicKey.toBase58()) return json(res, 409, { error: 'Claim is already bound to another verified wallet.' });
      const updated = await store.updateClaimState(verifyId,current => { const existing = current.claims[verifyId];assertObservedClaim(existing,claim); if (existing.publicKey && existing.publicKey !== publicKey.toBase58()) throw invalidRequest('Claim is already bound to another verified wallet.'); if (['paid','executing','verification-pending'].includes(existing.status)) return existing; current.claims[verifyId] = { ...existing, publicKey: publicKey.toBase58(), status: existing.xAttestation ? 'ready-to-execute' : 'wallet-verified', verifiedAt: new Date().toISOString() }; return current.claims[verifyId]; });
      const automaticStatus = await enrollAutomaticXReward(updated);
      return json(res, 200, { ...updated, automaticStatus });
    }

    const attestId = decodeURIComponent(route(url.pathname, req.method, /^\/api\/sol-claims\/([^/]+)\/attest$/) || '');
    if (attestId) {
      const input = await body(req); const handle = String(input.xHandle || input.recipient || '').trim();
      if (!/^@[A-Za-z0-9_]{1,15}$/.test(handle)) return json(res, 400, { error: 'A valid X handle is required.' });
      const state = await store.readClaimState(attestId); const claim = state.claims[attestId]; if (!claim) return json(res, 404, { error: 'Claim not found.' });
      const session = await xSession(req);
      const oauthMatchesHandle = session?.user?.id && String(session.user.id) === claim.xUserId && `@${session.user.username}`.toLowerCase() === handle.toLowerCase();
      const trusted = Boolean(oauthMatchesHandle) || (String(input.subject || '') === claim.xUserId && verifyHmacAttestation({ handle, subject: input.subject, issuedAt: input.issuedAt, signature: input.signature }));
      if (!trusted) return json(res, 401, { error: 'Trusted X identity attestation is required.' });
      if (claim.expiresAt && Date.parse(claim.expiresAt) < Date.now()) return json(res, 409, { error: 'Claim has expired.' });
      const updated = await store.updateClaimState(attestId,current => { const existing = current.claims[attestId];assertObservedClaim(existing,claim); if (['paid','executing','verification-pending'].includes(existing.status)) return existing; current.claims[attestId] = { ...existing, xAttestation: { provider: oauthMatchesHandle ? 'x-oauth' : 'trusted-webhook', subject: oauthMatchesHandle ? String(session.user.id) : String(input.subject), attestedAt: new Date().toISOString() }, status: existing.publicKey ? 'ready-to-execute' : 'x-attested-awaiting-wallet' }; return current.claims[attestId]; });
      await enrollAutomaticXReward(updated);
      return json(res, 200, updated);
    }

    const executeId = decodeURIComponent(route(url.pathname, req.method, /^\/api\/sol-claims\/([^/]+)\/execute$/) || '');
    if (executeId) {
      const state = await store.readClaimState(executeId); const claim = state.claims[executeId]; if (!claim) return json(res, 404, { error: 'Claim not found.' });
      const existing = Object.values(state.payouts).find(item => item.claimId === executeId);
      if (existing) return json(res, 200, existing);
      if (claim.expiresAt && Date.parse(claim.expiresAt) < Date.now()) return json(res, 409, { error: 'Claim has expired.' });
      if (!claim.xAttestation || claim.xAttestation.subject !== claim.xUserId) return json(res, 409, { error: 'The original X user ID must be attested before payout.' });
      if (!claim.publicKey) return json(res, 409, { error: 'A verified recipient wallet is required before payout.' });
      const obligation = state.obligations[claim.obligationId];
      if (!obligation || obligation.source !== 'verified-per-mint-router-collection') return json(res, 409, { error: 'A verified router-funded X fee obligation is required.' });
      const automaticRequest = Object.values((await automaticRewardStore.read()).fundingRequests || {}).find(item => item.kind === 'x' && item.obligationId === obligation.id);
      if (automaticRequest && automaticRequest.status !== 'awaiting-verified-recipient') return json(res, 409, { error: 'This verified X reward is enrolled for automatic delivery.', automaticStatus: automaticRequest.status });
      const recalculated = deriveXFeeObligation(state, { mint: obligation.mint, claimSignature: obligation.claimSignature });
      if (recalculated.id !== obligation.id || recalculated.amountLamports !== obligation.amountLamports || recalculated.router !== obligation.router || recalculated.recipient !== obligation.recipient || recalculated.xUserId !== obligation.xUserId || claim.xUserId !== obligation.xUserId) return json(res, 409, { error: 'Stored X fee amount or user ID does not match the verified launch policy and collection.' });
      const readiness = await xFeeReadiness();
      if (!readiness.ready) return json(res, 503, { error: 'Mint-router payout is not active on Solana.', reasons: readiness.reasons });
      const config = feeRouterConfig();
      const authority = routerAuthorityKeypair();
      const connection = new Connection(solanaRpcUrl, 'confirmed');
      const launch = state.launches[obligation.mint];
      const collection = state.collections[obligation.claimSignature];
      if (!launch?.onchainVerified || launch.pumpFeeRoute?.scope !== 'per-mint-v2' || launch.creator !== obligation.router || collection?.mint !== obligation.mint || collection?.router !== obligation.router || !collection.onchainVerified || collection.status !== 'collected' || obligation.recipient !== claim.recipient || claim.obligationId !== obligation.id) return json(res, 409, { error: 'Mint-specific launch, collection, and claim records do not match.' });
      const checked = await verifyMintFeeRouterAccount({ connection, programId: config.programId, mint: obligation.mint, expectedAuthority: authority.publicKey });
      if (!checked.verified || checked.address.toBase58() !== obligation.router) return json(res, 409, { error: 'The on-chain mint router does not match this payout obligation.' });
      const settlement = buildMintRouterSettlementInstruction({ programId: config.programId, mint: obligation.mint, authority: authority.publicKey, recipient: claim.publicKey, amountLamports: obligation.amountLamports, obligationId: obligation.id });
      const recordMatches = account => readMintClaimRecord(account, { programId: config.programId, mint: obligation.mint, recipient: claim.publicKey, amountLamports: obligation.amountLamports, claimId: settlement.claimId });
      const priorRecord = await connection.getAccountInfo(settlement.claim, 'confirmed');
      if (priorRecord && !recordMatches(priorRecord)) return json(res, 409, { error: 'The on-chain claim record conflicts with this obligation.' });
      const locked = await store.updateClaimState(executeId,current => {
        const currentClaim = current.claims[executeId];
        assertObservedClaim(currentClaim,claim);
        const currentObligation=deriveXFeeObligation(current,{mint:obligation.mint,claimSignature:obligation.claimSignature});
        if(currentObligation.amountLamports!==obligation.amountLamports||currentObligation.router!==obligation.router||currentObligation.xUserId!==claim.xUserId)throw new Error('Entitlement changed before execution.');
        if (currentClaim.status === 'paid' || currentClaim.status === 'executing') return false;
        if (!currentClaim.xAttestation || !currentClaim.publicKey || currentClaim.publicKey !== claim.publicKey) return false;
        currentClaim.status = 'executing'; currentClaim.executionStartedAt = new Date().toISOString(); return true;
      });
      if (!locked) return json(res, 409, { error: 'This claim is already executing or has been paid. Refresh its status.' });
      let signature = null;
      try {
        if (priorRecord) {
          const signatures = await connection.getSignaturesForAddress(settlement.claim, { limit: 1 }, 'confirmed');
          signature = signatures[0]?.signature || null;
        } else {
          const transaction = new Transaction().add(settlement.instruction);
          signature = await sendAndConfirmTransaction(connection, transaction, [authority], { commitment: 'confirmed' });
        }
        const onchainRecord = await connection.getAccountInfo(settlement.claim, 'confirmed');
        if (!recordMatches(onchainRecord)) throw new Error('Settlement submitted, but the matching on-chain claim record is not confirmed yet.');
        if (!signature) throw new Error('On-chain claim record exists, but its transaction signature is not indexed yet.');
        const paidAt = new Date().toISOString();
        const payout = await store.updateClaimState(executeId,current => {
          const payoutId = `x:${executeId}`;
          const record = { id: payoutId, claimId: executeId, obligationId: obligation.id, mint: obligation.mint, amountLamports: obligation.amountLamports, amountSol: obligation.amountSol, from: settlement.router.toBase58(), to: claim.publicKey, signature, status: 'paid', paidAt, source: 'mint-router-settle-mint', cluster: solanaCluster };
          current.payouts[payoutId] = record;
          current.claims[executeId] = { ...current.claims[executeId], status: 'paid', payoutId, payoutSignature: signature, paidAt };
          return record;
        });
        return json(res, 200, payout);
      } catch (error) {
        await store.updateClaimState(executeId,current => { if (current.claims[executeId]?.status === 'executing') current.claims[executeId] = { ...current.claims[executeId], status: 'verification-pending', failureReason: String(error.message || error), lastAttemptAt: new Date().toISOString() }; });
        throw error;
      }
    }
    return false;
  };
}
