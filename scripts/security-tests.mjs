import { run } from 'node:test';
import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Explicit current-source inventory: no shell glob and no discovery outside root.
export async function runSecurityTests({ root = process.cwd(), inventory = 'config/security-tests.json' } = {}) {
  const counts = { tests:0, passed:0, failed:0, skipped:0, todo:0 };
  const result = { scope:'local-only security regressions; not chain or deployment acceptance',
    node:process.version, counts, required:0, requiredPassed:0, cases:[], errors:[], success:false };
  try {
    root = await realpath(root);
    const inside = async path => {
      const absolute = await realpath(resolve(root, path)), part = relative(root, absolute);
      if (!part || part === '..' || part.startsWith('..\\') || part.startsWith('../') || isAbsolute(part))
        throw Error('Security inventory paths must stay inside the selected root.');
      return absolute;
    };
    const manifest = JSON.parse(await readFile(await inside(inventory), 'utf8'));
    if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files) || !manifest.files.length)
      throw Error('Security inventory discovered zero files or has an invalid schema.');
    const files = [], required = new Map();
    for (const entry of manifest.files) {
      if (typeof entry.path !== 'string' || !Array.isArray(entry.requiredTests) || !entry.requiredTests.length
        || entry.requiredTests.some(name => typeof name !== 'string' || !name.trim())
        || new Set(entry.requiredTests).size !== entry.requiredTests.length)
        throw Error('Each security file requires an explicit nonempty list of unique case names.');
      const file = await inside(entry.path);
      if (!(await stat(file)).isFile() || files.includes(file)) throw Error('Missing or duplicate security test file.');
      files.push(file);
      required.set(file, new Set(entry.requiredTests));
      result.required += entry.requiredTests.length;
    }
    let summary;
    for await (const { type, data } of run({ files, concurrency:false })) {
      if (type === 'test:summary' && !data.file) summary = data;
      if (!['test:pass', 'test:fail'].includes(type)) continue;
      const file = data.file ? resolve(data.file) : null;
      if (type === 'test:fail') result.errors.push('Failed test: ' + data.name);
      if (data.details?.type === 'suite') continue;
      // Node emits a successful file wrapper even when it registered no tests.
      if (file && (data.name === file || resolve(root, data.name) === file)) continue;
      const skipped = data.skip !== undefined && data.skip !== false;
      const todo = data.todo !== undefined && data.todo !== false;
      const status = type === 'test:fail' ? 'failed' : skipped ? 'skipped' : todo ? 'todo' : 'passed';
      counts.tests++; counts[status]++;
      result.cases.push({ file:file ? relative(root, file).replaceAll('\\', '/') : null, name:data.name, status });
      if (status === 'passed' && required.get(file)?.delete(data.name)) result.requiredPassed++;
    }
    result.nodeSummary = summary || null;
    if (!summary?.success) result.errors.push('Node security test execution did not complete successfully.');
    if (!counts.tests || !counts.passed) result.errors.push('Zero registered passing security cases.');
    for (const [file, names] of required) for (const name of names)
      result.errors.push('Required security case did not pass: ' + relative(root, file) + ' :: ' + name);
    result.success = result.errors.length === 0 && counts.failed === 0 && result.requiredPassed === result.required;
  } catch (error) { result.errors.push(error.message); }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options = {};
    for (let i = 2; i < process.argv.length; i += 2) {
      const key = { '--root':'root', '--inventory':'inventory' }[process.argv[i]];
      if (!key || !process.argv[i + 1]) throw Error('Usage: security-tests.mjs [--root path] [--inventory path]');
      options[key] = process.argv[i + 1];
    }
    const result = await runSecurityTests(options);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exitCode = result.success ? 0 : 1;
  } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
