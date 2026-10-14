import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Keypair } from '@solana/web3.js';

const path = resolve('.secrets/devnet-admin-qa-keypair.json');
let keypair;
try {
  keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(path, 'utf8'))));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  keypair = Keypair.generate();
  await mkdir(resolve('.secrets'), { recursive:true });
  await writeFile(path, `${JSON.stringify([...keypair.secretKey])}\n`, { flag:'wx', mode:0o600 });
}
console.log(`Devnet QA admin public address: ${keypair.publicKey.toBase58()}`);
console.log('Private key saved in the ignored .secrets/devnet-admin-qa-keypair.json file.');
