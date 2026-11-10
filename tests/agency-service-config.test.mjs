import test from 'node:test';
import assert from 'node:assert/strict';
import {wireAgencyPriceSigner} from '../scripts/agency-service-config.mjs';
const fixture=()=>({services:{app:{environment:{SOLANA_CLUSTER:'devnet',FUNDED_DEVNET_BUYBACK_PRICE_SIGNER:'public-key',FUNDED_DEVNET_BUYBACK_PRICE_SIGNER_URL:'https://richpad.fun/price-signer/sign',FUNDED_DEVNET_BUYBACK_PRICE_SIGNER_TOKEN_FILE:'/run/secrets/price_token',X_SECRET:'must-not-copy'},secrets:[{source:'price_token',target:'price_token'},{source:'wallet',target:'wallet'}]},'agency-buyback-worker':{environment:{SOLANA_CLUSTER:'devnet',FUNDED_V3_AGENCY_BUYBACK_ENABLED:'true'},secrets:[]}},secrets:{price_token:{file:'/existing/token'},wallet:{file:'/existing/wallet'}}});
test('agency signer wiring copies only the configured connection and exact existing token mount',()=>{
 const c=fixture();wireAgencyPriceSigner(c);wireAgencyPriceSigner(c);const w=c.services['agency-buyback-worker'];
 assert.equal(w.environment.FUNDED_DEVNET_BUYBACK_PRICE_SIGNER_URL,'https://richpad.fun/price-signer/sign');
 assert.equal(w.environment.X_SECRET,undefined);assert.deepEqual(w.secrets,[{source:'price_token',target:'price_token'}]);
});
test('enabled workers fail closed for missing signer, wrong cluster, insecure endpoint or unmounted token',()=>{
 for(const mutate of [c=>delete c.services.app.environment.FUNDED_DEVNET_BUYBACK_PRICE_SIGNER,c=>c.services.app.environment.SOLANA_CLUSTER='mainnet-beta',c=>c.services.app.environment.FUNDED_DEVNET_BUYBACK_PRICE_SIGNER_URL='http://unsafe.test/sign',c=>c.services.app.secrets=[]]){
  const c=fixture();mutate(c);assert.throws(()=>wireAgencyPriceSigner(c));
 }
});
test('disabled local workers need no production signer configuration',()=>{
 const c={services:{app:{environment:{}},'agency-buyback-worker':{environment:{FUNDED_V3_AGENCY_BUYBACK_ENABLED:'false'}}}};
 assert.equal(wireAgencyPriceSigner(c),c);
});
