import test from 'node:test';
import assert from 'node:assert/strict';
import {createLaunchRegistryController} from '../src/app/controllers/launch-registry.js';
import {renderAirdropProgramDetail} from '../src/features/rewards/airdrop-view.js';

test('reserve completion refreshes the currently open detail, preserves wallet work, and leaves closed details closed',async()=>{
  const previous=globalThis.document,panel={hidden:false,dataset:{mint:'selected'}},status={dataset:{}},calls=[];
  globalThis.document={querySelector:selector=>selector==='#airdrop-selected-program'?panel:status};
  const state={assets:[],connectedWalletAddress:null,apiRequest:async()=>({available:true,data:{cluster:'devnet',reserves:[{mint:'selected',verified:true,claimedBaseUnits:'870114755'}]}}),
    renderHomeKpiDashboard(){},renderAirdropClaims(){},renderRegistry(){},
    getAirdropPrograms(){return[{id:'selected',claimed:this.verifiedCommunityReserves.get('selected').claimedBaseUnits}];},
    renderAirdropProgramDetail:(program,options)=>calls.push({program,options})};
  try{
    const controller=createLaunchRegistryController(state);await controller.loadCommunityReserveStatuses();
    assert.deepEqual(calls.at(-1),{program:{id:'selected',claimed:'870114755'},options:{preserveStatus:false}});
    state.connectedWalletAddress='qa-wallet';Object.assign(status.dataset,{communityClaimWallet:'qa-wallet',communityClaimMint:'selected'});
    await controller.loadCommunityReserveStatuses();assert.equal(calls.at(-1).options.preserveStatus,true);
    state.connectedWalletAddress='different-wallet';await controller.loadCommunityReserveStatuses();assert.equal(calls.at(-1).options.preserveStatus,false);
    panel.hidden=true;const count=calls.length;await controller.loadCommunityReserveStatuses();assert.equal(calls.length,count);
  }finally{globalThis.document=previous;}
});

test('refresh updates verified totals without replacing an active wallet signature or pending receipt control',()=>{
  const pending={textContent:'Waiting for wallet approval',dataset:{communityClaimWallet:'qa-wallet',communityClaimMint:'selected'}},stats={},panel={dataset:{},hidden:false};
  const nodes={'#airdrop-selected-program':panel,'#airdrop-selected-status':pending,'#airdrop-selected-stats':stats,
    '#airdrop-selected-eyebrow':{},'#airdrop-selected-title':{},'#airdrop-claim-unavailable':{}};
  const document={querySelector:selector=>nodes[selector]};
  renderAirdropProgramDetail({id:'selected',name:'QA',symbol:'QA',claimActive:true,claimPublished:true,vaultVerified:true,claimedTokens:870.114755,
    reservedTokens:30000000,allocationPercent:3,eligibleWallets:13,claimWindowDays:90},
  {preserveStatus:true,connectedWalletAddress:'qa-wallet'},{document,formatTokenAmount:String,formatVerifiedAirdropAmount:String});
  assert.match(stats.innerHTML,/870\.114755/);assert.equal(pending.textContent,'Waiting for wallet approval');
  assert.equal(pending.dataset.communityClaimWallet,'qa-wallet');assert.equal(panel.hidden,false);
});
