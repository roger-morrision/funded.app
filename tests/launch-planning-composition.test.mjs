import test from 'node:test';
import assert from 'node:assert/strict';
import{renderLaunchCostDetails,updateCostSummary}from'../src/features/launch/cost-view.js';
import{launchReviewMarkup}from'../launch-review.js';
import{publicLaunchBudget}from'../public-launch-budget.js';

const quote={status:'ready',solAmountLamports:'8715246',maxSolAmountLamports:'8802399'};
const format=value=>`${(Number(value)/1e9).toFixed(6)} SOL`;
function fixture(){
 const nodes=new Map(),classes=new Set(),document={activeElement:{id:'focused-control'},querySelector:s=>nodes.get(s)||null};
 const details={hidden:false,innerHTML:'',querySelector(){return this.innerHTML.includes('<details')?this.expanded:null},expanded:{open:false}};
 nodes.set('#launch-cost-details',details);nodes.set('#cost-summary',{classList:{toggle(k,on){on?classes.add(k):classes.delete(k)}}});nodes.set('#preview-launch-cost',{parentElement:{hidden:false}});nodes.set('#cost-public-tier-note',{hidden:true,textContent:''});
 return{document,nodes,classes,details,render(state,fee='20000000'){renderLaunchCostDetails(state,{document,formatLaunchCost:format,getLaunchFeeLamports:()=>fee})}};
}
test('public review uses the unchanged budget components for default, changed and zero fees',()=>{
 const f=fixture();for(const fee of['20000000','35000000','0']){f.render({wallet:null,publicQuote:quote},fee);const b=publicLaunchBudget(quote,fee);assert.match(f.details.innerHTML,/Review launch costs/);for(const value of[b.purchase,b.allowance,b.serviceFee,b.overhead,b.total])assert(f.details.innerHTML.includes(format(value)));assert.equal((f.details.innerHTML.match(/<dt>/g)||[]).length,5);assert.equal(f.classes.has('public-launch-planning'),true);assert.equal(f.nodes.get('#preview-launch-cost').parentElement.hidden,true)}
});
test('loading, invalid, unavailable and failed policy replace complete numeric planning totals',()=>{
 const f=fixture();for(const[status,fee,text]of[['loading','20000000','Calculating…'],['invalid','20000000','Enter valid amounts'],['unavailable','20000000','Quote unavailable'],['ready',null,'Fee policy unavailable']]){f.render({wallet:null,publicQuote:quote});f.render({wallet:null,publicQuote:{...quote,status}},fee);assert.equal(f.details.hidden,false);assert(f.details.innerHTML.includes(text));assert(!f.details.innerHTML.includes('0.078802 SOL'));assert(!f.details.innerHTML.includes('<dl>'));assert.equal(f.classes.has('public-launch-planning'),true)}
});
test('connected exact review output and expanded state survive public/connected transitions without focus movement',t=>{
 const f=fixture(),focus=f.document.activeElement,now=Date.now(),review={available:true,wallet:'offline-wallet',balance:'1935000000',budget:'935000000',balanceAfterBudget:'1000000000',buyQuote:'840000000',allowance:'10000000',serviceFeeLamports:'35000000',otherLaunchCosts:'45000000',networkFee:'5000000',transactionCount:2,messageCount:2,curvePremiumBps:0,quotedAt:now,expiresAt:now+60000};
 t.mock.method(Date,'now',()=>now);f.render({wallet:null,publicQuote:quote});renderLaunchCostDetails({wallet:{},launchCostReview:review},{document:f.document,formatLaunchCost:format,getLaunchFeeLamports:()=>{throw Error('Connected review must not request the public fee')}});assert.equal(f.details.innerHTML,launchReviewMarkup(review));assert.equal(f.classes.has('public-launch-planning'),false);assert.equal(f.nodes.get('#preview-launch-cost').parentElement.hidden,false);assert.equal(f.nodes.get('#cost-public-tier-note').hidden,true);
 f.details.expanded.open=true;f.render({wallet:{},launchCostReview:review});assert.equal(f.details.expanded.open,true);assert.equal(f.details.innerHTML,launchReviewMarkup(review));f.render({wallet:null,publicQuote:quote});assert(!f.details.innerHTML.includes('<details'));assert.equal(f.document.activeElement,focus);
});
test('summary keeps compatibility values, token reserve and tier context while hiding only public duplicate presentation',()=>{
 const f=fixture();for(const id of['cost-launch','cost-service-fee','cost-total-enabled','cost-note','preview-cost-label','cost-initial-buy','cost-total-label','launch-mobile-budget-label','launch-mobile-budget-value','launch-mobile-budget-note','cost-burn','cost-burn-row','cost-tier-label','cost-creator-buy','cost-community-tokens','cost-community-detail'])f.nodes.set('#'+id,{textContent:'',innerHTML:'',hidden:false});
 const args={wallet:null,estimatedLaunchFeeLamports:null,publicQuote:quote},options={document:f.document,formatLaunchCost:format,getLaunchFeeLamports:()=>'20000000',renderLaunchCostDetails:()=>f.render(args),getLaunchBurnPolicy:()=>({requiresBurn:false}),getCreatorBuySummary:()=>({sol:0,tokens:0}),getCommunityAirdropTokens:()=>30000000,getCommunityAllocationPercent:()=>3,formatLaunchBurnAmount:String,creatorBuyExceedsWalletBalance:()=>false,developerBuyLimitReached:()=>false};
 updateCostSummary(args,options);assert.equal(f.nodes.get('#cost-total-enabled').textContent,'0.078802 SOL');assert.equal(f.nodes.get('#launch-mobile-budget-value').textContent,'0.078802 SOL');assert.equal(f.nodes.get('#cost-public-tier-note').textContent,'Standard has no $FUNDED burn.');assert.equal(f.nodes.get('#cost-community-tokens').textContent,'30,000,000');assert.equal(f.classes.has('public-launch-planning'),true);
});
