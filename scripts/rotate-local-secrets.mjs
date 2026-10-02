import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';

function parseEnv(contents) {
  return Object.fromEntries(contents.split(/\r?\n/).flatMap(line => {
    const index = line.indexOf('=');
    if (index <= 0 || line.trimStart().startsWith('#')) return [];
    return [[line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')]];
  }));
}

const local = parseEnv(await readFile('.env.local', 'utf8'));
const nextDatabasePassword = randomBytes(32).toString('hex');
await new Promise((resolve, reject) => {
  const child = spawn('docker', ['exec', '-i', 'fundedapp-db-1', 'psql', '-U', 'funded', '-d', 'funded_app', '-v', 'ON_ERROR_STOP=1'], { stdio: ['pipe', 'ignore', 'pipe'] });
  let error = '';
  child.stderr.on('data', chunk => { error += chunk; });
  child.on('error', reject);
  child.on('close', code => code === 0 ? resolve() : reject(new Error(error || `psql exited with code ${code}`)));
  child.stdin.end(`ALTER ROLE funded WITH PASSWORD '${nextDatabasePassword}';\n`);
});

await mkdir('.secrets', { recursive: true });
const writeSecret = (name, value) => writeFile(`.secrets/${name}`, `${value}\n`, { mode: 0o600 });
await writeSecret('funded-api-token', randomBytes(32).toString('hex'));
await writeSecret('funded-db-password', nextDatabasePassword);
await writeSecret('database-url', `postgresql://funded:${nextDatabasePassword}@db:5432/funded_app`);
await writeSecret('solana-rpc-url', local.SOLANA_RPC_URL || 'https://api.devnet.solana.com');
await writeSecret('solana-devnet-rpc-url', local.SOLANA_DEVNET_RPC_URL || '');
await writeSecret('solana-holder-index-rpc-url', local.SOLANA_HOLDER_INDEX_RPC_URL || '');
await writeSecret('x-client-secret', local.X_CLIENT_SECRET || '');
await writeSecret('x-bearer-token', local.X_BEARER_TOKEN || '');
console.log('Local API/database secrets rotated. Signer secret files were NOT rotated or copied; verify and rotate them separately before starting signing workers. Values were not printed.');
