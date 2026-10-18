import { PublicKey } from '@solana/web3.js';
import { bondingCurvePda } from '@pump-fun/pump-sdk';
import { canonicalPumpPoolPda, getPumpAmmProgram } from '@pump-fun/pump-swap-sdk';
import { NATIVE_MINT } from '@solana/spl-token';
import { deriveMintRouterV3 } from '../mint-router-v3.js';
import { DEVNET_GENESIS_HASH } from './automatic-reward-chain.mjs';
import { dailyBonusTradeRows } from './daily-bonus-evidence.mjs';
import { verifyV3PumpCollection } from './v3-collection-proof.mjs';
import { loadFinalizedV3Settlement } from './v3-settlement-proof.mjs';
import { dailyBonusWindow, bonusHash } from './daily-bonus.mjs';

const signature = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const launchFingerprint = row => bonusHash({ mint:row.mint, creator:row.creatorWallet,
  createdTimestamp:row.createdTimestamp, route:row.pumpFeeRoute, policy:row.feeDistribution });

// Checkpoints survive restarts. Work limits bound each tick, never the UTC day's coverage.
export function createDailyBonusEvidenceIndex({ rewardStore, pageSize = 100,
  pagesPerTick = 64, transactionsPerTick = 128, verifyCollection = verifyV3PumpCollection,
  loadSettlement = loadFinalizedV3Settlement, decodeTrade = dailyBonusTradeRows }) {
  const running = new Map();
  async function read({ connection, state, programId, day, now }) {
    const window = dailyBonusWindow(day, now);
    if (await connection.getGenesisHash() !== DEVNET_GENESIS_HASH) throw new Error('Daily bonus RPC is not Devnet.');
    const finalizedSlot = await connection.getSlot('finalized');
    const finalizedTime = await connection.getBlockTime(finalizedSlot);
    if (!Number.isSafeInteger(finalizedTime) || finalizedTime < window.end)
      return { complete:false, day, reason:'Waiting for the finalized UTC cutoff.' };
    const saved = (await rewardStore.read()).dailyBonusIndexes?.[day];
    const job = saved ? structuredClone(saved) : { version:1, programId, day, revision:0,
      cutoffSlot:finalizedSlot, mints:{}, routes:{}, trades:{}, collections:{}, verifiedCollections:{} };
    if (job.version !== 1 || job.programId !== programId) throw new Error('Daily bonus index network or program changed.');
    const launches = Object.values(state.launches || {}).filter(row => row.onchainVerified === true
      && row.cluster === 'devnet' && row.pumpFeeRoute?.scope === 'per-mint-v3'
      && row.pumpFeeRoute.programId === programId && row.pumpFeeRoute.verified === true
      && Number.isSafeInteger(row.createdTimestamp) && row.createdTimestamp < window.end)
      .sort((a,b) => a.mint.localeCompare(b.mint));
    const byMint = new Map(launches.map(row => [row.mint,row]));
    for (const mint of Object.keys(job.mints)) if (!byMint.has(mint))
      throw new Error('An indexed daily bonus launch disappeared; reconcile its evidence.');
    for (const launch of launches) {
      const fingerprint = launchFingerprint(launch);
      if (job.mints[launch.mint] && job.mints[launch.mint] !== fingerprint)
        throw new Error('An indexed daily bonus launch policy changed.');
      job.mints[launch.mint] = fingerprint;
      const mint = new PublicKey(launch.mint);
      for (const [kind,address] of [['curve',bondingCurvePda(mint)],
        ['pool',canonicalPumpPoolPda(mint,NATIVE_MINT)],
        ['collections',deriveMintRouterV3(programId,mint).address]]) {
        const id = `${launch.mint}:${kind}`;
        job.routes[id] ||= { mint:launch.mint, kind, address:address.toBase58(), complete:false,
          before:null, previousSlot:Number.MAX_SAFE_INTEGER, pending:[], seen:{} };
      }
    }
    let pages = 0, transactions = 0;
    const coder = getPumpAmmProgram(connection).coder.events;
    const persist = async () => {
      const expectedRevision = job.revision;
      await rewardStore.transaction(ledger => {
        ledger.dailyBonusIndexes ||= {};
        if ((ledger.dailyBonusIndexes[day]?.revision || 0) !== expectedRevision)
          throw new Error('Daily bonus index changed concurrently; resume its latest checkpoint.');
        job.revision = expectedRevision + 1;
        ledger.dailyBonusIndexes[day] = structuredClone(job);
      });
    };
    for (const route of Object.values(job.routes)) {
      while (!route.complete && transactions < transactionsPerTick) {
        if (!route.pending.length) {
          if (pages >= pagesPerTick) break;
          const refs = await connection.getSignaturesForAddress(new PublicKey(route.address),
            { limit:pageSize, ...(route.before ? { before:route.before } : {}) }, 'finalized');
          pages++;
          if (!Array.isArray(refs) || refs.length > pageSize) throw new Error('Invalid daily bonus index page.');
          let previousSlot = route.previousSlot;
          const pageSeen = new Set();
          for (const ref of refs) {
            if (!signature.test(ref.signature || '') || route.seen[ref.signature] || pageSeen.has(ref.signature)
              || !Number.isSafeInteger(ref.slot) || ref.slot < 1 || ref.slot > previousSlot
              || ref.confirmationStatus !== 'finalized' || !Number.isSafeInteger(ref.blockTime))
              throw new Error('Daily bonus history has a duplicate, ordering or finality gap.');
            previousSlot = ref.slot;
            pageSeen.add(ref.signature);
          }
          route.previousSlot = previousSlot;
          for (const id of pageSeen) route.seen[id] = true;
          route.pending = refs.map(ref => ({ ...ref }));
          route.endAfterPage = refs.length < pageSize || refs.some(ref => ref.blockTime < window.start);
          route.nextBefore = refs.at(-1)?.signature || route.before;
          if (!refs.length) { route.complete = true; break; }
        }
        while (route.pending.length && transactions < transactionsPerTick) {
          const ref = route.pending[0];
          if (!ref.err && ref.slot <= job.cutoffSlot && ref.blockTime >= window.start && ref.blockTime < window.end) {
            let tx;
            try { tx = await connection.getTransaction(ref.signature, { commitment:'finalized', maxSupportedTransactionVersion:0 }); }
            catch (error) { await persist(); throw error; }
            transactions++;
            if (!tx || tx.slot !== ref.slot || tx.blockTime !== ref.blockTime || tx.meta?.err !== null
              || tx.transaction?.signatures?.[0] !== ref.signature) {
              await persist(); throw new Error('Daily bonus indexed transaction proof is unavailable.');
            }
            if (route.kind === 'collections') {
              const proof = await verifyCollection({ transaction:tx, signature:ref.signature, programId, mint:route.mint });
              if (proof) job.collections[ref.signature] = { mint:route.mint, signature:ref.signature,
                blockTime:ref.blockTime, slot:ref.slot, amountLamports:String(proof.expectedLamports),
                claimId:Buffer.from(proof.claimId).toString('hex') };
            } else {
              const mint = new PublicKey(route.mint), pool = canonicalPumpPoolPda(mint,NATIVE_MINT);
              for (const row of decodeTrade(tx,ref,mint,pool,coder.decode.bind(coder)))
                job.trades[`${row.signature}:${row.logIndex}:${row.mint}`] = row;
            }
          }
          route.pending.shift();
        }
        if (!route.pending.length) {
          route.before = route.nextBefore;
          route.complete = route.endAfterPage;
        }
      }
    }
    const progress = { routes:Object.keys(job.routes).length,
      completedRoutes:Object.values(job.routes).filter(row => row.complete).length,
      indexedTrades:Object.keys(job.trades).length, indexedCollections:Object.keys(job.collections).length };
    if (progress.completedRoutes !== progress.routes) {
      await persist(); return { complete:false, day, reason:'Indexing finalized history.', progress };
    }
    const collections = [];
    let waiting = null;
    for (const row of Object.values(job.collections)) {
      const launch = byMint.get(row.mint), recorded = state.collections?.[row.signature];
      const settled = state.v3Settlements?.[row.signature];
      if (!recorded || settled?.status !== 'finalized') { waiting = 'Waiting for indexed collections and creator-signed settlements.'; break; }
      if (recorded.signature !== row.signature || recorded.mint !== row.mint || recorded.scope !== 'per-mint-v3' || recorded.cluster !== 'devnet'
        || recorded.programId !== programId || recorded.status !== 'collected' || recorded.onchainVerified !== true
        || recorded.attribution !== 'mint-verified' || String(recorded.collectedLamports) !== row.amountLamports
        || recorded.claimId !== row.claimId || settled.mint !== row.mint || settled.collectionSignature !== row.signature
        || !Array.isArray(settled.referralUpline))
        throw new Error('Indexed daily bonus collection conflicts with its recorded attribution.');
      const fingerprint = bonusHash({ row, settled });
      let proved = job.verifiedCollections[row.signature];
      if (proved?.fingerprint !== fingerprint) {
        if (transactions >= transactionsPerTick) { waiting = 'Verifying finalized settlement coverage.'; break; }
        const proof = await loadSettlement({ connection, signature:settled.settlementSignature,
          programId, mint:row.mint, authority:launch.pumpFeeRoute.initialAuthority, creator:launch.creatorWallet,
          claimId:Buffer.from(row.claimId,'hex'), expectedLamports:row.amountLamports, split:launch.pumpFeeRoute.protocolSplit });
        transactions++;
        if (!proof) { waiting = 'Waiting for finalized settlement proof.'; break; }
        const referrer = settled.referralUpline[0] || null;
        if (referrer === launch.creatorWallet) throw new Error('Daily bonus self-referral is invalid.');
        proved = job.verifiedCollections[row.signature] = { fingerprint, value:{ ...row,
          settlementSignature:settled.settlementSignature, creator:launch.creatorWallet, referrer,
          finalized:true, communityLamports:String(proof.categoryLamports[5]),
          dailyBonusVersion:launch.feeDistribution?.fixedFunded?.communityRewards?.dailyBonus?.version || null } };
      }
      collections.push(proved.value);
    }
    await persist();
    if (waiting) return { complete:false, day, reason:waiting, progress };
    return { complete:true, collections, trades:Object.values(job.trades),
      coverage:launches.map(row => ({ mint:row.mint, complete:true, routes:2, collectionHistoryComplete:true })) };
  }
  return args => {
    const id = `${args.programId}:${args.day}`;
    if (!running.has(id)) running.set(id, read(args).finally(() => running.delete(id)));
    return running.get(id);
  };
}
