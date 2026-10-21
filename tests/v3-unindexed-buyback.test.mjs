import test from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import { Keypair, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync,
  NATIVE_MINT, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PUMP_AMM_PROGRAM_ID } from '@pump-fun/pump-swap-sdk';
import { deriveMintPolicyV3, deriveMintVaultsV3 } from '../mint-router-v3.js';
import { V3_DEVNET_FUNDED_MINT, V3_DEVNET_FUNDED_POOL,
  v3BuybackOnchainId } from '../server/v3-buyback-instruction.mjs';
import { finalizedUnindexedV3Budget } from '../server/v3-unindexed-buyback.mjs';
import { createV3BuybackRoutes } from '../server/routes/v3-buyback.mjs';

const key = byte => Keypair.fromSeed(new Uint8Array(32).fill(byte));
const authority = key(42), creator = key(41), program = key(43), mint = key(44);
const programId = program.publicKey.toBase58(), mintAddress = mint.publicKey.toBase58();
const vault = deriveMintVaultsV3(programId, mintAddress)[6];
const policyAddress = deriveMintPolicyV3(programId, mintAddress);
const reserve = 650_240;

function policyBytes() {
  const bytes = Buffer.alloc(249);
  Buffer.from('25d0c7eca736c38f', 'hex').copy(bytes);
  mint.publicKey.toBuffer().copy(bytes, 8);
  creator.publicKey.toBuffer().copy(bytes, 40);
  authority.publicKey.toBuffer().copy(bytes, 72);
  bytes.writeUInt32LE(1_500_000, 104);
  bytes.writeUInt32LE(500_000, 124);
  bytes.writeBigUInt64LE(10_000_000n, 128);
  bytes.writeBigUInt64LE(5_000_000n, 136);
  bytes.writeBigUInt64LE(5_000_000n, 184);
  bytes[248] = policyAddress.bump;
  return bytes;
}

function fixture() {
  const policy = policyBytes();
  let vaultLamports = reserve + 5_000_000;
  let readiness = true, trigger = true, scanAvailable = true, submitted = 0;
  const lookupAddress = key(120).publicKey;
  const addresses = Array.from({ length:25 }, (_, index) => key(index + 60).publicKey);
  for(const [ownerIndex,ataIndex] of [[9,10],[18,17],[23,24]])
    addresses[ataIndex]=getAssociatedTokenAddressSync(NATIVE_MINT,addresses[ownerIndex],true);
  const baseAta = getAssociatedTokenAddressSync(V3_DEVNET_FUNDED_MINT, vault, true);
  const quoteAta = getAssociatedTokenAddressSync(NATIVE_MINT, vault, true);
  for (const [index, value] of [[0,V3_DEVNET_FUNDED_POOL],[1,vault],
    [3,V3_DEVNET_FUNDED_MINT],[4,NATIVE_MINT],[5,baseAta],[6,quoteAta],
    [11,TOKEN_PROGRAM_ID],[12,TOKEN_PROGRAM_ID],[13,SystemProgram.programId],
    [14,ASSOCIATED_TOKEN_PROGRAM_ID],[16,PUMP_AMM_PROGRAM_ID]]) addresses[index] = value;
  const pumpBuyInstruction = new TransactionInstruction({ programId:PUMP_AMM_PROGRAM_ID,
    keys:addresses.map((pubkey, index) => ({ pubkey, isSigner:index === 1,
      isWritable:index === 1 })), data:Buffer.from([102,6,61,18,1,218,235,234]) });
  const state = { v3Settlements:{}, v3BuybackOrders:{} };
  const responses = [];
  const connection = {
    getBalance:async()=>4000000000,getFeeForMessage:async()=>({value:5000}),
    getAccountInfo:async address => address.equals(policyAddress.address)
      ? { owner:program.publicKey, data:policy }
      : address.equals(vault)
        ? { owner:SystemProgram.programId, data:Buffer.alloc(0), lamports:vaultLamports }
        : null,
    getMinimumBalanceForRentExemption:async () => reserve,
    getAddressLookupTable:async () => ({ value:{ key:lookupAddress,
      state:{ addresses:addresses.filter(address => !address.equals(vault)) } } }),
    getLatestBlockhash:async () => ({ blockhash:key(121).publicKey.toBase58() }),
    getSignatureStatuses:async () => ({ value:[null] }),
  };
  const route = createV3BuybackRoutes({ body:async req => req.input,
    store:{ read:async () => state, update:async callback => callback(state) },
    solanaCluster:'devnet', solanaRpcUrl:'https://unused.invalid',
    v3AuthorityKeypair:() => authority,
    respond:(_res, status, data) => responses.push({ status, data }),
    env:{ FUNDED_V3_BUYBACK_ENABLED:'true', FUNDED_V3_FEE_ROUTER_PROGRAM_ID:programId,
      FUNDED_V3_PROGRAM_DATA_SHA256:'a'.repeat(64),
      FUNDED_V3_BUYBACK_LOOKUP_TABLE:lookupAddress.toBase58() },
    originAllowed:() => true, connectionFactory:() => connection,
    verifyReadiness:async () => ({ ready:readiness }),
    readDashboard:async () => { if (!scanAvailable) throw new Error('scan unavailable');
      return { status:'verified', unindexedStatus:'verified',
      triggerReached:trigger, unindexedVaults:[{ mint:mintAddress,
        creator:creator.publicKey.toBase58(),
        initialAuthority:authority.publicKey.toBase58(),
        address:vault.toBase58(), status:'verified',
        pendingLamports:String(BigInt(policy.readBigUInt64LE(184))
          - BigInt(policy.readBigUInt64LE(240))) }] }; },
    quote:async ({ budgetLamports }) => ({ pumpBuyInstruction,
      baseTokenProgram:TOKEN_PROGRAM_ID, spendableQuoteIn:'1000000',
      minBaseAmountOut:'1', maxTotalDebit:budgetLamports }),
    submit:async ({ transaction }) => { submitted++;
      return bs58.encode(transaction.signatures[0]); },
    loadProof:async ({ signature }) => ({ signature, slot:123,
      spentLamports:'1000000', burnedBaseUnits:'1', finalized:true,
      vaultDebitVerified:true, burnInstructionVerified:true }),
  });
  return { state, policy, responses, connection,
    setVault:value => { vaultLamports = value; },
    setReadiness:value => { readiness = value; },
    setTrigger:value => { trigger = value; },
    setScan:value => { scanAvailable = value; },
    submitted:() => submitted,
    request:() => route({ method:'POST', input:{}, headers:{} }, {},
      new URL(`/api/tokens/${mintAddress}/v3-buyback/onchain`, 'https://funded.vip')) };
}

test('on-chain source has a separate deterministic receipt namespace', () => {
  assert.equal(v3BuybackOnchainId(mintAddress, 1).length, 32);
  assert.notDeepEqual(v3BuybackOnchainId(mintAddress, 1), v3BuybackOnchainId(mintAddress, 2));
});

test('unindexed budget requires finalized policy identity and exact vault balance', async () => {
  const f = fixture();
  const input = { connection:f.connection, programId, mint:mintAddress,
    creator:creator.publicKey.toBase58(), initialAuthority:authority.publicKey.toBase58() };
  assert.equal((await finalizedUnindexedV3Budget(input)).remaining, 5_000_000n);
  f.setVault(reserve + 4_999_999);
  assert.equal(await finalizedUnindexedV3Budget(input), null);
  f.setVault(reserve + 5_000_000);
  f.policy[248] ^= 1;
  assert.equal(await finalizedUnindexedV3Budget(input), null);
});

test('Devnet on-chain route signs only after approved program, vault, and trigger checks', async () => {
  const f = fixture();
  f.setReadiness(false);
  await f.request();
  assert.equal(f.responses.at(-1).status, 409);
  f.setReadiness(true);
  f.setVault(reserve + 4_000_000);
  await f.request();
  assert.equal(f.responses.at(-1).status, 409);
  f.setVault(reserve + 5_000_000);
  f.setTrigger(false);
  await f.request();
  assert.equal(f.responses.at(-1).status, 409);
  assert.equal(f.submitted(), 0);
  f.setTrigger(true);
  await f.request();
  assert.equal(f.responses.at(-1).status, 200);
  assert.equal(f.submitted(), 1);
  const order = f.state.v3BuybackOrders[`onchain:${mintAddress}`];
  assert.equal(order.status, 'finalized');
  assert.equal(order.sourceKind, 'onchain-policy');
  assert.equal(order.maxTotalDebit, '5000000');
  assert.equal(order.burnInstructionVerified, true);
  order.status='verification-pending';
  order.finalized=false;
  f.setScan(false);
  await f.request();
  assert.equal(f.responses.at(-1).status, 200,
    'A recorded signature can be reconciled while the full vault scan is unavailable.');
  assert.equal(f.submitted(), 1);
});

test('on-chain route rejects a mint with indexed settlements', async () => {
  const f = fixture();
  f.state.v3Settlements.indexed = { mint:mintAddress };
  await f.request();
  assert.equal(f.responses.at(-1).status, 409);
  assert.equal(f.submitted(), 0);
});
