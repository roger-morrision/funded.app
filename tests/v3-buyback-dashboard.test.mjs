import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { readV3BuybackDashboard } from '../server/v3-buyback-dashboard.mjs';
import { deriveMintPolicyV3, deriveMintRouterV3 } from '../mint-router-v3.js';
import { FEE_ROUTER_POLICY_HASH_HEX } from '../fee-router.js';

const key = byte => Keypair.fromSeed(new Uint8Array(32).fill(byte)).publicKey.toBase58();
const programId = key(1), mint = key(2), source = key(3);
const state = () => ({
  launches:{ [mint]:{ onchainVerified:true, cluster:'devnet',
    pumpFeeRoute:{ scope:'per-mint-v3',programId } } },
  collections:{ [source]:{ signature:source,mint,status:'collected',
    onchainVerified:true,programId } },
  v3Settlements:{ [source]:{ status:'finalized',mint,collectionSignature:source,
    allocationPlan:{ status:'allocated-not-funded',
      protocol:{ buybackLamports:'5000000000' } } } },
  v3BuybackOrders:{},
});

test('5 SOL trigger requires finalized vault custody matching the verified allocation', async () => {
  const input = state();
  const connection = { getMinimumBalanceForRentExemption:async () => 650_240,
    getAccountInfo:async () => ({ owner:SystemProgram.programId,
    data:Buffer.alloc(0),lamports:5_000_890_880 }) };
  const ready = await readV3BuybackDashboard({ state:input, programId, connection });
  assert.equal(ready.status,'verified');
  assert.equal(ready.collectedLamports,'5000000000');
  assert.equal(ready.triggerReached,true);
  assert.equal(ready.vaults.length,1);
  const underfunded = await readV3BuybackDashboard({ state:input,programId,
    reserveLamports:890_880n,
    connection:{ getAccountInfo:async () => ({ owner:SystemProgram.programId,
      data:Buffer.alloc(0),lamports:4_000_890_880 }) } });
  assert.equal(underfunded.status,'partial');
  assert.equal(underfunded.collectedLamports,null);
  assert.equal(underfunded.triggerReached,false);
  const missing = await readV3BuybackDashboard({ state:input,programId,
    reserveLamports:890_880n,
    connection:{ getAccountInfo:async () => null } });
  assert.equal(missing.status,'partial');
  assert.equal(missing.collectedLamports,null);
});

test('only proved V3 burn reduces the balance and supplies public proof', async () => {
  const input = state();
  input.v3BuybackOrders[source] = { status:'finalized',finalized:true,
    vaultDebitVerified:true,burnInstructionVerified:true,programId,
    signature:'3'.repeat(64),slot:123,burnedAt:'2026-10-14T00:00:00.000Z',
    spentLamports:'1000000000',burnedBaseUnits:'2000000' };
  const dashboard = await readV3BuybackDashboard({ state:input,programId,
    reserveLamports:890_880n,
    connection:{ getAccountInfo:async () => ({ owner:SystemProgram.programId,
      data:Buffer.alloc(0),lamports:4_000_890_880 }) } });
  assert.equal(dashboard.collectedLamports,'4000000000');
  assert.equal(dashboard.triggerReached,false);
  assert.equal(dashboard.lastBurn.signature,'3'.repeat(64));
  assert.equal(dashboard.lastBurn.burnedAt,'2026-10-14T00:00:00.000Z');
  input.v3BuybackOrders[`${source}:2`] = { status:'finalized',finalized:true,
    collectionSignature:source,round:2,vaultDebitVerified:true,
    burnInstructionVerified:true,programId,signature:'4'.repeat(64),
    slot:124,burnedAt:'2026-10-14T00:05:00.000Z',
    spentLamports:'500000000',burnedBaseUnits:'1000000' };
  const twoRounds = await readV3BuybackDashboard({ state:input,programId,
    reserveLamports:890_880n,connection:{ getAccountInfo:async () => ({
      owner:SystemProgram.programId,data:Buffer.alloc(0),lamports:3_500_890_880 }) } });
  assert.equal(twoRounds.collectedLamports,'3500000000');
  assert.equal(twoRounds.lastBurn.signature,'4'.repeat(64));
  input.v3BuybackOrders[source].burnInstructionVerified = false;
  delete input.v3BuybackOrders[`${source}:2`];
  const unproved = await readV3BuybackDashboard({ state:input,programId,
    reserveLamports:890_880n,
    connection:{ getAccountInfo:async () => ({ owner:SystemProgram.programId,
      data:Buffer.alloc(0),lamports:4_000_890_880 }) } });
  assert.equal(unproved.lastBurn,null);
  assert.equal(unproved.collectedLamports,null);
});

test('finalized on-chain vault funds without app records remain visible but cannot trigger execution', async () => {
  const policy = Buffer.alloc(249);
  Buffer.from('25d0c7eca736c38f', 'hex').copy(policy);
  Keypair.fromSeed(new Uint8Array(32).fill(2)).publicKey.toBuffer().copy(policy, 8);
  policy.writeUInt32LE(1_500_000, 104);
  policy.writeUInt32LE(500_000, 124);
  policy.writeBigUInt64LE(20_000_000n, 128);
  policy.writeBigUInt64LE(15_000_000n, 136);
  policy.writeBigUInt64LE(5_000_000n, 184);
  const policyAddress=deriveMintPolicyV3(programId,mint);
  policy[248]=policyAddress.bump;
  Keypair.fromSeed(new Uint8Array(32).fill(5)).publicKey.toBuffer().copy(policy,40);
  Keypair.fromSeed(new Uint8Array(32).fill(4)).publicKey.toBuffer().copy(policy,72);
  const router=deriveMintRouterV3(programId,mint);
  const routerData=Buffer.alloc(106);
  routerData.write('FUNDMNT3',0,'ascii');routerData[8]=3;
  Buffer.from(FEE_ROUTER_POLICY_HASH_HEX,'hex').copy(routerData,9);
  Keypair.fromSeed(new Uint8Array(32).fill(4)).publicKey.toBuffer().copy(routerData,41);
  Keypair.fromSeed(new Uint8Array(32).fill(2)).publicKey.toBuffer().copy(routerData,73);
  routerData[105]=router.bump;
  const account = { pubkey:deriveMintPolicyV3(programId,mint).address,
    account:{ data:policy } };
  let vaultLamports=5_650_240;
  const connection = {
    getMinimumBalanceForRentExemption:async () => 650_240,
    getProgramAccounts:async () => [account],
    getAccountInfo:async address => address.equals(router.address)
      ? {owner:new PublicKey(programId),data:routerData}
      : {owner:SystemProgram.programId,data:Buffer.alloc(0),lamports:vaultLamports},
  };
  const dashboard = await readV3BuybackDashboard({state:{v3Settlements:{},v3BuybackOrders:{}},
    programId,connection});
  assert.equal(dashboard.unindexedLamports,'5000000');
  assert.equal(dashboard.verifiedCustodyLamports,'5000000');
  assert.equal(dashboard.unindexedVaults.length,1);
  assert.equal(dashboard.collectedLamports,'0');
  assert.equal(dashboard.triggerReached,false);
  vaultLamports=4_650_240;
  const discrepancy = await readV3BuybackDashboard({state:{v3Settlements:{},v3BuybackOrders:{}},
    programId,connection});
  assert.equal(discrepancy.unindexedStatus,'partial');
  assert.equal(discrepancy.unindexedLamports,null);
  assert.equal(discrepancy.verifiedCustodyLamports,null);
  assert.equal(discrepancy.triggerReached,false);
  vaultLamports=5_650_240;
  routerData[105]^=1;
  const invalidRouter=await readV3BuybackDashboard({state:{v3Settlements:{},v3BuybackOrders:{}},
    programId,connection});
  assert.equal(invalidRouter.unindexedStatus,'partial');
  assert.equal(invalidRouter.verifiedCustodyLamports,null);
});
