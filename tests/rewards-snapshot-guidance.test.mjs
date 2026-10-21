import test from 'node:test';
import assert from 'node:assert/strict';
import {renderAirdropProgramDetail} from '../src/features/rewards/airdrop-view.js';

const cases=[
  {id:'30 days',claimWindowDays:30,includes:'within 30 days'},
  {id:'90 days',claimWindowDays:90,includes:'within 90 days'},
  {id:'120 days',claimWindowDays:120,includes:'within 120 days'},
  {id:'closed',claimActive:false,status:'closed',includes:'The claim window ended 2030-01-02 00:00 UTC'},
  {id:'not open',claimActive:false,claimPublished:false,includes:'Not open yet'},
  {id:'verification unavailable',claimActive:false,claimVerification:'unavailable',includes:'Verification unavailable'},
  {id:'missing window',claimWindowDays:null,includes:'before the published deadline'},
  {id:'Devnet QA cutoff',snapshotBasis:'devnet-qa-cutoff',claimWindowDays:30,includes:'Devnet QA'},
];
for(const variant of cases)test(`per-coin detail terms retain ${variant.id} semantics`,()=>{
  const status={dataset:{},textContent:'',contains:()=>false,children:[],append(...nodes){this.children.push(...nodes);}},stats={innerHTML:''};
  const nodes={'#airdrop-selected-program':{dataset:{},hidden:false},'#airdrop-selected-status':status,'#airdrop-selected-stats':stats,'#airdrop-selected-eyebrow':{},'#airdrop-selected-title':{},'#airdrop-claim-unavailable':{}};
  const document={activeElement:null,querySelector:selector=>nodes[selector],createElement:tag=>({tag,dataset:{},textContent:'',children:[],append(...children){this.children.push(...children);},querySelectorAll:()=>[]}),createTextNode:text=>({textContent:text})};
  const program={id:'synthetic-terms',name:'Offline terms fixture',symbol:'QA',claimActive:true,claimPublished:true,vaultVerified:true,claimWindowDays:90,deadline:'2030-01-02 00:00 UTC',snapshot:'2029-10-04 00:00 UTC',snapshotBasis:'pump-migration',reservedTokens:30000000,allocationPercent:3,claimedTokens:0,eligibleWallets:1,...variant};
  renderAirdropProgramDetail(program,{connectedWalletAddress:null,wallet:null,APP_EXPLORER_QUERY:'?cluster=devnet'},{document,formatTokenAmount:String,formatVerifiedAirdropAmount:String});
  const rendered=stats.innerHTML+' '+status.textContent;
  assert(rendered.includes(variant.includes));
  if(variant.claimWindowDays===30||variant.claimWindowDays===120)assert(!rendered.includes('within 90 days'));
  if(variant.id==='Devnet QA cutoff')assert(status.textContent.includes(program.deadline));
  assert.equal(document.activeElement,null,'Background terms rendering must not move focus');
});
