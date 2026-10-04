import test from 'node:test';
import assert from 'node:assert/strict';
import { isAppPagePath } from '../server/page-routes.mjs';

test('pilot deep links are explicit SPA routes without capturing APIs or assets',()=>{
  for(const path of ['/pilot','/pilot/'])assert.equal(isAppPagePath(path),true,path);
  for(const path of ['/pilots','/pilot.js','/pilot/unrecognized','/api/pilot','/assets/pilot.js'])assert.equal(isAppPagePath(path),false,path);
});
