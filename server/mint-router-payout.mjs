import { createHash } from 'node:crypto';
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { deriveFeeRouter, deriveMintFeeRouter, deriveMintFeeLedger } from '../fee-router.js';

const SETTLE_MINT_DISCRIMINATOR = Buffer.from('c9a8a4e9aa522860', 'hex');
const MIGRATE_MINT_LEDGER_DISCRIMINATOR = createHash('sha256').update('global:migrate_mint_fee_ledger').digest().subarray(0, 8);

export class CreatorSignatureRequiredError extends Error {
  constructor() {
    super('Creator wallet signature is required for mint-router settlement.');
    this.code = 'CREATOR_SIGNATURE_REQUIRED';
  }
}

export function xClaimId(obligationId) {
  if (!String(obligationId || '').trim()) throw new Error('An X obligation ID is required.');
  return createHash('sha256').update(`funded.x.claim.v2:${obligationId}`).digest();
}

export function creatorFeeClaimId(requestId) {
  if (!String(requestId || '').trim()) throw new Error('A creator fee request ID is required.');
  return createHash('sha256').update(`funded.creator.claim.v1:${requestId}`).digest();
}

export function buybackClaimId(collectionSignature) {
  if (!String(collectionSignature || '').trim()) throw new Error('A verified collection signature is required.');
  return createHash('sha256').update(`funded.buyback.claim.v1:${collectionSignature}`).digest();
}

export function communityReserveClaimId(fundingId) {
  if (!String(fundingId || '').trim()) throw new Error('A community reserve funding ID is required.');
  return createHash('sha256').update(`funded.community.reserve.v1:${fundingId}`).digest();
}

export function deriveMintClaim(programId, mint, claimId) {
  const program = new PublicKey(programId);
  const mintKey = new PublicKey(mint);
  if (claimId.length !== 32) throw new Error('Claim ID must be 32 bytes.');
  const [address] = PublicKey.findProgramAddressSync([Buffer.from('claim'), mintKey.toBuffer(), claimId], program);
  return address;
}

export function buildMintFeeLedgerMigrationInstruction({ programId, mint, authority, creator, appOwner, programData,
  historicalCreatorSpent, historicalProtocolSpent, expectedAvailableLamports }) {
  if (!creator || !appOwner || !programData) throw new Error('Creator, program upgrade owner, and verified ProgramData are required to migrate an existing mint.');
  const values = [historicalCreatorSpent, historicalProtocolSpent, expectedAvailableLamports].map(value => {
    if (value === undefined || value === null || !/^\d+$/.test(String(value))) throw new Error('An exact nonnegative historical fee snapshot is required.');
    const amount = BigInt(value);
    if (amount > 0xffffffffffffffffn) throw new Error('Historical fee snapshot amount exceeds u64.');
    return amount;
  });
  const program = new PublicKey(programId);
  const mintKey = new PublicKey(mint);
  const ledger = deriveMintFeeLedger(program, mintKey);
  const data = Buffer.alloc(32);
  MIGRATE_MINT_LEDGER_DISCRIMINATOR.copy(data, 0);
  values.forEach((value, index) => data.writeBigUInt64LE(value, 8 + index * 8));
  return new TransactionInstruction({
    programId: program,
    keys: [
      { pubkey:new PublicKey(authority), isSigner:true, isWritable:true },
      { pubkey:new PublicKey(creator), isSigner:true, isWritable:false },
      { pubkey:new PublicKey(appOwner), isSigner:true, isWritable:false },
      { pubkey:mintKey, isSigner:false, isWritable:false },
      { pubkey:deriveFeeRouter(program).address, isSigner:false, isWritable:false },
      { pubkey:deriveMintFeeRouter(program, mintKey).address, isSigner:false, isWritable:false },
      { pubkey:ledger.address, isSigner:false, isWritable:true },
      { pubkey:program, isSigner:false, isWritable:false },
      { pubkey:new PublicKey(programData), isSigner:false, isWritable:false },
      { pubkey:SystemProgram.programId, isSigner:false, isWritable:false },
    ],
    data,
  });
}

export function buildMintRouterSettlementInstruction({ programId, mint, authority, creator, recipient, amountLamports, obligationId, claimDomain = 'x' }) {
  if (!creator) throw new CreatorSignatureRequiredError();
  const mintKey = new PublicKey(mint);
  const authorityKey = new PublicKey(authority);
  const creatorKey = new PublicKey(creator);
  const recipientKey = new PublicKey(recipient);
  const amount = BigInt(amountLamports);
  if (amount <= 0n || amount > 0xffffffffffffffffn) throw new Error('Router settlement amount is outside the u64 range.');
  const router = deriveMintFeeRouter(programId, mintKey);
  const ledger = deriveMintFeeLedger(programId, mintKey);
  const legacyRouter = deriveFeeRouter(programId);
  if (!['x', 'creator', 'buyback', 'community-reserve'].includes(claimDomain)) throw new Error('Unsupported router claim domain.');
  const claimId = claimDomain === 'buyback' ? buybackClaimId(obligationId)
    : claimDomain === 'community-reserve' ? communityReserveClaimId(obligationId)
      : claimDomain === 'creator' ? creatorFeeClaimId(obligationId) : xClaimId(obligationId);
  const claim = deriveMintClaim(programId, mintKey, claimId);
  const data = Buffer.alloc(8 + 32 + 4 + 8 + 1);
  SETTLE_MINT_DISCRIMINATOR.copy(data, 0);
  claimId.copy(data, 8);
  data.writeUInt32LE(1, 40);
  data.writeBigUInt64LE(amount, 44);
  const share = ['x','creator'].includes(claimDomain) ? 0 : 1;
  data[52] = share;
  return {
    router: router.address,
    claim,
    claimId,
    ledger: ledger.address,
    share,
    instruction: new TransactionInstruction({
      programId: router.programId,
      keys: [
        { pubkey: authorityKey, isSigner: true, isWritable: true },
        { pubkey: creatorKey, isSigner: true, isWritable: false },
        { pubkey: mintKey, isSigner: false, isWritable: false },
        { pubkey: legacyRouter.address, isSigner: false, isWritable: false },
        { pubkey: router.address, isSigner: false, isWritable: true },
        { pubkey: ledger.address, isSigner: false, isWritable: true },
        { pubkey: claim, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: recipientKey, isSigner: false, isWritable: true },
      ],
      data,
    }),
  };
}

export function readMintClaimRecord(account, { programId, mint, recipient, amountLamports, claimId, share }) {
  if (share !== 0 && share !== 1) return false;
  if (!account || !account.owner.equals(new PublicKey(programId))) return false;
  const data = Buffer.from(account.data);
  const discriminator = createHash('sha256').update('account:MintClaimRecord').digest().subarray(0, 8);
  if (data.length !== 121 || !data.subarray(0, 8).equals(discriminator)) return false;
  return data.subarray(8, 40).equals(claimId)
    && data.subarray(40, 72).equals(new PublicKey(mint).toBuffer())
    && data.subarray(72, 104).equals(new PublicKey(recipient).toBuffer())
    && data.readBigUInt64LE(104) === BigInt(amountLamports)
    && data[120] === share;
}
