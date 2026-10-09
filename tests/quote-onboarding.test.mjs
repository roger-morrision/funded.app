import { readAppSource } from '../scripts/read-app-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { quoteCountdown, quoteCountdownMarkup, updateQuoteCountdowns } from '../quote-countdown.js';
import { availableWalletChoices } from '../wallet-onboarding.js';
import { launchReview, launchReviewMarkup } from '../launch-review.js';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('quote timer handles final second, exact expiry and suspended-tab time jumps', () => {
  assert.equal(quoteCountdown(61_000, 0).text, 'Price expires in 1:01');
  assert.equal(quoteCountdown(15_000, 14_999).seconds, 1);
  assert.equal(quoteCountdown(15_000, 15_000).expired, true);
  assert.equal(quoteCountdown(15_000, 999_000).seconds, 0);
  assert.equal(quoteCountdown(15_000, 5_000).state, 'expiring');
  assert.equal(quoteCountdown('invalid', 0).expired, true);
  assert.equal(quoteCountdown('2026-10-08T00:01:00Z', Date.parse('2026-10-08T00:00:00Z')).seconds, 60);
});

test('timer refresh changes only text and state, preserving surrounding controls', () => {
  let writes=0;
  const node={dataset:{quoteExpires:'15000'},get textContent(){return this.text;},set textContent(value){this.text=value;writes++;}};
  const root={querySelectorAll:()=>[node]};
  updateQuoteCountdowns(root, 5000);
  updateQuoteCountdowns(root, 5000);
  assert.equal(writes,1);
  updateQuoteCountdowns(root,15000);
  assert.equal(node.dataset.state,'expired');
  assert.match(node.textContent,/refresh to continue/);
  assert.match(quoteCountdownMarkup(15_000,0),/role="timer" aria-live="off"/);
});

test('wallet choices only include distinct signing providers and preserve their identity', () => {
  const provider={connect(){},signTransaction(){}};
  const other={connect(){},signTransaction(){}};
  const choices=availableWalletChoices([{id:'phantom',provider},{id:'legacy',provider},{id:'backpack',provider:other},{id:'solflare',provider:{connect(){}}}]);
  assert.deepEqual(choices.map(row=>row.label),['Phantom','Backpack']);
  assert.equal(choices[0].provider,provider);
  assert.deepEqual(availableWalletChoices([]),[]);
});

test('launch amounts stay outside advanced details and countdown uses the reviewed deadline', () => {
  const review=launchReview({balance:1000000000,simulatedSpend:20000,networkFee:5000,transactionCount:1,now:1000});
  const markup=launchReviewMarkup(review,1000);
  assert(markup.indexOf('Estimated SOL budget') < markup.indexOf('<details'));
  assert.match(markup,/<details class="advanced-details"><summary>Advanced details · cost breakdown/);
  assert.match(markup,/data-quote-expires="61000"/);
  assert.doesNotMatch(markup,/<details[^>]* open/);
});

test('expired checkout actions refresh prices, while a submitted boost stays in recovery', async () => {
  const app=await readAppSource();
  const start=app.indexOf('function refreshQuoteClocks(){');
  const end=app.indexOf('setInterval(()=>{',start);
  const tradeButton={},buyButton={};let renders=0;
  const nodes={'#explore-boost-dialog':{open:true},'.explore-boost-quote':{},'#trade-review-dialog':{open:true},'#trade-review-confirm':tradeButton,'#funded-buy-submit':buyButton};
  const context={document:{hidden:false,querySelector:s=>nodes[s]},updateQuoteCountdowns(){},
    boostCheckout:{busy:false,pendingSignature:null,quote:{expiresAt:'2000-01-01T00:00:00Z'}},
    currentTradePreview:()=>null,fundedBuyPreview:{preparedAt:0},fundedBuyBusy:false,
    renderExploreBoostDialog:()=>{renders++;}};
  vm.runInNewContext(app.slice(start,end),context);
  context.refreshQuoteClocks();
  assert.equal(renders,1);
  assert.match(context.boostCheckout.message,/expired.*Refresh/);
  assert.equal(tradeButton.textContent,'Refresh quote');
  assert.equal(buyButton.textContent,'Refresh quote');
  context.boostCheckout.pendingSignature='submitted-receipt';
  context.refreshQuoteClocks();
  assert.equal(renders,1);
  context.boostCheckout.pendingSignature=null;context.boostCheckout.busy=true;
  context.refreshQuoteClocks();
  assert.equal(renders,1);
});
