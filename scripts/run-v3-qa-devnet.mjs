import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction,
  sendAndConfirmTransaction } from '@solana/web3.js';
import { deriveFeeRouter, verifyFeeRouterAccount } from '../fee-router.js';
import { buildMintRouterV3InitializeInstruction, buildMintRouterV3SettlementInstruction,
  buildMintRouterV3DisbursementInstruction, deriveMintVaultsV3, protocolGrossUnits,
  verifyMintRouterV3Account, verifyMintPolicyV3Account, verifyMintClaimV3Account,
  verifyMintWithdrawalV3Account } from '../mint-router-v3.js';

const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const PROGRAM_ID = new PublicKey('9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm');
const UPGRADEABLE_LOADER_ID = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const QA_AUTHORITY = new PublicKey('7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y');
const CLAIM_LAMPORTS = 10_000_000;
const CREATOR_FUNDING_LAMPORTS = 8_000_000;
const EXPECTED_PROTOCOL_UNITS = [1_000_000, 200_000, 60_000, 40_000, 200_000, 500_000];
const EXPECTED_ALLOCATION = [8_000_000, 1_000_000, 200_000, 60_000, 40_000, 200_000, 500_000];

const [mode, binaryArg] = process.argv.slice(2);
if (!['--preflight', '--execute'].includes(mode) || !binaryArg) {
  throw new Error('Usage: node scripts/run-v3-qa-devnet.mjs --preflight|--execute <exact-tested-program.so>');
}
const authoritySecret = String(process.env.FUNDED_ROUTER_AUTHORITY_SECRET_KEY || '').trim();
if (!authoritySecret) throw new Error('The dedicated QA authority secret is required.');
const authority = Keypair.fromSecretKey(bs58.decode(authoritySecret));
if (!authority.publicKey.equals(QA_AUTHORITY)) throw new Error('Refusing a non-QA authority signer.');
const connection = new Connection('https://api.devnet.solana.com', 'finalized');
if (await connection.getGenesisHash() !== DEVNET_GENESIS) throw new Error('Refusing a non-Devnet cluster.');

const program = await connection.getAccountInfo(PROGRAM_ID, 'finalized');
if (!program?.executable || !program.owner.equals(UPGRADEABLE_LOADER_ID)
  || program.data.length < 36 || program.data.readUInt32LE(0) !== 2) {
  throw new Error('The approved V3 QA program is not executable.');
}
const programDataAddress = new PublicKey(program.data.subarray(4, 36));
const programData = await connection.getAccountInfo(programDataAddress, 'finalized');
const binary = readFileSync(resolve(binaryArg));
if (!programData?.owner.equals(UPGRADEABLE_LOADER_ID)
  || programData.data[12] !== 1
  || !new PublicKey(programData.data.subarray(13, 45)).equals(QA_AUTHORITY)
  || programData.data.length < 45 + binary.length
  || !programData.data.subarray(45, 45 + binary.length).equals(binary)
  || programData.data.subarray(45 + binary.length).some(byte => byte !== 0)) {
  throw new Error('Finalized V3 program bytes or upgrade authority do not match the tested QA artifact.');
}
if ((await connection.getBalance(QA_AUTHORITY, 'finalized')) < 50_000_000) {
  throw new Error('QA authority balance is below the bounded test reserve.');
}
if (protocolGrossUnits().join(',') !== EXPECTED_PROTOCOL_UNITS.join(',')) {
  throw new Error('The configured protocol split differs from this bounded QA fixture.');
}
if (mode === '--preflight') {
  console.log(JSON.stringify({ status: 'ready-for-bounded-qa', cluster: 'devnet',
    program: PROGRAM_ID.toBase58(), authority: QA_AUTHORITY.toBase58(),
    binarySha256: createHash('sha256').update(binary).digest('hex'),
    claimLamports: CLAIM_LAMPORTS, categoryLamports: EXPECTED_ALLOCATION }, null, 2));
  process.exit(0);
}

async function send(instructions, signers) {
  return sendAndConfirmTransaction(connection, new Transaction().add(...instructions), signers,
    { commitment: 'finalized', skipPreflight: false });
}
async function finalizedBalance(address) {
  return connection.getBalance(address, 'finalized');
}
function requireEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, received ${actual}.`);
}

let globalSignature = null;
let global = await verifyFeeRouterAccount({ connection, programId: PROGRAM_ID });
if (!global.verified) {
  const discriminator = createHash('sha256').update('global:initialize').digest().subarray(0, 8);
  const router = deriveFeeRouter(PROGRAM_ID);
  globalSignature = await send([new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: QA_AUTHORITY, isSigner: true, isWritable: true },
      { pubkey: QA_AUTHORITY, isSigner: true, isWritable: false },
      { pubkey: router.address, isSigner: false, isWritable: true },
      { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: programDataAddress, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: discriminator,
  })], [authority]);
  global = await verifyFeeRouterAccount({ connection, programId: PROGRAM_ID });
}
if (!global.verified || !global.authority.equals(QA_AUTHORITY)) {
  throw new Error('The finalized global router is not owned by the dedicated QA authority.');
}

const creator = Keypair.generate();
const mint = Keypair.generate();
const operationsRecipient = Keypair.generate().publicKey;
const fundCreatorSignature = await send([SystemProgram.transfer({
  fromPubkey: QA_AUTHORITY, toPubkey: creator.publicKey, lamports: CREATOR_FUNDING_LAMPORTS,
})], [authority]);
const initialized = buildMintRouterV3InitializeInstruction({
  programId: PROGRAM_ID, mint: mint.publicKey, authority: QA_AUTHORITY, creator: creator.publicKey,
});
if (initialized.protocolUnits.join(',') !== EXPECTED_PROTOCOL_UNITS.join(','))
  throw new Error('The launch split does not match the bounded QA fixture.');
const initializeSignature = await send([initialized.instruction], [authority, creator, mint]);
const routerProof = await verifyMintRouterV3Account({ connection, programId: PROGRAM_ID,
  mint: mint.publicKey, initialAuthority: QA_AUTHORITY });
const policyProof = await verifyMintPolicyV3Account({ connection, programId: PROGRAM_ID,
  mint: mint.publicKey, creator: creator.publicKey, initialAuthority: QA_AUTHORITY });
if (!routerProof.verified || !policyProof.verified) throw new Error('Finalized V3 mint router or policy failed verification.');

const vaults = deriveMintVaultsV3(PROGRAM_ID, mint.publicKey);
const before = await Promise.all(vaults.map(finalizedBalance));
const creditSignature = await send([SystemProgram.transfer({
  fromPubkey: QA_AUTHORITY, toPubkey: initialized.router.address, lamports: CLAIM_LAMPORTS,
})], [authority]);
const claimId = randomBytes(32);
const settlement = buildMintRouterV3SettlementInstruction({
  programId: PROGRAM_ID, mint: mint.publicKey, authority: QA_AUTHORITY, creator: creator.publicKey,
  claimId, expectedLamports: CLAIM_LAMPORTS,
});
const settlementSignature = await send([settlement.instruction], [authority, creator]);
const claimProof = await verifyMintClaimV3Account({ connection, programId: PROGRAM_ID,
  mint: mint.publicKey, claimId, expectedLamports: CLAIM_LAMPORTS });
if (!claimProof.verified) throw new Error('Finalized V3 settlement claim failed verification.');
const after = await Promise.all(vaults.map(finalizedBalance));
const deltas = after.map((balance, index) => balance - before[index]);
for (let index = 0; index < deltas.length; index++) {
  requireEqual(deltas[index], EXPECTED_ALLOCATION[index], `category ${index} vault delta`);
  requireEqual(Number(claimProof.categoryLamports[index]), EXPECTED_ALLOCATION[index],
    `category ${index} claim allocation`);
}
const creatorBefore = await finalizedBalance(creator.publicKey);
const operationsBefore = await finalizedBalance(operationsRecipient);
const creatorWithdrawalId = randomBytes(32);
const creatorWithdrawal = buildMintRouterV3DisbursementInstruction({ programId: PROGRAM_ID,
  mint: mint.publicKey, authority: QA_AUTHORITY, creator: creator.publicKey,
  withdrawalId: creatorWithdrawalId, category: 0, amount: EXPECTED_ALLOCATION[0],
  recipient: creator.publicKey });
const creatorPayoutSignature = await send([creatorWithdrawal.instruction], [authority, creator]);
const operationsWithdrawalId = randomBytes(32);
const operationsWithdrawal = buildMintRouterV3DisbursementInstruction({ programId: PROGRAM_ID,
  mint: mint.publicKey, authority: QA_AUTHORITY, creator: creator.publicKey,
  withdrawalId: operationsWithdrawalId, category: 1, amount: EXPECTED_ALLOCATION[1],
  recipient: operationsRecipient });
const operationsPayoutSignature = await send([operationsWithdrawal.instruction], [authority, creator]);
requireEqual((await finalizedBalance(creator.publicKey)) - creatorBefore,
  EXPECTED_ALLOCATION[0], 'creator recipient delta');
requireEqual((await finalizedBalance(operationsRecipient)) - operationsBefore,
  EXPECTED_ALLOCATION[1], 'operations recipient delta');
for (const [id, category, amount, recipient] of [
  [creatorWithdrawalId, 0, EXPECTED_ALLOCATION[0], creator.publicKey],
  [operationsWithdrawalId, 1, EXPECTED_ALLOCATION[1], operationsRecipient],
]) {
  const proof = await verifyMintWithdrawalV3Account({ connection, programId: PROGRAM_ID,
    mint: mint.publicKey, withdrawalId: id, category, amount, recipient });
  if (!proof.verified) throw new Error(`Finalized V3 withdrawal receipt ${category} failed verification.`);
}
requireEqual(await finalizedBalance(vaults[6]), EXPECTED_ALLOCATION[6], 'locked buyback vault');
console.log(JSON.stringify({ status: 'finalized-synthetic-v3-qa', program: PROGRAM_ID.toBase58(),
  binarySha256: createHash('sha256').update(binary).digest('hex'),
  mint: mint.publicKey.toBase58(), creator: creator.publicKey.toBase58(),
  router: initialized.router.address.toBase58(), policy: initialized.policy.address.toBase58(),
  claim: settlement.claim.toBase58(), operationsRecipient: operationsRecipient.toBase58(),
  categoryLamports: deltas, signatures: { globalSignature, fundCreatorSignature,
    initializeSignature, creditSignature, settlementSignature, creatorPayoutSignature,
    operationsPayoutSignature },
  limits: { syntheticFunding: true, pumpCollectionVerified: false, buybackBurnVerified: false,
    operationsEntitlementVerified: false } }, null, 2));
