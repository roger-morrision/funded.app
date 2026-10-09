import { readFile } from 'node:fs/promises';

// Source assertions must inspect the complete ordered stylesheet, including
// local imports. Browser builds resolve these same imports through Vite.
export async function readStylesheet(url, ancestors = new Set()) {
  const key = url.href;
  if (ancestors.has(key)) throw new Error(`Circular stylesheet import: ${key}`);
  const branch = new Set([...ancestors, key]);
  const source = await readFile(url, 'utf8');
  const imports = [...source.matchAll(/@import\s+(['"])(\.\.?\/[^'"]+)\1\s*;/g)];
  let expanded = '', offset = 0;
  for (const match of imports) {
    expanded += source.slice(offset, match.index);
    expanded += await readStylesheet(new URL(match[2], url), branch);
    offset = match.index + match[0].length;
  }
  return expanded + source.slice(offset);
}
