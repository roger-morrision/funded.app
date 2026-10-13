import test from 'node:test';
import assert from 'node:assert/strict';
import { syncXClaimFlow, resetSolClaimStatus } from '../src/features/rewards/x-claim-view.js';

function node() { return { dataset:{}, checked:false, hidden:false, disabled:false, textContent:'', classList:{ toggle() {} },
  setAttribute() {}, removeAttribute() {} }; }
function fixture() {
  const nodes = Object.fromEntries([
    '#x-sign-in','#sol-claim-id','#claim-binding-agree','#sol-claim-submit',
    '#selected-claim-review','#claim-binding-review','#sol-claim-status',
  ].map(selector => [selector,node()]));
  nodes['#x-sign-in'].dataset.connected = 'true';
  nodes['#sol-claim-id'].value = 'historical-v2-claim';
  nodes['#claim-binding-agree'].checked = true;
  const document = {
    querySelector:selector => nodes[selector] || null,
    querySelectorAll:selector => selector === '#sol-claim-list .x-claim-reward-state.paid'
      ? [node()] : [],
  };
  return { nodes, document };
}

test('X claim controls stay hidden for historical V2 claims despite identity and wallet', () => {
  const f = fixture();
  syncXClaimFlow({ captureWalletSession:() => ({ address:'wallet' }), document:f.document });
  assert.equal(f.nodes['#sol-claim-submit'].hidden, true);
  assert.equal(f.nodes['#sol-claim-submit'].disabled, true);
  assert.match(f.nodes['#sol-claim-submit'].textContent, /V3 X claims pending activation/);
});

test('X claim status distinguishes historical payment from pending V3 activation', () => {
  const f = fixture();
  resetSolClaimStatus({ captureWalletSession:() => ({ address:'wallet' }),
    syncXClaimFlow:() => {}, document:f.document });
  assert.match(f.nodes['#sol-claim-status'].textContent, /Historical verified payments/);
  assert.match(f.nodes['#sol-claim-status'].textContent, /V3 X claims are pending activation/);
});
