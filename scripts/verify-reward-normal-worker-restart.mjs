import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';

const [path,expectedCount,expectedDigest]=process.argv.slice(2);
assert(path&&/^\d+$/.test(expectedCount)&&/^[0-9a-f]{64}$/.test(expectedDigest));
const state=JSON.parse(await readFile(path,'utf8'));
const schedules=Object.values(state.schedules||{});
assert(schedules.length>=3);
const fresh=state.schedules['normal-worker-fresh'];
assert(fresh);
assert.equal(Object.values(fresh.payments||{}).filter(row=>row.status==='paid').length,Number(expectedCount));
const digest=createHash('sha256').update(JSON.stringify(state.schedules)).digest('hex');
assert.equal(digest,expectedDigest,'Fresh process did not recover the same completed schedules and saved attempts.');
process.stdout.write(JSON.stringify({freshProcess:true,schedules:schedules.length,
  savedAttempts:schedules.reduce((n,row)=>n+Object.keys(row.payoutAttempts||{}).length,0),
  paidRecords:schedules.reduce((n,row)=>n+Object.keys(row.payments||{}).length,0),digest})+'\n');
