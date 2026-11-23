import { mkdir, open, readFile, rename, unlink, stat, lstat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import {fenceRewardLedgerDirectory,rewardStoreFailure} from './reward-store-durability.mjs';

const activeTransactions=new Set();
const writeQueues=new Map();
let draining=false;
// A mutator may return this only when it made no change to the locked state.
// This avoids encoding the entire ledger for a proven read-only recovery
// outcome while retaining the lock, cleanup and directory durability fence.
export const REWARD_LEDGER_UNCHANGED=Symbol('reward-ledger-unchanged');
export async function drainAutomaticRewardTransactions() {
  draining=true;
  const results=await Promise.allSettled([...activeTransactions]);
  const failed=results.filter(result=>result.status==='rejected');
  if(failed.length)throw new AggregateError(failed.map(result=>result.reason),'Active reward transaction failed during shutdown.');
}

// Dedicated ledger; existing immutable launches are never rewritten. A crashed
// lock needs operator investigation rather than unsafe automatic lock expiration.
export function createAutomaticRewardStore(path) {
  let publicRead;
  async function projectWith(pick) {
    let identity;
    try {
      const info=await stat(path,{bigint:true}),parts=[info.dev,info.ino,info.size,info.mtimeNs,info.ctimeNs];
      if(parts.some(value=>typeof value!=='bigint')||info.ino<=0n){publicRead=null;return pick(await readState());}
      identity=parts.join(':');
    }catch(error){if(error.code!=='ENOENT')throw error;publicRead=null;return pick(await readState());}
    if(publicRead?.identity!==identity){
      const entry={identity,promise:readState()};publicRead=entry;
      void entry.promise.catch(()=>{if(publicRead===entry)publicRead=null;});
    }
    const state=await publicRead.promise;
    return pick(state);
  }
  const project=keys=>projectWith(state=>structuredClone(Object.fromEntries(keys.map(key=>[key,state[key]]))));
  async function acquireLock() {
    for (let attempt = 0; attempt < 40; attempt++) {
      try { return await open(`${path}.lock`, 'wx'); }
      catch (error) {
        if (error.code !== 'EEXIST' || attempt === 39) throw error;
        await delay(50);
      }
    }
  }
  async function readSnapshot() {
    try {
      const encoded=await readFile(path),state=JSON.parse(encoded.toString('utf8'));
      if (![1, 2].includes(state.version)) throw new Error('Unsupported ledger version.');
      return {state,encoded};
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return {encoded:null,state:{ version: 2, obligations: {}, batches: {}, programs: {}, schedules: {}, holderSnapshots: {}, rewardPools: {}, buyOrders: {}, fundingRequests: {} }};
    }
  }
  async function readState(){return (await readSnapshot()).state;}
  async function transaction(mutator) {
    await mkdir(dirname(path), { recursive: true });
    const lock = await acquireLock();
    const temp = `${path}.${randomUUID()}.tmp`;
    let result;const errors=[];
    try {
      const {state,encoded:prior}=await readSnapshot();
      if (![1, 2].includes(state.version)) throw new Error('Unsupported ledger version.');
      const needsMigration=state.version===1;
      if (state.version === 1) state.version = 2;
      result = await mutator(state,{published:prior!==null});
      // Compare final bytes under the SAME lock. Only an existing, byte-identical
      // ledger can skip publication; bootstrap, migration and every changed proof
      // still serialize, fsync and rename before the transaction returns.
      // The explicit hint is limited to an existing version-2 ledger. A new
      // file and version-1 migration must still publish even for a no-change
      // callback. Every other callback keeps the exact byte comparison.
      if(result!==REWARD_LEDGER_UNCHANGED||prior===null||needsMigration){
        const encoded=Buffer.from(JSON.stringify(state),'utf8');
        if(prior===null||!encoded.equals(prior)){
          const file = await open(temp, 'wx'),writeErrors=[];
          try { await file.writeFile(encoded); await file.sync(); } catch(error){writeErrors.push(error);}
          try { await file.close(); } catch(error){writeErrors.push(error);}
          if(writeErrors.length)throw rewardStoreFailure(writeErrors);
          await rename(temp, path);
          // Publication can be visible even if the later durability fence fails.
          publicRead=null;
        }
      }
    } catch(error){errors.push(error);}
    try { await unlink(temp); } catch(error){if(error.code!=='ENOENT')errors.push(error);}
    let closed=false;try{await lock.close();closed=true;}catch(error){errors.push(error);}
    // A failed close retains the crash marker for investigation, as before.
    if(closed)try{await unlink(`${path}.lock`);}catch(error){errors.push(error);}
    // Include no-ops, cleanup and same-filesystem ancestor creation. The promise
    // is not a successful commit until this completes; never undo a visible
    // journal or authorize another financial attempt after a fence failure.
    try{await fenceRewardLedgerDirectory(dirname(path));}catch(error){errors.push(error);}
    if(errors.length)throw rewardStoreFailure(errors);
    return result;
  }
  return {async read(){return structuredClone(await readState());},
  // A payout needs one immutable schedule, not a clone of every holder and
  // signed attempt in the ledger. The inode identity still refreshes after a
  // competing writer and callers never receive the cached mutable object.
  readSchedule:id=>projectWith(state=>structuredClone(state.schedules?.[id])),
  async hasPublishedFile(){try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}},
  readFinancialSnapshot:()=>project(['version','programs','schedules','rewardPools','dailyBonusSnapshots']),
  readStatusSnapshot:()=>project(['serviceStatus','schedules']),
  readAutomationSnapshot:()=>project(['serviceStatus','schedules','communityClaimIndex','communityDrops','buybackWorkerHeartbeat']),
  readWorkerHealth:()=>project(['serviceStatus','dailyBonusServiceStatus','buybackWorkerHeartbeat']),
  readBonusSnapshot:()=>project(['dailyBonusSnapshots','dailyBonusProgress','dailyBonusServiceStatus']),
  transaction(mutator){
    if(draining)return Promise.reject(Object.assign(new Error('Reward service is restarting; retry shortly.'),{statusCode:503}));
    const key=resolve(path),queue=writeQueues.get(key)||{tail:Promise.resolve(),count:0};
    if(queue.count>=64)return Promise.reject(Object.assign(new Error('Reward ledger write queue is busy; retry shortly.'),{statusCode:503}));
    writeQueues.set(key,queue);queue.count++;
    const pending=queue.tail.then(()=>transaction(mutator));
    queue.tail=pending.then(()=>{},()=>{});
    void queue.tail.then(()=>{queue.count--;if(queue.count===0&&writeQueues.get(key)===queue)writeQueues.delete(key);});
    activeTransactions.add(pending);
    void pending.then(()=>activeTransactions.delete(pending),()=>activeTransactions.delete(pending));
    return pending;
  }};
}
