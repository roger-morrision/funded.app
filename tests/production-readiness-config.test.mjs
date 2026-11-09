import test from 'node:test';
import assert from 'node:assert/strict';
import {buildProductionReadiness} from '../production-readiness.js';

test('merged V3 custody roles do not require unused legacy program variables',()=>{
  const config={SOLANA_CLUSTER:'devnet',VITE_SOLANA_CLUSTER:'devnet',FUNDED_V3_FEE_ROUTER_PROGRAM_ID:'9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm',
    FUNDED_V3_PROGRAM_DATA_SHA256:'a'.repeat(64),FUNDED_V3_X_CLAIMS_ENABLED:'true',X_CLIENT_ID:'client',X_CLIENT_SECRET:'test-secret',X_BEARER_TOKEN:'test-token'};
  const result=buildProductionReadiness(config);
  for(const id of ['feeRouterProgram','rewardProgram','communityVault','xAttestation'])assert.equal(result.checks.find(row=>row.id===id).configured,true);
  assert.equal(result.ready,false);assert.equal(result.verification,'unavailable');
  assert(!JSON.stringify(result).includes('test-secret'));
  delete config.X_BEARER_TOKEN;assert(buildProductionReadiness(config).missing.includes('xAttestation'));
});
test('placeholder identities, missing bytecode pins and mismatched networks cannot look configured',()=>{
  const result=buildProductionReadiness({SOLANA_CLUSTER:'devnet',VITE_SOLANA_CLUSTER:'mainnet-beta',SOLANA_RPC_URL:'https://rpc.example',
    FUNDED_FEE_ROUTER_PROGRAM_ID:'REPLACE_PROGRAM',FUNDED_REWARD_PROGRAM_ID:'invalid',BIRDEYE_API_KEY:'PLACEHOLDER',
    FUNDED_V3_FEE_ROUTER_PROGRAM_ID:'9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm'});
  for(const id of ['matchingNetwork','productionRpc','feeRouterProgram','rewardProgram','marketProvider'])assert(result.missing.includes(id));
  assert.equal(result.configurationComplete,false);assert.equal(result.ready,false);
});
