import test from 'node:test';
import assert from 'node:assert/strict';
import { verifiedPaidListings } from '../src/features/home/paid-listings.js';
import { paidListingCardMarkup, paidListingTableMarkup } from '../src/features/home/paid-listing-view.js';

const mint = '7VkXjVnFNAiBz4ZCoun5dkUQvKJoNJc4R1zkgpcxPE4q';
const otherMint = '718yrEQiDimetACrGgZSTDHbFnxAMnFbmSBv6bqwt9wc';
const record = { mint, name: 'Verified token', symbol: 'VT', signature: '3'.repeat(64),
  cluster: 'devnet', status: 'listed', onchainVerified: true, listedAt: '2026-10-11T00:00:00.000Z' };

test('paid listing view accepts only verified listing records', () => {
  const older = { ...record, mint: otherMint, listedAt: '2026-10-10T00:00:00.000Z' };
  const result = verifiedPaidListings([older, { ...record, onchainVerified: false }, record,
    { ...record, status: 'pending' }, { ...record, cluster: 'mainnet-beta' }, { ...record, mint: 'bad' },
    { ...record, signature: '' }, { ...record, name: '' }, { ...record, listedAt: 'invalid' }, record]);
  assert.deepEqual(result.map(item => item.mint), [mint, otherMint]);
});

test('paid listing cards show burn proof without claiming launch metrics', () => {
  const listing = { ...record, name: '<img src=x onerror=alert(1)>' };
  const card = paidListingCardMarkup(listing);
  const row = paidListingTableMarkup(listing);
  assert.match(card, /Paid listing/);
  assert.match(card, /Payment verified on Devnet/);
  assert.match(card, /explorer\.solana\.com\/tx\/3+\?cluster=devnet/);
  assert.doesNotMatch(card, /<img src=x/);
  assert.doesNotMatch(card, /On curve|Standard launch|Market cap/);
  assert.match(row, /Verified burn/);
  assert.doesNotMatch(row, /<img src=x/);
});
