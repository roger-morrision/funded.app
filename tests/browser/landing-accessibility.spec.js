import {test,expect} from '@playwright/test';

for(const[width,height]of[[360,740],[390,844],[1440,900]])for(const motion of['no-preference','reduce'])test(`native landing keyboard focus clears fixed navigation at ${width}px with ${motion} motion`,async({page,baseURL})=>{
  await page.setViewportSize({width,height});await page.emulateMedia({reducedMotion:motion});
  const api=[];await page.route('https://**/*',r=>r.request().method()==='GET'&&new URL(r.request().url()).origin===new URL(baseURL).origin?r.continue():r.abort());await page.route('**/api/**',r=>{api.push(r.request().url());return r.abort();});
  await page.goto('/welcome');await expect(page.locator('html')).toHaveAttribute('data-landing-navigation','enhanced');
  for(const key of['Tab','Shift+Tab']){
    let started=false,visited=0;
    for(let step=0;step<100;step++){
      await page.keyboard.press(key);
      const focus=await page.evaluate(()=>{const e=document.activeElement;if(!e||e===document.body)return null;
        const r=e.getBoundingClientRect(),c=getComputedStyle(e),outline=(parseFloat(c.outlineWidth)||0)+Math.max(0,parseFloat(c.outlineOffset)||0);
        const fixed=!!e.closest('.landing-topbar,.landing-sidebar')||e.matches('.skip-link'),nav=document.querySelector('.landing-mobile-nav');
        const top=fixed?0:document.querySelector('.landing-topbar').getBoundingClientRect().bottom,bottom=e.closest('.landing-mobile-nav')?innerHeight:nav.getClientRects().length?nav.getBoundingClientRect().top:innerHeight;
        return{skip:e.matches('.skip-link'),name:e.getAttribute('aria-label')||e.textContent.trim().slice(0,60),top:r.top,bottom:r.bottom,topLimit:top,bottomLimit:bottom,outline,clear:r.top-outline>=top-1&&r.bottom+outline<=bottom+1,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),focusVisible:e.matches(':focus-visible')};
      });
      if(!focus)continue;if(focus.skip&&started)break;started=true;visited++;
      expect(focus,JSON.stringify({key,...focus})).toMatchObject({clear:true,hit:true,focusVisible:true});
    }
    expect(visited).toBeGreaterThan(30);
  }
  expect(api.map(url=>new URL(url).pathname).filter(path=>!['/api/analytics/summary','/api/market/sol-usd'].includes(path))).toEqual([]);
});

for(const mode of['JavaScript disabled','script bundle blocked','dialog unavailable'])test(`mobile section navigation remains usable with ${mode}`,async({browser,baseURL})=>{
  const context=await browser.newContext({baseURL,javaScriptEnabled:mode!=='JavaScript disabled',viewport:{width:390,height:844}}),page=await context.newPage(),api=[],blocked=[];
  try{
    if(mode==='dialog unavailable')await page.addInitScript(()=>{HTMLDialogElement.prototype.showModal=undefined;});
    await page.route('**/*',r=>{const q=r.request(),u=new URL(q.url());if(u.pathname.startsWith('/api/')){api.push(u.pathname);return r.abort();}
      if(mode==='script bundle blocked'&&q.resourceType()==='script'){blocked.push(u.pathname);return r.abort();}
      return u.origin===new URL(baseURL).origin&&q.method()==='GET'?r.continue():r.abort();});
    await page.goto('/welcome');await expect(page.getByRole('link',{name:'Browse page sections'})).toBeVisible();await expect(page.getByRole('button',{name:'Open navigation'})).toBeHidden();
    await expect(page.locator('html')).not.toHaveAttribute('data-landing-navigation','enhanced');
    await page.getByRole('link',{name:'Browse page sections'}).click();await expect(page).toHaveURL(/#landing-page-index$/);
    const index=page.getByRole('navigation',{name:'On this page'});await expect(index).toBeVisible();await index.getByRole('link',{name:'Questions',exact:true}).click();
    await expect(page).toHaveURL(/#questions$/);const question=page.getByText('Which network does the app use?',{exact:true});await question.click();await expect(question.locator('..').locator('p')).toBeVisible();
    const rect=await page.locator('#questions-title').boundingBox(),header=await page.locator('.landing-topbar').boundingBox();expect(rect.y).toBeGreaterThanOrEqual(header.y+header.height);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(api.filter(path=>!['/api/analytics/summary','/api/market/sol-usd'].includes(path))).toEqual([]);
    if(mode==='script bundle blocked')expect(blocked.length).toBeGreaterThan(0);
  }finally{await context.close();}
});
