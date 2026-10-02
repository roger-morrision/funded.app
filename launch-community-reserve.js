import { PublicKey } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { getBuySolAmountFromTokenAmount, OnlinePumpSdk } from '@pump-fun/pump-sdk';
import BN from 'bn.js';

const VAULT_SEED = new TextEncoder().encode('reward-vault-v1');

export function launchReserveAddresses({ mint, payer, programId, authority }) {
  const mintKey = new PublicKey(mint), payerKey = new PublicKey(payer);
  const authorityKey = new PublicKey(authority), program = new PublicKey(programId);
  const [vault] = PublicKey.findProgramAddressSync([VAULT_SEED, authorityKey.toBytes(), mintKey.toBytes()], program);
  return { vault,
    source:getAssociatedTokenAddressSync(mintKey, payerKey, false, TOKEN_2022_PROGRAM_ID),
    destination:getAssociatedTokenAddressSync(mintKey, vault, true, TOKEN_2022_PROGRAM_ID) };
}

export function launchReserveInstructions({ mint, payer, programId, authority, reserveTokens, decimals }) {
  if (!Number.isSafeInteger(reserveTokens) || reserveTokens <= 0 || !Number.isInteger(decimals) || decimals < 0 || decimals > 9)
    throw new Error('A positive, exact community reserve amount is required before launch.');
  const mintKey = new PublicKey(mint), payerKey = new PublicKey(payer);
  const { vault, source, destination } = launchReserveAddresses({ mint:mintKey, payer:payerKey, programId, authority });
  const amount = BigInt(reserveTokens) * 10n ** BigInt(decimals);
  return { vault, source, destination, amount, instructions:[
    createAssociatedTokenAccountIdempotentInstruction(payerKey, destination, vault, mintKey, TOKEN_2022_PROGRAM_ID),
    createTransferCheckedInstruction(source, mintKey, destination, payerKey, amount, decimals, [], TOKEN_2022_PROGRAM_ID),
  ] };
}

export async function quoteAtomicReserveBuy({ connection, supply, decimals, reserveTokens, developerBaseUnits = 0n }) {
  if (!Number.isSafeInteger(supply) || !Number.isSafeInteger(reserveTokens) || reserveTokens <= 0 || reserveTokens >= supply
    || !Number.isInteger(decimals) || decimals < 0 || decimals > 9) throw new Error('Community reserve exceeds the launch supply.');
  const reserveBaseUnits = BigInt(reserveTokens) * 10n ** BigInt(decimals);
  const developer = BigInt(developerBaseUnits);
  const amountBaseUnits = reserveBaseUnits + developer;
  if (developer < 0n || amountBaseUnits >= BigInt(supply) * 10n ** BigInt(decimals)) throw new Error('Reserve and developer buy exceed launch supply.');
  const global = await new OnlinePumpSdk(connection).fetchGlobal();
  const quoted = BigInt(getBuySolAmountFromTokenAmount({ global, feeConfig:null, mintSupply:null, bondingCurve:null,
    amount:new BN(amountBaseUnits.toString()), quoteMint:NATIVE_MINT }).toString());
  if (quoted <= 0n) throw new Error('The reserve purchase has no valid Pump quote.');
  return { reserveBaseUnits, developerBaseUnits:developer, amountBaseUnits,
    amountTokens:Number(amountBaseUnits / 10n ** BigInt(decimals)), solAmountLamports:quoted,
    maxSolAmountLamports:quoted + (quoted + 99n) / 100n, global };
}
