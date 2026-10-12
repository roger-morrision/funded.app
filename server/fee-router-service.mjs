import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import bs58 from 'bs58';
import { Connection as RpcConnection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction as sendTransaction } from '@solana/web3.js';
import { OnlinePumpSdk as PumpSdk } from '@pump-fun/pump-sdk';
import { deriveFeeRouter, deriveMintFeeRouter, verifyFeeRouterAccount as verifyRouter, verifyMintFeeRouterAccount as verifyMintRouter } from '../fee-router.js';
import { PROTOCOL_FEE_SPLIT } from '../config/protocol-fee-split.js';
import { deriveMintRouterV3, protocolGrossUnits } from '../mint-router-v3.js';
import { verifyV3LaunchRouterReadiness as verifyV3Readiness } from './v3-launch-readiness.mjs';
import { loadFinalizedV3PumpCollection as loadV3Collection } from './v3-finalized-collection.mjs';
import { readProgramDataEvidence as readProgramEvidence } from './automatic-reward-chain.mjs';
import { buildMintCreatorFeeCollectionInstructions as buildMintInstructions } from './pump-fee-collection.mjs';
import { LAUNCH_TIER_USD } from '../launch-tier-quote.js';
import { sendFinalizedSolPayout as sendFinalizedReferral, reconcileFinalizedSolPayout as reconcileFinalizedReferral, solToLamports } from './referral-sol-transfer.mjs';

// One service per API instance. Inject RPC/signing dependencies for isolated tests.
export function createFeeRouterService({
  store, solanaCluster, solanaRpcUrl, fundedTokenMint, devnetTestMode, xConfig, resolveXUser,
  env = process.env, Connection = RpcConnection, OnlinePumpSdk = PumpSdk,
  sendAndConfirmTransaction = sendTransaction, sendFinalizedSolPayout = sendFinalizedReferral,
  reconcileFinalizedSolPayout = reconcileFinalizedReferral, verifyFeeRouterAccount = verifyRouter,
  verifyMintFeeRouterAccount = verifyMintRouter, readProgramDataEvidence = readProgramEvidence,
  buildMintCreatorFeeCollectionInstructions = buildMintInstructions,
  verifyV3LaunchRouterReadiness = verifyV3Readiness,
  loadFinalizedV3PumpCollection = loadV3Collection,
}) {
  function keeperKeypair() {
    const filePath = String(env.SOLANA_KEEPER_KEYPAIR_PATH || '').trim();
    if (filePath) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(resolve(filePath), 'utf8'))));
    const encoded = String(env.SOLANA_KEEPER_SECRET_KEY || '').trim();
    if (!encoded) return null;
    return Keypair.fromSecretKey(bs58.decode(encoded));
  }
  function referralPayoutKeypair() {
    const filePath = String(env.SOLANA_REFERRAL_PAYOUT_KEYPAIR_PATH || '').trim();
    if (filePath) return uniquePayoutKeypair(Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(resolve(filePath), 'utf8')))));
    const encoded = String(env.SOLANA_REFERRAL_PAYOUT_SECRET_KEY || '').trim();
    return encoded ? uniquePayoutKeypair(Keypair.fromSecretKey(bs58.decode(encoded))) : null;
  }
  function uniquePayoutKeypair(payer) {
    const keeper = keeperKeypair(), authority = routerAuthorityKeypair();
    const recipientWallets = [env.FUNDED_PUMP_REVENUE_WALLET, env.FUNDED_TRADE_FEE_OWNER || env.VITE_FUNDED_TRADE_FEE_OWNER].filter(Boolean);
    if ((keeper && payer.publicKey.equals(keeper.publicKey)) || (authority && payer.publicKey.equals(authority.publicKey))
      || recipientWallets.some(address => payer.publicKey.equals(new PublicKey(address)))) return null;
    return payer;
  }
  function routerAuthorityKeypair() {
    const filePath = String(env.FUNDED_ROUTER_AUTHORITY_KEYPAIR_PATH || '').trim();
    if (filePath) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(resolve(filePath), 'utf8'))));
    const encoded = String(env.FUNDED_ROUTER_AUTHORITY_SECRET_KEY || '').trim();
    if (!encoded) return null;
    return Keypair.fromSecretKey(bs58.decode(encoded));
  }
  async function mintRouterReadiness({ creatorSigned = false, collectionOnly = false } = {}) {
    const reasons = [];
    if (!creatorSigned && !collectionOnly) reasons.push('Creator wallet co-signing for on-chain 80/20 settlements is not yet available in the payout flow');
    if (solanaCluster !== 'devnet') reasons.push('Solana is required');
    if (env.FUNDED_MINT_FEE_ROUTER_ENABLED !== 'true') reasons.push('mint router route is disabled');
    if (!feeRouterConfig()) reasons.push('fee router is not configured');
    let keeper = null;
    try { keeper = keeperKeypair(); } catch { reasons.push('fee collector key is invalid'); }
    if (!keeper || env.SOLANA_KEEPER_CONFIGURED !== 'true') reasons.push('fee collector is not configured');
    let authority = null;
    try { authority = routerAuthorityKeypair(); } catch { reasons.push('router settlement authority key is invalid'); }
    if (!authority) reasons.push('router settlement authority is not configured');
    if (keeper && authority && keeper.publicKey.equals(authority.publicKey)) reasons.push('fee collector and router settlement authority must use separate wallets');
    const revenueWallet = String(env.FUNDED_PUMP_REVENUE_WALLET || '').trim();
    if (!revenueWallet) reasons.push('Pump revenue wallet is not configured');
    else {
      try {
        const revenue = new PublicKey(revenueWallet);
        if ((keeper && revenue.equals(keeper.publicKey)) || (authority && revenue.equals(authority.publicKey))) reasons.push('Pump revenue wallet must differ from the fee collector and router authority');
        const tradeOwner = String(env.FUNDED_TRADE_FEE_OWNER || env.VITE_FUNDED_TRADE_FEE_OWNER || '').trim();
        if (tradeOwner) {
          try {
            const trade = new PublicKey(tradeOwner);
            if (revenue.equals(trade) || (keeper && trade.equals(keeper.publicKey)) || (authority && trade.equals(authority.publicKey))) reasons.push('Trading fee wallet must differ from Pump revenue, fee collector, and router authority');
          }
          catch { reasons.push('Trading fee wallet is invalid'); }
        }
      } catch { reasons.push('Pump revenue wallet is invalid'); }
    }
    if (reasons.length === 0) {
      try {
        const router = feeRouterConfig();
        const connection = new Connection(solanaRpcUrl, 'confirmed');
        const [evidence, verified, legacy] = await Promise.all([
          readProgramDataEvidence(connection, router.programId),
          verifyFeeRouterAccount({ connection, programId: router.programId.toBase58() }),
          connection.getAccountInfo(router.address, 'confirmed'),
        ]);
        if (!evidence.account?.executable || !verified.verified) reasons.push('fee router program or legacy header is not verified');
        if (!env.FUNDED_REWARD_PROGRAM_DATA_SHA256 || evidence.sha256 !== env.FUNDED_REWARD_PROGRAM_DATA_SHA256.toLowerCase()) reasons.push('fee router program bytecode is not approved');
        if (legacy?.data?.length !== 74 || !new PublicKey(legacy.data.subarray(41, 73)).equals(authority.publicKey)) reasons.push('settlement authority does not match the on-chain router');
      } catch { reasons.push('Solana fee router could not be verified'); }
    }
    return { ready: reasons.length === 0, reasons };
  }
  async function xFeeReadiness({ includeLookupHealth = true, creatorSigned = false } = {}) {
    const base = await mintRouterReadiness({ creatorSigned });
    const reasons = [...base.reasons];
    if (!xConfig().clientId || !xConfig().clientSecret) reasons.push('X OAuth is not configured');
    if (!String(env.X_BEARER_TOKEN || '').trim()) reasons.push('X user lookup is not configured');
    if (includeLookupHealth && resolveXUser.health()) reasons.push(resolveXUser.health());
    return { ready: reasons.length === 0, reasons };
  }
  function feeRouterConfig() {
    const programId = String(env.FUNDED_FEE_ROUTER_PROGRAM_ID || env.VITE_FUNDED_FEE_ROUTER_PROGRAM_ID || '').trim();
    return programId ? deriveFeeRouter(programId) : null;
  }
  function launchPolicyConfig() {
    return {
      cluster: solanaCluster,
      feeRouterProgramId: feeRouterConfig()?.programId.toBase58() || null,
      fundedMint: fundedTokenMint || null,
      burnAmounts: { boost: Number(env.VITE_FUNDED_BOOST_BURN_AMOUNT || 25_000) },
      burnUsdTargets: LAUNCH_TIER_USD,
      burnPricing: 'verified-pool-spot',
    };
  }

  async function executeSolPayout({ recipientWallet, amountSol, onSigned }) {
    const payer = referralPayoutKeypair();
    if (!payer || (env.SOLANA_REFERRAL_PAYOUT_CONFIGURED !== 'true' && !devnetTestMode)) throw new Error('Dedicated referral payout wallet is not configured.');
    const recipient = new PublicKey(recipientWallet);
    const lamports = solToLamports(amountSol);
    const connection = new Connection(solanaRpcUrl, 'confirmed');
    const proof = await sendFinalizedSolPayout({ connection, payer, recipient, lamports, onSigned });
    return { ...proof, amountSol: Number(amountSol), cluster: solanaCluster };
  }
  async function reconcileSolPayout({ recipientWallet, amountSol, signature, from }) {
    const payer = from ? new PublicKey(from) : referralPayoutKeypair()?.publicKey;
    if (!payer) throw new Error('Original referral payout wallet is unavailable for reconciliation.');
    const recipient = new PublicKey(recipientWallet);
    const lamports = solToLamports(amountSol);
    const connection = new Connection(solanaRpcUrl, 'confirmed');
    const proof = await reconcileFinalizedSolPayout({ connection, payer, recipient, lamports, signature });
    return { ...proof, amountSol: Number(amountSol), cluster: solanaCluster };
  }
  async function collectPumpCreatorFees({ requestedMint }) {
    const keeper = keeperKeypair();
    const config = feeRouterConfig();
    if (!keeper || !config || (env.SOLANA_KEEPER_CONFIGURED !== 'true' && !devnetTestMode)) throw new Error('Keeper and fee-router configuration are required.');
    const connection = new Connection(solanaRpcUrl, 'confirmed');
    const verification = await verifyFeeRouterAccount({ connection, programId: config.programId.toBase58() });
    if (!verification.verified) throw new Error(`Fee router is not deployable: ${verification.reason}.`);
    const mintKey = new PublicKey(String(requestedMint || ''));
    const launch = await store.readLaunch(mintKey.toBase58());
    if (!launch?.onchainVerified || launch.cluster !== solanaCluster) throw new Error('A verified launch for this mint is required before collection.');
    const perMint = launch.pumpFeeRoute?.scope === 'per-mint-v2';
    const perMintV3 = launch.pumpFeeRoute?.scope === 'per-mint-v3';
    const mintSpecific = perMint || perMintV3;
    const v3ProgramId = String(env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID || '').trim();
    let router = perMint ? deriveMintFeeRouter(config.programId, mintKey) : config;
    if (perMintV3) {
      if (env.FUNDED_V3_COLLECTION_ENABLED !== 'true' || !v3ProgramId
        || launch.pumpFeeRoute.programId !== v3ProgramId
        || protocolGrossUnits(launch.pumpFeeRoute.protocolSplit).some((units, index) => units !== protocolGrossUnits(PROTOCOL_FEE_SPLIT)[index])) {
        throw new Error('V3 collection is not activated for this immutable launch policy.');
      }
      router = deriveMintRouterV3(v3ProgramId, mintKey);
      const main = await store.read();
      if (Object.values(main.collections || {}).some(row => row.mint === mintKey.toBase58()
        && row.scope === 'per-mint-v3' && !main.v3Settlements?.[row.signature])) {
        throw new Error('A prior V3 collection needs finalized settlement before another collection.');
      }
      const readiness = await verifyV3LaunchRouterReadiness({ connection, programId:v3ProgramId,
        expectedProgramDataSha256:env.FUNDED_V3_PROGRAM_DATA_SHA256,
        mint:mintKey, creatorWallet:launch.creatorWallet,
        initialAuthority:launch.pumpFeeRoute.initialAuthority, split:PROTOCOL_FEE_SPLIT });
      if (!readiness.ready || readiness.configuredRouter !== router.address.toBase58()) {
        throw new Error(`V3 collection program and mint policy are not verified: ${readiness.error || 'router mismatch'}.`);
      }
    }
    if (perMint) {
      // Collection is keeper signed. Creator approval is checked when a payout is prepared.
      if (!(await mintRouterReadiness({ collectionOnly: true })).ready) throw new Error('Mint-specific collection is not activated.');
      const legacy = await connection.getAccountInfo(config.address, 'confirmed');
      const checked = await verifyMintFeeRouterAccount({ connection, programId: config.programId, mint: mintKey, expectedAuthority: new PublicKey(legacy.data.subarray(41, 73)) });
      if (!checked.verified) throw new Error(`Mint router verification failed: ${checked.reason}.`);
    }
    const online = new OnlinePumpSdk(connection);
    const curve = await online.fetchBondingCurve(mintKey);
    if (!curve?.creator?.equals(router.address) || launch.creator !== router.address.toBase58()) throw new Error('The on-chain Pump fee owner does not match this launch router.');
    const beforeLamports = await connection.getBalance(router.address, 'confirmed');
    const instructions = mintSpecific
      ? (await buildMintCreatorFeeCollectionInstructions({ connection, router:router.address, keeper:keeper.publicKey })).instructions
      : await online.collectCoinCreatorFeeInstructions(router.address, keeper.publicKey);
    if (!instructions.length) return { requestedMint: mintKey.toBase58(), mint: mintSpecific ? mintKey.toBase58() : null, attribution: mintSpecific ? 'mint-verified' : 'router', router: router.address.toBase58(), status: 'nothing-to-collect', beforeLamports, afterLamports: beforeLamports };
    const latest = await connection.getLatestBlockhash('confirmed');
    const transaction = new Transaction().add(...instructions);
    transaction.recentBlockhash = latest.blockhash; transaction.feePayer = keeper.publicKey;
    const signature = await sendAndConfirmTransaction(connection, transaction, [keeper], { commitment: 'confirmed' });
    const afterLamports = await connection.getBalance(router.address, 'confirmed').catch(() => null);
    if (perMintV3) {
      let proof = null;
      try { proof = await loadFinalizedV3PumpCollection({ connection, signature,
        programId:v3ProgramId, mint:mintKey, launch }); } catch {}
      if (!proof || proof.signature !== signature || proof.mint !== mintKey.toBase58()
        || proof.router !== router.address.toBase58() || proof.expectedLamports <= 0n
        || proof.expectedLamports > BigInt(Number.MAX_SAFE_INTEGER)) {
        return { requestedMint:mintKey.toBase58(), mint:mintKey.toBase58(), scope:'per-mint-v3',
          attribution:'unverified', onchainVerified:false, router:router.address.toBase58(),
          programId:v3ProgramId, signature, beforeLamports, afterLamports,
          cluster:solanaCluster, status:'verification-pending',
          reason:'The finalized V3 Pump collection and exact router credit need reconciliation.' };
      }
      return { requestedMint:mintKey.toBase58(), mint:mintKey.toBase58(), scope:'per-mint-v3',
        attribution:'mint-verified', onchainVerified:true, router:router.address.toBase58(),
        programId:v3ProgramId, signature, beforeLamports, afterLamports,
        collectedLamports:Number(proof.expectedLamports), claimId:proof.claimId.toString('hex'),
        slot:proof.slot, cluster:solanaCluster, status:'collected' };
    }
    let confirmed = null;
    try { confirmed = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }); } catch {}
    const accountKeys = confirmed?.transaction?.message?.accountKeys || [];
    const routerIndex = accountKeys.findIndex(key => (key?.toBase58?.() || String(key)) === router.address.toBase58());
    if (perMint && (routerIndex < 0 || !Number.isSafeInteger(confirmed?.meta?.preBalances?.[routerIndex]) || !Number.isSafeInteger(confirmed?.meta?.postBalances?.[routerIndex]))) return { requestedMint: mintKey.toBase58(), mint: mintKey.toBase58(), attribution: 'unverified', onchainVerified: false, router: router.address.toBase58(), signature, beforeLamports, afterLamports, cluster: solanaCluster, status: 'verification-pending', reason: 'Confirmed collection has no safe, mint-router balance proof. Reconcile the signature before creating obligations.' };
    const collectedLamports = routerIndex >= 0 && !confirmed?.meta?.err
      ? Math.max(0, confirmed.meta.postBalances[routerIndex] - confirmed.meta.preBalances[routerIndex])
      : 0;
    return { requestedMint: mintKey.toBase58(), mint: perMint ? mintKey.toBase58() : null, attribution: perMint ? 'mint-verified' : 'router', onchainVerified: perMint && collectedLamports > 0, router: router.address.toBase58(), signature, beforeLamports, afterLamports, collectedLamports, cluster: solanaCluster, status: collectedLamports > 0 ? 'collected' : 'no-fees' };
  }

  return { keeperKeypair, referralPayoutKeypair, routerAuthorityKeypair, mintRouterReadiness, xFeeReadiness, feeRouterConfig, launchPolicyConfig, executeSolPayout, reconcileSolPayout, collectPumpCreatorFees };
}
