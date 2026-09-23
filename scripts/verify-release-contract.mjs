import assert from 'node:assert/strict';
import { CREATOR_SUPPORT_VERSION } from '../creator-support-model.js';
const base=new URL(process.env.FUNDED_RELEASE_BASE||'http://127.0.0.1:19020');
assert.ok(['http:','https:'].includes(base.protocol)&&!base.username&&!base.password,'Use an HTTP origin without credentials.');
const get=path=>fetch(new URL(path,base),{signal:AbortSignal.timeout(10000)});
const response=await get('/api/capabilities');assert.equal(response.status,200);const capabilities=await response.json();
assert.equal(capabilities.version,CREATOR_SUPPORT_VERSION);assert.equal(capabilities.cluster,'devnet');assert.equal(capabilities.gifts.enabled,false);
assert.ok(['postgresql','local-file-single-process'].includes(capabilities.sessions.storage));assert.equal(capabilities.sessions.absoluteLifetimeSeconds,86400);
assert.equal(capabilities.creatorDirectory.cursorPagination,true);
const readiness=await(await get('/api/readiness')).json();assert.equal(readiness.ready,false);assert.equal(readiness.scope,'configuration-only');
if(process.env.FUNDED_EXPECT_BUILD)assert.equal(capabilities.build,process.env.FUNDED_EXPECT_BUILD,'Wrong deployed release.');
if(process.env.FUNDED_REQUIRE_POSTGRES==='true'){assert.equal(capabilities.sessions.storage,'postgresql');assert.equal(capabilities.creatorDirectory.storage,'postgresql-projection');}
const directory=await(await get('/api/creators')).json();assert.ok(Array.isArray(directory.creators));assert.ok(directory.creators.length<=50);
const following=await(await get('/api/creator-support/following-updates')).json();assert.deepEqual(following.creators,[]);assert.equal(following.checkedCount,0);
assert.equal((await get('/api/ops/receipt-worker')).status,401,'Worker operations must not be public.');
const home=await get('/');assert.equal(home.status,200);const html=await home.text();
const assetPaths=[...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+\.(?:js|css))"/g)].map(match=>match[1]);assert.ok(assetPaths.length,'Build assets missing.');
for(const path of new Set(assetPaths)){const asset=await get(path);assert.equal(asset.status,200,`Missing built asset ${path}`);assert.doesNotMatch(await asset.text(),/^<!doctype/i,`Asset returned HTML ${path}`);}
for(const path of ['/creator/x/999999999','/wallet/11111111111111111111111111111111','/token/11111111111111111111111111111111']){const page=await get(path);assert.equal(page.status,200);assert.match(page.headers.get('content-type'),/text\/html/);if(path.startsWith('/token/'))assert.match(await page.text(),/<meta property="og:title"/,'Token social metadata missing.');}
const chat=await(await get('/api/tokens/11111111111111111111111111111111/chat')).json();assert.equal(chat.enabled,false);assert.deepEqual(chat.messages,[]);
// Small read-only concurrency smoke check, not a production capacity benchmark.
const started=Date.now();const statuses=await Promise.all(Array.from({length:20},async()=>{const r=await get('/api/capabilities');return r.status;}));assert.ok(statuses.every(status=>status===200));
console.log(`Release contract: API ${capabilities.version}, Devnet, ${new Set(assetPaths).size} built assets, deep links, chat gate and 20 parallel reads passed (${Date.now()-started}ms concurrency smoke). Optional X payout readiness: ${capabilities.xPayouts.ready?'configured, not payment proof':'not configured in this environment'}.`);
