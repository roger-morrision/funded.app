import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { PublicKey } from '@solana/web3.js';
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PUMP_PROGRAM_ID } from '@pump-fun/pump-sdk';
import { PUMP_AMM_PROGRAM_ID, canonicalPumpPoolPda } from '@pump-fun/pump-swap-sdk';
import { captureExactCommunitySnapshot } from '../server/community-snapshot.mjs';

const migrationSlot = 1_000;
const mint = new PublicKey(Buffer.alloc(32, 1));
const launchMint = new PublicKey(Buffer.alloc(32, 2));
const holders = [3, 4].map(byte => new PublicKey(Buffer.alloc(32, byte)));
const accounts = [5, 6].map(byte => new PublicKey(Buffer.alloc(32, byte)));
const pool = canonicalPumpPoolPda(launchMint, NATIVE_MINT);

const discriminator = name => createHash('sha256').update('global:' + name).digest().subarray(0, 8);

function fixture({ baseAge, tipAge = baseAge, missing = null }) {
  const baseSlot = migrationSlot + baseAge;
  const transferSlot = migrationSlot + 1;
  const balances = amounts => amounts.map((value, accountIndex) => ({
    accountIndex, mint:mint.toBase58(), owner:holders[accountIndex].toBase58(), uiTokenAmount:{ amount:String(value) },
  }));
  const transfer = { transaction:{ message:{ accountKeys:accounts } },
    meta:{ preTokenBalances:balances([90, 10]), postTokenBalances:balances([60, 40]) } };
  const blocks = new Map(baseAge ? [
    [transferSlot, { parentSlot:migrationSlot, transactions:[transfer] }],
    [baseSlot, { parentSlot:transferSlot, transactions:[] }],
  ] : []);
  const mintData = Buffer.alloc(82);
  mintData.writeBigUInt64LE(100n, 36);
  mintData[45] = 1;
  const tokenData = holders.map((holder, index) => {
    const data = Buffer.alloc(165);
    mint.toBuffer().copy(data);
    holder.toBuffer().copy(data, 32);
    data.writeBigUInt64LE((baseAge ? [60n, 40n] : [90n, 10n])[index], 64);
    data[108] = 1;
    return data;
  });
  const reads = { base:0, blocks:0 };
  const connection = {
    async getTransaction() {
      return { slot:migrationSlot, blockTime:1_795_000_000, transaction:{ message:{
        accountKeys:[PUMP_PROGRAM_ID, PUMP_AMM_PROGRAM_ID, launchMint, pool, NATIVE_MINT],
        instructions:[{ programIdIndex:0, accounts:[2, 3], data:discriminator('migrate_v2') }],
      } }, meta:{ err:null, innerInstructions:[{ index:0, instructions:[
        { programIdIndex:1, accounts:[3, 0, 0, 2, 4], data:discriminator('create_pool') },
      ] }] } };
    },
    async getAccountInfo(address) {
      assert(address.equals(pool));
      return { owner:PUMP_AMM_PROGRAM_ID };
    },
    async getSlot() { return migrationSlot + tipAge; },
    async getTokenLargestAccounts() {
      reads.base += 1;
      return { context:{ slot:baseSlot }, value:accounts.map(address => ({ address })) };
    },
    async getMultipleAccountsInfoAndContext(keys) {
      assert.deepEqual(keys, [mint, ...accounts]);
      return { context:{ slot:baseSlot }, value:[mintData, ...tokenData].map(data => ({ owner:TOKEN_PROGRAM_ID, data })) };
    },
    async getBlocks(start, end, commitment) {
      reads.blocks += 1;
      assert.deepEqual([start, end, commitment], [transferSlot, baseSlot, 'finalized']);
      return [...blocks.keys()].filter(slot => missing !== 'all'
        && !(missing === 'interior' && slot === transferSlot)
        && !(missing === 'base' && slot === baseSlot));
    },
    async getParsedBlock(slot) { return missing === 'unavailable' && slot === transferSlot ? null : blocks.get(slot); },
  };
  return { reads, capture:() => captureExactCommunitySnapshot({ connection, mint, launchMint, migrationSignature:'fixture' }) };
}

for (const baseAge of [0, 255, 256]) {
  test('reconstructs migration-slot holdings with a finalized base ' + baseAge + ' slots later', async () => {
    const snapshot = await fixture({ baseAge }).capture();
    assert.equal(snapshot.slot, migrationSlot);
    assert.equal(snapshot.baseSlot, migrationSlot + baseAge);
    assert.equal(snapshot.replayedBlocks, baseAge ? 2 : 0);
    assert.equal(snapshot.supplyBaseUnits, '100');
    assert.deepEqual(Object.fromEntries(snapshot.accounts.map(row => [row.wallet, row.balance])),
      { [holders[0].toBase58()]:'90', [holders[1].toBase58()]:'10' });
  });
}

test('requires archival evidence when the finalized tip is 257 slots past migration', async () => {
  const { capture, reads } = fixture({ baseAge:257 });
  await assert.rejects(capture, /archival exact-slot snapshot is required/);
  assert.deepEqual(reads, { base:0, blocks:0 });
});

test('requires archival evidence when the holder base advances past the 256-slot window', async () => {
  const { capture, reads } = fixture({ baseAge:257, tipAge:256 });
  await assert.rejects(capture, /archival exact-slot snapshot is required/);
  assert.deepEqual(reads, { base:1, blocks:0 });
});

for (const missing of ['interior', 'base', 'all']) {
  test('rejects a finalized block list missing ' + missing + ' history', async () => {
    await assert.rejects(fixture({ baseAge:256, missing }).capture(), /Finalized replay history is incomplete/);
  });
}

test('rejects an unavailable block advertised in the finalized block list', async () => {
  await assert.rejects(fixture({ baseAge:256, missing:'unavailable' }).capture(), /Finalized block 1001 is unavailable/);
});
