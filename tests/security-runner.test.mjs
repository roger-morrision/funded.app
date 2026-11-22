import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const runner = fileURLToPath(new URL('../scripts/security-tests.mjs', import.meta.url));
async function fixture(t, source, { required = ['required rejection'], files = null } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'security-gate-'));
  t.after(() => rm(root, { recursive:true, force:true }));
  await mkdir(join(root, 'config'));
  await writeFile(join(root, 'case.test.mjs'), source);
  await writeFile(join(root, 'config', 'inventory.json'), JSON.stringify({ schemaVersion:1,
    files:files || [{ path:'case.test.mjs', requiredTests:required }] }));
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const child = spawnSync(process.execPath, [runner, '--root', root, '--inventory', 'config/inventory.json'],
    { encoding:'utf8', env, timeout:20_000 });
  assert.equal(child.error, undefined);
  assert.equal(child.signal, null);
  const report = JSON.parse(child.stdout);
  t.diagnostic(JSON.stringify({ securityGateFixture:t.name, exitCode:child.status,
    counts:report.counts, required:report.required, requiredPassed:report.requiredPassed,
    nodeCounts:report.nodeSummary?.counts || null }));
  return { code:child.status, report };
}

test('security gate accepts actual required passing cases with exact counts', async t => {
  const { code, report } = await fixture(t, "import test from 'node:test'; test('required rejection',()=>{});");
  assert.equal(code, 0); assert.equal(report.success, true);
  assert.deepEqual(report.counts, { tests:1, passed:1, failed:0, skipped:0, todo:0 });
  assert.equal(report.requiredPassed, 1);
});
test('security gate fails zero file discovery', async t => {
  const { code, report } = await fixture(t, '', { files:[] });
  assert.equal(code, 1); assert.equal(report.counts.tests, 0);
  assert.match(report.errors.join(' '), /zero files/);
});
test('security gate fails an empty module despite Node file-wrapper success', async t => {
  const { code, report } = await fixture(t, '// No tests registered.');
  assert.equal(code, 1); assert.equal(report.nodeSummary.success, true);
  assert.equal(report.counts.tests, 0); assert.equal(report.requiredPassed, 0);
});
test('security gate fails all-skipped required coverage', async t => {
  const { code, report } = await fixture(t, "import test from 'node:test'; test.skip('required rejection',()=>{});");
  assert.equal(code, 1); assert.equal(report.counts.skipped, 1); assert.equal(report.requiredPassed, 0);
});
test('security gate fails a skipped required case even when another case passes', async t => {
  const { code, report } = await fixture(t, "import test from 'node:test'; test.skip('required rejection',()=>{}); test('unrelated pass',()=>{});");
  assert.equal(code, 1); assert.equal(report.counts.passed, 1); assert.equal(report.requiredPassed, 0);
});
test('security gate fails a required TODO case', async t => {
  const { code, report } = await fixture(t, "import test from 'node:test'; test.todo('required rejection');");
  assert.equal(code, 1); assert.equal(report.counts.todo, 1); assert.equal(report.requiredPassed, 0);
});
test('security gate fails an actual failing case', async t => {
  const { code, report } = await fixture(t, "import test from 'node:test'; test('required rejection',()=>{throw Error('expected fixture failure')});");
  assert.equal(code, 1); assert.equal(report.counts.failed, 1); assert.equal(report.nodeSummary.success, false);
});
test('security gate fails a missing required name despite another passing test', async t => {
  const { code, report } = await fixture(t, "import test from 'node:test'; test('other name',()=>{});");
  assert.equal(code, 1); assert.equal(report.counts.passed, 1); assert.equal(report.requiredPassed, 0);
});
test('security gate fails a missing inventory file', async t => {
  const { code, report } = await fixture(t, '', { files:[{ path:'missing.test.mjs', requiredTests:['required rejection'] }] });
  assert.equal(code, 1); assert.equal(report.counts.tests, 0); assert.equal(report.success, false);
});
