import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { browserSourceDigest } from '../scripts/browser-source-digest.mjs';
import { readStylesheet } from '../scripts/read-stylesheet.mjs';
import { checkSourceSizes, exceedsSourceBudget, sourceSize } from '../scripts/check-source-size.mjs';

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'funded-structure-'));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test('release digest tracks nested browser modules, styles and module removal', () => fixture(async root => {
  await mkdir(join(root, 'src/features/coin'), { recursive: true });
  await mkdir(join(root, 'styles/experience'), { recursive: true });
  const initial = await browserSourceDigest(root);
  const module = join(root, 'src/features/coin/view.js');
  await writeFile(module, 'export const view = 1;');
  const added = await browserSourceDigest(root);
  assert.notEqual(added, initial);
  await writeFile(module, 'export const view = 2;');
  const changed = await browserSourceDigest(root);
  assert.notEqual(changed, added);
  await writeFile(join(root, 'styles/experience/coin.css'), '.coin { color: gold; }');
  const styled = await browserSourceDigest(root);
  assert.notEqual(styled, changed);
  await rm(module);
  assert.notEqual(await browserSourceDigest(root), styled);
}));

test('stylesheet assertions preserve import order and repeated cascade refinements', () => fixture(async root => {
  await writeFile(join(root, 'base.css'), '.card { color: gray; }');
  await writeFile(join(root, 'refine.css'), '.card { color: gold; }');
  await writeFile(join(root, 'entry.css'), "@import './base.css';\n@import './refine.css';\n@import './base.css';");
  assert.equal(await readStylesheet(pathToFileURL(join(root, 'entry.css'))), '.card { color: gray; }\n.card { color: gold; }\n.card { color: gray; }');
}));

test('stylesheet assertions fail on circular and missing imports', () => fixture(async root => {
  const entry = pathToFileURL(join(root, 'entry.css'));
  await writeFile(entry, "@import './entry.css';");
  await assert.rejects(readStylesheet(entry), /Circular stylesheet import/);
  await writeFile(entry, "@import './missing.css';");
  await assert.rejects(readStylesheet(entry), { code: 'ENOENT' });
}));

test('size guard covers compressed files and grandfathered files cannot grow', () => {
  assert.deepEqual(sourceSize('a\r\nb\r\n'), { lines: 2, bytes: 4 });
  assert.deepEqual(exceedsSourceBudget(sourceSize('x'.repeat(40961))), ['bytes']);
  assert.deepEqual(exceedsSourceBudget(sourceSize('x\n'.repeat(501))), ['lines']);
  assert.deepEqual(exceedsSourceBudget({ lines: 799, bytes: 60000 }, { lines: 800, bytes: 60000 }), []);
  assert.deepEqual(exceedsSourceBudget({ lines: 801, bytes: 60001 }, { lines: 800, bytes: 60000 }), ['lines', 'bytes']);
  assert.deepEqual(exceedsSourceBudget({ lines: 1001, bytes: 4000 }, { lines: 9000 }), ['lines'], 'Legacy exceptions cannot bypass the hard maximum');
});

test('size guard covers nested scripts, tests and contracts while excluding generated dependencies', () => fixture(async root => {
  const files = ['scripts/nested/check.mjs', 'tests/example.test.mjs', 'contracts/program/src/lib.rs', 'new-feature/worker.ts'];
  await mkdir(join(root, 'config'), { recursive: true });
  await writeFile(join(root, 'config/source-size-baseline.json'), JSON.stringify({ files: {} }));
  for (const file of [...files, 'contracts/target/generated.rs', 'scripts/node_modules/dependency/index.js']) {
    await mkdir(join(root, file, '..'), { recursive: true });
    await writeFile(join(root, file), '// line\n'.repeat(1001));
  }
  const result = await checkSourceSizes(root);
  assert.equal(result.files, files.length);
  assert.equal(result.failures.length, files.length);
  for (const file of files) assert.ok(result.failures.some(message => message.startsWith(`${file}: 1001 lines`)));
  await writeFile(join(root, files[0]), '// line\n'.repeat(1000));
  assert.equal((await checkSourceSizes(root)).failures.length, files.length - 1);
}));

test('size guard includes build configuration and does not hide source folders named like outputs', () => fixture(async root => {
  const files = ['scripts/build/check.MJS', 'src/target/view.TSX', 'src/build/render.mts',
    '.github/workflows/ci.yml', 'deploy/service.yaml', 'contracts/example/Cargo.toml',
    'Dockerfile', 'deploy/worker.Dockerfile', 'deploy/Dockerfile.preview'];
  await mkdir(join(root, 'config'), { recursive: true });
  await writeFile(join(root, 'config/source-size-baseline.json'), JSON.stringify({ files: {} }));
  const generated = ['dist/bundle.js', 'build/output.js', 'tmp/snapshot.js',
    'contracts/example/target/generated.rs', 'scripts/node_modules/package/index.js'];
  for (const file of [...files, ...generated]) {
    await mkdir(join(root, file, '..'), { recursive: true });
    await writeFile(join(root, file), '// line\n'.repeat(1001));
  }
  const result = await checkSourceSizes(root);
  assert.equal(result.files, files.length);
  assert.equal(result.failures.length, files.length);
  for (const file of files) assert.ok(result.failures.some(message => message.startsWith(`${file}: 1001 lines`)), file);
}));
