import { PublicKey, Connection } from '@solana/web3.js';
import { activeBoosts, boostLamports, boostMemo } from '../../boost-offer.js';
import { allowedAuthOrigin } from '../x-auth.mjs';
import { DEVNET_GENESIS_HASH } from '../automatic-reward-chain.mjs';
import { verifyBoostPayment } from '../boost-proof.mjs';
import {boostPricingSnapshot} from '../admin-boost-pricing.mjs';
import {projectBoostReceipts,STACKED_BOOST_POLICY} from '../../boost-timeline.js';
import {prepareBoostPayment, registerBoostPayment, expiredBoostPayment} from '../boost-payment-journal.mjs';

// Called after the shared request policy, rate limit, and authorization checks.
// Return true only after sending a response; false lets the router continue.
export function createBoostRoutes({
  store, solanaCluster, boostPurchasesEnabled, clientKey, body, readSolUsdQuote, id, solanaRpcUrl,
  respond, connectionFactory=(url,options)=>new Connection(url,options),
}) {

  const json = (...args) => { respond(...args); return true; };
  const receiptView=(state,signature)=>projectBoostReceipts(state.boostReceipts).find(row=>row.signature===signature)||state.boostReceipts[signature];
  const connection=()=>connectionFactory(solanaRpcUrl,{commitment:'finalized',disableRetryOnRateLimit:true,
    fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(8000)})});
  return async function handleBoostRoutes(req, res, url, requestId) {
    if (req.method === 'GET' && url.pathname === '/api/boosts') {
      const state = await store.read();
      const mint = url.searchParams.get('mint');
      if (mint) {
        try { if (new PublicKey(mint).toBase58() !== mint) throw new Error(); }
        catch { return json(res, 400, { error:'A valid token mint is required.' }); }
      }
      const active = activeBoosts(state.boostReceipts);
      const history = mint ? projectBoostReceipts(state.boostReceipts).filter(row => row.mint === mint)
        .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt)).slice(0, 30) : [];
      const pricing=boostPricingSnapshot(state);
      return json(res, 200, { cluster:solanaCluster, enabled:boostPurchasesEnabled && Boolean(process.env.FUNDED_BOOST_PAYMENT_WALLET), packages:pricing.packages, pricingRevision:pricing.revision, active:mint ? (active[mint] ? { [mint]:active[mint] } : {}) : active, history });
    }
    if (req.method === 'POST' && url.pathname === '/api/boosts/quote') {
      if (solanaCluster !== 'devnet') return json(res, 403, { error:'Boost payments are available on Solana only.' });
      if (!boostPurchasesEnabled) return json(res, 503, { error:'New boost purchases are currently paused.' });
      if (!allowedAuthOrigin(req, process.env.CORS_ORIGIN)) return json(res, 403, { error:'Start boost checkout from richpad.fun.' });
      if (!await store.chargeRpcRate(`boost-quote:${clientKey(req)}`, 1, 8, Math.floor(Date.now() / 60_000) * 60_000))
        return json(res, 429, { error:'Too many boost quotes; retry shortly.' });
      const input = await body(req);
      if (input.paymentProtocol !== 'journal-v1') return json(res,409,{error:'Refresh the app before purchasing a boost. Checkout recovery has been updated.'});
      let mint, payer, recipient;
      try {
        mint = new PublicKey(String(input.mint || '')).toBase58();
        payer = new PublicKey(String(input.payer || '')).toBase58();
      } catch { return json(res, 400, { error:'Enter a valid token mint and paying wallet before requesting a boost quote.' }); }
      try { recipient = new PublicKey(String(process.env.FUNDED_BOOST_PAYMENT_WALLET || '')).toBase58(); }
      catch { return json(res, 503, { error:'The Devnet boost payment address is not configured. No payment was requested.' }); }
      if (mint !== input.mint || payer !== input.payer || payer === recipient) return json(res, 400, { error:'A valid token mint and distinct paying wallet are required.' });
      const state = await store.read(),pricing=boostPricingSnapshot(state);
      const selected = pricing.packages.find(pack=>pack.id===input.packageId);
      if (!selected) return json(res, 400, { error:'Choose a supported boost package.' });
      const launch = state.launches?.[mint];
      const listing = state.listings?.[mint];
      if (!(launch?.onchainVerified && launch.cluster === 'devnet') && !(listing?.onchainVerified && listing.cluster === 'devnet'))
        return json(res, 404, { error:'Only verified tokens in the richpad.fun Solana directory can be boosted.' });
      const price = await readSolUsdQuote();
      if (!price || Date.now() - Date.parse(price.fetchedAt) > 120_000)
        return json(res, 503, { error:'A fresh SOL/USD quote is unavailable. No payment was requested.' });
      const now = Date.now();
      const quote = { id:id('boost'), mint, payer, recipient, packageId:selected.id, multiplier:selected.multiplier,
        hours:selected.hours, durationPolicy:STACKED_BOOST_POLICY, usd:selected.usd, pricingRevision:pricing.revision, solUsd:price.priceUsd, lamports:boostLamports(selected.usd, price.priceUsd),
        cluster:'devnet', paymentProtocol:'journal-v1', createdAt:new Date(now).toISOString(), expiresAt:new Date(now + 5 * 60_000).toISOString() };
      await store.update(current => {
        current.boostQuotes ||= {};
        // Retain immutable quotes for delayed receipt recovery, including legacy
        // payments whose browser closed before a server journal was available.
        current.boostQuotes[quote.id] = quote;
      });
      return json(res, 201, { ...quote, memo:boostMemo(quote.id) });
    }
    if (req.method === 'POST' && url.pathname === '/api/boosts/prepare') {
      if (solanaCluster !== 'devnet' || !boostPurchasesEnabled) return json(res,503,{error:'New boost purchases are unavailable.'});
      if (!allowedAuthOrigin(req,process.env.CORS_ORIGIN)) return json(res,403,{error:'Prepare checkout from richpad.fun.'});
      if (!await store.chargeRpcRate(`boost-prepare:${clientKey(req)}`,1,8,Math.floor(Date.now()/60000)*60000)) return json(res,429,{error:'Too many payment preparations. Retry shortly.'});
      const input=await body(req),quote=(await store.read()).boostQuotes?.[String(input.quoteId||'')];
      if (!quote) return json(res,404,{error:'Boost quote was not found.'});
      if (Date.now()>=Date.parse(quote.expiresAt)) return json(res,409,{error:'The quote expired. Request a fresh quote.'});
      try {
        const rpc=connection();if(await rpc.getGenesisHash()!==DEVNET_GENESIS_HASH) throw Error('Network mismatch');
        return json(res,200,await prepareBoostPayment({store,rpc,quote}));
      } catch { return json(res,503,{error:'Payment preparation is unavailable. No transaction was requested.'}); }
    }
    if (req.method === 'POST' && url.pathname === '/api/boosts/confirm') {
      if (solanaCluster !== 'devnet') return json(res, 403, { error:'Boost payments are available on Solana only.' });
      if (!allowedAuthOrigin(req, process.env.CORS_ORIGIN)) return json(res, 403, { error:'Confirm boost checkout from richpad.fun.' });
      const input = await body(req);
      const quoteId = String(input.quoteId || '');
      const signature = String(input.signature || '');
      if (!/^boost_\d+_[0-9a-f]{16}$/.test(quoteId) || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature))
        return json(res, 400, { error:'A valid boost quote and Solana signature are required.' });
      const state = await store.read();
      const existing = state.boostReceipts?.[signature];
      if (existing) return existing.quoteId === quoteId ? json(res, 200, receiptView(state,signature)) : json(res, 409, { error:'This transaction was already used.' });
      const quote = state.boostQuotes?.[quoteId];
      if (!quote) return json(res, 404, { error:'Boost quote was not found.' });
      const rpc = connection();
      let transaction;
      let payment = state.boostPayments?.[signature];
      try {
        if (await rpc.getGenesisHash() !== DEVNET_GENESIS_HASH) return json(res, 503, { error:'The configured RPC failed verification.' });
        if (input.signedTransaction) {
          try { payment = await registerBoostPayment({store,rpc,quote,signature,signedTransaction:input.signedTransaction}); }
          catch { return json(res, 503, { error:'The signed payment could not be journaled. Retry the same payment; do not sign another.' }); }
        }
        if (payment && payment.quoteId !== quoteId) return json(res, 409, {error:'This transaction belongs to another quote.'});
        transaction = await rpc.getParsedTransaction(signature, { commitment:'finalized', maxSupportedTransactionVersion:0 });
        if (!transaction) {
          const expired = await expiredBoostPayment(rpc, payment);
          if (expired) {
            await store.update(current => { if (current.boostPayments?.[signature]?.quoteId === quoteId) current.boostPayments[signature].status='expired'; });
            return json(res, 200, expired);
          }
          return json(res, 202, {status:'pending', signature, quoteId, cluster:'devnet',
            journaled:Boolean(payment), broadcastAllowed:Boolean(payment?.broadcastAllowed) && Date.now() <= Date.parse(quote.expiresAt),
            message:payment ? 'Payment is not finalized yet. Check the same signature.' : 'Payment proof is pending. Legacy recovery needs the original signature; do not pay again.'});
        }
      } catch { return json(res, 503, { error:'Finalized Solana payment proof is currently unavailable. Retry the same signature.' }); }
      if (transaction.transaction?.signatures?.[0] !== signature || !Number.isSafeInteger(transaction.slot) || transaction.slot < 1)
        return json(res, 503, { error:'Finalized payment proof did not match the requested signature. Retry verification of the same payment.' });
      if (transaction.meta?.err != null) return json(res, 200, { status:'failed', signature, quoteId,
        cluster:'devnet', commitment:'finalized', slot:transaction.slot });
      let proof;
      try { proof = verifyBoostPayment(transaction, quote, payment); }
      catch (error) { return json(res, 409, { error:error.message || 'Payment does not match this boost quote.' }); }
      const record = { signature, quoteId, mint:quote.mint, payer:quote.payer, recipient:quote.recipient,
        packageId:quote.packageId, multiplier:quote.multiplier, hours:quote.hours, usd:quote.usd,
        solUsd:quote.solUsd, lamports:quote.lamports, cluster:'devnet', status:'finalized',
        slot:proof.slot, startsAt:proof.startsAt, expiresAt:proof.expiresAt,
        ...(quote.durationPolicy?{durationPolicy:quote.durationPolicy}:{}) };
      try {
        let created=false;
        const saved = await store.update(current => {
          current.boostReceipts ||= {};
          if (current.boostReceipts[signature]) {
            if (current.boostReceipts[signature].quoteId !== quoteId) throw Object.assign(new Error('This transaction was already used.'), { statusCode:409 });
            return receiptView(current,signature);
          }
          if (Object.values(current.boostReceipts).some(row => row.quoteId === quoteId)) throw Object.assign(new Error('This boost quote was already paid.'), { statusCode:409 });
          if (JSON.stringify(current.boostQuotes?.[quoteId]) !== JSON.stringify(quote)) throw Object.assign(new Error('Boost quote changed during verification.'), { statusCode:409 });
          current.boostReceipts[signature] = record;
          if (current.boostPayments?.[signature]) current.boostPayments[signature].status='finalized';
          created=true;
          return receiptView(current,signature);
        });
        return json(res, created ? 201 : 200, saved);
      } catch (error) {
        if (error.statusCode === 409) return json(res, 409, { error:error.message });
        console.error(JSON.stringify({ event:'boost_receipt_storage_failure', requestId }));
        return json(res, 503, { error:'The payment receipt could not be saved. Retry verification with the same signature; do not pay again.', requestId });
      }
    }
    return false;
  };
}
