import { mkdir, open, readFile, rename, unlink, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const activeTransactions=new Set();
const writeQueues=new Map();
let draining=false;
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
  async function project(keys) {
    const pick=state=>structuredClone(Object.fromEntries(keys.map(key=>[key,state[key]])));
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
  async function acquireLock() {
    for (let attempt = 0; attempt < 40; attempt++) {
      try { return await open(`${path}.lock`, 'wx'); }
      catch (error) {
        if (error.code !== 'EEXIST' || attempt === 39) throw error;
        await delay(50);
      }
    }
  }
  async function readState() {
    try {
      const state = JSON.parse(await readFile(path, 'utf8'));
      if (![1, 2].includes(state.version)) throw new Error('Unsupported ledger version.');
      return state;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return { version: 2, obligations: {}, batches: {}, programs: {}, schedules: {}, holderSnapshots: {}, rewardPools: {}, buyOrders: {}, fundingRequests: {} };
    }
  }
  async function transaction(mutator) {
    await mkdir(dirname(path), { recursive: true });
    const lock = await acquireLock();
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
      const state = await readState();
      if (![1, 2].includes(state.version)) throw new Error('Unsupported ledger version.');
      if (state.version === 1) state.version = 2;
      const result = await mutator(state);
      const file = await open(temp, 'wx');
      try { await file.writeFile(JSON.stringify(state)); await file.sync(); } finally { await file.close(); }
      await rename(temp, path);
      publicRead=null;
      return result;
    } finally {
      try { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
      finally { await lock.close(); await unlink(`${path}.lock`); }
    }
  }
  return {async read(){return structuredClone(await readState());},
  readFinancialSnapshot:()=>project(['version','programs','schedules','dailyBonusSnapshots']),
  readStatusSnapshot:()=>project(['serviceStatus','schedules']),
  readAutomationSnapshot:()=>project(['serviceStatus','schedules','communityClaimIndex','communityDrops','buybackWorkerHeartbeat']),
  readWorkerHealth:()=>project(['dailyBonusServiceStatus','buybackWorkerHeartbeat']),
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
