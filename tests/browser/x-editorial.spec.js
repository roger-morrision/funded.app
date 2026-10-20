import {test,expect} from '@playwright/test';

test('admin reviews exact content without publishing or enabling a suspended account',async({page})=>{
  // Isolate the actual component; signed admin access is separately tested at
  // the server route. This browser test uses a mocked API, not a wallet or X.
  await page.route('**/editorial-fixture.html',route=>route.fulfill({contentType:'text/html',body:'<main><div id="message" role="status"></div><div id="workspace"></div></main>'}));
  await page.goto('/editorial-fixture.html');
  await page.evaluate(async()=>{
    window.reviewCalls=[];
    const {initAdminXPosts}=await import('/admin-x-posts.js');
    initAdminXPosts({api:async()=>({safety:{paused:true,reason:'account-suspended'},events:[{event:{id:'agency:a',kind:'agency_promotion',text:'A factual update <img src=x onerror=alert(1)>',proofs:{sourceHash:'b'.repeat(64)}},hash:'a'.repeat(64),review:null}]}),
      post:async(path,input)=>{window.reviewCalls.push({path,input});return{published:false};},
      show:text=>{document.getElementById('message').textContent=text;}});
  });
  await expect(page.getByRole('heading',{name:'X publishing review'})).toBeVisible();
  await expect(page.locator('[data-x-status]')).toContainText('Paused');
  await expect(page.locator('[data-x-events] img')).toHaveCount(0);
  await expect(page.getByText('A factual update <img src=x onerror=alert(1)>',{exact:true})).toBeVisible();
  await page.getByText('Source evidence and exact content hash',{exact:true}).click();
  await expect(page.locator('pre')).toContainText('a'.repeat(64));
  await page.getByLabel('Review reason').fill('Reviewed factual content and source evidence.');
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Approve exact text'}).click();
  await expect(page.locator('#message')).toHaveText('Review saved. No post was sent.');
  expect(await page.evaluate(()=>window.reviewCalls)).toEqual([{path:'/api/admin/x-posts/review',input:{id:'agency:a',expectedHash:'a'.repeat(64),decision:'approved',reason:'Reviewed factual content and source evidence.'}}]);
  await page.getByRole('button',{name:'Keep publishing paused'}).click();
  await expect(page.locator('#message')).toHaveText('Publishing pause saved.');
  expect(await page.evaluate(()=>window.reviewCalls.map(row=>row.path))).toEqual(['/api/admin/x-posts/review','/api/admin/x-posts/pause']);
  await expect(page.getByRole('button',{name:/resume|publish now/i})).toHaveCount(0);
});

test('review queue loads later pages, shows expired approvals and resets on refresh',async({page})=>{
  await page.route('**/editorial-pages.html',route=>route.fulfill({contentType:'text/html',body:'<main><div id="workspace"></div></main>'}));
  await page.goto('/editorial-pages.html');
  await page.evaluate(async()=>{
    window.pageCalls=[];
    const {initAdminXPosts}=await import('/admin-x-posts.js');
    initAdminXPosts({api:async path=>{
      window.pageCalls.push(path);const second=path.includes('?after=');
      return{safety:{paused:true,reason:'account-suspended'},nextCursor:second||window.pageCalls.length>2?null:'cursor/page+two',events:[{
        event:{id:second?'two':'one',kind:'agency_promotion',text:second?'Second reviewed project':'First reviewed project'},hash:'a'.repeat(64),
        review:second?{decision:'approved',expiresAt:'2000-01-01T00:00:00Z'}:{decision:'rejected',expiresAt:'2999-01-01T00:00:00Z'},
      }]};
    },post:async()=>{throw new Error('No publishing or review action is expected.');},show:()=>{}});
  });
  await expect(page.getByText('First reviewed project',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Load more posts'}).click();
  await expect(page.getByText('Second reviewed project',{exact:true})).toBeVisible();
  await expect(page.getByText(/^Approval expired/)).toBeVisible();
  await expect(page.getByRole('button',{name:'Load more posts'})).toBeHidden();
  expect(await page.evaluate(()=>window.pageCalls)).toEqual(['/api/admin/x-posts','/api/admin/x-posts?after=cursor%2Fpage%2Btwo']);
  await page.getByRole('button',{name:'Refresh review queue'}).click();
  await expect(page.getByText('Second reviewed project',{exact:true})).toHaveCount(0);
  await expect(page.getByText('First reviewed project',{exact:true})).toBeVisible();
});
