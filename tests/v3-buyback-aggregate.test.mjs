import test from 'node:test';
import assert from 'node:assert/strict';
import {aggregatePendingBuybacks,aggregateSourceBudget} from '../server/v3-buyback-aggregate.mjs';
import {v3BuybackSourceSpent} from '../server/v3-buyback-orders.mjs';
const state=()=>({collections:Object.fromEntries(['a','b'].map(source=>[source,{signature:source,mint:'mint',status:'collected',onchainVerified:true,programId:'program'}])),
 v3Settlements:Object.fromEntries(['a','b'].map(source=>[source,{mint:'mint',status:'finalized',collectionSignature:source,allocationPlan:{protocol:{buybackLamports:'6000'}}}])),v3BuybackOrders:{}});
test('dust is executable only as an enabled same-mint aggregate and pending signatures are reconciled first',()=>{
 const s=state(),rows=['a','b'].map(source=>({mint:'mint',sourceCollectionSignature:source,amountLamports:'6000',status:'below-minimum-order'}));
 assert.equal(aggregatePendingBuybacks(s,rows,'program',false).length,2);
 const grouped=aggregatePendingBuybacks(s,rows,'program',true);assert.equal(grouped.length,1);assert.equal(grouped[0].amountLamports,'12000');
 s.v3BuybackOrders.a={mint:'mint',status:'verification-pending',signature:'signed'};
 assert.equal(aggregatePendingBuybacks(s,rows,'program',true).length,2);
});
test('partial aggregate debit conserves each source and cannot be counted twice',()=>{
 const s=state();s.v3BuybackOrders.aggregate={sourceKind:'aggregate-collections',status:'finalized',finalized:true,
  programId:'program',vaultDebitVerified:true,burnInstructionVerified:true,spentLamports:'8000',
  sourceBudgets:[{source:'a',amountLamports:'6000'},{source:'b',amountLamports:'6000'}]};
 assert.equal(v3BuybackSourceSpent(s,'a','program'),6000n);assert.equal(v3BuybackSourceSpent(s,'b','program'),2000n);
 assert.equal(aggregateSourceBudget(s,'mint','program').total,4000n);
 s.v3BuybackOrders.aggregate.spentLamports='12001';assert.throws(()=>v3BuybackSourceSpent(s,'a','program'),/exceeds/);
});
