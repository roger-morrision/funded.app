import {test,expect} from '@playwright/test';
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';

for(const reducedMotion of ['no-preference','reduce'])for(const width of [360,390,430,1440]){
  test(`FQA-019 / UX-018 native banner focus clears navigation at ${width}px, motion ${reducedMotion} (mocked APIs)`,async({page},testInfo)=>{
    await page.emulateMedia({reducedMotion});await page.setViewportSize({width,height:width===1440?900:844});
    const errors=[];let fileChoosers=0;
    page.on('pageerror',e=>errors.push(e.message));page.on('filechooser',()=>fileChoosers++);
    await page.route('https://**/*',r=>r.abort());
    await page.route('**/api/**',r=>r.fulfill({status:503,json:{error:'Offline form-layout fixture'}}));
    await page.route('**/api/fee-policy',r=>r.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}));
    await page.goto('/#launch');await page.locator('body.workspace-ready.product-experience-ready.page-route-launch').waitFor();
    await page.waitForLoadState('networkidle');
    await page.evaluate(()=>document.fonts.ready);
    await page.locator('#token-name').fill('UX planning preview');await page.locator('#token-symbol').fill('UXQA');
    await page.locator('#launch-next').click();await expect(page.locator('[data-launch-step="2"]')).toBeVisible();
    const banner=page.locator('#token-banner');
    const clear=async()=>{
      await expect(banner).toBeFocused();
      const geometry=()=>banner.evaluate(e=>{
        const r=e.getBoundingClientRect(),s=getComputedStyle(e),n=document.querySelector('.mobile-workspace-nav'),h=document.querySelector('.topbar');
        const margin=(parseFloat(s.outlineWidth)||0)+Math.max(0,parseFloat(s.outlineOffset)||0);
        const top=h?.getClientRects().length?Math.max(0,h.getBoundingClientRect().bottom):0;
        const bottom=n?.getClientRects().length?n.getBoundingClientRect().top:innerHeight;
        const hits=[.1,.5,.9].flatMap(x=>[.1,.5,.9].map(y=>e.contains(document.elementFromPoint(r.x+r.width*x,r.y+r.height*y))));
        return {top:r.top,bottom:r.bottom,clearTop:top,clearBottom:bottom,margin,visible:r.top-margin>=top&&r.bottom+margin<=bottom,hits,focusVisible:e.matches(':focus-visible'),outline:s.outlineStyle,files:e.files.length,type:e.type,help:e.getAttribute('aria-describedby')};
      });
      // Native desktop focus scrolling can settle after the focus event.
      // Require full clearance/hit ownership within the same bounded window
      // used for the stable live reproduction; never scroll from the test.
      let state;
      try{await expect.poll(async()=>{state=await geometry();return state.visible&&state.hits.every(Boolean);},{timeout:750}).toBe(true);}
      catch(error){throw new Error(JSON.stringify(state),{cause:error});}
      expect(state,JSON.stringify(state)).toMatchObject({visible:true,focusVisible:true,outline:'solid',files:0,type:'file',help:'token-banner-help token-banner-status'});
      expect(state.hits.every(Boolean),JSON.stringify(state)).toBe(true);
      return state;
    };
    for(const tier of ['pro','premier']){
      await page.locator(`button[data-burn-tier="${tier}"]`).click();
      if(tier==='pro'){await page.keyboard.press('Tab');await expect(page.locator('button[data-burn-tier="premier"]')).toBeFocused();}
      await page.keyboard.press('Tab');await clear();
      await page.keyboard.press('Shift+Tab');await expect(page.locator('button[data-burn-tier="premier"]')).toBeFocused();
      await page.keyboard.press('Tab');await clear();
      // Exercise the real passive price/balance refresh handler without moving
      // native keyboard focus or supplying a wallet/upload/approved quote.
      await page.locator('#launch-tier-refresh').evaluate(e=>e.click());await page.waitForTimeout(700);await clear();
      await expect(page.locator('#token-name')).toHaveValue('UX planning preview');await expect(page.locator('#token-symbol')).toHaveValue('UXQA');
      await expect(page.locator(`button[data-burn-tier="${tier}"]`)).toHaveAttribute('aria-pressed','true');
      await expect(page.locator('#token-banner-status')).toHaveText('No banner selected.');
      if(width===1440){
        const before=await page.evaluate(()=>({scrollY,top:document.querySelector('#token-banner').getBoundingClientRect().top}));
        await banner.evaluate(e=>{e.blur();e.focus({preventScroll:true});});
        await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
        expect(await page.evaluate(()=>({scrollY,top:document.querySelector('#token-banner').getBoundingClientRect().top}))).toEqual(before);
      }
      if(tier==='pro')await page.screenshot({path:testInfo.outputPath('banner-focused.png')});
    }
    await page.locator('button[data-burn-tier="standard"]').click();await expect(banner).toBeHidden();
    for(let i=0;i<8;i++){await page.keyboard.press('Tab');await expect(banner).not.toBeFocused();}
    expect(fileChoosers).toBe(0);expect(errors).toEqual([]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
  });
}
