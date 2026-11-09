import test from 'node:test';
import assert from 'node:assert/strict';
import {mainnetEvidenceSummary} from '../scripts/mainnet-evidence-summary.mjs';
test('new financial evidence keeps later failures and never promotes step results into full acceptance',()=>{
  const report={schemaVersion:1,cluster:'devnet',appRevisionTested:'a'.repeat(40),adminWithdrawal:{verified:true},
    newLaunch:{checks:[{name:'creator-fee-collection',status:'passed'},{name:'settlement',status:'passed'},
      {name:'creator-fee-collection',status:'failed'},{name:'live-registration',status:'passed'}]}};
  const result=mainnetEvidenceSummary(report);
  assert.equal(result.revision,report.appRevisionTested);assert.equal(result.observations.length,1);
  assert(result.acceptance.every(row=>row.status==='partial'));
  assert.match(result.acceptance.find(row=>row.id==='collect-and-settle').detail,/2 passed, 1 failed/);
  assert.equal(mainnetEvidenceSummary({...report,cluster:'mainnet-beta'}),null);
  assert.equal(mainnetEvidenceSummary({...report,appRevisionTested:'main'}),null);
});
test('legacy evidence retains only recognized statuses and cannot invent a successful case',()=>{
  const result=mainnetEvidenceSummary({schemaVersion:1,cluster:'devnet',application:{revision:'a'.repeat(40)},
    acceptance:[{id:'buyback-burn',status:'passed-live'},{id:'recovery',status:'looks-good'}]});
  assert.equal(result.acceptance.length,1);assert.equal(result.acceptance[0].id,'buyback-burn');
});
