import { createHash } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { buildCommunityManifest, verifyCommunityProof } from '../community-merkle.js';
import { DEVNET_GENESIS_HASH, readProgramDataEvidence, rewardAddresses } from './automatic-reward-chain.mjs';
import { buildCommunityClaimInstruction, buildCommunityInitializeInstruction, communityAddresses } from './community-claim-chain.mjs';
import { readCommunityReserveStatus } from './community-reserve-status.mjs';
import { captureExactCommunitySnapshot } from './community-snapshot.mjs';

const key = value => new PublicKey(value).toBase58();
const paymentDiscriminator = createHash('sha256').update('account:CommunityPayment').digest().subarray(0, 8);
const u64 = value => {
  if (!/^\d+$/.test(String(value)) || BigInt(value) <= 0n || BigInt(value) > 0xffffffffffffffffn)
    throw new Error('Community allocation must be a positive u64 base-unit amount.');
  return BigInt(value);
};

export function createCommunityClaimService({ connection, store, programId, authority, eligibilityMint,
  cluster = 'devnet', expectedCommunityProgramDataSha256,
  captureSnapshot = captureExactCommunitySnapshot, reserveReader = readCommunityReserveStatus,
  programEvidence = readProgramDataEvidence }) {
  if (cluster !== 'devnet') throw new Error('Community claim service is unavailable for this configuration.');
  if (!store?.transaction || !store?.read) throw new Error('An atomic persistent reward store is required.');
  const program = new PublicKey(programId), issuer = new PublicKey(authority), eligible = new PublicKey(eligibilityMint);

  async function assertDevnet() {
    if (await connection.getGenesisHash() !== DEVNET_GENESIS_HASH) throw new Error('Community claim RPC failed verification.');
  }

  async function assertReviewedProgram() {
    await assertDevnet();
    if (!/^[a-f0-9]{64}$/i.test(String(expectedCommunityProgramDataSha256 || '')))
      throw new Error('Reviewed community program-data hash is not pinned.');
    const evidence = await programEvidence(connection, program);
    if (!evidence.account?.executable || evidence.sha256 !== expectedCommunityProgramDataSha256)
      throw new Error('Current on-chain community program differs from the reviewed build.');
  }

  async function readReserve(row, openingSignature = null) {
    return reserveReader({ connection, programId:program, authority:issuer, fundingAuthority:row.creator,
      mint:row.mint, reservedTokens:row.reservedTokens, fundingSignature:row.fundingSignature,
      expectedEligibilityMint:eligible, dropOpeningSignature:openingSignature });
  }

  async function prepared(mint) {
    const records = (await store.read()).communityDrops || {};
    return records[key(mint)] || null;
  }

  async function prepare({ mint, creator, reservedTokens, fundingSignature, migrationSignature }) {
    await assertDevnet();
    const launchMint = new PublicKey(mint), creatorAddress = key(creator);
    if (!Number.isSafeInteger(reservedTokens) || reservedTokens <= 0 || reservedTokens > 500_000_000
      || !fundingSignature || !migrationSignature) throw new Error('Verified launch reserve and migration identities are required.');
    const mintInfo = await connection.getAccountInfo(launchMint, 'finalized');
    if (!mintInfo || (!mintInfo.owner.equals(TOKEN_PROGRAM_ID) && !mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID))
      || mintInfo.data.length < 45 || mintInfo.data[44] > 9) throw new Error('Launch mint is not a finalized supported SPL mint.');
    const amount = u64(BigInt(reservedTokens) * 10n ** BigInt(mintInfo.data[44]));
    const base = { mint:launchMint.toBase58(), creator:creatorAddress, reservedTokens, fundingSignature, migrationSignature };
    const reserve = await readReserve(base);
    if (reserve.status !== 'funded' || reserve.verified !== true)
      throw new Error('Launch reserve lacks a verified finalized funding receipt and full vault balance.');
    const snapshot = await captureSnapshot({ connection, mint:eligible, launchMint, migrationSignature });
    const { drop } = communityAddresses({ programId:program, authority:issuer, mint:launchMint });
    const { vault } = rewardAddresses({ programId:program, authority:issuer, mint:launchMint });
    const manifest = buildCommunityManifest({ drop:drop.toBase58(), launchMint:launchMint.toBase58(),
      eligibilityMint:eligible.toBase58(), migrationSignature, migrationSlot:snapshot.slot,
      migrationBlockTime:snapshot.blockTime, snapshot, amountBaseUnits:String(amount),
      excludedWallets:[issuer.toBase58(), vault.toBase58(), drop.toBase58()] });
    const record = { ...base, eligibilityMint:eligible.toBase58(), programId:program.toBase58(), authority:issuer.toBase58(),
      tokenProgram:mintInfo.owner.toBase58(), reservedBaseUnits:String(amount), snapshot,
      manifest, openingSignature:null, preparedAt:new Date().toISOString() };
    return store.transaction(state => {
      state.communityDrops ||= {};
      const prior = state.communityDrops[record.mint];
      if (prior) {
        if (prior.creator !== record.creator || prior.fundingSignature !== record.fundingSignature
          || prior.migrationSignature !== migrationSignature || prior.eligibilityMint !== record.eligibilityMint
          || prior.programId !== record.programId || prior.authority !== record.authority
          || prior.manifest.root !== manifest.root || prior.manifest.snapshotHash !== manifest.snapshotHash
          || prior.reservedBaseUnits !== record.reservedBaseUnits)
          throw new Error('Community manifest for this mint is immutable and conflicts with a new snapshot.');
        return structuredClone(prior);
      }
      state.communityDrops[record.mint] = record;
      return structuredClone(record);
    });
  }

  async function openingInstruction(mint) {
    await assertReviewedProgram();
    const record = await prepared(mint);
    if (!record || record.openingSignature) throw new Error('Prepared, unopened community manifest is required.');
    const reserve = await readReserve(record);
    if (reserve.status !== 'funded' || reserve.verified !== true)
      throw new Error('Community reserve funding is no longer verified.');
    const tokenAccount = getAssociatedTokenAddressSync(new PublicKey(record.mint),
      rewardAddresses({ programId:program, authority:issuer, mint:record.mint }).vault, true,
      new PublicKey(record.tokenProgram));
    const source = await connection.getTokenAccountBalance(tokenAccount, 'finalized');
    return buildCommunityInitializeInstruction({ programId:program, authority:issuer,
      creator:record.creator, mint:record.mint, eligibilityMint:eligible, tokenProgram:record.tokenProgram,
      manifest:record.manifest, sourceVaultBalance:source.value.amount });
  }

  async function recordOpening({ mint, signature }) {
    await assertReviewedProgram();
    const record = await prepared(mint);
    if (!record || !signature) throw new Error('Prepared manifest and finalized opening signature are required.');
    if (record.openingSignature && record.openingSignature !== signature)
      throw new Error('CommunityDrop opening signature is immutable.');
    const verified = await readReserve(record, signature);
    if (!verified.verified || !['drop-active', 'drop-closed'].includes(verified.status)
      || verified.merkleRoot !== record.manifest.root || verified.snapshotHash !== record.manifest.snapshotHash
      || verified.migrationSlot !== record.snapshot.slot || verified.totalBaseUnits !== record.reservedBaseUnits
      || verified.drop !== record.manifest.drop) throw new Error('Opening receipt and on-chain drop differ from the immutable exact-slot manifest.');
    return store.transaction(state => {
      const current = state.communityDrops?.[record.mint];
      if (!current || current.manifest.root !== record.manifest.root || current.manifest.snapshotHash !== record.manifest.snapshotHash
        || current.openingSignature && current.openingSignature !== signature)
        throw new Error('Stored community manifest changed before opening receipt could be recorded.');
      current.openingSignature ||= signature;
      current.openedAt ||= new Date().toISOString();
      return { mint:record.mint, drop:verified.drop, signature, status:verified.status, verified:true };
    });
  }

  async function recipientProof({ mint, wallet }) {
    await assertReviewedProgram();
    const record = await prepared(mint);
    if (!record?.openingSignature) return { status:'unavailable', reason:'No verified CommunityDrop opening receipt.' };
    const verified = await readReserve(record, record.openingSignature);
    if (!verified.verified || verified.status !== 'drop-active'
      || verified.merkleRoot !== record.manifest.root || verified.snapshotHash !== record.manifest.snapshotHash
      || verified.migrationSlot !== record.snapshot.slot) return { status:'unavailable', reason:'CommunityDrop no longer matches its verified manifest.' };
    if (verified.expiresAt && Math.floor(Date.now() / 1000) >= verified.expiresAt)
      return { status:'expired', drop:record.manifest.drop };
    const recipient = key(wallet);
    const leaf = record.manifest.leaves.find(row => row.recipient === recipient);
    if (!leaf) return { status:'ineligible', drop:record.manifest.drop, recipient };
    if (!verifyCommunityProof({ drop:record.manifest.drop, recipient, amount:leaf.amount,
      index:leaf.index, proof:leaf.proof, root:record.manifest.root }))
      throw new Error('Stored community proof failed local verification.');
    const { payment } = communityAddresses({ programId:program, authority:issuer, mint:record.mint, recipient });
    const paid = await connection.getAccountInfo(payment, 'finalized');
    if (paid) {
      const bytes = Buffer.from(paid.data || []);
      if (!paid.owner.equals(program) || bytes.length < 92 || !bytes.subarray(0, 8).equals(paymentDiscriminator)
        || !new PublicKey(bytes.subarray(8, 40)).equals(new PublicKey(record.manifest.drop))
        || !new PublicKey(bytes.subarray(40, 72)).equals(new PublicKey(recipient))
        || String(bytes.readBigUInt64LE(72)) !== leaf.amount || bytes.readUInt32LE(80) !== leaf.index)
        throw new Error('Community payment account conflicts with the published proof.');
      return { status:'claimed', drop:record.manifest.drop, recipient, amount:leaf.amount, payment:payment.toBase58() };
    }
    return { status:'claimable', drop:record.manifest.drop, mint:record.mint, recipient,
      amount:leaf.amount, index:leaf.index, proof:[...leaf.proof], root:record.manifest.root,
      snapshotHash:record.manifest.snapshotHash, expiresAt:verified.expiresAt || null };
  }

  async function claimInstruction({ mint, wallet }) {
    const proof = await recipientProof({ mint, wallet });
    if (proof.status !== 'claimable') throw new Error('No verified unclaimed community allocation exists for this wallet.');
    const record = await prepared(mint);
    return buildCommunityClaimInstruction({ programId:program, authority:issuer, mint:record.mint,
      tokenProgram:record.tokenProgram, manifest:record.manifest, recipient:wallet, payer:wallet });
  }

  return { prepare, prepared, openingInstruction, recordOpening, recipientProof, claimInstruction };
}
