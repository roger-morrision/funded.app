import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction,
  sendAndConfirmTransaction } from '@solana/web3.js';
import { PROTOCOL_FEE_SPLIT } from '../config/protocol-fee-split.js';
import { buildProtectedMintRouterV3InitializeInstruction,
  buildMintRouterV3SettlementInstruction, verifyMintClaimV3Account,
  verifyMintPolicyV3Account } from '../mint-router-v3.js';
import { buildProtectedMintV3ApprovalInstruction,
  buildProtectedMintV3DisbursementInstruction } from '../protected-mint-router-v3.js';
import { readProgramDataEvidence, createAutomaticRewardChain,
  DEVNET_GENESIS_HASH } from '../server/automatic-reward-chain.mjs';
import { loadFinalizedV3RewardFunding } from '../server/v3-reward-funding-proof.mjs';

const PROGRAM = new PublicKey('9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm');
const AUTHORITY = new PublicKey('7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y');
const [binaryPath, expectedHash] = process.argv.slice(2);
if (!binaryPath || !/^[a-f0-9]{64}$/i.test(expectedHash || ''))
  throw new Error('Usage: node scripts/run-protected-v3-qa-devnet.mjs <tested-program.so> <finalized-programdata-sha256>');
const authority = Keypair.fromSecretKey(bs58.decode(process.env.FUNDED_ROUTER_AUTHORITY_SECRET_KEY || ''));
if (!authority.publicKey.equals(AUTHORITY)) throw new Error('The isolated Devnet V3 authority does not match.');
const connection = new Connection(process.env.SOLANA_DEVNET_RPC_URL
  || process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com', 'finalized');
if (await connection.getGenesisHash() !== DEVNET_GENESIS_HASH)
  throw new Error('The configured RPC is not Solana Devnet.');
const evidence = await readProgramDataEvidence(connection, PROGRAM);
const binary = readFileSync(binaryPath);
if (!evidence.account?.executable || evidence.sha256 !== expectedHash.toLowerCase()
  || !evidence.programData?.data?.subarray(45, 45 + binary.length).equals(binary)
  || evidence.programData.data.subarray(45 + binary.length).some(byte => byte !== 0))
  throw new Error('Finalized ProgramData does not contain the exact tested binary.');
if (await connection.getBalance(AUTHORITY, 'finalized') < 100_000_000)
  throw new Error('The QA authority is below the bounded Devnet test reserve.');

const creator = Keypair.generate();
const mint = Keypair.generate();
const operations = Keypair.generate().publicKey;
const referral = Keypair.generate().publicKey;
const signatures = {};
const send = (instructions, signers) => sendAndConfirmTransaction(connection,
  new Transaction().add(...instructions), signers, { commitment:'finalized', skipPreflight:false });
const amount = 10_000_000n;
const shares = { creatorWalletPercent:60, holderAirdropPercent:10, solClaimPercent:10 };
signatures.fund = await send([SystemProgram.transfer({ fromPubkey:AUTHORITY,
  toPubkey:creator.publicKey, lamports:50_000_000 })], [authority]);
const initialized = buildProtectedMintRouterV3InitializeInstruction({ programId:PROGRAM,
  mint:mint.publicKey, authority:AUTHORITY, creator:creator.publicKey, shares });
signatures.initialize = await send([initialized.instruction], [creator, mint]);
let policy = await verifyMintPolicyV3Account({ connection, programId:PROGRAM,
  mint:mint.publicKey, creator:creator.publicKey, initialAuthority:AUTHORITY,
  split:PROTOCOL_FEE_SPLIT });
if (!policy.verified || !policy.protectedPolicy || policy.directedUnits.join(',') !== '6000000,1000000,1000000')
  throw new Error('The protected mint policy did not finalize with immutable QA shares.');
signatures.collect = await send([SystemProgram.transfer({ fromPubkey:AUTHORITY,
  toPubkey:initialized.router.address, lamports:Number(amount) })], [authority]);
const claimId = randomBytes(32);
const settlement = buildMintRouterV3SettlementInstruction({ programId:PROGRAM,
  mint:mint.publicKey, authority:AUTHORITY, creator:creator.publicKey,
  claimId, expectedLamports:amount });
signatures.settle = await send([settlement.instruction], [authority, creator]);
const claim = await verifyMintClaimV3Account({ connection, programId:PROGRAM,
  mint:mint.publicKey, claimId, expectedLamports:amount });
if (!claim.verified || claim.categoryLamports[0] !== 8_000_000n)
  throw new Error('Protected V3 settlement did not create the expected category vault budgets.');
const chain = createAutomaticRewardChain({ connection, programId:PROGRAM,
  authority, expectedProgramDataSha256:expectedHash.toLowerCase() });
if (!(await chain.readiness()).constrainedPayouts)
  throw new Error('The finalized protected program is not payout ready.');
const rewardVault = await chain.ensureVault(mint.publicKey);

async function payout(label, { category, beneficiary, recipient, lamports, holderAmount = 0n }) {
  const withdrawalId = randomBytes(32);
  const input = { programId:PROGRAM, mint:mint.publicKey, authority:AUTHORITY,
    creator:creator.publicKey, withdrawalId, category, beneficiary,
    recipient, amount:lamports, holderAmount };
  const approval = category >= 1 && category <= 4
    ? buildProtectedMintV3ApprovalInstruction(input) : null;
  const disbursement = buildProtectedMintV3DisbursementInstruction(input);
  const instructions = approval
    ? [approval.instruction, disbursement.instruction] : [disbursement.instruction];
  const signature = await send(instructions, [authority, creator]);
  const proof = await loadFinalizedV3RewardFunding({ connection, signature,
    programId:PROGRAM, mint:mint.publicKey, authority:AUTHORITY,
    creator:creator.publicKey, initialAuthority:AUTHORITY,
    withdrawalId, category, beneficiary, amount:lamports,
    holderAmount, recipient, split:PROTOCOL_FEE_SPLIT, protectedPolicy:true });
  if (!proof?.balanceDeltaVerified) throw new Error(`${label} has no exact finalized payout proof.`);
  signatures[label] = signature;
}
await payout('creator', { category:0, beneficiary:0, recipient:creator.publicKey,
  lamports:6_000_000n });
await payout('holderX', { category:0, beneficiary:1, recipient:rewardVault,
  lamports:2_000_000n, holderAmount:1_000_000n });
signatures.fundRecipients = await send([
  SystemProgram.transfer({ fromPubkey:AUTHORITY, toPubkey:operations, lamports:1_000_000 }),
  SystemProgram.transfer({ fromPubkey:AUTHORITY, toPubkey:referral, lamports:1_000_000 }),
], [authority]);
await payout('operations', { category:1, beneficiary:3, recipient:operations,
  lamports:1_000_000n });
await payout('referral1', { category:2, beneficiary:4, recipient:referral,
  lamports:200_000n });
policy = await verifyMintPolicyV3Account({ connection, programId:PROGRAM,
  mint:mint.publicKey, creator:creator.publicKey, initialAuthority:AUTHORITY,
  split:PROTOCOL_FEE_SPLIT });
if (!policy.verified || !policy.protectedPolicy
  || policy.directedReleased.join(',') !== '6000000,1000000,1000000'
  || policy.withdrawnLamports[1] !== 1_000_000n || policy.withdrawnLamports[2] !== 200_000n)
  throw new Error('Finalized protected release counters did not reconcile.');
console.log(JSON.stringify({ status:'finalized-protected-v3-qa', cluster:'devnet',
  program:PROGRAM.toBase58(), programDataSha256:evidence.sha256,
  binarySha256:createHash('sha256').update(binary).digest('hex'),
  mint:mint.publicKey.toBase58(), signatures }, null, 2));
