import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { PUMP_PROGRAM_ID, PUMP_SDK, pumpIdl } from '@pump-fun/pump-sdk';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, decodeBurnCheckedInstruction, unpackMint } from '@solana/spl-token';
import bs58 from 'bs58';
import { createLaunchBurnTiers, tokensToBaseUnits } from '../launch-burn-policy.js';

const createDiscriminator = Buffer.from(pumpIdl.events.find(event => event.name === 'CreateEvent').discriminator);
const pumpProgram = PUMP_PROGRAM_ID.toBase58();

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

export function verifyAtomicLaunchPromotion({ transaction, payer, signature, claim, fundedMint, tiers = createLaunchBurnTiers() }) {
  if (!claim || claim.tier === 'standard') return null;
  const tier = tiers.find(item => item.id === claim.tier && item.amountTokens > 0);
  if (!tier || !fundedMint || claim.fundedMint !== fundedMint || claim.amountTokens !== tier.amountTokens) {
    throw new Error('The claimed promotion package does not match the configured $FUNDED burn policy.');
  }
  const keys = transaction.transaction.message.accountKeys;
  const instruction = transaction.transaction.message.instructions.find(compiled => {
    if (!keys[compiled.programIdIndex]?.equals(TOKEN_PROGRAM_ID)) return false;
    try {
      const decoded = decodeBurnCheckedInstruction(new TransactionInstruction({
        programId: TOKEN_PROGRAM_ID,
        keys: compiled.accounts.map(index => ({ pubkey: keys[index], isSigner: keys[index]?.toBase58() === payer, isWritable: true })),
        data: bs58.decode(compiled.data),
      }));
      return decoded.keys.mint.pubkey.toBase58() === fundedMint
        && decoded.keys.owner.pubkey.toBase58() === payer
        && decoded.data.amount === tokensToBaseUnits(tier.amountTokens, decoded.data.decimals);
    } catch { return false; }
  });
  if (!instruction) throw new Error('The Pump creation transaction has no matching atomic $FUNDED BurnChecked instruction.');
  return {
    tier: tier.id, label: tier.label, amountTokens: tier.amountTokens, fundedMint,
    status: 'verified', receipt: { signature, instruction: 'BurnChecked', atomicWithPumpLaunch: true, verified: true },
  };
}

export async function verifyPumpLaunch({ connection, mint, signature, promotionClaim = null, fundedMint = null, promotionTiers }) {
  const mintKey = new PublicKey(String(mint || '').trim());
  if (!signature || typeof signature !== 'string') throw new Error('A Pump creation transaction signature is required.');
  const transaction = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
  if (!transaction || transaction.meta?.err) throw new Error('The Pump creation transaction is not confirmed.');
  const event = readPumpCreateEvent(transaction.meta?.logMessages);
  if (!event || !event.mint.equals(mintKey)) throw new Error('The transaction has no matching Pump creation event.');
  const account = await connection.getAccountInfo(mintKey, 'confirmed');
  if (!account || (!account.owner.equals(TOKEN_PROGRAM_ID) && !account.owner.equals(TOKEN_2022_PROGRAM_ID))) throw new Error('The mint account is not owned by a supported token program.');
  unpackMint(mintKey, account, account.owner);
  const promotion = verifyAtomicLaunchPromotion({ transaction, payer: transaction.transaction.message.accountKeys[0].toBase58(), signature, claim: promotionClaim, fundedMint, tiers: promotionTiers });
  return {
    chain: 'solana', mint: mintKey.toBase58(), signature,
    feePayer: transaction.transaction.message.accountKeys[0].toBase58(),
    name: event.name, symbol: event.symbol, uri: event.uri || null, creator: event.creator.toBase58(),
    createdTimestamp: Number(event.timestamp.toString()),
    tokenProgram: account.owner.toBase58(),
    source: 'pump-onchain-create-event', onchainVerified: true,
    onchainVerifiedAt: new Date().toISOString(),
    ...(promotion ? { creatorLaunchBurn: promotion } : {}),
  };
}
