import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Keypair, PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { closeExpiredCommunityDrops, decodeCommunityDrop } from '../server/community-drop-closer.mjs';
import { communityAddresses } from '../server/community-claim-chain.mjs';

function dropBytes({ authority, appOwner, mint, total, claimed, expiresAt, closed }) {
  const bytes = Buffer.alloc(350);
  createHash('sha256').update('account:CommunityDrop').digest().subarray(0, 8).copy(bytes, 0);
  authority.toBuffer().copy(bytes, 8); appOwner.toBuffer().copy(bytes, 72); mint.toBuffer().copy(bytes, 104);
  bytes.writeBigUInt64LE(total, 312); bytes.writeBigUInt64LE(claimed, 320); bytes.writeBigInt64LE(BigInt(expiresAt), 336);
  bytes[348] = closed ? 1 : 0;
  return bytes;
}

function fixture({ expiresAt, closed = false, simulationErr = null }) {
  const programId = Keypair.generate().publicKey, authority = Keypair.generate(), mint = Keypair.generate().publicKey;
  const { drop } = communityAddresses({ programId, authority:authority.publicKey, mint:mint.toBase58() });
  const data = dropBytes({ authority:authority.publicKey, appOwner:authority.publicKey, mint, total:30n, claimed:4n, expiresAt, closed });
  let state = { communityDrops:{ [mint.toBase58()]:{ mint:mint.toBase58(), programId:programId.toBase58(),
    authority:authority.publicKey.toBase58(), openingSignature:'open' } } };
  const ledger = { read:async () => structuredClone(state), transaction:async fn => { const next = structuredClone(state); const out = fn(next); state = next; return out; } };
  const sent = [];
  const connection = {
    getAccountInfo:async key => key.equals(drop) ? { owner:programId, data } : key.equals(mint) ? { owner:TOKEN_2022_PROGRAM_ID } : null,
    getLatestBlockhash:async () => ({ blockhash:new PublicKey(Buffer.alloc(32, 7)).toBase58() }),
    simulateTransaction:async () => ({ value:{ err:simulationErr } }),
    sendRawTransaction:async raw => { sent.push(raw); return 'sig-' + sent.length; } };
  return { programId, authority, mint, drop, ledger, connection, sent, get state() { return state; } };
}

const quiet = { log() {}, error() {} };

test('decodes the CommunityDrop fields the closer depends on', () => {
  const authority = Keypair.generate().publicKey, mint = Keypair.generate().publicKey;
  const row = decodeCommunityDrop(dropBytes({ authority, appOwner:authority, mint, total:9n, claimed:2n, expiresAt:100, closed:true }));
  assert.equal(row.mint.toBase58(), mint.toBase58()); assert.equal(row.expiresAt, 100); assert.equal(row.closed, true);
  assert.equal(row.totalAmount - row.claimedAmount, 7n);
});

test('an expired open drop is closed once and returns the unclaimed amount to the app owner', async () => {
  const f = fixture({ expiresAt:1000 });
  const out = await closeExpiredCommunityDrops({ connection:f.connection, ledger:f.ledger, programId:f.programId,
    authority:f.authority, now:() => 1001, logger:quiet });
  assert.equal(out.length, 1); assert.equal(f.sent.length, 1);
  const record = f.state.communityDrops[f.mint.toBase58()];
  assert.equal(record.closingSignature, 'sig-1'); assert.equal(record.unclaimedBaseUnits, '26');
  await closeExpiredCommunityDrops({ connection:f.connection, ledger:f.ledger, programId:f.programId, authority:f.authority, now:() => 1002, logger:quiet });
  assert.equal(f.sent.length, 1, 'a fresh submission is not resent');
});

test('a drop still inside its window, already closed, or rejected in simulation is not sent', async () => {
  for (const [options, now] of [[{ expiresAt:1000 }, 999], [{ expiresAt:1000, closed:true }, 2000], [{ expiresAt:1000, simulationErr:{ Custom:1 } }, 2000]]) {
    const f = fixture(options);
    await closeExpiredCommunityDrops({ connection:f.connection, ledger:f.ledger, programId:f.programId, authority:f.authority, now:() => now, logger:quiet });
    assert.equal(f.sent.length, 0);
  }
});
