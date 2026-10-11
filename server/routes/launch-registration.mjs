import { validateInput, invalidRequest } from '../http-policy.mjs';
import { canonicalLaunchPolicy, launchPolicyStatement } from '../../launch-policy-auth.js';
import { createLaunchBurnTiers } from '../../launch-burn-policy.js';
import { verifyPumpLaunch } from '../launch-verification.mjs';
import { Connection, PublicKey } from '@solana/web3.js';
import { devnetMetadataUri, devnetBannerUri } from '../../devnet-metadata.js';
import { verifiedPromotionBadge } from '../../promotion-badge.js';
import { metadataRecordOrigin, publicMetadata } from '../devnet-metadata.mjs';
import { verifyLaunchRouterReadiness } from '../launch-router-readiness.mjs';
import { readProgramDataEvidence, DEVNET_GENESIS_HASH, createAutomaticRewardChain } from '../automatic-reward-chain.mjs';
import { buildCommunityAirdropPolicy, fundedCommunityAirdropPolicy } from '../../airdrop-policy.js';
import { readCommunityReserveStatus } from '../community-reserve-status.mjs';
import { buildFeeDistributionPolicy } from '../../distribution-policy.js';
import { buildSolClaimPolicy } from '../../sol-claim-policy.js';
import nacl from 'tweetnacl';

// Called after the shared request policy, rate limit, and authorization checks.
// Return true only after sending a response; false lets the router continue.
export function createLaunchRegistrationRoutes({
  solanaCluster,
  body,
  store,
  xFeeReadiness,
  resolveXUser,
  fundedTokenMint,
  solanaRpcUrl,
  feeRouterConfig,
  walletSignature,
  routerAuthorityKeypair,
  id,
  invalidateReserveCache,
  registerAutomaticLaunch,
  respond,
}) {
  const json = (...args) => { respond(...args); return true; };
  return async function handleLaunchRegistrationRoutes(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/launch-reserve-config') {
      if (solanaCluster !== 'devnet' || !process.env.FUNDED_REWARD_AUTHORITY || !process.env.FUNDED_LAUNCH_RESERVE_LOOKUP_TABLE)
        return json(res, 503, { error:'Atomic Solana community reserve is not configured.' });
      return json(res, 200, { cluster:'devnet', authority:process.env.FUNDED_REWARD_AUTHORITY,
        programId:process.env.FUNDED_FEE_ROUTER_PROGRAM_ID,
        lookupTable:process.env.FUNDED_LAUNCH_RESERVE_LOOKUP_TABLE });
    }
    if (req.method === 'POST' && url.pathname === '/api/launches') {
      if (solanaCluster !== 'devnet') return json(res, 403, { error: 'Coin launching is unavailable for this configuration. No launch policy was registered.' });
      const input = await body(req); if (!input.mint || input.chain !== 'solana' || input.cluster !== solanaCluster) return json(res, 400, { error: 'A Solana launch on the configured cluster is required.' });
      const policy = validateInput(() => canonicalLaunchPolicy(input));
      const existingLaunch = await store.readLaunch(policy.mint);
      if (!existingLaunch && policy.xUserId && (await store.read()).creatorProfiles?.[policy.xUserId]?.optedOut) return json(res, 409, { error: 'This creator has opted out of new support launches. Existing entitlements are unchanged.' });
      const xLinked = policy.solClaimPercent > 0;
      const perMint = input.pumpFeeRoute?.scope === 'per-mint-v2';
      if (!existingLaunch && !perMint) return json(res, 409, { error: 'New launches require a mint-specific fee router for attributable automatic rewards.' });
      if (xLinked && !(await xFeeReadiness()).ready) return json(res, 503, { error: 'X fee claims are not operational on Solana yet.' });
      if (xLinked && (await resolveXUser(policy.xRecipient)).id !== policy.xUserId) return json(res, 409, { error: 'The X account ID changed since launch preparation; registration is blocked.' });
      const promotionClaim = input.creatorLaunchBurn || null;
      const paidClaim = promotionClaim && promotionClaim.tier !== 'standard';
      const promotionQuote = paidClaim && promotionClaim.quoteId
        ? (await store.read()).launchTierQuotes?.[String(promotionClaim.quoteId)] : null;
      if (paidClaim && !existingLaunch && (!promotionQuote
        || promotionQuote.tier !== promotionClaim.tier || promotionQuote.payer !== policy.creatorWallet
        || promotionQuote.fundedMint !== fundedTokenMint || promotionQuote.amountTokens !== promotionClaim.amountTokens))
        return json(res, 409, { error:'A saved $FUNDED launch quote matching this wallet and burn is required.' });
      const promotionTiers = createLaunchBurnTiers({
        boostAmount:Number(process.env.VITE_FUNDED_BOOST_BURN_AMOUNT || 25_000),
        proAmount:Number(process.env.VITE_FUNDED_PRO_BURN_AMOUNT || 100_000),
        premierAmount:Number(process.env.VITE_FUNDED_PREMIER_BURN_AMOUNT || 250_000),
      });
      const proof = await verifyPumpLaunch({ connection: new Connection(solanaRpcUrl, 'confirmed'), mint: input.mint, signature: input.signature || input.pumpFeeRoute?.transaction,
        promotionClaim, promotionQuote, fundedMint: fundedTokenMint, promotionTiers });
      const preparedMetadata = await store.readMetadata(proof.mint);
      const preparedMetadataUri = devnetMetadataUri(proof.mint, metadataRecordOrigin(preparedMetadata));
      if (input.metadataUri && input.metadataUri !== preparedMetadataUri) return json(res, 409, { error: 'Launch metadata URL does not match the mint.' });
      if (input.metadataUri && !preparedMetadata) return json(res, 409, { error: 'Signed Devnet metadata is missing.' });
      if (preparedMetadata && (preparedMetadata.creatorWallet !== proof.feePayer || preparedMetadata.name !== proof.name || preparedMetadata.symbol !== proof.symbol || (proof.uri && proof.uri !== preparedMetadataUri))) return json(res, 409, { error: 'Signed metadata does not match the confirmed Pump launch.' });
      const routerConfig = feeRouterConfig();
      const routeReadiness = await verifyLaunchRouterReadiness({ connection: new Connection(solanaRpcUrl, 'confirmed'), routerConfig, mint: proof.mint, perMint });
      if (!routeReadiness.ready) return json(res, routeReadiness.status, { error: routeReadiness.error });
      const configuredRouter = routeReadiness.configuredRouter;
      if (policy.creatorWallet !== proof.feePayer || policy.feeRouter !== proof.creator || policy.feeRouter !== configuredRouter) return json(res, 409, { error: 'Launch payer or Pump fee owner does not match the signed router policy.' });
      const signature = walletSignature(input.policySignature);
      if (!nacl.sign.detached.verify(new TextEncoder().encode(launchPolicyStatement(input)), signature, new PublicKey(policy.creatorWallet).toBytes())) return json(res, 401, { error: 'Creator wallet signature for this launch policy is invalid.' });
      let verifiedReserve = null;
      if (!existingLaunch) {
        const authority = routerAuthorityKeypair();
        const requiredAuthority = String(process.env.FUNDED_REWARD_AUTHORITY || '');
        if (!authority || authority.publicKey.toBase58() !== requiredAuthority || !process.env.FUNDED_REWARD_PROGRAM_DATA_SHA256)
          return json(res, 503, { error:'Community vault authority is unavailable. The coin cannot be registered as a funded airdrop.' });
        const reserveConnection = new Connection(solanaRpcUrl, 'finalized');
        const programId = new PublicKey(process.env.FUNDED_FEE_ROUTER_PROGRAM_ID);
        const [genesis, programEvidence] = await Promise.all([reserveConnection.getGenesisHash(), readProgramDataEvidence(reserveConnection, programId)]);
        if (genesis !== DEVNET_GENESIS_HASH || !programEvidence.account?.executable
          || programEvidence.sha256 !== process.env.FUNDED_REWARD_PROGRAM_DATA_SHA256.toLowerCase())
          return json(res, 503, { error:'The approved Solana reward program could not be verified.' });
        const chain = createAutomaticRewardChain({ connection:reserveConnection, programId, authority,
          expectedProgramDataSha256:process.env.FUNDED_REWARD_PROGRAM_DATA_SHA256 });
        await chain.ensureVault(proof.mint);
        const allocation = buildCommunityAirdropPolicy({ allocationPercent:policy.communityAllocation, supply:1_000_000_000 });
        verifiedReserve = await readCommunityReserveStatus({ connection:reserveConnection, programId,
          authority:requiredAuthority, fundingAuthority:proof.feePayer, mint:proof.mint,
          reservedTokens:allocation.reservedTokens, fundingSignature:proof.signature });
        if (!verifiedReserve.verified || verifiedReserve.status !== 'funded' || verifiedReserve.fundingSignature !== proof.signature)
          return json(res, 422, { error:'Launch transaction did not fund the exact community reserve in the reward vault.', reserve:verifiedReserve });
      }
      const feeDistribution = buildFeeDistributionPolicy({ creatorWalletPercent: policy.creatorWalletPercent, holderAirdropPercent: policy.holderAirdropPercent, solClaimPercent: policy.solClaimPercent, xRecipient: policy.xRecipient, feeRouterAddress: configuredRouter });
      const record = {
        ...proof, cluster: solanaCluster, creatorWallet: proof.feePayer,
        ...(preparedMetadata ? { metadataUri: preparedMetadataUri, description: preparedMetadata.description, imageUri: publicMetadata(preparedMetadata).image, website: preparedMetadata.website, twitter: preparedMetadata.x, telegram: preparedMetadata.telegram, discord: preparedMetadata.discord } : {}),
        ...(preparedMetadata?.bannerSha256 && verifiedPromotionBadge(proof) ? { bannerUri: devnetBannerUri(proof.mint, metadataRecordOrigin(preparedMetadata)) } : {}),
        communityAllocation: policy.communityAllocation,
        ...(xLinked ? { xUserId: policy.xUserId } : {}),
        communityAirdrop: verifiedReserve
          ? fundedCommunityAirdropPolicy({ allocationPercent:policy.communityAllocation, supply:1_000_000_000,
            receipt:{ atomic:true, signature:proof.signature, vault:verifiedReserve.vault, fundedTokens:Number(verifiedReserve.fundedTokens) } })
          : buildCommunityAirdropPolicy({ allocationPercent: policy.communityAllocation, supply: 1_000_000_000 }),
        ...(verifiedReserve ? { communityReserve:{ vault:verifiedReserve.vault, tokenAccount:verifiedReserve.tokenAccount,
          fundingSignature:proof.signature, fundedTokens:verifiedReserve.fundedTokens, verified:true, atomicWithPumpLaunch:true } } : {}),
        feeDistribution,
        solClaim: { ...buildSolClaimPolicy({ handle: policy.xRecipient, percent: policy.solClaimPercent, feeRouterAddress: configuredRouter }), forwardingStatus: xLinked ? 'awaiting-mint-verified-collection' : 'not-selected' },
        pumpFeeRoute: { percent: 100, router: proof.creator, scope: perMint ? 'per-mint-v2' : 'shared-legacy', verified: true, transaction: proof.signature },
        policyStatement: launchPolicyStatement(input), policySignature: String(input.policySignature),
        id: id('launch'), updatedAt: new Date().toISOString(),
      };
      const saved = await store.update(state => {
        const existing = state.launches[record.mint];
        if (existing) {
          if (existing.policyStatement !== record.policyStatement) throw invalidRequest('An immutable launch policy already exists for this mint.');
          return existing;
        }
        if (record.xUserId && state.creatorProfiles?.[record.xUserId]?.optedOut) throw invalidRequest('This creator opted out during verification. Registration is blocked.');
        state.launches[record.mint] = record;
        if (verifiedReserve) {
          state.communityReserveReceipts ||= {};
          state.communityReserveReceipts[record.mint] = { signature:proof.signature,
            creatorWallet:proof.feePayer, recordedAt:new Date().toISOString() };
        }
        return record;
      });
      invalidateReserveCache();
      let automaticRewards = { status:'registered' };
      try { await registerAutomaticLaunch(saved); }
      catch (error) { automaticRewards = { status:'unavailable', reason:String(error.message || error) }; }
      return json(res, 201, { ...saved, automaticRewards });
    }
    return false;
  };
}
