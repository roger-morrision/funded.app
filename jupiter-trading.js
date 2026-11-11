import { PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction, AddressLookupTableAccount } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Buffer } from 'buffer';
import bs58 from 'bs58';
import { apiRequest } from './client.js';
import { waitForSignatureConfirmation } from './funded-burn.js';

// Mainnet swaps for any token through Jupiter routing. The server only relays
// Jupiter's public instructions, lookup tables and a blockhash; this module
// checks every instruction's program, appends Richpad's SOL fee transfer itself
// and asks the wallet to sign the exact message it built.
export const JUPITER_PROGRAM_ID = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111';
const ALLOWED = new Set([JUPITER_PROGRAM_ID, COMPUTE_BUDGET, ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(), TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58(), SystemProgram.programId.toBase58()]);
const REBUILD_AFTER_MS = 20_000;
// Wallet guard program Phantom appends (assertion-only instructions).
const LIGHTHOUSE = 'L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95';
const MAX_COMPUTE_UNITS = 1_400_000n;
const MAX_PRIORITY_FEE_LAMPORTS = 5_000_000n;

const sameInstruction = (a, b) => a.programId.equals(b.programId) && Buffer.from(a.data).equals(Buffer.from(b.data))
  && a.keys.length === b.keys.length && a.keys.every((key, index) => key.pubkey.equals(b.keys[index].pubkey));

// Wallets may re-sign a modified message (Phantom adds Lighthouse guard
// assertions and can reset compute-budget prices). Accept only that: same fee
// payer and blockhash, every reviewed non-compute-budget instruction in order,
// extra instructions limited to Lighthouse assertions and bounded compute budget.
export function verifyWalletSwapMessage({ reviewedBytes, signedMessage, instructions, lookupTables, user, blockhash }) {
  if (Buffer.from(signedMessage.serialize()).equals(reviewedBytes)) return { modified: false };
  let decoded;
  try { decoded = TransactionMessage.decompile(signedMessage, { addressLookupTableAccounts: lookupTables }); }
  catch { throw Error('Wallet changed the reviewed swap in a way that cannot be checked. Nothing was submitted.'); }
  if (!decoded.payerKey.equals(user) || decoded.recentBlockhash !== blockhash) throw Error('Wallet changed the fee payer or blockhash of the reviewed swap. Nothing was submitted.');
  const expected = instructions.filter(ix => ix.programId.toBase58() !== COMPUTE_BUDGET);
  const reviewedBudget = instructions.filter(ix => ix.programId.toBase58() === COMPUTE_BUDGET);
  let cursor = 0, units = MAX_COMPUTE_UNITS, microLamports = 0n;
  for (const ix of decoded.instructions) {
    const program = ix.programId.toBase58();
    if (cursor < expected.length && sameInstruction(ix, expected[cursor])) { cursor++; continue; }
    if (program === COMPUTE_BUDGET && !ix.keys.length) {
      const data = Buffer.from(ix.data);
      if (reviewedBudget.some(item => sameInstruction(item, ix)) && ![2, 3].includes(data[0])) continue;
      if (data[0] === 2 && data.length === 5) { units = BigInt(data.readUInt32LE(1)); if (units < 1n || units > MAX_COMPUTE_UNITS) throw Error('Wallet set an unsafe compute limit. Nothing was submitted.'); continue; }
      if (data[0] === 3 && data.length === 9) { microLamports = data.readBigUInt64LE(1); continue; }
      throw Error('Wallet added an unexpected compute-budget instruction. Nothing was submitted.');
    }
    if (program === LIGHTHOUSE && !ix.keys.some(key => key.isSigner && !key.pubkey.equals(user))) continue;
    throw Error('Wallet added an unexpected instruction to the reviewed swap. Nothing was submitted.');
  }
  if (cursor !== expected.length) throw Error('Wallet removed part of the reviewed swap. Nothing was submitted.');
  const priorityFee = (units * microLamports + 999_999n) / 1_000_000n;
  if (priorityFee > MAX_PRIORITY_FEE_LAMPORTS) throw Error('Wallet raised the priority fee above 0.005 SOL. Nothing was submitted.');
  return { modified: true, priorityFeeLamports: Number(priorityFee) };
}

function toInstruction(raw, user) {
  if (!raw?.programId || !Array.isArray(raw.accounts) || typeof raw.data !== 'string') throw Error('The swap route returned an invalid instruction.');
  if (!ALLOWED.has(raw.programId)) throw Error('The swap route uses an unexpected program. Nothing was signed.');
  const instruction = new TransactionInstruction({ programId: new PublicKey(raw.programId), data: Buffer.from(raw.data, 'base64'),
    keys: raw.accounts.map(account => ({ pubkey: new PublicKey(account.pubkey), isSigner: Boolean(account.isSigner), isWritable: Boolean(account.isWritable) })) });
  // System instructions may only fund the wallet's own wrapped-SOL account.
  if (raw.programId === SystemProgram.programId.toBase58()) {
    const wsol = getAssociatedTokenAddressSync(NATIVE_MINT, user, true).toBase58();
    const transfer = instruction.data.length >= 4 && instruction.data.readUInt32LE(0) === 2;
    if (!transfer || instruction.keys[0]?.pubkey.toBase58() !== user.toBase58() || instruction.keys[1]?.pubkey.toBase58() !== wsol)
      throw Error('The swap route moves SOL to an unexpected account. Nothing was signed.');
  }
  if (instruction.keys.some(key => key.isSigner && !key.pubkey.equals(user))) throw Error('The swap route requires another signer. Nothing was signed.');
  return instruction;
}

export async function buildJupiterTrade({ side, mint, user, amount, slippagePercent = 1, feeOwner, feeBps = 100, request = apiRequest }) {
  const mintKey = new PublicKey(String(mint)), userKey = user instanceof PublicKey ? user : new PublicKey(String(user));
  const slippage = Number(slippagePercent), bps = Number(feeBps);
  if (!['buy', 'sell'].includes(side)) throw Error('Trade side must be buy or sell.');
  if (!Number.isFinite(slippage) || slippage < 0.1 || slippage > 10) throw Error('Slippage must be between 0.1% and 10%.');
  if (!feeOwner || !Number.isInteger(bps) || bps < 0 || bps > 500) throw Error('Trading is disabled until the app fee wallet is configured.');
  const feeOwnerKey = new PublicKey(feeOwner);
  const amountText = typeof amount === 'string' ? amount.trim() : Number(amount).toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 9 });
  const response = await request('/api/trade/jupiter/build', { method: 'POST', body: { side, mint: mintKey.toBase58(), user: userKey.toBase58(), amount: amountText, slippageBps: Math.round(slippage * 100) },
    signal: AbortSignal.timeout(20_000) });
  const data = response.data;
  if (!response.available || data?.mint !== mintKey.toBase58() || data.user !== userKey.toBase58() || data.side !== side) throw Error(data?.error || 'Swap quote is unavailable. Try again.');
  const inAmount = BigInt(data.quote.inAmount), outAmount = BigInt(data.quote.outAmount), minimum = BigInt(data.quote.otherAmountThreshold);
  if (inAmount !== BigInt(data.amount) || outAmount <= 0n || minimum <= 0n || minimum > outAmount) throw Error('The swap quote did not match the requested amount.');
  const feeLamports = (side === 'buy' ? inAmount : minimum) * BigInt(bps) / 10_000n;
  const raw = data.instructions;
  const instructions = [...raw.computeBudgetInstructions, ...raw.setupInstructions, raw.swapInstruction, ...(raw.cleanupInstruction ? [raw.cleanupInstruction] : []), ...raw.otherInstructions]
    .map(item => toInstruction(item, userKey));
  if (!instructions.some(item => item.programId.toBase58() === JUPITER_PROGRAM_ID)) throw Error('The swap route is missing its Jupiter instruction.');
  if (feeLamports > 0n) instructions.push(SystemProgram.transfer({ fromPubkey: userKey, toPubkey: feeOwnerKey, lamports: feeLamports }));
  const lookupTables = data.lookupTables.map(table => new AddressLookupTableAccount({ key: new PublicKey(table.key),
    state: { deactivationSlot: BigInt('18446744073709551615'), lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, authority: undefined, addresses: table.addresses.map(key => new PublicKey(key)) } }));
  return { route: 'jupiter', side, mint: mintKey, user: userKey, inputAmount: Number(amount), slippagePercent: slippage, tokenDecimals: data.decimals,
    quoteAmount: side === 'buy' ? inAmount : minimum, outputAmount: outAmount, minimumOutputAmount: minimum, maximumInputAmount: null,
    feeLamports: Number(feeLamports), feePolicy: { enabled: true, feeOwner: feeOwnerKey.toBase58(), feeBps: bps },
    priceImpactPct: Number(data.quote.priceImpactPct) || 0, routes: data.quote.routes || [],
    jupiter: { instructions, lookupTables, blockhash: data.blockhash, lastValidBlockHeight: data.lastValidBlockHeight, builtAt: Date.now() } };
}

export async function submitJupiterTrade({ connection, provider, side, mint, user, amount, slippagePercent = 1, feeOwner, feeBps = 100, preparedTrade = null,
  onStatus = () => {}, onPrepared = () => {}, assertWalletCurrent = () => {} }) {
  if (!provider?.signTransaction) throw Error('Connect a wallet that can sign transactions.');
  if (provider.remoteMobile) throw Error('Open Richpad inside your wallet app or use a browser wallet to trade this token.');
  onStatus('Reading the current swap route…');
  let trade = preparedTrade;
  if (!trade || trade.route !== 'jupiter' || Date.now() - trade.jupiter.builtAt > REBUILD_AFTER_MS)
    trade = await buildJupiterTrade({ side, mint, user, amount, slippagePercent, feeOwner, feeBps });
  const message = new TransactionMessage({ payerKey: trade.user, recentBlockhash: trade.jupiter.blockhash, instructions: trade.jupiter.instructions })
    .compileToV0Message(trade.jupiter.lookupTables);
  const transaction = new VersionedTransaction(message);
  if (transaction.serialize().length > 1232) throw Error('This swap route is too large for one Solana transaction. Try a different amount. Nothing was signed.');
  const reviewed = Buffer.from(message.serialize());
  assertWalletCurrent();
  onStatus('Waiting for wallet approval…');
  const lastValidBlockHeight = trade.jupiter.lastValidBlockHeight;
  // Wallets that can sign and send (Phantom) submit through their own RPC and
  // apply their own guard instructions; every instruction was checked above.
  if (typeof provider.signAndSendTransaction === 'function') {
    const sent = await provider.signAndSendTransaction(transaction, { skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 2 });
    assertWalletCurrent();
    const signature = typeof sent === 'string' ? sent : typeof sent?.signature === 'string' ? sent.signature : sent?.signature ? bs58.encode(sent.signature) : null;
    if (!signature) throw Error('Wallet did not return a swap signature. Check your wallet activity before retrying.');
    await onPrepared({ signature, lastValidBlockHeight, blockhash: trade.jupiter.blockhash });
    onStatus('Confirming swap on Solana…');
    try {
      const confirmation = await waitForSignatureConfirmation(connection, { signature, lastValidBlockHeight, commitment: 'confirmed', pollIntervalMs: 1500 });
      if (!confirmation?.value || confirmation.value.err) throw Error(`Swap did not confirm successfully${confirmation?.value?.err ? `: ${JSON.stringify(confirmation.value.err)}` : '.'}`);
    } catch (error) { error.signature = signature; error.lastValidBlockHeight = lastValidBlockHeight; throw error; }
    return { ...trade, signature, lastValidBlockHeight, confirmedAt: new Date().toISOString() };
  }
  const signed = await provider.signTransaction(transaction);
  assertWalletCurrent();
  const signedTx = signed instanceof VersionedTransaction ? signed : VersionedTransaction.deserialize(signed.serialize());
  verifyWalletSwapMessage({ reviewedBytes: reviewed, signedMessage: signedTx.message, instructions: trade.jupiter.instructions,
    lookupTables: trade.jupiter.lookupTables, user: trade.user, blockhash: trade.jupiter.blockhash });
  const signature = bs58.encode(signedTx.signatures[0]);
  if (!signedTx.signatures[0] || signedTx.signatures[0].every(byte => byte === 0)) throw Error('Wallet did not sign the swap. Nothing was submitted.');
  await onPrepared({ signature, lastValidBlockHeight, blockhash: trade.jupiter.blockhash });
  try {
    onStatus('Wallet signed. Submitting swap to Solana…');
    const returned = await connection.sendRawTransaction(signedTx.serialize(), { skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 2 });
    if (returned !== signature) throw Error('RPC returned a different signature. Check the saved trade before retrying.');
  } catch (error) { error.signature = signature; error.lastValidBlockHeight = lastValidBlockHeight; throw error; }
  onStatus('Confirming swap on Solana…');
  try {
    const confirmation = await waitForSignatureConfirmation(connection, { signature, lastValidBlockHeight, commitment: 'confirmed', pollIntervalMs: 1500 });
    if (!confirmation?.value || confirmation.value.err) throw Error(`Swap did not confirm successfully${confirmation?.value?.err ? `: ${JSON.stringify(confirmation.value.err)}` : '.'}`);
  } catch (error) { error.signature = signature; error.lastValidBlockHeight = lastValidBlockHeight; throw error; }
  return { ...trade, signature, lastValidBlockHeight, confirmedAt: new Date().toISOString() };
}
