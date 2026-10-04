import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/verify-postgres-recovery.mjs', import.meta.url));
test('recovery drill refuses implicit execution and arbitrary database or container targets', () => {
  for (const args of [[], ['--run', '--database', 'production'], ['--run', '--container', 'existing-app'], ['--run', '--report']]) {
    const child = spawnSync(process.execPath, [script, ...args], { encoding:'utf8', timeout:5000 });
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /Existing database\/container targets are not accepted/);
  }
});
