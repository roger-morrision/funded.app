import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const script=fileURLToPath(new URL('../scripts/verify-x-post-recovery.mjs',import.meta.url));
test('X recovery drill refuses existing database/container targets and requires explicit disposable run',()=>{
  for(const args of [[],['--run','--database-url','postgresql://private/existing'],['--run','--container','existing'],['--run','--report']]){
    const child=spawnSync(process.execPath,[script,...args],{encoding:'utf8',timeout:5000});
    assert.notEqual(child.status,0);assert.match(child.stderr,/newly created disposable Docker PostgreSQL/);
  }
});
