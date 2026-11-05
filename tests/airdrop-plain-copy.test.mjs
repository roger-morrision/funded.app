import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Airdrops page uses plain words instead of registry jargon', () => {
  const sources = [
    'index.html',
    'src/app/controllers/airdrop-directory.js',
    'src/app/controllers/airdrop-reporting.js',
    'src/features/workspace/secondary-pages.js',
  ].map(read).join('\n');
  for (const jargon of [
    'Launch registry unavailable',
    'Checking the verified launch registry',
    'counts not verified',
    'Awaiting verified snapshot',
    'After verified snapshot',
    'QA cutoffs are labeled',
    'Eligibility uses a verified snapshot',
  ]) assert.ok(!sources.includes(jargon), `still shows "${jargon}"`);
  assert.match(read('index.html'), /Hold \$FUNDED until migration/);
  assert.match(read('src/app/controllers/airdrop-directory.js'), /'Awaiting migration'/);
});
