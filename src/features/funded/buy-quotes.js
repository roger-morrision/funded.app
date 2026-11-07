import {refreshServiceFees,appTradeBps,appTradeRecipient} from '../fees/service-fees-client.js';
import {fundedBuyFailureMessage} from './buy-feedback.js';

export const FUNDED_BUY_QUOTE_TTL = 15_000;
export function currentFundedBuyQuote(app,amount,now=Date.now()) {
  const quote=app.fundedBuyPreview;
  return quote && quote.amount===amount && quote.wallet===(app.connectedWalletAddress || null)
    && quote.provider===(app.wallet || null) && now-quote.preparedAt<FUNDED_BUY_QUOTE_TTL ? quote : null;
}

// Only read while the controls are visible. A debounce and retry cooldown bound RPC traffic.
export function createFundedBuyQuotes(app) {
  let generation=0,flight=null,timer=null,lastAttempt=-Infinity,notBefore=0,paused=false;
  const input=()=>globalThis.document?.querySelector('#funded-buy-amount');
  const visible=()=>!globalThis.document?.hidden && Boolean(input()?.getClientRects().length);
  async function refresh() {
    const amount=Number(input()?.value);
    if(paused || flight || Date.now()<notBefore || app.fundedBuyBusy || app.fundedBuyRoute.status!=='ready' || !visible() || !Number.isFinite(amount) || amount<=0) return;
    const current=currentFundedBuyQuote(app,amount);
    if(current && Date.now()-current.preparedAt<10_000) return;
    if(Date.now()-lastAttempt<10_000) return;
    const request=++generation,provider=app.wallet || null,address=app.connectedWalletAddress || null;
    const session=provider ? app.captureWalletSession() : null;
    const matches=()=>request===generation && !app.fundedBuyBusy && visible() && Number(input()?.value)===amount
      && (app.wallet || null)===provider && (app.connectedWalletAddress || null)===address;
    lastAttempt=Date.now();app.fundedBuyPreview=null;
    app.renderFundedBuyControl('Updating quote…');
    flight=(async()=>{
      try {
        if(app.APP_CLUSTER!=='devnet' || app.APP_MAINNET_READ_ONLY) throw Error('Buy unavailable on this network.');
        const rpc=await app.getTradePreviewConnection();
        await refreshServiceFees(app);
        if(!matches()) return;
        const args={connection:rpc,side:'buy',mint:app.PROTOCOL_FUNDED_MINT,poolAddress:app.PROTOCOL_FUNDED_SWAP_POOL,
          amount,slippagePercent:1,feeOwner:appTradeRecipient(app),feeBps:appTradeBps(app)};
        const trade=session && app.canSignTransactions(session.provider)
          ? await app.buildVerifiedPoolTradeTransaction({...args,user:session.provider.publicKey})
          : await app.fetchVerifiedPoolBuyQuote(args);
        if(!matches()) return;
        if(session) app.assertWalletSessionCurrent(session);
        app.fundedBuyPreview={trade,amount,wallet:address,provider,preparedAt:Date.now(),quote:app.describeTradeQuote(trade,1,'$FUNDED')};
        app.renderFundedBuyControl('Quote refreshes automatically. Review the amounts, then approve in your wallet.');
      } catch(error) {
        if(matches()){app.fundedBuyPreview=null;app.renderFundedBuyControl(fundedBuyFailureMessage(error));}
      }
    })();
    try {await flight;} finally {flight=null;}
  }
  function invalidate() {
    generation++;paused=false;lastAttempt=-Infinity;notBefore=Date.now()+500;clearTimeout(timer);app.fundedBuyPreview=null;
    app.renderFundedBuyControl(Number(input()?.value)>0 ? 'Updating quote…' : 'Enter a SOL amount to see how much $FUNDED you could receive.');
    timer=setTimeout(()=>{void refresh();},500);
  }
  function pause(){generation++;paused=true;clearTimeout(timer);}
  return {refresh,invalidate,pause};
}
