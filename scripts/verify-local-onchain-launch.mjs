import assert from 'node:assert/strict';
import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAccount, getMint } from '@solana/spl-token';
import { submitLaunch } from '../launch-flow.js';

const rpcUrl = new URL(process.env.FUNDED_LOCAL_VALIDATOR_RPC_URL || 'http://127.0.0.1:18899');
if (rpcUrl.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(rpcUrl.hostname)) {
  throw new Error('Local on-chain verification requires a loopback HTTP validator.');
}
const connection = new Connection(rpcUrl.toString(), 'confirmed');
const payer = Keypair.generate();
const airdrop = await connection.requestAirdrop(payer.publicKey, LAMPORTS_PER_SOL);
const funded = await connection.confirmTransaction(airdrop, 'confirmed');
assert.equal(funded.value.err, null, 'Local validator funding failed');
assert.ok(await connection.getBalance(payer.publicKey, 'confirmed') >= LAMPORTS_PER_SOL);

const result = await submitLaunch({
  connection,
  provider: { signTransaction: async transaction => { transaction.partialSign(payer); return transaction; } },
  payer: payer.publicKey,
  input: { name: 'Funded Local QA', symbol: 'FQA', supply: 1234, decimals: 6 },
});
const [mint, account] = await Promise.all([
  getMint(connection, result.mint.publicKey, 'confirmed'),
  getAccount(connection, result.ata, 'confirmed'),
]);
assert.equal(mint.supply, result.amount);
assert.equal(account.amount, result.amount);
assert.ok(account.owner.equals(payer.publicKey));
assert.ok(account.mint.equals(result.mint.publicKey));
console.log(`Local validator launch confirmed: ${result.signature}`);
console.log(`Mint and owner balance verified: ${result.mint.publicKey.toBase58()}`);
