import { createHash } from 'node:crypto';
import { PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync } from '@solana/spl-token';
import { communityAddresses } from './community-claim-chain.mjs';

const dropDiscriminator = createHash('sha256').update('account:CommunityDrop').digest().subarray(0, 8);
const closeDiscriminator = createHash('sha256').update('global:close_community_drop').digest().subarray(0, 8);

// CommunityDrop layout (8-byte discriminator first): app_owner 72, mint 104,
// total 312, claimed 320, expires_at 336, leaf_count 344, closed 348.
export function decodeCommunityDrop(data) {
  const bytes = Buffer.from(data || []);
  if (bytes.length < 350 || !bytes.subarray(0, 8).equals(dropDiscriminator)) throw new Error('Account is not a CommunityDrop.');
  return { authority:new PublicKey(bytes.subarray(8, 40)), appOwner:new PublicKey(bytes.subarray(72, 104)),
    mint:new PublicKey(bytes.subarray(104, 136)), totalAmount:bytes.readBigUInt64LE(312),
    claimedAmount:bytes.readBigUInt64LE(320), expiresAt:Number(bytes.readBigInt64LE(336)), closed:bytes[348] === 1 };
}

export function buildCloseCommunityDropTransaction({ programId, caller, drop, decoded, tokenProgram = TOKEN_2022_PROGRAM_ID }) {
  const vault = getAssociatedTokenAddressSync(decoded.mint, drop, true, tokenProgram);
  const remainder = getAssociatedTokenAddressSync(decoded.mint, decoded.appOwner, true, tokenProgram);
  const close = new TransactionInstruction({ programId:new PublicKey(programId), data:Buffer.from(closeDiscriminator), keys:[
    { pubkey:caller, isSigner:true, isWritable:false }, { pubkey:drop, isSigner:false, isWritable:true },
    { pubkey:decoded.mint, isSigner:false, isWritable:false }, { pubkey:vault, isSigner:false, isWritable:true },
    { pubkey:remainder, isSigner:false, isWritable:true }, { pubkey:tokenProgram, isSigner:false, isWritable:false }] });
  return { remainder, transaction:new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(caller, remainder, decoded.appOwner, decoded.mint, tokenProgram), close) };
}

// Close every opened community drop whose claim window has ended. Closing is
// permissionless on-chain; the program sends unclaimed tokens to the app owner.
export async function closeExpiredCommunityDrops({ connection, ledger, programId, authority,
  now = () => Math.floor(Date.now() / 1000), logger = console }) {
  const program = new PublicKey(programId), state = await ledger.read(), closed = [];
  for (const [id, record] of Object.entries(state.communityDrops || {})) {
    if (!record?.openingSignature || record.closedObservedAt || record.programId !== program.toBase58()) continue;
    // A submitted close is retried only if the chain still shows the drop open two minutes later.
    if (record.closeSubmittedAt && Date.parse(record.closeSubmittedAt) > now() * 1000 - 120_000) continue;
    if (record.authority !== authority.publicKey.toBase58()) continue;
    const { drop } = communityAddresses({ programId:program, authority:authority.publicKey, mint:record.mint });
    const info = await connection.getAccountInfo(drop, 'finalized');
    if (!info?.owner?.equals(program)) continue;
    const decoded = decodeCommunityDrop(info.data);
    if (!decoded.mint.equals(new PublicKey(record.mint))) throw new Error('CommunityDrop mint differs from its manifest.');
    if (decoded.closed) {
      await ledger.transaction(next => { next.communityDrops[id].closedObservedAt ||= new Date().toISOString(); });
      continue;
    }
    if (now() < decoded.expiresAt) continue;
    const { transaction } = buildCloseCommunityDropTransaction({ programId:program, caller:authority.publicKey, drop, decoded,
      tokenProgram:(await connection.getAccountInfo(decoded.mint, 'finalized'))?.owner || TOKEN_2022_PROGRAM_ID });
    transaction.feePayer = authority.publicKey;
    transaction.recentBlockhash = (await connection.getLatestBlockhash('finalized')).blockhash;
    transaction.sign(authority);
    const simulation = await connection.simulateTransaction(transaction);
    if (simulation.value.err) {
      logger.error(JSON.stringify({ event:'community_drop_close_rejected', mint:record.mint,
        reason:JSON.stringify(simulation.value.err).slice(0, 120) }));
      continue;
    }
    const signature = await connection.sendRawTransaction(transaction.serialize());
    await ledger.transaction(next => Object.assign(next.communityDrops[id], {
      closingSignature:signature, closeSubmittedAt:new Date().toISOString(),
      unclaimedBaseUnits:String(decoded.totalAmount - decoded.claimedAmount) }));
    logger.log(JSON.stringify({ event:'community_drop_close_submitted', mint:record.mint, signature }));
    closed.push({ mint:record.mint, drop:drop.toBase58(), signature });
  }
  return closed;
}
