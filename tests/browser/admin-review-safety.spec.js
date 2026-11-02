import {test,expect} from '@playwright/test';
import {adminFixture,deferred} from './admin-review-fixture.js';
import {DEFAULT_AGENCY_RULES} from '../../config/agency-rules.js';

const browserErrors=new WeakMap();
test.beforeEach(({page})=>{const errors=[];browserErrors.set(page,errors);page.on('pageerror',error=>errors.push(error.message));});
test.afterEach(({page})=>{expect(browserErrors.get(page)).toEqual([]);});

const id='a'.repeat(32),updatedAt='2026-11-01T00:00:00.000Z';
const report={id,category:'bug',description:'Private QA issue description',context:{route:'/launch'},status:'received',note:'',createdAt:updatedAt,updatedAt};
const issuePanel=page=>page.locator('section').filter({has:page.getByRole('heading',{name:'Product issue review',exact:true})});

for(const width of [390,1440])test(`issue review clears private rows across admin sessions at ${width}px (mocked API)`,async({page})=>{
  await adminFixture(page,async({path,send})=>{if(path!=='/api/admin/product-issues')return false;await send(200,{reports:[report]});return true;});
  await page.setViewportSize({width,height:900});await page.goto('/admin.html');
  await page.getByRole('button',{name:'Load reported issues'}).click();
  await expect(issuePanel(page)).toContainText(report.description);
  await page.locator('#sign-out').click();
  await expect(issuePanel(page).locator('article')).toHaveCount(0);
  await page.locator('#sign-in').click();await expect(page.locator('#workspace')).toBeVisible();
  await expect(issuePanel(page)).not.toContainText(report.description);
});

test('issue save freezes its reviewed fields and refresh until the result is known (mocked API)',async({page})=>{
  const gate=deferred();let writes=0,input;
  await adminFixture(page,async({path,send,route})=>{
    if(path==='/api/admin/product-issues'){await send(200,{reports:[report]});return true;}
    if(path!==`/api/admin/product-issues/${id}`)return false;
    writes++;input=route.request().postDataJSON();await gate.promise;await send(200,{...report,...input,updatedAt:'2026-11-01T00:00:01.000Z'});return true;
  });
  await page.goto('/admin.html');await page.getByRole('button',{name:'Load reported issues'}).click();
  const panel=issuePanel(page),status=page.getByLabel(`Report status ${id}`),note=page.getByLabel(`Public reviewer note ${id}`);
  await status.selectOption('investigating');await note.fill('Reproduced with a labeled QA account');
  try{
    await panel.getByRole('button',{name:'Save reviewed status'}).click();await expect.poll(()=>writes).toBe(1);
    await expect(status).toBeDisabled();await expect(note).toBeDisabled();await expect(panel.getByRole('button',{name:'Load reported issues'})).toBeDisabled();
    expect(input.expectedUpdatedAt).toBe(updatedAt);
  }finally{gate.resolve();}
  await expect(status).toBeEnabled();await expect(page.locator('#message')).toContainText('Report status saved');
});

test('conflicting issue save requires a fresh review instead of overwriting another admin (mocked API)',async({page})=>{
  await adminFixture(page,async({path,send})=>{
    if(path==='/api/admin/product-issues'){await send(200,{reports:[report]});return true;}
    if(path!==`/api/admin/product-issues/${id}`)return false;
    await send(409,{error:'This report changed. Reload reported issues and review it again.'});return true;
  });
  await page.goto('/admin.html');await page.getByRole('button',{name:'Load reported issues'}).click();
  const save=issuePanel(page).locator('article button');await save.click();
  await expect(page.locator('#message')).toContainText('report changed');await expect(save).toBeDisabled();
  await expect(issuePanel(page).getByRole('button',{name:'Load reported issues'})).toBeEnabled();
});

test('verified policy publication blocks duplicate submits and freezes the captured input (mocked API)',async({page})=>{
  const gate=deferred();let hold=false,reads=0,writes=0,input;
  await adminFixture(page,async({path,send,route})=>{
    if(path==='/api/fee-policy'&&hold){reads++;await gate.promise;await send(200,{revision:1});return true;}
    if(path!=='/api/admin/agency-fee-policy')return false;
    writes++;input=route.request().postDataJSON();await send(200,{revision:2,split:{referralLevelPercents:[3,1.25,.75]},configRevision:'1',configSlot:123});return true;
  });
  await page.goto('/admin.html');await expect(page.locator('#policy-revision')).toContainText('Revision 1');
  const form=page.locator('#agency-policy-form');await form.locator('[name=signature]').fill('1'.repeat(64));await form.locator('[name=configRevision]').fill('1');await form.locator('[name=reason]').fill('Reviewed labeled QA configuration proof');
  hold=true;
  try{
    await form.locator('[type=submit]').evaluate(button=>{button.click();button.click();});await expect.poll(()=>reads).toBeGreaterThan(0);
    await expect(form.locator('[type=submit]')).toBeDisabled();await expect(form.locator('[name=signature]')).toBeDisabled();expect(reads).toBe(1);
  }finally{hold=false;gate.resolve();}
  await expect.poll(()=>writes).toBe(1);expect(input.signature).toBe('1'.repeat(64));
  await expect(form.locator('[type=submit]')).toBeEnabled();
});

test('a changed daily bonus review cannot be overwritten by a pending reconciliation (mocked API)',async({page})=>{
  const gate=deferred();let applies=0;
  await adminFixture(page,async({path,send})=>{
    if(path==='/api/admin/daily-bonus/review'){await send(200,{day:'2026-10-17',expectedHash:'a'.repeat(64),expectedNewHash:'b'.repeat(64),mode:'replace-unused-v1'});return true;}
    if(path!=='/api/admin/daily-bonus/reconcile')return false;
    applies++;await gate.promise;await send(200,{oldDayReconciled:true});return true;
  });
  await page.goto('/admin.html');await expect(page.locator('#bonus-recovery-day')).not.toHaveValue('');
  await page.locator('#bonus-recovery-day').fill('2026-10-17');await page.locator('#bonus-recovery-hash').fill('a'.repeat(64));await page.locator('#bonus-recovery-review').click();
  await expect(page.locator('#bonus-recovery-apply')).toBeEnabled();await page.locator('#bonus-recovery-reason').fill('Reviewed missing finalized funding for this QA day');
  try{
    await page.locator('#bonus-recovery-apply').click();await expect.poll(()=>applies).toBe(1);
    await page.locator('#bonus-recovery-day').fill('2026-10-16');
  }finally{gate.resolve();}
  await expect(page.locator('#bonus-recovery-apply')).toBeDisabled();
  await expect(page.locator('#bonus-recovery-preview')).toHaveText('');
});

test('service fees recover in a new session while an old save is still pending (mocked API)',async({page})=>{
  const gate=deferred();let writes=0;
  await adminFixture(page,async({path,method,send})=>{
    if(path!=='/api/admin/service-fees'||method!=='POST')return false;
    writes++;await gate.promise;await send(503,{error:'Old session acknowledgement lost'});return true;
  });
  await page.goto('/admin.html');const form=page.locator('#service-fee-form');
  await expect(form.locator('[type=submit]')).toBeEnabled();await form.locator('[name=reason]').fill('Labeled QA pricing review for the first session');
  page.once('dialog',dialog=>dialog.accept());
  try{
    await form.locator('[type=submit]').click();await expect.poll(()=>writes).toBe(1);await page.locator('#sign-out').click();await page.locator('#sign-in').click();
    await expect(page.locator('#workspace')).toBeVisible();await expect(form.locator('[type=submit]')).toBeEnabled();await expect(form.locator('[name=reason]')).toHaveValue('');
  }finally{gate.resolve();}
  await expect(form.locator('[type=submit]')).toBeEnabled();await expect(page.locator('#message')).not.toContainText('Old session');
});

test('a failed audit refresh replaces stale history with an explicit retry state (mocked API)',async({page})=>{
  let unavailable=false;
  await adminFixture(page,async({path,send})=>{
    if(path!=='/api/admin/audit')return false;
    await send(unavailable?503:200,unavailable?{error:'Audit database unavailable'}:{entries:[{action:'Old reviewed action',at:'2026-11-01T00:00:00Z',wallet:'Labeled fixture'}]});return true;
  });
  await page.goto('/admin.html');await expect(page.locator('#audit')).toContainText('Old reviewed action');unavailable=true;
  await page.locator('#refresh-audit').click();await expect(page.locator('#message')).toContainText('Audit database unavailable');
  await expect(page.locator('#audit')).toContainText('unavailable');await expect(page.locator('#audit')).not.toContainText('Old reviewed action');
});

test('verified authority rules and audit reasons clear on sign-out (mocked API)',async({page})=>{
  await adminFixture(page,async({path,send})=>{
    if(path!=='/api/admin/agency-rules')return false;
    await send(200,{verified:true,revision:'7',authority:'Labeled QA authority',promotionRecipient:'Labeled QA recipient',rules:DEFAULT_AGENCY_RULES,
      protocolSplit:{operationsPercent:40,referralLevelPercents:[3,1.25,.75],communityPercent:20,buybackPercent:25,agencyPercent:10}});return true;
  });
  await page.goto('/admin.html');await page.getByRole('button',{name:'Load verified settings'}).click();
  const form=page.locator('[data-rules-form]');await expect(form.locator('[name=reason]')).toBeEnabled();await form.locator('[name=reason]').fill('Private first-session QA audit reason');
  await page.locator('#sign-out').click();await page.locator('#sign-in').click();await expect(page.locator('#workspace')).toBeVisible();
  await expect(form.locator('[name=reason]')).toBeDisabled();await expect(form.locator('[name=reason]')).toHaveValue('');await expect(page.locator('[data-rules-review]')).toContainText('Load settings');
});

test('a pending legacy fee save cannot block a fresh admin session (mocked API)',async({page})=>{
  const gate=deferred();let writes=0;
  await adminFixture(page,async({path,method,send})=>{
    if(path!=='/api/admin/fee-policy'||method!=='POST')return false;
    writes++;await gate.promise;await send(503,{error:'Old fee policy response'});return true;
  });
  await page.goto('/admin.html');await expect(page.locator('#policy-revision')).toContainText('Revision 1');page.once('dialog',dialog=>dialog.accept());
  try{
    await page.locator('#fee-form [type=submit]').click();await expect.poll(()=>writes).toBe(1);await page.locator('#sign-out').click();await page.locator('#sign-in').click();
    await expect(page.locator('#wallet-rows')).not.toBeEmpty();await expect(page.locator('#fee-form [type=submit]')).toBeEnabled();
  }finally{gate.resolve();}
  await expect(page.locator('#message')).not.toContainText('Old fee policy response');
});
