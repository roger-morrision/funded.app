import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
const reportFile=process.env.PRODUCT_CANDIDATE_REPORT;
let report;
test.beforeAll(async()=>{
  if(!reportFile)return;
  report=JSON.parse(await readFile(reportFile,'utf8'));
  const url=new URL(report.base),isolatedRevision=report.deploymentProfile==='isolated-postgres'&&/^[a-f0-9]{40}$/.test(report.build);
  if(url.protocol!=='http:'||!['localhost','127.0.0.1'].includes(url.hostname)||!(report.build.startsWith('local-product-')||isolatedRevision))throw new Error('Runtime tests require the isolated loopback candidate report.');
});
test.beforeEach(async({page})=>{
  test.skip(!reportFile,'Set PRODUCT_CANDIDATE_REPORT to an isolated API acceptance report.');
  await page.setViewportSize({width:390,height:900});
  await page.addInitScript(()=>sessionStorage.setItem('funded.app.wallet.manual-disconnect','1'));
  // The application API and its built assets are real. External artwork/fonts are unnecessary.
  await page.route('https://**/*',route=>route.abort());
});
test('built candidate exposes its tested identity and registered-operation coverage without mock API responses',async({page})=>{
  const caps=await page.request.get(`${report.base}/api/capabilities`);expect((await caps.json()).build).toBe(report.build);
  const settings=await (await page.request.get(`${report.base}/build-settings.json`)).json();expect(settings.devWalletEnabled).toBe(false);expect(settings.mainnetEnabled).toBe(false);expect(settings.sourceDigest).toBe(report.builtSettings.sourceDigest);
  await page.goto(`${report.base}/#payments/activity`);await expect(page.locator('body')).toHaveClass(/product-flows-ready/);
  await page.getByText('Financial engine health & creator delivery',{exact:true}).click();await expect(page.locator('#financial-engine')).toContainText('registered V3 launch policies');await expect(page.locator('#financial-engine')).not.toContainText('Financial engine health unavailable');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
});
test('built inspector displays the historical receipt independently rechecked by the acceptance runner',async({page})=>{
  const response=await page.request.get(`${report.base}/api/financial/receipts/${report.recordedReceipt}`);expect(response.ok()).toBe(true);const data=await response.json();
  expect(data.currentRpcRecheck).toBe(false);expect(data.burns[0].spentLamports).toBe(report.chainProof.spentLamports);expect(data.burns[0].burnedBaseUnits).toBe(report.chainProof.burnedBaseUnits);
  await page.goto(`${report.base}/?receipt=${report.recordedReceipt}#payments/activity`);await expect(page.locator('#receipt-inspector')).toBeVisible();await expect(page.locator('#receipt-inspector')).toContainText(report.recordedReceipt);await expect(page.locator('#receipt-inspector')).toContainText(`${report.chainProof.burnedBaseUnits} $FUNDED base units`);await expect(page.locator('#receipt-inspector')).toContainText('current RPC recheck is not included');
});
test('guest report is submitted and reloaded through the real candidate API',async({page})=>{
  await page.goto(`${report.base}/#profile`);await expect(page.locator('body')).toHaveClass(/product-flows-ready/);
  const root=page.locator('#issue-reports');await expect(root).toContainText('Report service ready');await root.getByLabel('Describe what happened').fill('Local candidate browser acceptance probe; no real user issue.');await root.getByRole('button',{name:'Review report',exact:true}).click();
  const saved=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/creator-support/issues'&&response.request().method()==='POST');await root.getByRole('button',{name:'Send reviewed report'}).click();expect((await saved).status()).toBe(201);await expect(root).toContainText('Report received');
  await page.reload();await expect(page.locator('body')).toHaveClass(/product-flows-ready/);await root.getByRole('button',{name:'Check status'}).click();await expect(root).toContainText('received · No reviewer note yet.');
});
