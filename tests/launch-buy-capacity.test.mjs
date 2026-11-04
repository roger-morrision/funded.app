import test from 'node:test';
import assert from 'node:assert/strict';
import BN from 'bn.js';
import { OnlinePumpSdk } from '@pump-fun/pump-sdk';
import { getInitialBuyQuote, normalizeInitialBuy } from '../launch-flow.js';
import { quoteAtomicReserveBuy } from '../launch-community-reserve.js';
import { createLaunchPolicyController } from '../src/app/controllers/launch-policy.js';

const input = { name: 'Capacity', symbol: 'CAP', supply: 1_000_000_000, decimals: 6, reserveTokens: 30_000_000 };
function fixture(t, { realTokens = 793_100_000, virtualSolLamports = 300_000_000 } = {}) {
  const global = {
    initialVirtualTokenReserves: new BN('1073000000000000'),
    initialVirtualSolReserves: new BN(virtualSolLamports),
    initialRealTokenReserves: new BN(realTokens).mul(new BN(1_000_000)),
    tokenTotalSupply: new BN('1000000000000000'),
    feeBasisPoints: new BN(95), creatorFeeBasisPoints: new BN(5),
    mayhemModeEnabled: false, creatorFeeConfigurable: false,
  };
  t.mock.method(OnlinePumpSdk.prototype, 'fetchGlobal', async () => global);
  return { connection: {}, global };
}

test('a developer purchase below 20% is quoted and the community reserve is separate', async t => {
  const { connection } = fixture(t);
  const developer = await getInitialBuyQuote({ connection, input: { ...input, initialBuySol: 0.06 } });
  assert.ok(developer.percent > 17 && developer.percent < 20);
  const combined = await quoteAtomicReserveBuy({ connection, ...input, developerBaseUnits: developer.amountBaseUnits });
  assert.equal(combined.amountBaseUnits, developer.amountBaseUnits + 30_000_000_000_000n);
  assert.ok(combined.solAmountLamports > developer.solAmountLamports);
});

test('exactly 20% is accepted with a separate community reserve; one base unit above is rejected', async t => {
  const { connection } = fixture(t);
  const developer = await getInitialBuyQuote({ connection, input: { ...input, initialBuyPercent: 20 } });
  assert.equal(developer.amountBaseUnits, 200_000_000_000_000n);
  const combined = await quoteAtomicReserveBuy({ connection, ...input, developerBaseUnits: developer.amountBaseUnits });
  assert.equal(combined.amountBaseUnits, 230_000_000_000_000n);
  await assert.rejects(quoteAtomicReserveBuy({ connection, ...input, developerBaseUnits: developer.amountBaseUnits + 1n }), /cannot exceed 20%/);
  for (const initialBuyPercent of [20.001, 20.01, 76.31])
    await assert.rejects(getInitialBuyQuote({ connection, input: { ...input, initialBuyPercent } }), /between 0% and 20%/);
  const largeReserve = await quoteAtomicReserveBuy({ connection, ...input, reserveTokens: 500_000_000, developerBaseUnits: developer.amountBaseUnits });
  assert.equal(largeReserve.amountBaseUnits, 700_000_000_000_000n);
});

test('SOL limit errors give an executable six-decimal amount and reject the next increment', async t => {
  const { connection } = fixture(t);
  let error;
  try { await getInitialBuyQuote({ connection, input: { ...input, initialBuySol: 1 } }); }
  catch (caught) { error = caught; }
  assert.match(error?.message || '', /Developer buy cannot exceed 20%/);
  const limit = Number(error.message.match(/Enter ([\d.]+) SOL/)[1]);
  assert.equal(limit, 0.069415);
  const developer = await getInitialBuyQuote({ connection, input: { ...input, initialBuySol: limit } });
  assert.ok(developer.amountBaseUnits <= 200_000_000_000_000n);
  await quoteAtomicReserveBuy({ connection, ...input, developerBaseUnits: developer.amountBaseUnits });
  await assert.rejects(getInitialBuyQuote({ connection, input: { ...input, initialBuySol: Number((limit + 0.000001).toFixed(6)) } }), /cannot exceed 20%/);
});

test('community allocation and live curve inventory both reduce the developer capacity', async t => {
  const { connection } = fixture(t, { realTokens: 600_000_000 });
  const configured = { ...input, reserveTokens: 500_000_000 };
  const developer = await getInitialBuyQuote({ connection, input: { ...configured, initialBuyPercent: 10 } });
  assert.equal(developer.amountBaseUnits, 100_000_000_000_000n);
  await assert.rejects(getInitialBuyQuote({ connection, input: { ...configured, initialBuyPercent: 10.01 } }), /available launch supply/);
  await assert.rejects(quoteAtomicReserveBuy({ connection, ...configured, developerBaseUnits: developer.amountBaseUnits + 1n }), /available launch supply/);
  await assert.rejects(getInitialBuyQuote({ connection, input: { ...configured, initialBuySol: 0.06 } }), /available launch supply/);
  await assert.rejects(quoteAtomicReserveBuy({ connection, ...input, reserveTokens: 600_000_001 }), /Community reserve exceeds/);
});

test('oversized SOL requests are rejected even when the SDK clamps output to the whole curve', async t => {
  const { connection } = fixture(t);
  await assert.rejects(getInitialBuyQuote({ connection, input: { ...input, reserveTokens: 0, initialBuySol: 100 } }), /cannot exceed 20%/);
});

test('mainnet-sized reserves enforce the same 20% cap at a larger SOL quote', async t => {
  const { connection } = fixture(t, { virtualSolLamports: 30_000_000_000 });
  const developer = await getInitialBuyQuote({ connection, input: { ...input, initialBuySol: 6 } });
  assert.ok(developer.percent > 17 && developer.percent < 20);
  await assert.rejects(getInitialBuyQuote({ connection, input: { ...input, initialBuySol: 10 } }), /cannot exceed 20%/);
  assert.throws(() => normalizeInitialBuy({ ...input, initialBuyPercent: 20.001 }));
});

test('UI limit detection blocks holdings above 20% and recognizes both limit errors', () => {
  const state = { estimatedInitialBuyTokens: 500_000_000, LAUNCH_TOKEN_SUPPLY: 1_000_000_000, walletEstimateError: '' };
  const controller = createLaunchPolicyController(state);
  assert.equal(controller.developerBuyLimitReached(), true);
  state.estimatedInitialBuyTokens = 200_000_000;
  assert.equal(controller.developerBuyLimitReached(), false);
  assert.equal(controller.developerBuyLimitReached('Developer buy cannot exceed 20% of the token supply.'), true);
  state.walletEstimateError = 'Developer buy exceeds the available launch supply. Enter 0.7 SOL or less after the community reserve.';
  assert.equal(controller.developerBuyLimitReached(), true);
  assert.equal(controller.developerBuyLimitReached('RPC unavailable'), false);
});
