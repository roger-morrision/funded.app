import test from 'node:test';
import assert from 'node:assert/strict';
import {createLeaderboardsController} from '../src/app/controllers/leaderboards.js';
test('forced leaderboard refresh bypasses a cached empty board and rejects stale or wrong-network results',async()=>{
  const calls=[];let data={cluster:'mainnet-beta',traders:[],tokenCount:0,stale:false};
  const state={EXPLORE_CLUSTER:'mainnet-beta',leaderboardView:'traders',renderLeaderboard(){},
    apiRequest:async path=>{calls.push(path);return {available:true,data};}};
  const controller=createLeaderboardsController(state);
  await controller.loadMainnetTraders();assert.deepEqual(state.mainnetTraderBoard.traders,[]);
  data={...data,traders:[{wallet:'fixture',tradeCount:1}],tokenCount:1};
  await controller.loadMainnetTraders();assert.equal(calls.length,1);
  await controller.loadMainnetTraders(true);assert.match(calls[1],/\?refresh=\d+$/);
  assert.equal(state.mainnetTraderBoard.traders[0].tradeCount,1);
  for(const invalid of [{...data,cluster:'devnet'},{...data,stale:true}]){
    data=invalid;await controller.loadMainnetTraders(true);assert.equal(state.mainnetTraderBoard.status,'unavailable');
  }
});
