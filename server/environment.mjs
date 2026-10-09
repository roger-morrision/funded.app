import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Keep startup precedence: existing environment, secret files, then local values.
export function loadServerEnvironment({ env = process.env, cwd = process.cwd(), readFile = readFileSync } = {}) {
  if (env.FUNDED_SKIP_LOCAL_ENV === 'true') return;
  for (const [name, filePath] of Object.entries(env)) {
    if (!name.endsWith('_FILE') || !filePath || env[name.slice(0, -5)] != null) continue;
    try { env[name.slice(0, -5)] = readFile(filePath, 'utf8').trim(); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  try {
    const contents = readFile(resolve(cwd, '.env.local'), 'utf8');
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || match[1].startsWith('#')) continue;
      const value = match[2].replace(/^['"]|['"]$/g, '');
      if (env[match[1]] == null) env[match[1]] = value;
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
