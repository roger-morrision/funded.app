import test from 'node:test';
import assert from 'node:assert/strict';
import { createAirdropsRoutes } from '../server/routes/airdrops.mjs';
import { SharedRpcConnection } from '../server/rpc-connection.mjs';
import { DEVNET_GENESIS_HASH } from '../server/automatic-reward-chain.mjs';

test('overlapping reserve requests share the same scan', async t => {
  let release, reads=0;
  t.mock.method(SharedRpcConnection.prototype, 'getGenesisHash', async () => DEVNET_GENESIS_HASH);
  const routes=createAirdropsRoutes({solanaCluster:'devnet',solanaRpcUrl:'http://127.0.0.1:8899',
    store:{read:async()=>{reads++;await new Promise(resolve=>{release=resolve;});return {launches:{}};}},
    automaticRewardStore:{read:async()=>({})},respond:(res,status,data)=>Object.assign(res,{status,data})});
  const one={},two={},url=new URL('https://funded.vip/api/airdrops/reserves');
  const pending=[routes.handle({method:'GET'},one,url),routes.handle({method:'GET'},two,url)];
  await new Promise(setImmediate);assert.equal(reads,1);release();await Promise.all(pending);
  assert.equal(one.status,200);assert.deepEqual(one.data,two.data);
});

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

test('slow migration preparation can be polled and repeated without starting a second replay', async () => {
  const mint = '1'.repeat(32), signature = '2'.repeat(88);
  let resolve, saved = null, calls = 0, result;
  const service = { prepared:async () => saved, prepare:async () => {
    calls++;
    await new Promise(done => {resolve = done;});
    saved = { mint, manifest:{root:'root',snapshotHash:'hash',leaves:[{}],totalAmount:'1'}, snapshot:{slot:42} };
    return saved;
  }};
  const routes = createAirdropsRoutes({ requireAuthorized:() => true, body:async req => req.payload,
    store:{readLaunch:async()=>({onchainVerified:true,cluster:'devnet',communityAirdrop:{reservedTokens:1}}),
      read:async()=>({communityReserveReceipts:{[mint]:{signature}}})}, communityClaimService:async()=>service,
    respond:(_res,status,data)=>{result={status,data};} });
  const post = sig => routes.handle({method:'POST',headers:{prefer:'respond-async'},payload:{mint,migrationSignature:sig}},
    {setHeader(){},setTimeout(){}},new URL('https://funded.vip/api/airdrops/claims/prepare'));
  const status = () => routes.handle({method:'GET'}, {}, new URL('https://funded.vip/api/airdrops/claims/status?mint='+mint));
  await post(signature); assert.equal(result.status,202);
  await post(signature); assert.equal(calls,1);
  await post('3'.repeat(88)); assert.equal(result.status,409);
  await status(); assert.equal(result.data.status,'preparing');
  resolve(); await new Promise(setImmediate);
  await status(); assert.equal(result.data.status,'prepared'); assert.equal(result.data.migrationSlot,42);
});
