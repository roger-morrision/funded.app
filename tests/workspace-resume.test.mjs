import test from 'node:test';
import assert from 'node:assert/strict';
import { workspaceResumeItems } from '../workspace-resume.js';
const base = { cluster: 'devnet', origin: 'https://funded.example' };
test('resume choices prioritize uncertain launch recovery and never turn a local record into success', () => {
  const items = workspaceResumeItems({ ...base, journal: [{ state: 'unknown', cluster: 'devnet' }, { state: 'completed', cluster: 'devnet' }, { state: 'submitted', cluster: 'mainnet-beta' }], searches: [{ name: 'Saved search', filters: { 'explore-search': 'COIN', wallet: 'secret' } }] });
  assert.deepEqual(items.map(item => item.kind), ['recovery', 'search']);
  assert.equal(items[0].label, 'Review unfinished launch');
  assert.equal(items[1].href.includes('secret'), false);
  assert.equal(new URL(items[1].href).searchParams.get('f.explore-search'), 'COIN');
});
test('new visitors get no synthetic saved work; malformed searches are ignored and history stays bounded', () => {
  assert.deepEqual(workspaceResumeItems(base), []);
  const searches = [null, { name: 'bad', filters: [] }, ...Array.from({ length: 8 }, (_, index) => ({ name: `Search ${index}`, filters: {} }))];
  assert.equal(workspaceResumeItems({ ...base, searches }).length, 3);
});
