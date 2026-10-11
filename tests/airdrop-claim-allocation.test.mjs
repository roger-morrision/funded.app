import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommunityClaimsController } from '../src/app/controllers/community-claims.js';
import { createAirdropDirectoryController } from '../src/app/controllers/airdrop-directory.js';
import { formatTokenBaseUnits } from '../funded-burn.js';

test('connected wallet receives its verified claim amount once per snapshot without signing', async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { querySelector: () => null };
  try {
    const mint = 'So11111111111111111111111111111111111111112';
    const wallet = '11111111111111111111111111111111';
    const session = { address: wallet };
    const programs = [{ id: mint, symbol: 'TEST', claimActive: true, snapshotHash: 'snapshot-a', status:'claiming' }];
    const allocations = new Map();
    let proofRequests = 0;
    const mintData = new Uint8Array(45); mintData[44] = 6;
    const state = {
      wallet: {}, connectedWalletAddress: wallet, communityWalletAllocations: allocations,
      captureWalletSession: () => session, isWalletSessionCurrent: current => current === session,
      getAirdropPrograms: () => programs,
      updateDirectoryWalletAmount(current, program, status, amount) {
        if (current !== session) return false;
        allocations.set(program.id, { wallet, snapshotHash:program.snapshotHash, status, amount });
        return true;
      },
      async apiRequest() { proofRequests++; return { available:true, data:{ status:'claimable', recipient:wallet,
        mint, snapshotHash:programs[0].snapshotHash, amount:'123456700' } }; },
      getSolana: async () => ({ PublicKey: class { constructor(value) { this.value=value; } } }),
      getTradePreviewConnection: async () => ({ getAccountInfo: async () => ({ data:mintData }) }),
      formatTokenBaseUnits,
    };
    Object.assign(state, createCommunityClaimsController(state));
    const directory = createAirdropDirectoryController(state);
    await state.checkCommunityClaim(mint, { silent:true });
    assert.equal(directory.directoryWalletAmount(programs[0]), '123.4567 TEST');
    await state.checkCommunityClaim(mint, { silent:true });
    assert.equal(proofRequests, 1);
    assert.equal(state.communityClaimReview, undefined);
    programs[0].snapshotHash = 'snapshot-b';
    await state.checkCommunityClaim(mint, { silent:true });
    assert.equal(proofRequests, 2);
  } finally { globalThis.document = previousDocument; }
});
