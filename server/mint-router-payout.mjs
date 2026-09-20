import { createHash } from 'node:crypto';
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { deriveMintFeeRouter } from '../fee-router.js';

const SETTLE_MINT_DISCRIMINATOR = Buffer.from('c9a8a4e9aa522860', 'hex');

export function xClaimId(obligationId) {
  if (!String(obligationId || '').trim()) throw new Error('An X obligation ID is required.');
  return createHash('sha256').update(`funded.x.claim.v2:${obligationId}`).digest();
}

export function deriveMintClaim(programId, mint, claimId) {
  const program = new PublicKey(programId);
  const mintKey = new PublicKey(mint);
  if (claimId.length !== 32) throw new Error('Claim ID must be 32 bytes.');
  const [address] = PublicKey.findProgramAddressSync([Buffer.from('claim'), mintKey.toBuffer(), claimId], program);
  return address;
}

export function buildMintRouterSettlementInstruction({ programId, mint, authority, recipient, amountLamports, obligationId }) {
  const mintKey = new PublicKey(mint);
  const authorityKey = new PublicKey(authority);
  const recipientKey = new PublicKey(recipient);
  const amount = BigInt(amountLamports);
  if (amount <= 0n || amount > 0xffffffffffffffffn) throw new Error('X payout amount is outside the u64 range.');
  const router = deriveMintFeeRouter(programId, mintKey);
  const claimId = xClaimId(obligationId);
  const claim = deriveMintClaim(programId, mintKey, claimId);
  const data = Buffer.alloc(8 + 32 + 4 + 8);
  SETTLE_MINT_DISCRIMINATOR.copy(data, 0);
  claimId.copy(data, 8);
  data.writeUInt32LE(1, 40);
  data.writeBigUInt64LE(amount, 44);
  return {
    router: router.address,
    claim,
    claimId,
    instruction: new TransactionInstruction({
      programId: router.programId,
      keys: [
        { pubkey: authorityKey, isSigner: true, isWritable: true },
        { pubkey: mintKey, isSigner: false, isWritable: false },
        { pubkey: router.address, isSigner: false, isWritable: true },
        { pubkey: claim, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: recipientKey, isSigner: false, isWritable: true },
      ],
      data,
    }),
  };
}

export function readMintClaimRecord(account, { programId, mint, recipient, amountLamports, claimId }) {
  if (!account || !account.owner.equals(new PublicKey(programId))) return false;
  const data = Buffer.from(account.data);
  const discriminator = createHash('sha256').update('account:MintClaimRecord').digest().subarray(0, 8);
  if (data.length !== 120 || !data.subarray(0, 8).equals(discriminator)) return false;
  return data.subarray(8, 40).equals(claimId)
    && data.subarray(40, 72).equals(new PublicKey(mint).toBuffer())
    && data.subarray(72, 104).equals(new PublicKey(recipient).toBuffer())
    && data.readBigUInt64LE(104) === BigInt(amountLamports);
}
