import {chromium} from '@playwright/test';

// Let Vite finish its first SDK dependency scan before timing user interactions.
// The warm-up has no wallet and fixtures every API/external request.
export default async function warmBrowserTests(config){
 const base=config.projects[0]?.use?.baseURL;if(!base)return;
 const url=new URL(base);if(!['127.0.0.1','localhost'].includes(url.hostname))return;
 const browser=await chromium.launch(config.projects[0].use.launchOptions||{}),context=await browser.newContext();
 try{
  await context.route('https://**/*',route=>route.abort());
  await context.route('**/api/**',route=>route.fulfill({status:503,json:{error:'Browser dependency warm-up fixture'}}));
  const page=await context.newPage();
  await page.goto(base+'/#overview',{waitUntil:'domcontentloaded',timeout:120000});
  await page.locator('body.workspace-ready').waitFor({timeout:120000});
  await page.goto(base+'/admin.html',{waitUntil:'domcontentloaded',timeout:120000});
  await page.locator('[data-rpc-health]').waitFor({state:'attached',timeout:120000});
 }finally{await context.close();await browser.close();}
}
