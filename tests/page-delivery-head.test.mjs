import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPageDelivery} from '../server/page-delivery.mjs';

test('HEAD preserves page and asset status/headers without a response body or accepting writes',async t=>{
 const root=await mkdtemp(join(tmpdir(),'richpad-head-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 await Promise.all(['index.html','admin.html','welcome.html','build-settings.json','app.css'].map(name=>writeFile(join(root,name),name.endsWith('.html')?'<html><head></head><body>Page</body></html>':name.endsWith('.json')?'{}':'body{color:white}')));
 const respond=(res,status,body)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body));};
 const delivery=createPageDelivery({staticRoot:root,solanaCluster:'devnet',store:{readLaunches:async()=>[]},respond});
 const server=createServer(async(req,res)=>{
  try{const url=new URL(req.url,'http://localhost');if(await delivery.handlePublicMetadata(req,res,url,false)||await delivery.handlePages(req,res,url))return;respond(res,404,{error:'Not found'});}
  catch{respond(res,500,{error:'Unexpected delivery error'});}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const base=`http://127.0.0.1:${server.address().port}`;
 for(const path of ['/','/explore','/rich','/admin','/welcome','/default.svg','/build-settings.json','/app.css','/missing.css','/api/private']){
  const get=await fetch(base+path),head=await fetch(base+path,{method:'HEAD'});
  assert.equal(head.status,get.status,path);
  for(const header of ['content-type','cache-control','x-content-type-options'])assert.equal(head.headers.get(header),get.headers.get(header),`${path} ${header}`);
  assert.equal(await head.text(),'');await get.arrayBuffer();
 }
 assert.equal((await fetch(base+'/',{method:'POST'})).status,404);
});
