import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import { buildMintRouterV3InitializeInstruction, buildMintRouterV3SettlementInstruction,
  deriveMintClaimV3, deriveMintRouterV3, deriveMintVaultsV3, protocolGrossUnits,
  verifyMintRouterV3Account, verifyMintPolicyV3Account } from '../mint-router-v3.js';
import { FEE_ROUTER_POLICY_HASH_HEX } from '../fee-router.js';

const programId = Keypair.generate().publicKey;
const mint = Keypair.generate().publicKey;
const authority = Keypair.generate().publicKey;
const creator = Keypair.generate().publicKey;
const claimId = createHash('sha256').update('verified-collection-v3').digest();
const initial = buildMintRouterV3InitializeInstruction({ programId, mint, authority, creator });
assert.deepEqual(initial.protocolUnits, [1_000_000, 200_000, 60_000, 40_000, 200_000, 500_000]);
assert.equal(initial.instruction.data.toString('hex').slice(0, 16),
  createHash('sha256').update('global:initialize_mint_v3').digest('hex').slice(0, 16));
assert.equal(initial.instruction.keys[1].isSigner, true);
assert.equal(initial.instruction.keys[2].isSigner, true);
assert.equal(initial.instruction.keys[4].pubkey.toBase58(), deriveMintRouterV3(programId, mint).address.toBase58());
assert.equal(initial.instruction.data.readUInt32LE(28), 500_000);

const changed = protocolGrossUnits({ operationsPercent:40, referralLevelPercents:[10,3,2], communityPercent:20, buybackPercent:25 });
assert.deepEqual(changed, [800_000, 200_000, 60_000, 40_000, 400_000, 500_000]);
assert.deepEqual(protocolGrossUnits({ operationsPercent:50.0001, referralLevelPercents:[9.9999,3,2], communityPercent:10, buybackPercent:25 }),
  [1_000_002, 199_998, 60_000, 40_000, 200_000, 500_000]);
assert.deepEqual(protocolGrossUnits({ operationsPercent:75, referralLevelPercents:[10,3,2], communityPercent:10, buybackPercent:0 }),
  [1_500_000, 200_000, 60_000, 40_000, 200_000, 0]);
assert.throws(() => protocolGrossUnits({ operationsPercent:99, referralLevelPercents:[10,3,2], communityPercent:10, buybackPercent:25 }), /totaling 100%/);

const settlement = buildMintRouterV3SettlementInstruction({ programId, mint, authority, creator, claimId });
assert.equal(settlement.instruction.data.length, 40);
assert.equal(settlement.instruction.data.toString('hex').slice(0, 16),
  createHash('sha256').update('global:settle_mint_v3').digest('hex').slice(0, 16));
assert.equal(settlement.claim.toBase58(), deriveMintClaimV3(programId, mint, claimId).toBase58());
assert.equal(settlement.instruction.keys.length, 15);
assert.deepEqual(settlement.vaults.map(key => key.toBase58()), deriveMintVaultsV3(programId, mint).map(key => key.toBase58()));
assert.equal(settlement.instruction.keys[14].pubkey.toBase58(), settlement.vaults[6].toBase58());
assert.ok(settlement.instruction.keys.slice(8).every(meta => meta.isWritable));
assert.throws(() => deriveMintClaimV3(programId, mint, Buffer.alloc(31)), /32 bytes/);

const routerHeader = Buffer.alloc(106);
routerHeader.write('FUNDMNT3', 0, 'ascii');
routerHeader[8] = 3;
Buffer.from(FEE_ROUTER_POLICY_HASH_HEX, 'hex').copy(routerHeader, 9);
authority.toBuffer().copy(routerHeader, 41);
mint.toBuffer().copy(routerHeader, 73);
routerHeader[105] = initial.router.bump;
const accountAt = data => ({ getAccountInfo:async () => ({ owner:programId, data }) });
assert.equal((await verifyMintRouterV3Account({ connection:accountAt(routerHeader), programId, mint, initialAuthority:authority })).verified, true);
assert.equal((await verifyMintRouterV3Account({ connection:accountAt(routerHeader), programId, mint, initialAuthority:creator })).verified, false);

const policyData = Buffer.alloc(193);
createHash('sha256').update('account:MintFeePolicyV3').digest().copy(policyData, 0, 0, 8);
mint.toBuffer().copy(policyData, 8);
creator.toBuffer().copy(policyData, 40);
authority.toBuffer().copy(policyData, 72);
initial.protocolUnits.forEach((rate, index) => policyData.writeUInt32LE(rate, 104 + index * 4));
policyData[192] = initial.policy.bump;
assert.equal((await verifyMintPolicyV3Account({ connection:accountAt(policyData), programId, mint, creator, initialAuthority:authority })).verified, true);
assert.equal((await verifyMintPolicyV3Account({ connection:accountAt(policyData), programId, mint, creator:authority, initialAuthority:authority })).verified, false);
assert.equal((await verifyMintPolicyV3Account({ connection:accountAt(policyData), programId, mint, creator, initialAuthority:authority,
  split:{ operationsPercent:40, referralLevelPercents:[10,3,2], communityPercent:20, buybackPercent:25 } })).verified, false);
policyData.writeBigUInt64LE(1n, 128);
assert.equal((await verifyMintPolicyV3Account({ connection:accountAt(policyData), programId, mint, creator, initialAuthority:authority })).verified, false);
console.log('mint router v3 policy and instruction checks passed');
