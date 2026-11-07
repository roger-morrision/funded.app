import test from 'node:test';
import assert from 'node:assert/strict';
import {createTradeStateController} from '../src/app/controllers/trade-state.js';

test('trade refresh updates the header from the same wallet balance read', async()=>{
  const oldDocument=globalThis.document;
  globalThis.document={querySelector:()=>({value:'mint'})};
  try{
    let balanceReads=0,headerRenders=0;
    const app={tradeBalanceRequest:0,coinTradeEstimate:{mint:'mint',decimals:6},tradeBalanceKey:()=> 'wallet:mint',captureWalletSession:()=>({provider:{publicKey:'wallet'}}),isWalletSessionCurrent:()=>true,renderTradeBalances(){},renderWalletBalance(){headerRenders++;},getSolana:async()=>({PublicKey:class{}}),getExploreConnection:async()=>({getBalance:async()=>{balanceReads++;return 41896307;},getParsedTokenAccountsByOwner:async()=>({value:[]})})};
    await createTradeStateController(app).refreshTradeBalances();
    assert.equal(app.walletBalanceLamports,41896307);
    assert.equal(app.tradeBalanceState.solLamports,41896307n);
    assert.equal(balanceReads,1);assert.equal(headerRenders,1);
    app.isWalletSessionCurrent=()=>false;
    app.walletBalanceLamports=123;
    await createTradeStateController(app).refreshTradeBalances();
    assert.equal(app.walletBalanceLamports,123,'a stale wallet response must not overwrite the new wallet header');
    assert.equal(headerRenders,1);
  }finally{globalThis.document=oldDocument;}
});
