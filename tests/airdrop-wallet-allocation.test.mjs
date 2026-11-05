import test from 'node:test';
import assert from 'node:assert/strict';
import {createCommunityClaimsController} from '../src/app/controllers/community-claims.js';
function fixture(response){
  let current=true;const session={address:'holder'},updates=[];
  const state={captureWalletSession:()=>session,isWalletSessionCurrent:()=>current,communityWalletAllocations:new Map(),
    getAirdropPrograms:()=>[{id:'mint',claimPublished:true,snapshotHash:'snapshot'}],
    updateDirectoryWalletAmount:(_session,_program,status,amount)=>updates.push({status,amount}),
    apiRequest:async path=>{assert.match(path,/^\/api\/airdrops\/allocation\?/);return typeof response==='function'?response():response;},
    getSolana:async()=>({PublicKey:class{}}),getTradePreviewConnection:async()=>({getAccountInfo:async()=>({data:new Uint8Array(45)})}),
    formatTokenBaseUnits:amount=>amount};
  return {controller:createCommunityClaimsController(state),updates,switch:()=>current=false};
}
test('automatic allocation lookup is read-only and exposes no manual claim or claim-status actions',async()=>{
  const f=fixture({available:true,data:{status:'claimable',mint:'mint',recipient:'holder',amount:'750'}});
  assert.equal(f.controller.claimCommunityDrop,undefined);assert.equal(f.controller.checkCommunityClaim,undefined);
  await f.controller.loadCommunityAllocation('mint');assert.deepEqual(f.updates.at(-1),{status:'claimable',amount:'750'});
});
test('unavailable and foreign-wallet allocation responses never become a received amount',async()=>{
  for(const response of [{available:false},{available:true,data:{status:'claimed',mint:'mint',recipient:'other',amount:'100'}}]){
    const f=fixture(response);await f.controller.loadCommunityAllocation('mint');assert.equal(f.updates.at(-1).status,'unavailable');
  }
});
test('a response arriving after the wallet changes is discarded',async()=>{
  let finish;const pending=new Promise(r=>finish=r),f=fixture(()=>pending),read=f.controller.loadCommunityAllocation('mint');
  f.switch();finish({available:true,data:{status:'claimed',mint:'mint',recipient:'holder',amount:'750'}});await read;
  assert.deepEqual(f.updates,[{status:'checking',amount:undefined}]);
});
