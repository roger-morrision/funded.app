// Real signed admin HTTP + PostgreSQL + browser component. Own disposable DB only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes,randomUUID} from 'node:crypto';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {Keypair} from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import pg from 'pg';
import {chromium} from '@playwright/test';
import {createAdminRoutes} from '../server/routes/admin.mjs';
import {createXPostStore} from '../server/x-post-store.mjs';
import {createPostgresStore} from '../server/postgres-store.mjs';
const argv=process.argv.slice(2);assert.equal(argv[0],'--run','Explicit --run required. Uses its own disposable DB only.');
assert([1,3,5].includes(argv.length));const options={};for(let i=1;i<argv.length;i+=2){assert(['--report','--qa-keypair'].includes(argv[i]));options[argv[i]]=argv[i+1];}
const admin=options['--qa-keypair']?Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await fs.readFile(options['--qa-keypair'],'utf8')))):Keypair.generate();
if(options['--qa-keypair'])assert.equal(admin.publicKey.toBase58(),'CG87C9tjCSB9BAoKfoPUM3mLvbg3WAK1NGNQCWi12zcJ','Only the separate Devnet QA admin key is permitted; omit this option for an ephemeral signer.');
const actor=admin.publicKey.toBase58(),run=randomUUID(),directory=await fs.mkdtemp(join(tmpdir(),'funded-admin-review-'));
const execute=promisify(execFile),dockerEnv={...process.env};for(const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete dockerEnv[key];
const host=process.platform==='win32'?'npipe:////./pipe/docker_engine':'unix:///var/run/docker.sock';
const docker=async(...args)=>(await execute('docker',[`--host=${host}`,...args],{env:dockerEnv,timeout:60000})).stdout.trim();
process.env.DATABASE_SSL='false';delete process.env.DATABASE_CA_CERT;delete process.env.DATABASE_CA_CERT_PATH;
let container,store,appStore,pool,browser,server,releaseRead;const checks=[];
try{
 const password=randomBytes(24).toString('hex'),envFile=join(directory,'postgres.env');await fs.writeFile(envFile,`POSTGRES_PASSWORD=${password}\nPOSTGRES_DB=funded_admin_review\n`,{mode:0o600});
 container=await docker('run','--detach','--name',`funded-admin-review-${run}`,'--label',`app.funded.admin-review=${run}`,'--env-file',envFile,'--publish','127.0.0.1::5432','postgres:17-alpine');assert.match(container,/^[a-f0-9]{64}$/);
 const address=await docker('port',container,'5432/tcp');assert.match(address,/^127\.0\.0\.1:\d+$/);
 let ready=false;for(let i=0;i<80;i++){try{await docker('exec',container,'pg_isready','-h','127.0.0.1','-U','postgres');ready=true;break;}catch{}await new Promise(r=>setTimeout(r,150));}assert(ready);
 const databaseUrl=`postgresql://postgres:${password}@${address}/funded_admin_review`;pool=new pg.Pool({connectionString:databaseUrl});store=createXPostStore({databaseUrl,accountId:'fundedvip'});await store.init();appStore=createPostgresStore(databaseUrl);await appStore.health();
 const fixture=id=>({id,kind:'agency_promotion',cluster:'devnet',occurredAt:new Date().toISOString(),text:`Synthetic admin review fixture ${id}. Never connected to a publishing worker.`});
 const first=await store.enqueue(fixture('qa:first'));await store.enqueue(fixture('qa:reject'));
 let origin,holdRead=false,readHeld=false;const json=(res,status,value)=>{const send=()=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};if(holdRead&&res.reviewRead){holdRead=false;readHeld=true;releaseRead=send;}else send();};
 const body=async req=>{let text='';for await(const chunk of req)text+=chunk;return text?JSON.parse(text):null;};
 const env={DATABASE_URL:databaseUrl,FUNDED_ADMIN_WALLETS:actor};
 const adminRoutes=createAdminRoutes({store:appStore,body,respond:json,solanaCluster:'devnet',env});
 server=createServer(async(req,res)=>{try{const url=new URL(req.url,origin);res.reviewRead=req.method==='GET'&&['/api/admin/x-posts','/api/admin/service-fees'].includes(url.pathname);if(await adminRoutes(req,res,url))return;
  if(['/admin-x-posts.js','/admin-service-fees.js','/service-fees.js','/exact-sol-units.js'].includes(url.pathname)){res.setHeader('content-type','text/javascript');res.end(await fs.readFile(url.pathname.slice(1),'utf8'));return;}
  if(url.pathname==='/fees'){res.setHeader('content-type','text/html');res.end(`<main><div id="message" role="status"></div><div id="workspace"></div><script type="module">import {initAdminServiceFees} from '/admin-service-fees.js';const api=async(path,options={})=>{const response=await fetch(path,{...options,headers:{'content-type':'application/json'},credentials:'same-origin'});const data=await response.json();window.completedAdminReads=(window.completedAdminReads||0)+1;if(!response.ok)throw Error(data.error);return data;};initAdminServiceFees({api,post:(path,input)=>api(path,{method:'POST',body:JSON.stringify(input)}),show:text=>document.getElementById('message').textContent=text});</script></main>`);return;}if(url.pathname==='/'){res.setHeader('content-type','text/html');res.end(`<main><div id="message" role="status"></div><div id="workspace"></div><script type="module">import {initAdminXPosts} from '/admin-x-posts.js';const api=async(path,options={})=>{const response=await fetch(path,{...options,headers:{'content-type':'application/json'},credentials:'same-origin'});const data=await response.json();window.completedAdminReads=(window.completedAdminReads||0)+1;if(!response.ok)throw Error(data.error);return data;};initAdminXPosts({api,post:(path,input)=>api(path,{method:'POST',body:JSON.stringify(input)}),show:(text)=>document.getElementById('message').textContent=text});</script></main>`);return;}res.writeHead(404);res.end();
 }catch{res.writeHead(500);res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;env.PUBLIC_APP_URL=origin;
 const post=async(path,input,cookie)=>fetch(origin+path,{method:'POST',headers:{origin,'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(input)});
 const challenge=await(await post('/api/admin/challenge',{wallet:actor})).json();assert.equal(challenge.message,`funded.vip Devnet admin sign-in\nOrigin: ${origin}\nWallet: ${actor}\nNonce: ${challenge.nonce}\nExpires: ${challenge.expiresAt}`);
 const session=await post('/api/admin/session',{wallet:actor,nonce:challenge.nonce,signature:bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.message),admin.secretKey))});assert.equal(session.status,200);const cookie=session.headers.get('set-cookie').split(';')[0];checks.push('Real QA wallet signature authenticates the actual admin HTTP route and isolated PostgreSQL');
 browser=await chromium.launch({headless:true});const context=await browser.newContext();await context.addCookies([{name:'funded_admin',value:cookie.split('=')[1],url:origin+'/api/admin',httpOnly:true,sameSite:'Strict'}]);
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(origin);await page.getByText(first.event.text,{exact:true}).waitFor();
 const article=id=>page.locator('article').filter({hasText:fixture(id).text});
 await article('qa:first').getByLabel('Review reason').fill('Reviewed synthetic content and evidence for QA only.');
 // Delay a genuine pre-approval GET response to reproduce a concurrent refresh.
 holdRead=true;await page.getByRole('button',{name:'Refresh review queue'}).click();
 for(let attempt=0;attempt<500&&!readHeld;attempt++)await new Promise(r=>setTimeout(r,20));assert(readHeld,'The controlled stale GET must reach the real route.');
 page.once('dialog',dialog=>dialog.accept());await article('qa:first').getByRole('button',{name:'Approve exact text'}).click();await page.getByText('Review saved. No post was sent.',{exact:true}).waitFor();assert.equal((await store.get('qa:first')).review.decision,'approved');releaseRead();releaseRead=null;
 await article('qa:first').getByText(/^approved · expires/).waitFor({timeout:7000});checks.push('Concurrent pre-approval refresh cannot overwrite the saved review state');
 await article('qa:reject').getByLabel('Review reason').fill('Rejected synthetic fixture; no publication permitted.');page.once('dialog',dialog=>dialog.accept());await article('qa:reject').getByRole('button',{name:'Reject',exact:true}).click();await article('qa:reject').getByText(/^rejected · expires/).waitFor();
 const audit=(await pool.query('SELECT * FROM x_post_review_audit ORDER BY id')).rows;assert.equal(audit.length,2);assert(audit.every(r=>r.actor===actor));assert.equal(audit[0].event_hash,first.hash);assert.equal((await store.get('qa:reject')).review.decision,'rejected');checks.push('Browser approval and rejection persist exact content hashes, signed actor and append-only audit');
 assert.equal(await store.claim(),null);assert.equal((await store.safetyStatus()).paused,true);
 const stale=await post('/api/admin/x-posts/review',{id:'qa:first',expectedHash:'a'.repeat(64),decision:'approved',reason:'Stale hash must not be accepted.'},cookie);assert.equal(stale.status,400);assert.equal((await pool.query('SELECT * FROM x_post_review_audit')).rowCount,2);checks.push('Stale hash rejected without audit mutation; approved content cannot dispatch while paused');
 const legacy=await store.enqueue({...fixture('qa:legacy'),kind:'auto_payout'}),tagged=await store.enqueue({...fixture('qa:tagged'),text:'An unsolicited mention of @someone must not be approved.'});
 for(const row of [legacy,tagged])assert.equal((await post('/api/admin/x-posts/review',{id:row.event.id,expectedHash:row.hash,decision:'approved',reason:'This unsafe synthetic fixture must be blocked.'},cookie)).status,400);
 assert(!(await store.reviewPage()).events.some(row=>row.event.id===legacy.event.id));assert.equal((await pool.query('SELECT * FROM x_post_review_audit')).rowCount,2);checks.push('Legacy individual payouts remain hidden and unapprovable; unsolicited mentions cannot be approved');
 await page.getByRole('button',{name:'Keep publishing paused'}).click();await page.getByText('Publishing pause saved.',{exact:true}).waitFor();assert.equal((await store.safetyStatus()).reason,'account-suspended');assert.deepEqual(errors,[]);
 await page.goto(origin+'/fees');await page.locator('[data-service-revision]').filter({hasText:'Revision 0'}).waitFor();
 await page.getByLabel('Launch service fee (SOL)').fill('4.000000003');await page.getByLabel('Audit reason',{exact:true}).fill('Exact lamport QA fee policy verification.');
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Review and save fees'}).click();await page.locator('[data-service-revision]').filter({hasText:'Revision 1'}).waitFor({timeout:7000});
 assert.equal((await appStore.read()).adminSettings.serviceFees.policy.launchLamports,'4000000003');assert.equal((await appStore.read()).adminAudit['service-fees:1'].wallet,actor);checks.push('Exact nine-decimal fee policy persists through signed HTTP and PostgreSQL without rounding');
 const currentFees=await(await fetch(origin+'/api/admin/service-fees',{headers:{cookie}})).json();
 holdRead=true;readHeld=false;await page.getByRole('button',{name:'Refresh fees',exact:true}).click();for(let attempt=0;attempt<500&&!readHeld;attempt++)await new Promise(r=>setTimeout(r,20));assert(readHeld);
 const updated=await post('/api/admin/service-fees',{policy:{...currentFees.policy,tradeBps:75},expectedHash:currentFees.hash,expectedRevision:currentFees.revision,reason:'Second signed QA admin updates the current revision.'},cookie);assert.equal(updated.status,200);
 await page.getByRole('button',{name:'Refresh fees',exact:true}).click();await page.locator('[data-service-revision]').filter({hasText:'Revision 2'}).waitFor();const completed=await page.evaluate(()=>window.completedAdminReads);releaseRead();releaseRead=null;
 await page.waitForFunction(before=>window.completedAdminReads>before,completed);assert.match(await page.locator('[data-service-revision]').textContent(),/Revision 2/);assert.equal(await page.getByLabel('Trading fee · buys and sells (%)').inputValue(),'0.75');checks.push('Out-of-order fee refreshes cannot replace a newer revision with stale prices');
 const stalePolicy=await post('/api/admin/service-fees',{policy:currentFees.policy,expectedHash:currentFees.hash,expectedRevision:currentFees.revision,reason:'A stale QA tab must not overwrite current fees.'},cookie);assert.equal(stalePolicy.status,409);assert.equal((await appStore.read()).adminSettings.serviceFees.revision,2);
 const valid=await(await fetch(origin+'/api/admin/service-fees',{headers:{cookie}})).json();assert.equal((await post('/api/admin/service-fees',{policy:{...valid.policy,tradeBps:501},expectedHash:valid.hash,expectedRevision:2,reason:'Out-of-range QA prices must be rejected.'},cookie)).status,409);
 assert.equal((await appStore.read()).adminSettings.serviceFees.revision,2);checks.push('Stale and invalid fee writes cannot change current policy or audit history');
 const completedBeforeLogout=await page.evaluate(()=>window.completedAdminReads);holdRead=true;readHeld=false;await page.getByRole('button',{name:'Refresh fees',exact:true}).click();for(let attempt=0;attempt<500&&!readHeld;attempt++)await new Promise(r=>setTimeout(r,20));assert(readHeld);
 await page.locator('#workspace').evaluate(node=>{node.hidden=true;});assert.equal((await post('/api/admin/logout',{},cookie)).status,200);releaseRead();releaseRead=null;await page.waitForFunction(before=>window.completedAdminReads>before,completedBeforeLogout);
 assert.equal(await page.locator('#service-fee-form [type=submit]').isDisabled(),true);assert.equal((await fetch(origin+'/api/admin/service-fees',{headers:{cookie}})).status,401);checks.push('Logout invalidates fee editing even when a previously authenticated read arrives late');
 assert.deepEqual(errors,[]);
 const report={checkedAt:new Date().toISOString(),actor,checks,browserErrors:errors,xRequests:0,xPosts:0,solanaTransactions:0,scope:'Isolated real HTTP, PostgreSQL, QA signature and actual admin fee/X review components. No API mocks, X client or worker.'};if(options['--report'])await fs.writeFile(resolve(options['--report']),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{
 releaseRead?.();await browser?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await store?.close();await appStore?.close();await pool?.end();
 if(container){assert.equal(await docker('inspect','--format','{{index .Config.Labels "app.funded.admin-review"}}',container),run);await docker('rm','--force','--volumes',container);}
 const resolved=resolve(directory);assert.equal(resolve(tmpdir()),resolve(directory,'..'));assert(resolved.includes('funded-admin-review-'));await fs.rm(resolved,{recursive:true,force:true});
}
