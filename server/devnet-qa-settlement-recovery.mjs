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

export function buildQaSettlementRecoveryInstruction(input) {
  const approved = QA_SETTLEMENT_RECOVERY;
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
