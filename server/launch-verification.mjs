import { PublicKey } from '@solana/web3.js';
import { PUMP_PROGRAM_ID, PUMP_SDK, pumpIdl } from '@pump-fun/pump-sdk';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, unpackMint } from '@solana/spl-token';

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

export async function verifyPumpLaunch({ connection, mint, signature }) {
  const mintKey = new PublicKey(String(mint || '').trim());
  if (!signature || typeof signature !== 'string') throw new Error('A Pump creation transaction signature is required.');
  const transaction = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
  if (!transaction || transaction.meta?.err) throw new Error('The Pump creation transaction is not confirmed.');
  const event = readPumpCreateEvent(transaction.meta?.logMessages);
  if (!event || !event.mint.equals(mintKey)) throw new Error('The transaction has no matching Pump creation event.');
  const account = await connection.getAccountInfo(mintKey, 'confirmed');
  if (!account || (!account.owner.equals(TOKEN_PROGRAM_ID) && !account.owner.equals(TOKEN_2022_PROGRAM_ID))) throw new Error('The mint account is not owned by a supported token program.');
  unpackMint(mintKey, account, account.owner);
  return {
    chain: 'solana', mint: mintKey.toBase58(), signature,
    feePayer: transaction.transaction.message.accountKeys[0].toBase58(),
    name: event.name, symbol: event.symbol, creator: event.creator.toBase58(),
    createdTimestamp: Number(event.timestamp.toString()),
    tokenProgram: account.owner.toBase58(),
    source: 'pump-onchain-create-event', onchainVerified: true,
    onchainVerifiedAt: new Date().toISOString(),
  };
}
