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
  assert.match(f.nodes['#sol-claim-submit'].textContent, /Verify wallet and claim V3 SOL/);
});

test('X claim status shows historical payment without offering a V3 payout', () => {
  const f = fixture();
  resetSolClaimStatus({ captureWalletSession:() => ({ address:'wallet' }),
    syncXClaimFlow:() => {}, document:f.document });
  assert.match(f.nodes['#sol-claim-status'].textContent, /Verified payments are listed above/);
});

test('a funded V3 reward requires wallet consent before enabling its claim', () => {
  const f=fixture();
  const selected=node();selected.dataset={claimId:'historical-v2-claim',claimScope:'per-mint-v3',claimStatus:'ready'};
  const prior=f.document.querySelectorAll;
  f.document.querySelectorAll=selector=>selector==='#sol-claim-list [data-claim-id]'
    ? [selected] : prior(selector);
  f.nodes['#claim-binding-agree'].checked=false;
  syncXClaimFlow({ captureWalletSession:()=>({address:'wallet'}), document:f.document });
  assert.equal(f.nodes['#sol-claim-submit'].hidden,false);
  assert.equal(f.nodes['#sol-claim-submit'].disabled,true);
  f.nodes['#claim-binding-agree'].checked=true;
  syncXClaimFlow({ captureWalletSession:()=>({address:'wallet'}), document:f.document });
  assert.equal(f.nodes['#sol-claim-submit'].disabled,false);
});
