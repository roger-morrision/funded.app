import { PUMP_PROGRAM_ID, bondingCurvePda } from '@pump-fun/pump-sdk';
import { PUMP_AMM_PROGRAM_ID, canonicalPumpPoolPda, getPumpAmmProgram } from '@pump-fun/pump-swap-sdk';
import { NATIVE_MINT } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
import { decodePumpTrades, decodePumpSwapTrades } from './coin-market.mjs';
import { GENESIS_HASHES } from './service-status.mjs';
import { migrationOnlyProof } from './product-migration-proof.mjs';

class TradeHistoryGap extends Error {
  constructor(reason) { super(reason); this.reason=reason; }
}

// Commit event logs only when the emitting invocation and all its ancestors
// succeed. A caught inner-program failure still rolls back its events.
export function successfulEventLogs(logs) {
  if (!Array.isArray(logs)) throw new TradeHistoryGap('logs-unavailable');
  const stack=[], result=[];
  for (let index=0; index<logs.length; index++) {
    const log=logs[index];
    if (log.startsWith('Log truncated')) throw new TradeHistoryGap('logs-incomplete');
    const invocation=/^Program ([1-9A-HJ-NP-Za-km-z]+) invoke \[(\d+)\]$/.exec(log);
    if (invocation) {
      if (Number(invocation[2]) !== stack.length+1) throw new Error('Unbalanced program invocation.');
      stack.push({program:invocation[1],events:[]}); continue;
    }
    const end=/^Program ([1-9A-HJ-NP-Za-km-z]+) (success|failed:.*)$/.exec(log);
    if (end) {
      const frame=stack.pop();
      if (!frame || frame.program!==end[1]) throw new Error('Unbalanced program completion.');
      if (end[2]==='success') (stack.at(-1)?.events || result).push(...frame.events);
      continue;
    }
    if (log.startsWith('Program data: ') && stack.length) stack.at(-1).events.push({log,index,program:stack.at(-1).program});
  }
  if (stack.length) throw new TradeHistoryGap('logs-incomplete');
  return result;
}

export function finalizedTradeRows(transaction, reference, mint, pool, decodePoolEvent) {
  if (!transaction) throw new TradeHistoryGap('transaction-unavailable');
  if (transaction.meta?.err !== null || transaction.transaction?.signatures?.[0] !== reference.signature
    || transaction.slot !== reference.slot || !Number.isSafeInteger(transaction.slot) || transaction.slot < 1
    || !Number.isSafeInteger(transaction.blockTime) || transaction.blockTime < 0) throw new Error('Finalized transaction proof is unavailable or mismatched.');
  const rows=[];
  for (const event of successfulEventLogs(transaction.meta.logMessages)) {
    const isCurve=event.program===PUMP_PROGRAM_ID.toBase58();
    const isPool=event.program===PUMP_AMM_PROGRAM_ID.toBase58() && pool;
    if (!isCurve && !isPool) continue;
    const events=isCurve ? decodePumpTrades([event.log],mint) : decodePumpSwapTrades([
      `Program ${event.program} invoke [1]`,event.log,`Program ${event.program} success`,
    ],pool,decodePoolEvent);
    for (const trade of events) {
      if (trade.solLamports<=0n || trade.solLamports>18446744073709551615n || trade.tokenAmountRaw<=0n || trade.tokenAmountRaw>18446744073709551615n) throw new Error('Invalid trade amounts.');
      rows.push({signature:reference.signature,logIndex:event.index,mint:mint.toBase58(),route:isCurve?'curve':'pool',
        slot:transaction.slot,blockTime:transaction.blockTime,side:trade.isBuy?'buy':'sell',solLamports:trade.solLamports.toString(),tokenAmountRaw:trade.tokenAmountRaw.toString()});
    }
  }
  return rows;
}

async function readTradeProof(connection,reference,mint,route,decoder) {
  const transaction=await connection.getTransaction(reference.signature,{commitment:'finalized',maxSupportedTransactionVersion:0});
  try {
    return {records:finalizedTradeRows(transaction,reference,mint,route==='pool'?canonicalPumpPoolPda(mint,NATIVE_MINT):null,decoder),resolved:[reference.signature],gaps:[]};
  } catch(error) {
    if (!(error instanceof TradeHistoryGap)) throw error;
    // Only finalizedTradeRows' log checks can reach this fallback with a
    // non-null transaction; its signature, slot, success and time were checked.
    if(transaction&&migrationOnlyProof(transaction,mint))return {records:[],resolved:[reference.signature],gaps:[],nontrades:[{signature:reference.signature,slot:reference.slot}]};
    return {records:[],resolved:[],gaps:[{signature:reference.signature,slot:reference.slot,reason:error.reason}]};
  }
}

// Records, explicit proof gaps, and the page cursor are committed together.
// Transport errors or conflicting proofs still stop the whole page.
export async function scanTradePage({connection,mint,route,cursor={},pageSize=25,decodePoolEvent}) {
  const key=new PublicKey(mint), pool=canonicalPumpPoolPda(key,NATIVE_MINT);
  if (!Number.isInteger(pageSize) || pageSize<1 || pageSize>100) throw new Error('Page size must be between 1 and 100.');
  const address=route==='curve'?bondingCurvePda(key):pool;
  const list=await connection.getSignaturesForAddress(address,{limit:pageSize,...(cursor.before?{before:cursor.before}:{})},'finalized');
  if (!Array.isArray(list) || list.length>pageSize || new Set(list.map(r=>r.signature)).size!==list.length) throw new Error('Invalid signature page.');
  const anchor=list.findIndex(row=>row.signature===cursor.head);
  const selected=anchor<0?list:list.slice(0,anchor);
  const records=[],gaps=[],resolved=[],nontrades=[];
  const eventCoder=decodePoolEvent ? null : getPumpAmmProgram(connection).coder.events;
  const decoder=decodePoolEvent || eventCoder.decode.bind(eventCoder);
  for (const reference of selected) {
    if (reference.confirmationStatus!=='finalized' || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(reference.signature) || !Number.isSafeInteger(reference.slot)) throw new Error('Signature is not finalized.');
    if (reference.err != null) continue;
    const proof=await readTradeProof(connection,reference,key,route,decoder);
    records.push(...proof.records);gaps.push(...proof.gaps);resolved.push(...proof.resolved);
    nontrades.push(...(proof.nontrades||[]));
  }
  const finished=anchor>=0 || list.length<pageSize;
  const candidateHead=cursor.candidateHead || list[0]?.signature || cursor.head || null;
  const before=finished?null:list.at(-1)?.signature;
  if (!finished && (!before || before===cursor.before)) throw new Error('History cursor did not advance.');
  return {records,gaps,resolved,nontrades, cursor:finished?{head:candidateHead,before:null,candidateHead:null}:{...cursor,before,candidateHead},
    status:finished ? cursor.head && anchor<0 ? 'anchor-missing' : 'provider-history-scanned' : 'backfilling', examined:selected.length};
}

export async function persistTradePage(client,cluster,mint,route,page) {
  await client.query('BEGIN');
  try {
    for (const row of page.records) {
      const result=await client.query(`INSERT INTO product_trade_events(cluster,signature,log_index,mint,route,slot,block_time,side,sol_lamports,token_amount_raw)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(cluster,signature,log_index) DO UPDATE SET signature=EXCLUDED.signature
        WHERE product_trade_events.mint=EXCLUDED.mint AND product_trade_events.route=EXCLUDED.route AND product_trade_events.slot=EXCLUDED.slot
        AND product_trade_events.block_time=EXCLUDED.block_time AND product_trade_events.side=EXCLUDED.side
        AND product_trade_events.sol_lamports=EXCLUDED.sol_lamports AND product_trade_events.token_amount_raw=EXCLUDED.token_amount_raw RETURNING signature`,
        [cluster,row.signature,row.logIndex,row.mint,row.route,row.slot,row.blockTime,row.side,row.solLamports,row.tokenAmountRaw]);
      if (result.rowCount!==1) throw new Error('Stored trade proof conflicts with finalized history.');
    }
    for (const gap of page.gaps || []) {
      const result=await client.query(`INSERT INTO product_trade_gaps(cluster,mint,route,signature,slot,reason) VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT(cluster,mint,route,signature) DO UPDATE SET reason=EXCLUDED.reason,checked_at=NOW(),attempts=product_trade_gaps.attempts+1
        WHERE product_trade_gaps.slot=EXCLUDED.slot RETURNING signature`,[cluster,mint,route,gap.signature,gap.slot,gap.reason]);
      if(result.rowCount!==1) throw new Error('Stored gap slot conflicts with finalized history.');
    }
    for(const proof of page.nontrades||[]) {
      const saved=await client.query(`INSERT INTO product_trade_nontrades(cluster,mint,route,signature,slot,proof_kind) VALUES($1,$2,$3,$4,$5,'migration-v2-instructions-v1')
        ON CONFLICT(cluster,mint,route,signature) DO UPDATE SET signature=EXCLUDED.signature WHERE product_trade_nontrades.slot=EXCLUDED.slot RETURNING signature`,[cluster,mint,route,proof.signature,proof.slot]);
      if(saved.rowCount!==1)throw new Error('Stored migration proof conflicts with finalized history.');
    }
    for (const signature of page.resolved || []) await client.query('DELETE FROM product_trade_gaps WHERE cluster=$1 AND mint=$2 AND route=$3 AND signature=$4',[cluster,mint,route,signature]);
    if (page.cursor) await client.query(`INSERT INTO product_trade_cursors(cluster,mint,route,cursor,status,checked_at) VALUES($1,$2,$3,$4,$5,NOW())
      ON CONFLICT(cluster,mint,route) DO UPDATE SET cursor=EXCLUDED.cursor,status=EXCLUDED.status,checked_at=EXCLUDED.checked_at`,[cluster,mint,route,JSON.stringify(page.cursor),page.status]);
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}
}

export async function indexProductTrades({connection,pool,launches,maxPages=4,pageSize=25,maxGapRetries=4}) {
  if (await connection.getGenesisHash()!==GENESIS_HASHES.devnet) throw new Error('Trade indexing requires the verified Devnet network.');
  if (!Number.isInteger(maxPages)||maxPages<1||maxPages>100) throw new Error('Page budget must be between 1 and 100.');
  if (!Number.isInteger(maxGapRetries)||maxGapRetries<0||maxGapRetries>25) throw new Error('Gap retry budget must be between 0 and 25.');
  const client=await pool.connect();let locked=false;
  const result={cluster:'devnet',pages:0,examined:0,observedEvents:0,gapsObserved:0,gapsRetried:0,gapsResolved:0,blocked:0,financialExecution:false};
  try {
    locked=(await client.query('SELECT pg_try_advisory_lock(71648081) AS locked')).rows[0].locked;
    if (!locked) throw new Error('Another trade index pass is running.');
    const verified=launches.filter(row=>row.cluster==='devnet'&&row.onchainVerified===true);
    const pending=(await client.query(`SELECT mint,route,signature,slot FROM product_trade_gaps WHERE cluster='devnet' AND mint=ANY($1::text[])
      ORDER BY checked_at,mint,route,signature LIMIT $2`,[verified.map(row=>row.mint),maxGapRetries])).rows;
    const coder=getPumpAmmProgram(connection).coder.events;
    for(const gap of pending) {
      result.gapsRetried++;
      try {
        const page=await readTradeProof(connection,{signature:gap.signature,slot:Number(gap.slot)},new PublicKey(gap.mint),gap.route,coder.decode.bind(coder));
        await persistTradePage(client,'devnet',gap.mint,gap.route,page);
        result.gapsResolved+=page.resolved.length;result.observedEvents+=page.records.length;
      }catch {
        result.blocked++;
        await client.query(`UPDATE product_trade_gaps SET checked_at=NOW(),attempts=attempts+1 WHERE cluster='devnet' AND mint=$1 AND route=$2 AND signature=$3`,[gap.mint,gap.route,gap.signature]);
      }
    }
    const existing=(await client.query("SELECT mint,route,cursor,checked_at FROM product_trade_cursors WHERE cluster='devnet'")).rows;
    const jobs=[];
    for(const launch of verified) {
      for(const route of ['curve','pool']) {const prior=existing.find(row=>row.mint===launch.mint&&row.route===route);jobs.push({mint:launch.mint,route,prior});}
    }
    jobs.sort((a,b)=>Date.parse(a.prior?.checked_at||'1970-01-01')-Date.parse(b.prior?.checked_at||'1970-01-01')||a.mint.localeCompare(b.mint)||a.route.localeCompare(b.route));
    for(const job of jobs.slice(0,maxPages)) {
      try {
        const mint=new PublicKey(job.mint);
        if(job.route==='pool') {
          const account=await connection.getAccountInfo(canonicalPumpPoolPda(mint,NATIVE_MINT),'finalized');
          if(!account) {await client.query(`INSERT INTO product_trade_cursors VALUES('devnet',$1,'pool','{}','pool-not-present',NOW()) ON CONFLICT(cluster,mint,route) DO UPDATE SET status='pool-not-present',checked_at=NOW()`,[job.mint]);continue;}
          if(!account.owner.equals(PUMP_AMM_PROGRAM_ID))throw new Error('Canonical pool owner mismatch.');
        }
        const page=await scanTradePage({connection,mint:job.mint,route:job.route,cursor:job.prior?.cursor||{},pageSize});
        await persistTradePage(client,'devnet',job.mint,job.route,page);
        result.pages++;result.examined+=page.examined;result.observedEvents+=page.records.length;
        result.gapsObserved+=page.gaps.length;
      }catch {
        result.blocked++;
        await client.query(`INSERT INTO product_trade_cursors VALUES('devnet',$1,$2,$3,'blocked',NOW()) ON CONFLICT(cluster,mint,route) DO UPDATE SET status='blocked',checked_at=NOW()`,[job.mint,job.route,JSON.stringify(job.prior?.cursor||{})]);
      }
    }
    return result;
  }finally{try{if(locked)await client.query('SELECT pg_advisory_unlock(71648081)');}finally{client.release();}}
}

export async function productTradeReport(pool,cluster) {
  const {rows:[totals]}=await pool.query(`SELECT count(*)::int AS trades,COALESCE(sum(sol_lamports),0)::text AS "observedVolumeLamports",
    min(block_time)::text AS "earliestBlockTime",max(block_time)::text AS "latestBlockTime" FROM product_trade_events WHERE cluster=$1`,[cluster]);
  const scans=await pool.query('SELECT status,count(*)::int AS routes,min(checked_at) AS oldest_check,max(checked_at) AS latest_check FROM product_trade_cursors WHERE cluster=$1 GROUP BY status ORDER BY status',[cluster]);
  const gaps=(await pool.query(`SELECT reason,count(*)::int AS proofs,count(DISTINCT signature)::int AS transactions,
    min(first_seen_at) AS first_seen,max(checked_at) AS latest_check FROM product_trade_gaps WHERE cluster=$1 GROUP BY reason ORDER BY reason`,[cluster])).rows;
  const excluded=(await pool.query('SELECT count(DISTINCT signature)::int AS migrations FROM product_trade_nontrades WHERE cluster=$1',[cluster])).rows[0];
  return {...totals,observedVolumeLamports:scans.rows.length?totals.observedVolumeLamports:null,
    status:!scans.rows.length?'not-indexed':scans.rows.some(row=>row.status==='blocked')?'partial-with-blockers':gaps.length?'partial-with-gaps':'partial',
    scope:'registered-mints-pump-curves-and-canonical-sol-pools',commitment:'finalized',coverage:'observed-only',
    volumeBasis:'curve-event-SOL; pool-buyer-total-SOL-in-and-seller-net-SOL-out; excludes-network-fees',
    appOriginAttribution:false, historicalCompletenessVerified:false, scans:scans.rows,unresolvedProofs:gaps.reduce((sum,row)=>sum+row.proofs,0),gaps,excludedMigrations:excluded.migrations,
    guidance:'Trade activity on registered tokens can originate outside funded.vip. Provider history exhaustion does not prove archival completeness. Refresh and backfill are bounded operator runs.'};
}
