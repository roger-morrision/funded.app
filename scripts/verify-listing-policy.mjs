import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LISTING_BURN_TOKENS, listingBurnBaseUnits, listingMemo } from '../listing-policy.js';

assert.equal(listingBurnBaseUnits(6), 25_000_000_000n);
assert.equal(listingBurnBaseUnits(6, 1), 1_000_000n);
assert.throws(() => listingBurnBaseUnits(6, 0), /Unsupported/);
assert.throws(() => listingBurnBaseUnits(6, LISTING_BURN_TOKENS + 1n), /Unsupported/);
assert.equal(listingMemo('Mint'), 'funded.vip:list:Mint');
const client = await readFile(new URL('../list-page.js', import.meta.url), 'utf8');
const server = await readFile(new URL('../server/index.mjs', import.meta.url), 'utf8');
assert.match(client, /configuredBurnTokens/);
assert.match(client, /listingBurnBaseUnits\(funded\.decimals, amountTokens\)/);
assert.match(server, /devnetTestMode.*configuredQaListingBurn/s);
assert.match(server, /listingBurnBaseUnits\(fundedSupply\.value\.decimals, listingBurnTokens\)/);
console.log('listing policy checks passed');
