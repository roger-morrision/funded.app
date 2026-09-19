import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const path = resolve(process.cwd(), '.env.deploy');
const example = await readFile(resolve(process.cwd(), '.env.example'), 'utf8');
const publicValue = key => example.match(new RegExp(`^${key}=(.+)$`, 'm'))?.[1]?.trim() || '';
const settings = [
  '# Local Docker preview secrets. Never commit or share this file.',
  `FUNDED_DB_PASSWORD=${randomBytes(32).toString('hex')}`,
  `FUNDED_API_TOKEN=${randomBytes(32).toString('hex')}`,
  `FUNDED_FEE_ROUTER_PROGRAM_ID=${publicValue('FUNDED_FEE_ROUTER_PROGRAM_ID')}`,
  `FUNDED_TRADE_FEE_OWNER=${publicValue('VITE_FUNDED_TRADE_FEE_OWNER')}`,
  'FUNDED_TOKEN_MINT=',
  '# Add a Cloudflare Tunnel token only after funded.vip is active in Cloudflare.',
  'CLOUDFLARE_TUNNEL_TOKEN=',
  '',
].join('\n');
try {
  await writeFile(path, settings, { flag: 'wx', mode: 0o600 });
  console.log('Created .env.deploy with random local secrets. Keep it private.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('.env.deploy already exists; leaving its secrets unchanged.');
}
