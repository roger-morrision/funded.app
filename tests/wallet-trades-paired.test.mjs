import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Connection } from '@solana/web3.js';
import { getPumpAmmProgram } from '@pump-fun/pump-swap-sdk';
import { walletTradeRows } from '../server/wallet-trades.mjs';

// A Mainnet Jupiter buy of a USDC-paired Pump coin (SOL -> USDC -> coin). Its
// PumpSwap event names the wallet but comes from the coin/USDC pool.
const transaction = JSON.parse(readFileSync(new URL('./fixtures/mainnet-paired-jupiter-buy.json', import.meta.url)));
const wallet = 'ER7zhtSwfSu7B5Wb7uFwnWSZPLMmezmSXieY5JyLFzXC';

test('a SOL buy of a USDC-paired coin through Jupiter is recorded from the wallet balance changes', () => {
  const coder = getPumpAmmProgram(new Connection('http://127.0.0.1:1')).coder.events;
  const rows = walletTradeRows({ transaction, wallet, decodePoolEvent: coder.decode.bind(coder),
    reference: { signature: transaction.transaction.signatures[0], slot: transaction.slot, confirmationStatus: 'finalized' } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].side, 'buy');
  assert.equal(rows[0].route, 'swap');
  assert.equal(rows[0].mint.startsWith('85RhcS'), true);
  assert.equal(rows[0].tokenAmountRaw, '10001063510');
  assert.equal(rows[0].solLamports, '100474560');
});
