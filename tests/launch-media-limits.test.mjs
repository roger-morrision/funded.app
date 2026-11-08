import test from 'node:test';
import assert from 'node:assert/strict';
import { LAUNCH_MEDIA, MAX_PUBLISHED_IMAGE_BYTES, validateLaunchMedia } from '../launch-media-policy.js';
import { imageDimensions } from '../launch-image.js';
import { MAX_METADATA_IMAGE_BYTES } from '../server/devnet-metadata.mjs';
test('logo and banner source limits are distinct and inclusive',()=>{
  for(const [kind,policy] of Object.entries(LAUNCH_MEDIA)){
    assert.doesNotThrow(()=>validateLaunchMedia({type:'image/png',size:policy.maxSourceBytes},kind));
    assert.throws(()=>validateLaunchMedia({type:'image/png',size:policy.maxSourceBytes+1},kind),/up to/);
    assert.throws(()=>validateLaunchMedia({type:'image/svg+xml',size:100},kind),/PNG/);
  }
  assert.equal(LAUNCH_MEDIA.logo.maxSourceBytes,15_000_000);assert.equal(LAUNCH_MEDIA.banner.maxSourceBytes,5_000_000);
});
test('published images fit the server cap and use square logo / 3:1 banner dimensions',()=>{
  assert.equal(MAX_METADATA_IMAGE_BYTES,MAX_PUBLISHED_IMAGE_BYTES);
  assert.deepEqual(imageDimensions(1800,600),{width:1024,height:1024});
  assert.equal(LAUNCH_MEDIA.banner.width/LAUNCH_MEDIA.banner.height,3);
  assert.throws(()=>imageDimensions(6000,6000),/megapixels/);
});
