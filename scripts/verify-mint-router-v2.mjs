import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Keypair, PublicKey, TransactionInstruction } from '@solana/web3.js';
import { PUMP_SDK } from '@pump-fun/pump-sdk';
import { deriveMintFeeRouter, deriveMintFeeLedger, FEE_ROUTER_POLICY_HASH_HEX, MINT_FEE_ROUTER_MAGIC, MINT_FEE_ROUTER_SEED, verifyMintFeeRouterAccount, verifyMintFeeLedgerAccount, buildFeeRouterPolicy } from '../fee-router.js';
import { buildMintRouterInitializeInstruction, buildPumpLaunchPlan } from '../mint-router-launch.js';
import { buildMintRouterSettlementInstruction, buildMintFeeLedgerMigrationInstruction, readMintClaimRecord } from '../server/mint-router-payout.mjs';
import { communityProgramReserveAddress, rewardAddresses } from '../server/automatic-reward-chain.mjs';

const program = Keypair.generate().publicKey;
const mint = Keypair.generate();
const payer = Keypair.generate().publicKey;
const authority = Keypair.generate().publicKey;
const recipient = Keypair.generate().publicKey;
const router = deriveMintFeeRouter(program, mint.publicKey);
const header = Buffer.alloc(106);
header.write(MINT_FEE_ROUTER_MAGIC, 0, 'ascii');
header[8] = 2;
Buffer.from(FEE_ROUTER_POLICY_HASH_HEX, 'hex').copy(header, 9);
authority.toBuffer().copy(header, 41);
mint.publicKey.toBuffer().copy(header, 73);
header[105] = router.bump;
const verified = await verifyMintFeeRouterAccount({ connection: { getAccountInfo: async () => ({ owner: program, data: header }) }, programId: program, mint: mint.publicKey, expectedAuthority: authority });
assert.equal(verified.verified, true);
assert.equal((await verifyMintFeeRouterAccount({ connection: { getAccountInfo: async () => ({ owner: program, data: header }) }, programId: program, mint: mint.publicKey, expectedAuthority: payer })).verified, false);
const ledgerAddress = deriveMintFeeLedger(program, mint.publicKey);
const ledgerData = Buffer.alloc(89);
createHash('sha256').update('account:MintFeeLedger').digest().copy(ledgerData, 0, 0, 8);
mint.publicKey.toBuffer().copy(ledgerData, 8);
payer.toBuffer().copy(ledgerData, 40);
ledgerData[88] = ledgerAddress.bump;
const ledgerConnection = { getAccountInfo: async () => ({ owner:program, data:ledgerData }) };
assert.equal((await verifyMintFeeLedgerAccount({ connection:ledgerConnection, programId:program, mint:mint.publicKey, creator:payer })).verified, true);
assert.equal((await verifyMintFeeLedgerAccount({ connection:ledgerConnection, programId:program, mint:mint.publicKey, creator:recipient })).verified, false);
assert.equal(buildFeeRouterPolicy({ ...router, scope: 'per-mint-v2' }).router.seed, MINT_FEE_ROUTER_SEED);

const initialize = buildMintRouterInitializeInstruction({ programId: program, mint: mint.publicKey, payer });
assert.equal(initialize.instruction.keys[1].isSigner, true);
assert.equal(initialize.instruction.keys[4].isWritable, true);
assert.equal(initialize.instruction.data.toString('hex'), createHash('sha256').update('global:initialize_mint').digest('hex').slice(0, 16));
const create = await PUMP_SDK.createV2Instruction({ mint: mint.publicKey, name: 'Mint Router Test', symbol: 'MRT', uri: `https://funded.vip/devnet-metadata/${mint.publicKey}`, creator: router.address, user: payer, mayhemMode: false, holderReward: false });
const blockhash = Keypair.generate().publicKey.toBase58();
const plan = buildPumpLaunchPlan({ payer, mint, blockhash, launchInstructions: [create], mintRouterInstruction: initialize.instruction });
assert.ok(plan.steps.length >= 1 && plan.steps.length <= 2);
assert.ok(plan.steps.every(step => step.bytes <= 1232));
assert.equal(plan.steps.at(-1).kind, 'launch');
const oversized = new TransactionInstruction({ programId: program, keys: [], data: Buffer.alloc(1233) });
assert.throws(() => buildPumpLaunchPlan({ payer, mint, blockhash, launchInstructions: [create], burnInstruction: oversized, mintRouterInstruction: initialize.instruction }), /size limit/);

const obligationId = `${mint.publicKey}:claim:x`;
const migration = buildMintFeeLedgerMigrationInstruction({programId:program,mint:mint.publicKey,authority,creator:payer,appOwner:payer,
  programData:Keypair.generate().publicKey,historicalCreatorSpent:'60000000',historicalProtocolSpent:'20000000',expectedAvailableLamports:'20000000'});
assert.equal(migration.keys[1].isSigner, true);
assert.equal(migration.keys[2].isSigner, true);
assert.equal(migration.data.readBigUInt64LE(8), 60000000n);
assert.equal(migration.data.readBigUInt64LE(16), 20000000n);
assert.equal(migration.data.readBigUInt64LE(24), 20000000n);
assert.throws(() => buildMintFeeLedgerMigrationInstruction({programId:program,mint:mint.publicKey,authority,creator:payer,
  appOwner:payer,programData:Keypair.generate().publicKey}), /historical fee snapshot/);
const settlement = buildMintRouterSettlementInstruction({ programId: program, mint: mint.publicKey, authority, creator:payer, recipient, amountLamports: '12345678', obligationId });
assert.equal(settlement.router.toBase58(), router.address.toBase58());
assert.equal(settlement.instruction.keys[8].pubkey.toBase58(), recipient.toBase58());
const creatorSettlement = buildMintRouterSettlementInstruction({ programId:program, mint:mint.publicKey, authority,
  creator:payer, recipient:payer, amountLamports:'12345678', obligationId:'collection:creator', claimDomain:'creator' });
assert.equal(creatorSettlement.share, 0);
assert.notDeepEqual(creatorSettlement.claimId, settlement.claimId);
assert.equal(settlement.instruction.keys[1].isSigner, true);
assert.equal(settlement.instruction.data[52], 0);
assert.equal(settlement.instruction.data.readBigUInt64LE(44), 12345678n);
const reserveSettlement = buildMintRouterSettlementInstruction({ programId:program, mint:mint.publicKey,
  authority, creator:payer, recipient, amountLamports:'2000000', obligationId:'claim-a:community', claimDomain:'community-reserve' });
assert.notEqual(reserveSettlement.claim.toBase58(), settlement.claim.toBase58());
assert.notEqual(reserveSettlement.claimId.toString('hex'), settlement.claimId.toString('hex'));
assert.notEqual(communityProgramReserveAddress({ programId:program, authority }).toBase58(),
  rewardAddresses({ programId:program, authority, mint:mint.publicKey }).vault.toBase58());
const accountData = Buffer.alloc(121);
createHash('sha256').update('account:MintClaimRecord').digest().copy(accountData, 0, 0, 8);
settlement.claimId.copy(accountData, 8);
mint.publicKey.toBuffer().copy(accountData, 40);
recipient.toBuffer().copy(accountData, 72);
accountData.writeBigUInt64LE(12345678n, 104);
accountData[120] = 0;
const account = { owner: program, data: accountData };
assert.equal(readMintClaimRecord(account, { programId: program, mint: mint.publicKey, recipient, amountLamports: '12345678', claimId: settlement.claimId, share:settlement.share }), true);
assert.equal(readMintClaimRecord(account, { programId: program, mint: mint.publicKey, recipient: payer, amountLamports: '12345678', claimId: settlement.claimId, share:settlement.share }), false);
assert.equal(readMintClaimRecord(account, { programId: program, mint: mint.publicKey, recipient, amountLamports: '12345679', claimId: settlement.claimId, share:settlement.share }), false);
console.log(`mint router v2 checks passed (${plan.steps.length} launch transaction${plan.steps.length === 1 ? '' : 's'})`);
