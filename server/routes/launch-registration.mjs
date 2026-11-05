import { validateInput, invalidRequest } from '../http-policy.mjs';
import { newLaunchProtection, registerLaunchProtection } from '../launch-protections.mjs';
import { developerLockConfig, verifyLaunchDeveloperLock } from '../developer-token-lock.mjs';
import { canonicalLaunchPolicy, launchPolicyStatement } from '../../launch-policy-auth.js';
import { createMarketingAgencyRoutes } from './marketing-agency.mjs';
import { verifyLaunchServiceFee } from '../launch-service-fee-proof.mjs';
import { createLaunchBurnTiers } from '../../launch-burn-policy.js';
import { verifyPumpLaunch } from '../launch-verification.mjs';
import { PublicKey } from '@solana/web3.js';
import {SharedRpcConnection as Connection} from '../rpc-connection.mjs';
import { devnetMetadataUri, devnetLaunchMetadataUri, devnetBannerUri } from '../../devnet-metadata.js';
import { onchainMetadataUri } from '../../metadata-publication.js';
import { verifiedPromotionBadge } from '../../promotion-badge.js';
import { metadataRecordOrigin, publicMetadata } from '../devnet-metadata.mjs';
import { readProgramDataEvidence, DEVNET_GENESIS_HASH, createAutomaticRewardChain } from '../automatic-reward-chain.mjs';
import { buildCommunityAirdropPolicy, fundedCommunityAirdropPolicy } from '../../airdrop-policy.js';
import { readCommunityReserveStatus } from '../community-reserve-status.mjs';
import { buildFeeDistributionPolicy } from '../../distribution-policy.js';
import { buildSolClaimPolicy } from '../../sol-claim-policy.js';
import { activeProtocolFeeSplit } from '../active-protocol-fee.mjs';
import { protocolGrossUnits } from '../../mint-router-v3.js';
import { verifyV3LaunchRouterReadiness } from '../v3-launch-readiness.mjs';
import { verifyFeeRouterAccount } from '../../fee-router.js';
import { createV3LaunchConfig } from '../v3-launch-config.mjs';
import nacl from 'tweetnacl';
import {isDeletedDevnetMint} from '../deleted-devnet-mints.mjs';
import {newLaunchAgencySelection} from '../../config/marketing-agency.js';

// Called after the shared request policy, rate limit, and authorization checks.
// Return true only after sending a response; false lets the router continue.
export function createLaunchRegistrationRoutes({
  solanaCluster,
  body,
  store,
  automaticRewardStore,
  resolveXUser,
  fundedTokenMint,
  solanaRpcUrl,
  walletSignature,
  v3AuthorityKeypair,
  env = process.env,
  id,
  invalidateReserveCache,
  respond,
  connectionFactory = url => new Connection(url, 'finalized'),
  programEvidence = readProgramDataEvidence,
  verifyRouter = verifyFeeRouterAccount,
  v3LaunchConfig,
}) {
  const json = (...args) => { respond(...args); return true; };
  v3LaunchConfig ||= createV3LaunchConfig({ solanaCluster, solanaRpcUrl,
    automaticRewardStore, store,v3AuthorityKeypair, env, connectionFactory,
    programEvidence, verifyRouter });
  const handleMarketingAgency = createMarketingAgencyRoutes({ respond,store,readLaunchConfig:()=>v3LaunchConfig(),env });
  return async function handleLaunchRegistrationRoutes(req, res, url) {
    if (await handleMarketingAgency(req, res, url)) return true;
    if (req.method === 'GET' && url.pathname === '/api/v3-launch-config') {
      return json(res, 200, await v3LaunchConfig());
    }
    if (req.method === 'GET' && url.pathname === '/api/launch-reserve-config') {
      const config = await v3LaunchConfig();
      if (!config.ready || config.beneficiaryRoutingOnChainEnforced !== true
        || !env.FUNDED_LAUNCH_RESERVE_LOOKUP_TABLE) {
        return json(res, 503, { error:'The V3 atomic community reserve is not ready.',
          reasons:config.reasons });
      }
      const developerTokenLock=await developerLockConfig({connection:connectionFactory(solanaRpcUrl),env});
      if(!developerTokenLock.ready)return json(res,503,{error:developerTokenLock.reason});
      return json(res, 200, { cluster:'devnet', authority:config.initialAuthority,
        programId:config.programId, lookupTable:env.FUNDED_LAUNCH_RESERVE_LOOKUP_TABLE,developerTokenLock });
    }
    if (req.method === 'POST' && url.pathname === '/api/launches') {
      if (solanaCluster !== 'devnet') return json(res, 403, { error: 'Coin launching is unavailable for this configuration. No launch policy was registered.' });
      const input = await body(req); if (!input.mint || input.chain !== 'solana' || input.cluster !== solanaCluster) return json(res, 400, { error: 'A Solana launch on the configured cluster is required.' });
      if(isDeletedDevnetMint(input.mint,solanaCluster))return json(res,410,{error:'This old Devnet launch was permanently removed from the app.'});
      if (input.marketingAgency != null&&env.FUNDED_V3_AGENCY_ENABLED!=='true') return json(res, 409, { error: 'Agency-enabled launches require verified dedicated V3 agency accounting. The agency fee policy is not activated.' });
      const policy = validateInput(() => canonicalLaunchPolicy(input));
      const existingLaunch = await store.readLaunch(policy.mint);
      if (!existingLaunch && policy.xUserId && (await store.read()).creatorProfiles?.[policy.xUserId]?.optedOut) return json(res, 409, { error: 'This creator has opted out of new support launches. Existing entitlements are unchanged.' });
      const xLinked = policy.solClaimPercent > 0;
      if (input.pumpFeeRoute?.scope !== 'per-mint-v3') return json(res, 410, { error:'V2 launch registration is retired. Submit a verified V3 launch.' });
      const v3Config = await v3LaunchConfig();
      if (!v3Config.ready || v3Config.beneficiaryRoutingOnChainEnforced !== true)
        return json(res, 503, { error:'V3 normal flows are not ready to accept a new launch.',
          reasons:v3Config.reasons });
      // A finalized launch can predate a later global configuration publication.
      // Below, the Pump receipt, creator signature and immutable mint policy must
      // still match the exact signed revision, shares and agent selection.
      if(!existingLaunch&&v3Config.agency&&(policy.marketingAgency?.version!==v3Config.agency.version
        ||BigInt(policy.marketingAgency.configRevision)>BigInt(v3Config.agency.configRevision)))return json(res,409,{error:'The signed agency configuration is not available on this deployment.'});
      const requiredAgents=newLaunchAgencySelection({promotion:Boolean(policy.promotion)});
      const historicalAgency=!existingLaunch&&v3Config.agency&&policy.marketingAgency
        &&BigInt(policy.marketingAgency.configRevision)<BigInt(v3Config.agency.configRevision);
      // A prior on-chain revision may use the earlier package selection. The
      // finalized launch and immutable policy below must prove those exact terms.
      if(!existingLaunch&&!historicalAgency&&JSON.stringify(policy.marketingAgency?.selectedAgents)!==JSON.stringify(requiredAgents))
        return json(res,409,{error:'The signed agents must match the launch package: both buyback agents for Standard, plus X promotion for a promotion package.'});
      if (xLinked && env.FUNDED_V3_X_CLAIMS_ENABLED !== 'true')
        return json(res, 503, { error:'V3 X payout and claim verification are not activated.' });
      if (xLinked && (await resolveXUser(policy.xRecipient)).id !== policy.xUserId) return json(res, 409, { error: 'The X account ID changed since launch preparation; registration is blocked.' });
      const serviceQuote = input.launchServiceFee?.quoteId
        ? (await store.read()).launchServiceQuotes?.[input.launchServiceFee.quoteId] : null;
      if (!existingLaunch && !serviceQuote) return json(res,409,{error:'A saved launch service fee quote and atomic payment are required.'});
      if (!existingLaunch && ['policyHash','amountLamports','recipient'].some(key => input.launchServiceFee[key] !== serviceQuote[key])) return json(res,409,{error:'The signed launch service fee does not match the saved quote.'});
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
      const proof = await verifyPumpLaunch({ connection: new Connection(solanaRpcUrl, 'finalized'), mint: input.mint, signature: input.signature || input.pumpFeeRoute?.transaction,
        promotionClaim, promotionQuote, fundedMint: fundedTokenMint, promotionTiers,
        commitment:'finalized' });
      const preparedMetadata = await store.readMetadata(proof.mint);
      const serviceFeeReceipt = !existingLaunch ? verifyLaunchServiceFee({
        transaction:await connectionFactory(solanaRpcUrl).getTransaction(proof.signature,{commitment:'finalized',maxSupportedTransactionVersion:0}),
        signature:proof.signature, mint:proof.mint, payer:proof.feePayer, quote:serviceQuote }) : existingLaunch.launchServiceFee;
      const legacyMetadataUri=devnetMetadataUri(proof.mint,metadataRecordOrigin(preparedMetadata));
      const pinnedUri=preparedMetadata?.pinnedMetadata?.uri;
      const preparedMetadataUri=pinnedUri ? (proof.uri===pinnedUri ? pinnedUri : onchainMetadataUri(pinnedUri))
        : (proof.uri===devnetLaunchMetadataUri(proof.mint)?proof.uri:legacyMetadataUri);
      if (input.metadataUri && input.metadataUri !== preparedMetadataUri) return json(res, 409, { error: 'Launch metadata URL does not match the mint.' });
      if (input.metadataUri && !preparedMetadata) return json(res, 409, { error: 'Signed Devnet metadata is missing.' });
      if (preparedMetadata && (preparedMetadata.creatorWallet !== proof.feePayer || preparedMetadata.name !== proof.name || preparedMetadata.symbol !== proof.symbol || (proof.uri && proof.uri !== preparedMetadataUri))) return json(res, 409, { error: 'Signed metadata does not match the confirmed Pump launch.' });
      const configuredV3Program = String(env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID || '').trim();
      const currentSplit = existingLaunch?.pumpFeeRoute?.protocolSplit||(historicalAgency?policy.protocolSplit:v3Config.protocolSplit)||await activeProtocolFeeSplit(store);
      const configuredV3Units = protocolGrossUnits(currentSplit);
      if (!configuredV3Program || policy.feeRouterProgramId !== configuredV3Program
        || policy.feeRouterInitialAuthority !== v3Config.initialAuthority
        || protocolGrossUnits(policy.protocolSplit).some((units, index) => units !== configuredV3Units[index])) {
        return json(res, 409, { error:'The signed V3 program or protocol split does not match this deployment.' });
      }
      const routeReadiness = await verifyV3LaunchRouterReadiness({ connection:new Connection(solanaRpcUrl, 'finalized'),
          programId:configuredV3Program, expectedProgramDataSha256:env.FUNDED_V3_PROGRAM_DATA_SHA256,
          mint:proof.mint, creatorWallet:proof.feePayer,
          initialAuthority:policy.feeRouterInitialAuthority, split:currentSplit,
          agencySelection:policy.marketingAgency||null,directedShares:{ creatorWalletPercent:policy.creatorWalletPercent,
            holderAirdropPercent:policy.holderAirdropPercent,
            solClaimPercent:policy.solClaimPercent }, requireProtectedPolicy:true });
      if (!routeReadiness.ready) return json(res, routeReadiness.status, { error: routeReadiness.error });
      const configuredRouter = routeReadiness.configuredRouter;
      if (policy.creatorWallet !== proof.feePayer || policy.feeRouter !== proof.creator || policy.feeRouter !== configuredRouter) return json(res, 409, { error: 'Launch payer or Pump fee owner does not match the signed router policy.' });
      const signature = walletSignature(input.policySignature);
      if (!nacl.sign.detached.verify(new TextEncoder().encode(launchPolicyStatement(input)), signature, new PublicKey(policy.creatorWallet).toBytes())) return json(res, 401, { error: 'Creator wallet signature for this launch policy is invalid.' });
      let verifiedReserve = null;
      if (!existingLaunch) {
        const authority = v3AuthorityKeypair();
        const requiredAuthority = v3Config.initialAuthority;
        const rewardProgramHash = env.FUNDED_V3_PROGRAM_DATA_SHA256;
        if (!authority || authority.publicKey.toBase58() !== requiredAuthority || !rewardProgramHash)
          return json(res, 503, { error:'Community vault authority is unavailable. The coin cannot be registered as a funded airdrop.' });
        const reserveConnection = new Connection(solanaRpcUrl, 'finalized');
        const programId = new PublicKey(configuredV3Program);
        const [genesis, programEvidence] = await Promise.all([reserveConnection.getGenesisHash(), readProgramDataEvidence(reserveConnection, programId)]);
        if (genesis !== DEVNET_GENESIS_HASH || !programEvidence.account?.executable
          || programEvidence.sha256 !== rewardProgramHash.toLowerCase())
          return json(res, 503, { error:'The approved Solana reward program could not be verified.' });
        const chain = createAutomaticRewardChain({ connection:reserveConnection, programId, authority,
          expectedProgramDataSha256:rewardProgramHash });
        await chain.ensureVault(proof.mint);
        const allocation = buildCommunityAirdropPolicy({ allocationPercent:policy.communityAllocation, supply:1_000_000_000 });
        verifiedReserve = await readCommunityReserveStatus({ connection:reserveConnection, programId,
          authority:requiredAuthority, fundingAuthority:proof.feePayer, mint:proof.mint,
          reservedTokens:allocation.reservedTokens, fundingSignature:proof.signature });
        if (!verifiedReserve.verified || verifiedReserve.status !== 'funded' || verifiedReserve.fundingSignature !== proof.signature)
          return json(res, 422, { error:'Launch transaction did not fund the exact community reserve in the reward vault.', reserve:verifiedReserve });
      }
      let developerTokenLock=existingLaunch?.developerTokenLock;
      if(!existingLaunch){
        const lockConnection=connectionFactory(solanaRpcUrl);
        try{developerTokenLock=await verifyLaunchDeveloperLock({connection:lockConnection,proof,reserve:verifiedReserve,serviceQuote,
          transaction:await lockConnection.getTransaction(proof.signature,{commitment:'finalized',maxSupportedTransactionVersion:0}),
          config:await developerLockConfig({connection:lockConnection,env})});}
        catch{return json(res,422,{error:'The finalized launch must escrow its exact developer token purchase for 12 hours. Escrow verification failed; recover this launch receipt before creating another coin.'});}
      }
      const feeDistribution = buildFeeDistributionPolicy({ creatorWalletPercent: policy.creatorWalletPercent, holderAirdropPercent: policy.holderAirdropPercent, solClaimPercent: policy.solClaimPercent, xRecipient: policy.xRecipient, feeRouterAddress: configuredRouter },{fundedSplit:currentSplit});
      const record = {
        ...proof, cluster: solanaCluster, creatorWallet: proof.feePayer,
        launchProtection:newLaunchProtection(proof, policy.creatorWalletPercent),
        ...(developerTokenLock?{developerTokenLock}:{}),
        ...(serviceFeeReceipt ? { launchServiceFee:serviceFeeReceipt } : {}),
        ...(preparedMetadata ? { metadataUri: preparedMetadataUri, description: preparedMetadata.description, imageUri: publicMetadata(preparedMetadata).image, website: preparedMetadata.website, twitter: preparedMetadata.x, telegram: preparedMetadata.telegram, discord: preparedMetadata.discord } : {}),
        ...(preparedMetadata?.bannerSha256 && verifiedPromotionBadge(proof) ? { bannerUri: publicMetadata(preparedMetadata).banner } : {}),
        communityAllocation: policy.communityAllocation,
        ...(xLinked ? { xUserId: policy.xUserId } : {}),
        communityAirdrop: verifiedReserve
          ? fundedCommunityAirdropPolicy({ allocationPercent:policy.communityAllocation, supply:1_000_000_000,
            receipt:{ atomic:true, signature:proof.signature, vault:verifiedReserve.vault, fundedTokens:Number(verifiedReserve.fundedTokens) } })
          : buildCommunityAirdropPolicy({ allocationPercent: policy.communityAllocation, supply: 1_000_000_000 }),
        ...(verifiedReserve ? { communityReserve:{ vault:verifiedReserve.vault, tokenAccount:verifiedReserve.tokenAccount,
          fundingSignature:proof.signature, fundedTokens:verifiedReserve.fundedTokens, verified:true, atomicWithPumpLaunch:true } } : {}),
        feeDistribution,
        ...(policy.marketingAgency?{marketingAgency:policy.marketingAgency}:{}),
        solClaim: { ...buildSolClaimPolicy({ handle: policy.xRecipient, percent: policy.solClaimPercent, feeRouterAddress: configuredRouter }), forwardingStatus: xLinked ? 'awaiting-mint-verified-collection' : 'not-selected' },
        pumpFeeRoute: { percent: 100, router: proof.creator, scope:'per-mint-v3',
          verified: true, transaction: proof.signature,
          programId:configuredV3Program,
          initialAuthority:policy.feeRouterInitialAuthority, protocolSplit:currentSplit },
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
        registerLaunchProtection(state, record);
        state.launches[record.mint] = record;
        if (verifiedReserve) {
          state.communityReserveReceipts ||= {};
          state.communityReserveReceipts[record.mint] = { signature:proof.signature,
            creatorWallet:proof.feePayer, recordedAt:new Date().toISOString() };
        }
        return record;
      });
      invalidateReserveCache();
      return json(res, 201, { ...saved,
        automaticRewards:{ status:'v3-collection-routing-pending' } });
    }
    return false;
  };
}
