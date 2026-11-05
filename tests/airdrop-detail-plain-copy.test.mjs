import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const view = readFileSync(new URL('../src/features/rewards/airdrop-view.js', import.meta.url), 'utf8');
const directory = readFileSync(new URL('../src/app/controllers/airdrop-directory.js', import.meta.url), 'utf8');

test('airdrop advanced details use plain placeholders before the snapshot', () => {
  assert.match(view, /'Shown after the holder snapshot'/);
  assert.match(view, /'Shown once delivery opens'/);
  assert.match(directory, /: 'Not taken yet',/);
  for (const old of ['Pending verified snapshot', 'Pending published proof']) assert.ok(!view.includes(old), old);
  assert.ok(!directory.includes('Snapshot · unverified'));
});
