import {test,expect} from '@playwright/test';
const mint=process.env.SMOKE_TOKEN_MINT||'38M2z4UCfZEkUHFzD48vhKQhFhNyRGto8pZbLjNipump';

// Public UI and browser persistence only. No injected wallet, signatures or funds.
test('guest favorites survive reload and can be removed',async({page})=>{
  await page.goto('/token/'+mint);const star=page.locator('#coin-watch');
  await expect(star).toBeVisible();await star.click();await expect(star).toHaveAttribute('aria-pressed','true');
  await expect.poll(()=>page.evaluate(m=>JSON.parse(localStorage.getItem('richpad.favorites.guest')||'[]').includes(m),mint)).toBe(true);
  await page.reload();await expect(star).toHaveAttribute('aria-pressed','true');
  await star.click();await expect(star).toHaveAttribute('aria-pressed','false');
  await page.reload();await expect(star).toHaveAttribute('aria-pressed','false');
});

test('referral links preserve first touch across navigation and reload',async({page})=>{
  const first='FND-123456ABCDEF',second='FND-ABCDEF654321';
  const read=()=>page.evaluate(()=>Object.entries(localStorage).flatMap(([key,value])=>{
    if(!key.includes('referral'))return [];try{const row=JSON.parse(value);return row?.lock==='first-touch'?[row]:[];}catch{return [];}
  }));
  await page.goto('/?ref='+first+'&src=copy#referrals');
  await expect.poll(async()=> (await read()).some(row=>row.code===first)).toBe(true);
  await page.goto('/?ref='+second+'#explore');await page.reload();
  const rows=await read();expect(rows.some(row=>row.code===first)).toBe(true);expect(rows.some(row=>row.code===second)).toBe(false);
});

test('token trading controls and boost dialog remain usable without signing',async({page})=>{
  await page.goto('/token/'+mint);await expect(page.locator('#trade-amount')).toBeVisible();
  await page.locator('#trade-amount').fill('0.1');await page.locator('#trade-slippage').fill('2');
  await expect(page.locator('#trade-amount')).toHaveValue('0.1');await expect(page.locator('#trade-slippage')).toHaveValue('2');
  await page.getByRole('button',{name:'Sell',exact:true}).click();await expect(page.locator('#trade-submit')).toContainText(/Sell/);
  await page.getByRole('button',{name:'Buy',exact:true}).click();await expect(page.locator('#trade-submit')).toContainText(/Buy/);
  await page.locator('#coin-boost').click();
  await expect(page.locator('dialog[open], [role="dialog"]:visible').first()).toBeVisible();
  await expect(page.getByRole('button',{name:'Boost for free (admin)'})).toHaveCount(0);
});
