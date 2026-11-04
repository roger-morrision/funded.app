import{test,expect}from'@playwright/test';
import{PROTOCOL_FEE_SPLIT}from'../../config/protocol-fee-split.js';
const creators=[{id:'101',name:'Alpha community',handle:'@alpha',identityVerified:true,coinCount:2},{id:'102',name:'Beta creator with a long name for responsive review',handle:'@beta',identityVerified:false,coinCount:1}],extra={id:'103',name:'Gamma community',handle:'@gamma',identityVerified:true,coinCount:1};
for(const width of[320,390,768,1440])test(`creator discovery, report review and help remain clear at ${width}px (mocked APIs)`,async({page,baseURL},info)=>{
 test.setTimeout(60000);await page.setViewportSize({width,height:960});const errors=[],writes=[];let directoryDown=false;page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{sessionStorage.setItem('funded.app.wallet.manual-disconnect','1');localStorage.setItem('funded.creator.following','["101"]');window.workflowCopied=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.workflowCopied.push(text)}});});
 await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(baseURL).origin?r.fallback():r.abort());
 await page.route('**/api/**',r=>{const q=r.request(),url=new URL(q.url());if(q.method()!=='GET'&&url.pathname!=='/api/solana/rpc')writes.push(url.pathname);
  if(url.pathname==='/api/fee-policy')return r.fulfill({json:{revision:6,split:PROTOCOL_FEE_SPLIT}});
  if(url.pathname==='/api/creators'&&!directoryDown){const query=(url.searchParams.get('q')||'').toLowerCase(),ids=url.searchParams.get('ids')?.split(','),after=url.searchParams.get('after');return r.fulfill({json:{creators:(after?[extra]:creators).filter(c=>(!ids||ids.includes(c.id))&&(c.name+' '+c.handle).toLowerCase().includes(query)),nextCursor:!after&&!query&&!ids?'next':null}});}
  if(url.pathname==='/api/creator-support/issues/config')return r.fulfill({json:{cluster:'devnet',enabled:false}});
  return r.fulfill({status:503,json:{error:'Unavailable community review fixture'}});
 });
 await page.goto('/?private=excluded#profile');await page.locator('body.product-flows-ready').waitFor();
 const report=page.locator('#issue-reports'),outer=page.locator('#issue-reports-details > summary');await outer.focus();await page.keyboard.press('Enter');
 const review=report.getByRole('button',{name:'Review report',exact:true}),copy=report.getByRole('button',{name:'Copy reviewed report',exact:true}),send=report.getByRole('button',{name:'Send reviewed report',exact:true});
 await expect(copy).toBeDisabled();await expect(send).toBeDisabled();await expect(report.getByRole('heading',{name:'Your report status',exact:true})).toBeHidden();
 await report.getByLabel('Report category',{exact:true}).selectOption('request');const description=report.getByLabel('Describe what happened',{exact:true});await description.fill('An example layout issue during local UI testing.');await report.getByLabel('Include this page and public transaction details',{exact:true}).check();await review.click();
 const payload=JSON.parse(await report.locator('pre').innerText());expect(payload.category).toBe('request');expect(payload.context.route).toBe('/#profile');expect(JSON.stringify(payload)).not.toContain('private');await expect(copy).toBeEnabled();await expect(send).toBeDisabled();
 await copy.focus();await page.keyboard.press('Enter');expect(JSON.parse(await page.evaluate(()=>window.workflowCopied.at(-1)))).toEqual(payload);
 await description.fill('Updated layout issue during local UI testing.');await expect(copy).toBeDisabled();await expect(send).toBeDisabled();await expect(report.locator('pre')).toBeHidden();await expect(report.getByRole('status')).toContainText('Changes need a new review');
 for(const control of[review,copy,send])expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44);
 await report.screenshot({path:info.outputPath(`report-${width}.png`)});
 await page.evaluate(()=>location.hash='creators');const directory=page.locator('#creator-directory'),methods=page.locator('.creator-directory-methods');await expect(directory.locator('.creator-card')).toHaveCount(2);
 const more=page.getByRole('button',{name:'Load more creators',exact:true});await more.click();await expect(directory.locator('.creator-card')).toHaveCount(3);await expect(more).toBeHidden();
 await methods.locator('summary').focus();await page.keyboard.press('Enter');await expect(methods).toContainText('A fan-created coin is not an endorsement');
 const search=page.getByLabel('Find a creator',{exact:true}),following=page.getByLabel('Following on this device',{exact:true});await search.fill('Beta');await expect(directory.locator('.creator-card')).toHaveCount(1);await expect(directory).toContainText('unverified ownership');await expect(directory.locator('a')).toHaveAttribute('href','/creator/x/102');
 await following.check();await expect(directory.locator('.creator-card')).toHaveCount(0);await expect(page.locator('#creator-directory-status')).toContainText('No matching creators');await search.fill('');await expect(directory.locator('.creator-card')).toHaveCount(1);await expect(directory).toContainText('Alpha community');await expect(methods).toHaveAttribute('open','');
 await following.uncheck();await expect(directory.locator('.creator-card')).toHaveCount(2);await methods.locator('summary').focus();await page.keyboard.press('Space');
 expect((await search.boundingBox()).height).toBeGreaterThanOrEqual(44);if(width<=700)expect(await search.evaluate(e=>parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:info.outputPath(`creators-${width}.png`)});directoryDown=true;await search.fill('unavailable');await expect(page.locator('#creator-directory-status')).toContainText('Unavailable community review fixture');
 await page.evaluate(()=>location.hash='overview');await page.locator('body.page-route-overview').waitFor();
 if(width===1440){const trigger=page.getByRole('button',{name:'Open help topics',exact:true}),panel=page.locator('#help-topics-panel');await trigger.click();await expect(panel).toBeVisible();const topic=panel.locator('[data-help-topic]').first();await topic.focus();await page.keyboard.press('Enter');await expect(topic).toHaveAttribute('aria-pressed','true');
  for(const control of await panel.locator('button').all())expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await panel.evaluate(e=>e.scrollTop=e.scrollHeight);const frame=await panel.boundingBox(),close=await panel.getByRole('button',{name:'Close help topics',exact:true}).boundingBox();expect(close.y).toBeGreaterThanOrEqual(frame.y);expect(close.y+close.height).toBeLessThanOrEqual(frame.y+frame.height);await page.screenshot({path:info.outputPath('help-desktop.png')});await page.keyboard.press('Escape');await expect(trigger).toBeFocused();}
 const searchTrigger=page.locator('#header-search-trigger');await searchTrigger.click();await expect(page.locator('#header-search-dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(searchTrigger).toBeFocused();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(errors).toEqual([]);expect(writes).toEqual([]);
});
