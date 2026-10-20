import{test,expect}from'@playwright/test';
import{PROTOCOL_FEE_SPLIT}from'../../config/protocol-fee-split.js';
const liveBase=process.env.CAMPAIGN_FOCUS_LIVE_BASE;

for(const reducedMotion of['no-preference','reduce'])for(const width of[360,390,430,1440]){
  test(`FQA-023 native campaign focus clears navigation at ${width}px, motion ${reducedMotion} (${liveBase?'actual public read-only':'mocked APIs'})`,async({page},testInfo)=>{
    await page.emulateMedia({reducedMotion});await page.setViewportSize({width,height:width===1440?900:844});const errors=[];let writes=0;
    // These read-only startup RPCs use HTTP POST in both the unchanged release
    // and the exact candidate. Still block them; reject every other non-read.
    const nonRead=request=>!(['GET','HEAD','OPTIONS'].includes(request.method())||(request.method()==='POST'&&new URL(request.url()).pathname==='/api/solana/rpc'&&['getMultipleAccounts','getSlot','getAccountInfo'].includes(request.postDataJSON()?.method)));
    page.on('pageerror',e=>errors.push(e.message));
    if(liveBase)await page.route('**/*',r=>{if(!['GET','HEAD','OPTIONS'].includes(r.request().method())){if(nonRead(r.request()))writes++;return r.abort()}return r.continue()});
    else{await page.route('https://**/*',r=>r.abort());await page.route('**/api/**',r=>{if(nonRead(r.request()))writes++;return r.fulfill({status:503,json:{error:'Offline campaign focus fixture'}})});await page.route('**/api/fee-policy',r=>r.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}));}
    await page.goto((liveBase||'')+'/#referrals');await page.locator('body.workspace-ready.product-experience-ready').waitFor();await page.evaluate(()=>document.fonts.ready);
    const summary=page.locator('summary').filter({hasText:'Campaign links and sharing tools'}),buttons=page.locator('[data-referral-campaign]');await expect(buttons).toHaveCount(3);await summary.click();
    const clear=async channel=>{
      const button=page.locator(`[data-referral-campaign="${channel}"]`);await expect(button).toBeFocused();
      let state;await expect.poll(async()=>{state=await button.evaluate(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e),h=document.querySelector('.topbar'),n=document.querySelector('.mobile-workspace-nav'),m=(parseFloat(s.outlineWidth)||0)+Math.max(0,parseFloat(s.outlineOffset)||0);const top=h?.getClientRects().length?Math.max(0,h.getBoundingClientRect().bottom):0,bottom=n?.getClientRects().length?n.getBoundingClientRect().top:innerHeight;return{visible:r.top-m>=top&&r.bottom+m<=bottom,focusVisible:e.matches(':focus-visible'),outline:s.outlineStyle,hits:[.1,.5,.9].flatMap(x=>[.1,.5,.9].map(y=>e.contains(document.elementFromPoint(r.x+r.width*x,r.y+r.height*y)))),channel:e.dataset.referralCampaign,type:e.type,text:e.textContent,scrollY}});return state.visible&&state.hits.every(Boolean)},{timeout:750}).toBe(true);
      expect(state).toMatchObject({visible:true,focusVisible:true,outline:'solid',channel,type:'button',text:'Copy'});
      // A second focus on an already clear control must not move its viewport.
      await page.waitForTimeout(500);const before=await page.evaluate(()=>scrollY);await button.evaluate(e=>{e.blur();e.focus({preventScroll:true})});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));expect(await page.evaluate(()=>scrollY)).toBe(before);
    };
    for(const channel of['social','community','creator']){await page.keyboard.press('Tab');await clear(channel);}
    for(const channel of['community','social']){await page.keyboard.press('Shift+Tab');await clear(channel);}
    await page.screenshot({path:testInfo.outputPath('campaign-native-focus.png')});
    await page.keyboard.press('Shift+Tab');await expect(summary).toBeFocused();
    // Let native scrolling to the outside summary finish before measuring the
    // pending-callback assertion; the campaign handler does not own that scroll.
    await expect.poll(async()=>{const before=await page.evaluate(()=>scrollY);await page.waitForTimeout(100);return await page.evaluate(()=>scrollY)===before},{timeout:750}).toBe(true);
    // A pending reveal must not affect a newer focus owner outside the actions.
    const outside=await page.evaluate(()=>{document.querySelector('[data-referral-campaign="social"]').focus({preventScroll:true});document.querySelector('.referral-toolkit').parentElement.querySelector('summary').focus({preventScroll:true});return scrollY});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await expect(summary).toBeFocused();expect(await page.evaluate(()=>scrollY)).toBe(outside);
    await expect(summary.locator('..')).toHaveAttribute('open','');await expect(page).toHaveURL(/#referrals$/);await expect(page.locator('#connect-button')).toContainText('Connect wallet');expect(writes).toBe(0);expect(errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  });
}
