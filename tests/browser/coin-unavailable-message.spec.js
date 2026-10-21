import {test,expect} from '@playwright/test';

for(const width of [360,390,1440]) test(`token error recovery and fee records remain usable at ${width}px`,async({page})=>{
  const mint='H8AKZYEfaTyFsdppSvDZtkfkRzb5TFuPf3q9GY9xY81z',signature='3'.repeat(64);
  const variants=[
    ['502 : <!DOCTYPE html><footer>Fixture gateway 192.0.2.1<script>fixture()</script></footer>','We could not load verified token details. Try Refresh in a moment.'],
    ['503 : Fixture upstream diagnostic from https://rpc.example.invalid/private','We could not load verified token details. Try Refresh in a moment.'],
    ['429 Too Many Requests','Solana is rate limited. Wait a moment, then select Refresh.'],
    ['Mint RPC request timed out','Solana timed out. Check your connection and select Refresh.'],
  ];
  await page.setViewportSize({width,height:900});
  await page.route('**/api/**',route=>route.fulfill({status:503,json:{error:'Offline token error fixture'}}));
  await page.route(`**/api/tokens/${mint}/fee-activity`,route=>route.fulfill({json:{mint,cluster:'devnet',overview:{available:true,scope:'per-mint-v3'},collections:[{signature,collectedLamports:'25887'}],claims:[{claimSignature:signature,asset:'SOL',grossCreatorFees:'0.000025887',status:'finalized'}]}}));
  await page.route('https://**/*',route=>route.abort());
  for(const [i,[body,expected]] of variants.entries()) {
    let release;
    const held=new Promise(resolve=>release=resolve);
    await page.route('**/api/solana/rpc',async route=>{await held;await route.fulfill({status:503,contentType:'text/plain',body});});
    await page.goto(`/token/${mint}`);
    await expect(page.locator('body')).toHaveClass(/workspace-ready/);
    const holders=page.getByRole('tab',{name:/^Holders/});
    await holders.click();
    await expect(holders).toBeFocused();
    release();
    await expect(page.locator('#coin-description')).toHaveText(expected);
    await expect(page.locator('#coin-activity-list')).toContainText(expected);
    await expect(holders).toBeFocused();
    await expect(holders).toHaveAttribute('aria-selected','true');
    await expect(page.getByRole('button',{name:'Refresh token data'})).toBeEnabled();
    const errorText=await page.locator('#coin-description').innerText();
    expect(errorText.length).toBeLessThan(120);
    expect(errorText).not.toMatch(/DOCTYPE|footer|script|192\.0\.2\.1|rpc\.example|diagnostic/);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    if(i===0)await page.screenshot({path:test.info().outputPath(`bounded-error-${width}-mocked.png`),fullPage:true});
    await page.getByRole('tab',{name:/^Fee claims/}).click();
    await expect(page.locator('#coin-activity-list')).toContainText('0.000025887 SOL');
    await page.getByRole('tab',{name:/^Allocations/}).click();
    await expect(page.locator('#coin-activity-list')).toContainText('0.000025887 SOL');
    await expect(page.locator('#coin-activity-list')).toContainText('These amounts may not have been paid yet.');
    await page.unroute('**/api/solana/rpc');
  }
});
