import { readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

// Original artwork stays in public/ for editing/re-encoding. Only unused PNG
// sources are omitted from the release; referenced and optimized images survive.
export async function prunePosterSources({ root, outDir }) {
  root = resolve(root); outDir = resolve(root, outDir);
  if (outDir === root || outDir === join(root, 'public')) throw new Error('Build output cannot replace source artwork.');
  const directory = join(outDir, 'posters');
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return { omittedFiles: 0, omittedBytes: 0 }; throw error; }
  const sourceEntries = (await readdir(root, { withFileTypes: true })).filter(entry => entry.isFile() && /\.(?:js|html|css)$/.test(entry.name));
  const source = (await Promise.all(sourceEntries.map(entry => readFile(join(root, entry.name), 'utf8')))).join('\n');
  // A dynamic PNG poster path cannot be resolved statically, so preserve originals.
  const dynamicPngReference = /posters\/[^\n]*\$\{[^\n]*\.png/.test(source);
  const omitted = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.png') || dynamicPngReference || source.includes(entry.name)) continue;
    const path = join(directory, entry.name);
    const { size } = await stat(path);
    await unlink(path);
    omitted.push({ path: `posters/${entry.name}`, bytes: size });
  }
  const report = { schemaVersion: 1, omittedFiles: omitted.length, omittedBytes: omitted.reduce((sum, file) => sum + file.bytes, 0), omitted };
  await writeFile(join(outDir, 'build-asset-report.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}
