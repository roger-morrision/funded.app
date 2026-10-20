import {test,expect} from '@playwright/test';
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';
const liveBase=process.env.CALCULATOR_FEEDBACK_LIVE_BASE;
// Saved public revision 3 overrides the five-category build default. This
// fixture matches the independently recorded 16ddf2f live baseline; no publish.
const savedPolicy={...PROTOCOL_FEE_SPLIT,referralLevelPercents:[3,1.25,0.75],agencyPercent:10};
const ready='Preview ready.', unavailable='Enter an amount of 0 or more to preview the split.';
const amounts={100:['80 SOL','8 SOL','1 SOL','4 SOL','5 SOL','2 SOL'],0:Array(6).fill('0 SOL'),'0.25':['0.200 SOL','0.020 SOL','0.0025 SOL','0.010 SOL','0.0125 SOL','0.005 SOL']};

for(const width of [360,390,430,1440])test(`FQA-024 native calculator feedback at ${width}px (${liveBase?'public read-only':'mocked APIs'})`,async({page},info)=>{
  await page.setViewportSize({width,height:width===1440?900:844});const errors=[],blocked=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>{const q=r.request(),u=new URL(q.url());if(!['GET','HEAD','OPTIONS'].includes(q.method())){blocked.push({path:u.pathname,method:q.method(),rpc:u.pathname==='/api/solana/rpc'?q.postDataJSON()?.method:null});return r.abort()}if(!liveBase&&u.pathname.startsWith('/api/'))return u.pathname==='/api/fee-policy'?r.fulfill({json:{split:savedPolicy}}):r.fulfill({status:503,json:{error:'Offline calculator fixture'}});if(!liveBase&&u.origin!==new URL(page.url()==='about:blank'?'http://127.0.0.1:4173':page.url()).origin&&u.protocol==='https:')return r.abort();return r.continue()});
  await page.goto((liveBase||'')+'/#capital-flow');await page.locator('body.workspace-ready.product-experience-ready').waitFor();await page.evaluate(()=>document.fonts.ready);
  const input=page.locator('#fee-flow-input'),feedback=page.locator('#fee-flow-feedback'),outputs=page.locator('.fee-output-grid strong');
  await expect(input).toHaveAttribute('type','number');await expect(input).toHaveAttribute('min','0');await expect(input).toHaveAttribute('step','any');await expect(input).toHaveAttribute('inputmode','decimal');await expect(input).not.toHaveAttribute('required');await expect(input).toHaveValue('100');await expect(outputs).toHaveText(amounts[100]);
  await expect(feedback).toHaveAttribute('role','status');await expect(feedback).toHaveAttribute('aria-live','polite');await expect(feedback).toHaveAttribute('aria-atomic','true');await expect(page.locator('.fee-output-grid [aria-live], .fee-output-grid [role="status"]')).toHaveCount(0);
  await input.click();await page.evaluate(()=>{window.calculatorInput=document.querySelector('#fee-flow-input');window.feedbackChanges=[];new MutationObserver(()=>window.feedbackChanges.push(document.querySelector('#fee-flow-feedback').textContent)).observe(document.querySelector('#fee-flow-feedback'),{childList:true,subtree:true,characterData:true})});
  const states=[];
  const check=async(value,invalid,expected)=>{
    await expect(input).toHaveValue(value);await expect(input).toBeFocused();await expect(input).toHaveAttribute('aria-invalid',String(invalid));await expect(feedback).toHaveText(invalid?unavailable:ready);await expect(input).toHaveAccessibleDescription(`Example only. No funds move. ${invalid?unavailable:ready}`);await expect(outputs).toHaveText(expected);
    const state=await input.evaluate(e=>{const f=document.querySelector('#fee-flow-feedback'),r=e.getBoundingClientRect(),b=f.getBoundingClientRect(),h=document.querySelector('.topbar'),n=document.querySelector('.mobile-workspace-nav');const top=Math.max(0,h?.getBoundingClientRect().bottom||0),bottom=n?.getClientRects().length?n.getBoundingClientRect().top:innerHeight;return{value:e.value,valid:e.validity.valid,badInput:e.validity.badInput,rangeUnderflow:e.validity.rangeUnderflow,sameNode:e===window.calculatorInput,input:{top:r.top,bottom:r.bottom},feedback:{top:b.top,bottom:b.bottom},clear:r.top>=top&&b.bottom<=bottom,adjacent:b.top>=r.bottom&&b.top-r.bottom<45,hit:e===document.elementFromPoint(r.x+r.width/2,r.y+r.height/2),overflow:document.documentElement.scrollWidth>innerWidth,scrollY}});
    expect(state.sameNode).toBe(true);expect(state.clear).toBe(true);expect(state.adjacent).toBe(true);expect(state.hit).toBe(true);expect(state.overflow).toBe(false);states.push({...state,tree:await input.ariaSnapshot()});return state;
  };
  await check('100',false,amounts[100]);
  const edit=async value=>{await page.keyboard.press('Control+A');await page.keyboard.press('Backspace');if(value)await page.keyboard.type(value)};
  await edit('');expect((await check('',true,Array(6).fill('—'))).valid).toBe(true);await page.screenshot({path:info.outputPath('calculator-empty.png')});
  await page.keyboard.type('-1');expect((await check('-1',true,Array(6).fill('—'))).rangeUnderflow).toBe(true);
  await edit('0');expect((await check('0',false,amounts[0])).valid).toBe(true);
  // Type a decimal into the retained draft rather than replacing the control.
  await page.keyboard.type('.25');await check('0.25',false,amounts['0.25']);
  const mutations=await page.evaluate(()=>window.feedbackChanges);expect(mutations).toEqual([unavailable,ready]);
  await page.keyboard.press('ArrowLeft');await page.keyboard.press('Backspace');await expect(input).toHaveValue('0.5');await page.keyboard.type('2');await check('0.25',false,amounts['0.25']);expect(await page.evaluate(()=>window.feedbackChanges)).toEqual(mutations);
  // Chromium exposes an incomplete/non-finite numeric draft as badInput + ''.
  await edit('1e999');const nonfinite=await input.inputValue();expect(['','1e999']).toContain(nonfinite);await check(nonfinite,true,Array(6).fill('—'));
  await edit('0.25');await check('0.25',false,amounts['0.25']);await page.screenshot({path:info.outputPath('calculator-recovered.png')});
  await page.keyboard.press('Tab');await expect(input).not.toBeFocused();expect(await feedback.evaluate(e=>e.tabIndex)).toBe(-1);
  expect(blocked.filter(x=>!(x.path==='/api/solana/rpc'&&['getSlot','getMultipleAccounts','getAccountInfo'].includes(x.rpc))&&!(liveBase&&x.path==='/cdn-cgi/rum'))).toEqual([]);expect(errors).toEqual([]);
  await info.attach('native-feedback-evidence',{body:JSON.stringify({label:liveBase?'Actual public GET-only; every nonGET aborted':'Mocked canonical fee policy and unavailable API',states,mutations,blocked,errors},null,2),contentType:'application/json'});
});
