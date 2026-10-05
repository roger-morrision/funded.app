import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { PUMP_PROGRAM_ID, PUMP_SDK, pumpIdl } from '@pump-fun/pump-sdk';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, decodeBurnCheckedInstruction, unpackMint } from '@solana/spl-token';
import bs58 from 'bs58';
import { createLaunchBurnTiers, tokensToBaseUnits } from '../launch-burn-policy.js';

const createDiscriminator = Buffer.from(pumpIdl.events.find(event => event.name === 'CreateEvent').discriminator);
const pumpProgram = PUMP_PROGRAM_ID.toBase58();
function transactionKeys(transaction) {
  const message = transaction.transaction.message;
  return [...(message.accountKeys || message.staticAccountKeys || []), ...(transaction.meta?.loadedAddresses?.writable || []), ...(transaction.meta?.loadedAddresses?.readonly || [])]
    .map(key => new PublicKey(key.pubkey || key));
}

export function readPumpCreateEvent(logs = []) {
  const stack = [];
  for (const line of logs) {
    const invoked = line.match(/^Program ([A-Za-z0-9]+) invoke \[(\d+)\]/);
    if (invoked) { stack[Number(invoked[2]) - 1] = invoked[1]; stack.length = Number(invoked[2]); continue; }
    if (/^Program [A-Za-z0-9]+ (?:success|failed)/.test(line)) { stack.pop(); continue; }
    if (!line.startsWith('Program data: ') || stack.at(-1) !== pumpProgram) continue;
    const bytes = Buffer.from(line.slice('Program data: '.length), 'base64');
    if (!bytes.subarray(0, 8).equals(createDiscriminator)) continue;
    try { return PUMP_SDK.decodeCreateEventBc(bytes.subarray(8)); } catch { return null; }
  }
  return null;
}

export function verifyAtomicLaunchPromotion({ transaction, payer, signature, claim, fundedMint, tiers = createLaunchBurnTiers(), quote = null }) {
  if (!claim || claim.tier === 'standard') return null;
  const tier = tiers.find(item => item.id === claim.tier && item.amountTokens > 0);
  const requiredAmount = quote ? quote.amountTokens : tier?.amountTokens;
  if (!tier || !fundedMint || claim.fundedMint !== fundedMint || claim.amountTokens !== requiredAmount
    || (quote && (claim.quoteId !== quote.id || quote.tier !== claim.tier || quote.payer !== payer
      || quote.fundedMint !== fundedMint || quote.usd !== (claim.tier === 'pro' ? 100 : claim.tier === 'premier' ? 200 : null)))) {
    throw new Error('The claimed promotion package does not match the configured $FUNDED burn policy.');
  }
  if (quote) {
    const blockTime = Number(transaction.blockTime) * 1000;
    if (!Number.isFinite(blockTime) || blockTime < Date.parse(quote.createdAt) - 30_000
      || blockTime > Date.parse(quote.expiresAt) + 30_000)
      throw new Error('The $FUNDED launch quote was not current when the burn confirmed.');
  }
  const keys = transactionKeys(transaction);
  const instruction = (transaction.transaction.message.instructions || transaction.transaction.message.compiledInstructions || []).find(compiled => {
    if (!keys[compiled.programIdIndex]?.equals(TOKEN_PROGRAM_ID)) return false;
    try {
      const accountIndexes = compiled.accounts || compiled.accountKeyIndexes;
      const data = typeof compiled.data === 'string' ? bs58.decode(compiled.data) : compiled.data;
      const decoded = decodeBurnCheckedInstruction(new TransactionInstruction({
        programId: TOKEN_PROGRAM_ID,
        keys: accountIndexes.map(index => ({ pubkey: keys[index], isSigner: keys[index]?.toBase58() === payer, isWritable: true })),
        data,
      }));
      return decoded.keys.mint.pubkey.toBase58() === fundedMint
        && decoded.keys.owner.pubkey.toBase58() === payer
        && decoded.data.amount === tokensToBaseUnits(requiredAmount, decoded.data.decimals);
    } catch { return false; }
  });
  if (!instruction) throw new Error('The Pump creation transaction has no matching atomic $FUNDED BurnChecked instruction.');
  return {
    tier: tier.id, label: tier.label, amountTokens: requiredAmount, fundedMint,
    status: 'verified', receipt: { signature, instruction: 'BurnChecked', atomicWithPumpLaunch: true, verified: true },
  };
}

export async function verifyPumpLaunch({ connection, mint, signature, promotionClaim = null, promotionQuote = null, fundedMint = null, promotionTiers, commitment = 'confirmed' }) {
  if (!['confirmed', 'finalized'].includes(commitment)) throw new Error('Unsupported launch verification commitment.');
  const mintKey = new PublicKey(String(mint || '').trim());
  if (!signature || typeof signature !== 'string') throw new Error('A Pump creation transaction signature is required.');
  const transaction = await connection.getTransaction(signature, { commitment, maxSupportedTransactionVersion: 0 });
  if (!transaction || transaction.meta?.err) throw new Error(`The Pump creation transaction is not ${commitment}.`);
  const event = readPumpCreateEvent(transaction.meta?.logMessages);
  if (!event || !event.mint.equals(mintKey)) throw new Error('The transaction has no matching Pump creation event.');
  const account = await connection.getAccountInfo(mintKey, commitment);
  if (!account || (!account.owner.equals(TOKEN_PROGRAM_ID) && !account.owner.equals(TOKEN_2022_PROGRAM_ID))) throw new Error('The mint account is not owned by a supported token program.');
  unpackMint(mintKey, account, account.owner);
  const payer = (transaction.transaction.message.accountKeys || transaction.transaction.message.staticAccountKeys)[0].toBase58();
  const promotion = verifyAtomicLaunchPromotion({ transaction, payer, signature, claim: promotionClaim, fundedMint, tiers: promotionTiers, quote: promotionQuote });
  return {
    chain: 'solana', mint: mintKey.toBase58(), signature,
    feePayer:payer,
    name: event.name, symbol: event.symbol, uri: event.uri || null, creator: event.creator.toBase58(),
    createdTimestamp: Number(event.timestamp.toString()), blockTime: transaction.blockTime ?? null,
    tokenProgram: account.owner.toBase58(),
    source: 'pump-onchain-create-event', onchainVerified: true,
    onchainVerifiedAt: new Date().toISOString(),
    ...(promotion ? { creatorLaunchBurn: promotion } : {}),
  };
}
