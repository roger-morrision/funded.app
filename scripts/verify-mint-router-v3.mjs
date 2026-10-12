import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Keypair, TransactionInstruction } from '@solana/web3.js';
import { buildMintRouterV3InitializeInstruction, buildMintRouterV3SettlementInstruction,
  buildMintRouterV3DisbursementInstruction, deriveCommunityRewardVaultV3,
  deriveMintClaimV3, deriveMintWithdrawalV3, deriveMintRouterV3, deriveMintVaultsV3, protocolGrossUnits,
  verifyMintRouterV3Account, verifyMintPolicyV3Account, verifyMintWithdrawalV3Account,
  verifyMintClaimV3Account } from '../mint-router-v3.js';
import { FEE_ROUTER_POLICY_HASH_HEX } from '../fee-router.js';
import { buildPumpLaunchPlan } from '../mint-router-launch.js';

const programId = Keypair.generate().publicKey;
const mintSigner = Keypair.generate();
const mint = mintSigner.publicKey;
const authority = Keypair.generate().publicKey;
const creator = Keypair.generate().publicKey;
const claimId = createHash('sha256').update('verified-collection-v3').digest();
const initial = buildMintRouterV3InitializeInstruction({ programId, mint, authority, creator });
assert.deepEqual(initial.protocolUnits, [1_000_000, 200_000, 60_000, 40_000, 200_000, 500_000]);
assert.equal(initial.instruction.data.toString('hex').slice(0, 16),
  createHash('sha256').update('global:initialize_mint_v3').digest('hex').slice(0, 16));
assert.equal(initial.instruction.keys[1].isSigner, true);
assert.equal(initial.instruction.keys[2].isSigner, true);
assert.equal(initial.instruction.keys[0].isSigner, false);
assert.equal(initial.instruction.keys[4].pubkey.toBase58(), deriveMintRouterV3(programId, mint).address.toBase58());
assert.equal(initial.instruction.data.readUInt32LE(28), 500_000);
const launchPlan = buildPumpLaunchPlan({ payer:creator, mint:mintSigner,
  blockhash:Keypair.generate().publicKey.toBase58(),
  launchInstructions:[new TransactionInstruction({ programId:Keypair.generate().publicKey,
    keys:[{ pubkey:initial.router.address, isSigner:false, isWritable:false }], data:Buffer.alloc(8) })],
  mintRouterInstruction:initial.instruction });
assert.equal(launchPlan.steps.length, 1);
assert.deepEqual(launchPlan.steps[0].transaction.signatures.map(row => row.publicKey.toBase58()).sort(),
  [creator.toBase58(), mint.toBase58()].sort());

const changed = protocolGrossUnits({ operationsPercent:40, referralLevelPercents:[10,3,2], communityPercent:20, buybackPercent:25 });
assert.deepEqual(changed, [800_000, 200_000, 60_000, 40_000, 400_000, 500_000]);
assert.deepEqual(protocolGrossUnits({ operationsPercent:50.0001, referralLevelPercents:[9.9999,3,2], communityPercent:10, buybackPercent:25 }),
  [1_000_002, 199_998, 60_000, 40_000, 200_000, 500_000]);
assert.deepEqual(protocolGrossUnits({ operationsPercent:75, referralLevelPercents:[10,3,2], communityPercent:10, buybackPercent:0 }),
  [1_500_000, 200_000, 60_000, 40_000, 200_000, 0]);
assert.throws(() => protocolGrossUnits({ operationsPercent:99, referralLevelPercents:[10,3,2], communityPercent:10, buybackPercent:25 }), /totaling 100%/);

const settlement = buildMintRouterV3SettlementInstruction({ programId, mint, authority, creator, claimId,
  expectedLamports:'100000000000' });
assert.equal(settlement.instruction.data.length, 48);
assert.equal(settlement.instruction.data.readBigUInt64LE(40), 100_000_000_000n);
assert.equal(settlement.instruction.data.toString('hex').slice(0, 16),
  createHash('sha256').update('global:settle_mint_v3').digest('hex').slice(0, 16));
assert.equal(settlement.claim.toBase58(), deriveMintClaimV3(programId, mint, claimId).toBase58());
assert.equal(settlement.instruction.keys.length, 15);
assert.deepEqual(settlement.vaults.map(key => key.toBase58()), deriveMintVaultsV3(programId, mint).map(key => key.toBase58()));
assert.equal(settlement.instruction.keys[14].pubkey.toBase58(), settlement.vaults[6].toBase58());
assert.ok(settlement.instruction.keys.slice(8).every(meta => meta.isWritable));
assert.throws(() => deriveMintClaimV3(programId, mint, Buffer.alloc(31)), /32 bytes/);
assert.throws(() => buildMintRouterV3SettlementInstruction({ programId, mint, authority, creator,
  claimId, expectedLamports:Number.MAX_SAFE_INTEGER + 1 }), /safe integer/);

const withdrawalId = createHash('sha256').update('creator-payout-v3').digest();
const disbursement = buildMintRouterV3DisbursementInstruction({ programId, mint, authority, creator,
  withdrawalId, category:0, amount:123n, recipient:creator });
assert.equal(disbursement.instruction.data.length, 49);
assert.equal(disbursement.instruction.data.toString('hex').slice(0, 16),
  createHash('sha256').update('global:disburse_mint_v3').digest('hex').slice(0, 16));
assert.equal(disbursement.instruction.data.readBigUInt64LE(41), 123n);
assert.equal(disbursement.instruction.keys[5].pubkey.toBase58(), settlement.vaults[0].toBase58());
assert.equal(disbursement.instruction.keys[7].pubkey.toBase58(),
  deriveMintWithdrawalV3(programId, mint, withdrawalId).toBase58());
assert.throws(() => buildMintRouterV3DisbursementInstruction({ programId, mint, authority, creator,
  withdrawalId, category:6, amount:1, recipient:creator }), /buyback is locked/);
assert.throws(() => buildMintRouterV3DisbursementInstruction({ programId, mint, authority, creator,
  withdrawalId, category:0, amount:Number.MAX_SAFE_INTEGER + 1, recipient:creator }), /safe integer/);
assert.throws(() => buildMintRouterV3DisbursementInstruction({ programId, mint, authority, creator,
  withdrawalId, category:0, amount:1, recipient:authority }), /pay the creator/);
assert.throws(() => buildMintRouterV3DisbursementInstruction({ programId, mint, authority, creator,
  withdrawalId, category:1, amount:1, recipient:settlement.vaults[6] }), /cannot be reclassified/);
assert.throws(() => buildMintRouterV3DisbursementInstruction({ programId, mint, authority, creator,
  withdrawalId, category:5, amount:1, recipient:creator }), /proof-gated reward vault/);
const community = deriveCommunityRewardVaultV3(programId, mint, authority);
assert.equal(buildMintRouterV3DisbursementInstruction({ programId, mint, authority, creator,
  withdrawalId, category:5, amount:1, recipient:community }).recipient.toBase58(), community.toBase58());
assert.throws(() => deriveMintWithdrawalV3(programId, mint, Buffer.alloc(31)), /32 bytes/);

const routerHeader = Buffer.alloc(106);
routerHeader.write('FUNDMNT3', 0, 'ascii');
routerHeader[8] = 3;
Buffer.from(FEE_ROUTER_POLICY_HASH_HEX, 'hex').copy(routerHeader, 9);
authority.toBuffer().copy(routerHeader, 41);
mint.toBuffer().copy(routerHeader, 73);
routerHeader[105] = initial.router.bump;
const accountAt = data => ({ getAccountInfo:async () => ({ owner:programId, data }) });
const claimData = Buffer.alloc(144);
createHash('sha256').update('account:MintClaimRecordV3').digest().copy(claimData, 0, 0, 8);
claimId.copy(claimData, 8);
mint.toBuffer().copy(claimData, 40);
claimData.writeBigUInt64LE(100n, 72);
[80n, 10n, 2n, 1n, 0n, 2n, 5n].forEach((amount, index) => claimData.writeBigUInt64LE(amount, 80 + index * 8));
const claimCheck = { connection:accountAt(claimData), programId, mint, claimId, expectedLamports:100n };
assert.equal((await verifyMintClaimV3Account(claimCheck)).verified, true);
assert.equal((await verifyMintClaimV3Account({ ...claimCheck, expectedLamports:99n })).verified, false);
claimData.writeBigUInt64LE(4n, 128);
assert.equal((await verifyMintClaimV3Account(claimCheck)).verified, false);
const withdrawalData = Buffer.alloc(121);
createHash('sha256').update('account:MintWithdrawalV3').digest().copy(withdrawalData, 0, 0, 8);
withdrawalId.copy(withdrawalData, 8);
mint.toBuffer().copy(withdrawalData, 40);
withdrawalData[72] = 0;
creator.toBuffer().copy(withdrawalData, 73);
withdrawalData.writeBigUInt64LE(123n, 105);
withdrawalData.writeBigInt64LE(1728000000n, 113);
const withdrawalCheck = { connection:accountAt(withdrawalData), programId, mint, withdrawalId,
  category:0, recipient:creator, amount:123n };
assert.equal((await verifyMintWithdrawalV3Account(withdrawalCheck)).verified, true);
assert.equal((await verifyMintWithdrawalV3Account({ ...withdrawalCheck, amount:124n })).verified, false);
assert.equal((await verifyMintRouterV3Account({ connection:accountAt(routerHeader), programId, mint, initialAuthority:authority })).verified, true);
assert.equal((await verifyMintRouterV3Account({ connection:accountAt(routerHeader), programId, mint, initialAuthority:creator })).verified, false);

const policyData = Buffer.alloc(249);
createHash('sha256').update('account:MintFeePolicyV3').digest().copy(policyData, 0, 0, 8);
mint.toBuffer().copy(policyData, 8);
creator.toBuffer().copy(policyData, 40);
authority.toBuffer().copy(policyData, 72);
initial.protocolUnits.forEach((rate, index) => policyData.writeUInt32LE(rate, 104 + index * 4));
policyData[248] = initial.policy.bump;
assert.equal((await verifyMintPolicyV3Account({ connection:accountAt(policyData), programId, mint, creator, initialAuthority:authority })).verified, true);
policyData.writeBigUInt64LE(1n, 192);
assert.equal((await verifyMintPolicyV3Account({ connection:accountAt(policyData), programId, mint, creator, initialAuthority:authority })).verified, false);
policyData.writeBigUInt64LE(0n, 192);
assert.equal((await verifyMintPolicyV3Account({ connection:accountAt(policyData), programId, mint, creator:authority, initialAuthority:authority })).verified, false);
assert.equal((await verifyMintPolicyV3Account({ connection:accountAt(policyData), programId, mint, creator, initialAuthority:authority,
  split:{ operationsPercent:40, referralLevelPercents:[10,3,2], communityPercent:20, buybackPercent:25 } })).verified, false);
policyData.writeBigUInt64LE(1n, 128);
assert.equal((await verifyMintPolicyV3Account({ connection:accountAt(policyData), programId, mint, creator, initialAuthority:authority })).verified, false);
console.log('mint router v3 policy and instruction checks passed');
