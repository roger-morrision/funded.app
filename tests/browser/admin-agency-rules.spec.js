import {Keypair,PublicKey,Transaction} from '@solana/web3.js';
import {buildAgencyRulesV3Instruction} from '../../agency-mint-router-v3.js';
import {test,expect} from '@playwright/test';
import {DEFAULT_AGENCY_RULES} from '../../config/agency-rules.js';
import bs58 from 'bs58';
test('admin reviews future-launch terms, invalidates edits and requires the authority wallet (mocked API)',async({page})=>{
  await page.route('**/api/**',route=>route.fulfill({status:401,json:{error:'Offline QA fixture'}}));
  await page.goto('/admin.html');
  await page.evaluate(() => import('/admin-bootstrap.js'));
  const key=n=>Keypair.fromSeed(Buffer.alloc(32,n)).publicKey,authority=key(71),programId=key(72),recipient=key(73),blockhash=String(key(74));
  const prepared={authority:String(authority),configRevision:'7',promotionRecipient:String(recipient),blockhash,lastValidBlockHeight:500,
    transaction:new Transaction({feePayer:authority,recentBlockhash:blockhash}).add(buildAgencyRulesV3Instruction({programId,authority,
      promotionRecipient:recipient,protocolUnits:[700000,60000,25000,15000,400000,500000,300000],expectedRevision:'7',
      rules:{marketCapUsd:[10,20],communityWindowSeconds:300,promotionIntervalSeconds:86400}}).instruction).serialize({requireAllSignatures:false}).toString('base64')};
  await page.evaluate(async ({rules,prepared,programId})=>{
    document.body.innerHTML='<section><form id="agency-policy-form"></form></section><p id="qa-message"></p>';
    const {initAdminAgencyRules}=await import('/admin-agency-rules.js');
    const settings={verified:true,authority:prepared.authority,programId,revision:'7',promotionRecipient:prepared.promotionRecipient,rules,
      protocolSplit:{operationsPercent:40,referralLevelPercents:[3,1.25,.75],communityPercent:20,buybackPercent:25,agencyPercent:10}};
    window.qaRequests=[];
    initAdminAgencyRules({api:async()=>settings,post:async(path,input)=>{
      window.qaRequests.push({path,input});return prepared;
    },show:message=>{document.querySelector('#qa-message').textContent=message;},refresh:async()=>{}});
  },{rules:DEFAULT_AGENCY_RULES,prepared,programId:String(programId)});
  await page.getByRole('button',{name:'Load verified settings'}).click();
  await expect(page.getByLabel('Referral L1 %')).toHaveValue('0.6');
  await page.getByLabel('Agency %',{exact:true}).fill('3');
  await page.getByLabel('Operations & marketing %').fill('7');
  await page.getByLabel('Agent 2 market cap (USD)').fill('10');
  await page.getByLabel('Agent 3 market cap (USD)').fill('20');
  await page.getByLabel('Community claim window (seconds)').fill('300');
  await page.getByLabel('Audit reason').fill('Review disposable QA launch settings');
  await page.getByRole('button',{name:'Prepare configuration for review'}).click();
  await expect(page.locator('[data-rules-review]')).toContainText('agency 3%');
  await expect(page.locator('[data-rules-review]')).toContainText('claim window 300 seconds');
  const sign=page.getByRole('button',{name:'Sign, finalize and publish reviewed settings'});
  await sign.click();await expect(page.locator('#qa-message')).toContainText('router authority wallet');
  expect(await page.evaluate(()=>window.qaRequests[0].input.split.agencyPercent)).toBe(15);
  await page.getByLabel('Agency %',{exact:true}).fill('2');await expect(sign).toBeHidden();
  await expect(page.getByText('X publishing stays paused.',{exact:false})).toBeVisible();
});

test('configuration keeps the known receipt after a lost acknowledgement and signs only once (mocked RPC)',async({page})=>{
  let sends=0,signature;
  await page.route('**/api/**',async route=>{
    const input=route.request().postDataJSON();
    if(input?.method==='sendTransaction'){
      sends++;signature=bs58.encode(Transaction.from(Buffer.from(input.params[0],'base64')).signature);
      await route.abort('failed');return;
    }
    const result=input?.method==='getGenesisHash'?'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG':{context:{slot:1},value:true};
    await route.fulfill({json:{jsonrpc:'2.0',id:input?.id,result}});
  });
  // Keep this component fixture separate from authenticated page bootstrapping.
  await page.goto('/welcome.html');
  const authority=await page.evaluate(async()=>{const module=await import('/tests/browser/admin-ephemeral-wallet.js');return module.installEphemeralAdminWallet();});
  const key=n=>Keypair.fromSeed(Buffer.alloc(32,n)).publicKey,programId=key(72),recipient=key(73),blockhash=String(key(74));
  const prepared={authority,configRevision:'7',promotionRecipient:String(recipient),blockhash,lastValidBlockHeight:500,
    transaction:new Transaction({feePayer:new PublicKey(authority),recentBlockhash:blockhash}).add(buildAgencyRulesV3Instruction({programId,authority,
      promotionRecipient:recipient,protocolUnits:[800000,60000,25000,15000,400000,500000,200000],expectedRevision:'7',rules:DEFAULT_AGENCY_RULES}).instruction).serialize({requireAllSignatures:false}).toString('base64')};
  await page.evaluate(async({prepared,rules,programId})=>{
    document.body.innerHTML='<section><form id="agency-policy-form"><input name="signature"><input name="configRevision"></form></section><p id="qa-message"></p>';
    const {initAdminAgencyRules}=await import('/admin-agency-rules.js');
    initAdminAgencyRules({api:async()=>({verified:true,authority:prepared.authority,programId,revision:'7',promotionRecipient:prepared.promotionRecipient,rules,
      protocolSplit:{operationsPercent:40,referralLevelPercents:[3,1.25,.75],communityPercent:20,buybackPercent:25,agencyPercent:10}}),
      post:async()=>prepared,show:value=>{document.querySelector('#qa-message').textContent=value;},refresh:async()=>{}});
  },{prepared,rules:DEFAULT_AGENCY_RULES,programId:String(programId)});
  await page.getByRole('button',{name:'Load verified settings'}).click();await page.getByLabel('Audit reason').fill('Disposable browser configuration test');
  await page.getByRole('button',{name:'Prepare configuration for review'}).click();
  await expect(page.locator('[data-rules-sign]')).toBeVisible();
  await page.locator('[data-rules-sign]').evaluate(button=>{button.click();button.click();});
  await expect.poll(()=>sends).toBe(1);await expect(page.locator('#agency-policy-form [name=signature]')).toHaveValue(signature);
  await expect(page.locator('#agency-policy-form [name=configRevision]')).toHaveValue('8');
  expect(await page.evaluate(()=>window.qaWalletSigns)).toBe(1);await expect(page.locator('[data-rules-sign]')).toBeHidden();
});
