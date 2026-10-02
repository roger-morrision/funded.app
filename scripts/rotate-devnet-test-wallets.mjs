import { randomUUID } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';

const keys = [
  ['creator', 'SOLANA_DEVNET_CREATOR_SECRET_KEY'],
  ['referrer', 'SOLANA_DEVNET_REFERRER_SECRET_KEY'],
  ['claimant', 'SOLANA_DEVNET_CLAIMANT_SECRET_KEY'],
];

function assertDevnetProfile(contents) {
  for (const [key, expected] of [
    ['VITE_DEV_MODE', 'true'],
    ['VITE_DEV_AUTOCONNECT', 'true'],
    ['VITE_SOLANA_CLUSTER', 'devnet'],
    ['DEV_MODE', 'true'],
    ['SOLANA_CLUSTER', 'devnet'],
  ]) {
    const matches = contents.match(new RegExp(`^${key}=(.*)$`, 'gm')) || [];
    if (matches.length !== 1 || matches[0].slice(key.length + 1).trim() !== expected) {
      throw new Error(`Expected exactly one ${key}=${expected} in .env.local.`);
    }
  }
}

export function replaceDevnetTestWallets(contents, roleSecrets) {
  assertDevnetProfile(contents);
  let next = contents;
  for (const [role, key] of keys) {
    const lines = next.match(new RegExp(`^${key}=[^\r\n]*\r?$`, 'gm')) || [];
    if (lines.length !== 1 || !lines[0].slice(key.length + 1).trim()) {
      throw new Error(`Expected exactly one populated ${key} in .env.local.`);
    }
    next = next.replace(new RegExp(`^${key}=[^\r\n]*(\r?)$`, 'm'), (_, carriageReturn) => `${key}=${roleSecrets[role]}${carriageReturn}`);
  }
  return next;
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== '--apply') {
    console.log('No changes made. Stop the local API and signing workers, then run: node scripts/rotate-devnet-test-wallets.mjs --apply');
    return;
  }

  const envPath = resolve('.env.local');
  const original = await readFile(envPath, 'utf8');
  const wallets = Object.fromEntries(keys.map(([role]) => [role, Keypair.generate()]));
  const replacements = Object.fromEntries(keys.map(([role]) => [role, bs58.encode(wallets[role].secretKey)]));
  const updated = replaceDevnetTestWallets(original, replacements);
  const tempPath = `${envPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, updated, { flag: 'wx', mode: 0o600 });
    await rename(tempPath, envPath);
  } finally {
    await unlink(tempPath).catch(() => {});
  }

  console.log('Rotated creator, referrer, and claimant only in .env.local. No private keys were printed or backed up.');
  for (const [role] of keys) console.log(`${role}: ${wallets[role].publicKey.toBase58()}`);
  console.log('Other signer env values and .secrets files were NOT changed. Keep signing workers stopped until those credentials and on-chain authority are separately checked.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch(() => {
    console.error('Rotation failed; no wallet secret was printed. Inspect the Devnet profile and file permissions locally.');
    process.exitCode = 1;
  });
}
