import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresStore } from '../server/postgres-store.mjs';

async function loadLocalEnv() {
  try {
    const contents = await readFile(resolve(process.cwd(), '.env.local'), 'utf8');
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || match[1].startsWith('#')) continue;
      const value = match[2].replace(/^['"]|['"]$/g, '');
      if (process.env[match[1]] == null) process.env[match[1]] = value;
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

await loadLocalEnv();
const databaseUrl = String(process.env.DATABASE_URL || '').trim();
if (!databaseUrl) throw new Error('DATABASE_URL is required.');
const store = createPostgresStore(databaseUrl);
try { await store.read(); console.log('PostgreSQL schema and keyed-state migration applied successfully.'); }
finally { await store.close(); }
