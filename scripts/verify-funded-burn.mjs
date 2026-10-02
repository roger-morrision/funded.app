import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { burnedSupplyBaseUnits, formatTokenBaseUnits, parseTokenAmount, planTokenAccountBurns, projectBurnMemo, waitForSignatureConfirmation } from '../funded-burn.js';
import { readVerifiedBurnChecked } from '../server/burn-verification.mjs';
const burnDashboardSource = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
assert.match(burnDashboardSource, /buybackNetworkState\.status === 'unavailable' && verifiedLaunchPoliciesStatus !== 'ready' && !fundedBurnState\.receiptIndexAvailable[\s\S]*?\? 'Receipt index unavailable'/, 'The burn ledger must not display a verified zero when all receipt sources are unavailable.');

assert.equal(parseTokenAmount('1', 6), 1_000_000n);
assert.equal(parseTokenAmount('0.000001', 6), 1n);
assert.throws(() => parseTokenAmount('0', 6), /above zero/);
assert.throws(() => parseTokenAmount('1.0000001', 6), /no more than 6/);
assert.equal(formatTokenBaseUnits(998_800_000_000_000n, 6), '998800000');
assert.equal(burnedSupplyBaseUnits(998_800_000_000_000n, 6), 1_200_000_000_000n);
assert.deepEqual(planTokenAccountBurns([{ address:'a', amount:15n }, { address:'b', amount:15n }], 25n), [
  { address:'a', amount:15n }, { address:'b', amount:10n },
]);
assert.throws(() => planTokenAccountBurns([{ address:'a', amount:15n }], 25n), /exceeds/);
const confirmed = await waitForSignatureConfirmation({ getSignatureStatuses: async () => ({ value: [{ err: null, confirmationStatus: 'confirmed' }] }) }, { signature: 'fixture', pollIntervalMs: 0 });
assert.equal(confirmed.value.err, null);

const wallet = PublicKey.unique().toBase58();
const mint = PublicKey.unique().toBase58();
const tokenAccount = PublicKey.unique().toBase58();
const secondTokenAccount = PublicKey.unique().toBase58();
const amount = '25000000000';
const firstAmount = '15000000000';
const secondAmount = '10000000000';
const memo = projectBurnMemo(PublicKey.unique().toBase58());
const transaction = {
  slot: 123,
  transaction: { message: {
    accountKeys: [{ pubkey: new PublicKey(wallet), signer: true }, { pubkey: new PublicKey(tokenAccount) }, { pubkey: new PublicKey(secondTokenAccount) }],
    instructions: [{
      programId: TOKEN_PROGRAM_ID,
      parsed: { type: 'burnChecked', info: { account: tokenAccount, mint, authority: wallet, tokenAmount: { amount:firstAmount, decimals: 6 } } },
    }, {
      programId: TOKEN_PROGRAM_ID,
      parsed: { type: 'burnChecked', info: { account: secondTokenAccount, mint, authority: wallet, tokenAmount: { amount:secondAmount, decimals: 6 } } },
    }, { programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'), parsed:memo }],
  } },
  meta: {
    err: null,
    preTokenBalances: [{ accountIndex: 1, mint, owner: wallet, uiTokenAmount: { amount: '15000000000', decimals: 6 } }, { accountIndex: 2, mint, owner: wallet, uiTokenAmount: { amount: '15000000000', decimals: 6 } }],
    postTokenBalances: [{ accountIndex: 1, mint, owner: wallet, uiTokenAmount: { amount: '0', decimals: 6 } }, { accountIndex: 2, mint, owner: wallet, uiTokenAmount: { amount: '5000000000', decimals: 6 } }],
  },
};
const proof = readVerifiedBurnChecked(transaction, { fundedMint: mint, wallet, amountBaseUnits: amount, expectedMemo:memo });
assert.equal(proof.amountBaseUnits, amount);
assert.equal(proof.decimals, 6);
assert.deepEqual(proof.tokenAccounts, [tokenAccount, secondTokenAccount]);
assert.throws(() => readVerifiedBurnChecked(transaction, { fundedMint: mint, wallet, amountBaseUnits: '1' }), /does not match/);
assert.throws(() => readVerifiedBurnChecked(transaction, { fundedMint: mint, wallet: PublicKey.unique().toBase58() }), /fee payer/);
assert.throws(() => readVerifiedBurnChecked(transaction, { fundedMint: mint, wallet, expectedMemo:projectBurnMemo(PublicKey.unique().toBase58()) }), /not bound/);

const appSource = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const serverSource = readFileSync(new URL('../server/index.mjs', import.meta.url), 'utf8');
const composeSource = readFileSync(new URL('../compose.preview.yml', import.meta.url), 'utf8');
assert.match(appSource, /createBurnCheckedInstruction/);
assert.match(appSource, /waitForSignatureConfirmation/);
assert.match(appSource, /Devnet RPC unavailable; \$FUNDED mint and balance could not be verified\./, 'Burn UI must explain RPC outages without exposing raw transport errors.');
assert.match(serverSource, /verifyFundedBurn/);
assert.match(serverSource, /process\.env\.FUNDED_TOKEN_MINT \|\| process\.env\.VITE_FUNDED_TOKEN_MINT/);
assert.match(composeSource, /FUNDED_TOKEN_MINT: \$\{FUNDED_TOKEN_MINT:\?Missing Devnet FUNDED mint\}/);

console.log('standalone funded burn checks passed');
