import test from 'node:test';
import assert from 'node:assert/strict';
import { homeFeeAllocationSummary } from '../server/home-dashboard-metrics.mjs';
import { V3_DEVNET_FUNDED_MINT } from '../server/v3-buyback-instruction.mjs';
import { proofTotals } from '../src/features/proof/proof-totals.js';

test('a package burn, an own-coin burn, and two copies of a protocol receipt reconcile separately', () => {
  const mint = 'source', programId = 'router', signature = '2'.repeat(88);
  const protocol = { mint, programId, fundedMint:V3_DEVNET_FUNDED_MINT.toBase58(), category:6, agencyPolicy:true,
    signature, receipt:'receipt', status:'finalized', finalized:true, vaultDebitVerified:true, burnInstructionVerified:true,
    spentLamports:'142328', burnedBaseUnits:'17995' };
  const state = { launches:{[mint]:{mint, cluster:'devnet',onchainVerified:true,pumpFeeRoute:{programId},
    creatorLaunchBurn:{status:'verified',receipt:{signature:'3'.repeat(88),amountTokens:399}}}},
    v3BuybackOrders:{a:protocol,b:{...protocol}, wrongMint:{...protocol,fundedMint:mint},
      wrongCategory:{...protocol,category:7}, pending:{...protocol,status:'pending'}},
    v3AgencyExecutions:{own:{status:'finalized',proof:{burnedBaseUnits:'5000'}}}};
  const summary = homeFeeAllocationSummary(state, null, 'devnet');
  assert.equal(summary.burnedTokens,399);
  assert.deepEqual(summary.protocolBuybacks,{count:1,spentLamports:'142328',burnedBaseUnits:'17995',mint:protocol.fundedMint});
  const card = proofTotals({homeFeeAllocations:summary}).find(item=>item.key==='buyback');
  assert.equal(card.lamports,142328);
  assert.match(card.note,/17,995/);
  state.v3BuybackOrders.b.burnedBaseUnits = '5';
  assert.equal(homeFeeAllocationSummary(state,null,'devnet').protocolBuybacks,null);
});
