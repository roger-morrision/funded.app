import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Leaderboard uses plain words instead of registry jargon', () => {
  const sources = [read('index.html'), read('src/features/leaderboard/board-view.js')].join('\n');
  for (const jargon of [
    'Observed trader leaderboard',
    'Observed trades · last 24 hours',
    'verified launch registry',
    'Reading recent trades from verified tokens',
    'observed trading wallet',
    'Ranked by observed SOL volume',
    'creator count not verified',
    'an empty ranking is not evidence',
  ]) assert.ok(!sources.includes(jargon), `still shows "${jargon}"`);
  assert.match(sources, /id="leaderboard-table-title">Top traders</);
  assert.match(read('src/features/leaderboard/board-view.js'), /'Trade data is unavailable right now\.'/);
});
