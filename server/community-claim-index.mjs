import { createHash } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { verifyCommunityProof } from '../community-merkle.js';
import { DEVNET_GENESIS_HASH, readProgramDataEvidence } from './automatic-reward-chain.mjs';
import { communityAddresses } from './community-claim-chain.mjs';

const dropDiscriminator = createHash('sha256').update('account:CommunityDrop').digest().subarray(0, 8);
const paymentDiscriminator = createHash('sha256').update('account:CommunityPayment').digest().subarray(0, 8);
const positive = value => /^[1-9]\d*$/.test(String(value ?? ''));
const key = value => new PublicKey(value).toBase58();

function checkedDrop(info, record, program, authority, eligibilityMint) {
  const bytes = Buffer.from(info?.data || []);
  if (!info?.owner?.equals(program) || bytes.length < 350 || !bytes.subarray(0, 8).equals(dropDiscriminator)
    || !new PublicKey(bytes.subarray(8, 40)).equals(authority)
    || !new PublicKey(bytes.subarray(72, 104)).equals(authority)
    || !new PublicKey(bytes.subarray(104, 136)).equals(new PublicKey(record.mint))
    || !new PublicKey(bytes.subarray(136, 168)).equals(eligibilityMint)
    || bytes.subarray(168, 200).toString('hex') !== record.manifest.root
    || bytes.subarray(200, 232).toString('hex') !== record.manifest.snapshotHash
    || bytes.readBigUInt64LE(312) !== BigInt(record.reservedBaseUnits)
    || bytes.readUInt32LE(344) !== record.manifest.leaves.length)
    throw new Error('CommunityDrop does not match its opened manifest.');
  return bytes.readBigUInt64LE(320);
}

function checkedPayment(info, drop, leaf, program) {
  const bytes = Buffer.from(info?.data || []);
  if (!info?.owner?.equals(program) || bytes.length !== 92
    || !bytes.subarray(0, 8).equals(paymentDiscriminator)
    || !bytes.subarray(8, 40).equals(drop.toBuffer())
    || !bytes.subarray(40, 72).equals(new PublicKey(leaf.recipient).toBuffer())
    || bytes.readBigUInt64LE(72) !== BigInt(leaf.amount)
    || bytes.readUInt32LE(80) !== leaf.index)
    throw new Error('CommunityPayment does not match its recipient and manifest leaf.');
}

export async function indexCommunityClaims({ connection, ledger, programId, authority, eligibilityMint,
  expectedProgramDataSha256, cluster = 'devnet', programEvidence = readProgramDataEvidence, persist = true }) {
  if (cluster !== 'devnet' || !/^[a-f0-9]{64}$/i.test(String(expectedProgramDataSha256 || '')))
    throw new Error('A pinned Devnet community program is required for claim indexing.');
  const program = new PublicKey(programId), issuer = new PublicKey(authority), eligible = new PublicKey(eligibilityMint);
  const [genesis, evidence, ledgerState] = await Promise.all([
    connection.getGenesisHash(), programEvidence(connection, program), ledger.read(),
  ]);
  if (genesis !== DEVNET_GENESIS_HASH || !evidence.account?.executable
    || evidence.sha256 !== expectedProgramDataSha256.toLowerCase())
    throw new Error('Community claim program identity or bytecode differs from the reviewed Devnet build.');

  const drops = [], payments = [];
  for (const record of Object.values(ledgerState.communityDrops || {})) {
    if (!record?.openingSignature) continue;
    if (record.programId !== program.toBase58() || record.authority !== issuer.toBase58()
      || record.eligibilityMint !== eligible.toBase58()
      || !Array.isArray(record.manifest?.leaves) || !positive(record.reservedBaseUnits))
      throw new Error('Opened community manifest has an invalid program or eligibility identity.');
    const { drop } = communityAddresses({ programId:program, authority:issuer, mint:record.mint });
    if (record.manifest.drop !== drop.toBase58()) throw new Error('Opened community manifest has an invalid drop address.');
    const info = await connection.getAccountInfo(drop, 'finalized');
    const claimed = checkedDrop(info, record, program, issuer, eligible);
    const leaves = record.manifest.leaves, paymentStart = payments.length;
    const recipients = new Set(), indexes = new Set();
    let paid = 0n;
    for (let start = 0; start < leaves.length; start += 100) {
      const batch = leaves.slice(start, start + 100);
      const addresses = batch.map(leaf => communityAddresses({ programId:program, authority:issuer,
        mint:record.mint, recipient:leaf.recipient }).payment);
      const accounts = await connection.getMultipleAccountsInfo(addresses, 'finalized');
      if (!Array.isArray(accounts) || accounts.length !== batch.length)
        throw new Error('Community payment account scan is incomplete.');
      for (let index = 0; index < batch.length; index += 1) {
        const leaf = batch[index], account = accounts[index];
        const recipient = key(leaf.recipient);
        if (!positive(leaf.amount) || !Number.isSafeInteger(leaf.index) || leaf.index < 0
          || leaf.index >= leaves.length || recipients.has(recipient) || indexes.has(leaf.index)
          || !verifyCommunityProof({ drop:record.manifest.drop, recipient,
            amount:leaf.amount, index:leaf.index, proof:leaf.proof, root:record.manifest.root }))
          throw new Error('Community claim manifest contains an invalid or duplicate leaf.');
        recipients.add(recipient); indexes.add(leaf.index);
        if (!account) continue;
        checkedPayment(account, drop, { ...leaf, recipient }, program);
        paid += BigInt(leaf.amount);
        payments.push({ mint:record.mint, recipient, amountBaseUnits:leaf.amount, payment:addresses[index].toBase58() });
      }
    }
    if (paid !== claimed) throw new Error('Finalized community payments do not reconcile with the drop claimed total.');
    drops.push({ mint:record.mint, drop:drop.toBase58(), claimCount:payments.length - paymentStart,
      claimedBaseUnits:claimed.toString() });
  }
  const result = { cluster, programId:program.toBase58(), eligibilityMint:eligible.toBase58(),
    commitment:'finalized', status:'verified', indexedAt:new Date().toISOString(), drops, payments };
  if (persist) await ledger.transaction(state => { state.communityClaimIndex = result; });
  return result;
}
