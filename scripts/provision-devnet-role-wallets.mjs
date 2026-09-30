import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import bs58 from 'bs58';
import { Keypair, PublicKey } from '@solana/web3.js';

const envPath = resolve('.env.devnet-app-roles.local');
const publicPath = resolve('.secrets/devnet-app-roles-20260930/public.json');
const participantPath = resolve('.secrets/devnet-qa-wallets-20260930/public.json');
const roles = [
  ['app_owner', 'QA_DEVNET_APP_OWNER_SECRET_KEY'],
  ['pump_fee_keeper', 'QA_DEVNET_PUMP_FEE_KEEPER_SECRET_KEY'],
  ['pump_revenue_treasury', 'QA_DEVNET_PUMP_REVENUE_TREASURY_SECRET_KEY'],
  ['trading_fee_treasury', 'QA_DEVNET_TRADING_FEE_TREASURY_SECRET_KEY'],
  ['router_authority', 'QA_DEVNET_ROUTER_AUTHORITY_SECRET_KEY'],
  ['funded_holder', 'QA_DEVNET_FUNDED_HOLDER_SECRET_KEY'],
  ['coin_holder', 'QA_DEVNET_COIN_HOLDER_SECRET_KEY'],
  ['x_partner', 'QA_DEVNET_X_PARTNER_SECRET_KEY'],
  ['buyback_operator', 'QA_DEVNET_BUYBACK_OPERATOR_SECRET_KEY'],
  ['referral_payout_funder', 'QA_DEVNET_REFERRAL_PAYOUT_FUNDER_SECRET_KEY'],
];

function restrictPrivateFile(path) {
  if (process.platform !== 'win32') return;
  const current = execFileSync('whoami', { encoding:'utf8' }).trim();
  const user = `${process.env.USERDOMAIN}\\${process.env.USERNAME}`;
  execFileSync('icacls', [path, '/inheritance:r', '/grant:r', `${current}:(F)`, `${user}:(F)`, 'BUILTIN\\Administrators:(F)', 'NT AUTHORITY\\SYSTEM:(F)'], { stdio:'ignore' });
}

function envValues(contents) {
  return Object.fromEntries(contents.split(/\r?\n/).filter(line => /^[A-Z][A-Z0-9_]*=/.test(line)).map(line => {
    const index = line.indexOf('=');
    return [line.slice(0, index), line.slice(index + 1).trim()];
  }));
}

export function verifyDevnetRoleWallets(contents, manifest, participants = []) {
  const values = envValues(contents);
  assert.equal(values.SOLANA_CLUSTER, 'devnet', 'Role wallet file must be Devnet only.');
  assert.equal(manifest.length, roles.length, 'Role manifest is incomplete.');
  const participantAddresses = new Set(participants.map(row => new PublicKey(row.address).toBase58()));
  const addresses = new Set(participantAddresses);
  for (const [role, key] of roles) {
    const secret = values[key];
    assert.ok(secret, `Missing ${key}.`);
    const wallet = Keypair.fromSecretKey(bs58.decode(secret));
    const address = wallet.publicKey.toBase58();
    const publicRow = manifest.find(row => row.role === role);
    assert.equal(publicRow?.address, address, `${role} public manifest differs from its private key.`);
    assert.equal(publicRow?.cluster, 'devnet');
    assert.ok(!addresses.has(address), `${role} shares a wallet with another role or participant.`);
    addresses.add(address);
  }
  return { appRoles: roles.length, participants: participants.length, distinctWallets: addresses.size };
}

async function readExisting() {
  const present = await Promise.all([envPath, publicPath].map(path => access(path).then(() => true, () => false)));
  if (present.some(Boolean) && !present.every(Boolean)) throw new Error('A role wallet file is missing; refusing to replace the existing keys.');
  if (!present[0]) return null;
  const [contents, manifest, participants] = await Promise.all([
    readFile(envPath, 'utf8'), readFile(publicPath, 'utf8').then(JSON.parse), readFile(participantPath, 'utf8').then(JSON.parse),
  ]);
  return { contents, manifest, participants };
}

async function main() {
  const existing = await readExisting();
  if (existing) {
    const verified = verifyDevnetRoleWallets(existing.contents, existing.manifest, existing.participants);
    console.log(JSON.stringify({ status:'existing-verified', ...verified, publicManifest:publicPath }));
    return;
  }
  if (!process.argv.includes('--create')) {
    console.log('No wallets created. Run with --create to provision isolated Devnet QA roles.');
    return;
  }
  const participants = JSON.parse(await readFile(participantPath, 'utf8'));
  const generated = roles.map(([role, key]) => ({ role, key, wallet:Keypair.generate() }));
  const manifest = generated.map(({ role, wallet }) => ({ role, address:wallet.publicKey.toBase58(), cluster:'devnet' }));
  const contents = ['# Devnet QA only. Never load this file in Mainnet or a public client.', 'SOLANA_CLUSTER=devnet',
    ...generated.map(({ key, wallet }) => `${key}=${bs58.encode(wallet.secretKey)}`), ''].join('\n');
  const verified = verifyDevnetRoleWallets(contents, manifest, participants);
  await mkdir(resolve(publicPath, '..'), { recursive:true });
  const envTemp = `${envPath}.${randomUUID()}.tmp`;
  const publicTemp = `${publicPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(envTemp, contents, { flag:'wx', mode:0o600 });
    restrictPrivateFile(envTemp);
    await writeFile(publicTemp, `${JSON.stringify(manifest, null, 2)}\n`, { flag:'wx' });
    await rename(envTemp, envPath);
    await rename(publicTemp, publicPath);
  } finally {
    await Promise.all([unlink(envTemp).catch(() => {}), unlink(publicTemp).catch(() => {})]);
  }
  console.log(JSON.stringify({ status:'created', ...verified, publicManifest:publicPath }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch(error => {
    console.error(`Devnet role wallet provisioning failed: ${error.message}`);
    process.exitCode = 1;
  });
}
