import {test,expect} from '@playwright/test';

test('wallet changes clear personal rewards immediately and reject late responses (mocked)',async({page})=>{
  await page.route('https://**/*',route=>route.abort());
  await page.goto('/tests/launch-review.html');
  await page.evaluate(async()=>{
    document.body.insertAdjacentHTML('beforeend','<div id="rewards-overview"></div>');
    location.hash='payments';
    const {initializeFinancialCenter}=await import('/src/features/experience/financial-center.js');
    const wallet='11111111111111111111111111111111',mint='So11111111111111111111111111111111111111112';
    window.scopeFixture={connectedWalletAddress:wallet,hold:false,apiRequest:async path=>{
      if(path.startsWith('/api/rewards/experience')){
        const address=new URL(path,location.origin).searchParams.get('wallet');
        const reply={available:true,data:{cluster:'devnet',evidence:{status:'recorded-finalized-v3'},wallet:{address,rows:[{mint,payouts:[{kind:'holder',wallet:address,feeSourceVerified:true,signature:'4'.repeat(64),amountLamports:'123',paidAt:'2026-11-05T00:00:00Z'}]}]}}};
        if(window.scopeFixture.hold)return new Promise(resolve=>window.releaseScopeResponse=()=>resolve(reply));
        return reply;
      }
      if(path==='/api/buyback/status')return{available:true,data:{cluster:'devnet',pending:[{mint,amountLamports:'999',status:'below-minimum-order'}],receipts:[]}};
      return{available:false};
    }};
    initializeFinancialCenter(window.scopeFixture);
  });
  const center=page.locator('#financial-center'),rows=center.locator('.financial-record');
  await expect(rows).toHaveCount(1);await expect(rows).toContainText('0.000000123 SOL');
  await center.getByLabel('Activity scope').selectOption('protocol');
  await expect(rows).toHaveCount(1);await expect(rows).toContainText('0.000000999 SOL');
  await page.evaluate(()=>window.scopeFixture.hold=true);await center.getByRole('button',{name:'Refresh activity'}).click();
  await expect(center.locator('[data-flow-rows]')).toHaveAttribute('aria-busy','true');
  await expect(center.locator('.ready-queue')).toBeHidden();
  await page.evaluate(()=>{window.scopeFixture.hold=false;window.releaseScopeResponse();});
  await expect(center.locator('[data-flow-rows]')).toHaveAttribute('aria-busy','false');
  await center.getByLabel('Activity scope').selectOption('personal');await expect(rows).toContainText('0.000000123 SOL');
  await page.evaluate(()=>{window.scopeFixture.hold=true;window.scopeFixture.connectedWalletAddress='So11111111111111111111111111111111111111112';window.dispatchEvent(new Event('funded:reward-identity-change'));});
  await expect(rows).toHaveCount(0);
  await page.evaluate(()=>{const release=window.releaseScopeResponse;window.scopeFixture.hold=false;window.scopeFixture.connectedWalletAddress=null;window.dispatchEvent(new Event('funded:reward-identity-change'));release();});
  await expect(center.locator('[data-flow-empty-title]')).toContainText('Connect a wallet');
  await expect(rows).toHaveCount(0);
  await expect(center.locator('[data-flow-status]')).toContainText('no wallet connected');
});
