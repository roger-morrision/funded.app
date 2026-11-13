import { Connection, PublicKey, SystemProgram } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import { PUMP_SDK, bondingCurvePda } from '@pump-fun/pump-sdk';
import { collectAndSettleTokenFees, convertTokenBudgetToSol, fundTokenHolderRewards, pendingTokenFees, payTokenCreatorWallet, readDirectedTokenBudget } from './v3-token-keeper.mjs';
import { createRewardScheduler } from './reward-scheduler.mjs';
import { ensureMintAutomationV3 } from './mint-automation-v3.mjs';
import { v3ReferralUpline } from './v3-referral-entitlement.mjs';
import { deriveAgencyPolicyV3 } from '../mint-router-v3-token.js';
import { QA_HOLDER_POLICY, qaHolderMinimums, qaShortHolderMintSelected } from './devnet-qa-minimums.mjs';

// Devnet automation for coins paired with a token (USDC, xStocks, ...): collect
// Pump's paired-token creator fees into the coin's router, settle them across
// the category vaults, then release the creator-directed budget: the holders'
// part into the reward vault (paid by the holder scheduler in that token) and
// the creator wallet's part to the creator. Every amount is read back from the
// router's on-chain ledger, so a repeated tick never pays twice.
export function startV3PairedTokenWorker({ solanaCluster, solanaRpcUrl, store, automaticRewardStore, v3AuthorityKeypair,
  env = process.env, scheduleTimeout = setTimeout, scheduleInterval = setInterval,
  createConnection = url => new Connection(url, 'confirmed'), logger = console }) {
  if (solanaCluster !== 'devnet' || env.FUNDED_V3_PAIRED_TOKEN_WORKER_ENABLED !== 'true' || !store || !automaticRewardStore
    || !env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID || !/^[a-f0-9]{64}$/i.test(String(env.FUNDED_V3_PROGRAM_DATA_SHA256 || ''))) return null;
  let keeper;
  try { keeper = v3AuthorityKeypair(); } catch { return null; }
  if (!keeper?.publicKey) return null;
  const connection = createConnection(solanaRpcUrl);
  const finalizedConnection = new Connection(solanaRpcUrl, 'finalized');
  const programId = env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID;
  const scheduler = createRewardScheduler({ store: automaticRewardStore, chain: {}, indexer: { capture: async () => { throw new Error('unused'); } } });
  const minimumCollect = BigInt(env.FUNDED_V3_PAIRED_MIN_COLLECT_UNITS || '1000');
  const minimumRelease = BigInt(env.FUNDED_V3_PAIRED_MIN_RELEASE_UNITS || '1000');
  const minimumConvert = BigInt(env.FUNDED_V3_PAIRED_MIN_CONVERT_UNITS || '1000');
  const quotes = new Map();
  const quoteOf = async mint => {
    if (quotes.has(mint)) return quotes.get(mint);
    const account = await connection.getAccountInfo(bondingCurvePda(new PublicKey(mint)), 'confirmed');
    const curve = account ? PUMP_SDK.decodeBondingCurveNullable(account) : null;
    const quote = curve?.quoteMint && !curve.quoteMint.equals(NATIVE_MINT) && !curve.quoteMint.equals(SystemProgram.programId) ? curve.quoteMint.toBase58() : null;
    if (account) quotes.set(mint, quote);
    return quote;
  };

  async function ensureHolderProgram(launch, quoteMint) {
    const state = await automaticRewardStore.read();
    const existing = state.programs?.[launch.mint];
    if (existing?.asset === quoteMint) return false;
    const [vault] = PublicKey.findProgramAddressSync([Buffer.from('reward-vault-v1'), keeper.publicKey.toBuffer(), new PublicKey(launch.mint).toBuffer()], new PublicKey(programId));
    const qaMinimums = qaHolderMinimums(launch.mint, solanaCluster, env);
    const periodSeconds = qaShortHolderMintSelected(launch.mint, solanaCluster, env) ? 300 : 3600;
    const now = Math.floor(Date.now() / 1000);
    await scheduler.register({ mint: launch.mint, asset: quoteMint, quoteMint, activatedAt: Number(launch.createdTimestamp || launch.blockTime || now),
      excludedWallets: [vault.toBase58()], eligibilityPolicy: qaMinimums ? QA_HOLDER_POLICY : 'usd-20-hourly-v1', qaMinimums,
      periodSeconds, sampleIntervalSeconds: periodSeconds === 300 ? 60 : 300, payoutDelaySeconds: 0,
      firstPeriodStart: Math.ceil(now / periodSeconds) * periodSeconds });
    return true;
  }

  // Automatic payouts need the coin's immutable automation record. Its protocol
  // recipients match the SOL payout path: the operations wallet and the coin's
  // referral upline (frozen at its first settlement, else the current one).
  const automationReady = new Set();
  async function ensureAutomation(launch, state) {
    if (automationReady.has(launch.mint)) return;
    if (!env.FUNDED_V3_OPERATIONS_RECIPIENT) throw new Error('The operations recipient is required for automatic payouts.');
    const first = Object.values(state.v3Settlements || {}).filter(row => row.mint === launch.mint && row.status === 'finalized'
      && Array.isArray(row.referralUpline)).sort((a, b) => a.slot - b.slot)[0];
    let upline = first?.referralUpline;
    if (!upline) try { upline = v3ReferralUpline({ creatorWallet: launch.creatorWallet, attributions: state.referrals?.attributions,
      qualifiedAt: Number(launch.createdTimestamp || launch.blockTime) }); } catch { upline = []; }
    await ensureMintAutomationV3({ connection: finalizedConnection, authority: keeper, programId, mint: launch.mint, creator: launch.creatorWallet,
      policy: deriveAgencyPolicyV3(programId, launch.mint),
      recipients: [env.FUNDED_V3_OPERATIONS_RECIPIENT, ...[0, 1, 2].map(index => upline?.[index] || PublicKey.default)] });
    automationReady.add(launch.mint);
  }

  async function processLaunch(launch, state) {
    const quoteMint = await quoteOf(launch.mint);
    if (!quoteMint) return null;
    const row = { mint: launch.mint, quoteMint };
    const pending = await pendingTokenFees({ connection, programId, mint: launch.mint, quoteMint });
    row.pending = String(pending.total);
    if (pending.total >= minimumCollect) {
      const result = await collectAndSettleTokenFees({ connection, programId, keeper, mint: launch.mint, quoteMint });
      row.collected = result.collected; row.settled = result.settled;
    }
    const budget = await readDirectedTokenBudget({ connection, programId, mint: launch.mint, quoteMint });
    if (!budget) return row;
    const creator = launch.creatorWallet || launch.feePayer;
    const holderDue = env.FUNDED_V3_HOLDER_WORKER_ENABLED === 'true' && budget.units[1] > 0n && budget.owed[1] >= minimumRelease;
    const creatorDue = env.FUNDED_V3_CREATOR_WALLET_PAYOUT_ENABLED === 'true' && budget.units[0] > 0n && budget.owed[0] >= minimumRelease;
    if (holderDue || creatorDue) await ensureAutomation(launch, state);
    if (env.FUNDED_V3_HOLDER_WORKER_ENABLED === 'true' && budget.units[1] > 0n) {
      row.holderProgramRegistered = await ensureHolderProgram(launch, quoteMint);
      const amount = budget.owed[1] < budget.available ? budget.owed[1] : budget.available;
      if (amount >= minimumRelease) {
        const funded = await fundTokenHolderRewards({ connection, programId, keeper, creator, mint: launch.mint, quoteMint, amount, scheduler });
        row.holderFunded = funded.amount; row.holderSignature = funded.signature;
        budget.available -= amount;
      }
    }
    if (env.FUNDED_V3_CREATOR_WALLET_PAYOUT_ENABLED === 'true' && creator && budget.units[0] > 0n) {
      const amount = budget.owed[0] < budget.available ? budget.owed[0] : budget.available;
      if (amount >= minimumRelease) {
        const paid = await payTokenCreatorWallet({ connection, programId, keeper, creator, mint: launch.mint, quoteMint, amount });
        row.creatorPaid = paid.amount; row.creatorSignature = paid.signature;
      }
    }
    // Buyback (6) and AI-agency (7) budgets are spent in SOL: convert them
    // through the router's pinned WSOL/<paired token> pool.
    if (env.FUNDED_V3_TOKEN_CONVERSION_ENABLED === 'true') {
      for (const category of [6, 7]) {
        const amount = budget.ledger.paid[category] - budget.ledger.withdrawn[category];
        if (amount < minimumConvert) continue;
        const converted = await convertTokenBudgetToSol({ connection, programId, keeper, mint: launch.mint, quoteMint, category, amount,
          cluster: solanaCluster, lookupTable: env.FUNDED_V3_TOKEN_CONVERSION_LOOKUP_TABLE || null });
        (row.converted ||= []).push({ category, spent: converted.spent, lamports: converted.expectedLamports, signature: converted.signature });
      }
    }
    return row;
  }

  let running = false;
  async function tick() {
    if (running) return { status: 'busy' };
    running = true;
    const rows = [], failures = [];
    try {
      const state = await store.read();
      const launches = Object.values(state.launches || {}).filter(launch => !launch.archivedAt && launch.onchainVerified
        && launch.cluster === 'devnet' && launch.pumpFeeRoute?.scope === 'per-mint-v3' && launch.pumpFeeRoute?.programId === programId);
      for (const launch of launches) {
        try { const row = await processLaunch(launch, state); if (row) rows.push(row); }
        catch (error) { failures.push({ mint: launch.mint, reason: String(error.message || error).slice(0, 200) }); }
      }
      logger.log(JSON.stringify({ event: 'v3_paired_token_tick', coins: rows.length,
        moved: rows.filter(row => row.collected || row.holderFunded || row.creatorPaid || row.converted), failures }));
      return { status: failures.length ? 'degraded' : 'ready', rows, failures };
    } finally { running = false; }
  }
  const intervalMs = Math.max(60_000, Number(env.FUNDED_V3_PAIRED_TOKEN_TICK_MS || 300_000));
  scheduleTimeout(() => { void tick().catch(error => logger.error('Paired-token tick failed:', error)); }, 20_000).unref?.();
  scheduleInterval(() => { void tick().catch(error => logger.error('Paired-token tick failed:', error)); }, intervalMs).unref?.();
  return { tick };
}
