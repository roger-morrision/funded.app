import { createHash } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { buildMintRouterV3SettlementInstruction, protocolGrossUnits } from '../mint-router-v3.js';

// Explicitly approved historical QA exception. No environment override, generic
// recovery API, alternate beneficiary, or production program is permitted.
export const QA_SETTLEMENT_RECOVERY = Object.freeze({
  programId:'9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm',
  mint:'HdGmAbwR1ng3VTQkQ6Gw3QYhJGebWNFf5voktjCKwhvL',
  creator:'89cmvLYLdvm9XRa1gu4DB8zzhmUsEjPWuTM1ahJzpkZM',
  authority:'7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y',
  claimId:'ff1ae71ac5e2d2eedb9817b82943c54528e81886a573e49ce1300c1d16c02d0f',
  collectionSignature:'24WvRWrP7gc5WXGEeEpM9RaNAhQD6r9bSzGG3jVZTCSQgzvYqhzp9TsAzmSYQG58BbiQFU4NMDypmUthePFMDHuZ',
  expectedLamports:'742575', priorSettledLamports:'322917',
  protocolUnits:Object.freeze([1_000_000,200_000,60_000,40_000,200_000,500_000]),
});
export const QA_RECOVERY_DISCRIMINATOR = createHash('sha256')
  .update('global:recover_qa_settlement_v3').digest().subarray(0,8);

// Separately approved collection created after the first recovery finalized.
// This does not permit future claims, different amounts or new beneficiaries.
export const QA_SETTLEMENT_RECOVERY_FOLLOWUP=Object.freeze({...QA_SETTLEMENT_RECOVERY,
  claimId:'9cadcccb3d2554a50853fe7b7cbb263fb5cae08150ec1a9cfb0cb51108c4f864',
  collectionSignature:'4VtYV4QBomTFcNZQZ4o36Pfe8FwCSRkvtkFNqTWinwLJ8JYsymGUyNmThvHKoAavqZhyU2SgfiUhay6AVG3hAmqB',
  expectedLamports:'1484671',priorSettledLamports:'1065492'});
export function qaSettlementRecoveryForClaim(claimId){
  const id=Buffer.from(claimId).toString('hex');
  return [QA_SETTLEMENT_RECOVERY,QA_SETTLEMENT_RECOVERY_FOLLOWUP].find(row=>row.claimId===id)||null;
}

export function buildQaSettlementRecoveryInstruction(input) {
  const approved = qaSettlementRecoveryForClaim(input.claimId);
  if(!approved)throw new Error('Historical QA claim, amount or immutable fee policy differs.');
  for (const field of ['programId','mint','creator','authority']) {
    if (new PublicKey(input[field]).toBase58() !== approved[field])
      throw new Error('This is not the approved historical Devnet QA recovery.');
  }
  if (Buffer.from(input.claimId).toString('hex') !== approved.claimId
    || String(input.expectedLamports) !== approved.expectedLamports
    || JSON.stringify(protocolGrossUnits(input.split)) !== JSON.stringify(approved.protocolUnits))
    throw new Error('Historical QA claim, amount or immutable fee policy differs.');
  const built = buildMintRouterV3SettlementInstruction(input);
  QA_RECOVERY_DISCRIMINATOR.copy(built.instruction.data);
  built.instruction.keys[1].isSigner = false;
  return built;
}
