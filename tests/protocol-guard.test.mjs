import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Keypair, PublicKey } from '@solana/web3.js';
import { buildCancelRewardCycle, buildConfigureProtocolGuard, buildSetProtocolPause, deriveRouterHeader,
  MAINNET_REWARD_REVIEW_DELAY_SECONDS, MAINNET_ROUTER_LEN, parseProtocolGuard, plannedRewardPayoutAt,
  remainingDailyOutflow, REWARD_REVIEW_MARGIN_SECONDS, routerHeaderLength } from '../protocol-guard.js';
import { commitReviewedCycles } from '../server/reward-cycle-commit.mjs';
import { DENIED_ROUTER_INSTRUCTIONS } from '../server/signer-policy.mjs';
import { verifyFeeRouterAccount } from '../fee-router.js';

const anchor = name => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
const program = Keypair.generate().publicKey;

function header({ guardian, paused = false, cap = 1000n, day = 0, spent = 0n }) {
  const data = Buffer.alloc(MAINNET_ROUTER_LEN);
  data.write('FUNDFEE1', 0);
  guardian.toBuffer().copy(data, 74);
  data[106] = paused ? 1 : 0;
  data.writeBigUInt64LE(cap, 107); data.writeBigInt64LE(BigInt(day), 115); data.writeBigUInt64LE(spent, 123);
  return data;
}

test('Mainnet router header carries the guard after the 74-byte legacy header', () => {
  assert.equal(routerHeaderLength('devnet'), 74);
  assert.equal(routerHeaderLength('mainnet-beta'), 131);
  const guardian = Keypair.generate().publicKey;
  const guard = parseProtocolGuard(header({ guardian, paused: true, cap: 5000n, day: 20000, spent: 1200n }));
  assert.deepEqual(guard, { guardian: guardian.toBase58(), paused: true, dailyCapLamports: '5000', windowDay: 20000, windowSpentLamports: '1200' });
  assert.equal(parseProtocolGuard(Buffer.alloc(74)), null);
  assert.equal(remainingDailyOutflow(guard, 20000 * 86400 + 5), '3800');
  assert.equal(remainingDailyOutflow(guard, 20001 * 86400), '5000', 'a new UTC day resets the window');
});

test('reward payout times move past the review delay only on Mainnet', () => {
  const now = 1_800_000_000;
  assert.equal(plannedRewardPayoutAt('devnet', now - 60, now), now - 60);
  assert.equal(plannedRewardPayoutAt('mainnet-beta', now - 60, now), now + MAINNET_REWARD_REVIEW_DELAY_SECONDS + REWARD_REVIEW_MARGIN_SECONDS);
  assert.equal(plannedRewardPayoutAt('mainnet-beta', now + 3 * 86400, now), now + 3 * 86400);
});

test('guard instructions use the program discriminators and expected accounts', () => {
  const owner = Keypair.generate().publicKey, guardian = Keypair.generate().publicKey;
  const configure = buildConfigureProtocolGuard({ programId: program, upgradeOwner: owner, guardian, dailyCapLamports: '25000000000' });
  assert.deepEqual(configure.data.subarray(0, 8), anchor('configure_protocol_guard'));
  assert.equal(configure.data.readBigUInt64LE(8), 25_000_000_000n);
  assert.ok(configure.keys[0].isSigner && configure.keys[2].isWritable);
  assert.ok(configure.keys[2].pubkey.equals(deriveRouterHeader(program)));
  const loader = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
  assert.ok(configure.keys[4].pubkey.equals(PublicKey.findProgramAddressSync([program.toBuffer()], loader)[0]));
  const pause = buildSetProtocolPause({ programId: program, signer: guardian, paused: true });
  assert.deepEqual(pause.data, Buffer.concat([anchor('set_protocol_pause'), Buffer.from([1])]));
  const cancel = buildCancelRewardCycle({ programId: program, signer: guardian, reserve: owner, cycle: guardian });
  assert.deepEqual(cancel.data, anchor('cancel_reward_cycle'));
  assert.deepEqual(cancel.keys.map(key => key.isWritable), [false, false, false, false, true, true]);
  assert.throws(() => buildConfigureProtocolGuard({ programId: program, upgradeOwner: owner, guardian, dailyCapLamports: -1 }));
});

test('the app signer never signs guard administration', () => {
  for (const name of ['configure_protocol_guard', 'set_protocol_pause', 'cancel_reward_cycle'])
    assert.ok(DENIED_ROUTER_INSTRUCTIONS.includes(name), name);
});

test('a paused Mainnet router fails verification', async () => {
  const router = deriveRouterHeader(program);
  const [, bump] = PublicKey.findProgramAddressSync([Buffer.from('funded-fee-router-v1')], program);
  const prefix = Buffer.from('FUNDFEE1');
  const make = paused => {
    const data = header({ guardian: Keypair.generate().publicKey, paused });
    prefix.copy(data, 0); data[8] = 1;
    const hash = Buffer.from('0e057c44e5e3e33772e539c994cf73ed44c69ba7a8f57ba23fffa1c10b890e8b', 'hex'); hash.copy(data, 9);
    data[73] = bump;
    return { owner: program, data };
  };
  const connection = account => ({ getAccountInfo: async address => (address.equals(router) ? account : null) });
  const running = await verifyFeeRouterAccount({ connection: connection(make(false)), programId: program });
  assert.equal(running.verified, true, running.reason);
  assert.equal(running.guard.paused, false);
  const paused = await verifyFeeRouterAccount({ connection: connection(make(true)), programId: program });
  assert.equal(paused.verified, false);
  assert.equal(paused.reason, 'protocol-paused');
});

function memoryStore(schedules) {
  const state = { schedules };
  return { state, transaction: async fn => fn(state) };
}

test('Mainnet commits frozen reward cycles before payout; Devnet waits for payout time', async () => {
  const now = 1_800_000_000;
  const row = { id: 'a', status: 'prepared', manifest: { leaves: [] }, payoutAt: now + 86400 + 900 };
  const calls = [];
  const chain = { ensureCycle: async plan => { calls.push(plan.id); return { address: 'cycle-a', signature: 'sig' }; } };
  const devnet = memoryStore({ a: structuredClone(row) });
  assert.deepEqual(await commitReviewedCycles({ store: devnet, chain, cluster: 'devnet', now }), { committed: 0 });
  const mainnet = memoryStore({ a: structuredClone(row), b: { ...structuredClone(row), id: 'b', cycle: 'existing' } });
  assert.deepEqual(await commitReviewedCycles({ store: mainnet, chain, cluster: 'mainnet-beta', now }), { committed: 1 });
  assert.deepEqual(calls, ['a']);
  assert.equal(mainnet.state.schedules.a.cycle, 'cycle-a');
  assert.equal(mainnet.state.schedules.a.status, 'prepared', 'payout still waits for payoutAt');
  const failing = memoryStore({ a: structuredClone(row) });
  await commitReviewedCycles({ store: failing, chain: { ensureCycle: async () => { throw new Error('rpc down'); } }, cluster: 'mainnet-beta', now });
  assert.match(failing.state.schedules.a.reason, /rpc down/);
  assert.equal(failing.state.schedules.a.cycle, undefined);
});
