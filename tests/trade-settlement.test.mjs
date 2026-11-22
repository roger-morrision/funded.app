import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey } from '@solana/web3.js';
import { indexedTradeEstimate } from '../src/features/trade/indexed-trade-estimate.js';
import { updateTradeAmountLabel } from '../src/features/trade/amount-view.js';
import { buildJupiterTrade, JUPITER_PROGRAM_ID } from '../jupiter-trading.js';
import { describeTradeQuote } from '../trade-quote-display.js';

const mint='9a5uUXxa7LzHkT6YUikttpQsUZm4Etw8qhd2HP7xpump';
const wsol='So11111111111111111111111111111111111111112';
const market={mint,symbol:'KATIA',dexId:'pumpswap',decimals:6,priceUsd:0.00001299,
  quoteMint:'SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb',quoteSymbol:'SPCX'};

test('SPCX market keeps its pair metadata while indexed trade inputs use SOL',()=>{
  const estimate=indexedTradeEstimate(market,150);
  const nodes=new Map();
  const document={querySelector:key=>{if(!nodes.has(key))nodes.set(key,{dataset:{}});return nodes.get(key);},querySelectorAll:()=>[]};
  document.querySelector('#trade-side').value='buy';
  const render=()=>updateTradeAmountLabel({coinTradeEstimate:estimate},{document,renderTradeBalances(){},renderTradeAmountEstimate(){}});
  render();
  assert.equal(document.querySelector('#trade-amount-heading').textContent,'SOL to spend');
  assert.equal(document.querySelector('#coin-quick-amounts').hidden,false);
  assert.equal(estimate.quoteMint,null);
  assert.equal(market.quoteSymbol,'SPCX');
  document.querySelector('#trade-side').value='sell';render();
  assert.equal(document.querySelector('#trade-amount-heading').textContent,'Tokens to sell');
  assert.equal(document.querySelector('#trade-asset-symbol').textContent,'KATIA');
});

for(const side of ['buy','sell'])test(`Jupiter ${side} quote settles in SOL regardless of the pool pair`,async()=>{
  const user=new PublicKey(mint);
  const data={mint,user:mint,side,decimals:6,amount:'100000000',quote:{inAmount:'100000000',outAmount:'200000000',otherAmountThreshold:'190000000'},
    instructions:{computeBudgetInstructions:[],setupInstructions:[],swapInstruction:{programId:JUPITER_PROGRAM_ID,accounts:[],data:''},otherInstructions:[]},lookupTables:[]};
  const trade=await buildJupiterTrade({side,mint,user,amount:0.1,feeOwner:wsol,request:async()=>({available:true,data})});
  assert.equal(trade.quoteMint,wsol);assert.equal(trade.quoteDecimals,9);
  const quote=describeTradeQuote(trade,1,'KATIA');
  assert.equal(quote.quoteSymbol,'SOL');
  assert.equal(quote.outputSymbol,side==='buy'?'KATIA':'SOL');
  assert.equal(quote.expected,side==='buy'?200:0.2);
});
