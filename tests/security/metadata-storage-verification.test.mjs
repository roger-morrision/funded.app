import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {publishMetadataProbe,recheckMetadataProbe} from '../../scripts/verify-metadata-storage.mjs';
import {verifyPublishedMetadata} from '../../server/metadata-publication.mjs';
import {publicMetadata} from '../../server/devnet-metadata.mjs';
import {pinnedMetadataUri} from '../../metadata-publication.js';

async function fixture(t){
  const base=await realpath(tmpdir()),dir=await mkdtemp(join(base,'funded-metadata-probe-'));
  t.after(async()=>{const actual=await realpath(dir);assert.equal(actual,resolve(dir));assert(actual.startsWith(base+sep));await rm(actual,{recursive:true,force:true});});
  const credentialFile=join(dir,'test-auth');await writeFile(credentialFile,'synthetic-token');
  const files=new Map(),calls={upload:0,read:0};let unavailable=false;
  const request=async(url,options)=>{
    assert.equal(options.redirect,'error');
    if(options.method==='POST'){
      assert.equal(url,'https://uploads.pinata.cloud/v3/files');assert.equal(options.headers.Authorization,'Bearer synthetic-token');
      const file=options.body.get('file'),cid='b'+('a'.repeat(40))+(calls.upload++?'c':'b');
      files.set(pinnedMetadataUri(cid),{bytes:Buffer.from(await file.arrayBuffer()),mime:file.type});
      return Response.json({data:{cid}});
    }
    calls.read++;assert.equal(options.credentials,'omit');assert.equal(options.headers,undefined);
    const found=files.get(String(url));if(!found||unavailable)return new Response('unavailable',{status:403});
    return new Response(found.bytes,{headers:{'content-type':found.mime}});
  };
  return {dir,credentialFile,output:join(dir,'run'),files,calls,request,setUnavailable:value=>{unavailable=value;}};
}

test('metadata probe rechecks identical public bytes without credentials or repeat uploads',async t=>{
  const f=await fixture(t),result=await publishMetadataProbe({...f,fetchImpl:f.request});
  assert.equal(result.publication.verified,true);assert.equal(f.calls.upload,2);
  const record=join(f.output,'record.json');
  await rm(f.credentialFile);
  assert.equal((await recheckMetadataProbe({file:record,fetchImpl:f.request})).publication.uri,result.publication.uri);
  assert.equal(f.calls.upload,2);
  await assert.rejects(publishMetadataProbe({...f,fetchImpl:f.request}));assert.equal(f.calls.upload,2);
});

test('metadata probe saves public CIDs before gateway failure and resumes verification without upload',async t=>{
  const f=await fixture(t);f.setUnavailable(true);
  await assert.rejects(publishMetadataProbe({...f,fetchImpl:f.request}));
  const file=join(f.output,'record.json'),saved=JSON.parse(await readFile(file,'utf8'));assert(saved.pinnedMetadata.uri);
  f.setUnavailable(false);assert.equal((await recheckMetadataProbe({file,fetchImpl:f.request})).publication.verified,true);
  assert.equal(f.calls.upload,2);
});

test('metadata verification rejects changed JSON, images, banners and missing pinned checksums',async t=>{
  const f=await fixture(t);await publishMetadataProbe({...f,fetchImpl:f.request});
  const record=JSON.parse(await readFile(join(f.output,'record.json'),'utf8'));
  const original=structuredClone(record),json=f.files.get(record.pinnedMetadata.uri),image=f.files.get(record.pinnedMetadata.image);
  for(const mutate of [()=>{json.bytes=Buffer.from('{}');},()=>{image.bytes=Buffer.from('wrong image');},
    ()=>{delete record.pinnedMetadata.fallbackImageSha256;},()=>{image.mime='text/plain';}]){
    const jsonBytes=json.bytes,imageBytes=image.bytes,mime=image.mime;mutate();
    await assert.rejects(verifyPublishedMetadata(record,{fetchImpl:f.request}));
    json.bytes=jsonBytes;image.bytes=imageBytes;image.mime=mime;record.pinnedMetadata={...original.pinnedMetadata};
  }
  record.bannerSha256=createHash('sha256').update('expected banner').digest('hex');
  record.pinnedMetadata.banner=pinnedMetadataUri('b'+'d'.repeat(41));
  json.bytes=Buffer.from(JSON.stringify(publicMetadata(record)));f.files.set(record.pinnedMetadata.banner,{mime:'image/png',bytes:Buffer.from('different banner')});
  await assert.rejects(verifyPublishedMetadata(record,{fetchImpl:f.request}));
  record.cluster='mainnet-beta';record.pinnedMetadata.uri='https://example.invalid/mutable.json';
  await assert.rejects(verifyPublishedMetadata(record,{fetchImpl:f.request}),/content-addressed/);
});
