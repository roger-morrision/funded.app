import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const cases={
  bootstrap:'nested bootstrap fences leaf and ancestor names before returning',
  noop:'byte-identical return retains inode but fences directory metadata',
  migration:'version migration fences published state',
  'post-rename':'post-rename fence failure leaves visible immutable state but suppresses the dependent action',
  'open-fail':'directory-open errors are not silently swallowed',
  'close-fail':'directory-close errors are not silently swallowed',
  'primary-and-fence':'primary mutation and durability failures preserve both errors and status',
  combined:'write sync close and directory failures retain every cause',
  'lock-close':'lock-close failure retains its marker while reporting the failure',
  journal:'post-rename signed-wire failure cannot broadcast or replace its saved attempt',
};
for(const [mode,name] of Object.entries(cases))test('Linux directory durability: '+name,()=>{
  assert.equal(process.platform,'linux','This required suite must run on Linux; Windows is not directory-fsync evidence.');
  const r=spawnSync(process.execPath,[fileURLToPath(new URL('./reward-directory-fence-child.mjs',import.meta.url)),mode],{encoding:'utf8',env:process.env});
  assert.equal(r.status,0,r.stdout+r.stderr);const result=JSON.parse(r.stdout.trim());assert.equal(result.mode,mode);assert.equal(result.platform,'linux');
});
