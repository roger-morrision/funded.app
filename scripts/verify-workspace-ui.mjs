import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5173';
const output = resolve(process.env.UI_EVIDENCE_DIR || 'docs/ui-evidence-2026-09-29');
await mkdir(output,{recursive:true});
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chrome' }), headless: true });
const context = await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
await context.addInitScript(()=>sessionStorage.setItem('funded.app.wallet.manual-disconnect','1'));
const page = await context.newPage();
const failures=[], errors=[], results=[];
page.on('pageerror',error=>errors.push(error.stack || error.message));
// The test never signs or sends transactions. Block any accidental mutating endpoint.
await context.route('**/api/**',async route=>{
  const request=route.request();
  if(request.method()!=='GET' && !/\/rpc(?:\?|$)/.test(request.url())){
    return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:'UI verification is read-only'})});
  }
  if(/\/rpc(?:\?|$)/.test(request.url()) && /sendTransaction|requestAirdrop/.test(request.postData()||'')){
    failures.push('Unexpected attempted financial mutation');return route.abort();
  }
  return route.continue();
});
async function check(name, callback){try{await callback();results.push({name,status:'passed'});}catch(error){failures.push(`${name}: ${error.message.split('\n')[0]}`);results.push({name,status:'failed',message:error.message.slice(0,500)});}}
async function open(route){
  await page.goto(`${base}/#${route}`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(expected=>document.body.classList.contains('workspace-ready') && document.body.classList.contains(`page-route-${expected}`),route);
}
try {
  await open('overview');
  await check('Home prioritizes holder rewards before launches',async()=>{
    const rewards=await page.locator('.home-rewards-spotlight').boundingBox();
    const launches=await page.locator('.home-launch-board').boundingBox();
    assert(rewards && launches && rewards.y<launches.y);
  });
  await check('Home keeps one metrics section and one legal footer',async()=>{
    assert.equal(await page.locator('.home-hero-facts').count(),0);
    assert(await page.locator('.home-kpi-dashboard').isVisible());
    assert.equal(await page.locator('.home-footer-legal a').count(),4);
    assert(!await page.locator('.main-content > footer').isVisible());
  });
  await check('Home navigation exposes the reference destination pages',async()=>{
    for (const href of ['#leaderboard','#airdrops','#list']) assert(await page.locator(`.sidebar .primary-nav .nav-item[href="${href}"]`).count()>0,href);
    assert.equal(await page.locator('.home-reference-footer a[href="#explore"]').innerText(),'Launch Directory');
  });
  await check('Migrated home cards do not suppress indexed trade metrics',async()=>{
    await page.locator('#home-launch-grid .home-launch-card').first().waitFor({timeout:15000});
    const migrated=page.locator('#home-launch-grid .home-launch-card').filter({hasText:'Migrated'});
    if(await migrated.count()){
      assert(!(await migrated.first().innerText()).includes('Pool unindexed'));
      await page.locator('[data-home-view="table"]').click();
      assert(!(await page.locator('#home-launch-table-body').innerText()).includes('Pool unindexed'));
      await page.locator('[data-home-view="grid"]').click();
    }
  });
  await check('Help topics open without implying live support',async()=>{
    await page.locator('#help-topics-trigger').click();
    assert(await page.locator('#help-topics-panel').isVisible());
    assert((await page.locator('.help-topics-intro').innerText()).includes('Live messaging is unavailable'));
    await page.locator('[data-help-topic="trade"]').click();
    assert.equal(await page.locator('.help-topics-answer strong').innerText(),'Trading issues');
    assert.equal(await page.locator('.help-topics-answer a').getAttribute('href'),'#docs/trading');
    await page.locator('#help-topics-panel header button').click();
    assert(await page.locator('#help-topics-panel').isHidden());
  });
  await check('Home feed controls switch view, pause order, and animation setting',async()=>{
    await page.locator('[data-home-view="table"]').click();
    assert(await page.locator('#home-launch-table-wrap').isVisible());
    assert.equal(await page.locator('.home-launch-table th').count(),7);
    await page.locator('#home-table-sort-mc').click();
    assert.equal(await page.locator('[data-home-sort="market-cap"]').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('#home-table-mc-heading').getAttribute('aria-sort'),'descending');
    assert(await page.locator('#home-feed-pause').isDisabled());
    await page.locator('[data-home-sort="volume"]').click();
    await page.locator('#home-feed-pause').click();
    assert.equal(await page.locator('#home-feed-pause').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('#home-feed-pause').getAttribute('aria-label'),'Resume live reordering');
    await page.locator('.home-feed-settings summary').click();
    assert.equal(await page.locator('.home-feed-settings summary').getAttribute('aria-label'),'Filter launches');
    assert.equal((await page.locator('.home-feed-settings-panel > strong').textContent()).trim(),'Filter launches');
    assert.equal(await page.locator('.home-launch-toolbar > label').count(),0);
    await page.locator('#home-min-cap').selectOption('1000000');
    await page.locator('#home-max-age').selectOption('24');
    assert(await page.locator('.home-feed-settings').evaluate(element=>element.hasAttribute('data-active-filters')));
    await page.locator('.home-feed-settings summary').click();
    await page.locator('.home-feed-settings summary').click();
    assert.equal(await page.locator('#home-min-cap').inputValue(),'1000000');
    assert.equal(await page.locator('#home-max-age').inputValue(),'24');
    await page.locator('#home-min-cap').selectOption('0');
    await page.locator('#home-max-age').selectOption('0');
    assert(!await page.locator('.home-feed-settings').evaluate(element=>element.hasAttribute('data-active-filters')));
    await page.locator('#home-feed-animations').uncheck();
    assert(await page.locator('body').evaluate(element=>element.classList.contains('home-feed-motion-off')));
    await page.locator('#home-feed-animations').check();
    await page.locator('#home-feed-pause').click();
    await page.locator('[data-home-view="grid"]').click();
    assert(await page.locator('#home-ticker-back').count());
    assert(await page.locator('#home-ticker-forward').count());
  });
  await check('Feed settings popup remains on screen across responsive widths',async()=>{
    if(!(await page.locator('.home-feed-settings').evaluate(element=>element.open))) await page.locator('.home-feed-settings summary').click();
    for(const width of [320,390,768,1024,1280,1440]){
      await page.setViewportSize({width,height:1000});
      const panel=await page.locator('.home-feed-settings-panel').boundingBox();
      assert(panel && panel.x>=0 && panel.x+panel.width<=width,`Feed settings clipped at ${width}px`);
      const checkboxes=await page.locator('.home-feed-settings-panel > label').evaluateAll(labels=>labels.map(label=>getComputedStyle(label).flexDirection));
      const filters=await page.locator('.home-feed-filter-fields label').evaluateAll(labels=>labels.map(label=>getComputedStyle(label).flexDirection));
      assert(checkboxes.length===2 && checkboxes.every(direction=>direction==='row'),`Feed checkbox options misaligned at ${width}px`);
      assert(filters.length===2 && filters.every(direction=>direction==='column'),`Feed filter fields misaligned at ${width}px`);
    }
  });
  await check('Feed settings opens inside a fresh mobile viewport',async()=>{
    await page.setViewportSize({width:390,height:844});
    await open('overview');
    await page.locator('.home-feed-settings').evaluate(element=>{element.open=false;});
    await page.locator('.home-feed-settings summary').click();
    const panel=await page.locator('.home-feed-settings-panel').boundingBox();
    assert(panel && panel.x>=0 && panel.x+panel.width<=390 && panel.y>=0 && panel.y+panel.height<=844,`Feed settings clipped: ${JSON.stringify(panel)}`);
    assert.equal(await page.locator('.home-feed-settings-panel').evaluate(element=>getComputedStyle(element).borderTopColor),'rgb(72, 90, 115)');
    assert(await page.locator('#home-feed-animations').isVisible());
    await page.locator('.home-feed-settings summary').click();
    await page.setViewportSize({width:1440,height:1000});
    await open('overview');
  });
  await page.screenshot({path:resolve(output,'home-desktop.png'),timeout:12000});
  for(const width of [360,390,768,1024,1440]){
    await page.setViewportSize({width,height:1000});
    for(const route of ['overview','explore','launch','payments','my-launches','community','analytics-detail','referrals','airdrops','buybacks','capital-flow','docs','profile','leaderboard','paid','list','privacy']){
      await open(route);
      await check(`${route} ${width}px no overflow`,async()=>{const dimensions=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert(dimensions.scroll<=dimensions.width+1,JSON.stringify(dimensions));});
      await check(`${route} ${width}px route isolation`,async()=>{const leaking=await page.locator('main > [data-workspace-route]').evaluateAll(nodes=>nodes.filter(n=>n.getClientRects().length&&n.dataset.workspaceRoute!==location.hash.slice(1)).map(n=>n.textContent.slice(0,60)));assert.deepEqual(leaking,[]);});
      if(width===390) await check(`${route} mobile Help stays in the bottom navigation`,async()=>{
        const boxes=await page.evaluate(()=>{
          const rect=selector=>{const element=document.querySelector(selector),box=element?.getBoundingClientRect();return box?{left:box.left,right:box.right,top:box.top,bottom:box.bottom}:null;};
          return {help:rect('.help-topics-trigger'),nav:rect('.mobile-workspace-nav'),lastLink:rect('.mobile-workspace-nav a:last-of-type')};
        });
        assert(boxes.help && boxes.nav && boxes.lastLink && boxes.help.top>=boxes.nav.top && boxes.help.bottom<=boxes.nav.bottom+2 && boxes.help.left>=boxes.lastLink.right-2,JSON.stringify(boxes));
      });
      if(route==='privacy' && width===390) await check('Privacy measurement checkbox aligns with its label',async()=>{
        assert.equal(await page.locator('.share-visit-consent').evaluate(element=>getComputedStyle(element).flexDirection),'row');
      });
      if(route==='payments' && width===390) await check('Reward choices use the shared navy surface',async()=>{
        await page.mouse.move(0,0);
        assert.equal(await page.locator('.reward-entry-grid > button').first().evaluate(element=>getComputedStyle(element).backgroundColor),'rgb(18, 27, 46)');
      });
      if(route==='explore' && width<=390) await check(`Explore ${width}px sort labels stay readable`,async()=>{
        const layout=await page.evaluate(()=>{
          const sort=document.querySelector('.explore-sort-buttons'),timeframe=document.querySelector('.explore-timeframe');
          return {sortBottom:sort.getBoundingClientRect().bottom,timeTop:timeframe.getBoundingClientRect().top,
            buttons:[...sort.querySelectorAll('button')].map(button=>({text:button.textContent.trim(),client:button.clientWidth,scroll:button.scrollWidth}))};
        });
        assert(layout.buttons.length===4 && layout.sortBottom<=layout.timeTop+1 && layout.buttons.every(button=>button.scroll<=button.client+1),JSON.stringify(layout));
      });
    }
  }
  await page.setViewportSize({width:1440,height:1000});
  for(const route of ['overview','explore','launch','payments','my-launches','community','analytics-detail','referrals','airdrops','buybacks','capital-flow','docs','profile','leaderboard','paid','list','privacy']){
    await open(route);
    await check(`${route} uses the shared desktop page shell`,async()=>{
      const style=await page.evaluate(()=>({
        background:getComputedStyle(document.body).backgroundColor,
        navigation:getComputedStyle(document.querySelector('.sidebar')).flexDirection,
        title:[...document.querySelectorAll('h1, #community > .section-heading h2')].some(heading=>heading.getClientRects().length>0),
      }));
      assert.equal(style.background,'rgb(11, 16, 32)');
      assert.equal(style.navigation,'row');
      assert(style.title,`Missing visible page title on ${route}`);
      const brand=await page.locator('.brand .brand-mark img').evaluate(image=>({source:image.getAttribute('src'),loaded:image.complete&&image.naturalWidth>0}));
      const wolfMark=brand.source?.includes('wolf-mark.svg') ||
        (brand.source?.startsWith('data:image/svg+xml') && decodeURIComponent(brand.source).includes('M9 29 11 4 25 19'));
      assert(wolfMark && brand.loaded,`${route} lost the wolf brand mark: ${brand.source?.slice(0,80)}`);
    });
  }
  await check('Workspace page titles and panels share the same scale and shape',async()=>{
    for(const route of ['payments','my-launches','analytics-detail','referrals','profile','privacy']){
      await open(route);
      const title=await page.locator('h1:visible').first().evaluate(element=>({size:getComputedStyle(element).fontSize,weight:getComputedStyle(element).fontWeight}));
      assert.equal(title.size,'48px',`${route} title size`);
      assert.equal(title.weight,'900',`${route} title weight`);
    }
    for(const route of ['analytics-detail','referrals','profile','buybacks']){
      await open(route);
      const radius=await page.locator('.main-content .panel:visible').first().evaluate(element=>getComputedStyle(element).borderRadius);
      assert.equal(radius,'2px',`${route} panel radius`);
    }
  });
  await page.setViewportSize({width:390,height:900});
  await check('Watchlist, capital flow, and burn subroutes open with their page headings visible',async()=>{
    for(const [route,heading] of [['community','#community h2'],['capital-flow','#capital-flow h2'],['buybacks','#buybacks h1']]){
      await open(route);
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      await page.waitForFunction(()=>window.scrollY===0,{timeout:5000});
      const layout=await page.evaluate(selector=>({
        header:document.querySelector('.topbar').getBoundingClientRect().top,
        heading:document.querySelector(selector).getBoundingClientRect().top,
      }),heading);
      assert(layout.header>=0&&layout.header<100,`${route} header is offscreen`);
      assert(layout.heading>0&&layout.heading<700,`${route} heading is offscreen`);
    }
  });
  await page.setViewportSize({width:1440,height:1000});
  await open('explore');
  await check('Desktop Explore filter panel remains fully reachable',async()=>{
    for(const {width,height} of [{width:768,height:650},{width:1024,height:768},{width:1440,height:1000}]){
      await page.setViewportSize({width,height});
      if(!(await page.locator('#explore-filter-popover').isVisible())) await page.locator('#explore-filter-toggle').click();
      const box=await page.locator('#explore-filter-popover').boundingBox();
      assert(box && box.x>=0 && box.x+box.width<=width && box.y>=0 && box.y+box.height<=height,
        `Explore filter clipped at ${width}x${height}: ${JSON.stringify(box)}`);
      assert.equal(await page.locator('#explore-filter-popover').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(18, 27, 46)');
      await page.locator('#explore-filter-close').click();
    }
    await page.setViewportSize({width:1440,height:1000});
  });
  await check('Shared search shows verified suggestions and opens Explore on unmatched query',async()=>{
    try {
      await page.locator('#header-search-trigger').click({timeout:3000});
      assert(await page.locator('#header-search-dialog').evaluate(element=>element.open));
      assert(await page.locator('#header-search-results').count());
      await page.locator('#header-search-input').fill('sample mint',{timeoutMs:3000});
      assert.equal(await page.locator('#global-search').inputValue(),'');
      assert((await page.locator('#header-search-results').innerText()).includes('No verified launch matches'));
      await page.locator('#header-search-input').press('Enter',{timeout:3000});
      assert(!(await page.locator('#header-search-dialog').evaluate(element=>element.open)));
      assert.equal(await page.locator('#global-search').inputValue(),'sample mint');
      assert.equal(await page.locator('#explore-search').inputValue(),'sample mint');
    } finally {
      if (await page.locator('#header-search-dialog').evaluate(element=>element.open)) await page.keyboard.press('Escape');
    }
  });
  await page.locator('#explore-search').fill('');
  await check('Shared search opens a verified token from its suggestion list',async()=>{
    await page.locator('#header-search-trigger').click();
    const options=page.locator('#header-search-results [role="option"]');
    if(await options.count()){
      const selected=await options.first().getAttribute('href');
      await page.locator('#header-search-input').press('Enter');
      await page.waitForURL(url=>url.pathname===selected,{timeout:5000});
      assert.equal(new URL(page.url()).pathname,selected);
      await open('explore');
    }else{
      assert((await page.locator('#header-search-results').innerText()).includes('No verified launches'));
      await page.keyboard.press('Escape');
    }
  });
  await check('Changing routes closes an open index dialog',async()=>{
    const boost=page.locator('[data-boost-mint]:visible').first();
    if(!(await boost.count())) return;
    await boost.click();
    assert(await page.locator('#explore-boost-dialog').evaluate(element=>element.open));
    await open('leaderboard');
    await check('Leaderboard has one ranking surface',async()=>{
      assert.equal(await page.locator('#leaderboard-podium').count(),0);
      assert(await page.locator('#leaderboard-table').isVisible());
    });
    assert(!(await page.locator('#explore-boost-dialog').evaluate(element=>element.open)));
    await open('explore');
  });
  await check('Explore results above fold',async()=>{
    const results=page.locator('#asset-grid:visible, .explore-scanner:visible').first();
    await results.waitFor({state:'visible',timeout:15000});
    const bounds=await results.boundingBox();
    assert(bounds && bounds.y<900,`Explore results position: ${JSON.stringify(bounds)}`);
  });
  await check('Launch Directory keeps its verified comparison columns',async()=>{
    assert.equal(await page.locator('.explore-hero h1').innerText(),'LAUNCH DIRECTORY');
    assert.equal((await page.locator('.scanner-heading span').first().textContent()).trim(),'Verified launches');
    await page.locator('button[data-explore-view="table"]').click();
    const table=page.getByRole('table',{name:'Verified launch table'});
    assert.equal(await table.locator('[role="columnheader"]').count(),11);
    const rows=table.locator('.scanner-row');
    if(await rows.count()) assert.equal(await rows.first().locator('[role="cell"]').count(),11);
    await page.locator('button[data-explore-view="grid"]').click();
  });
  await check('Launch Directory guide choices open distinct verification explanations',async()=>{
    const dialog=page.locator('#explore-proof-dialog');
    for(const [label,title] of [['About Launch Directory','About Launch Directory'],['The problem','Why Launch Directory exists'],['Proof of launch','What is verified?']]){
      await page.locator('.explore-hero-links').getByRole('button',{name:label,exact:true}).click();
      assert(await dialog.evaluate(element=>element.open));
      assert.equal(await dialog.evaluate(element=>getComputedStyle(element).borderTopColor),'rgb(72, 90, 115)');
      assert.equal(await dialog.locator('h2').innerText(),title);
      await dialog.getByRole('button',{name:'Close Launch Directory guide'}).click();
    }
  });
  await check('Watchlist preserves indexed migrated-market metrics',async()=>{
    const row=page.getByRole('table',{name:'Verified launch table'}).getByRole('row').filter({hasText:'Migrated'}).first();
    if(!(await row.count())) return;
    const save=row.getByRole('button',{name:'Save token to watchlist'});
    await save.click();
    try {
      await open('community');
      const card=page.locator('#watchlist-items .watchlist-token-card').first();
      await card.waitFor({timeout:15000});
      const text=await card.innerText();
      assert(!text.includes('See token page'), 'Watchlist suppressed indexed pool volume');
      assert(!text.includes('Pool unindexed'), 'Watchlist mislabels indexed pool activity');
      assert.notEqual(await card.locator('.portfolio-token-stats span').nth(1).locator('strong').innerText(),'—');
    } finally {
      const remove=page.locator('#watchlist-items [data-remove-watch]').first();
      if(await remove.count()) await remove.click();
      await open('explore');
    }
  });
  await page.screenshot({path:resolve(output,'explore-desktop.png'),timeout:12000});
  await open('leaderboard');
  await check('Leaderboard Burners and Burn Board switch with arrow keys',async()=>{
    const burners=page.locator('#leaderboard-burners-tab');
    assert.equal(await burners.getAttribute('aria-selected'),'true');
    assert.equal(await page.locator('#leaderboard-table').getAttribute('aria-label'),'Devnet wallet burn leaderboard');
    const burn=page.locator('#leaderboard-burn-board-tab');
    await burn.click();
    assert.equal(await burn.getAttribute('aria-selected'),'true');
    assert.equal(await page.locator('#leaderboard-table-title').innerText(),'Project burn board');
    assert.equal(await page.locator('#leaderboard-table').getAttribute('aria-label'),'Devnet project burn board');
    await burn.press('ArrowLeft');
    assert.equal(await burners.getAttribute('aria-selected'),'true');
    await burners.press('ArrowRight');
    assert.equal(await burn.getAttribute('aria-selected'),'true');
    await burn.press('ArrowRight');
    assert.equal(await page.locator('#leaderboard-creators-tab').getAttribute('aria-selected'),'true');
      assert.equal(await page.locator('#leaderboard-table').getAttribute('aria-label'),'Devnet creator launch leaderboard');
      assert((await page.locator('#leaderboard-table .leaderboard-table-head').innerText()).toLowerCase().includes('market cap'));
    await page.locator('#leaderboard-creators-tab').press('ArrowRight');
    assert.equal(await burners.getAttribute('aria-selected'),'true');
    assert.equal(await page.locator('#leaderboard-table').getAttribute('aria-label'),'Devnet wallet burn leaderboard');
    await burn.click();
  });
  await page.screenshot({path:resolve(output,'leaderboard-burn-board.png'),timeout:12000});
  await open('airdrops');
  await check('Airdrops show one directory and holder guidance in order',async()=>{
    const blocks=await page.locator('#airdrops').evaluate(element=>[...element.children].map(child=>child.className));
    const positions=['airdrop-hero-layout','airdrop-public-programs','airdrop-allocation-heading','airdrop-reference-flow'].map(name=>blocks.findIndex(value=>value.includes(name)));
    assert(positions.every(position=>position>=0) && positions.every((position,index)=>index===0||position>positions[index-1]),JSON.stringify(positions));
    assert.equal(await page.locator('#airdrop-claim-list').count(),0);
    assert.equal(await page.locator('#airdrops > .airdrop-enhancement-grid').count(),0);
    assert.deepEqual(await page.locator('.airdrop-reference-flow strong').allTextContents(),['Hold','Keep holding','Claim']);
  });
  await check('Airdrop detail distinguishes an unverified snapshot from token migration',async()=>{
    const detail=page.locator('#airdrop-selected-program');
    const openDetail=page.locator('[data-directory-mint]').first();
    if(await openDetail.count()){
      await openDetail.click();
      const box=await detail.boundingBox();
      assert(box && box.y>=0 && box.y<800,`Airdrop details did not scroll into view: ${JSON.stringify(box)}`);
      assert(!(await detail.innerText()).includes('Migration · pending'));
      assert((await detail.innerText()).includes('Migration snapshot · unverified'));
      await page.locator('#airdrop-detail-close').click();
    }
  });
  await page.locator('#toast.show').waitFor({state:'hidden',timeoutMs:7000});
  await page.screenshot({path:resolve(output,'airdrop-desktop.png'),timeout:12000});
  await check('Airdrop details open in the mobile viewport',async()=>{
    await page.setViewportSize({width:390,height:844});
    await open('airdrops');
    const button=page.locator('[data-directory-mint]').first();
    await button.waitFor({state:'visible',timeout:15000});
    await button.click();
    await page.waitForFunction(()=>{
      const panel=document.querySelector('#airdrop-selected-program');
      if(!panel || panel.hidden) return false;
      const rect=panel.getBoundingClientRect();
      return rect.top>=0 && rect.top<innerHeight/2 && rect.left>=0 && rect.right<=innerWidth;
    });
    await page.screenshot({path:resolve(output,'airdrop-detail-mobile.png'),timeout:12000});
    await page.setViewportSize({width:1440,height:1000});
  });
  await open('buybacks');
  await check('Burn page shows per-launch tier requirements without cumulative unlock claims',async()=>{
    const tierDisclosure=page.locator('.concise-tier-preview');
    if(await tierDisclosure.count()) await tierDisclosure.locator(':scope > summary').click();
    const card=page.locator('.burn-tier-card');
    await page.waitForFunction(()=>[...document.querySelectorAll('.burn-tier-row b')].every(element=>element.textContent.includes('$FUNDED')));
    assert.equal(await card.locator('.burn-tier-row').count(),3);
    assert.deepEqual(await card.locator('.burn-tier-row strong').allTextContents(),['Boost','Pro','Premier']);
    const amounts=(await card.locator('.burn-tier-row b').allTextContents()).map(text=>Number(text.replace(/[^\d]/g,'')));
    assert(amounts.every((amount,index)=>amount>0 && (index===0 || amount>amounts[index-1])));
    assert((await card.innerText()).includes('Standalone burns remain in your receipt history'));
    assert(!(await card.innerText()).includes('Unlocked by indexed receipts'));
    if(await tierDisclosure.count()) await tierDisclosure.locator(':scope > summary').click();
  });
  await page.screenshot({path:resolve(output,'burn-desktop.png'),timeout:12000});
  await open('list');
  await check('Get Listed gates payment on verified metadata (mocked UI response)',async()=>{
    const mint=page.locator('#list-mint');
    const details=page.locator('.list-token-fields');
    assert(!(await details.isVisible()));
    await mint.fill('invalid-mint');
    assert.equal(await mint.getAttribute('aria-invalid'),'true');
    assert(!(await details.isVisible()));
    const fixtureMint='Ai66LHZG9MCzg1WKdawwqduVAXpNDUuV8M3uyq5ppump';
    await page.route(`**/api/listings/mint/${fixtureMint}`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({cluster:'devnet',mint:fixtureMint,name:'Verified Fixture',symbol:'VFIX'})}));
    await mint.fill(fixtureMint);
    await page.locator('#list-token-preview').getByText('Verified Fixture').waitFor({state:'visible',timeout:5000});
    assert(!(await details.isVisible()));
    assert((await page.locator('#list-mint-help').innerText()).includes('Valid address format'));
    const previewText=await page.locator('#list-token-preview').innerText();
    assert(previewText.includes('Verified Fixture'),previewText);
    assert.equal(await page.locator('#list-name').inputValue(),'Verified Fixture');
    assert.equal(await page.locator('#list-name').getAttribute('readonly'),'');
    assert(await page.locator('#list-pay').isVisible());
    assert.equal(await page.locator('#list-pay').isEnabled(),(await page.locator('#list-availability').innerText()).includes('25,000 $FUNDED'));
    await mint.fill('11111111111111111111111111111111');
    assert(!(await details.isVisible()));
    assert(await page.locator('#list-pay').isDisabled());
    await page.unroute(`**/api/listings/mint/${fixtureMint}`);
  });
  await page.locator('#list-mint').fill('');
  await page.screenshot({path:resolve(output,'list-desktop.png'),timeout:12000});
  await page.goto(`${base}/#docs/faq`,{waitUntil:'domcontentloaded'});
  await page.waitForSelector('body.workspace-ready');
  await check('Docs topics have direct links and browser history',async()=>{
    assert.equal(await page.locator('.docs-guide-nav button').count(),16);
    assert.equal(await page.locator('.docs-guide-article h1').innerText(),'FAQ');
    await page.getByRole('button',{name:'Enhanced coin page'}).click();
    assert(page.url().endsWith('#docs/enhanced-page'));
    assert.equal(await page.locator('.docs-guide-article h1').innerText(),'Enhanced coin page');
    await page.goBack();
    assert.equal(await page.locator('.docs-guide-article h1').innerText(),'FAQ');
    await page.getByRole('button',{name:'Launch Directory and boosts'}).click();
    assert(page.url().endsWith('#docs/index'));
    assert.equal(await page.locator('.docs-guide-article h1').innerText(),'Launch Directory and boosts');
    await page.goBack();
  });
  await check('Legal dialogs have accessible names and Escape clears direct routes',async()=>{
    for(const [route,title] of [['terms','Terms of Use'],['disclosures','Disclosures'],['opt-out','Opt out']]){
      await page.goto(`${base}/#${route}`,{waitUntil:'domcontentloaded'});
      await page.waitForSelector('body.workspace-ready');
      const dialog=page.getByRole('dialog',{name:title});
      assert(await dialog.isVisible(),`${route} dialog should be named and visible`);
      await page.keyboard.press('Escape');
      assert(await dialog.isHidden(),`${route} dialog should close with Escape`);
      assert(page.url().endsWith('#overview'),`${route} URL should leave the closed dialog route`);
    }
    await open('docs');
  });
  await page.getByRole('button',{name:'Enhanced coin page'}).click();
  await page.screenshot({path:resolve(output,'docs-desktop.png'),timeout:12000});
  await page.goto(`${base}/wallet/11111111111111111111111111111111`,{waitUntil:'domcontentloaded'});
  await page.waitForSelector('body.workspace-ready');
  await check('Public wallet activity filters expose verified record types',async()=>{
    const filters=page.locator('#wallet-detail-filters');
    assert(await filters.isVisible());
    assert((await page.locator('#wallet-page-title').innerText()).includes('1111'));
    assert.equal(await filters.locator('button').count(),5);
    await filters.locator('[data-wallet-filter="burn"]').click();
    assert.equal(await filters.locator('[data-wallet-filter="burn"]').getAttribute('aria-pressed'),'true');
    assert((await page.locator('#wallet-detail-content').innerText()).includes('No burn records'));
    await page.locator('[data-wallet-tab="created"]').click();
    assert(!(await filters.isVisible()));
    await page.locator('[data-wallet-tab="activity"]').click();
    assert(await filters.isVisible());
  });
  await page.screenshot({path:resolve(output,'wallet-desktop.png'),timeout:12000});
  await page.setViewportSize({width:390,height:844});
  await check('Mobile wallet profile keeps its coverage and stats within the viewport',async()=>{
    const layout=await page.evaluate(()=>({
      width:innerWidth,
      scroll:document.documentElement.scrollWidth,
      profile:document.querySelector('.wallet-detail-primary')?.getBoundingClientRect(),
      coverage:document.querySelector('.wallet-detail-proof')?.getBoundingClientRect(),
    }));
    assert(layout.scroll<=layout.width+1,JSON.stringify(layout));
    assert(layout.coverage.top>=layout.profile.bottom-1,JSON.stringify(layout));
    assert(await page.locator('.wallet-detail-stats').isVisible());
  });
  await page.screenshot({path:resolve(output,'wallet-mobile.png'),timeout:12000});
  await page.setViewportSize({width:1440,height:1000});
  await open('payments');
  await check('Rewards tab interaction and keyboard',async()=>{
    await page.getByRole('tab',{name:'Creator',exact:true}).click();assert(await page.locator('#rewards-creator').isVisible());assert(!await page.locator('#rewards-x').isVisible());
    await page.keyboard.press('ArrowRight');assert(await page.locator('#rewards-holder').isVisible());
    await page.getByRole('tab',{name:'X partner',exact:true}).click();assert(await page.locator('#x-sign-in').isVisible());
    await page.getByRole('tab',{name:'Overview',exact:true}).click();assert(await page.locator('#rewards-overview').isVisible());assert(await page.locator('#rewards-overview .reward-entry-grid > a').first().isVisible());
  });
  await check('Holder allocation status does not claim migrated coins await migration',async()=>{
    await page.getByRole('tab',{name:'Holder',exact:true}).click();
    const list=page.locator('[data-funded-token-list]');
    await list.first().waitFor({timeout:15000});
    const labels=await list.first().innerText();
    assert(!labels.includes('Migration pending'));
    if((await list.first().locator('.funded-token-row').count())>0) assert(labels.includes('snapshot unverified'));
    await page.getByRole('tab',{name:'Overview',exact:true}).click();
  });
  await page.screenshot({path:resolve(output,'rewards-desktop.png'),timeout:12000});
  await open('launch');
  await check('Launch tier explanations show the selected policy and close',async()=>{
    const dialog=page.locator('.launch-tier-guide-dialog');
    await page.locator('#token-name').fill('UI tier guide');
    await page.locator('#token-symbol').fill('UIGUIDE');
    await page.locator('#launch-next').click();
    await page.locator('.launch-advanced-options summary').click();
    await page.getByRole('button',{name:'About Pro',exact:true}).click();
    assert(await dialog.evaluate(element=>element.open));
    assert.equal(await dialog.evaluate(element=>getComputedStyle(element).borderTopColor),'rgb(72, 90, 115)');
    assert((await dialog.locator('h3').innerText()).includes('Pro'));
    await dialog.getByRole('button',{name:'Close tier guide'}).click();
    assert(!(await dialog.evaluate(element=>element.open)));
    await page.locator('#launch-back').click();
    await page.locator('#token-name').fill('');
  });
  await check('Invalid identity blocks step advancement',async()=>{await page.locator('#token-name').fill('');await page.locator('#launch-next').click();assert.equal(await page.locator('#launch-dialog').getAttribute('data-step'),'1');});
  await check('Launch settings then review; no signing',async()=>{
    await page.locator('#token-name').fill('UI review draft');await page.locator('#token-symbol').fill('UITEST');await page.locator('#launch-next').click();
    assert.equal(await page.locator('#launch-dialog').getAttribute('data-step'),'2');assert(await page.locator('#community-airdrop-tokens').isVisible());assert(!await page.locator('#token-name').isVisible());
    await page.locator('#community-airdrop-tokens').fill('1');await page.locator('#launch-next').click();assert.equal(await page.locator('#launch-dialog').getAttribute('data-step'),'2');
    await page.locator('#community-airdrop-tokens').fill('30000000');await page.locator('#launch-next').click();assert.equal(await page.locator('#launch-dialog').getAttribute('data-step'),'3');
    assert(await page.locator('#terms-agree').isVisible());assert(await page.locator('#fee-route-agree').isVisible());assert(await page.locator('#launch-button').isDisabled());
    await page.locator('#launch-back').click();assert.equal(await page.locator('#launch-dialog').getAttribute('data-step'),'2');
    await page.locator('#launch-back').click();assert.equal(await page.locator('#token-name').inputValue(),'UI review draft');
  });
  await page.screenshot({path:resolve(output,'launch-desktop.png'),timeout:12000});
  await check('Explicit public draft storage excludes approval state',async()=>{
    const current=await page.locator('#save-launch-draft').count()>0;
    const draftKey=current?'funded.launch.draft.v1':'funded.public-launch-draft';
    const action=name=>page.locator(current?`#${name}-launch-draft`:`[data-draft-action="${name}"]`);
    await action('save').click();
    const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),draftKey);
    assert(saved,'Draft should be stored explicitly');
    assert.deepEqual(current?[saved.name,saved.symbol]:[saved['token-name'],saved['token-symbol']],['UI review draft','UITEST']);
    assert(!Object.keys(saved).some(key=>/walletSecret|feeConsent|termsConsent|terms-agree|fee-route-agree/i.test(key)));
    await page.locator('#token-name').fill('Changed name');await action('restore').click();assert.equal(await page.locator('#token-name').inputValue(),'UI review draft');
    assert(!(await page.locator('#terms-agree').isChecked()));assert(!(await page.locator('#fee-route-agree').isChecked()));
    await action('delete').click();assert.equal(await page.evaluate(key=>localStorage.getItem(key),draftKey),null);
  });
  await check('Analytics source disclosure does not wait on a hidden-tab refresh',async()=>{
    await open('analytics-detail');
    await page.locator('#analytics-detail .ui-disclosure summary').click();
    const source=await page.locator('#analytics-technical-source').innerText();
    assert(source.trim().length>20, 'Source disclosure should describe the current analytics state');
    assert(!source.includes('appear after the next refresh'), 'Source disclosure must not show a stale placeholder');
  });
  await check('Related menu pages share one destination and keep old links working',async()=>{
    for(const [route,host,child,menu] of [
      ['community','my-launches','community','#my-launches'],
      ['capital-flow','analytics-detail','capital-flow','#analytics-detail'],
      ['buybacks','paid','buybacks','/funded'],
    ]){
      await open(route);
      assert.equal(await page.locator(`#${child}`).evaluate(element=>element.parentElement.id),host);
      assert(await page.locator(`#${host}`).isVisible());
      assert(await page.locator(`#${child}`).isVisible());
      assert.equal(await page.locator(`.purpose-page-nav a[href="#${route}"]`).getAttribute('aria-current'),'location');
      assert(await page.locator(`.primary-nav .nav-item.active[href="${menu}"]`).count()>0);
      assert.equal(await page.locator(`.nav-more-menu a[href="#${route}"]`).count(),0);
    }
  });
  await check('Parent pages retain their primary panels while child subroutes focus their own',async()=>{
    for(const [parent,child,primary] of [
      ['my-launches','community','#my-launches > .role-grid'],
      ['analytics-detail','capital-flow','#analytics-detail .analytics-kpis'],
      ['paid','buybacks','#paid .paid-reference-hero'],
    ]){
      await open(parent);
      assert(await page.locator(primary).isVisible(),`${parent} primary panel hidden`);
      assert(!await page.locator('body').evaluate((body,subroute)=>body.classList.contains(`page-route-${subroute}`),child),`${parent} styled as ${child}`);
      await open(child);
      assert(!await page.locator(primary).isVisible(),`${child} did not focus its subroute`);
    }
    await page.goto(`${base}/funded`,{waitUntil:'domcontentloaded'});
    await page.waitForSelector('body.workspace-ready');
    assert(await page.locator('#paid .paid-reference-hero').isVisible(),'/funded primary panel hidden');
  });
  await page.setViewportSize({width:390,height:844});
  for(const route of ['my-launches','payments','analytics-detail','referrals','privacy']){
    await open(route);
    await page.screenshot({path:resolve(output,`${route}-mobile.png`),timeout:12000});
  }
  await open('explore');
  await check('Mobile Explore keeps quick sorts visible and detail controls in Filters',async()=>{
    assert.equal(await page.locator('.explore-sort-buttons button:visible').count(),4);
    assert((await page.locator('#explore-filter-toggle').boundingBox()).height>=44);
    await page.locator('#explore-filter-toggle').click();
    for(const selector of ['[data-explore-window="24h"]','[data-explore-stage="near"]'])assert((await page.locator(selector).boundingBox()).height>=44,selector);
    assert(await page.locator('#explore-filter-popover #explore-sort').isVisible());
    await page.locator('#explore-filter-close').click();
  });
  await check('Mobile filter dismissal',async()=>{await page.locator('#explore-filter-toggle').click();assert(await page.locator('#explore-filter-popover').isVisible());await page.locator('#explore-filter-close').click();assert(!await page.locator('#explore-filter-popover').isVisible());});
  await check('Mobile Explore table empty state wraps inside its viewport',async()=>{
    await page.locator('button[data-explore-view="table"]').click();
    const empty=page.locator('#launch-list .empty-state');
    if(await empty.isVisible()){
      const box=await empty.boundingBox();
      assert(box && box.x>=0 && box.x+box.width<=390,`Empty table message clipped: ${JSON.stringify(box)}`);
    }
    await page.locator('button[data-explore-view="grid"]').last().click();
  });
  await page.screenshot({path:resolve(output,'explore-mobile.png'),timeout:12000});
  await check('Mobile network label visible',async()=>assert(await page.locator('.workspace-network').isVisible()));
  // An observed Devnet mint keeps route-layout coverage independent of feed/RPC availability.
  const tokenHref=await page.locator('#asset-grid .asset-actions a[href^="/token/"]').evaluateAll(links=>links[0]?.getAttribute('href')) || '/token/9BoQNeD7MUN7Rs9x1oZS3pc3JXu9AJ8Gb89sPcGGXH2w';
  // These checks inject profile metadata; keep a late live response from replacing the fixture.
  await context.route('**/devnet-metadata/**',route=>route.fulfill({status:404,contentType:'application/json',body:'{"error":"Profile metadata is mocked by this UI check"}'}));
  await page.goto(new URL(tokenHref,base).href,{waitUntil:'domcontentloaded'});await page.waitForSelector('body.workspace-ready');
  await page.waitForFunction(()=>!['Loading…','Checking…'].includes(document.querySelector('#coin-market-cap')?.textContent?.trim()),null,{timeout:20000});
  await check('Coin profile keeps empty optional tabs out of navigation',async()=>{
    const profile=page.getByRole('tablist',{name:'Token profile'});
    assert.deepEqual(await profile.getByRole('tab').allTextContents(),['About','Updates']);
    assert(await page.locator('#coin-profile-roadmap-section').isHidden());
    assert(await page.locator('#coin-profile-links').isHidden());
    await profile.getByRole('tab',{name:'Updates'}).click();
    assert(await page.locator('.coin-profile-updates').isVisible());
    await profile.getByRole('tab',{name:'About'}).click();
  });
  await check('Mocked signed profile metadata opens Roadmap and Links tabs',async()=>{
    const profile=page.getByRole('tablist',{name:'Token profile'});
    await page.evaluate(()=>window.fundedSetCoinProfileMetadata({roadmap:'Ship a verified Devnet release',website:'https://example.org/project',twitter:'https://x.com/example'}));
    assert.deepEqual(await profile.getByRole('tab').allTextContents(),['About','Updates','Roadmap','Links']);
    await profile.getByRole('tab',{name:'Roadmap'}).click();
    assert((await page.locator('#coin-profile-roadmap-section').innerText()).includes('Ship a verified Devnet release'));
    await profile.getByRole('tab',{name:'Links'}).click();
    assert.equal(await page.locator('#coin-profile-links .coin-profile-links-list a').count(),2);
    assert.equal(await page.locator('#coin-profile-links .coin-profile-links-list a').first().getAttribute('href'),'https://example.org/project');
    await profile.getByRole('tab',{name:'Links'}).press('ArrowRight');
    assert.equal(await profile.getByRole('tab',{name:'About'}).getAttribute('aria-selected'),'true');
    await profile.getByRole('tab',{name:'Links'}).click();
    await page.evaluate(()=>window.fundedSetCoinProfileMetadata({}));
    assert.deepEqual(await profile.getByRole('tab').allTextContents(),['About','Updates']);
    assert.equal(await profile.getByRole('tab',{name:'About'}).getAttribute('aria-selected'),'true');
  });
  await check('Coin chart filters confirmed observations by selected range',async()=>{
    if(await page.locator('[data-coin-chart-view="trades"]').isVisible()){
      await page.locator('[data-coin-chart-view="trades"]').click();
      assert.equal(await page.locator('[data-coin-chart-period]').count(),4);
      await page.locator('[data-coin-chart-period="5m"]').click();
      assert.equal(await page.locator('[data-coin-chart-period="5m"]').getAttribute('aria-pressed'),'true');
      assert((await page.locator('#coin-price-path').innerText()).includes('5m'));
      await page.locator('[data-coin-chart-period="24h"]').click();
      assert.equal(await page.locator('[data-coin-chart-period="24h"]').getAttribute('aria-pressed'),'true');
    }else{
      assert(await page.getByRole('button',{name:'Snapshot',exact:true}).first().isVisible());
    }
  });
  await page.screenshot({path:resolve(output,'token-chart-mobile.png'),timeout:12000});
  await page.setViewportSize({width:1440,height:1000});
  await check('Coin quick buy shortcuts can be edited and reset locally',async()=>{
    await page.locator('#coin-quick-edit-trigger').click();
    const dialog=page.locator('#coin-quick-edit-dialog');
    assert(await dialog.evaluate(element=>element.open));
    await dialog.getByRole('textbox',{name:'Quick amount 1 in SOL'}).fill('0.07');
    await dialog.getByRole('button',{name:'Save'}).click();
    assert.equal(await page.locator('[data-coin-buy-amount]').first().getAttribute('data-coin-buy-amount'),'0.07');
    assert.equal(JSON.parse(await page.evaluate(()=>localStorage.getItem('funded.coin-quick-buy-amounts.v1')))[0],'0.07');
    await page.locator('#coin-quick-edit-trigger').click();
    await dialog.getByRole('button',{name:'Reset defaults'}).click();
    await dialog.getByRole('button',{name:'Save'}).click();
    assert.equal(await page.locator('[data-coin-buy-amount]').first().getAttribute('data-coin-buy-amount'),'0.1');
  });
  await page.setViewportSize({width:390,height:844});
  await check('Mobile token trade sheet traps focus and restores it',async()=>{
    const button=page.locator('.mobile-trade-open');await button.click();
    assert.equal(await page.locator('#trade-panel').getAttribute('aria-modal'),'true');
    await page.locator('#coin-quick-edit-trigger').click();
    assert(await page.locator('#coin-quick-edit-dialog').evaluate(el=>el.open));
    await page.locator('#coin-quick-edit-cancel').click();
    await page.keyboard.press('Shift+Tab');assert(await page.locator('#trade-panel').evaluate(el=>el.contains(document.activeElement)));
    assert(await page.locator('.mobile-workspace-nav').evaluate(el=>el.inert));
    assert(!(await page.locator('#trade-review-dialog').evaluate(el=>el.inert)));
    assert(!(await page.locator('#mobile-wallet-dialog').evaluate(el=>el.inert)));
    await page.locator('#trade-review-dialog').evaluate(el=>el.showModal());
    await page.locator('#trade-review-cancel').click({timeout:1500});
    assert(!(await page.locator('#trade-review-dialog').evaluate(el=>el.open)));
    await page.keyboard.press('Escape');assert.equal(await button.getAttribute('aria-expanded'),'false');assert(await button.evaluate(el=>el===document.activeElement));
    assert(!(await page.locator('.mobile-workspace-nav').evaluate(el=>el.inert)));
  });
  await page.screenshot({path:resolve(output,'token-mobile.png'),timeout:12000});
  await check('No uncaught JavaScript errors',async()=>assert.deepEqual(errors,[]));
} catch(error) {
  failures.push(`Suite interrupted: ${error.message}`);
} finally {
  await writeFile(resolve(output,'results.json'),JSON.stringify({label:'local-only; no transactions submitted',results,failures,errors},null,2));
  await browser.close();
}
console.log(JSON.stringify({passed:results.filter(x=>x.status==='passed').length,failed:failures.length,failures,output},null,2));
if(failures.length)process.exitCode=1;
