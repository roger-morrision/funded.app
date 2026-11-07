import test from 'node:test';
import assert from 'node:assert/strict';
import { createExploreRegistryController } from '../src/app/controllers/explore-registry.js';

test('Explore enables pool sorts using migrated values and rejects obsolete curve values', t => {
  const options = ['market-cap', 'liquidity', 'turnover', 'newest'].map(value => ({ value }));
  const select = { options, value: 'market-cap' };
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else delete globalThis.document;
  });
  globalThis.document = {
    querySelector: selector => selector === '#explore-sort' ? select : null,
    querySelectorAll: () => [],
  };
  const app = {
    EXPLORE_CLUSTER: 'devnet',
    assets: [{ migrated: true, poolMarketCapSol: 100, poolReserveSol: 20 }],
    exploreSort: 'market-cap',
    exploreTab: 'trending',
    exploreWindow: '24h',
    withVerifiedExploreBenefits: item => item,
    withMarketWindow: item => ({ ...item, windowVolumeSol: 10, windowTurnover: null }),
    renderExploreAssets() {},
  };
  const controller = createExploreRegistryController(app);
  const enabled = value => !options.find(option => option.value === value).disabled;
  controller.updateExploreSortAvailability();
  assert.equal(enabled('market-cap'), true);
  assert.equal(enabled('liquidity'), true);
  assert.equal(enabled('turnover'), false);
  assert.equal(app.exploreSort, 'market-cap');
  app.assets = [{ migrated: true, curveCapSol: 100, curveReserveSol: 20 }];
  controller.updateExploreSortAvailability();
  assert.equal(enabled('market-cap'), false);
  assert.equal(enabled('liquidity'), false);
  assert.equal(app.exploreSort, 'recent-trade');
});
