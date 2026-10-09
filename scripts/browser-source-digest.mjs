import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Include browser entry points, config, dependency lock, artwork and public files.
// API-only changes do not require rebuilding an unchanged browser bundle.
export async function browserSourceDigest(root) {
  root = resolve(root);
  const paths = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isFile() && (/\.(?:js|css|html|png|webp|svg|avif|jpe?g)$/.test(entry.name) || ['package.json', 'package-lock.json'].includes(entry.name))) paths.push(entry.name);
  }
  async function collect(relative) {
    let entries;
    try { entries = await readdir(join(root, relative), { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const path = join(relative, entry.name);
      if (entry.isDirectory()) await collect(path);
      else if (entry.isFile()) paths.push(path);
    }
  }
  await collect('public');
  await collect('config');
  await collect('src');
  await collect('styles');
  for (const file of ['scripts/browser-source-digest.mjs', 'scripts/prune-build-sources.mjs']) {
    try { await readFile(join(root, file)); paths.push(file); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const digest = createHash('sha256');
  for (const path of paths.sort()) {
    const hash = createHash('sha256').update(await readFile(join(root, path))).digest('hex');
    digest.update(`${path.split('\\').join('/')}\0${hash}\n`);
  }
  return digest.digest('hex');
}
