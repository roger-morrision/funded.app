import assert from 'node:assert/strict';
import { Connection, Keypair, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { getAccount, getAssociatedTokenAddressSync, getMint } from '@solana/spl-token';
import bs58 from 'bs58';
import { submitPumpDevnetLaunch } from '../launch-flow.js';

const amounts = { boost: 25_000, pro: 100_000, premier: 250_000 };
const tier = String(process.argv[2] || '').toLowerCase();
if (!(tier in amounts)) throw new Error('Pass one tier: boost, pro, or premier. This creates a Devnet coin and burns $FUNDED.');
if (process.env.VITE_SOLANA_CLUSTER !== 'devnet' || process.env.VITE_ALLOW_MAINNET !== 'false') {
  throw new Error('Devnet-only .env.local profile required.');
}

const payer = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_DEVNET_CREATOR_SECRET_KEY));
const fundedMint = new PublicKey(process.env.VITE_FUNDED_TOKEN_MINT);
const routerProgram = new PublicKey(process.env.VITE_FUNDED_FEE_ROUTER_PROGRAM_ID);
const [feeRouter] = PublicKey.findProgramAddressSync([Buffer.from('funded-fee-router-v1')], routerProgram);
const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
const fundedTokenAccount = getAssociatedTokenAddressSync(fundedMint, payer.publicKey);
const [mintBefore, accountBefore] = await Promise.all([
  getMint(connection, fundedMint),
  getAccount(connection, fundedTokenAccount),
]);
const amountBaseUnits = BigInt(amounts[tier]) * 10n ** BigInt(mintBefore.decimals);
assert(accountBefore.amount >= amountBaseUnits, 'Creator wallet lacks $FUNDED for the selected tier');

const result = await submitPumpDevnetLaunch({
  connection,
  provider: { signTransaction: async transaction => { transaction.partialSign(payer); return transaction; } },
  payer: payer.publicKey,
  input: { name: `Funded ${tier} burn test`, symbol: `F${tier.slice(0, 3).toUpperCase()}`, supply: 1_000_000_000, decimals: 6 },
  feeRouterAddress: feeRouter.toBase58(),
  launchBurn: { tier, amountTokens: amounts[tier], fundedMint: fundedMint.toBase58() },
  onStatus: message => console.log(message),
});

const [mintAfter, accountAfter] = await Promise.all([
  getMint(connection, fundedMint),
  getAccount(connection, fundedTokenAccount),
]);
assert.equal(mintBefore.supply - mintAfter.supply, amountBaseUnits, 'Mint supply did not decrease by the selected burn amount');
assert.equal(accountBefore.amount - accountAfter.amount, amountBaseUnits, 'Creator token balance did not decrease by the selected burn amount');
assert.equal(result.launchBurnReceipt?.instruction, 'BurnChecked');
assert.equal(result.launchBurnReceipt?.verified, true);
assert.equal(result.feeRoute.verified, true);
assert.equal(result.feeRoute.creator, feeRouter.toBase58());

console.log(JSON.stringify({
  tier,
  amountBurned: amounts[tier],
  fundedMint: fundedMint.toBase58(),
  supplyBefore: mintBefore.supply.toString(),
  supplyAfter: mintAfter.supply.toString(),
  coinMint: result.mint.publicKey.toBase58(),
  creator: result.feeRoute.creator,
  transaction: `https://explorer.solana.com/tx/${result.signature}?cluster=devnet`,
}));
