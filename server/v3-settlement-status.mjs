import { PublicKey } from '@solana/web3.js';
import { verifyFeeRouterAccount } from '../fee-router.js';
import { DEVNET_GENESIS_HASH, readProgramDataEvidence } from './automatic-reward-chain.mjs';
import { loadFinalizedV3PumpCollection } from './v3-finalized-collection.mjs';
import { loadFinalizedV3Settlement } from './v3-settlement-proof.mjs';

const HEX_32 = /^[a-f0-9]{64}$/i;
const result = (verified, recorded, checked, reason) => ({
  verified, scope:'all-recorded-v3-collections', recorded, checked,
  ...(!verified ? { reason } : {}),
});

// A persisted `finalized` label is insufficient. Recheck the approved program,
// source collection, category claim, exact settlement instruction and balances.
export async function verifyRecordedV3Settlements({ state, connection, programId,
  approvedHash, maxRecords = 25, readProgram = readProgramDataEvidence,
  verifyGlobal = verifyFeeRouterAccount,
  loadCollection = loadFinalizedV3PumpCollection,
  loadSettlement = loadFinalizedV3Settlement }) {
  const collections = Object.values(state?.collections || {}).filter(row =>
    row?.scope === 'per-mint-v3' && row.cluster === 'devnet');
  const recorded = collections.length;
  if (!recorded) return result(false, 0, 0, 'no-v3-collections');
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 || recorded > maxRecords)
    return result(false, recorded, 0, 'verification-budget-exceeded');
  if (!programId || !HEX_32.test(String(approvedHash || '')) || !connection)
    return result(false, recorded, 0, 'approved-program-unavailable');
  try {
    const program = new PublicKey(programId).toBase58();
    const [genesis, evidence, global] = await Promise.all([
      connection.getGenesisHash(), readProgram(connection, program),
      verifyGlobal({ connection, programId:program, commitment:'finalized' }),
    ]);
    if (genesis !== DEVNET_GENESIS_HASH || !evidence.account?.executable
      || evidence.sha256 !== approvedHash.toLowerCase() || !global.verified
      || !global.authority) return result(false, recorded, 0, 'approved-program-unverified');
    let checked = 0;
    for (const collection of collections) {
      const launch = state.launches?.[collection.mint];
      const settlement = state.v3Settlements?.[collection.signature];
      if (!launch?.onchainVerified || launch.cluster !== 'devnet'
        || launch.pumpFeeRoute?.scope !== 'per-mint-v3'
        || launch.pumpFeeRoute?.verified !== true
        || launch.pumpFeeRoute.programId !== program
        || launch.pumpFeeRoute.initialAuthority !== global.authority.toBase58()
        || collection.programId !== program || collection.status !== 'collected'
        || collection.onchainVerified !== true || collection.attribution !== 'mint-verified'
        || !Number.isSafeInteger(collection.collectedLamports)
        || collection.collectedLamports <= 0 || !HEX_32.test(String(collection.claimId || ''))
        || settlement?.status !== 'finalized' || settlement.cluster !== 'devnet'
        || settlement.collectionSignature !== collection.signature
        || settlement.mint !== collection.mint || settlement.claimId !== collection.claimId
        || settlement.expectedLamports !== String(collection.collectedLamports)
        || !settlement.settlementSignature)
        return result(false, recorded, checked, 'record-mismatch-or-pending');
      const source = await loadCollection({ connection, signature:collection.signature,
        programId:program, mint:collection.mint, launch });
      if (!source || source.signature !== collection.signature
        || source.claimId.toString('hex') !== collection.claimId
        || source.expectedLamports !== BigInt(collection.collectedLamports)
        || source.router !== collection.router)
        return result(false, recorded, checked, 'collection-proof-unavailable');
      const proof = await loadSettlement({ connection,
        signature:settlement.settlementSignature, programId:program,
        mint:collection.mint, authority:global.authority,
        creator:launch.creatorWallet, claimId:source.claimId,
        expectedLamports:source.expectedLamports, split:launch.pumpFeeRoute.protocolSplit });
      if (!proof || proof.signature !== settlement.settlementSignature
        || proof.claimId !== collection.claimId
        || proof.expectedLamports !== String(collection.collectedLamports)
        || proof.router !== collection.router
        || JSON.stringify(proof.categoryLamports) !== JSON.stringify(settlement.categoryLamports))
        return result(false, recorded, checked, 'settlement-proof-unavailable');
      checked += 1;
    }
    return result(true, recorded, checked);
  } catch {
    return result(false, recorded, 0, 'finalized-evidence-unavailable');
  }
}
