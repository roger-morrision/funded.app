import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommunityClaimsController } from '../src/app/controllers/community-claims.js';

const mint = 'So11111111111111111111111111111111111111112';
const wallet = '11111111111111111111111111111111';
const V2 = '61EQ3onuS2jKzjUDhXdkwKNGiG8Djss3an5vPN3vwYYa';
const V3 = '9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm';

async function attemptClaim({ scope, routeProgram, reserveProgram, instructionProgram }) {
  const messages = [];
  const button = { disabled:false };
  const status = { querySelector:() => button,
    append:node => messages.push(node.textContent) };
  const priorDocument = globalThis.document;
  globalThis.document = { querySelector:() => status,
    createTextNode:text => ({ textContent:text }) };
  let signatures = 0;
  const provider = { signTransaction:async () => { signatures++; } };
  const session = { address:wallet, provider };
  const appState = {
    captureWalletSession:() => session, canSignTransactions:() => true,
    communityClaimReview:{ mint, wallet, amount:'5', index:0, at:Date.now() },
    apiRequest:async () => ({ available:true, data:{ accounts:[], amount:'5', programId:instructionProgram } }),
    getSolana:async () => ({ PublicKey:class { constructor(value) { this.value = value; } toBase58() { return this.value; } } }),
    getTradePreviewConnection:async () => ({}),
    verifiedCommunityReserves:new Map([[mint, { verified:true, programId:reserveProgram, scope }]]),
    verifiedLaunchPolicies:[{ mint, cluster:'devnet', onchainVerified:true,
      pumpFeeRoute:{ scope, verified:true, programId:routeProgram } }],
    FEE_ROUTER_PROGRAM_ID:V2, emitPilotSignal:() => {},
    pilotInterruptedSignal:() => 'claim-interrupted', isWalletSessionCurrent:() => true,
  };
  try { await createCommunityClaimsController(appState).submitCommunityClaim(mint); }
  finally { globalThis.document = priorDocument; }
  return { messages, signatures };
}

test('browser refuses a V3 claim with a reserve bound to V2', async () => {
  const result = await attemptClaim({ scope:'per-mint-v3', routeProgram:V3,
    reserveProgram:V2, instructionProgram:V3 });
  assert.match(result.messages.join(' '), /Claim program differs/);
  assert.equal(result.signatures, 0);
});

test('browser refuses a V3 claim instruction bound to V2', async () => {
  const result = await attemptClaim({ scope:'per-mint-v3', routeProgram:V3,
    reserveProgram:V3, instructionProgram:V2 });
  assert.match(result.messages.join(' '), /Claim program differs/);
  assert.equal(result.signatures, 0);
});

test('historical V2 program passes identity guard before instruction validation', async () => {
  const result = await attemptClaim({ scope:'per-mint-v2', routeProgram:V2,
    reserveProgram:V2, instructionProgram:V2 });
  assert.match(result.messages.join(' '), /Claim instruction does not match/);
  assert.equal(result.signatures, 0);
});
