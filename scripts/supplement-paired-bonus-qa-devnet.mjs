// Explicit Devnet-only migration for paired sources in a QA window whose SOL
// sources were already paid. Preview is read-only; --apply snapshots and pays.
import { readFileSync } from 'node:fs';
import { Connection } from '@solana/web3.js';
import { loadServerEnvironment } from '../server/environment.mjs';
import { createPostgresStore } from '../server/postgres-store.mjs';
import { createAutomaticRewardStore } from '../server/automatic-reward-store.mjs';
import { rewardLedgerPath } from '../server/reward-ledger-path.mjs';
import { createDailyBonusService } from '../server/daily-bonus-service.mjs';
import { bonusSchedule, bonusWindowKey } from '../server/daily-bonus-schedule.mjs';
import { buildDailyBonusSnapshot } from '../server/daily-bonus.mjs';
import { createDailyBonusUsdEvidenceIndex } from '../server/daily-bonus-usd-index.mjs';
import { createHeliusBonusPriceReader } from '../server/daily-bonus-helius-price.mjs';
import { createRemoteSigner } from '../server/remote-signer.mjs';

loadServerEnvironment();
const apply=process.argv.includes('--apply');
const resumeHash=process.argv.find(value=>value.startsWith('--resume='))?.slice(9)||null;
const signatures=process.argv.slice(2).filter(value=>value!=='--apply'&&!value.startsWith('--resume='));
if (process.env.SOLANA_CLUSTER!=='devnet' || process.env.FUNDED_DAILY_BONUS_PAIRED_ENABLED!=='true'
  || signatures.length!==2 || signatures.some(value=>!/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(value))
  || new Set(signatures).size!==2)
  throw new Error('Pass exactly two distinct finalized Devnet paired settlement signatures.');
const store=createPostgresStore(process.env.DATABASE_URL);
const rewardStore=createAutomaticRewardStore(rewardLedgerPath());
try {
  const app=await store.read(),ledger=await rewardStore.read();
  const sources=signatures.map(signature=>app.v3TokenBonusSources?.[signature]);
  const start=Math.floor(sources[0]?.blockTime/300)*300;
  if (!Number.isSafeInteger(start) || sources.some((source,index)=>source?.cluster!=='devnet'
    || source.payoutAsset!=='SOL' || Math.floor(source.blockTime/300)*300!==start
    || app.v3CommunityFunding?.[signatures[index]]?.status!=='finalized'
    || app.v3CommunityFunding[signatures[index]].pairedSource!==true
    || app.v3CommunityFunding[signatures[index]].balanceDeltaVerified!==true))
    throw new Error('A source is outside the window, assigned, unfunded or unverified.');
  const priorDay=bonusWindowKey(start,bonusSchedule({cluster:'devnet',env:process.env}));
  const prior=ledger.dailyBonusSnapshots?.[priorDay];
  if (!prior?.snapshot.sources.length || !Object.values(prior.payouts||{}).some(row=>row.status==='paid')
    || signatures.some(signature=>prior.snapshot.sources.some(row=>row.collectionSignature===signature)))
    throw new Error('The original QA window has no separate paid SOL sources.');
  const mints=[...new Set(sources.map(source=>source.mint))].sort();
  const schedule=bonusSchedule({cluster:'devnet',env:{...process.env,
    FUNDED_DEVNET_QA_ALL_MINTS:'false',FUNDED_DEVNET_QA_BONUS_MINTS:mints.join(',')}});
  const day=bonusWindowKey(start,schedule);
  const existing=ledger.dailyBonusSnapshots?.[day]||null;
  if (existing) {
    if (!apply || !/^[a-f0-9]{64}$/.test(String(resumeHash)) || existing.snapshot.hash!==resumeHash
      || existing.snapshot.policy.scoringBasis!=='common-usd-v2' || existing.snapshot.sources.length!==2
      || existing.snapshot.sources.some(source=>!signatures.includes(source.collectionSignature))
      || signatures.some(signature=>ledger.dailyBonusAssignments?.[signature]
        && ledger.dailyBonusAssignments[signature]!==resumeHash))
      throw new Error('The frozen supplemental snapshot does not match the explicit resume hash.');
  } else if (resumeHash || signatures.some(signature=>ledger.dailyBonusAssignments?.[signature]))
    throw new Error('A supplemental source is already assigned or the resume hash has no snapshot.');
  const connection=new Connection(process.env.SOLANA_RPC_URL,'finalized');
  const authority=createRemoteSigner({env:process.env})?.handle('authority');
  if (!authority) throw new Error('The reviewed Devnet authority signer is unavailable.');
  const readUsdEvidence=createDailyBonusUsdEvidenceIndex({rewardStore,store,
    readPrice:createHeliusBonusPriceReader({rpcUrl:readFileSync(process.env.FUNDED_HELIUS_MAINNET_RPC_URL_FILE,'utf8').trim()})});
  const now=()=>Math.floor(Date.now()/1000);
  let snapshot=existing?.snapshot;
  if (!snapshot) {
    const evidence=await readUsdEvidence({connection,state:app,programId:process.env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID,
      cluster:'devnet',day,now:now(),qaMints:schedule.mints,eligibilityBasis:'settlement-time-v1'});
    if (evidence.complete!==true) throw new Error(evidence.reason||'Supplemental USD evidence is incomplete.');
    snapshot=buildDailyBonusSnapshot({day,...evidence,cluster:'devnet',
      programId:process.env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID,now:now()});
  }
  if (snapshot.policy.scoringBasis!=='common-usd-v2' || snapshot.sources.length!==2
    || snapshot.sources.some(source=>!signatures.includes(source.collectionSignature)))
    throw new Error('Supplemental QA snapshot contains an unexpected source or ranking basis.');
  console.log(JSON.stringify({event:'paired-bonus-supplement-review',day,hash:snapshot.hash,
    sourceSignatures:snapshot.sources.map(source=>source.collectionSignature),
    rankingCounts:Object.fromEntries(Object.entries(snapshot.rankings).map(([key,value])=>[key,value.length]))}));
  if (apply) {
    const service=createDailyBonusService({store,rewardStore,connection,
      programId:process.env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID,authority,cluster:'devnet',
      expectedProgramDataSha256:process.env.FUNDED_V3_PROGRAM_DATA_SHA256,payoutEnabled:true,
      schedule,scoringBasis:'common-usd-v2',readUsdEvidence});
    if (!existing) {
      const captured=await service.capture(day);
      if (captured.snapshot?.hash!==snapshot.hash) throw new Error('Supplemental snapshot changed after review.');
    }
    await service.execute(day);
    const paid=(await rewardStore.read()).dailyBonusSnapshots?.[day];
    console.log(JSON.stringify({event:'paired-bonus-supplement-executed',day,hash:paid?.snapshot.hash,
      payoutStatuses:Object.fromEntries(Object.entries(paid?.payouts||{})
        .map(([signature,row])=>[signature,row.status]))}));
  }
} finally { await store.close(); }
