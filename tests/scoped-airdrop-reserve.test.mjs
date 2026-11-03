import test from 'node:test';
import assert from 'node:assert/strict';
import { createAirdropsRoutes } from '../server/routes/airdrops.mjs';
import { SharedRpcConnection } from '../server/rpc-connection.mjs';
import { DEVNET_GENESIS_HASH } from '../server/automatic-reward-chain.mjs';

test('a token lookup skips unrelated launches and cannot fill the directory cache', async t => {
  t.mock.method(SharedRpcConnection.prototype, 'getGenesisHash', async () => DEVNET_GENESIS_HASH);
  let reads = 0, result;
  const mint = '11111111111111111111111111111111';
  const routes = createAirdropsRoutes({
    solanaCluster:'devnet', solanaRpcUrl:'http://127.0.0.1:8899',
    store:{read:async () => { reads++; return {launches:{other:{mint,cluster:'devnet',onchainVerified:true,pumpFeeRoute:{scope:'per-mint-v3'},communityAirdrop:{reservedTokens:1}}}}; }},
    automaticRewardStore:{readAutomationSnapshot:async () => ({})},
    respond:(_res,status,data) => { result = {status,data}; },
  });
  const get = async query => routes.handle({method:'GET'}, {}, new URL('https://funded.vip/api/airdrops/reserves' + query));
  await get('?mint=invalid'); assert.equal(result.status,400); assert.equal(reads,0);
  await get('?mint='+'2'.repeat(32)); assert.deepEqual(result.data.reserves,[]);
  await get(''); assert.equal(result.data.reserves[0].mint,mint);
  await get('?mint='+mint); assert.equal(result.data.reserves.length,1); assert.equal(reads,2);
});
