import test from 'node:test';
import assert from 'node:assert/strict';
import { createAirdropDirectoryController } from '../src/app/controllers/airdrop-directory.js';

test('On curve omits claim action and funding line while Claims open keeps them', () => {
  const previousDocument = globalThis.document;
  const list = { dataset: {}, innerHTML: '' };
  globalThis.document = { querySelector: selector => selector === '#airdrop-directory' ? list : null };
  try {
    const state = {
      airdropDirectoryStatus: 'curve', airdropDirectoryPage: 1, AIRDROP_DIRECTORY_PAGE_SIZE: 10,
      verifiedLaunchPoliciesStatus: 'ready', communityReserveStatus: 'ready',
      communityWalletAllocations: new Map(), connectedWalletAddress: null,
      escapeHtml: value => String(value), tokenCardData: () => ({ reserveState: 'verified' }),
      verifiedLaunchPolicyForMint: () => null, exploreBoostAmountMarkup: () => '',
      tokenCardWatchMarkup: () => '<button>Watch</button>', tokenCardShareMarkup: () => '<button>Share</button>',
      tokenCardAddressesMarkup: () => '', exploreSocialLinksMarkup: () => '', tokenCardEvidenceLabel: () => '',
      formatPolicyTokenCount: value => value.toLocaleString(), directoryWalletAmount: () => 'Check when claims open',
      loadVerifiedTokenLogos: () => {},
    };
    const controller = createAirdropDirectoryController(state);
    const program = { id: 'So11111111111111111111111111111111111111112', name: 'Curve test', symbol: 'CURVE',
      status: 'upcoming', statusLabel: 'Claims pending', reservedTokens: 30000000, onCurve: true, claimActive: false };
    controller.renderAirdropDirectory([program]);
    assert.match(list.innerHTML, /On curve · opens after migration/);
    assert.match(list.innerHTML, /Share/);
    assert.doesNotMatch(list.innerHTML, /Funding:|View claim status|directory-claim/);

    state.airdropDirectoryStatus = 'claiming';
    controller.renderAirdropDirectory([{ ...program, status: 'claiming', claimActive: true,
      claimPublished: true, migrationAt: 1_760_000_000 }]);
    assert.doesNotMatch(list.innerHTML, /Funding:/);
    assert.match(list.innerHTML, /Migrated .* UTC/);
    assert.match(list.innerHTML, /View claim status/);
  } finally { globalThis.document = previousDocument; }
});
