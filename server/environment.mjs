import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Mainnet non-program mode reads only service credentials. Signing keys and
// .env.local are never loaded, so no Richpad program or payout can be signed.
export const MAINNET_NON_PROGRAM_SECRET_FILES = Object.freeze(['DATABASE_URL_FILE', 'FUNDED_API_TOKEN_FILE',
  'BIRDEYE_API_KEY_FILE', 'PINATA_JWT_FILE', 'FUNDED_ADMIN_GMAIL_APP_PASSWORD_FILE', 'X_CLIENT_SECRET_FILE', 'X_BEARER_TOKEN_FILE']);
function loadMainnetNonProgramSecrets(env, readFile) {
  const signer = Object.keys(env).find(name => /SIGNER|SECRET_KEY|KEYPAIR|PRIVATE_KEY/i.test(name) && env[name]);
  if (signer) throw Error(`Mainnet non-program mode refuses signing configuration (${signer}).`);
  for (const name of MAINNET_NON_PROGRAM_SECRET_FILES) {
    const filePath = env[name];
    if (!filePath || env[name.slice(0, -5)] != null) continue;
    try { env[name.slice(0, -5)] = readFile(filePath, 'utf8').trim(); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

// Keep startup precedence: existing environment, secret files, then local values.
export function loadServerEnvironment({ env = process.env, cwd = process.cwd(), readFile = readFileSync } = {}) {
  if (env.FUNDED_SKIP_LOCAL_ENV === 'true') return;
  if([env.SOLANA_CLUSTER,env.VITE_SOLANA_CLUSTER].includes('mainnet-beta') && env.FUNDED_MAINNET_NON_PROGRAM_WRITES === 'true')
    return loadMainnetNonProgramSecrets(env, readFile);
  if([env.SOLANA_CLUSTER,env.VITE_SOLANA_CLUSTER].includes('mainnet-beta'))
    throw Error('Mainnet requires explicit isolated configuration with FUNDED_SKIP_LOCAL_ENV=true; local defaults and signer files were not loaded.');
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
