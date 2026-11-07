import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

const decode = row => new TransactionInstruction({ programId:new PublicKey(row.programId),
  keys:row.accounts.map(key => ({pubkey:new PublicKey(key.pubkey), isSigner:key.isSigner, isWritable:key.isWritable})),
  data:Buffer.from(row.data, 'base64') });
const same = (a, b) => a.programId.equals(b.programId) && a.data.equals(b.data) && a.keys.length === b.keys.length
  && a.keys.every((key, i) => key.pubkey.equals(b.keys[i].pubkey)
    && key.isSigner === b.keys[i].isSigner && key.isWritable === b.keys[i].isWritable);

// The API may request only canonical, authority-paid ATA setup before the
// reviewed router instruction. Never sign arbitrary setup instructions.
export function communityOpeningInstructions({prepared, programId, authority, mint, drop}) {
  programId = new PublicKey(programId); authority = new PublicKey(authority);
  mint = new PublicKey(mint); drop = new PublicKey(drop);
  if (prepared.drop !== drop.toBase58() || prepared.programId !== programId.toBase58())
    throw new Error('Opening instruction differs from prepared drop.');
  const opening = decode(prepared), keys = opening.keys;
  if (keys.filter(key => key.isSigner).length !== 1 || !keys[0]?.isSigner || !keys[0].pubkey.equals(authority))
    throw new Error('Opening instruction requested an unexpected signer.');
  if (!keys[3]?.pubkey.equals(mint) || !keys[8]?.pubkey.equals(drop))
    throw new Error('Opening instruction has different mint or drop accounts.');
  const tokenProgram = keys[12]?.pubkey;
  if (!tokenProgram || ![TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].some(key => key.equals(tokenProgram)))
    throw new Error('Unsupported community token program.');
  const destination = getAssociatedTokenAddressSync(mint, drop, true, tokenProgram);
  if (!keys[10]?.pubkey.equals(destination)) throw new Error('Opening vault is not canonical.');
  const rows = prepared.instructions ?? [prepared];
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 2)
    throw new Error('Unexpected community opening instruction count.');
  const instructions = rows.map(decode);
  if (!same(instructions.at(-1), opening)) throw new Error('Opening instruction differs from the reviewed response.');
  if (instructions.length === 2) {
    const setup = createAssociatedTokenAccountIdempotentInstruction(authority, destination, drop, mint, tokenProgram);
    if (!same(instructions[0], setup)) throw new Error('Community account setup differs from the canonical instruction.');
  }
  return instructions;
}
