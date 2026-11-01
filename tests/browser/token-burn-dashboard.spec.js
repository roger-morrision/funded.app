import{test,expect}from'@playwright/test';
import{PublicKey}from'@solana/web3.js';
import{PUMP_SDK,bondingCurvePda}from'@pump-fun/pump-sdk';
import BN from'bn.js';
const mint='H8AKZYEfaTyFsdppSvDZtkfkRzb5TFuPf3q9GY9xY81z',second='9Dp8MYwvFTAwoMtxaXvAZjZyjsWUbuXGp15z8EkZzu1B',tokenProgram='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const split={operationsPercent:40,referralLevelPercents:[3,1.25,.75],communityPercent:20,buybackPercent:25,agencyPercent:10};
async function fixture(page,baseURL){
  let current='750000000000000',authority=null,curveAvailable=true,unavailable=false,held=false;const releases=[],writes=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>sessionStorage.setItem('funded.app.wallet.manual-disconnect','1'));
  const curve=await PUMP_SDK.offlinePumpProgram.coder.accounts.encode('bondingCurve',{virtualTokenReserves:new BN('1000000000000'),virtualQuoteReserves:new BN('30000000000'),realTokenReserves:new BN('700000000000'),realQuoteReserves:new BN('1000000000'),tokenTotalSupply:new BN('1000000000000000'),complete:false,creator:new PublicKey(mint),isMayhemMode:false,isCashbackCoin:false,quoteMint:PublicKey.default,creatorFeeBps:new BN(0),canEditCreatorFee:false,isHolderReward:false});
  const curveAddress=bondingCurvePda(new PublicKey(mint)).toBase58();
  await page.route('**/*',r=>{const q=r.request(),u=new URL(q.url());return u.origin===new URL(baseURL).origin&&(q.method()==='GET'||u.pathname.startsWith('/api/'))?r.fallback():r.abort();});
  await page.route('**/api/**',async r=>{
    const q=r.request(),path=new URL(q.url()).pathname;
    if(path==='/api/fee-policy')return r.fulfill({json:{revision:6,split}});
    if(path==='/api/solana/rpc'){
      const body=q.postDataJSON(),calls=Array.isArray(body)?body:[body],captured={current,authority,curveAvailable,unavailable};
      if(held&&calls.some(c=>c.method==='getAccountInfo'&&c.params?.[0]===mint))await new Promise(resolve=>releases.push(resolve));
      if(captured.unavailable)return r.fulfill({status:503,json:{error:'Unavailable mint fixture'}});
      const rows=calls.map(c=>{if(!/^(get|isBlockhashValid$)/.test(c.method))writes.push(c.method);let result=null;
        if(c.method==='getSlot')result=100;
        else if(c.method==='getAccountInfo'){const a=c.params?.[0];let value=null;
          if(a===mint||a===second)value={lamports:1000000,executable:false,owner:tokenProgram,rentEpoch:0,data:{program:'spl-token',parsed:{type:'mint',info:{decimals:6,supply:a===second?'123000000':captured.current,isInitialized:true,mintAuthority:captured.authority,freezeAuthority:null}},space:82}};
          if(a===curveAddress&&captured.curveAvailable)value={lamports:1000000,executable:false,owner:PUMP_SDK.offlinePumpProgram.programId.toBase58(),rentEpoch:0,data:[curve.toString('base64'),'base64']};result={context:{slot:100},value};
        }else if(c.method==='getTokenLargestAccounts'||c.method==='getTokenAccountsByOwner')result={context:{slot:100},value:[]};else if(c.method==='getMultipleAccounts')result={context:{slot:100},value:c.params[0].map(()=>null)};else if(c.method==='getProgramAccounts')result=[];
        return{jsonrpc:'2.0',id:c.id,result};});return r.fulfill({json:Array.isArray(body)?rows:rows[0]});
    }
    if(q.method()!=='GET')writes.push(path);return r.fulfill({status:400,json:{error:'Unavailable read-only fixture'}});
  });
  return{writes,errors,set:x=>{if(x.current!==undefined)current=x.current;if(x.authority!==undefined)authority=x.authority;if(x.curveAvailable!==undefined)curveAvailable=x.curveAvailable;if(x.unavailable!==undefined)unavailable=x.unavailable;},hold:()=>{held=true;},waiting:()=>releases.length,release:()=>{held=false;for(const r of releases.splice(0))r();}};
}
for(const width of[320,390,1440])test(`token burn dashboard reports exact totals, unknowns and route changes at ${width}px (mocked RPC)`,async({page,baseURL},info)=>{
  test.setTimeout(90000);await page.setViewportSize({width,height:900});const f=await fixture(page,baseURL);await page.goto(`/#coin/${mint}`);await page.locator('body.product-experience-ready.workspace-ready').waitFor();
  const root=page.locator('#coin-burn-dashboard'),tokens=root.locator('[data-burn-tokens]'),percent=root.locator('[data-burn-percent]'),details=root.locator('details'),summary=details.locator('summary');
  await expect(root).toHaveAttribute('data-state','ready');await expect(tokens).toHaveText('250,000,000');await expect(percent).toHaveText('25%');await expect(root.locator('[data-burn-explorer]')).toHaveAttribute('href',`https://explorer.solana.com/address/${mint}?cluster=devnet`);
  await root.scrollIntoViewIfNeeded();await root.screenshot({path:info.outputPath(`burn-summary-${width}.png`)});await summary.focus();await page.keyboard.press('Enter');await expect(details).toHaveAttribute('open','');await expect(root.locator('[data-burn-initial]')).toHaveText('1,000,000,000 tokens');await expect(root.locator('[data-burn-current]')).toHaveText('750,000,000 tokens');expect((await summary.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press('Space');await expect(details).not.toHaveAttribute('open','');await expect(summary).toBeFocused();
  const refresh=async patch=>{f.set(patch);await page.locator('#coin-refresh').click();};
  for(const[current,amount,share]of[['1000000000000000','0','0%'],['999999999999999','0.000001','<0.000001%'],['0','1,000,000,000','100%']]){await refresh({current});await expect(root).toHaveAttribute('data-state','ready');await expect(tokens).toHaveText(amount);await expect(percent).toHaveText(share);}
  await refresh({current:'750000000000000',authority:mint});await expect(root).toHaveAttribute('data-state','unavailable');await expect(tokens).toHaveText('—');await expect(root).toContainText('minting permanently disabled');
  await refresh({authority:null,curveAvailable:false});await expect(root).toHaveAttribute('data-state','unavailable');await expect(root).toContainText('Original supply unavailable');await expect(percent).toHaveText('—');
  await refresh({curveAvailable:true,current:'750000000000000'});await expect(root).toHaveAttribute('data-state','ready');f.hold();await page.locator('#coin-refresh').click();await expect(root).toHaveAttribute('data-state','loading');await expect(tokens).toHaveText('—');await expect.poll(f.waiting).toBeGreaterThan(0);
  await page.evaluate(m=>location.hash=`coin/${m}`,second);await expect(root).toHaveAttribute('data-mint',second);await expect(root).toHaveAttribute('data-state','unavailable');
  const oldResponse=page.waitForResponse(r=>{try{const b=r.request().postDataJSON(),calls=Array.isArray(b)?b:[b];return calls.some(c=>c?.method==='getAccountInfo'&&c.params?.[0]===mint);}catch{return false;}});f.release();await(await oldResponse).finished();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  await expect(root).toHaveAttribute('data-state','unavailable');await expect(tokens).toHaveText('—');await expect(root.locator('[data-burn-explorer]')).toHaveAttribute('href',`https://explorer.solana.com/address/${second}?cluster=devnet`);
  if(width===390){await refresh({unavailable:true});await expect(root).toHaveAttribute('data-state','unavailable',{timeout:20000});await expect(root).toContainText('could not be checked');await expect(tokens).toHaveText('—');await expect(percent).toHaveText('—');}
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});
