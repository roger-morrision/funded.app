import { readFileSync } from 'node:fs';

export function pgPoolConfig(databaseUrl) {
  const url = new URL(databaseUrl);
  const sslMode = url.searchParams.get('sslmode');
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) url.searchParams.delete(key);
  const useTls = process.env.DATABASE_SSL === 'true' || (sslMode && sslMode !== 'disable');
  const ca = process.env.DATABASE_CA_CERT || (process.env.DATABASE_CA_CERT_PATH ? readFileSync(process.env.DATABASE_CA_CERT_PATH, 'utf8') : undefined);
  return {
    connectionString: url.toString(),
    max: Number(process.env.DATABASE_POOL_MAX || 10),
    ssl: useTls ? { rejectUnauthorized: true, ...(ca ? { ca } : {}) } : undefined,
  };
}
