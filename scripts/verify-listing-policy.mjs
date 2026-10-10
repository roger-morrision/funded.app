import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LISTING_PRICE_USD, listingBurnBaseUnits, listingBurnTokens, listingMemo } from '../listing-policy.js';

assert.equal(LISTING_PRICE_USD, 200);
assert.equal(listingBurnBaseUnits(6, listingBurnTokens(0.01)), 20_000_000_000n);
assert.equal(listingBurnBaseUnits(6, 1), 1_000_000n);
assert.throws(() => listingBurnBaseUnits(6, 0), /Unsupported/);
assert.throws(() => listingBurnBaseUnits(18, 20), /exceeds/);
assert.equal(listingMemo('Mint'), 'funded.vip:list:Mint');
const client = await readFile(new URL('../list-page.js', import.meta.url), 'utf8');
const server = await readFile(new URL('../server/index.mjs', import.meta.url), 'utf8');
const listingRoutes = await readFile(new URL('../server/routes/listing-payments.mjs', import.meta.url), 'utf8');
assert.match(client, /listingQuoteCurrent/);
assert.match(client, /listingBurnBaseUnitsForUsd\(quote\.tokenPriceUsd, funded\.decimals\)/);
assert.match(server, /currentLaunchTierPricing/);
assert.match(listingRoutes, /listingBurnBaseUnitsForUsd\(quote\.tokenPriceUsd, quote\.decimals\)/);
console.log('listing policy checks passed');
