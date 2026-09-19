import { Keypair, SystemProgram, Transaction } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, MINT_SIZE, TOKEN_PROGRAM_ID, createAssociatedTokenAccountInstruction, createInitializeMintInstruction, createMintToInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';

export function normalizeLaunchInput({ name, symbol, supply, decimals }) {
  const normalized = { name: String(name || '').trim(), symbol: String(symbol || '').trim().toUpperCase(), supply: Number(supply), decimals: Number(decimals) };
  if (!normalized.name || normalized.name.length > 32) throw new Error('Token name must be 1–32 characters.');
  if (!/^[A-Z0-9]{1,10}$/.test(normalized.symbol)) throw new Error('Ticker must contain 1–10 letters or numbers.');
  if (!Number.isSafeInteger(normalized.supply) || normalized.supply < 1) throw new Error('Initial supply must be a positive whole number.');
  if (!Number.isInteger(normalized.decimals) || normalized.decimals < 0 || normalized.decimals > 9) throw new Error('Decimals must be an integer from 0 to 9.');
  return normalized;
}

export async function buildLaunchTransaction({ connection, payer, supply, decimals }) {
  const mint = Keypair.generate();
  const ata = getAssociatedTokenAddressSync(mint.publicKey, payer, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const rent = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
  const amount = BigInt(supply) * (10n ** BigInt(decimals));
  const transaction = new Transaction().add(
    SystemProgram.createAccount({ fromPubkey: payer, newAccountPubkey: mint.publicKey, space: MINT_SIZE, lamports: rent, programId: TOKEN_PROGRAM_ID }),
    createInitializeMintInstruction(mint.publicKey, decimals, payer, payer, TOKEN_PROGRAM_ID),
    createAssociatedTokenAccountInstruction(payer, ata, payer, mint.publicKey, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID),
    createMintToInstruction(mint.publicKey, ata, payer, amount, [], TOKEN_PROGRAM_ID),
  );
  return { transaction, mint, ata, amount, rent };
}

export function devnetExplorer(path) { return `https://explorer.solana.com/${path}?cluster=devnet`; }
