import assert from 'node:assert/strict';
import { CREATOR_SUPPORT_VERSION } from '../creator-support-model.js';
const base=new URL(process.env.FUNDED_RELEASE_BASE||'http://127.0.0.1:8788');
assert.ok(['http:','https:'].includes(base.protocol)&&!base.username&&!base.password,'Use an HTTP origin without credentials.');
const get=path=>fetch(new URL(path,base),{signal:AbortSignal.timeout(10000)});
const response=await get('/api/capabilities');assert.equal(response.status,200);const capabilities=await response.json();
const healthResponse=await get('/api/health');assert.equal(healthResponse.status,200);const health=await healthResponse.json();assert.equal(typeof health.external?.automaticRewards,'boolean');
assert.equal(capabilities.version,CREATOR_SUPPORT_VERSION);assert.equal(capabilities.cluster,'devnet');assert.equal(capabilities.gifts.enabled,false);
assert.ok(['postgresql','local-file-single-process'].includes(capabilities.sessions.storage));assert.equal(capabilities.sessions.absoluteLifetimeSeconds,86400);
assert.equal(capabilities.creatorDirectory.cursorPagination,true);
const readiness=await(await get('/api/readiness')).json();assert.equal(readiness.ready,false);assert.equal(readiness.scope,'configuration-only');
const analytics=await(await get('/api/analytics/summary')).json();assert.equal(analytics.cluster,capabilities.cluster);assert.equal(analytics.build,capabilities.build);assert.ok(['funded.app-postgresql','funded.app-file-ledger'].includes(analytics.source));
if(process.env.FUNDED_EXPECT_BUILD)assert.equal(capabilities.build,process.env.FUNDED_EXPECT_BUILD,'Wrong deployed release.');
if(process.env.FUNDED_REQUIRE_POSTGRES==='true'){assert.equal(capabilities.sessions.storage,'postgresql');assert.equal(capabilities.creatorDirectory.storage,'postgresql-projection');}
const directory=await(await get('/api/creators')).json();assert.ok(Array.isArray(directory.creators));assert.ok(directory.creators.length<=50);
const following=await(await get('/api/creator-support/following-updates')).json();assert.deepEqual(following.creators,[]);assert.equal(following.checkedCount,0);
assert.equal((await get('/api/ops/receipt-worker')).status,401,'Worker operations must not be public.');
for(const path of ['/api/pump/explore','/api/birdeye/explore']){
  for(const [query,field] of [['?limit=invalid','limit'],['?offset=1.5','offset'],['?limit=1&limit=2','limit']]){
    const invalid=await get(path+query);assert.equal(invalid.status,400,`Invalid Explore pagination must fail before discovery: ${path+query}`);
    const error=await invalid.json();assert.match(error.error,new RegExp(`^${field} must be supplied once`));assert.equal(typeof error.requestId,'string');
  }
}
const home=await get('/');assert.equal(home.status,200);const html=await home.text();
const assetPaths=[...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+\.(?:js|css))"/g)].map(match=>match[1]);assert.ok(assetPaths.length,'Build assets missing.');
for(const path of new Set(assetPaths)){const asset=await get(path);assert.equal(asset.status,200,`Missing built asset ${path}`);assert.doesNotMatch(await asset.text(),/^<!doctype/i,`Asset returned HTML ${path}`);}
for(const path of ['/pilot','/pilot/','/creator/x/999999999','/wallet/11111111111111111111111111111111','/token/11111111111111111111111111111111']){const page=await get(path);assert.equal(page.status,200,`Deep link unavailable: ${path}`);assert.match(page.headers.get('content-type'),/text\/html/);if(path.startsWith('/pilot'))assert.equal(await page.text(),html,'Pilot deep link must return the deployed application shell.');else if(path.startsWith('/token/'))assert.match(await page.text(),/<meta property="og:title"/,'Token social metadata missing.');}
const chat=await(await get('/api/tokens/11111111111111111111111111111111/chat')).json();assert.equal(chat.enabled,true);assert.equal(chat.authentication,'solana-wallet-session');assert.equal(chat.moderation?.reporting,undefined);assert.deepEqual(chat.messages,[]);
const reportPath='/api/tokens/11111111111111111111111111111111/chat/report';
const wrongReportMethod=await get(reportPath);
assert.equal(wrongReportMethod.status,405,'Chat reporting must require POST.');
assert.match((await wrongReportMethod.json()).error,/method not allowed/i);
const anonymousReport=await fetch(new URL(reportPath,base),{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({messageId:`chat_${'0'.repeat(24)}`,reason:'spam-or-scam'}),signal:AbortSignal.timeout(10000)});
assert.equal(anonymousReport.status,401,'Anonymous reports must require a verified wallet session.');
assert.match((await anonymousReport.json()).error,/verify your wallet/i);
const forgedReport=await fetch(new URL(reportPath,base),{method:'POST',headers:{'content-type':'application/json','x-token-chat-session':'invalid-session'},
  body:JSON.stringify({messageId:`chat_${'0'.repeat(24)}`,reason:'spam-or-scam'}),signal:AbortSignal.timeout(10000)});
assert.ok([401,403].includes(forgedReport.status),'Forged sessions must fail the origin/session boundary.');
// Small read-only concurrency smoke check, not a production capacity benchmark.
const started=Date.now();const statuses=await Promise.all(Array.from({length:20},async()=>{const r=await get('/api/capabilities');return r.status;}));assert.ok(statuses.every(status=>status===200));
console.log(`Release contract: API ${capabilities.version}, Devnet, ${new Set(assetPaths).size} built assets, deep links, Explore pagination rejection, wallet-signed chat contract and 20 parallel reads passed (${Date.now()-started}ms concurrency smoke). Optional X payout readiness: ${capabilities.xPayouts.ready?'configured, not payment proof':'not configured in this environment'}.`);
