import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

// Local single-process fallback only. Auth data is never part of public app state.
export function createFileAuthStore(path) {
  let queue = Promise.resolve();
  const mutate = operation => {
    const result = queue.then(async () => {
      let rows = {};
      try { rows = JSON.parse(await readFile(path, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      for (const [key, row] of Object.entries(rows)) if (!(row.expiresAt > Date.now())) delete rows[key];
      const value = operation(rows);
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(rows), { mode: 0o600, flag: 'wx' });
        await rename(temporary, path);
      } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
      return value;
    });
    queue = result.catch(() => {});
    return result;
  };
  return {
    authPut(kind, key, payload, expiresAt) {
      return mutate(rows => {
        if (Object.keys(rows).length >= 10000) throw new Error('Local sign-in capacity reached.');
        rows[`${kind}:${key}`] = { payload, expiresAt };
      });
    },
    async authRead(kind, key) {
      await queue;
      try {
        const row = JSON.parse(await readFile(path, 'utf8'))[`${kind}:${key}`];
        return row?.expiresAt > Date.now() ? row.payload : null;
      } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
    authTake(kind, key) {
      return mutate(rows => { const row = rows[`${kind}:${key}`]; delete rows[`${kind}:${key}`]; return row?.payload || null; });
    },
    authDelete(kind, key) { return mutate(rows => { delete rows[`${kind}:${key}`]; }); },
  };
}
