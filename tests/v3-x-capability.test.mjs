import test from 'node:test';
import assert from 'node:assert/strict';
import { v3XCapability } from '../server/v3-x-capability.mjs';

test('X capability follows V3 configuration without claiming a payment proof', () => {
  const configured = {cluster:'devnet',launch:{ready:true,reasons:[]},enabled:true,
    oauthConfigured:true,lookupConfigured:true,lookupError:null};
  assert.deepEqual(v3XCapability(configured),{ready:true,scope:'per-mint-v3',
    paymentVerified:false,reasons:[]});
  const disabled = v3XCapability({...configured,enabled:false,lookupError:'Lookup unavailable'});
  assert.equal(disabled.ready,false);
  assert.match(disabled.reasons.join(' '),/V3 X claims are disabled/);
  assert.match(disabled.reasons.join(' '),/Lookup unavailable/);
  assert.equal(v3XCapability({...configured,launch:{ready:false,reasons:['Unapproved program']}}).ready,false);
});
