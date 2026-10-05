import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import { PUMP_AMM_PROGRAM_ID, PUMP_PROGRAM_ID } from '@pump-fun/pump-sdk';
import { verifyPumpLaunch } from './launch-verification.mjs';
import { eligibleJackpotEntries } from './jackpot-model.mjs';

const pumpProgram = PUMP_PROGRAM_ID.toBase58();
const pumpAmmProgram = PUMP_AMM_PROGRAM_ID.toBase58();
const discriminator = name => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8).toString('hex');
const tradeInstructions = new Map([
  [pumpProgram, new Set(['buy', 'buy_exact_quote_in_v2', 'buy_exact_sol_in', 'buy_v2', 'sell', 'sell_v2'].map(discriminator))],
  [pumpAmmProgram, new Set(['buy', 'buy_exact_quote_in', 'sell'].map(discriminator))],
]);
const address = key => typeof key === 'string' ? key : key?.toBase58?.() || key?.pubkey?.toBase58?.() || String(key?.pubkey || '');

function assertWindow(window, blockTime) {
  if (!Number.isSafeInteger(blockTime) || !window || blockTime < window.start || blockTime >= window.end)
    throw new Error('Finalized jackpot entry is outside its round.');
}

export async function verifyJackpotCreatorEntry({ connection, expectedGenesisHash, appLaunch, window }) {
  if (!connection || !expectedGenesisHash || await connection.getGenesisHash() !== expectedGenesisHash)
    throw new Error('Trusted test network RPC is required.');
  if (!appLaunch || appLaunch.cluster !== 'devnet' || appLaunch.onchainVerified !== true
    || appLaunch.pumpFeeRoute?.scope !== 'per-mint-v2' || !appLaunch.mint
    || !appLaunch.creatorWallet || !appLaunch.signature)
    throw new Error('A registered funded.vip launch is required.');
  const proof = await verifyPumpLaunch({ connection, mint:appLaunch.mint,
    signature:appLaunch.signature, commitment:'finalized' });
  if (proof.feePayer !== appLaunch.creatorWallet || proof.creator !== appLaunch.creator)
    throw new Error('Finalized launch does not match the registered creator and router.');
  assertWindow(window, proof.blockTime);
  const row = { cluster:'devnet', finalized:true, onchainVerified:true,
    creatorWallet:proof.feePayer, mint:proof.mint, signature:proof.signature,
    blockTime:proof.blockTime };
  if (eligibleJackpotEntries('creator', [row], window).length !== 1)
    throw new Error('Finalized launch is not eligible.');
  return row;
}

export async function verifyJackpotTraderEntry({ connection, expectedGenesisHash,
  signature, feeOwner, window }) {
  if (!connection || !expectedGenesisHash || await connection.getGenesisHash() !== expectedGenesisHash)
    throw new Error('Trusted test network RPC is required.');
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(feeOwner || ''))
    || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(String(signature || '')))
    throw new Error('Trade signature and configured fee owner are required.');
  const tx = await connection.getParsedTransaction(signature,
    { commitment:'finalized', maxSupportedTransactionVersion:0 });
  if (!tx || tx.meta?.err || !Array.isArray(tx.transaction?.message?.accountKeys)
    || !Array.isArray(tx.transaction?.message?.instructions))
    throw new Error('A successful finalized trade transaction is required.');
  assertWindow(window, tx.blockTime);
  const instructions = tx.transaction.message.instructions;
  const fees = instructions.filter(row => row.program === 'system' && row.parsed?.type === 'transfer'
    && row.parsed?.info?.destination === feeOwner);
  if (fees.length !== 1 || !Number.isSafeInteger(fees[0].parsed.info.lamports)
    || fees[0].parsed.info.lamports <= 0)
    throw new Error('Exactly one positive app fee transfer is required.');
  const traderWallet = fees[0].parsed.info.source;
  if (!tx.transaction.message.accountKeys.some(row => address(row) === traderWallet && row.signer === true))
    throw new Error('The app fee payer did not sign the trade.');
  const hasTrade = instructions.some(row => {
    const program = address(row.programId);
    const allowed = tradeInstructions.get(program);
    if (!allowed || !Array.isArray(row.accounts)
      || !row.accounts.some(account => address(account) === traderWallet)) return false;
    try { return allowed.has(Buffer.from(bs58.decode(row.data)).subarray(0, 8).toString('hex')); }
    catch { return false; }
  });
  if (!hasTrade) throw new Error('The fee transfer has no matching Pump buy or sell instruction.');
  const receipt = { cluster:'devnet', finalized:true, onchainVerified:true,
    feeTransferVerified:true, traderWallet, signature,
    feeLamports:String(fees[0].parsed.info.lamports), blockTime:tx.blockTime };
  if (eligibleJackpotEntries('trader', [receipt], window).length !== 1)
    throw new Error('Finalized trade is not eligible.');
  return receipt;
}
