// Run inside the accepted Devnet app container. Review first; --apply performs
// the same hash-bound review, then reconciles and executes the named sources.
import { readFileSync } from 'node:fs';
import { Connection, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { loadServerEnvironment } from '../server/environment.mjs';
import { createPostgresStore } from '../server/postgres-store.mjs';
import { createAutomaticRewardStore } from '../server/automatic-reward-store.mjs';
import { rewardLedgerPath } from '../server/reward-ledger-path.mjs';
import { createDailyBonusService } from '../server/daily-bonus-service.mjs';
import { bonusSchedule } from '../server/daily-bonus-schedule.mjs';
import { createDailyBonusUsdEvidenceIndex } from '../server/daily-bonus-usd-index.mjs';
import { createHeliusBonusPriceReader } from '../server/daily-bonus-helius-price.mjs';

loadServerEnvironment();
const apply=process.argv.includes('--apply');
const signatures=process.argv.slice(2).filter(value=>value!=='--apply');
if (process.env.SOLANA_CLUSTER!=='devnet' || process.env.FUNDED_DAILY_BONUS_PAIRED_ENABLED!=='true'
  || !signatures.length || signatures.some(value=>!/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(value))
  || new Set(signatures).size!==signatures.length)
  throw new Error('Pass unique finalized Devnet paired settlement signatures.');
const store=createPostgresStore(process.env.DATABASE_URL);
const rewardStore=createAutomaticRewardStore(rewardLedgerPath());
try {
  const app=await store.read(), ledger=await rewardStore.read();
  const days=new Map();
  for (const signature of signatures) {
    const source=app.v3TokenBonusSources?.[signature];
    const funding=app.v3CommunityFunding?.[signature];
    if (source?.cluster!=='devnet' || source.payoutAsset!=='SOL'
      || funding?.status!=='finalized' || funding.pairedSource!==true
      || funding.collectionSignature!==signature || funding.balanceDeltaVerified!==true
      || ledger.dailyBonusAssignments?.[signature])
      throw new Error(`Source ${signature} is unfunded, assigned or unverified.`);
    const matches=Object.values(ledger.dailyBonusSnapshots||{}).filter(row=>row.snapshot.qa===true
      && row.snapshot.start<=source.blockTime && source.blockTime<row.snapshot.end);
    if (matches.length!==1) throw new Error(`Source ${signature} has no unique QA snapshot.`);
    const row=matches[0],day=row.snapshot.day;
    if (row.snapshot.sources.length || Object.keys(row.payouts||{}).length)
      throw new Error(`Snapshot ${day} is already reserved.`);
    if (!days.has(day)) days.set(day,{hash:row.snapshot.hash,signatures:[]});
    days.get(day).signatures.push(signature);
  }
  const connection=new Connection(process.env.SOLANA_RPC_URL,'finalized');
  const programId=process.env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID;
  const authority=Keypair.fromSecretKey(bs58.decode(process.env.FUNDED_V3_ROUTER_AUTHORITY_SECRET_KEY));
  const readUsdEvidence=createDailyBonusUsdEvidenceIndex({rewardStore,store,
    readPrice:createHeliusBonusPriceReader({rpcUrl:readFileSync(process.env.FUNDED_HELIUS_MAINNET_RPC_URL_FILE,'utf8').trim()})});
  const service=createDailyBonusService({store,rewardStore,connection,programId,authority,cluster:'devnet',
    expectedProgramDataSha256:process.env.FUNDED_V3_PROGRAM_DATA_SHA256,
    payoutEnabled:process.env.FUNDED_DAILY_BONUS_PAYOUT_ENABLED==='true',
    schedule:bonusSchedule({cluster:'devnet',env:process.env}),scoringBasis:'common-usd-v2',readUsdEvidence});
  for (const [day,item] of [...days].sort(([a],[b])=>a.localeCompare(b))) {
    const review=await service.review(day,item.hash);
    if (review.mode!=='replace-unused-v1' || review.expectedNewHash===review.expectedHash
      || !item.signatures.every(signature=>review.sourceSignatures.includes(signature))
      || review.sourceSignatures.some(signature=>!signatures.includes(signature)))
      throw new Error(`Repriced snapshot ${day} contains an unexpected source or no change.`);
    console.log(JSON.stringify({event:'paired-bonus-qa-review',day,oldHash:review.expectedHash,
      newHash:review.expectedNewHash,sourceSignatures:review.sourceSignatures,
      rankingCounts:Object.fromEntries(Object.entries(review.rankings).map(([key,value])=>[key,value.length]))}));
    if (apply) {
      await service.reconcile(day,{expectedHash:review.expectedHash,expectedNewHash:review.expectedNewHash,
        actor:'devnet-paired-bonus-acceptance',reason:'Reprice unused pre-feature QA snapshot with finalized common USD evidence and funded SOL sources.'});
      const result=await service.execute(day);
      console.log(JSON.stringify({event:'paired-bonus-qa-executed',day,result}));
    }
  }
} finally { await store.close(); }
