import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {setImmediate} from 'node:timers/promises';
import {Keypair, PublicKey} from '@solana/web3.js';
import {getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID} from '@solana/spl-token';
import bs58 from 'bs58';
import {createAirdropsRoutes} from '../../server/routes/airdrops.mjs';
import {DEVNET_GENESIS_HASH, rewardAddresses} from '../../server/automatic-reward-chain.mjs';
import {SharedRpcConnection} from '../../server/rpc-connection.mjs';

const key = byte => new PublicKey(new Uint8Array(32).fill(byte));
const loader = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const program = key(31), programDataAddress = key(32);
// Deterministic public identities only; no fixture signs or persists a keypair.
const authority = Keypair.fromSeed(new Uint8Array(32).fill(2)).publicKey;
const creator = Keypair.fromSeed(new Uint8Array(32).fill(3)).publicKey;
const programData = Buffer.alloc(64, 9);
programData.writeUInt32LE(3); programData.writeBigUInt64LE(123n, 4); programData[12] = 0;
const expectedHash = createHash('sha256').update(programData).digest('hex');
const disc = name => createHash('sha256').update('account:' + name).digest().subarray(0, 8);
const reservedTokens = 30_000_000, required = BigInt(reservedTokens) * 1_000_000n;

export function reserveEnvironment(t) {
  const values = {SOLANA_CLUSTER:'devnet', VITE_SOLANA_CLUSTER:'devnet',
    FUNDED_V3_FEE_ROUTER_PROGRAM_ID:program.toBase58(), FUNDED_V3_PROGRAM_DATA_SHA256:expectedHash,
    FUNDED_V3_COMMUNITY_ACCOUNT_SETUP:'program', FUNDED_PROGRAM_EVIDENCE_RPC_URL:'',
    FUNDED_COMMUNITY_RESERVE_RECEIPTS_JSON:'{}'};
  const saved = Object.fromEntries(Object.keys(values).map(name => [name, process.env[name]]));
  Object.assign(process.env, values);
  t.after(() => { for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  } });
  t.mock.method(globalThis, 'fetch', () => assert.fail('A deterministic reserve fixture attempted network access'));
}

export async function mustComplete(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Selected result remained behind a controlled directory gate')), 2000);
  })]); } finally { clearTimeout(timer); }
}

export function reserveFixture({rows = 2, variant = 'funded'} = {}) {
  const f = {variant, connections:0, storeReads:0, counts:{}, active:0, peak:0, events:[], gates:new Map()};
  const identities = Array.from({length:rows}, (_, index) => {
    const mint = key(50 + index), vault = rewardAddresses({programId:program, authority, mint}).vault;
    return {mint, vault, token:getAssociatedTokenAddressSync(mint, vault, true, TOKEN_2022_PROGRAM_ID),
      source:getAssociatedTokenAddressSync(mint, creator, false, TOKEN_2022_PROGRAM_ID),
      signature:bs58.encode(Buffer.alloc(64, index + 1))};
  });
  f.rows = identities; f.target = identities[0];
  f.state = {launches:Object.fromEntries(identities.map(row => [row.mint.toBase58(), {
    mint:row.mint.toBase58(), onchainVerified:true, cluster:'devnet', creatorWallet:creator.toBase58(),
    pumpFeeRoute:{scope:'per-mint-v3', verified:true, programId:program.toBase58(), initialAuthority:authority.toBase58()},
    communityAirdrop:{reservedTokens},
  }])), communityReserveReceipts:Object.fromEntries(identities.map(row => [row.mint.toBase58(), {signature:row.signature}]))};
  if (variant === 'no-recorded-proof') f.state.communityReserveReceipts = {};
  if (variant === 'wrong-program') f.state.launches[f.target.mint.toBase58()].pumpFeeRoute.programId = key(30).toBase58();
  const info = (owner, data, executable = false) => ({owner, data, executable, lamports:100});
  function account(address, options) {
    if (address.equals(program)) {
      const data = Buffer.alloc(36); data.writeUInt32LE(2); programDataAddress.toBuffer().copy(data, 4);
      return info(loader, data, f.variant !== 'non-executable-program');
    }
    if (address.equals(programDataAddress)) {
      // Exercise the full finalized ProgramData parser on every scope; unavailable
      // optional header reads must not substitute for the pinned full-account hash.
      if (options?.dataSlice) return null;
      const data = Buffer.from(programData);
      if (f.variant === 'wrong-programdata-hash') data[63] ^= 1;
      return info(f.variant === 'wrong-programdata-owner' ? key(33) : loader, data);
    }
    for (const row of identities) {
      if (address.equals(row.mint)) { const data = Buffer.alloc(82); data[44] = 6; return info(TOKEN_2022_PROGRAM_ID, data); }
      if (address.equals(row.vault)) {
        const data = Buffer.alloc(73); disc('RewardVault').copy(data); authority.toBuffer().copy(data, 8); row.mint.toBuffer().copy(data, 40);
        return info(f.variant === 'wrong-vault-owner' ? key(34) : program, data);
      }
      if (address.equals(row.token)) {
        const data = Buffer.alloc(165); row.mint.toBuffer().copy(data); row.vault.toBuffer().copy(data, 32);
        data.writeBigUInt64LE(f.variant === 'partial' ? required / 2n : required, 64); data[108] = 1;
        return info(TOKEN_2022_PROGRAM_ID, data);
      }
    }
    return null; // No CommunityDrop exists in this pre-opening funded fixture.
  }
  function transaction(signature) {
    if (f.variant === 'missing-proof') return null;
    const row = identities.find(item => item.signature === signature); assert.ok(row);
    const amount = (accountIndex, value) => ({accountIndex, mint:row.mint.toBase58(), uiTokenAmount:{amount:String(value)}});
    const data = Buffer.alloc(10); data[0] = 12; data.writeBigUInt64LE(required, 1); data[9] = 6;
    return {slot:700, meta:{err:f.variant === 'rejected-proof' ? {InstructionError:[0, 'InvalidArgument']} : null,
      preTokenBalances:[amount(1, required + 50n), amount(2, 0n)],
      postTokenBalances:[amount(1, 50n), amount(2, f.variant === 'wrong-transfer-delta' ? required - 1n : required)]},
    transaction:{message:{header:{numRequiredSignatures:1}, accountKeys:[creator, row.source, row.token, row.mint, TOKEN_2022_PROGRAM_ID],
      instructions:[{programIdIndex:4, accounts:[1, 3, 2, 0], data:bs58.encode(data)}]}}};
  }
  async function invoke(id, method, args, read) {
    f.counts[method] = (f.counts[method] || 0) + 1; f.active++; f.peak = Math.max(f.peak, f.active);
    f.events.push({id, method, address:args[0]?.toBase58?.() || null});
    try {
      const value = read(); // Capture the observed account before a deliberate hold.
      const gate = f.gates.get(id + ':' + args[0]?.toBase58?.());
      if (gate) { gate.entered.resolve(); await gate.release.promise; }
      await setImmediate();
      return value;
    } finally { f.active--; }
  }
  f.connection = () => {
    const id = f.connections++;
    return {
      getGenesisHash:() => invoke(id, 'getGenesisHash', [], () => f.variant === 'wrong-genesis' ? 'wrong-genesis' : DEVNET_GENESIS_HASH),
      getAccountInfo:(...args) => invoke(id, 'getAccountInfo', args, () => account(...args)),
      getSignatureStatus:(...args) => invoke(id, 'getSignatureStatus', args, () => ({value:f.variant === 'missing-status' ? null
        : {confirmationStatus:f.variant === 'unfinalized-proof' ? 'confirmed' : 'finalized', err:null}})),
      getTransaction:(...args) => invoke(id, 'getTransaction', args, () => transaction(args[0])),
    };
  };
  f.hold = (id, address = f.target.token) => {
    const gate = {entered:Promise.withResolvers(), release:Promise.withResolvers()};
    f.gates.set(id + ':' + address.toBase58(), gate); return gate;
  };
  f.releaseAll = () => { for (const gate of f.gates.values()) gate.release.resolve(); };
  f.bindReceiptRpc = t => {
    const rpc = f.connection();
    for (const name of Object.keys(rpc)) t.mock.method(SharedRpcConnection.prototype, name, (...args) => rpc[name](...args));
  };
  const store = {read:async () => { f.storeReads++; return structuredClone(f.state); },
    readLaunch:async mint => structuredClone(f.state.launches[mint]),
    update:async update => update(f.state), chargeRpcRate:async () => true};
  const {handle} = createAirdropsRoutes({solanaCluster:'devnet', solanaRpcUrl:'https://rpc.fixture.invalid', store,
    automaticRewardStore:{read:async () => ({})}, fundedTokenMint:key(20).toBase58(),
    makeReserveConnection:f.connection, v3AuthorityKeypair:() => ({publicKey:authority}),
    clientKey:() => 'fixture-client', body:async req => req.input,
    respond:(res, status, data) => Object.assign(res, {status, data})});
  f.request = async (mint = null) => {
    const res = {}; assert.equal(await handle({method:'GET'}, res,
      new URL('/api/airdrops/reserves' + (mint ? '?mint=' + mint : ''), 'https://fixture.invalid')), true); return res;
  };
  f.selected = () => f.request(f.target.mint.toBase58());
  f.recordReceipt = async () => {
    const res = {}; assert.equal(await handle({method:'POST', input:{mint:f.target.mint.toBase58(), signature:f.target.signature}},
      res, new URL('/api/airdrops/reserves/receipt', 'https://fixture.invalid')), true); assert.equal(res.status, 200); return res;
  };
  f.snapshot = () => ({...f.counts});
  return f;
}

export function assertFunded(response, row) {
  assert.equal(response.status, 200); assert.equal(response.data.cluster, 'devnet');
  const reserve = response.data.reserves.find(item => item.mint === row.mint.toBase58());
  assert.ok(reserve); assert.equal(reserve.status, 'funded'); assert.equal(reserve.verified, true);
  assert.equal(reserve.reservedTokens, reservedTokens); assert.equal(reserve.fundingSignature, row.signature);
  assert.equal(reserve.fundedTokens, String(reservedTokens)); assert.equal(reserve.tokenAccount, row.token.toBase58());
  assert.equal(reserve.vault, row.vault.toBase58()); assert.equal(reserve.programId, program.toBase58());
  assert.equal(reserve.authority, authority.toBase58()); assert.equal(reserve.scope, 'per-mint-v3');
  return reserve;
}
