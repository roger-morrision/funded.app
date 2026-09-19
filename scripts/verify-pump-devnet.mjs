import assert from 'node:assert/strict';
import { Connection, Keypair, Transaction, clusterApiUrl } from '@solana/web3.js';
import { OnlinePumpSdk, PUMP_SDK } from '@pump-fun/pump-sdk';

const devnetRpcUrl = clusterApiUrl('devnet');
const connection = new Connection(devnetRpcUrl, 'confirmed');

async function requestAirdropOnce(publicKey, lamports) {
  const response = await fetch(devnetRpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'requestAirdrop', params: [publicKey.toBase58(), lamports] }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) throw new Error(payload.error?.message || `Devnet faucet request failed (${response.status}).`);
  return payload.result;
}
const payer = Keypair.generate();
const mint = Keypair.generate();
const name = `Funded Pump ${Date.now().toString(36).slice(-6)}`;
const symbol = 'FDPUMP';
console.log(`temporary devnet payer: ${payer.publicKey.toBase58()}`);

let airdrop;
try {
  airdrop = await requestAirdropOnce(payer.publicKey, 1_000_000_000);
  await connection.confirmTransaction(airdrop, 'confirmed');
} catch (error) {
  if (String(error?.message || error).includes('429')) {
    console.error('Devnet faucet quota is exhausted. Fund a temporary payer and rerun npm run verify:pump-devnet.');
    process.exit(2);
  }
  throw error;
}

const instruction = await PUMP_SDK.createV2Instruction({
  mint: mint.publicKey,
  name,
  symbol,
    uri: `https://funded.vip/devnet-metadata/${mint.publicKey.toBase58()}`,
  creator: payer.publicKey,
  user: payer.publicKey,
  mayhemMode: false,
  holderReward: false,
});
const transaction = new Transaction().add(instruction);
const latest = await connection.getLatestBlockhash('confirmed');
transaction.recentBlockhash = latest.blockhash;
transaction.feePayer = payer.publicKey;
transaction.partialSign(mint, payer);
const signature = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: false });
await connection.confirmTransaction({ signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, 'confirmed');

const sdk = new OnlinePumpSdk(connection);
const curve = await sdk.fetchBondingCurve(mint.publicKey);
assert.ok(curve, 'Pump bonding curve was not readable after confirmation');
assert.equal(curve.creator.toBase58(), payer.publicKey.toBase58());
console.log(`pump devnet mint: ${mint.publicKey.toBase58()}`);
console.log(`pump devnet tx: https://explorer.solana.com/tx/${signature}?cluster=devnet`);
console.log(`pump curve creator verified: ${curve.creator.toBase58()}`);
console.log('pump devnet launch verification passed');
