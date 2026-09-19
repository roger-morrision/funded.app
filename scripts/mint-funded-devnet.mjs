import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Connection, Keypair, SystemProgram, Transaction, clusterApiUrl, sendAndConfirmTransaction } from '@solana/web3.js';
import {
  AuthorityType,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  createSetAuthorityInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
} from '@solana/spl-token';
import bs58 from 'bs58';

const DECIMALS = 6;
const SUPPLY_TOKENS = 1_000_000_000n;
const SUPPLY_BASE_UNITS = SUPPLY_TOKENS * 10n ** BigInt(DECIMALS);

if (process.env.VITE_SOLANA_CLUSTER !== 'devnet' || process.env.VITE_ALLOW_MAINNET !== 'false') {
  throw new Error('This script requires the Devnet-only .env.local profile.');
}
if (!process.env.SOLANA_DEVNET_CREATOR_SECRET_KEY) {
  throw new Error('SOLANA_DEVNET_CREATOR_SECRET_KEY is required.');
}

const payer = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_DEVNET_CREATOR_SECRET_KEY));
const mintSeed = createHash('sha256')
  .update('funded.app/devnet/funded-mint/v1\0')
  .update(payer.secretKey)
  .digest();
const mint = Keypair.fromSeed(mintSeed);
const configuredMint = String(process.env.VITE_FUNDED_TOKEN_MINT || '').trim();
if (configuredMint && configuredMint !== mint.publicKey.toBase58()) {
  throw new Error('VITE_FUNDED_TOKEN_MINT differs from the mint derived for this Devnet creator wallet.');
}

const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
const tokenAccount = getAssociatedTokenAddressSync(mint.publicKey, payer.publicKey);
const existing = await connection.getAccountInfo(mint.publicKey, 'confirmed');

if (!existing) {
  const mintRent = await connection.getMinimumBalanceForRentExemption(MINT_SIZE, 'confirmed');
  const transaction = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint.publicKey,
      lamports: mintRent,
      space: MINT_SIZE,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(mint.publicKey, DECIMALS, payer.publicKey, null),
    createAssociatedTokenAccountInstruction(payer.publicKey, tokenAccount, payer.publicKey, mint.publicKey),
    createMintToInstruction(mint.publicKey, tokenAccount, payer.publicKey, SUPPLY_BASE_UNITS),
    createSetAuthorityInstruction(mint.publicKey, payer.publicKey, AuthorityType.MintTokens, null),
  );
  console.log(`Creating Devnet $FUNDED mint ${mint.publicKey.toBase58()}...`);
  try {
    const signature = await sendAndConfirmTransaction(connection, transaction, [payer, mint], {
      commitment: 'confirmed',
      skipPreflight: false,
    });
    console.log(`Creation transaction: https://explorer.solana.com/tx/${signature}?cluster=devnet`);
  } catch (error) {
    const afterError = await connection.getAccountInfo(mint.publicKey, 'confirmed').catch(() => null);
    if (!afterError) throw error;
    console.log('Creation response was uncertain; verifying the mint directly on Devnet.');
  }
}

const [mintState, tokenState] = await Promise.all([
  getMint(connection, mint.publicKey, 'confirmed', TOKEN_PROGRAM_ID),
  getAccount(connection, tokenAccount, 'confirmed', TOKEN_PROGRAM_ID),
]);
assert.equal(mintState.decimals, DECIMALS);
assert(mintState.supply <= SUPPLY_BASE_UNITS, 'Current supply exceeds the one-billion-token initial supply');
if (!existing) assert.equal(mintState.supply, SUPPLY_BASE_UNITS);
assert.equal(mintState.mintAuthority, null, 'Mint authority must be revoked after the initial supply');
assert.equal(mintState.freezeAuthority, null, 'Freeze authority must be absent');
assert.equal(tokenState.owner.toBase58(), payer.publicKey.toBase58());
assert.equal(tokenState.mint.toBase58(), mint.publicKey.toBase58());
if (!existing) assert.equal(tokenState.amount, SUPPLY_BASE_UNITS);

console.log(JSON.stringify({
  cluster: 'devnet',
  mint: mint.publicKey.toBase58(),
  owner: payer.publicKey.toBase58(),
  tokenAccount: tokenAccount.toBase58(),
  decimals: DECIMALS,
  initialSupplyTokens: SUPPLY_TOKENS.toString(),
  currentSupplyTokens: (mintState.supply / 10n ** BigInt(DECIMALS)).toString(),
  mintAuthority: null,
  freezeAuthority: null,
  ownerBalanceTokens: (tokenState.amount / 10n ** BigInt(DECIMALS)).toString(),
  explorer: `https://explorer.solana.com/address/${mint.publicKey.toBase58()}?cluster=devnet`,
}));
